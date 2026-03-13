/**
 * Performance Attribution Engine
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Decomposes P&L across multiple dimensions:
 *   - By strategy (momentum, mean_reversion, breakout, etc.)
 *   - By asset (BTC, ETH, SOL, etc.)
 *   - By time-of-day (which hours are most profitable)
 *   - By holding period (scalps vs swings)
 *   - By venue (Kraken vs Coinbase)
 *   - By regime (trending vs ranging vs volatile)
 *
 * Generates actionable insights: which strategies to amplify, which to mute,
 * optimal trading hours, and ideal position sizing per context.
 *
 * @module lib/performance-attribution
 */

'use strict';

const { createLogger } = require('./logger');
const log = createLogger('perf-attribution');
const fs = require('fs');
const path = require('path');

let tradeJournal, signalBus;
try { tradeJournal = require('./trade-journal'); } catch { tradeJournal = null; }
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }

const STATE_PATH = path.resolve(__dirname, '..', 'data', 'performance-attribution-state.json');
const LOOKBACK_DAYS = Number(process.env.ATTRIBUTION_LOOKBACK_DAYS || 30);

// ─── Holding Period Buckets ───────────────────────────────────────────────────
const HOLDING_BUCKETS = [
  { name: 'scalp', maxMinutes: 15 },
  { name: 'intraday', maxMinutes: 240 },
  { name: 'swing', maxMinutes: 1440 * 3 },   // 3 days
  { name: 'position', maxMinutes: Infinity },
];

function classifyHoldingPeriod(entryTime, exitTime) {
  if (!entryTime || !exitTime) return 'unknown';
  const durationMs = new Date(exitTime) - new Date(entryTime);
  const durationMin = durationMs / 60000;
  for (const bucket of HOLDING_BUCKETS) {
    if (durationMin <= bucket.maxMinutes) return bucket.name;
  }
  return 'position';
}

function getHourBucket(timestamp) {
  if (!timestamp) return 'unknown';
  const hour = new Date(timestamp).getUTCHours();
  if (hour >= 0 && hour < 6) return '00-06';
  if (hour >= 6 && hour < 12) return '06-12';
  if (hour >= 12 && hour < 18) return '12-18';
  return '18-24';
}

// ─── Core Attribution ─────────────────────────────────────────────────────────

/**
 * Run full performance attribution analysis.
 *
 * @param {object} [opts]
 * @param {number} [opts.sinceDays] - Lookback in days
 * @returns {Promise<object>}
 */
