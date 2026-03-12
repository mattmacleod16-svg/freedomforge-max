/**
 * Trade Journal — Records every trade decision with pre-trade signals,
 * post-trade results, and performance attribution.
 *
 * Enables:
 *  - Win/loss tracking per asset, per signal type, per venue
 *  - Sharpe ratio and drawdown monitoring
 *  - Adaptive parameter tuning based on historical hit rate
 *  - Strategy evolution tracking
 *
 * Usage:
 *   const journal = require('../lib/trade-journal');
 *   journal.recordTrade({ venue, asset, side, entryPrice, usdSize, signal, signalComponents });
 *   journal.recordOutcome(tradeId, { exitPrice, pnl, fees });
 *   const stats = journal.getStats();
 */

const fs = require('fs');
const path = require('path');

// Resilient I/O — atomic writes, backup recovery, file locking
let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

const JOURNAL_FILE = path.resolve(process.cwd(), process.env.TRADE_JOURNAL_FILE || 'data/trade-journal.json');
const MAX_TRADES = Math.max(100, parseInt(process.env.TRADE_JOURNAL_MAX || '2000', 10));
const STRATEGY_STATE_FILE = path.resolve(process.cwd(), process.env.STRATEGY_STATE_FILE || 'data/strategy-evolution.json');

