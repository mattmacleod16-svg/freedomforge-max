import { NextResponse } from 'next/server';
import { createUser, verifyPassword, getUserByEmail } from '@/lib/saas/db';
import { createSessionToken, DASHBOARD_SESSION_COOKIE, getSessionCookieMaxAge } from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { email, password, name } = await req.json() as { email?: string; password?: string; name?: string };

    if (!email || !password || !name) {
      return NextResponse.json({ ok: false, error: 'Email, password and name are required' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ ok: false, error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ ok: false, error: 'Invalid email address' }, { status: 400 });
    }

    const user = await createUser(email, password, name);
    if (!user) {
      return NextResponse.json({ ok: false, error: 'An account with this email already exists' }, { status: 409 });
    }

    // Auto-login after signup
    const token = createSessionToken(user.id);
    const res = NextResponse.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, trialEndsAt: user.trialEndsAt } });
    res.cookies.set({ name: DASHBOARD_SESSION_COOKIE, value: token, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: getSessionCookieMaxAge() });
    return res;
  } catch (e: any) {
    console.error('[signup]', e);
    return NextResponse.json({ ok: false, error: 'Signup failed — please try again' }, { status: 500 });
  }
}
