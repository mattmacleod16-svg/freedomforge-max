import { NextResponse } from 'next/server';
import { updateUser } from '@/lib/saas/db';
import { ibcV2Send } from '@/lib/protocols/crossChainBridges';
import { triggerDriftRetraining } from '@/lib/intelligence/autonomyDirector';
import crypto from 'crypto';

export const runtime = 'nodejs';

const STRIPE_SECRET      = process.env.STRIPE_SECRET_KEY   || '';
const WEBHOOK_SECRET     = process.env.STRIPE_WEBHOOK_SECRET || '';

/** Percentage of each payment allocated to the impact fund (10%). */
const IMPACT_ALLOCATION_PCT = 0.10;

/** IBC v2 channel used to broadcast payment events cross-chain. */
const IBC_SOURCE_CHANNEL = process.env.IBC_SOURCE_CHANNEL || 'channel-0';
const IBC_DEST_CHANNEL   = process.env.IBC_DEST_CHANNEL   || 'channel-1';
const IBC_SOURCE_CHAIN   = process.env.IBC_SOURCE_CHAIN   || 'Osmosis';
const IBC_DEST_CHAIN     = process.env.IBC_DEST_CHAIN     || 'Injective';

function verifyStripeSignature(payload: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  const ts = parts['t'];
  const sig = parts['v1'];
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig || ''));
}

/**
 * Allocate 10% of a Stripe amount (in cents) to the impact fund.
 * Returns the impact amount in USD.
 */
function allocateImpact(amountCents: number): number {
  return Math.round(amountCents * IMPACT_ALLOCATION_PCT) / 100;
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

      // ── 10% Impact Allocation ─────────────────────────────────────────────
      const amountTotal: number = typeof obj.amount_total === 'number' ? obj.amount_total : 0;
      const impactUsd = allocateImpact(amountTotal);

      // ── RL Trigger ────────────────────────────────────────────────────────
      // Signal a new revenue event so the autonomy director can update its
      // learning policy (drift-retraining check) with a positive reward.
      await triggerDriftRetraining('payment_received').catch((err: unknown) => {
        console.error('[webhook] RL trigger failed:', err instanceof Error ? err.message : String(err));
      });

      // ── IBC v2 Cross-Chain Call ───────────────────────────────────────────
      // Broadcast the payment event cross-chain so partner Cosmos chains can
      // react (e.g., unlock features, record impact allocation on-chain).
      try {
        ibcV2Send({
          sourceChain: IBC_SOURCE_CHAIN,
          destChain: IBC_DEST_CHAIN,
          sourceChannel: IBC_SOURCE_CHANNEL,
          destChannel: IBC_DEST_CHANNEL,
          sender: custId || 'freedomforge',
          receiver: process.env.IBC_RECEIVER || 'cosmos1freedomforge',
          data: JSON.stringify({
            type: 'payment_completed',
            userId,
            plan,
            amountUsd: amountTotal / 100,
            impactUsd,
            ts: Date.now(),
          }),
        });
      } catch (err: unknown) {
        console.error('[webhook] IBC v2 broadcast failed:', err instanceof Error ? err.message : String(err));
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
