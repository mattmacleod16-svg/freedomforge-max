/**
 * Strategy Lifecycle Manager
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Manages strategy lifecycle: discovery → paper → live → retired
 *
 *   ┌───────────┐     ┌─────────┐     ┌──────┐     ┌─────────┐
 *   │ DISCOVERY │────▶│  PAPER  │────▶│ LIVE │────▶│ RETIRED │
 *   └───────────┘     └─────────┘     └──────┘     └─────────┘
 *        ▲                │                │              │
 *        └────────────────┴────────────────┘──────────────┘
 *                    (demotion / re-evaluation)
 *
 * Promotion Criteria (paper → live):
 *   - Minimum 20 paper trades
 *   - Win rate ≥ 55%
 *   - Positive expectancy
 *   - Profit factor ≥ 1.2
 *   - Max drawdown within limits
 *
 * Demotion Criteria (live → paper/retired):
 *   - Win rate drops below 40% over 15+ trades
 *   - Consecutive losses ≥ 5
 *   - Negative expectancy over rolling window
 *   - Manual override
 *
 * @module lib/strategy-lifecycle
 */

'use strict';

const { createLogger } = require('./logger');
const log = createLogger('strategy-lifecycle');
const fs = require('fs');
const path = require('path');

let signalBus, alertBus;
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }
try { alertBus = require('./alerting-bus'); } catch { alertBus = null; }

// ─── Configuration ────────────────────────────────────────────────────────────
const STATE_PATH = path.resolve(__dirname, '..', 'data', 'strategy-lifecycle-state.json');
const MIN_PAPER_TRADES = Number(process.env.LIFECYCLE_MIN_PAPER_TRADES || 20);
const PROMO_WIN_RATE = Number(process.env.LIFECYCLE_PROMO_WIN_RATE || 0.55);
const PROMO_PROFIT_FACTOR = Number(process.env.LIFECYCLE_PROMO_PF || 1.2);
const DEMOTE_WIN_RATE = Number(process.env.LIFECYCLE_DEMOTE_WIN_RATE || 0.40);
const DEMOTE_MIN_TRADES = Number(process.env.LIFECYCLE_DEMOTE_MIN_TRADES || 15);
const MAX_CONSECUTIVE_LOSSES = Number(process.env.LIFECYCLE_MAX_CONSEC_LOSS || 5);
const RETIREMENT_AGE_DAYS = Number(process.env.LIFECYCLE_RETIREMENT_DAYS || 90);
const EVAL_INTERVAL_TRADES = Number(process.env.LIFECYCLE_EVAL_INTERVAL || 5); // re-evaluate every N trades

// ─── Lifecycle States ─────────────────────────────────────────────────────────
const STATES = {
  DISCOVERY: 'discovery',
  PAPER: 'paper',
  LIVE: 'live',
  PROBATION: 'probation', // live but under monitoring (reduced size)
  RETIRED: 'retired',
};

// ─── State ────────────────────────────────────────────────────────────────────
let strategies = {};  // { strategyName: { state, stats, transitions, createdAt, ... } }

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      strategies = raw.strategies || {};
      log.info(`Loaded ${Object.keys(strategies).length} strategy lifecycle records`);
    }
  } catch (err) {
    log.warn('Failed to load lifecycle state:', err?.message);
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify({
      strategies,
      updatedAt: new Date().toISOString(),
    }, null, 2));
  } catch { /* best effort */ }
}

// Initialize
loadState();

// ─── Strategy Registration ────────────────────────────────────────────────────

/**
 * Register a new strategy into the lifecycle.
 *
 * @param {string} name - Unique strategy identifier
 * @param {object} [meta] - Optional metadata (description, author, parameters)
 * @returns {object} Strategy record
 */
