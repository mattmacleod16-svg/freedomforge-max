import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { DASHBOARD_SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session';

/**
 * Protect dashboard routes with signed cookie sessions.
 */
export function proxy(req: NextRequest) {
  const token = req.cookies.get(DASHBOARD_SESSION_COOKIE)?.value;
  if (!verifySessionToken(token)) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