function load(filePath) {
  if (rio) return rio.readJsonSafe(filePath, { fallback: null });
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function save(filePath, data) {
  if (rio) { rio.writeJsonAtomic(filePath, data); return; }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function loadJournal() {
  const raw = load(JOURNAL_FILE);
  return {
    trades: Array.isArray(raw?.trades) ? raw.trades : [],
    stats: raw?.stats || {},
    updatedAt: raw?.updatedAt || 0,
  };
}

function saveJournal(journal) {
  // Trim to max trades
  if (journal.trades.length > MAX_TRADES) {
    journal.trades = journal.trades.slice(-MAX_TRADES);
  }
  journal.updatedAt = Date.now();
  save(JOURNAL_FILE, journal);
}

/**
 * Record a new trade decision (entry).
 */
function recordTrade({
  venue,
  asset = 'BTC',
  side,
  entryPrice,
  usdSize,
  signal = {},
  signalComponents = {},
  signalSources = [],
  dryRun = false,
  orderId = null,
  expectedPrice = null,
  walStatus = null,
}) {
  const journal = loadJournal();
  const now = Date.now();
  const trade = {
    id: `trade-${now}-${Math.random().toString(36).slice(2, 6)}`,
    venue,
    asset,
    side,
    entryPrice,
    expectedPrice: expectedPrice || entryPrice,
    usdSize,
    signal: {
      side: signal.side,
      confidence: signal.confidence,
      edge: signal.edge,
      compositeScore: signal.compositeScore,
    },
    signalComponents: summarizeComponents(signalComponents),
    signalSources: Array.isArray(signalSources) ? signalSources : [],
    dryRun,
    orderId,
    ts: now,
    entryAt: new Date(now).toISOString(),
    entryTs: now,
    outcome: null, // filled on recordOutcome
    exitPrice: null,
    fillPrice: null,
    slippagePct: null,
    slippageUsd: null,
    pnl: null,
    pnlPercent: null,
    fees: 0,
    closedAt: null,
    walStatus: walStatus || null,
  };

  // Compute entry slippage if we have expectedPrice and an actual entryPrice
  if (expectedPrice && entryPrice && expectedPrice > 0) {
    const rawSlippage = side === 'buy'
      ? (entryPrice - expectedPrice) / expectedPrice
      : (expectedPrice - entryPrice) / expectedPrice;
    trade.slippagePct = Math.round(rawSlippage * 10000) / 100; // basis points → percent
    trade.slippageUsd = Math.round(rawSlippage * usdSize * 100) / 100;
  }

  journal.trades.push(trade);
  saveJournal(journal);
  return trade.id;
}

/** Compact summary of signal components for storage */
function summarizeComponents(components) {
  if (!components || typeof components !== 'object') return {};
  const summary = {};
  if (components.multiTfMomentum) {
    summary.mtfDirection = components.multiTfMomentum.direction;
    summary.mtfConfluence = components.multiTfMomentum.confluence;
  }
  if (components.rsi != null) summary.rsi = Math.round(components.rsi * 10) / 10;
  if (components.bollingerBands) summary.bbPercentB = Math.round(components.bollingerBands.percentB * 100) / 100;
  if (components.atr != null) summary.atr = components.atr;
  if (components.volumeConfirmation) summary.volRatio = Math.round(components.volumeConfirmation.ratio * 100) / 100;
  if (components.signalBus?.available) {
    summary.regime = components.signalBus.regime;
    summary.regimeConf = components.signalBus.regimeConfidence;
  }
  if (components.sentimentDivergence) summary.sentDivergence = components.sentimentDivergence.type;
  return summary;
}

/**
 * Record trade outcome (exit).
 */
function recordOutcome(tradeId, { exitPrice, fillPrice, pnl, pnlPercent, fees = 0 } = {}) {
  const journal = loadJournal();
  const trade = journal.trades.find((t) => t.id === tradeId);
  if (!trade) return false;

  trade.exitPrice = exitPrice;
  trade.fillPrice = fillPrice || exitPrice;
  trade.pnl = pnl;
  trade.pnlPercent = pnlPercent != null ? pnlPercent : (exitPrice && trade.entryPrice ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100 * (trade.side === 'sell' ? -1 : 1) : null);
  trade.fees = fees;
  trade.outcome = pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven';
  trade.closedAt = new Date().toISOString();

  // Compute exit slippage if fillPrice differs from exitPrice
  if (fillPrice && exitPrice && fillPrice !== exitPrice && exitPrice > 0) {
    const exitSlip = trade.side === 'sell'
      ? (exitPrice - fillPrice) / exitPrice
      : (fillPrice - exitPrice) / exitPrice;
    trade.exitSlippagePct = Math.round(exitSlip * 10000) / 100;
  }

  saveJournal(journal);
  return true;
}

/**
 * Auto-estimate P&L for unclosed market-order trades.
 * Checks current price vs entry price and marks the trade.
 */
function autoCloseEstimate(tradeId, currentPrice) {
  const journal = loadJournal();
  const trade = journal.trades.find((t) => t.id === tradeId && !t.closedAt);
  if (!trade || trade.closedAt) return false;

  const pnlPercent = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100 * (trade.side === 'sell' ? -1 : 1);
  const pnl = trade.usdSize * pnlPercent / 100;

  trade.exitPrice = currentPrice;
  trade.pnl = Math.round(pnl * 100) / 100;
  trade.pnlPercent = Math.round(pnlPercent * 100) / 100;
  trade.outcome = pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven';
  trade.closedAt = new Date().toISOString();
  trade.autoEstimated = true;

  saveJournal(journal);
  return true;
}

/**
 * Get aggregated performance statistics.
 */
function getStats(options = {}) {
  const journal = loadJournal();
  const { sinceDays = 30, venue = null, asset = null } = options;
  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

  const trades = journal.trades.filter((t) => {
    if (t.entryTs < cutoff) return false;
    if (venue && t.venue !== venue) return false;
    if (asset && t.asset !== asset) return false;
    return true;
  });

  const closed = trades.filter((t) => t.outcome);
  const wins = closed.filter((t) => t.outcome === 'win');
  const losses = closed.filter((t) => t.outcome === 'loss');

  const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0);
  const totalFees = closed.reduce((s, t) => s + (t.fees || 0), 0);
  const totalVolume = trades.reduce((s, t) => s + (t.usdSize || 0), 0);

  // Win rate
  const winRate = closed.length > 0 ? wins.length / closed.length : 0;

  // Average win/loss
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl || 0), 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + (t.pnl || 0), 0) / losses.length : 0;

  // Profit factor
  const grossProfit = wins.reduce((s, t) => s + (t.pnl || 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Sharpe-like ratio (daily returns)
  const dailyPnl = {};
  for (const t of closed) {
    const raw = t.closedAt;
    const day = typeof raw === 'string' ? raw.slice(0, 10) : typeof raw === 'number' ? new Date(raw).toISOString().slice(0, 10) : 'unknown';
    dailyPnl[day] = (dailyPnl[day] || 0) + (t.pnl || 0);
  }
  const dailyReturns = Object.values(dailyPnl);
  const meanReturn = dailyReturns.length > 0 ? dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length : 0;
  const stdReturn = dailyReturns.length > 1
    ? Math.sqrt(dailyReturns.reduce((s, v) => s + (v - meanReturn) ** 2, 0) / (dailyReturns.length - 1))
    : 0;
  const sharpeRatio = stdReturn > 0 ? (meanReturn / stdReturn) * Math.sqrt(365) : 0;

  // Max drawdown
  let peak = 0;
  let maxDrawdown = 0;
  let cumPnl = 0;
  for (const t of closed.sort((a, b) => a.entryTs - b.entryTs)) {
    cumPnl += t.pnl || 0;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Per-signal attribution (by mtfDirection — legacy)
  const signalAttribution = {};
  for (const t of closed) {
    const key = t.signalComponents?.mtfDirection || 'unknown';
    if (!signalAttribution[key]) signalAttribution[key] = { trades: 0, wins: 0, pnl: 0 };
    signalAttribution[key].trades += 1;
    if (t.outcome === 'win') signalAttribution[key].wins += 1;
    signalAttribution[key].pnl += t.pnl || 0;
  }

  // PnL attribution by signal source (uses signalSources array)
  const sourceAttribution = {};
  for (const t of closed) {
    const sources = Array.isArray(t.signalSources) && t.signalSources.length > 0
      ? t.signalSources
      : ['unknown'];
    const share = 1 / sources.length; // split credit equally among contributing sources
    for (const src of sources) {
      if (!sourceAttribution[src]) sourceAttribution[src] = { trades: 0, wins: 0, pnl: 0, confSum: 0 };
      sourceAttribution[src].trades += share;
      if (t.outcome === 'win') sourceAttribution[src].wins += share;
      sourceAttribution[src].pnl += (t.pnl || 0) * share;
      sourceAttribution[src].confSum += (t.signal?.confidence || 0) * share;
    }
  }
  for (const src of Object.keys(sourceAttribution)) {
    const s = sourceAttribution[src];
    s.trades = Math.round(s.trades * 100) / 100;
    s.wins = Math.round(s.wins * 100) / 100;
    s.pnl = Math.round(s.pnl * 100) / 100;
    s.avgConfidence = s.trades > 0 ? Math.round((s.confSum / s.trades) * 100) / 100 : 0;
    delete s.confSum;
    s.winRate = s.trades > 0 ? Math.round((s.wins / s.trades) * 10000) / 100 : 0;
  }

  // Slippage statistics
  const slippageTrades = closed.filter(t => t.slippagePct != null);
  const totalSlippageUsd = slippageTrades.reduce((s, t) => s + (t.slippageUsd || 0), 0);
  const avgSlippagePct = slippageTrades.length > 0
    ? slippageTrades.reduce((s, t) => s + (t.slippagePct || 0), 0) / slippageTrades.length
    : 0;
  const slippage = {
    trackedTrades: slippageTrades.length,
    totalSlippageUsd: Math.round(totalSlippageUsd * 100) / 100,
    avgSlippagePct: Math.round(avgSlippagePct * 10000) / 10000,
    worstSlippagePct: slippageTrades.length > 0
      ? Math.round(Math.max(...slippageTrades.map(t => t.slippagePct || 0)) * 10000) / 10000
      : 0,
  };

  return {
    period: `${sinceDays}d`,
    totalTrades: trades.length,
    closedTrades: closed.length,
    openTrades: trades.length - closed.length,
    winRate: Math.round(winRate * 10000) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalFees: Math.round(totalFees * 100) / 100,
    totalVolume: Math.round(totalVolume * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    signalAttribution,
    sourceAttribution,
    slippage,
    computedAt: new Date().toISOString(),
  };
}

// ─── Strategy Evolution ──────────────────────────────────────────────────────

/**
 * Adaptive parameter recommendations based on journal history.
 * Returns suggested adjustments to MIN_CONFIDENCE, threshold, sizing.
 */
function getStrategyEvolution() {
  const stats = getStats({ sinceDays: 7 });
  const state = load(STRATEGY_STATE_FILE) || { generations: [], currentParams: {} };

  const recommendations = {};

  // If win rate is low, raise confidence threshold
  if (stats.closedTrades >= 10 && stats.winRate < 45) {
    recommendations.minConfidence = 'raise (current win rate too low → filter more aggressively)';
    recommendations.suggestedMinConfidence = 0.62;
  } else if (stats.closedTrades >= 10 && stats.winRate > 65) {
    recommendations.minConfidence = 'lower (win rate is healthy → capture more opportunities)';
    recommendations.suggestedMinConfidence = 0.52;
  }

  // If max drawdown is too high relative to profits, reduce sizing
  if (stats.maxDrawdown > Math.abs(stats.totalPnl) * 2) {
    recommendations.sizing = 'reduce (drawdown exceeds 2x total P&L)';
    recommendations.suggestedSizeMultiplier = 0.7;
  }

  // If profit factor below 1, we're net losing
  if (stats.closedTrades >= 10 && stats.profitFactor < 1) {
    recommendations.urgency = 'HIGH — strategy is net negative, tighten all thresholds';
    recommendations.suggestedMinConfidence = Math.max(recommendations.suggestedMinConfidence || 0, 0.65);
  }

  // Record this generation
  const generation = {
    ts: Date.now(),
    stats: { winRate: stats.winRate, pnl: stats.totalPnl, sharpe: stats.sharpeRatio, maxDD: stats.maxDrawdown, trades: stats.closedTrades },
    recommendations,
  };
  state.generations.push(generation);
  if (state.generations.length > 100) state.generations = state.generations.slice(-100);
  state.updatedAt = Date.now();
  save(STRATEGY_STATE_FILE, state);

  return { stats, recommendations, generationCount: state.generations.length };
}

/**
 * Get current adaptive min confidence based on recent performance.
 * Falls back to the provided default if not enough data.
 */
function getAdaptiveMinConfidence(defaultValue = 0.56) {
  try {
    const stats = getStats({ sinceDays: 7 });
    if (stats.closedTrades < 10) return defaultValue;
    if (stats.winRate < 40) return Math.min(0.70, defaultValue + 0.08);
    if (stats.winRate < 50) return Math.min(0.65, defaultValue + 0.04);
    if (stats.winRate > 70) return Math.max(0.50, defaultValue - 0.04);
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Update a field on the most recent trade (for post-fill verification).
 * @param {string} field - Field name to update
 * @param {*} value - New value
 */
function updateLastTradeField(field, value) {
  const journal = loadJournal();
  if (journal.trades.length === 0) return;
  journal.trades[journal.trades.length - 1][field] = value;
  save(JOURNAL_FILE, journal);
}

/**
 * Update arbitrary fields on a specific trade by ID (for WAL updates).
 * @param {string} tradeId - Trade ID
 * @param {object} fields - Fields to update
 * @returns {boolean} Whether the trade was found and updated
 */
function updateTradeById(tradeId, fields) {
  const journal = loadJournal();
  const trade = journal.trades.find(t => t.id === tradeId);
  if (!trade) return false;
  Object.assign(trade, fields);
  saveJournal(journal);
  return true;
}

/**
 * Recover stale pending trades from write-ahead log.
 * Trades stuck in 'pending' walStatus beyond maxAgeMs are marked as orphaned.
 * @param {number} [maxAgeMs=600000] - Max age for pending trades (default: 10 min)
 * @returns {string[]} Array of recovered trade IDs
 */
function recoverPendingTrades(maxAgeMs = 10 * 60 * 1000) {
  const journal = loadJournal();
  const now = Date.now();
  const recovered = [];
  for (const trade of journal.trades) {
    if (trade.walStatus === 'pending' && (now - trade.entryTs) > maxAgeMs) {
      trade.walStatus = 'orphaned';
      trade.outcome = 'unknown';
      trade.closedAt = new Date(now).toISOString();
      trade.closeReason = 'wal_recovery: crash during execution — order may or may not have filled';
      recovered.push(trade.id);
    }
  }
  if (recovered.length > 0) saveJournal(journal);
  return recovered;
}

module.exports = {
  recordTrade,
  recordOutcome,
  autoCloseEstimate,
  getStats,
  getStrategyEvolution,
  getAdaptiveMinConfidence,
  updateLastTradeField,
  updateTradeById,
  recoverPendingTrades,
  JOURNAL_FILE,
  STRATEGY_STATE_FILE,
};
