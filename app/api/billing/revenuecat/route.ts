/**
 * RevenueCat Webhook Handler
 * POST /api/billing/revenuecat — handles RevenueCat subscription events
 *
 * RevenueCat sends events for mobile subscription management (iOS via Capacitor).
 * This endpoint syncs RevenueCat subscription status with our user database.
 */
import { NextResponse } from 'next/server';
import { updateUser, getUserById } from '@/lib/saas/db';
import crypto from 'crypto';

export const runtime = 'nodejs';

const REVENUECAT_WEBHOOK_SECRET = process.env.REVENUECAT_WEBHOOK_SECRET || '';

interface RevenueCatEvent {
  event: {
    type: string;
    app_user_id: string;
    subscriber_attributes?: Record<string, { value: string }>;
    product_id?: string;
    entitlement_id?: string;
    expiration_at_ms?: number;
  };
  api_version: string;
}

function verifyRevenueCatSignature(body: string, authHeader: string | null): boolean {
  if (!REVENUECAT_WEBHOOK_SECRET) {
    // In production, always require the secret to be configured
    if (process.env.NODE_ENV === 'production') return false;
    // Allow in non-production only if no secret is set (dev/testing)
    return true;
  }
  if (!authHeader) return false;
  // RevenueCat uses a simple Authorization header with the secret
  return crypto.timingSafeEqual(
    Buffer.from(authHeader.trim()),
    Buffer.from(REVENUECAT_WEBHOOK_SECRET.trim()),
  );
}

function mapRevenueCatPlan(productId?: string): 'pro' | 'elite' {
  if (!productId) return 'pro';
  const pid = productId.toLowerCase();
  if (pid.includes('elite') || pid.includes('annual')) return 'elite';
  return 'pro';
}

export async function POST(req: Request) {
  const body = await req.text();
  const authHeader = req.headers.get('authorization');

  if (!verifyRevenueCatSignature(body, authHeader)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: RevenueCatEvent;
  try {
    payload = JSON.parse(body) as RevenueCatEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { event } = payload;
  const userId = event.app_user_id;

  try {
    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE': {
        const plan = mapRevenueCatPlan(event.product_id);
        const trialEndsAt = event.expiration_at_ms
          ? Math.floor(event.expiration_at_ms / 1000)
          : null;
        await updateUser(userId, { plan, trialEndsAt });
        break;
      }
      case 'CANCELLATION':
      case 'EXPIRATION': {
        const user = await getUserById(userId);
        if (user) {
          await updateUser(userId, { plan: 'free', trialEndsAt: null });
        }
        break;
      }
      case 'BILLING_ISSUE': {
        // Downgrade to free on unrecoverable billing failures
        await updateUser(userId, { plan: 'free' });
        break;
      }
      default:
        // Unhandled event types are silently accepted
        break;
    }
  } catch (err) {
    console.error('[revenuecat webhook] error processing event', event.type, err);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
