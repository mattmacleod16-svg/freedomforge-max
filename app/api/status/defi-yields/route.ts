/**
 * DeFi Yields API — Cross-chain yield comparison.
 * GET /api/status/defi-yields
 *
 * Returns best yield opportunities across Ethereum, Base, Solana, MultiversX.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const defi = require('@/lib/defi/multichain-engine');
    const engine = defi.getMultiChainDeFiEngine();

    const [bestYields, flashLoanOpps, portfolio, health] = await Promise.allSettled([
      engine.getBestYields(2, 30),
      engine.detectFlashLoanOpportunities(),
      engine.getPortfolioSummary(),
      engine.getHealth(),
    ]);

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      yields: bestYields.status === 'fulfilled' ? bestYields.value : [],
      flashLoanOpportunities: flashLoanOpps.status === 'fulfilled' ? flashLoanOpps.value : [],
      portfolio: portfolio.status === 'fulfilled' ? portfolio.value : null,
      health: health.status === 'fulfilled' ? health.value : null,
      protocols: Object.keys(defi.PROTOCOLS).length,
      flashLoanProviders: Object.keys(defi.FLASH_LOAN_PROVIDERS).length,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      error: err.message,
      yields: [],
    }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
