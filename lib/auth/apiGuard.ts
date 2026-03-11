/**
 * API Route Guard — Reusable auth check for mutation endpoints.
 * Checks (in order):
 *   1. Session cookie (for dashboard users)
 *   2. Authorization: Bearer <ALERT_SECRET> header (for internal scripts)
 *   3. x-api-secret header (for internal scripts)
 * Returns null if authorized, or a 401 Response if not.
 */
import { cookies } from 'next/headers';
import { parseSessionToken, DASHBOARD_SESSION_COOKIE } from './session';
import { timingSafeEqual } from 'crypto';

function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function requireAuth(req: Request): Promise<Response | null> {
  // 1. Check session cookie
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value;
    if (parseSessionToken(token)) return null; // authorized
  } catch {
    // cookies() may throw in edge runtime — fall through
  }

  // 2. Check Authorization header
  const authHeader = req.headers.get('authorization');
  const apiSecret = (process.env.ALERT_SECRET || '').trim();
  if (authHeader && apiSecret) {
    const bearer = authHeader.replace(/^Bearer\s+/i, '');
    if (safeCompare(bearer, apiSecret)) return null; // authorized
  }

  // 3. Check x-api-secret header
  const xApiSecret = req.headers.get('x-api-secret');
  if (xApiSecret && apiSecret && safeCompare(xApiSecret, apiSecret)) return null; // authorized

  // 4. Localhost bypass — ONLY in non-production environments
  // FIX CRITICAL: X-Forwarded-For is spoofable on Vercel, so never trust it in production
  if (process.env.NODE_ENV !== 'production') {
    const url = new URL(req.url);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return null;
  }

  return Response.json({ error: 'unauthorized' }, { status: 401 });
}
