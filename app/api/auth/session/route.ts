import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { DASHBOARD_SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session';

export const runtime = 'nodejs';

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value;
  return NextResponse.json({ authenticated: verifySessionToken(token) });
}