async function runAttribution(opts = {}) {
  const sinceDays = opts.sinceDays || LOOKBACK_DAYS;

  let trades = [];
  if (tradeJournal && typeof tradeJournal.getStats === 'function') {
    try {
      const stats = tradeJournal.getStats({ sinceDays });
      trades = stats.recentTrades || [];
    } catch { /* fall through */ }
  }

  // Try reading journal file directly if getStats doesn't give us trades
  if (trades.length === 0) {
    try {
      const journalPath = path.resolve(__dirname, '..', 'data', 'trade-journal.json');
      if (fs.existsSync(journalPath)) {
        const raw = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
        const cutoff = Date.now() - sinceDays * 86400000;
        trades = (raw.trades || []).filter(t => new Date(t.entryTime || t.timestamp || 0) >= cutoff);
      }
    } catch { /* fall through */ }
  }

  if (trades.length === 0) {
    return { error: 'no_trades', message: 'No trades found for attribution', timestamp: new Date().toISOString() };
  }

  // ── Dimension Aggregation ─────────────────────────────────────────────
  const byStrategy = {};
  const byAsset = {};
  const byTimeOfDay = {};
  const byHoldingPeriod = {};
  const byVenue = {};
  const byRegime = {};
  const bySide = { long: createBucket(), short: createBucket() };
  let totalPnl = 0;
  let totalTrades = 0;
  let winners = 0;

  for (const trade of trades) {
    const pnl = trade.pnl || trade.realizedPnl || 0;
    const strategy = trade.strategy || trade.signalSource || 'unknown';
    const asset = trade.asset || trade.symbol || 'unknown';
    const venue = trade.venue || 'unknown';
    const regime = trade.regime || trade.marketRegime || 'unknown';
    const side = (trade.side || 'long').toLowerCase();
    const entryTime = trade.entryTime || trade.timestamp;
    const exitTime = trade.exitTime || trade.closedAt;

    totalPnl += pnl;
    totalTrades++;
    if (pnl > 0) winners++;

    // Strategy dimension
    if (!byStrategy[strategy]) byStrategy[strategy] = createBucket();
    addToBucket(byStrategy[strategy], pnl, trade);

    // Asset dimension
    if (!byAsset[asset]) byAsset[asset] = createBucket();
    addToBucket(byAsset[asset], pnl, trade);

    // Time-of-day dimension
    const hourBucket = getHourBucket(entryTime);
    if (!byTimeOfDay[hourBucket]) byTimeOfDay[hourBucket] = createBucket();
    addToBucket(byTimeOfDay[hourBucket], pnl, trade);

    // Holding period dimension
    const holdingBucket = classifyHoldingPeriod(entryTime, exitTime);
    if (!byHoldingPeriod[holdingBucket]) byHoldingPeriod[holdingBucket] = createBucket();
    addToBucket(byHoldingPeriod[holdingBucket], pnl, trade);

    // Venue dimension
    if (!byVenue[venue]) byVenue[venue] = createBucket();
    addToBucket(byVenue[venue], pnl, trade);

    // Regime dimension
    if (!byRegime[regime]) byRegime[regime] = createBucket();
    addToBucket(byRegime[regime], pnl, trade);

    // Side dimension
    addToBucket(bySide[side] || bySide.long, pnl, trade);
  }

  // ── Compute metrics for each bucket ───────────────────────────────────
  const result = {
    summary: {
      totalTrades,
      totalPnl: round(totalPnl),
      winRate: totalTrades > 0 ? round(winners / totalTrades) : 0,
      avgPnl: totalTrades > 0 ? round(totalPnl / totalTrades) : 0,
      sinceDays,
    },
    byStrategy: finalizeDimension(byStrategy, totalPnl),
    byAsset: finalizeDimension(byAsset, totalPnl),
    byTimeOfDay: finalizeDimension(byTimeOfDay, totalPnl),
    byHoldingPeriod: finalizeDimension(byHoldingPeriod, totalPnl),
    byVenue: finalizeDimension(byVenue, totalPnl),
    byRegime: finalizeDimension(byRegime, totalPnl),
    bySide: finalizeDimension(bySide, totalPnl),
    insights: [],
    timestamp: new Date().toISOString(),
  };

  // ── Generate Insights ─────────────────────────────────────────────────
  result.insights = generateInsights(result);

  // Persist
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(result, null, 2));
  } catch (err) {
    log.warn('Failed to persist attribution state:', err?.message);
  }

  // Publish summary to signal bus
  if (signalBus) {
    try {
      signalBus.publish({
        type: 'performance_attribution',
        source: 'perf-attribution',
        confidence: 0.9,
        payload: {
          totalPnl: result.summary.totalPnl,
          winRate: result.summary.winRate,
          bestStrategy: getBest(result.byStrategy),
          worstStrategy: getWorst(result.byStrategy),
          insightCount: result.insights.length,
        },
        ttlMs: 3600000, // 1hr
      });
    } catch { /* best effort */ }
  }

  return result;
}

// ─── Bucket Helpers ───────────────────────────────────────────────────────────

function createBucket() {
  return { trades: 0, pnl: 0, wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, maxWin: 0, maxLoss: 0 };
}

function addToBucket(bucket, pnl, _trade) {
  bucket.trades++;
  bucket.pnl += pnl;
  if (pnl > 0) {
    bucket.wins++;
    bucket.grossProfit += pnl;
    bucket.maxWin = Math.max(bucket.maxWin, pnl);
  } else if (pnl < 0) {
    bucket.losses++;
    bucket.grossLoss += Math.abs(pnl);
    bucket.maxLoss = Math.min(bucket.maxLoss, pnl);
  }
}

function finalizeDimension(dimension, totalPnl) {
  const result = {};
  for (const [key, bucket] of Object.entries(dimension)) {
    result[key] = {
      trades: bucket.trades,
      pnl: round(bucket.pnl),
      winRate: bucket.trades > 0 ? round(bucket.wins / bucket.trades) : 0,
      avgPnl: bucket.trades > 0 ? round(bucket.pnl / bucket.trades) : 0,
      contribution: totalPnl !== 0 ? round(bucket.pnl / Math.abs(totalPnl)) : 0,
      profitFactor: bucket.grossLoss > 0 ? round(bucket.grossProfit / bucket.grossLoss) : bucket.grossProfit > 0 ? Infinity : 0,
      maxWin: round(bucket.maxWin),
      maxLoss: round(bucket.maxLoss),
      expectancy: bucket.trades > 0 ? round(
        (bucket.wins / bucket.trades) * (bucket.grossProfit / Math.max(bucket.wins, 1)) +
        (bucket.losses / bucket.trades) * (-bucket.grossLoss / Math.max(bucket.losses, 1))
      ) : 0,
    };
  }
  return result;
}

