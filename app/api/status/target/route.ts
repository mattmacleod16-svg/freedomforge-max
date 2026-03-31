/**
 * Target Income API
 * GET  /api/status/target  — current target + progress
 * POST /api/status/target  — set a new target { daily?, weekly?, monthly? }
 */

import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

async function getEngine() {
  return require('@/lib/target-income-engine');
}

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;
  try {
    const engine = await getEngine();
    return Response.json({ ok: true, ...engine.getStatus() });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const engine = await getEngine();
    const result = engine.setTarget(body);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
