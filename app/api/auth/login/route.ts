import { NextResponse } from 'next/server';
import { getUserByEmail, verifyPassword } from '@/lib/saas/db';
import { createSessionToken, DASHBOARD_SESSION_COOKIE, getSessionCookieMaxAge, verifyDashboardCredentials } from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json() as { email?: string; username?: string; password?: string };
    const password = body?.password || '';
    const emailOrUser = (body?.email || body?.username || '').trim();

    if (!emailOrUser || !password) {
      return NextResponse.json({ ok: false, error: 'Email and password required' }, { status: 400 });
    }

    // 1. Try SaaS user lookup (email-based)
    if (emailOrUser.includes('@')) {
      const user = await getUserByEmail(emailOrUser);
      if (user && verifyPassword(password, user.passwordHash)) {
        const token = createSessionToken(user.id);
        const res = NextResponse.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, trialEndsAt: user.trialEndsAt } });
        res.cookies.set({ name: DASHBOARD_SESSION_COOKIE, value: token, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: getSessionCookieMaxAge() });
        return res;
      }
      return NextResponse.json({ ok: false, error: 'Invalid email or password' }, { status: 401 });
    }

    // 2. Legacy admin credentials (username/pass from env vars)
    if (verifyDashboardCredentials(emailOrUser, password)) {
      const token = createSessionToken(emailOrUser);
      const res = NextResponse.json({ ok: true, user: { id: emailOrUser, email: '', name: emailOrUser, plan: 'elite', trialEndsAt: null } });
      res.cookies.set({ name: DASHBOARD_SESSION_COOKIE, value: token, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: getSessionCookieMaxAge() });
      return res;
    }

    return NextResponse.json({ ok: false, error: 'Invalid credentials' }, { status: 401 });
  } catch {
    return NextResponse.json({ ok: false, error: 'Login failed — please retry' }, { status: 500 });
  }
}
