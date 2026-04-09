/**
 * PPO Grant Agent API
 * POST /api/ppo-grant-agent
 *
 * Mimics a Supabase Edge Function so iOS clients can call it via:
 *   supabase.functions.invoke("ppo-grant-agent", params: { userId, state, location })
 *
 * Response shape matches what the iOS LivePPOAgentView expects:
 *   { ppo_action: string, algorithm: PPOAlgorithmDetails, ... }
 */

import { runPPOGrantAgent } from '@/lib/intelligence/ppoGrantAgent';

export const runtime = 'nodejs';

interface PPOGrantRequest {
  userId?: string;
  state?: string;
  location?: string;
  topK?: number;
}

export async function POST(req: Request): Promise<Response> {
  let body: PPOGrantRequest = {};

  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const userId = String(body.userId ?? 'anonymous').slice(0, 128);
  const state = String(body.state ?? '').slice(0, 2).toUpperCase();
  const location = String(body.location ?? '').slice(0, 256);
  const topK = Math.max(1, Math.min(10, Number(body.topK ?? 5)));

  if (!location) {
    return Response.json(
      { error: 'location is required' },
      { status: 400 },
    );
  }

  try {
    const result = runPPOGrantAgent({ userId, state, location, topK });
    return Response.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return Response.json({ error: message }, { status: 500 });
  }
}

/** GET is not supported — return a clear error. */
export async function GET(): Promise<Response> {
  return Response.json(
    { error: 'Use POST with { userId, state, location }' },
    { status: 405 },
  );
}
