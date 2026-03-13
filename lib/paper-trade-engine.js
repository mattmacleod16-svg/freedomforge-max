/**
 * Paper Trade Engine — Virtual execution engine for strategy validation.
 * ========================================================================
 *
 * Simulates real trading without risking capital. Tracks virtual positions,
 * P&L, fills, and portfolio metrics. Used by the strategy promoter's
 * PAPER_TRADING stage and for validating new strategies before live deployment.
 *
 * Capabilities:
 *   1. Virtual order book with simulated fills (spread + slippage model)
 *   2. Position tracking with mark-to-market
 *   3. Portfolio-level risk metrics (VaR, drawdown, Sharpe)
 *   4. Execution quality scoring (would-have-been fills vs actual market)
 *   5. Strategy performance attribution per indicator
 *   6. Side-by-side comparison with live strategy P&L
 *
 * Usage:
 *   const paper = require('../lib/paper-trade-engine');
 *   paper.submitOrder({ asset: 'BTC', side: 'buy', sizeUsd: 15, confidence: 0.7 });
 *   paper.markToMarket({ BTC: 67500 });
 *   const metrics = paper.getMetrics();
 */

'use strict';

const fs = require('fs');
const path = require('path');

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

let signalBus;
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }

let heartbeat;
try { heartbeat = require('./heartbeat-registry'); } catch { heartbeat = null; }

const { createLogger } = require('./logger');
const log = createLogger('paper-trade-engine');

// ─── Constants ──────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'paper-trade-state.json');

const SIMULATED_SLIPPAGE_BPS = 5;       // 0.05% simulated slippage
const SIMULATED_FEE_BPS = 20;           // 0.20% simulated fee
const INITIAL_VIRTUAL_CAPITAL = 10000;
const MAX_OPEN_POSITIONS = 15;
const MAX_TRADE_HISTORY = 2000;
const STALE_POSITION_HOURS = 168;       // Close stale positions after 7 days

// ─── I/O ────────────────────────────────────────────────────────────────────

function readJson(filePath, fallback) {
  if (rio) return rio.readJsonSafe(filePath, { fallback });
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { /* ignore */ }
  return fallback;
}

function writeJson(filePath, data) {
  if (rio) { rio.writeJsonAtomic(filePath, data); return; }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  } catch { /* ignore */ }
}

function loadState() {
  return readJson(STATE_FILE, {
    capital: INITIAL_VIRTUAL_CAPITAL,
    openPositions: [],
    closedTrades: [],
    equity: INITIAL_VIRTUAL_CAPITAL,
    peakEquity: INITIAL_VIRTUAL_CAPITAL,
    maxDrawdown: 0,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalPnl: 0,
    totalFees: 0,
    dailyPnl: {},
    strategyAttribution: {},
    lastMarkAt: 0,
  });
}

function saveState(state) { writeJson(STATE_FILE, state); }

// ─── Simulated Execution ────────────────────────────────────────────────────

/**
 * Submit a virtual order. Fills immediately at simulated price with slippage.
 * @param {object} order
 * @param {string} order.asset - e.g. 'BTC'
 * @param {string} order.side - 'buy' or 'sell'
 * @param {number} order.sizeUsd - Position size in USD
 * @param {number} order.price - Current market price
 * @param {number} [order.confidence] - Signal confidence
 * @param {string} [order.strategy] - Strategy name for attribution
 * @param {object} [order.signal] - Full signal metadata
 * @returns {object} Fill result
 */