// ─── Insight Generation ───────────────────────────────────────────────────────

function generateInsights(attribution) {
  const insights = [];

  // Best/worst strategy
  const bestStrat = getBest(attribution.byStrategy);
  const worstStrat = getWorst(attribution.byStrategy);
  if (bestStrat) insights.push({ type: 'amplify', dimension: 'strategy', key: bestStrat.key, reason: `Best strategy: ${bestStrat.key} with $${bestStrat.pnl} P&L (${bestStrat.winRate * 100}% win rate)` });
  if (worstStrat && worstStrat.pnl < 0) insights.push({ type: 'mute', dimension: 'strategy', key: worstStrat.key, reason: `Worst strategy: ${worstStrat.key} with $${worstStrat.pnl} P&L` });

  // Best time of day
  const bestTime = getBest(attribution.byTimeOfDay);
  if (bestTime) insights.push({ type: 'timing', dimension: 'timeOfDay', key: bestTime.key, reason: `Most profitable trading window: ${bestTime.key} UTC` });

  // Holding period edge
  const bestHold = getBest(attribution.byHoldingPeriod);
  if (bestHold) insights.push({ type: 'duration', dimension: 'holdingPeriod', key: bestHold.key, reason: `Best holding period: ${bestHold.key} with expectancy $${bestHold.expectancy}` });

  // Venue efficiency
  const venues = Object.entries(attribution.byVenue);
  if (venues.length >= 2) {
    const sorted = venues.sort((a, b) => b[1].avgPnl - a[1].avgPnl);
    insights.push({ type: 'venue', dimension: 'venue', key: sorted[0][0], reason: `Best venue by avg P&L: ${sorted[0][0]} ($${sorted[0][1].avgPnl}/trade)` });
  }

  // Regime profitability
  const bestRegime = getBest(attribution.byRegime);
  if (bestRegime) insights.push({ type: 'regime', dimension: 'regime', key: bestRegime.key, reason: `Most profitable regime: ${bestRegime.key} with $${bestRegime.pnl} total` });

  // Win rate anomalies
  for (const [key, val] of Object.entries(attribution.byStrategy)) {
    if (val.trades >= 5 && val.winRate < 0.3) {
      insights.push({ type: 'warning', dimension: 'strategy', key, reason: `Strategy '${key}' has critically low win rate: ${(val.winRate * 100).toFixed(0)}% over ${val.trades} trades` });
    }
  }

  return insights;
}

function getBest(dimension) {
  let best = null;
  for (const [key, val] of Object.entries(dimension)) {
    if (!best || val.pnl > best.pnl) best = { key, ...val };
  }
  return best;
}

function getWorst(dimension) {
  let worst = null;
  for (const [key, val] of Object.entries(dimension)) {
    if (!worst || val.pnl < worst.pnl) worst = { key, ...val };
  }
  return worst;
}

function round(n) { return Math.round(n * 100) / 100; }

/**
 * Get a quick P&L summary for a specific strategy.
 *
 * @param {string} strategyName
 * @param {number} [sinceDays]
 * @returns {Promise<object>}
 */
async function getStrategyPerformance(strategyName, sinceDays = LOOKBACK_DAYS) {
  const full = await runAttribution({ sinceDays });
  return full.byStrategy[strategyName] || { trades: 0, pnl: 0, winRate: 0, avgPnl: 0, note: 'no data' };
}

/**
 * Get optimal trading parameters based on historical performance.
 *
 * @returns {Promise<object>}
 */
async function getOptimalParams() {
  const full = await runAttribution();
  const bestTime = getBest(full.byTimeOfDay);
  const bestHold = getBest(full.byHoldingPeriod);
  const bestStrat = getBest(full.byStrategy);

  return {
    preferredTradingWindow: bestTime?.key || 'any',
    preferredHoldingPeriod: bestHold?.key || 'intraday',
    topStrategy: bestStrat?.key || 'unknown',
    winRate: full.summary.winRate,
    avgPnl: full.summary.avgPnl,
    insightCount: full.insights.length,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  runAttribution,
  getStrategyPerformance,
  getOptimalParams,
  classifyHoldingPeriod,
  getHourBucket,
};
