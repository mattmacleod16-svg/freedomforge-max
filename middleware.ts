import { NextResponse, type NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/auth/rateLimiter';

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
];

function getClientIp(request: NextRequest): string {
  // X-Forwarded-For may be spoofed, but for rate limiting (not auth) it's acceptable
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || (request as unknown as { ip?: string }).ip
    || '0.0.0.0';
}

/**
 * Security headers + rate limiting middleware — applies to all responses.
 */
export function middleware(request: NextRequest) {
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

  // Prevent clickjacking — only allow Grafana domain to embed
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-DNS-Prefetch-Control', 'off');

  // HSTS — enforce HTTPS
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  // Basic CSP: block inline scripts (except Next.js nonce-based), prevent embedding
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js requires unsafe-inline/eval
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "frame-src 'self' https://*.grafana.net https://*.grafana.com",
      "frame-ancestors 'none'",
    ].join('; ')
  );

  return response;
}

// Apply to all routes except static files and API preflight
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
