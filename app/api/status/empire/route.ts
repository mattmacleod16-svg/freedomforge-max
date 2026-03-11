/**
 * Empire Status API — Aggregates ALL trading data for the command center dashboard.
 * GET /api/status/empire
 *
 * When running on Vercel (no local data/), proxies to the Oracle VM via
 * the ORACLE_API_URL env var (cloudflare tunnel URL).
 */

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ─── VM Proxy (Vercel → Oracle Cloud) — Hardened with retry + backoff ──── */

/** Simple in-memory circuit breaker for the Vercel → VM path */
let vmCircuit = { failures: 0, lastFailure: 0, status: 'CLOSED' as 'CLOSED' | 'OPEN' | 'HALF_OPEN' };
const VM_CB_THRESHOLD = 3;
const VM_CB_RESET_MS = 90_000; // 90s cooldown when circuit opens

async function proxyToVM(): Promise<Response | null> {
  const vmUrl = process.env.ORACLE_API_URL;
  if (!vmUrl) return null;

  // ── Circuit breaker check ─────────────────────────────────────────
  if (vmCircuit.status === 'OPEN') {
    if (Date.now() - vmCircuit.lastFailure > VM_CB_RESET_MS) {
      vmCircuit.status = 'HALF_OPEN'; // Allow one probe
    } else {
      return null; // Fast-fail — don't waste 12 s per request when VM is down
    }
  }

  const target = `${vmUrl.replace(/\/$/, '')}/api/status/empire`;
  const MAX_ATTEMPTS = 2; // 1 initial + 1 retry
  const TIMEOUT_MS = 12_000;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(target, {
          headers: { 'Accept': 'application/json' },
          signal: controller.signal,
          cache: 'no-store',
        });
        clearTimeout(timer);

        if (!res.ok) {
          // 5xx → retry; 4xx → don't
          if (res.status >= 500 && attempt < MAX_ATTEMPTS - 1) {
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }
          recordVmFailure();
          return null;
        }

        const data = await res.json();
        // Validate the proxied data is real (not empty)
        if (data && data.portfolio && (data.portfolio.totalUsd > 0 || data.trades?.total > 0)) {
          recordVmSuccess();
          return NextResponse.json(data, {
            headers: {
              'Cache-Control': 'no-store',
              'X-Data-Source': 'oracle-vm',
              'X-VM-Circuit': vmCircuit.status,
            },
          });
        }
        recordVmFailure();
        return null;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise(r => setTimeout(r, 1000)); // 1s before retry
        continue;
      }
      recordVmFailure();
      return null;
    }
  }
  return null;
}

function recordVmSuccess() {
  vmCircuit.failures = 0;
  vmCircuit.status = 'CLOSED';
}

function recordVmFailure() {
  vmCircuit.failures++;
  vmCircuit.lastFailure = Date.now();
  if (vmCircuit.failures >= VM_CB_THRESHOLD) {
    vmCircuit.status = 'OPEN';
  }
}

/* ─── Check if we have live local data ──────────────────────────────────── */
function hasLocalData(): boolean {
  const orchPath = path.resolve(process.cwd(), 'data/orchestrator-state.json');
  const guardianPath = path.resolve(process.cwd(), 'data/liquidation-guardian-state.json');
  const STALE_MS = 30 * 60 * 1000; // 30 minutes
  try {
    // Need at least one state file to exist
    const orchExists = fs.existsSync(orchPath);
    const guardianExists = fs.existsSync(guardianPath);
    if (!orchExists && !guardianExists) return false;

    // Check orchestrator staleness if it exists
    if (orchExists) {
      const orch = JSON.parse(fs.readFileSync(orchPath, 'utf8'));
      const age = Date.now() - (orch.lastRunAt || 0);
      if (age > STALE_MS) return false;
    }

    // Check guardian staleness if it exists (catches Vercel deploys with stale data/)
    if (guardianExists && !orchExists) {
      const guardian = JSON.parse(fs.readFileSync(guardianPath, 'utf8'));
      const age = Date.now() - (guardian.lastCheck || 0);
      if (age > STALE_MS) return false;
    }

    return true;
  } catch {
    return false;
  }
}

function readJsonSafe(filePath: string) {
  try {
    const abs = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(abs)) return null;
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch { return null; }
}

/* ─── Agent Roster Builder ──────────────────────────────────────────────── */
function agentStatus(lastTs: number | string | null | undefined, staleMinutes = 30): 'active' | 'idle' | 'error' {
  if (!lastTs) return 'idle';
  const ms = typeof lastTs === 'string' ? new Date(lastTs).getTime() : lastTs;
  if (isNaN(ms)) return 'idle';
  const age = Date.now() - ms;
  if (age < staleMinutes * 60 * 1000) return 'active';
  return 'idle';
}

