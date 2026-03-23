import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/apiGuard';
import {
  getTradingMode, getRiskLimits, getTradeLog,
  getDailyPnL, getAggregatedPortfolio, getExchangeStatus,
  isKillSwitchActive, setKillSwitch,
} from '@/lib/trading/engine';

export async function GET(request: Request) {
  try {
    const denied = await requireAuth(request);
    if (denied) return denied;

    const [portfolio] = await Promise.allSettled([getAggregatedPortfolio()]);

    return NextResponse.json({
      status: 'ok',
      mode: getTradingMode(),
      exchanges: getExchangeStatus(),
      riskLimits: getRiskLimits(),
      portfolio: portfolio.status === 'fulfilled' ? portfolio.value : { balances: [], totalUSD: 0, mining: null },
      recentTrades: getTradeLog(20),
      dailyPnL: getDailyPnL(),
      killSwitch: isKillSwitchActive(),
      timestamp: Date.now(),
    });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const denied = await requireAuth(request);
    if (denied) return denied;

    const body = await request.json();

    if (body.action === 'killswitch') {
      setKillSwitch(!!body.active);
      return NextResponse.json({ status: 'ok', killSwitch: isKillSwitchActive() });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ status: 'error', error: err instanceof Error ? err.message : 'unknown' }, { status: 500 });
  }
}