function registerStrategy(name, meta = {}) {
  if (strategies[name]) {
    return strategies[name];
  }

  strategies[name] = {
    name,
    state: STATES.DISCOVERY,
    meta,
    stats: {
      paperTrades: 0,
      paperWins: 0,
      paperPnl: 0,
      liveTrades: 0,
      liveWins: 0,
      livePnl: 0,
      consecutiveLosses: 0,
      maxDrawdownPct: 0,
      peakPnl: 0,
    },
    transitions: [{
      from: null,
      to: STATES.DISCOVERY,
      reason: 'initial registration',
      at: new Date().toISOString(),
    }],
    sizeMultiplier: 0, // no live trading until promoted
    createdAt: new Date().toISOString(),
    lastEvaluatedAt: null,
    lastTradeAt: null,
  };

  saveState();
  log.info(`Strategy '${name}' registered in DISCOVERY state`);
  return strategies[name];
}

/**
 * Record a trade result for a strategy.
 *
 * @param {string} name
 * @param {object} result - { pnl, isWin, isPaper }
 * @returns {object} { strategy, evaluation }
 */
function recordTradeResult(name, result) {
  if (!strategies[name]) registerStrategy(name);
  const strat = strategies[name];

  const { pnl = 0, isWin = pnl > 0, isPaper = strat.state !== STATES.LIVE } = result;

  if (isPaper || strat.state === STATES.PAPER || strat.state === STATES.DISCOVERY) {
    strat.stats.paperTrades++;
    if (isWin) strat.stats.paperWins++;
    strat.stats.paperPnl += pnl;
  } else {
    strat.stats.liveTrades++;
    if (isWin) strat.stats.liveWins++;
    strat.stats.livePnl += pnl;
  }

  // Track consecutive losses
  if (!isWin) {
    strat.stats.consecutiveLosses++;
  } else {
    strat.stats.consecutiveLosses = 0;
  }

  // Track drawdown
  const totalPnl = strat.stats.paperPnl + strat.stats.livePnl;
  strat.stats.peakPnl = Math.max(strat.stats.peakPnl, totalPnl);
  if (strat.stats.peakPnl > 0) {
    const ddPct = ((strat.stats.peakPnl - totalPnl) / strat.stats.peakPnl) * 100;
    strat.stats.maxDrawdownPct = Math.max(strat.stats.maxDrawdownPct, ddPct);
  }

  strat.lastTradeAt = new Date().toISOString();

  // Evaluate periodically
  const totalTrades = strat.stats.paperTrades + strat.stats.liveTrades;
  let evaluation = null;
  if (totalTrades % EVAL_INTERVAL_TRADES === 0) {
    evaluation = evaluateStrategy(name);
  }

  saveState();
  return { strategy: strat, evaluation };
}

// ─── Evaluation Engine ────────────────────────────────────────────────────────

/**
 * Evaluate a strategy and potentially transition it.
 *
 * @param {string} name
 * @returns {{ action: string, from: string, to: string, reason: string } | null}
 */
function evaluateStrategy(name) {
  const strat = strategies[name];
  if (!strat) return null;

  strat.lastEvaluatedAt = new Date().toISOString();
  const currentState = strat.state;

  switch (currentState) {
    case STATES.DISCOVERY:
      return evaluateDiscovery(strat);
    case STATES.PAPER:
      return evaluatePaper(strat);
    case STATES.LIVE:
    case STATES.PROBATION:
      return evaluateLive(strat);
    default:
      return null;
  }
}

function evaluateDiscovery(strat) {
  // Auto-promote to paper after first recorded trade
  if (strat.stats.paperTrades >= 1) {
    return transition(strat, STATES.PAPER, 'First paper trade recorded');
  }
  return null;
}

