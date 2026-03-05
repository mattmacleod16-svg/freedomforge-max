import { createHmac, timingSafeEqual } from 'crypto';

export const DASHBOARD_SESSION_COOKIE = 'ff_dashboard_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  user: string;
  exp: number;
};

function getSessionSecret() {
  return (
    process.env.DASHBOARD_SESSION_SECRET ||
    process.env.DASHBOARD_PASS ||
    'freedomforge-dashboard-secret'
  ).trim();
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
  return {
    user: (process.env.DASHBOARD_USER || 'admin').trim(),
    pass: (process.env.DASHBOARD_PASS || 'FreedomForge2026').trim(),
  };
}

export function verifyDashboardCredentials(user: string, pass: string) {
  const credentials = getDashboardCredentials();
  return user === credentials.user && pass === credentials.pass;
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
  if (!token) return false;
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return false;

  const expected = sign(encodedPayload);
  if (!safeEqual(signature, expected)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

export function getSessionCookieMaxAge() {
  return SESSION_TTL_SECONDS;
}
