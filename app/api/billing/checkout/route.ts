import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { parseSessionToken, DASHBOARD_SESSION_COOKIE } from '@/lib/auth/session';
import { getUserById, updateUser } from '@/lib/saas/db';

export const runtime = 'nodejs';

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_URL || 'https://freedomforge.one';

const PRICE_IDS: Record<string, string> = {
  pro:   process.env.STRIPE_PRICE_PRO   || '',
  elite: process.env.STRIPE_PRICE_ELITE || '',
};

export async function POST(req: Request) {
  if (!STRIPE_SECRET) return NextResponse.json({ error: 'Billing not configured' }, { status: 503 });

  const cookieStore = await cookies();
  const token = cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value;
  const payload = parseSessionToken(token);
  if (!payload?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getUserById(payload.user);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const { plan } = await req.json() as { plan: 'pro' | 'elite' };
  const priceId = PRICE_IDS[plan];
  if (!priceId) return NextResponse.json({ error: `Price not configured for plan: ${plan}` }, { status: 400 });

  // Create Stripe checkout session via Stripe API
  const params = new URLSearchParams({
    'mode': 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'success_url': `${APP_URL}/onboarding?step=keys&upgraded=1`,
    'cancel_url': `${APP_URL}/pricing`,
    'customer_email': user.email,
    'metadata[userId]': user.id,
    'metadata[plan]': plan,
    'subscription_data[metadata][userId]': user.id,
    'subscription_data[metadata][plan]': plan,
  });
  if (user.stripeCustomerId) params.set('customer', user.stripeCustomerId);

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${STRIPE_SECRET}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const session = await res.json() as any;
  if (!res.ok) return NextResponse.json({ error: session.error?.message || 'Stripe error' }, { status: 500 });

  return NextResponse.json({ url: session.url });
}
