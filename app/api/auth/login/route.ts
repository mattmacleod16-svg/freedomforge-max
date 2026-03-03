import { NextResponse } from 'next/server';
import {
  createSessionToken,
  DASHBOARD_SESSION_COOKIE,
  getSessionCookieMaxAge,
  verifyDashboardCredentials,
} from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { username?: string; password?: string };
    const username = (body?.username || '').trim();
    const password = body?.password || '';

    if (!verifyDashboardCredentials(username, password)) {
      return NextResponse.json({ ok: false, error: 'Invalid credentials' }, { status: 401 });
    }

    const token = createSessionToken(username);
    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: DASHBOARD_SESSION_COOKIE,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: getSessionCookieMaxAge(),
    });

    return response;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request payload' }, { status: 400 });
  }
}
