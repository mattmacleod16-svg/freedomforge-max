/**
 * Impact Fund API
 * GET  /api/impact-fund          — get fund summary and recent allocations
 * POST /api/impact-fund          — record a new revenue allocation
 */
import { NextResponse } from 'next/server';
import {
  getImpactFundSummary,
  getRecentAllocations,
  recordRevenueAllocation,
  getImpactWalletBalance,
} from '@/lib/impact-fund/solanaImpactFund';
import { getIBCv2Client } from '@/lib/ibc/ibcV2Client';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const summary = getImpactFundSummary();
    const recent  = getRecentAllocations(20);
    const ibcClient = getIBCv2Client();
    const ibcSummary = ibcClient.getSummary();

    // Optionally fetch live wallet balance
    const walletBalance = await getImpactWalletBalance().catch((err) => {
      console.error('[api/impact-fund] wallet balance fetch failed', err);
      return null;
    });

    return NextResponse.json({
      fund: {
        ...summary,
        walletBalanceSol: walletBalance,
      },
      recentAllocations: recent,
      ibc: ibcSummary,
      impactBps: 1000,
      impactPct: 10,
      cause: 'Forest Acres / Columbia SC Economic Mobility (501(c)(3))',
    });
  } catch (err) {
    console.error('[api/impact-fund] error', err);
    return NextResponse.json({ error: 'Failed to load impact fund data' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // Require internal auth (Bearer token or session)
    const authHeader = req.headers.get('authorization');
    const apiSecret  = (process.env.ALERT_SECRET || '').trim();
    if (apiSecret) {
      const bearer = authHeader?.replace(/^Bearer\s+/i, '') || '';
      if (bearer !== apiSecret) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
    }

    const body = await req.json() as {
      revenueSourceId?: string;
      grossAmountUsd?: number;
      cause?: string;
      solanaSignature?: string;
    };

    if (!body.revenueSourceId || typeof body.grossAmountUsd !== 'number') {
      return NextResponse.json({ error: 'revenueSourceId and grossAmountUsd required' }, { status: 400 });
    }

    const allocation = recordRevenueAllocation({
      revenueSourceId: body.revenueSourceId,
      grossAmountUsd:  body.grossAmountUsd,
      cause:           body.cause,
      solanaSignature: body.solanaSignature,
    });

    return NextResponse.json({ ok: true, allocation });
  } catch (err) {
    console.error('[api/impact-fund] POST error', err);
    return NextResponse.json({ error: 'Failed to record allocation' }, { status: 500 });
  }
}
