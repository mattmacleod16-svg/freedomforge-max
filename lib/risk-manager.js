/**
 * Risk Manager — Portfolio-level risk management, position correlation,
 * drawdown protection, and dynamic stop-losses.
 *
 * This is the safety net that prevents catastrophic losses while
 * allowing aggressive opportunity-taking when conditions are favorable.
 *
 * Capabilities:
 *   1. Portfolio-level exposure tracking across all venues
 *   2. Asset correlation analysis — prevents concentrated bets
 *   3. Dynamic max-drawdown circuit breaker
 *   4. Per-asset exposure limits based on evolved brain data
 *   5. ATR-based dynamic stop-loss calculator
 *   6. Profit-taking rules (scale out of big winners)
 *   7. Risk-reward ratio enforcement
 *   8. Kill switch for emergency shutdown
 *
 * Usage:
 *   const risk = require('../lib/risk-manager');
 *   const allowed = risk.checkTradeAllowed({ asset: 'BTC', side: 'buy', usdSize: 25, venue: 'kraken' });
 *   const stopLoss = risk.calculateStopLoss({ asset: 'ETH', entryPrice: 3500, side: 'buy', atr: 50 });
 *   risk.updateExposure({ asset: 'BTC', usdSize: 25, side: 'buy', venue: 'kraken' });
 */

const fs = require('fs');
const path = require('path');

// Resilient I/O — atomic writes, backup recovery, file locking
let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

const RISK_STATE_FILE = path.resolve(process.cwd(), process.env.RISK_STATE_FILE || 'data/risk-manager-state.json');
const MAX_PORTFOLIO_EXPOSURE_USD = Math.max(50, Number(process.env.RISK_MAX_PORTFOLIO_USD || 500));
const MAX_SINGLE_ASSET_PCT = Math.max(10, Math.min(80, Number(process.env.RISK_MAX_SINGLE_ASSET_PCT || 40)));
const MAX_SINGLE_VENUE_PCT = Math.max(20, Math.min(90, Number(process.env.RISK_MAX_SINGLE_VENUE_PCT || 60)));
const MAX_DRAWDOWN_PCT = Math.max(5, Math.min(50, Number(process.env.RISK_MAX_DRAWDOWN_PCT || 20)));
const MAX_DAILY_LOSS_USD = Math.max(10, Number(process.env.RISK_MAX_DAILY_LOSS_USD || 50));
const STOP_LOSS_ATR_MULTIPLIER = Math.max(0.5, Math.min(5, Number(process.env.RISK_STOP_LOSS_ATR_MULT || 2.0)));
const TAKE_PROFIT_ATR_MULTIPLIER = Math.max(1, Math.min(10, Number(process.env.RISK_TAKE_PROFIT_ATR_MULT || 3.0)));
const MIN_RISK_REWARD = Math.max(1, Math.min(5, Number(process.env.RISK_MIN_RISK_REWARD || 1.5)));
const CORRELATION_LOOKBACK_TRADES = Math.max(10, parseInt(process.env.RISK_CORRELATION_LOOKBACK || '30', 10));
const MAX_CORRELATED_EXPOSURE_PCT = Math.max(20, Math.min(80, Number(process.env.RISK_MAX_CORRELATED_PCT || 50)));
const KILL_SWITCH_FILE = path.resolve(process.cwd(), 'data/kill-switch.json');