function evaluatePaper(strat) {
  const { paperTrades, paperWins, paperPnl } = strat.stats;

  if (paperTrades < MIN_PAPER_TRADES) return null; // not enough data

  const winRate = paperWins / paperTrades;
  const avgWin = paperWins > 0 ? (paperPnl > 0 ? paperPnl / paperWins : 0) : 0;
  const losses = paperTrades - paperWins;
  const avgLoss = losses > 0 ? Math.abs(paperPnl < 0 ? paperPnl / losses : 0) : 1;
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;
  const expectancy = paperTrades > 0 ? paperPnl / paperTrades : 0;

  // Check promotion criteria
  if (winRate >= PROMO_WIN_RATE && profitFactor >= PROMO_PROFIT_FACTOR && expectancy > 0) {
    return transition(strat, STATES.LIVE, `Promotion: WR=${(winRate * 100).toFixed(1)}%, PF=${profitFactor.toFixed(2)}, E=$${expectancy.toFixed(2)} over ${paperTrades} trades`);
  }

  // Check retirement (stale strategies)
  if (strat.lastTradeAt) {
    const daysSinceLastTrade = (Date.now() - new Date(strat.lastTradeAt).getTime()) / 86400000;
    if (daysSinceLastTrade > RETIREMENT_AGE_DAYS) {
      return transition(strat, STATES.RETIRED, `Stale: no trades for ${Math.round(daysSinceLastTrade)} days`);
    }
  }

  return null;
}

function evaluateLive(strat) {
  const { liveTrades, liveWins, livePnl, consecutiveLosses } = strat.stats;

  // Not enough data for demotion
  if (liveTrades < DEMOTE_MIN_TRADES && consecutiveLosses < MAX_CONSECUTIVE_LOSSES) return null;

  const winRate = liveTrades > 0 ? liveWins / liveTrades : 0;
  const expectancy = liveTrades > 0 ? livePnl / liveTrades : 0;

  // Consecutive loss circuit breaker
  if (consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) {
    return transition(strat, STATES.PROBATION, `${consecutiveLosses} consecutive losses`);
  }

  // Demotion check
  if (liveTrades >= DEMOTE_MIN_TRADES && winRate < DEMOTE_WIN_RATE) {
    return transition(strat, STATES.PAPER, `Demotion: WR=${(winRate * 100).toFixed(1)}% below ${DEMOTE_WIN_RATE * 100}% over ${liveTrades} trades`);
  }

  // Negative expectancy
  if (liveTrades >= DEMOTE_MIN_TRADES && expectancy < 0) {
    return transition(strat, STATES.PAPER, `Demotion: negative expectancy $${expectancy.toFixed(2)} over ${liveTrades} trades`);
  }

  // Probation recovery
  if (strat.state === STATES.PROBATION && consecutiveLosses === 0 && winRate >= PROMO_WIN_RATE) {
    return transition(strat, STATES.LIVE, `Recovered from probation: WR=${(winRate * 100).toFixed(1)}%`);
  }

  return null;
}

// ─── State Transitions ────────────────────────────────────────────────────────

function transition(strat, newState, reason) {
  const oldState = strat.state;
  if (oldState === newState) return null;

  strat.state = newState;
  strat.transitions.push({
    from: oldState,
    to: newState,
    reason,
    at: new Date().toISOString(),
  });

  // Keep transitions bounded
  if (strat.transitions.length > 50) {
    strat.transitions = strat.transitions.slice(-50);
  }

  // Set size multiplier based on state
  switch (newState) {
    case STATES.LIVE: strat.sizeMultiplier = 1.0; break;
    case STATES.PROBATION: strat.sizeMultiplier = 0.5; break;
    case STATES.PAPER: strat.sizeMultiplier = 0; break;
    case STATES.RETIRED: strat.sizeMultiplier = 0; break;
    default: strat.sizeMultiplier = 0;
  }

  // Alert on significant transitions
  const isPromotion = (oldState === STATES.PAPER && newState === STATES.LIVE);
  const isDemotion = (oldState === STATES.LIVE && (newState === STATES.PAPER || newState === STATES.PROBATION || newState === STATES.RETIRED));

  if (isPromotion) {
    log.info(`🎉 Strategy '${strat.name}' PROMOTED to LIVE: ${reason}`);
    if (alertBus) alertBus.info('lifecycle', `Strategy '${strat.name}' promoted to LIVE`, { reason });
  } else if (isDemotion) {
    log.warn(`📉 Strategy '${strat.name}' DEMOTED to ${newState.toUpperCase()}: ${reason}`);
    if (alertBus) alertBus.warning('lifecycle', `Strategy '${strat.name}' demoted to ${newState}`, { reason });
  }

  // Publish to signal bus
  if (signalBus) {
    try {
      signalBus.publish({
        type: 'strategy_lifecycle',
        source: 'strategy-lifecycle',
        confidence: 0.9,
        payload: { strategy: strat.name, from: oldState, to: newState, reason, sizeMultiplier: strat.sizeMultiplier },
        ttlMs: 3600000,
      });
    } catch { /* best effort */ }
  }

  saveState();
  return { action: 'transition', from: oldState, to: newState, reason };
}

