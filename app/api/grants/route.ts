/**
 * Grant Navigator API
 * GET  /api/grants?q=...&location=...&category=...  — search grants
 * POST /api/grants/feedback                          — submit RL feedback
 */
import { NextResponse } from 'next/server';
import { searchGrants } from '@/lib/grant-navigator/grokGrantClient';
import { getGrantRLAgent } from '@/lib/grant-navigator/ppoRlAgent';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const query    = url.searchParams.get('q') || 'community development grants South Carolina';
    const location = url.searchParams.get('location') || undefined;
    const category = url.searchParams.get('category') || undefined;
    const limitStr = url.searchParams.get('limit') || '8';
    const limit    = Math.min(20, Math.max(1, parseInt(limitStr, 10) || 8));
    const budget   = parseInt(url.searchParams.get('budget') || '0', 10) || undefined;

    // Fetch grants from Grok API
    const grants = await searchGrants({ query, location, category, maxResults: limit });

    // Rank with PPO RL agent
    const agent  = getGrantRLAgent();
    const ranked = agent.rankGrants(grants, query, budget);
    const stats  = agent.getStats();

    return NextResponse.json({
      grants: ranked,
      query,
      total: ranked.length,
      rlStats: stats,
    });
  } catch (err) {
    console.error('[api/grants] error', err);
    return NextResponse.json({ error: 'Failed to fetch grants' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      grants?: unknown[];
      feedback?: Record<string, number>;
      query?: string;
      budget?: number;
    };

    const { grants, feedback, query, budget } = body;
    if (!Array.isArray(grants) || !feedback || typeof query !== 'string') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const agent = getGrantRLAgent();
    agent.learn(grants as Parameters<typeof agent.learn>[0], feedback, query, budget);

    return NextResponse.json({ ok: true, stats: agent.getStats() });
  } catch (err) {
    console.error('[api/grants] feedback error', err);
    return NextResponse.json({ error: 'Failed to process feedback' }, { status: 500 });
  }
}