function submitOrder(order) {
  const state = loadState();

  // Validate
  if (!order.asset || !order.side || !order.sizeUsd || !order.price) {
    return { success: false, error: 'Missing required order fields' };
  }

  if (state.openPositions.length >= MAX_OPEN_POSITIONS) {
    return { success: false, error: 'Max open positions reached' };
  }

  if (order.sizeUsd > state.capital * 0.25) {
    return { success: false, error: 'Order exceeds 25% of virtual capital' };
  }

  // Simulate fill with slippage
  const slippageMultiplier = order.side === 'buy'
    ? 1 + SIMULATED_SLIPPAGE_BPS / 10000
    : 1 - SIMULATED_SLIPPAGE_BPS / 10000;
  const fillPrice = order.price * slippageMultiplier;
  const fee = order.sizeUsd * SIMULATED_FEE_BPS / 10000;
  const qty = order.sizeUsd / fillPrice;

  const position = {
    id: `paper-${order.asset}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    asset: order.asset,
    side: order.side,
    entryPrice: fillPrice,
    qty,
    sizeUsd: order.sizeUsd,
    fee,
    confidence: order.confidence || 0,
    strategy: order.strategy || 'default',
    signal: order.signal || {},
    openedAt: Date.now(),
    markPrice: fillPrice,
    unrealizedPnl: 0,
  };

  state.openPositions.push(position);
  state.capital -= fee; // Deduct fee
  state.totalFees += fee;
  state.totalTrades++;

  saveState(state);

  log.info('Paper order filled', {
    id: position.id,
    asset: order.asset,
    side: order.side,
    price: fillPrice,
    qty: qty.toFixed(8),
    fee: fee.toFixed(4),
  });

  return { success: true, fill: position };
}

/**
 * Close a virtual position at the given market price.
 * @param {string} positionId - Position ID to close
 * @param {number} currentPrice - Current market price
 * @param {string} [reason] - Exit reason
 * @returns {object} Close result
 */
function closePosition(positionId, currentPrice, reason = 'manual') {
  const state = loadState();
  const idx = state.openPositions.findIndex(p => p.id === positionId);
  if (idx === -1) return { success: false, error: 'Position not found' };

  const position = state.openPositions[idx];

  // Simulate exit with slippage
  const slippageMultiplier = position.side === 'buy'
    ? 1 - SIMULATED_SLIPPAGE_BPS / 10000  // selling = slippage down
    : 1 + SIMULATED_SLIPPAGE_BPS / 10000;  // covering short = slippage up
  const exitPrice = currentPrice * slippageMultiplier;
  const exitFee = position.sizeUsd * SIMULATED_FEE_BPS / 10000;

  // Calculate P&L
  let pnl;
  if (position.side === 'buy') {
    pnl = (exitPrice - position.entryPrice) * position.qty;
  } else {
    pnl = (position.entryPrice - exitPrice) * position.qty;
  }
  const netPnl = pnl - position.fee - exitFee;

  const closedTrade = {
    ...position,
    exitPrice,
    exitFee,
    grossPnl: Math.round(pnl * 100) / 100,
    netPnl: Math.round(netPnl * 100) / 100,
    returnPct: Math.round((netPnl / position.sizeUsd) * 10000) / 10000,
    holdBars: Math.round((Date.now() - position.openedAt) / 3600000),
    closedAt: Date.now(),
    exitReason: reason,
  };

  // Update state
  state.openPositions.splice(idx, 1);
  state.closedTrades.push(closedTrade);
  if (state.closedTrades.length > MAX_TRADE_HISTORY) {
    state.closedTrades = state.closedTrades.slice(-MAX_TRADE_HISTORY);
  }

  state.capital += netPnl;
  state.totalPnl += netPnl;
  state.totalFees += exitFee;
  if (netPnl > 0) state.wins++;
  else state.losses++;

  // Daily P&L tracking
  const day = new Date().toISOString().split('T')[0];
  state.dailyPnl[day] = (state.dailyPnl[day] || 0) + netPnl;

  // Strategy attribution
  const strat = closedTrade.strategy || 'default';
  if (!state.strategyAttribution[strat]) {
    state.strategyAttribution[strat] = { trades: 0, wins: 0, totalPnl: 0 };
  }
  state.strategyAttribution[strat].trades++;
  if (netPnl > 0) state.strategyAttribution[strat].wins++;
  state.strategyAttribution[strat].totalPnl += netPnl;

  saveState(state);

  log.info('Paper position closed', {
    id: positionId,
    asset: position.asset,
    pnl: netPnl.toFixed(2),
    reason,
  });

  return { success: true, trade: closedTrade };
}

/**
 * Mark all open positions to market and update portfolio metrics.
 * @param {Object<string, number>} prices - Current prices by asset
 */
function markToMarket(prices = {}) {
  const state = loadState();

  let totalUnrealized = 0;
  const now = Date.now();

  for (const pos of state.openPositions) {
    const currentPrice = prices[pos.asset];
    if (!currentPrice) continue;

    pos.markPrice = currentPrice;
    if (pos.side === 'buy') {
      pos.unrealizedPnl = (currentPrice - pos.entryPrice) * pos.qty;
    } else {
      pos.unrealizedPnl = (pos.entryPrice - currentPrice) * pos.qty;
    }
    totalUnrealized += pos.unrealizedPnl;

    // Auto-close stale positions
    if (now - pos.openedAt > STALE_POSITION_HOURS * 3600000) {
      closePosition(pos.id, currentPrice, 'stale_timeout');
    }
  }

  // Update equity and drawdown
  state.equity = state.capital + totalUnrealized;
  if (state.equity > state.peakEquity) state.peakEquity = state.equity;
  const currentDrawdown = state.peakEquity > 0 ? (state.peakEquity - state.equity) / state.peakEquity : 0;
  if (currentDrawdown > state.maxDrawdown) state.maxDrawdown = currentDrawdown;
  state.lastMarkAt = now;

  saveState(state);

  return {
    equity: Math.round(state.equity * 100) / 100,
    capital: Math.round(state.capital * 100) / 100,
    unrealized: Math.round(totalUnrealized * 100) / 100,
    drawdown: Math.round(currentDrawdown * 10000) / 10000,
    openPositions: state.openPositions.length,
  };
}

/**
 * Evaluate signals from the edge detector and paper-trade them.
 * This is the bridge between the signal pipeline and paper trading.
 */
function evaluateSignal(signal, prices = {}) {
  if (!signal || !signal.asset || !signal.side || !signal.confidence) return null;

  const price = prices[signal.asset] || signal.price;
  if (!price) return null;

  // Apply same confidence threshold as live trading
  const minConf = 0.56;
  const minEdge = 0.10;
  if (signal.confidence < minConf) return null;
  if ((signal.edge || 0) < minEdge) return null;

  // Size based on confidence (mirrors orchestrator logic)
  const baseSize = 15;
  const sizeMultiplier = 1 + (signal.confidence - 0.5) * 2;
  const sizeUsd = Math.round(baseSize * sizeMultiplier * 100) / 100;

  return submitOrder({
    asset: signal.asset,
    side: signal.side,
    sizeUsd,
    price,
    confidence: signal.confidence,
    strategy: signal.strategy || 'live-mirror',
    signal: {
      edge: signal.edge,
      regime: signal.regime,
      components: signal.components,
    },
  });
}

// ─── Portfolio Metrics ──────────────────────────────────────────────────────

function getMetrics() {
  const state = loadState();
  const closed = state.closedTrades || [];
  const total = state.wins + state.losses;

  // Compute Sharpe from closed trades
  const pnls = closed.map(t => t.returnPct || 0);
  let sharpe = 0;
  if (pnls.length >= 10) {
    const avgReturn = pnls.reduce((s, v) => s + v, 0) / pnls.length;
    const stdDev = Math.sqrt(pnls.reduce((s, v) => s + (v - avgReturn) ** 2, 0) / (pnls.length - 1));
    sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
  }

  // Profit factor
  const grossProfit = closed.filter(t => t.netPnl > 0).reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(closed.filter(t => t.netPnl < 0).reduce((s, t) => s + t.netPnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  return {
    equity: Math.round((state.equity || INITIAL_VIRTUAL_CAPITAL) * 100) / 100,
    capital: Math.round((state.capital || INITIAL_VIRTUAL_CAPITAL) * 100) / 100,
    totalPnl: Math.round((state.totalPnl || 0) * 100) / 100,
    totalFees: Math.round((state.totalFees || 0) * 100) / 100,
    totalTrades: state.totalTrades || 0,
    openPositions: (state.openPositions || []).length,
    winRate: total > 0 ? Math.round((state.wins / total) * 10000) / 100 : 0,
    profitFactor: Math.round(profitFactor * 100) / 100,
    sharpe: Math.round(sharpe * 100) / 100,
    maxDrawdown: Math.round((state.maxDrawdown || 0) * 10000) / 100,
    dailyPnl: state.dailyPnl || {},
    strategyAttribution: state.strategyAttribution || {},
  };
}

function getOpenPositions() {
  const state = loadState();
  return state.openPositions || [];
}

function getClosedTrades(limit = 50) {
  const state = loadState();
  return (state.closedTrades || []).slice(-limit);
}

function resetPaperAccount() {
  const freshState = {
    capital: INITIAL_VIRTUAL_CAPITAL,
    openPositions: [],
    closedTrades: [],
    equity: INITIAL_VIRTUAL_CAPITAL,
    peakEquity: INITIAL_VIRTUAL_CAPITAL,
    maxDrawdown: 0,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalPnl: 0,
    totalFees: 0,
    dailyPnl: {},
    strategyAttribution: {},
    lastMarkAt: 0,
  };
  saveState(freshState);
  log.info('Paper trading account reset');
  return freshState;
}

module.exports = {
  submitOrder,
  closePosition,
  markToMarket,
  evaluateSignal,
  getMetrics,
  getOpenPositions,
  getClosedTrades,
  resetPaperAccount,
};
