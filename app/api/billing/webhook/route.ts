import { NextResponse } from 'next/server';
import { updateUser, getUserByEmail } from '@/lib/saas/db';
import crypto from 'crypto';

export const runtime = 'nodejs';

const STRIPE_SECRET      = process.env.STRIPE_SECRET_KEY   || '';
const WEBHOOK_SECRET     = process.env.STRIPE_WEBHOOK_SECRET || '';

function verifyStripeSignature(payload: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  const ts = parts['t'];
  const sig = parts['v1'];
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig || ''));
}

export async function POST(req: Request) {
  const body = await req.text();
  const sig  = req.headers.get('stripe-signature');

  if (WEBHOOK_SECRET && !verifyStripeSignature(body, sig, WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const event = JSON.parse(body);
  const obj   = event.data?.object as any;

  switch (event.type) {
    case 'checkout.session.completed': {
      const userId  = obj.metadata?.userId;
      const plan    = obj.metadata?.plan as 'pro' | 'elite';
      const custId  = obj.customer;
      const subId   = obj.subscription;
      if (userId && plan) {
        await updateUser(userId, { plan, stripeCustomerId: custId, stripeSubscriptionId: subId });
      }
      break;
    }
    case 'customer.subscription.updated': {
      const userId = obj.metadata?.userId;
      const status = obj.status;
      if (userId && (status === 'active' || status === 'trialing')) {
        const plan = obj.metadata?.plan as 'pro' | 'elite' || 'pro';
        await updateUser(userId, { plan });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const userId = obj.metadata?.userId;
      if (userId) await updateUser(userId, { plan: 'free', stripeSubscriptionId: null });
      break;
    }
  }

  return NextResponse.json({ received: true });
}
