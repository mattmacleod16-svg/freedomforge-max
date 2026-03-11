import { sendAlert } from '@/lib/alerts';
import { timingSafeEqual } from 'crypto';

export const runtime = 'nodejs';

function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function isAuthorized(req: Request) {
  const secret = process.env.ALERT_SECRET;
  if (!secret) return false;

  const headerSecret = req.headers.get('x-alert-secret') || '';
  const authHeader = req.headers.get('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  // FIX CRITICAL #3 + HIGH #5: Use timing-safe comparison, remove query-string secret

  return safeEqual(headerSecret, secret) || safeEqual(bearer || '', secret);
}

export async function GET(req: Request) {
  if (!process.env.ALERT_WEBHOOK_URL) {
    return Response.json(
      { error: 'ALERT_WEBHOOK_URL is not configured' },
      { status: 400 }
    );
  }

  if (!process.env.ALERT_SECRET) {
    return Response.json(
      { error: 'ALERT_SECRET is required to use this endpoint safely' },
      { status: 400 }
    );
  }

  if (!isAuthorized(req)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const source = url.searchParams.get('source') || 'manual';
  const note = (url.searchParams.get('note') || '').slice(0, 160);
  const timestamp = new Date().toISOString();
  const message = note
    ? `✅ Discord ping test (${source}) at ${timestamp} — ${note}`
    : `✅ Discord ping test (${source}) at ${timestamp}`;

  await sendAlert(message);

  return Response.json({
    ok: true,
    sent: true,
    message,
  });
}
