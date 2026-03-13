/**
 * Platforms Status API — Health status for all integrated financial platforms.
 * GET /api/status/platforms
 *
 * Returns health and configuration status for:
 *  - MultiversX (xPortal EGLD wallet)
 *  - Solana (DeFi)
 *  - Kalshi / Augur / Overtime (prediction markets)
 *  - Plaid (fiat banking rails)
 *  - Alpaca / IBKR (equities/forex)
 *  - Multi-chain DeFi (yields, flash loans)
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function safeImport<T>(modulePath: string): Promise<T | null> {
  try {
    return require(modulePath);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const platforms: Record<string, unknown> = {};

  // ─── MultiversX ─────────────────────────────────────────────────
  try {
    const mvx = await safeImport<any>('@/lib/multiversx/client');
    if (mvx && process.env.MVX_WALLET_ADDRESS) {
      const client = mvx.getMultiversXClient();
      platforms.multiversx = await client.getHealth();
    } else {
      platforms.multiversx = {
        status: process.env.MVX_WALLET_ADDRESS ? 'module_unavailable' : 'not_configured',
        configured: !!process.env.MVX_WALLET_ADDRESS,
      };
    }
  } catch (err: any) {
    platforms.multiversx = { status: 'error', error: err.message };
  }

  // ─── Solana ─────────────────────────────────────────────────────
  try {
    const sol = await safeImport<any>('@/lib/defi/solana-client');
    if (sol && process.env.SOLANA_WALLET_ADDRESS) {
      const client = sol.getSolanaClient();
      platforms.solana = await client.getHealth();
    } else {
      platforms.solana = {
        status: process.env.SOLANA_WALLET_ADDRESS ? 'module_unavailable' : 'not_configured',
        configured: !!process.env.SOLANA_WALLET_ADDRESS,
      };
    }
  } catch (err: any) {
    platforms.solana = { status: 'error', error: err.message };
  }

  // ─── Multi-Chain DeFi ───────────────────────────────────────────
  try {
    const defi = await safeImport<any>('@/lib/defi/multichain-engine');
    if (defi) {
      const engine = defi.getMultiChainDeFiEngine();
      platforms.defiMultichain = await engine.getHealth();
    } else {
      platforms.defiMultichain = { status: 'module_unavailable' };
    }
  } catch (err: any) {
    platforms.defiMultichain = { status: 'error', error: err.message };
  }

  // ─── Kalshi ─────────────────────────────────────────────────────
  try {
    const kalshi = await safeImport<any>('@/lib/predictions/kalshi/client');
    if (kalshi && process.env.KALSHI_API_KEY) {
      const client = new kalshi.KalshiClient();
      platforms.kalshi = await client.getHealth();
    } else {
      platforms.kalshi = {
        status: process.env.KALSHI_API_KEY ? 'module_unavailable' : 'not_configured',
        configured: !!process.env.KALSHI_API_KEY,
      };
    }
  } catch (err: any) {
    platforms.kalshi = { status: 'error', error: err.message };
  }

  // ─── Overtime ───────────────────────────────────────────────────
  try {
    const overtime = await safeImport<any>('@/lib/predictions/overtime/client');
    if (overtime) {
      const client = new overtime.OvertimeClient();
      platforms.overtime = await client.getHealth();
    } else {
      platforms.overtime = { status: 'module_unavailable' };
    }
  } catch (err: any) {
    platforms.overtime = { status: 'error', error: err.message };
  }

  // ─── Augur ──────────────────────────────────────────────────────
  try {
    const augur = await safeImport<any>('@/lib/predictions/augur/client');
    if (augur) {
      const client = new augur.AugurClient();
      platforms.augur = await client.getHealth();
    } else {
      platforms.augur = { status: 'module_unavailable' };
    }
  } catch (err: any) {
    platforms.augur = { status: 'error', error: err.message };
  }

  // ─── Plaid (Fiat) — disabled for now, no team account ─────────
  platforms.plaid = { status: 'disabled', note: 'Plaid integration paused — personal tier only' };

  // ─── Alpaca ─────────────────────────────────────────────────────
  platforms.alpaca = {
    status: process.env.ALPACA_API_KEY ? 'configured' : 'not_configured',
    enabled: process.env.ALPACA_ENABLED === 'true',
    dryRun: process.env.ALPACA_DRY_RUN !== 'false',
    symbols: process.env.ALPACA_SYMBOLS || 'SPY,QQQ,AAPL,MSFT,NVDA',
    baseUrl: process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets',
  };

  // ─── Interactive Brokers ────────────────────────────────────────
  platforms.ibkr = {
    status: process.env.IBKR_ACCOUNT_ID ? 'configured' : 'not_configured',
    enabled: process.env.IBKR_ENABLED === 'true',
    dryRun: process.env.IBKR_DRY_RUN !== 'false',
    symbols: process.env.IBKR_SYMBOLS || 'AAPL,MSFT,GOOGL,AMZN,NVDA,SPY,QQQ',
    gatewayUrl: process.env.IBKR_GATEWAY_URL || 'https://localhost:5000',
  };

  // ─── Summary ────────────────────────────────────────────────────
  const statusCounts = Object.values(platforms).reduce(
    (acc: Record<string, number>, p: any) => {
      const s = p?.status || 'unknown';
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    platforms,
    summary: {
      total: Object.keys(platforms).length,
      ...statusCounts,
    },
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