function buildAgentRoster(
  orch: any, brain: any, scaler: any, guardian: any,
  risk: any, signalBus: any, watchdog: any, trades: any[],
) {
  const roles: Array<{
    role: string; icon: string; agents: Array<{ name: string; status: string; detail: string }>;
  }> = [
    {
      role: 'Command & Control',
      icon: '⬡',
      agents: [
        { name: 'Master Orchestrator', status: agentStatus(orch?.lastRunAt, 20), detail: `Cycle #${orch?.cycleCount || 0}` },
        { name: 'Watchdog', status: agentStatus(watchdog?.checkedAt || watchdog?.ts, 10), detail: 'Self-healing monitor' },
      ],
    },
    {
      role: 'Trade Execution',
      icon: '◈',
      agents: [
        { name: 'Coinbase Trade Loop', status: 'active', detail: 'Spot + margin' },
        { name: 'Kraken Trade Loop', status: 'active', detail: 'Spot + margin' },
        { name: 'Polymarket Trade Loop', status: 'active', detail: 'Prediction markets' },
        { name: 'Edge Scanner Loop', status: 'active', detail: 'Opportunity hunter' },
        { name: 'Venue Engine Loop', status: 'active', detail: 'Smart routing' },
      ],
    },
    {
      role: 'Risk & Safety',
      icon: '◆',
      agents: [
        { name: 'Liquidation Guardian', status: agentStatus(guardian?.lastCheck, 20), detail: `Blocks: ${guardian?.blockedTrades || 0}` },
        { name: 'Risk Manager', status: risk?.killSwitchActive ? 'error' : 'active', detail: risk?.killSwitchActive ? '■ KILL SWITCH' : `DD: ${((risk?.peakEquity > 0 ? ((risk.peakEquity - (risk.currentEquity || 0)) / risk.peakEquity) * 100 : 0)).toFixed(1)}%` },
        { name: 'Trade Reconciler', status: agentStatus(orch?.lastRunAt, 20), detail: `${trades.filter((t: any) => t.outcome).length} closed` },
        { name: 'Capital Mandate', status: 'active', detail: 'Zero injection' },
      ],
    },
    {
      role: 'Intelligence',
      icon: '◎',
      agents: [
        { name: 'Self-Evolving Brain', status: agentStatus(brain?.lastEvolvedAt, 60), detail: `Gen ${brain?.generation || 0}` },
        { name: 'Signal Bus', status: 'active', detail: `${Array.isArray(signalBus?.signals) ? signalBus.signals.length : (Array.isArray(signalBus) ? signalBus.length : 0)} signals` },
        { name: 'Horizontal Scaler', status: agentStatus(scaler?.lastScanAt, 60), detail: `${(scaler?.activeAssets || []).length} assets` },
        { name: 'Edge Scanner', status: 'active', detail: 'Pattern detection' },
      ],
    },
    {
      role: 'Operations',
      icon: '◇',
      agents: [
        { name: 'Daily KPI Reporter', status: 'active', detail: 'Daily summary' },
        { name: 'Continuous Learner', status: 'active', detail: 'Strategy tuning' },
        { name: 'Monthly Strategist', status: 'active', detail: 'Long-term plan' },
        { name: 'Geopolitical Watch', status: 'active', detail: 'Macro monitor' },
        { name: 'Treasury Ledger', status: agentStatus(readJsonSafe('data/treasury-ledger.json')?.updatedAt, 30), detail: 'Lifetime P&L tracking' },
      ],
    },
  ];

  const total = roles.reduce((s, r) => s + r.agents.length, 0);
  const activeCount = roles.reduce((s, r) => s + r.agents.filter(a => a.status === 'active').length, 0);

  return { total, active: activeCount, roles };
}