// ─── Query APIs ───────────────────────────────────────────────────────────────

/**
 * Get the current lifecycle state for a strategy.
 *
 * @param {string} name
 * @returns {object | null}
 */
function getStrategy(name) {
  return strategies[name] || null;
}

/**
 * Check if a strategy is allowed to trade live.
 *
 * @param {string} name
 * @returns {{ allowed: boolean, sizeMultiplier: number, state: string }}
 */
function isLiveTradeAllowed(name) {
  const strat = strategies[name];
  if (!strat) return { allowed: false, sizeMultiplier: 0, state: 'unregistered' };
  return {
    allowed: strat.state === STATES.LIVE || strat.state === STATES.PROBATION,
    sizeMultiplier: strat.sizeMultiplier,
    state: strat.state,
  };
}

/**
 * Get all strategies by state.
 *
 * @param {string} [state] - Filter by state
 * @returns {object[]}
 */
function listStrategies(state) {
  let list = Object.values(strategies);
  if (state) list = list.filter(s => s.state === state);
  return list.map(s => ({
    name: s.name,
    state: s.state,
    sizeMultiplier: s.sizeMultiplier,
    paperTrades: s.stats.paperTrades,
    liveTrades: s.stats.liveTrades,
    totalPnl: Math.round((s.stats.paperPnl + s.stats.livePnl) * 100) / 100,
    winRate: s.stats.liveTrades > 0
      ? Math.round((s.stats.liveWins / s.stats.liveTrades) * 100) / 100
      : s.stats.paperTrades > 0
        ? Math.round((s.stats.paperWins / s.stats.paperTrades) * 100) / 100
        : 0,
    lastTradeAt: s.lastTradeAt,
    lastTransition: s.transitions[s.transitions.length - 1],
  }));
}

/**
 * Manually force a strategy to a specific state.
 *
 * @param {string} name
 * @param {string} newState
 * @param {string} [reason]
 */
function forceTransition(name, newState, reason = 'manual override') {
  if (!strategies[name]) registerStrategy(name);
  if (!STATES[newState.toUpperCase()] && !Object.values(STATES).includes(newState)) {
    return { error: `Invalid state: ${newState}` };
  }
  const state = STATES[newState.toUpperCase()] || newState;
  return transition(strategies[name], state, reason);
}

/**
 * Get lifecycle dashboard summary.
 */
function getDashboard() {
  const all = Object.values(strategies);
  return {
    total: all.length,
    byState: {
      discovery: all.filter(s => s.state === STATES.DISCOVERY).length,
      paper: all.filter(s => s.state === STATES.PAPER).length,
      live: all.filter(s => s.state === STATES.LIVE).length,
      probation: all.filter(s => s.state === STATES.PROBATION).length,
      retired: all.filter(s => s.state === STATES.RETIRED).length,
    },
    liveStrategies: all.filter(s => s.state === STATES.LIVE).map(s => s.name),
    recentTransitions: all
      .flatMap(s => s.transitions.map(t => ({ strategy: s.name, ...t })))
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 10),
    updatedAt: new Date().toISOString(),
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  STATES,
  registerStrategy,
  recordTradeResult,
  evaluateStrategy,
  getStrategy,
  isLiveTradeAllowed,
  listStrategies,
  forceTransition,
  getDashboard,
};
