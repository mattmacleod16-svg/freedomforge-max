import { createHmac, timingSafeEqual } from 'crypto';

export const DASHBOARD_SESSION_COOKIE = 'ff_dashboard_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  user: string;
  exp: number;
};

function getSessionSecret() {
  const secret = (process.env.DASHBOARD_SESSION_SECRET || process.env.DASHBOARD_PASS || '').trim();
  if (!secret) {
    console.error('[session] FATAL: DASHBOARD_SESSION_SECRET not set — rejecting all sessions');
    // FIX LOW #18: Return empty string which will cause all signature checks to fail
    // rather than using a predictable fallback that an attacker could forge
    return '';
  }
  return secret;
}

function sign(rawPayload: string) {
  const secret = getSessionSecret();
  // H4 FIX: Refuse to sign with empty secret — prevents token forgery
  if (!secret) return '';
  return createHmac('sha256', secret).update(rawPayload).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Parse the DASHBOARD_USERS env var into a username→password map.
 *
 * Format (set in Railway Variables):
 *   DASHBOARD_USERS=alice:pass1,bob:pass2,carol:pass3
 *
 * Falls back to single-user DASHBOARD_USER/DASHBOARD_PASS for backward compat.
 */
export function getAllUsers(): Map<string, string> {
  const map = new Map<string, string>();

  // Multi-user list takes priority
  const raw = (process.env.DASHBOARD_USERS || '').trim();
  if (raw) {
    for (const entry of raw.split(',')) {
      const colon = entry.indexOf(':');
      if (colon <= 0) continue;
      const u = entry.slice(0, colon).trim();
      const p = entry.slice(colon + 1).trim();
      if (u && p) map.set(u, p);
    }
  }

  // Always include the single-user fallback (backward compat)
  const singleUser = (process.env.DASHBOARD_USER || '').trim();
  const singlePass = (process.env.DASHBOARD_PASS || '').trim();
  if (singleUser && singlePass && !map.has(singleUser)) {
    map.set(singleUser, singlePass);
  }

  if (map.size === 0) {
    console.error('[session] No users configured — set DASHBOARD_USER/DASHBOARD_PASS or DASHBOARD_USERS');
  }
  return map;
}

export function verifyDashboardCredentials(user: string, pass: string): boolean {
  const users = getAllUsers();
  const storedPass = users.get(user);
  if (!storedPass) return false;
  // Use safeEqual on password; username match is already by map key lookup
  return safeEqual(pass, storedPass);
}

export function createSessionToken(user: string) {
  const payload: SessionPayload = {
    user,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token?: string | null) {
  return Boolean(parseSessionToken(token));
}

export function parseSessionToken(token?: string | null): SessionPayload | null {
  if (!token) return null;
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expected = sign(encodedPayload);
  // H4 FIX: Empty expected signature means secret is missing — reject all tokens
  if (!expected || !safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload?.user || typeof payload.user !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

export function getSessionCookieMaxAge() {
  return SESSION_TTL_SECONDS;
}
