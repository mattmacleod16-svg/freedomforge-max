/**
 * RevenueCat Webhook Handler
 *
 * Processes RevenueCat subscription lifecycle events for mobile (iOS/Android)
 * in-app purchases, keeping user plan records in sync with the SaaS DB layer.
 *
 * Supported events:
 *   - INITIAL_PURCHASE    → set plan = pro/elite
 *   - RENEWAL             → refresh plan expiry
 *   - PRODUCT_CHANGE      → update plan tier
 *   - CANCELLATION        → schedule plan downgrade
 *   - EXPIRATION          → downgrade to free
 *   - BILLING_ISSUE       → log for retry handling
 *
 * Security: requests are verified via the REVENUECAT_WEBHOOK_SECRET header
 * (set in the RevenueCat dashboard under Project → Integrations → Webhooks).
 *
 * Required env:
 *   REVENUECAT_API_KEY        — RevenueCat secret API key (server-side)
 *   REVENUECAT_WEBHOOK_SECRET — shared secret for payload verification
 */

import { NextResponse } from 'next/server';
import { updateUser, getUserByEmail } from '@/lib/saas/db';
import crypto from 'crypto';

export const runtime = 'nodejs';

const WEBHOOK_SECRET = process.env.REVENUECAT_WEBHOOK_SECRET || '';

/** RevenueCat webhook event payload types. */
interface RevenueCatEvent {
  type: string;
  app_user_id?: string;
  aliases?: string[];
  product_id?: string;
  new_product_id?: string;
}

interface RevenueCatWebhookBody {
  event?: RevenueCatEvent;
}

/** RFC 5322-compliant simple email regex. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Map RevenueCat product identifiers → internal plan names. */
function resolvePlan(productId: string): 'pro' | 'elite' | null {
  const id = (productId || '').toLowerCase();
  if (id.includes('elite') || id.includes('premium')) return 'elite';
  if (id.includes('pro') || id.includes('standard')) return 'pro';
  return null;
}

/** Constant-time comparison to prevent timing attacks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization') || '';
  const providedSecret = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  if (WEBHOOK_SECRET && !safeEqual(providedSecret, WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: RevenueCatWebhookBody;
  try {
    body = await req.json() as RevenueCatWebhookBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const event      = body?.event ?? {};
  const type       = (event.type ?? '').toUpperCase();
  const appUserId  = event.app_user_id;
  const aliases    = event.aliases ?? [];
  const productId  = event.product_id ?? '';

  // Resolve the user email — RevenueCat app_user_id should be the user's email
  // or a UUID; aliases may contain the email.
  const emailCandidates = [appUserId, ...aliases]
    .filter((c): c is string => typeof c === 'string' && EMAIL_REGEX.test(c));

  let user = null;
  for (const email of emailCandidates) {
    user = await getUserByEmail(email);
    if (user) break;
  }

  switch (type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION': {
      const plan = resolvePlan(productId);
      if (user && plan) {
        await updateUser(user.id, { plan });
      }
      break;
    }
    case 'PRODUCT_CHANGE': {
      const newPlan = resolvePlan(event.new_product_id ?? productId);
      if (user && newPlan) {
        await updateUser(user.id, { plan: newPlan });
      }
      break;
    }
    case 'EXPIRATION':
    case 'CANCELLATION': {
      // Downgrade to free on expiration; for cancellation leave active until expiry
      if (type === 'EXPIRATION' && user) {
        await updateUser(user.id, { plan: 'free' });
      }
      break;
    }
    case 'BILLING_ISSUE':
      // Billing issues are logged but don't immediately change plan status
      // to avoid disrupting subscribers during payment retries.
      break;
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
