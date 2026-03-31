import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { parseSessionToken, DASHBOARD_SESSION_COOKIE } from '@/lib/auth/session';
import { getUserById, getUserKeys, upsertUserKeys, decryptKey } from '@/lib/saas/db';

export const runtime = 'nodejs';

async function getSessionUser(req: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value;
  const payload = parseSessionToken(token);
  if (!payload?.user) return null;
  return getUserById(payload.user);
}

export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const keys = await getUserKeys(user.id);
  if (!keys) return NextResponse.json({ configured: false });
  return NextResponse.json({
    configured: true,
    coinbase: { connected: Boolean(keys.coinbaseApiKey), keyPreview: keys.coinbaseApiKey ? '••••' + keys.coinbaseApiKey.slice(-4) : null },
    kraken:   { connected: Boolean(keys.krakenApiKey),   keyPreview: keys.krakenApiKey   ? '••••' + keys.krakenApiKey.slice(-4)   : null },
    openrouter: { connected: Boolean(keys.openrouterApiKey) },
    telegram: { configured: Boolean(keys.telegramChatId) },
    targetMonthly: keys.targetMonthly,
    targetDaily:   keys.targetDaily,
  });
}

export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as Record<string, any>;
  const allowed = ['coinbaseApiKey','coinbaseApiSecret','krakenApiKey','krakenApiSecret','openrouterApiKey','telegramChatId','telegramBotToken','targetMonthly','targetDaily'];
  const updates: Record<string, any> = {};
  for (const k of allowed) { if (k in body) updates[k] = body[k]; }

  await upsertUserKeys(user.id, updates);
  return NextResponse.json({ ok: true });
}
