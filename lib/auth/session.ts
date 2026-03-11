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
  return createHmac('sha256', getSessionSecret()).update(rawPayload).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function getDashboardCredentials() {
  const user = (process.env.DASHBOARD_USER || '').trim();
  const pass = (process.env.DASHBOARD_PASS || '').trim();
  if (!user || !pass) {
    console.error('[session] DASHBOARD_USER or DASHBOARD_PASS not set — login disabled');
  }
  return { user, pass };
}

export function verifyDashboardCredentials(user: string, pass: string) {
  const credentials = getDashboardCredentials();
  if (!credentials.user || !credentials.pass) return false;
  const userMatch = safeEqual(user, credentials.user);
  const passMatch = safeEqual(pass, credentials.pass);
  return userMatch && passMatch;
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
  if (!safeEqual(signature, expected)) return null;

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