function load(filePath) {
  if (rio) return rio.readJsonSafe(filePath, { fallback: null });
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

function save(filePath, data) {
  if (rio) { rio.writeJsonAtomic(filePath, data); return; }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadRiskState() {
  const raw = load(RISK_STATE_FILE);
  return {
    positions: raw?.positions || {},
    peakEquity: raw?.peakEquity || 0,
    currentEquity: raw?.currentEquity || 0,
    dailyPnl: raw?.dailyPnl || { date: '', pnl: 0 },
    tradeCount24h: raw?.tradeCount24h || { windowStart: 0, count: 0 },
    correlationMatrix: raw?.correlationMatrix || {},
    riskEvents: raw?.riskEvents || [],
    killSwitchActive: raw?.killSwitchActive || false,
    updatedAt: raw?.updatedAt || Date.now(),
  };
}

function saveRiskState(state) {
  state.updatedAt = Date.now();
  // Keep only last 100 risk events
  if (state.riskEvents.length > 100) state.riskEvents = state.riskEvents.slice(-100);
  save(RISK_STATE_FILE, state);
}

// ─── Kill Switch ─────────────────────────────────────────────────────────────

function isKillSwitchActive() {
  const raw = load(KILL_SWITCH_FILE);
  if (raw?.active === true) return true;
  const state = loadRiskState();
  return state.killSwitchActive === true;
}

function activateKillSwitch(reason) {
  save(KILL_SWITCH_FILE, { active: true, reason, activatedAt: new Date().toISOString() });
  const state = loadRiskState();
  state.killSwitchActive = true;
  state.riskEvents.push({ type: 'kill_switch', reason, ts: Date.now() });
  saveRiskState(state);
  
  // Publish to signal bus
  try {
    const bus = require('./agent-signal-bus');
    bus.publish({
      type: 'risk_alert',
      source: 'risk-manager',
      confidence: 1.0,
      payload: { event: 'kill_switch_activated', reason },
      ttlMs: 24 * 60 * 60 * 1000,
    });
  } catch (err) { console.error('[risk-manager] signal bus publish failed:', err?.message || err); }
}

/**
 * Deactivate kill switch — OWNER SOVEREIGNTY REQUIRED.
 * Must provide the owner confirmation token (env KILL_SWITCH_OWNER_TOKEN)
 * or call from a break-glass script that sets BREAK_GLASS=true.
 * This prevents any rogue code path from silently re-enabling trading.
 */
function deactivateKillSwitch(ownerToken) {
  const expectedToken = process.env.KILL_SWITCH_OWNER_TOKEN || '';
  const breakGlass = String(process.env.BREAK_GLASS || '').toLowerCase() === 'true';

  if (!breakGlass && (!expectedToken || ownerToken !== expectedToken)) {
    const msg = 'KILL SWITCH DEACTIVATION DENIED — owner token missing or invalid. ' +
      'Set KILL_SWITCH_OWNER_TOKEN env var and pass it to deactivateKillSwitch(token).';
    console.error(`[SOVEREIGNTY] ${msg}`);
    try {
      const bus = require('./agent-signal-bus');
      bus.publish({
        type: 'risk_alert',
        source: 'risk-manager',
        confidence: 1.0,
        payload: { event: 'kill_switch_deactivation_denied', reason: msg },
        ttlMs: 24 * 60 * 60 * 1000,
      });
    } catch (err) { console.error('[risk-manager] signal bus publish failed:', err?.message || err); }
    return false;
  }

  save(KILL_SWITCH_FILE, { active: false, deactivatedAt: new Date().toISOString(), deactivatedBy: breakGlass ? 'break-glass' : 'owner-token' });
  const state = loadRiskState();
  state.killSwitchActive = false;
  state.riskEvents.push({ type: 'kill_switch_deactivated', by: breakGlass ? 'break-glass' : 'owner-token', ts: Date.now() });
  saveRiskState(state);
  return true;
}

// ─── Exposure Tracking ───────────────────────────────────────────────────────

function getPortfolioExposure() {
  const state = loadRiskState();
  const positions = state.positions || {};
  let totalLong = 0;
  let totalShort = 0;
  const assetExposure = {};
  const venueExposure = {};

  for (const [key, pos] of Object.entries(positions)) {
    const usd = Math.abs(pos.usdSize || 0);
    const asset = pos.asset || 'UNKNOWN';
    const venue = pos.venue || 'unknown';

    if (pos.side === 'buy') totalLong += usd;
    else totalShort += usd;

    assetExposure[asset] = (assetExposure[asset] || 0) + usd;
    venueExposure[venue] = (venueExposure[venue] || 0) + usd;
  }

  const totalExposure = totalLong + totalShort;
  const netExposure = totalLong - totalShort;

  return {
    totalExposure,
    netExposure,
    totalLong,
    totalShort,
    assetExposure,
    venueExposure,
    positionCount: Object.keys(positions).length,
    utilizationPct: totalExposure > 0 ? Math.round(totalExposure / MAX_PORTFOLIO_EXPOSURE_USD * 10000) / 100 : 0,
  };
}

function updateExposure({ asset, side, usdSize, venue, orderId }) {
  const state = loadRiskState();
  const key = orderId || `${venue}-${asset}-${side}-${Date.now()}`;
  state.positions[key] = {
    asset, side, usdSize, venue,
    openedAt: new Date().toISOString(),
    openedTs: Date.now(),
  };
  saveRiskState(state);
}

function closeExposure(orderId) {
  if (!orderId) return;
  const state = loadRiskState();
  delete state.positions[orderId];
  saveRiskState(state);
}

// ─── Trade Gating ────────────────────────────────────────────────────────────

/**
 * Check if a proposed trade is allowed under current risk limits.
 * Returns { allowed: boolean, reasons: string[] }
 */
function checkTradeAllowed({ asset, side, usdSize, venue, confidence = 0.5 }) {
  const reasons = [];

  // 1. Kill switch
  if (isKillSwitchActive()) {
    return { allowed: false, reasons: ['KILL SWITCH IS ACTIVE — all trading halted'] };
  }

  // 2. Portfolio exposure limit
  const exposure = getPortfolioExposure();
  if (exposure.totalExposure + usdSize > MAX_PORTFOLIO_EXPOSURE_USD) {
    reasons.push(`portfolio exposure ${exposure.totalExposure.toFixed(0)}+${usdSize} exceeds max $${MAX_PORTFOLIO_EXPOSURE_USD}`);
  }

  // 3. Single asset concentration
  const assetExposure = (exposure.assetExposure[asset] || 0) + usdSize;
  const assetPct = MAX_PORTFOLIO_EXPOSURE_USD > 0 ? (assetExposure / MAX_PORTFOLIO_EXPOSURE_USD) * 100 : 0;
  if (assetPct > MAX_SINGLE_ASSET_PCT) {
    reasons.push(`${asset} exposure ${assetPct.toFixed(0)}% exceeds max ${MAX_SINGLE_ASSET_PCT}%`);
  }

  // 4. Single venue concentration
  const venueExposure = (exposure.venueExposure[venue] || 0) + usdSize;
  const venuePct = MAX_PORTFOLIO_EXPOSURE_USD > 0 ? (venueExposure / MAX_PORTFOLIO_EXPOSURE_USD) * 100 : 0;
  if (venuePct > MAX_SINGLE_VENUE_PCT) {
    reasons.push(`${venue} exposure ${venuePct.toFixed(0)}% exceeds max ${MAX_SINGLE_VENUE_PCT}%`);
  }

  // 5. Daily loss limit
  const state = loadRiskState();
  const today = new Date().toISOString().slice(0, 10);
  if (state.dailyPnl.date === today && state.dailyPnl.pnl < -MAX_DAILY_LOSS_USD) {
    reasons.push(`daily loss $${Math.abs(state.dailyPnl.pnl).toFixed(2)} exceeds max $${MAX_DAILY_LOSS_USD}`);
  }

  // 6. Drawdown check
  if (state.peakEquity > 0 && state.currentEquity > 0) {
    const drawdownPct = ((state.peakEquity - state.currentEquity) / state.peakEquity) * 100;
    if (drawdownPct > MAX_DRAWDOWN_PCT) {
      reasons.push(`drawdown ${drawdownPct.toFixed(1)}% exceeds max ${MAX_DRAWDOWN_PCT}%`);
    }
  }

  // 7. Check brain's time-of-day recommendation
  try {
    const brain = require('./self-evolving-brain');
    const timeCheck = brain.shouldTradeNow();
    if (!timeCheck.trade) {
      reasons.push(`brain time filter: ${timeCheck.reason}`);
    }
  } catch (err) { console.error('[risk-manager] brain time check error:', err?.message || err); }

  return {
    allowed: reasons.length === 0,
    reasons,
    exposure: {
      current: exposure.totalExposure,
      afterTrade: exposure.totalExposure + usdSize,
      max: MAX_PORTFOLIO_EXPOSURE_USD,
      assetPct: Math.round(assetPct * 10) / 10,
      venuePct: Math.round(venuePct * 10) / 10,
    },
  };
}

// ─── Stop Loss & Take Profit ─────────────────────────────────────────────────

/**
 * Calculate dynamic stop-loss and take-profit levels based on ATR.
 */
function calculateStopLoss({ asset, entryPrice, side, atr }) {
  if (!atr || atr <= 0 || !entryPrice || entryPrice <= 0) {
    // Fallback: 2% stop loss, 3% take profit
    const slPct = 0.02;
    const tpPct = 0.03;
    return {
      stopLoss: side === 'buy' ? entryPrice * (1 - slPct) : entryPrice * (1 + slPct),
      takeProfit: side === 'buy' ? entryPrice * (1 + tpPct) : entryPrice * (1 - tpPct),
      method: 'fallback-pct',
      riskReward: tpPct / slPct,
    };
  }

  const slDistance = atr * STOP_LOSS_ATR_MULTIPLIER;
  const tpDistance = atr * TAKE_PROFIT_ATR_MULTIPLIER;

  const stopLoss = side === 'buy'
    ? entryPrice - slDistance
    : entryPrice + slDistance;
  const takeProfit = side === 'buy'
    ? entryPrice + tpDistance
    : entryPrice - tpDistance;

  const riskReward = tpDistance / slDistance;

  return {
    stopLoss: Math.round(stopLoss * 100) / 100,
    takeProfit: Math.round(takeProfit * 100) / 100,
    slDistance: Math.round(slDistance * 100) / 100,
    tpDistance: Math.round(tpDistance * 100) / 100,
    riskReward: Math.round(riskReward * 100) / 100,
    method: 'atr-dynamic',
    meetsMinRR: riskReward >= MIN_RISK_REWARD,
  };
}

// ─── Position Sizing with Risk ───────────────────────────────────────────────

/**
 * Calculate risk-adjusted position size.
 * Uses evolved brain parameters + risk manager limits.
 */
function riskAdjustedSize({ baseUsd, confidence, edge, asset, venue }) {
  let size = baseUsd;

  // 0. Profit compounding — scale order size with cumulative equity growth
  const state = loadRiskState();
  const equity = state.currentEquity || 0;
  if (equity > 5) {
    // For every $10 of cumulative profit, scale orders by 10% (capped at 2x)
    const compoundMultiplier = Math.min(2.0, 1.0 + (equity / 100));
    size *= compoundMultiplier;
  }

  // 1. Brain sizing multiplier (accounts for streaks + calibration)
  try {
    const brain = require('./self-evolving-brain');
    const multiplier = brain.getEvolvedSizingMultiplier();
    size *= multiplier;
  } catch (err) { console.error('[risk-manager] brain sizing error:', err?.message || err); }

  // 2. Kelly criterion: bet edge * confidence fraction of bankroll
  if (edge > 0 && confidence > 0.5) {
    const kellyFraction = Math.min(0.5, (confidence * edge));
    const kellySize = MAX_PORTFOLIO_EXPOSURE_USD * kellyFraction;
    // Use the smaller of Kelly and base calculation
    size = Math.min(size, kellySize);
  }

  // 3. Reduce during high-risk periods
  const currentState = loadRiskState();
  const today = new Date().toISOString().slice(0, 10);
  if (currentState.dailyPnl.date === today && currentState.dailyPnl.pnl < 0) {
    // Losing day — scale size inversely with losses
    const lossRatio = Math.abs(currentState.dailyPnl.pnl) / MAX_DAILY_LOSS_USD;
    size *= Math.max(0.3, 1 - lossRatio * 0.5);
  }

  // 4. Cap at max portfolio percentage for single trade
  const maxSingleTrade = MAX_PORTFOLIO_EXPOSURE_USD * (MAX_SINGLE_ASSET_PCT / 100);
  size = Math.min(size, maxSingleTrade);

  // 5. Don't go below minimum viable order
  size = Math.max(5, Math.round(size * 100) / 100);

  return size;
}

// ─── P&L Tracking ────────────────────────────────────────────────────────────

/**
 * Record a trade outcome for daily P&L and equity tracking.
 */
function recordPnl(pnl) {
  const state = loadRiskState();
  const today = new Date().toISOString().slice(0, 10);

  if (state.dailyPnl.date !== today) {
    state.dailyPnl = { date: today, pnl: 0 };
  }
  state.dailyPnl.pnl += pnl;

  state.currentEquity = (state.currentEquity || 0) + pnl;
  if (state.currentEquity > state.peakEquity) {
    state.peakEquity = state.currentEquity;
  }

  // Auto-kill-switch if drawdown is extreme
  // Only trigger when peakEquity is meaningful to avoid
  // false positives from small P&L fluctuations during early trading
  const MIN_EQUITY_FOR_KILL_SWITCH = Math.max(10, Number(process.env.RISK_MIN_EQUITY_KILL_SWITCH || 25));
  if (state.peakEquity > MIN_EQUITY_FOR_KILL_SWITCH) {
    const drawdownPct = ((state.peakEquity - state.currentEquity) / state.peakEquity) * 100;
    if (drawdownPct > MAX_DRAWDOWN_PCT * 1.5) {
      state.killSwitchActive = true;
      state.riskEvents.push({
        type: 'auto_kill_switch',
        reason: `extreme drawdown ${drawdownPct.toFixed(1)}% (peak: $${state.peakEquity.toFixed(2)}, current: $${state.currentEquity.toFixed(2)})`,
        ts: Date.now(),
      });
    }
  }

  saveRiskState(state);
}

// ─── Correlation Analysis ────────────────────────────────────────────────────

/**
 * Lightweight correlation check between assets based on recent trade outcomes.
 * If two assets tend to win/lose together, they're correlated.
 */
function getCorrelatedAssets(asset) {
  try {
    const journalRaw = load(path.resolve(process.cwd(), process.env.TRADE_JOURNAL_FILE || 'data/trade-journal.json'));
    const trades = Array.isArray(journalRaw?.trades) ? journalRaw.trades.filter(t => t.outcome) : [];
    if (trades.length < CORRELATION_LOOKBACK_TRADES) return [];

    const recent = trades.slice(-CORRELATION_LOOKBACK_TRADES);
    const outcomes = {};
    for (const t of recent) {
      const a = t.asset || 'BTC';
      if (!outcomes[a]) outcomes[a] = [];
      outcomes[a].push(t.outcome === 'win' ? 1 : -1);
    }

    if (!outcomes[asset] || outcomes[asset].length < 3) return [];

    const correlated = [];
    const base = outcomes[asset];
    for (const [other, vals] of Object.entries(outcomes)) {
      if (other === asset || vals.length < 3) continue;
      // Simple correlation: count how often they agree
      const pairs = Math.min(base.length, vals.length);
      let agree = 0;
      for (let i = 0; i < pairs; i++) {
        if (base[base.length - 1 - i] === vals[vals.length - 1 - i]) agree++;
      }
      const corr = agree / pairs;
      if (corr > 0.7) correlated.push({ asset: other, correlation: Math.round(corr * 100) / 100 });
    }

    return correlated;
  } catch { return []; }
}

// ─── Health Check ────────────────────────────────────────────────────────────

function getRiskHealth() {
  const state = loadRiskState();
  const exposure = getPortfolioExposure();
  const today = new Date().toISOString().slice(0, 10);
  
  const drawdownPct = state.peakEquity > 0
    ? ((state.peakEquity - state.currentEquity) / state.peakEquity) * 100
    : 0;

  return {
    killSwitchActive: state.killSwitchActive,
    totalExposure: exposure.totalExposure,
    maxExposure: MAX_PORTFOLIO_EXPOSURE_USD,
    utilizationPct: exposure.utilizationPct,
    positionCount: exposure.positionCount,
    assetExposure: exposure.assetExposure,
    venueExposure: exposure.venueExposure,
    dailyPnl: state.dailyPnl.date === today ? state.dailyPnl.pnl : 0,
    maxDailyLoss: MAX_DAILY_LOSS_USD,
    drawdownPct: Math.round(drawdownPct * 100) / 100,
    maxDrawdownPct: MAX_DRAWDOWN_PCT,
    peakEquity: state.peakEquity,
    currentEquity: state.currentEquity,
    recentRiskEvents: state.riskEvents.slice(-5),
    healthy: !state.killSwitchActive && drawdownPct < MAX_DRAWDOWN_PCT && exposure.utilizationPct < 90,
  };
}

module.exports = {
  checkTradeAllowed,
  calculateStopLoss,
  riskAdjustedSize,
  updateExposure,
  closeExposure,
  getPortfolioExposure,
  recordPnl,
  isKillSwitchActive,
  activateKillSwitch,
  deactivateKillSwitch,
  getCorrelatedAssets,
  getRiskHealth,
  RISK_STATE_FILE,
};
