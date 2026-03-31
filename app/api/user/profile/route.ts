import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { parseSessionToken, DASHBOARD_SESSION_COOKIE } from '@/lib/auth/session';
import { getUserById } from '@/lib/saas/db';

export const runtime = 'nodejs';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value;
  const payload = parseSessionToken(token);
  if (!payload?.user) return NextResponse.json({ authenticated: false }, { status: 401 });

  const user = await getUserById(payload.user);
  if (!user) return NextResponse.json({ authenticated: true, plan: 'elite', isAdmin: true }); // legacy admin

  const now = Date.now();
  const trialActive = user.trialEndsAt ? user.trialEndsAt > now : false;
  const trialDaysLeft = user.trialEndsAt ? Math.max(0, Math.ceil((user.trialEndsAt - now) / 86400000)) : 0;

  return NextResponse.json({
    authenticated: true,
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    trialActive,
    trialDaysLeft,
    isAdmin: false,
  });
}
