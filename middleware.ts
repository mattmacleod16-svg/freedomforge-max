import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { DASHBOARD_SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session';

/**
 * Protect dashboard routes with session cookie auth.
 */
export function middleware(req: NextRequest) {
  const token = req.cookies.get(DASHBOARD_SESSION_COOKIE)?.value;
  const isAuthenticated = verifySessionToken(token);

  if (!isAuthenticated) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
