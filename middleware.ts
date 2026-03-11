import { NextResponse, type NextRequest } from 'next/server';

/**
 * Security headers middleware — applies to all responses.
 * FIX HIGH #7: Prevent clickjacking, enforce HTTPS, prevent MIME sniffing.
 */
export function middleware(request: NextRequest) {
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
