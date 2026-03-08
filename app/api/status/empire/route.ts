/**
 * Empire Status API — Aggregates ALL trading data for the command center dashboard.
 * GET /api/status/empire
 */

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function readJsonSafe(filePath: string) {
  try {
    const abs = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(abs)) return null;
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch { return null; }
}

export async function GET() {
  try {
    // ─── Trade Journal ─────────────────────────────────────────────────
    const journal = readJsonSafe('data/trade-journal.json');
    const trades = Array.isArray(journal?.trades) ? journal.trades : [];
    const strategy = journal?.strategyEvolution || null;

    // Compute trade stats
    const closedTrades = trades.filter((t: any) => t.outcome);
    const wins = closedTrades.filter((t: any) => t.outcome === 'win');
    const losses = closedTrades.filter((t: any) => t.outcome === 'loss');
    const totalPnl = closedTrades.reduce((s: number, t: any) => s + (t.pnl || 0), 0);
    const totalFees = trades.reduce((s: number, t: any) => s + (t.fees || 0), 0);
    const winRate = closedTrades.length > 0 ? wins.length / closedTrades.length : 0;

    // Compute per-venue stats
    const venueStats: Record<string, any> = {};
    for (const t of trades) {
      const v = t.venue || 'unknown';
      if (!venueStats[v]) venueStats[v] = { trades: 0, pnl: 0, volume: 0, wins: 0, losses: 0 };
      venueStats[v].trades++;
      venueStats[v].volume += t.usdSize || 0;
      if (t.outcome === 'win') venueStats[v].wins++;
      if (t.outcome === 'loss') venueStats[v].losses++;
      venueStats[v].pnl += t.pnl || 0;
    }

    // Per-asset stats
    const assetStats: Record<string, any> = {};
    for (const t of trades) {
      const a = t.asset || 'UNKNOWN';
      if (!assetStats[a]) assetStats[a] = { trades: 0, pnl: 0, volume: 0, avgConfidence: 0, totalConf: 0 };
      assetStats[a].trades++;
      assetStats[a].volume += t.usdSize || 0;
      assetStats[a].pnl += t.pnl || 0;
      assetStats[a].totalConf += t.signal?.confidence || 0;
      assetStats[a].avgConfidence = assetStats[a].totalConf / assetStats[a].trades;
    }

    // Trade timeline (for charts)
    const tradeTimeline = trades.map((t: any) => ({
      ts: t.entryTs,
      time: t.entryAt,
      asset: t.asset,
      venue: t.venue,
      side: t.side,
      usdSize: t.usdSize,
      confidence: t.signal?.confidence,
      edge: t.signal?.edge,
      pnl: t.pnl,
      outcome: t.outcome,
      dryRun: t.dryRun,
    }));

    // ─── Guardian State ────────────────────────────────────────────────
    const guardian = readJsonSafe('data/liquidation-guardian-state.json');
    const guardianSummary = {
      lastCheck: guardian?.lastCheck || 0,
      coinbase: {
        marginPct: guardian?.coinbase?.marginPct || 0,
        liquidationBuffer: guardian?.coinbase?.liquidationBuffer || 0,
        totalBalance: guardian?.coinbase?.totalBalance || 0,
        initialMargin: guardian?.coinbase?.initialMargin || 0,
        unrealizedPnl: guardian?.coinbase?.unrealizedPnl || 0,
        positions: guardian?.coinbase?.positions || [],
        healthy: guardian?.coinbase?.healthy !== false,
      },
      kraken: {
        marginPct: guardian?.kraken?.marginPct || 0,
        equity: guardian?.kraken?.equity || 0,
        marginUsed: guardian?.kraken?.marginUsed || 0,
        freeMargin: guardian?.kraken?.freeMargin || 0,
        unrealizedPnl: guardian?.kraken?.unrealizedPnl || 0,
        positions: guardian?.kraken?.positions || [],
        healthy: guardian?.kraken?.healthy !== false,
      },
      emergencyCloses: guardian?.emergencyCloses || 0,
      blockedTrades: guardian?.blockedTrades || 0,
      actions: (guardian?.actions || []).slice(-10),
    };

    // ─── Risk Manager ──────────────────────────────────────────────────
    const risk = readJsonSafe('data/risk-manager-state.json');
    const riskSummary = {
      killSwitchActive: risk?.killSwitchActive || false,
      peakEquity: risk?.peakEquity || 0,
      currentEquity: risk?.currentEquity || 0,
      drawdownPct: risk?.peakEquity > 0
        ? ((risk.peakEquity - (risk.currentEquity || 0)) / risk.peakEquity) * 100
        : 0,
      dailyPnl: risk?.dailyPnl || { date: '', pnl: 0 },
      positions: Object.keys(risk?.positions || {}).length,
      recentEvents: (risk?.riskEvents || []).slice(-5),
    };

    // ─── Signal Bus ────────────────────────────────────────────────────
    const busData = readJsonSafe('data/agent-signal-bus.json');
    const signals = Array.isArray(busData?.signals) ? busData.signals : (Array.isArray(busData) ? busData : []);
    const now = Date.now();
    const activeSignals = signals.filter((s: any) => {
      if (s.expiresAt && s.expiresAt < now) return false;
      if (s.publishedAt && s.ttlMs && (s.publishedAt + s.ttlMs < now)) return false;
      return true;
    });
    const signalTypes: Record<string, number> = {};
    const signalSources: Record<string, number> = {};
    for (const s of activeSignals) {
      const t = s.type || 'unknown';
      const src = s.source || 'unknown';
      signalTypes[t] = (signalTypes[t] || 0) + 1;
      signalSources[src] = (signalSources[src] || 0) + 1;
    }

    // ─── Orchestrator State ────────────────────────────────────────────
    const orchState = readJsonSafe('data/orchestrator-state.json');
    const orchestrator = {
      cycleCount: orchState?.cycleCount || 0,
      totalTrades: orchState?.totalTrades || 0,
      lastRun: orchState?.lastRunAt ? new Date(orchState.lastRunAt).toISOString() : null,
      errors: (orchState?.errors || []).slice(-5),
    };

    // ─── Brain State ───────────────────────────────────────────────────
    const brainState = readJsonSafe('data/self-evolving-brain.json');
    const brain = brainState ? {
      generation: brainState.generation || 0,
      lastEvolved: brainState.lastEvolvedAt || null,
      topIndicators: Object.entries(brainState.indicatorWeights || {})
        .sort((a: any, b: any) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, v]: any) => ({ indicator: k, weight: v })),
      assetProfiles: Object.keys(brainState.assetProfiles || {}).length,
      confidenceCalibration: brainState.confidenceCalibration || null,
    } : null;

    // ─── Scaler State ──────────────────────────────────────────────────
    const scalerState = readJsonSafe('data/horizontal-scaler-state.json');
    const scaler = scalerState ? {
      activeAssets: scalerState.activeAssets || [],
      candidateCount: Object.keys(scalerState.candidates || {}).length,
      promotions: scalerState.promotionHistory?.length || 0,
      demotions: scalerState.demotionHistory?.length || 0,
      lastScan: scalerState.lastScanAt ? new Date(scalerState.lastScanAt).toISOString() : null,
    } : null;

    // ─── Venue Performance ─────────────────────────────────────────────
    const venuePerf = readJsonSafe('data/venue-performance-state.json');

    // ─── Portfolio Totals ──────────────────────────────────────────────
    const cbBalance = guardianSummary.coinbase.totalBalance;
    const krBalance = guardianSummary.kraken.equity;
    const totalPortfolioUsd = cbBalance + krBalance;
    const totalUnrealizedPnl = guardianSummary.coinbase.unrealizedPnl + guardianSummary.kraken.unrealizedPnl;

    // ─── Capital Mandate ───────────────────────────────────────────────
    const mandateState = readJsonSafe('data/capital-mandate-state.json');
    const mandate = mandateState ? {
      initialCapital: mandateState.initialCapital || 508,
      highWaterMark: mandateState.highWaterMark || 0,
      lowWaterMark: mandateState.lowWaterMark || 0,
      currentMode: mandateState.currentMode || 'normal',
      milestonesReached: mandateState.milestonesReached || [],
      totalDaysActive: mandateState.totalDaysActive || 0,
      consecutiveWinDays: mandateState.consecutiveWinDays || 0,
      consecutiveLossDays: mandateState.consecutiveLossDays || 0,
      tradeDenials: mandateState.tradeDenials || 0,
      capitalHaltEvents: mandateState.capitalHaltEvents || 0,
      survivalModeEntries: mandateState.survivalModeEntries || 0,
      growthModeEntries: mandateState.growthModeEntries || 0,
      dailySnapshots: (mandateState.dailyCapitalSnapshots || []).slice(-30),
      modeTransitions: (mandateState.modeTransitions || []).slice(-10),
      roiPct: mandateState.initialCapital > 0
        ? ((totalPortfolioUsd - mandateState.initialCapital) / mandateState.initialCapital) * 100
        : 0,
      message: 'ZERO INJECTION PROTOCOL — Self-sufficient or bust.',
    } : null;

    // Compute cumulative P&L history from trades
    let runningPnl = 0;
    const pnlHistory = trades.map((t: any) => {
      runningPnl += (t.pnl || 0);
      return { ts: t.entryTs, time: t.entryAt, cumPnl: runningPnl, pnl: t.pnl || 0 };
    });

    // Volume by day
    const volByDay: Record<string, number> = {};
    for (const t of trades) {
      const day = (t.entryAt || '').slice(0, 10);
      if (day) volByDay[day] = (volByDay[day] || 0) + (t.usdSize || 0);
    }

    // Confidence distribution
    const confBuckets = [0, 0, 0, 0, 0]; // 50-60, 60-70, 70-80, 80-90, 90-100
    for (const t of trades) {
      const c = (t.signal?.confidence || 0) * 100;
      if (c >= 90) confBuckets[4]++;
      else if (c >= 80) confBuckets[3]++;
      else if (c >= 70) confBuckets[2]++;
      else if (c >= 60) confBuckets[1]++;
      else confBuckets[0]++;
    }

    return NextResponse.json({
      ts: new Date().toISOString(),
      portfolio: {
        totalUsd: totalPortfolioUsd,
        coinbaseUsd: cbBalance,
        krakenUsd: krBalance,
        unrealizedPnl: totalUnrealizedPnl,
        realizedPnl: totalPnl,
        totalFees: totalFees,
        netPnl: totalPnl - totalFees,
      },
      trades: {
        total: trades.length,
        closed: closedTrades.length,
        wins: wins.length,
        losses: losses.length,
        winRate,
        totalPnl,
        avgPnl: closedTrades.length > 0 ? totalPnl / closedTrades.length : 0,
        totalVolume: trades.reduce((s: number, t: any) => s + (t.usdSize || 0), 0),
        dryRunCount: trades.filter((t: any) => t.dryRun).length,
        liveCount: trades.filter((t: any) => !t.dryRun).length,
      },
      venueStats,
      assetStats,
      tradeTimeline,
      pnlHistory,
      volumeByDay: volByDay,
      confidenceDistribution: {
        labels: ['50-60%', '60-70%', '70-80%', '80-90%', '90-100%'],
        values: confBuckets,
      },
      guardian: guardianSummary,
      risk: riskSummary,
      signalBus: {
        totalActive: activeSignals.length,
        types: signalTypes,
        sources: signalSources,
      },
      orchestrator,
      brain,
      scaler,
      venuePerformance: venuePerf,
      strategy,
      mandate,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Empire status failed' },
      { status: 500 }
    );
  }
}
