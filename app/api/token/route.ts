/**
 * GET /api/token — Token info, metrics, and marketing content.
 * POST /api/token — Trigger token marketing post via X automation.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/apiGuard';
import {
  getTokenMarketingPosts,
  getRandomTokenPost,
  formatForX,
  getTokenContentStats,
  type TokenContentCategory,
} from '@/lib/social/tokenMarketingContent';

const TOKEN_INFO = {
  name: 'FreedomForge',
  symbol: 'FORGE',
  decimals: 18,
  maxSupply: '1000000000',
  standard: 'ERC-20',
  contract: process.env.FORGE_TOKEN_ADDRESS || null,
  chains: ['ethereum', 'base'],
  plannedChains: ['polygon', 'arbitrum', 'solana', 'multiversx'],
  allocation: {
    community: 0.40,
    treasury: 0.20,
    team: 0.15,
    liquidity: 0.10,
    staking: 0.10,
    partners: 0.05,
  },
  stakingTiers: {
    bronze: { min: 1000, models: 5, queue: 'standard' },
    silver: { min: 10000, models: 7, queue: 'priority' },
    gold: { min: 100000, models: 13, queue: 'dedicated' },
    platinum: { min: 1000000, models: 20, queue: 'custom' },
  },
  revenueShare: {
    stakers: 0.20,
    treasury: 0.30,
    development: 0.20,
    buybackBurn: 0.15,
    community: 0.15,
  },
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  // Public endpoint: basic token info (no auth required)
  if (!action || action === 'info') {
    return NextResponse.json({
      token: TOKEN_INFO,
      links: {
        tokenPage: '/token',
        aiModels: '/ai-models',
        dashboard: '/dashboard',
      },
    });
  }

  // Auth required for marketing content
  const denied = await requireAuth(req);
  if (denied) return denied;

  if (action === 'content') {
    const category = url.searchParams.get('category') as TokenContentCategory | null;
    const posts = getTokenMarketingPosts(category || undefined);
    return NextResponse.json({ posts, stats: getTokenContentStats() });
  }

  if (action === 'random') {
    const category = url.searchParams.get('category') as TokenContentCategory | null;
    const post = getRandomTokenPost(category || undefined);
    const formatted = formatForX(post);
    return NextResponse.json({ post, formatted });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function POST(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  const body = await req.json();
  const { category, dryRun = true } = body;

  const post = getRandomTokenPost(category || undefined);
  const formatted = formatForX(post);

  if (dryRun) {
    return NextResponse.json({
      status: 'dry_run',
      post,
      formatted,
      message: 'Set dryRun: false to post to X',
    });
  }

  // Delegate to X automation endpoint
  try {
    const baseUrl = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const secret = process.env.X_AUTOMATION_SECRET || process.env.ALERT_SECRET || '';

    const res = await fetch(`${baseUrl}/api/x/automation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': secret,
      },
      body: JSON.stringify({
        dryRun: false,
        force: true,
        trend: formatted.text,
      }),
    });

    const result = await res.json();
    return NextResponse.json({
      status: 'posted',
      post,
      xResult: result,
    });
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      post,
      error: String(err),
    }, { status: 500 });
  }
}
