import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Protect dashboard routes with HTTP Basic Auth.
 */
export function middleware(req: NextRequest) {
  const env = process.env as unknown as Record<string, string | undefined>;
  const user = env.DASHBOARD_USER || 'admin';
  const pass = env.DASHBOARD_PASS || 'FreedomForge2026';
  const expected = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  const provided = req.headers.get('authorization') || '';

  if (provided !== expected) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="FreedomForge Dashboard"',
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
