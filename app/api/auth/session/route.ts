import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  createSessionToken,
  DASHBOARD_SESSION_COOKIE,
  getSessionCookieMaxAge,
  parseSessionToken,
} from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value;
  const payload = parseSessionToken(token);
  if (!payload) {
    return NextResponse.json({ authenticated: false });
  }

  const renewed = createSessionToken(payload.user);
  const response = NextResponse.json({ authenticated: true, user: payload.user });
  response.cookies.set({
    name: DASHBOARD_SESSION_COOKIE,
    value: renewed,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: getSessionCookieMaxAge(),
  });
  return response;
}
