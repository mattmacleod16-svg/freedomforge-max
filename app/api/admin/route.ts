/**
 * Admin Stats API
 * GET /api/admin — returns admin metrics and system overview (requires auth)
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/apiGuard';
import { getImpactFundSummary } from '@/lib/impact-fund/solanaImpactFund';
import { getGrantRLAgent } from '@/lib/grant-navigator/ppoRlAgent';
import { getIBCv2Client } from '@/lib/ibc/ibcV2Client';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const impactFund = getImpactFundSummary();
    const rlAgent    = getGrantRLAgent();
    const rlStats    = rlAgent.getStats();
    const ibcClient  = getIBCv2Client();
    const ibcSummary = ibcClient.getSummary();

    // Collect basic system metrics
    const uptime   = process.uptime();
    const memUsage = process.memoryUsage();

    return NextResponse.json({
      system: {
        uptime,
        memoryMb: Math.round(memUsage.rss / 1024 / 1024),
        nodeVersion: process.version,
        env: process.env.NODE_ENV || 'development',
      },
      grantNavigator: {
        rlAgent: rlStats,
        grokModelActive: Boolean(process.env.XAI_API_KEY || process.env.GROK_API_KEY),
      },
      impactFund: {
        totalAllocatedUsd:  impactFund.totalAllocatedUsd,
        totalConfirmedUsd:  impactFund.totalConfirmedUsd,
        totalPendingUsd:    impactFund.totalPendingUsd,
        allocationCount:    impactFund.allocationCount,
        walletAddress:      impactFund.walletAddress,
        walletUrl:          impactFund.walletUrl,
        impactBps:          1000,
      },
      ibc: ibcSummary,
      billing: {
        stripeConfigured:      Boolean(process.env.STRIPE_SECRET_KEY),
        revenueCatConfigured:  Boolean(process.env.REVENUECAT_API_KEY),
        webhookConfigured:     Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      },
      config: {
        siteUrl:     process.env.NEXT_PUBLIC_SITE_URL || 'https://freedomforge.one',
        cause:       'Forest Acres / Columbia SC Economic Mobility (501(c)(3))',
        fundTarget:  'Transparent 10% on-chain allocation via Solana',
      },
    });
  } catch (err) {
    console.error('[api/admin] error', err);
    return NextResponse.json({ error: 'Failed to load admin stats' }, { status: 500 });
  }
}
