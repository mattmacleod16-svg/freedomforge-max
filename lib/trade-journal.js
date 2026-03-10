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

const JOURNAL_FILE = path.resolve(process.cwd(), process.env.TRADE_JOURNAL_FILE || 'data/trade-journal.json');
const MAX_TRADES = Math.max(100, parseInt(process.env.TRADE_JOURNAL_MAX || '2000', 10));
const STRATEGY_STATE_FILE = path.resolve(process.cwd(), process.env.STRATEGY_STATE_FILE || 'data/strategy-evolution.json');

function load(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function save(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
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
  dryRun = false,
  orderId = null,
}) {
  const journal = loadJournal();
  const now = Date.now();
  const trade = {
    id: `trade-${now}-${Math.random().toString(36).slice(2, 6)}`,
    venue,
    asset,
    side,
    entryPrice,
    usdSize,
    signal: {
      side: signal.side,
      confidence: signal.confidence,
      edge: signal.edge,
      compositeScore: signal.compositeScore,
    },
    signalComponents: summarizeComponents(signalComponents),
    dryRun,
    orderId,
    ts: now,
    entryAt: new Date(now).toISOString(),
    entryTs: now,
    outcome: null, // filled on recordOutcome
    exitPrice: null,
    pnl: null,
    pnlPercent: null,
    fees: 0,
    closedAt: null,
  };
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
function recordOutcome(tradeId, { exitPrice, pnl, pnlPercent, fees = 0 } = {}) {
  const journal = loadJournal();
  const trade = journal.trades.find((t) => t.id === tradeId);
  if (!trade) return false;

  trade.exitPrice = exitPrice;
  trade.pnl = pnl;
  trade.pnlPercent = pnlPercent != null ? pnlPercent : (exitPrice && trade.entryPrice ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100 * (trade.side === 'sell' ? -1 : 1) : null);
  trade.fees = fees;
  trade.outcome = pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven';
  trade.closedAt = new Date().toISOString();

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
    const day = t.closedAt ? t.closedAt.slice(0, 10) : 'unknown';
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

  // Per-signal attribution
  const signalAttribution = {};
  for (const t of closed) {
    const key = t.signalComponents?.mtfDirection || 'unknown';
    if (!signalAttribution[key]) signalAttribution[key] = { trades: 0, wins: 0, pnl: 0 };
    signalAttribution[key].trades += 1;
    if (t.outcome === 'win') signalAttribution[key].wins += 1;
    signalAttribution[key].pnl += t.pnl || 0;
  }

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

module.exports = {
  recordTrade,
  recordOutcome,
  autoCloseEstimate,
  getStats,
  getStrategyEvolution,
  getAdaptiveMinConfidence,
  JOURNAL_FILE,
  STRATEGY_STATE_FILE,
};
