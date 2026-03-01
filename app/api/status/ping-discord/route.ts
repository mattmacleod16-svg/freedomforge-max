import { sendAlert } from '@/lib/alerts';

export const runtime = 'nodejs';

function isAuthorized(req: Request) {
  const secret = process.env.ALERT_SECRET;
  if (!secret) return false;

  const headerSecret = req.headers.get('x-alert-secret');
  const authHeader = req.headers.get('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const url = new URL(req.url);
  const querySecret = url.searchParams.get('secret');

  return headerSecret === secret || bearer === secret || querySecret === secret;
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
