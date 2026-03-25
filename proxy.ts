import { NextResponse, type NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/cache/rateLimiter-redis';

/**
 * Rate limit rules per endpoint pattern.
 * { pattern, maxRequests, windowMs }
 */
const RATE_LIMIT_RULES: { pattern: RegExp; max: number; windowMs: number }[] = [
  // Auth: 10 attempts per 15 minutes per IP
  { pattern: /^\/api\/auth\/login$/, max: 10, windowMs: 15 * 60 * 1000 },
  // Withdraw: 5 per hour per IP (high-value mutation)
  { pattern: /^\/api\/alchemy\/wallet\/withdraw$/, max: 5, windowMs: 60 * 60 * 1000 },
  // Distribute: 60 per minute per IP (trade loops call frequently)
  { pattern: /^\/api\/alchemy\/wallet\/distribute$/, max: 60, windowMs: 60 * 1000 },
  // Chat: 30 per minute per IP (LLM cost)
  { pattern: /^\/api\/chat$/, max: 30, windowMs: 60 * 1000 },
  // Forecast creation: 20 per minute per IP
  { pattern: /^\/api\/status\/autonomy\/forecast$/, max: 20, windowMs: 60 * 1000 },
  // Ground truth: 10 per minute per IP
  { pattern: /^\/api\/status\/autonomy\/ground-truth$/, max: 10, windowMs: 60 * 1000 },
  // Sync: 120 per minute per IP (frequent client polling)
  { pattern: /^\/api\/sync$/, max: 120, windowMs: 60 * 1000 },
  // Skills: 30 per minute per IP
  { pattern: /^\/api\/status\/skills$/, max: 30, windowMs: 60 * 1000 },
  // Integrity: 10 per minute per IP
  { pattern: /^\/api\/status\/integrity$/, max: 10, windowMs: 60 * 1000 },
];

/**
 * Mutation endpoints that should be logged in the integrity audit trail.
 * These are the most security-sensitive routes.
 */
const MUTATION_AUDIT_PATTERNS: RegExp[] = [
  /^\/api\/alchemy\/wallet\/withdraw$/,
  /^\/api\/alchemy\/wallet\/distribute$/,
  /^\/api\/sync$/,
  /^\/api\/status\/integrity$/,
  /^\/api\/status\/skills$/,
];

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || (request as unknown as { ip?: string }).ip
    || '0.0.0.0';
}

/**
 * Security headers + rate limiting proxy — applies to all responses.
 * Renamed from middleware.ts to proxy.ts per Next.js 16 convention.
 */
export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // --- Rate limiting for sensitive API endpoints ---
  for (const rule of RATE_LIMIT_RULES) {
    if (rule.pattern.test(pathname)) {
      const ip = getClientIp(request);
      const key = `${ip}:${pathname}`;
      const result = checkRateLimit(key, rule.max, rule.windowMs);

      if (!result.allowed) {
        return new NextResponse(
          JSON.stringify({ error: 'rate limit exceeded', retryAfterMs: result.resetMs }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(Math.ceil(result.resetMs / 1000)),
              'X-RateLimit-Limit': String(rule.max),
              'X-RateLimit-Remaining': '0',
            },
          }
        );
      }
    }
  }

  const response = NextResponse.next();

  // Tag mutation requests for server-side audit logging
  const method = request.method;
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    for (const pattern of MUTATION_AUDIT_PATTERNS) {
      if (pattern.test(pathname)) {
        response.headers.set('X-Audit-Required', 'true');
        response.headers.set('X-Audit-Endpoint', pathname);
        response.headers.set('X-Audit-Method', method);
        break;
      }
    }
  }

  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // HSTS — enforce HTTPS
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  // CSP
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      process.env.NODE_ENV === 'production'
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://openrouter.ai https://*.alchemy.com https://*.g.alchemy.com https://backboard.railway.app wss: https:",
      "worker-src 'self' blob:",
      "frame-src 'self' https://*.grafana.net https://*.grafana.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );

  // Permissions Policy
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
  );

  // Cross-Origin isolation
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');

  return response;
}

// Apply to all routes except static files and API preflight
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};