export async function GET() {
  try {
    // ─── Proxy to VM if running on Vercel (no local data) ──────────────
    if (!hasLocalData()) {
      const proxied = await proxyToVM();
      if (proxied) return proxied;
      // Fall through to local read (even if stale) as last resort
    }

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
        availableMargin: guardian?.coinbase?.availableMargin || 0,
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
      generation: brainState.totalEvolutions || brainState.generation || 0,
      lastEvolved: brainState.updatedAt || brainState.lastEvolvedAt || null,
      topIndicators: Object.entries(brainState.weights || brainState.indicatorWeights || {})
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

    // ─── Agent Roster ──────────────────────────────────────────────────
    const watchdog = readJsonSafe('data/watchdog-alerts.json');
    const agentRoster = buildAgentRoster(orchState, brainState, scalerState, guardian, risk, busData, watchdog, trades);

    // ─── Portfolio Totals ──────────────────────────────────────────────
    const cbBalance = guardianSummary.coinbase.totalBalance;
    const krBalance = guardianSummary.kraken.equity;
    const totalPortfolioUsd = cbBalance + krBalance;
    const totalUnrealizedPnl = guardianSummary.coinbase.unrealizedPnl + guardianSummary.kraken.unrealizedPnl;

    // ─── Open Positions Breakdown ──────────────────────────────────────
    // Use exchange-reported margin/positions as truth source (live values).
    // Fall back to trade journal for additional context.
    const openTrades = trades.filter((t: any) => !t.outcome);

    // Use exchange-reported available capital for accurate deployed calculation.
    // Journal usdSize is entry-time notional — event contracts lose/gain value,
    // creating phantom capital if we sum stale journal values.
    // Available margin / free margin are real-time from the exchange.
    const cbAvailable = guardianSummary.coinbase.availableMargin;
    const krFree = guardianSummary.kraken.freeMargin;

    // Deployed = balance minus what the exchange says is available
    const cbDeployed = cbAvailable > 0 ? Math.max(0, cbBalance - cbAvailable) : guardianSummary.coinbase.initialMargin;
    const krDeployed = krFree > 0 ? Math.max(0, krBalance - krFree) : guardianSummary.kraken.marginUsed;

    // Standby = what the exchange says is free to trade
    const cbStandby = cbAvailable > 0 ? cbAvailable : Math.max(0, cbBalance - cbDeployed);
    const krStandby = krFree > 0 ? krFree : Math.max(0, krBalance - krDeployed);

    // Merge guardian exchange positions + journal openness for dashboard detail
    const exchangePositions = [
      ...(guardianSummary.coinbase.positions || []).map((p: any) => ({
        asset: (p.productId || '').replace(/-.*/, ''),
        venue: 'coinbase',
        side: p.side || 'long',
        usdSize: Math.abs(p.unrealizedPnl || 0) > 0 ? Math.abs(p.contracts || 0) : 0, // placeholder, real notional below
        entryPrice: 0,
        entryAt: null,
        confidence: 0,
        edge: 0,
        dryRun: false,
        unrealizedPnl: p.unrealizedPnl || 0,
        contracts: p.contracts || 0,
        productId: p.productId || '',
        source: 'exchange',
      })),
      ...(guardianSummary.kraken.positions || []).map((p: any) => ({
        asset: (p.pair || '').replace(/USD.*/, ''),
        venue: 'kraken',
        side: p.type || 'long',
        usdSize: p.cost || 0,
        entryPrice: p.avgPrice || 0,
        entryAt: null,
        confidence: 0,
        edge: 0,
        dryRun: false,
        unrealizedPnl: p.unrealizedPnl || p.net || 0,
        source: 'exchange',
      })),
    ];

    // Combine: exchange positions (live) + journal-only positions (non-margin)
    const journalOnlyPositions = openTrades
      .filter((t: any) => !exchangePositions.some((e: any) =>
        e.asset === t.asset && e.venue.startsWith(t.venue?.split('_')[0] || '')))
      .map((t: any) => ({
        asset: t.asset || 'UNKNOWN',
        venue: t.venue || 'unknown',
        side: t.side || '—',
        usdSize: t.usdSize || 0,
        entryPrice: t.entryPrice || 0,
        entryAt: t.entryAt || null,
        confidence: t.signal?.confidence || 0,
        edge: t.signal?.edge || 0,
        dryRun: !!t.dryRun,
        source: 'journal',
      }));

    const openPositions = [...exchangePositions, ...journalOnlyPositions];

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
        // Positions vs standby breakdown
        coinbaseDeployed: cbDeployed,
        coinbaseStandby: cbStandby,
        krakenDeployed: krDeployed,
        krakenStandby: krStandby,
        totalDeployed: cbDeployed + krDeployed,
        totalStandby: cbStandby + krStandby,
        openPositionCount: openTrades.length,
        openPositions,
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
      treasury: (() => {
        const tl = readJsonSafe('data/treasury-ledger.json');
        if (!tl) return null;
        const winRate = tl.lifetimeTrades > 0 ? Math.round(tl.lifetimeWins / tl.lifetimeTrades * 100 * 10) / 10 : 0;
        const profitFactor = tl.lifetimeGrossLoss > 0 ? Math.round(tl.lifetimeGrossProfit / tl.lifetimeGrossLoss * 100) / 100 : 0;
        const roi = tl.initialCapital > 0 ? Math.round(tl.lifetimePnl / tl.initialCapital * 100 * 100) / 100 : 0;
        // Use live guardian capital if treasury is stale (>10 min)
        const treasuryAge = Date.now() - (tl.updatedAt || 0);
        const liveCapital = totalPortfolioUsd > 0 && treasuryAge > 10 * 60 * 1000
          ? totalPortfolioUsd
          : (tl.currentCapital || totalPortfolioUsd);
        return {
          lifetimePnl: tl.lifetimePnl,
          lifetimeTrades: tl.lifetimeTrades,
          winRate,
          profitFactor,
          roi,
          currentCapital: liveCapital,
          peakCapital: Math.max(tl.peakCapital || 0, liveCapital),
          maxDrawdownPct: tl.maxDrawdownPct,
          lifetimePayouts: tl.lifetimePayouts,
          nextMilestone: tl.nextMilestone,
          milestonesReached: tl.milestonesReached?.length || 0,
          dailySnapshots: (tl.dailySnapshots || []).slice(-30),
          weeklySummaries: (tl.weeklySummaries || []).slice(-12),
          updatedAt: treasuryAge > 10 * 60 * 1000 ? Date.now() : tl.updatedAt,
        };
      })(),
      agents: agentRoster,
      tunnelUrl: (() => {
        try {
          const u = fs.readFileSync(path.resolve(process.cwd(), 'data/tunnel-url.txt'), 'utf8').trim();
          return u || null;
        } catch { return null; }
      })(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Empire status failed' },
      { status: 500 }
    );
  }
}
