/**
 * Strategy Promoter — Backtest-gated strategy promotion pipeline.
 * ========================================================================
 *
 * Validates new trading strategies through a rigorous lifecycle before
 * they reach live trading. Each promotion stage requires passing specific
 * quantitative gates to prevent under-tested strategies from risking
 * real capital.
 *
 * Lifecycle:
 *   CANDIDATE -> BACKTESTING -> PAPER_TRADING -> LIVE_SMALL -> LIVE_FULL
 *
 * Usage:
 *   const promoter = require('../lib/strategy-promoter');
 *   promoter.registerStrategy({ name: 'momentum-v1', description: '...', weights: {...}, thresholds: {...}, author: 'brain' });
 *   const result = await promoter.promoteStrategy('momentum-v1');
 *   const active = promoter.getActiveStrategies();
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ─── Dependencies (graceful optional loading) ───────────────────────────────

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

const { createLogger } = require('./logger');
const _log = createLogger('strategy-promoter');

let backtestEngine;
try { backtestEngine = require('./backtest/engine'); } catch { backtestEngine = null; }

let dataLoader;
try { dataLoader = require('./backtest/data-loader'); } catch { dataLoader = null; }

let tradeJournal;
try { tradeJournal = require('./trade-journal'); } catch { tradeJournal = null; }

// ─── Constants ──────────────────────────────────────────────────────────────

const REGISTRY_FILE = path.resolve(process.cwd(), 'data/strategy-registry.json');

const STATUSES = {
  CANDIDATE:     'CANDIDATE',
  BACKTESTING:   'BACKTESTING',
  PAPER_TRADING: 'PAPER_TRADING',
  LIVE_SMALL:    'LIVE_SMALL',
  LIVE_FULL:     'LIVE_FULL',
};

const STATUS_ORDER = [
  STATUSES.CANDIDATE,
  STATUSES.BACKTESTING,
  STATUSES.PAPER_TRADING,
  STATUSES.LIVE_SMALL,
  STATUSES.LIVE_FULL,
];

/**
 * Promotion gate thresholds.
 * Each gate defines the minimum criteria a strategy must meet to advance.
 */
const GATES = {
  // CANDIDATE -> BACKTESTING: must pass backtest
  backtest: {
    minSharpe:        0.5,
    maxDrawdownPct:   0.20,  // 20%
    minProfitFactor:  1.2,
    minTotalTrades:   30,
  },
  // PAPER_TRADING -> LIVE_SMALL: must pass paper period
  paper: {
    minDays:          7,
    minWinRatePct:    45,    // 45%
    minProfitFactor:  1.0,
  },
  // LIVE_SMALL -> LIVE_FULL: must pass live small period
  liveSmall: {
    minDays:          14,
    minSharpe:        0.3,
    noKillSwitchTriggers: true,
  },
};

const LIVE_SMALL_POSITION_FRACTION = 0.10; // 10% of normal position size
const MAX_PROMOTION_HISTORY = 100;         // Cap per-strategy history entries

const TAG = '[strategy-promoter]';

// ─── State Persistence ──────────────────────────────────────────────────────

/**
 * Load the strategy registry from disk.
 * @returns {{ strategies: Record<string, object> }}
 */
function loadRegistry() {
  const fallback = { strategies: {} };
  if (rio) {
    const data = rio.readJsonSafe(REGISTRY_FILE, { fallback });
    if (!data || typeof data !== 'object') return fallback;
    if (!data.strategies || typeof data.strategies !== 'object') data.strategies = {};
    return data;
  }
  try {
    if (!fs.existsSync(REGISTRY_FILE)) return fallback;
    const raw = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') return fallback;
    if (!raw.strategies || typeof raw.strategies !== 'object') raw.strategies = {};
    return raw;
  } catch {
    return fallback;
  }
}

/**
 * Save the strategy registry to disk with atomic writes.
 * @param {object} registry
 */
function saveRegistry(registry) {
  if (rio) {
    rio.writeJsonAtomic(REGISTRY_FILE, registry);
    return;
  }
  const dir = path.dirname(REGISTRY_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = REGISTRY_FILE + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2));
  fs.renameSync(tmp, REGISTRY_FILE);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Get the index of a status in the lifecycle.
 * @param {string} status
 * @returns {number}
 */
function statusIndex(status) {
  const idx = STATUS_ORDER.indexOf(status);
  return idx >= 0 ? idx : -1;
}

/**
 * Calculate the number of days between a timestamp and now.
 * @param {number} ts - Epoch milliseconds
 * @returns {number}
 */
function daysSince(ts) {
  if (!ts || typeof ts !== 'number') return 0;
  return (Date.now() - ts) / (24 * 60 * 60 * 1000);
}

/**
 * Add a promotion/demotion event to a strategy's history, capping the array.
 * @param {object} strategy
 * @param {object} event
 */
function addHistory(strategy, event) {
  if (!Array.isArray(strategy.promotionHistory)) {
    strategy.promotionHistory = [];
  }
  strategy.promotionHistory.push(event);
  if (strategy.promotionHistory.length > MAX_PROMOTION_HISTORY) {
    strategy.promotionHistory = strategy.promotionHistory.slice(-MAX_PROMOTION_HISTORY);
  }
}

// ─── Core API ───────────────────────────────────────────────────────────────

/**
 * Register a new strategy as a CANDIDATE.
 *
 * @param {object} config
 * @param {string} config.name        - Unique strategy identifier
 * @param {string} [config.description] - Human-readable description
 * @param {object} [config.weights]    - Indicator weights for the strategy
 * @param {object} [config.thresholds] - Signal thresholds
 * @param {string} [config.author]     - Who or what created this strategy
 * @returns {{ ok: boolean, strategy: object, message: string }}
 */
function registerStrategy(config) {
  if (!config || !config.name || typeof config.name !== 'string') {
    return { ok: false, strategy: null, message: 'Strategy name is required.' };
  }

  const name = config.name.trim();
  if (!name) {
    return { ok: false, strategy: null, message: 'Strategy name cannot be empty.' };
  }

  const registry = loadRegistry();

  if (registry.strategies[name]) {
    return {
      ok: false,
      strategy: registry.strategies[name],
      message: `Strategy "${name}" already exists (status: ${registry.strategies[name].status}).`,
    };
  }

  const now = Date.now();
  const strategy = {
    name,
    description: config.description || '',
    status: STATUSES.CANDIDATE,
    weights: config.weights || {},
    thresholds: config.thresholds || {},
    author: config.author || 'unknown',
    backtestResult: null,
    paperTradingStart: null,
    liveSmallStart: null,
    liveFullStart: null,
    promotionHistory: [],
    performance: {
      trades: 0,
      winRate: 0,
      sharpe: 0,
      profitFactor: 0,
      maxDrawdown: 0,
    },
    positionSizeFraction: 1.0,
    createdAt: now,
    updatedAt: now,
  };

  registry.strategies[name] = strategy;
  saveRegistry(registry);

  _log.info(`Registered strategy "${name}" as CANDIDATE.`);
  return { ok: true, strategy, message: `Strategy "${name}" registered as CANDIDATE.` };
}

/**
 * Promote a strategy to the next lifecycle stage.
 * Each promotion runs the appropriate gate checks.
 *
 * @param {string} name - Strategy name
 * @returns {Promise<{ ok: boolean, from: string, to: string, gate: object, message: string }>}
 */
async function promoteStrategy(name) {
  const registry = loadRegistry();
  const strategy = registry.strategies[name];

  if (!strategy) {
    return { ok: false, from: null, to: null, gate: null, message: `Strategy "${name}" not found.` };
  }

  const currentIdx = statusIndex(strategy.status);
  if (currentIdx < 0 || currentIdx >= STATUS_ORDER.length - 1) {
    return {
      ok: false,
      from: strategy.status,
      to: null,
      gate: null,
      message: `Strategy "${name}" is already at ${strategy.status} (max level) or has an invalid status.`,
    };
  }

  const from = strategy.status;
  const to = STATUS_ORDER[currentIdx + 1];

  // ── Gate: CANDIDATE -> BACKTESTING ──────────────────────────────────────
  if (from === STATUSES.CANDIDATE && to === STATUSES.BACKTESTING) {
    const gateResult = await runBacktestGate(strategy);
    if (!gateResult.passed) {
      return {
        ok: false,
        from,
        to,
        gate: gateResult,
        message: `Strategy "${name}" failed backtest gate: ${gateResult.reason}`,
      };
    }

    strategy.backtestResult = gateResult.result;
    strategy.performance.sharpe = gateResult.result.sharpeRatio || 0;
    strategy.performance.maxDrawdown = gateResult.result.maxDrawdown || 0;
    strategy.performance.profitFactor = gateResult.result.profitFactor || 0;
    strategy.performance.winRate = Math.round((gateResult.result.winRate || 0) * 100);
    strategy.performance.trades = gateResult.result.totalTrades || 0;
    strategy.status = to;
    strategy.updatedAt = Date.now();

    addHistory(strategy, {
      from,
      to,
      ts: Date.now(),
      gate: {
        sharpe: gateResult.result.sharpeRatio,
        maxDrawdown: gateResult.result.maxDrawdown,
        profitFactor: gateResult.result.profitFactor,
        totalTrades: gateResult.result.totalTrades,
      },
    });

    saveRegistry(registry);
    _log.info(`Promoted "${name}": ${from} -> ${to}`, { sharpe: gateResult.result.sharpeRatio });
    return { ok: true, from, to, gate: gateResult, message: `Promoted to ${to}.` };
  }

  // ── Gate: BACKTESTING -> PAPER_TRADING ──────────────────────────────────
  if (from === STATUSES.BACKTESTING && to === STATUSES.PAPER_TRADING) {
    // Must have a passing backtest result already
    if (!strategy.backtestResult) {
      return {
        ok: false,
        from,
        to,
        gate: { passed: false, reason: 'No backtest result found. Run backtest first.' },
        message: `Strategy "${name}" has no backtest result.`,
      };
    }

    strategy.status = to;
    strategy.paperTradingStart = Date.now();
    strategy.positionSizeFraction = 0; // Paper trading: no real capital
    strategy.updatedAt = Date.now();

    addHistory(strategy, {
      from,
      to,
      ts: Date.now(),
      gate: { paperTradingStarted: true, durationDays: GATES.paper.minDays },
    });

    saveRegistry(registry);
    _log.info(`Promoted "${name}": ${from} -> ${to}`, { paperDays: GATES.paper.minDays });
    return {
      ok: true,
      from,
      to,
      gate: { passed: true, paperTradingStart: strategy.paperTradingStart },
      message: `Promoted to ${to}. Paper trading period of ${GATES.paper.minDays} days started.`,
    };
  }

  // ── Gate: PAPER_TRADING -> LIVE_SMALL ──────────────────────────────────
  if (from === STATUSES.PAPER_TRADING && to === STATUSES.LIVE_SMALL) {
    const gateResult = evaluatePaperGate(strategy);
    if (!gateResult.passed) {
      return {
        ok: false,
        from,
        to,
        gate: gateResult,
        message: `Strategy "${name}" failed paper trading gate: ${gateResult.reason}`,
      };
    }

    strategy.status = to;
    strategy.liveSmallStart = Date.now();
    strategy.positionSizeFraction = LIVE_SMALL_POSITION_FRACTION;
    strategy.updatedAt = Date.now();

    addHistory(strategy, {
      from,
      to,
      ts: Date.now(),
      gate: {
        daysPaperTraded: gateResult.daysPaperTraded,
        winRate: gateResult.winRate,
        profitFactor: gateResult.profitFactor,
        positionSizeFraction: LIVE_SMALL_POSITION_FRACTION,
      },
    });

    saveRegistry(registry);
    _log.info(`Promoted "${name}": ${from} -> ${to}`, { positionPct: LIVE_SMALL_POSITION_FRACTION * 100 });
    return { ok: true, from, to, gate: gateResult, message: `Promoted to ${to} with ${LIVE_SMALL_POSITION_FRACTION * 100}% sizing.` };
  }

  // ── Gate: LIVE_SMALL -> LIVE_FULL ──────────────────────────────────────
  if (from === STATUSES.LIVE_SMALL && to === STATUSES.LIVE_FULL) {
    const gateResult = evaluateLiveSmallGate(strategy);
    if (!gateResult.passed) {
      return {
        ok: false,
        from,
        to,
        gate: gateResult,
        message: `Strategy "${name}" failed live-small gate: ${gateResult.reason}`,
      };
    }

    strategy.status = to;
    strategy.liveFullStart = Date.now();
    strategy.positionSizeFraction = 1.0; // Full position sizing
    strategy.updatedAt = Date.now();

    addHistory(strategy, {
      from,
      to,
      ts: Date.now(),
      gate: {
        daysLiveSmall: gateResult.daysLiveSmall,
        sharpe: gateResult.sharpe,
        killSwitchClean: gateResult.killSwitchClean,
      },
    });

    saveRegistry(registry);
    _log.info(`Promoted "${name}": ${from} -> ${to} (full position sizing)`);
    return { ok: true, from, to, gate: gateResult, message: `Promoted to ${to}. Full position sizing enabled.` };
  }

  return { ok: false, from, to, gate: null, message: `Unexpected promotion path: ${from} -> ${to}.` };
}

/**
 * Demote a strategy back one level (or to CANDIDATE for serious failures).
 *
 * @param {string} name   - Strategy name
 * @param {string} reason - Explanation for the demotion
 * @returns {{ ok: boolean, from: string, to: string, message: string }}
 */
function demoteStrategy(name, reason) {
  const registry = loadRegistry();
  const strategy = registry.strategies[name];

  if (!strategy) {
    return { ok: false, from: null, to: null, message: `Strategy "${name}" not found.` };
  }

  const from = strategy.status;
  const currentIdx = statusIndex(from);

  if (currentIdx <= 0) {
    return {
      ok: false,
      from,
      to: STATUSES.CANDIDATE,
      message: `Strategy "${name}" is already at CANDIDATE.`,
    };
  }

  // Serious failures (e.g. kill switch triggers at LIVE_SMALL or above) -> CANDIDATE
  const serious = reason && /kill.?switch|critical|emergency|breach/i.test(reason);
  const to = serious ? STATUSES.CANDIDATE : STATUS_ORDER[currentIdx - 1];

  strategy.status = to;
  strategy.updatedAt = Date.now();

  // Reset stage-specific state when demoting significantly
  if (to === STATUSES.CANDIDATE) {
    strategy.backtestResult = null;
    strategy.paperTradingStart = null;
    strategy.liveSmallStart = null;
    strategy.liveFullStart = null;
    strategy.positionSizeFraction = 1.0;
  } else if (statusIndex(to) < statusIndex(STATUSES.LIVE_SMALL)) {
    strategy.liveSmallStart = null;
    strategy.liveFullStart = null;
    strategy.positionSizeFraction = to === STATUSES.PAPER_TRADING ? 0 : 1.0;
  }

  addHistory(strategy, {
    from,
    to,
    ts: Date.now(),
    action: 'demotion',
    reason: reason || 'unspecified',
    serious,
  });

  saveRegistry(registry);
  _log.warn(`Demoted "${name}": ${from} -> ${to}`, { reason: reason || 'unspecified' });
  return { ok: true, from, to, message: `Demoted "${name}" from ${from} to ${to}.` };
}

/**
 * Get all strategies at LIVE_SMALL or LIVE_FULL status.
 * @returns {Array<object>}
 */
function getActiveStrategies() {
  const registry = loadRegistry();
  return Object.values(registry.strategies).filter(
    (s) => s.status === STATUSES.LIVE_SMALL || s.status === STATUSES.LIVE_FULL,
  );
}

/**
 * Review all active strategies against their performance criteria.
 * Demotes any that have degraded below thresholds.
 *
 * @returns {{ reviewed: number, actions: Array<{ name: string, action: string, from: string, to: string, reason: string }> }}
 */
function reviewStrategies() {
  const registry = loadRegistry();
  const actions = [];
  let reviewed = 0;

  for (const strategy of Object.values(registry.strategies)) {
    if (strategy.status !== STATUSES.LIVE_SMALL && strategy.status !== STATUSES.LIVE_FULL) {
      continue;
    }
    reviewed += 1;

    // Refresh live performance from trade journal
    const livePerf = getLivePerformance(strategy.name);
    if (livePerf) {
      strategy.performance.trades = livePerf.closedTrades || strategy.performance.trades;
      strategy.performance.winRate = livePerf.winRate || strategy.performance.winRate;
      strategy.performance.sharpe = livePerf.sharpeRatio || strategy.performance.sharpe;
      strategy.performance.profitFactor = livePerf.profitFactor || strategy.performance.profitFactor;
      strategy.performance.maxDrawdown = livePerf.maxDrawdown || strategy.performance.maxDrawdown;
    }

    // Check degradation criteria
    const reasons = [];

    if (strategy.status === STATUSES.LIVE_FULL) {
      // LIVE_FULL: must maintain Sharpe > 0.3 and win rate > 40%
      if (strategy.performance.sharpe < 0.3 && strategy.performance.trades >= 20) {
        reasons.push(`Sharpe degraded to ${strategy.performance.sharpe} (min: 0.3)`);
      }
      if (strategy.performance.winRate < 40 && strategy.performance.trades >= 20) {
        reasons.push(`Win rate degraded to ${strategy.performance.winRate}% (min: 40%)`);
      }
      if (strategy.performance.profitFactor < 0.9 && strategy.performance.trades >= 20) {
        reasons.push(`Profit factor degraded to ${strategy.performance.profitFactor} (min: 0.9)`);
      }
    }

    if (strategy.status === STATUSES.LIVE_SMALL) {
      // LIVE_SMALL: must maintain profit factor > 0.8 and no critical issues
      if (strategy.performance.profitFactor < 0.8 && strategy.performance.trades >= 15) {
        reasons.push(`Profit factor at ${strategy.performance.profitFactor} (min: 0.8)`);
      }
      if (strategy.performance.winRate < 35 && strategy.performance.trades >= 15) {
        reasons.push(`Win rate at ${strategy.performance.winRate}% (min: 35%)`);
      }
    }

    if (reasons.length > 0) {
      const reason = reasons.join('; ');
      const from = strategy.status;
      const currentIdx = statusIndex(from);

      if (currentIdx > 0) {
        const serious = /kill.?switch|critical|emergency|breach/i.test(reason);
        const to = serious ? STATUSES.CANDIDATE : STATUS_ORDER[currentIdx - 1];

        strategy.status = to;
        strategy.updatedAt = Date.now();

        if (to === STATUSES.CANDIDATE) {
          strategy.backtestResult = null;
          strategy.paperTradingStart = null;
          strategy.liveSmallStart = null;
          strategy.liveFullStart = null;
          strategy.positionSizeFraction = 1.0;
        } else if (statusIndex(to) < statusIndex(STATUSES.LIVE_SMALL)) {
          strategy.liveSmallStart = null;
          strategy.liveFullStart = null;
          strategy.positionSizeFraction = to === STATUSES.PAPER_TRADING ? 0 : 1.0;
        }

        addHistory(strategy, {
          from,
          to,
          ts: Date.now(),
          action: 'demotion',
          reason: reason || 'unspecified',
          serious,
        });

        _log.warn(`Demoted "${strategy.name}": ${from} -> ${to}`, { reason });

        actions.push({
          name: strategy.name,
          action: 'demoted',
          from,
          to,
          reason,
        });
      }
    }
  }

  saveRegistry(registry);

  _log.info(`Reviewed ${reviewed} active strategies, ${actions.length} demoted.`);
  return { reviewed, actions };
}

// ─── Gate Implementations ───────────────────────────────────────────────────

/**
 * Run the backtest gate for CANDIDATE -> BACKTESTING promotion.
 *
 * Requires: Sharpe > 0.5, maxDrawdown < 20%, profitFactor > 1.2, trades >= 30
 *
 * @param {object} strategy
 * @returns {Promise<{ passed: boolean, reason?: string, result?: object }>}
 */
async function runBacktestGate(strategy) {
  if (!backtestEngine) {
    return { passed: false, reason: 'Backtest engine (lib/backtest/engine.js) not available.' };
  }
  if (!dataLoader) {
    return { passed: false, reason: 'Data loader (lib/backtest/data-loader.js) not available.' };
  }

  // Fetch historical data for backtesting
  // Default: BTC 1h candles over the last 6 months
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  let candles;
  try {
    candles = await dataLoader.fetchHistoricalCandles({
      asset: 'BTC',
      interval: '1h',
      startDate,
      endDate,
    });
  } catch (err) {
    return { passed: false, reason: `Failed to fetch historical data: ${err.message}` };
  }

  if (!candles || candles.length < 100) {
    return { passed: false, reason: `Insufficient candle data (got ${candles ? candles.length : 0}, need >= 100).` };
  }

  // Run the backtest with the strategy's weights and thresholds
  let result;
  try {
    result = await backtestEngine.runBacktest({
      candles,
      initialCapital: 1000,
      weights: strategy.weights || {},
      thresholds: strategy.thresholds || {},
    });
  } catch (err) {
    return { passed: false, reason: `Backtest execution failed: ${err.message}` };
  }

  // Evaluate gate criteria
  const failures = [];

  if ((result.sharpeRatio || 0) < GATES.backtest.minSharpe) {
    failures.push(`Sharpe ${result.sharpeRatio} < ${GATES.backtest.minSharpe}`);
  }
  if ((result.maxDrawdown || 0) > GATES.backtest.maxDrawdownPct) {
    failures.push(`MaxDrawdown ${(result.maxDrawdown * 100).toFixed(1)}% > ${GATES.backtest.maxDrawdownPct * 100}%`);
  }
  if ((result.profitFactor || 0) < GATES.backtest.minProfitFactor) {
    failures.push(`ProfitFactor ${result.profitFactor} < ${GATES.backtest.minProfitFactor}`);
  }
  if ((result.totalTrades || 0) < GATES.backtest.minTotalTrades) {
    failures.push(`TotalTrades ${result.totalTrades} < ${GATES.backtest.minTotalTrades}`);
  }

  if (failures.length > 0) {
    return { passed: false, reason: failures.join(', '), result };
  }

  return { passed: true, result };
}

/**
 * Evaluate the paper trading gate for PAPER_TRADING -> LIVE_SMALL.
 *
 * Requires: 7+ days of paper trading, winRate > 45%, profitFactor > 1.0
 *
 * @param {object} strategy
 * @returns {{ passed: boolean, reason?: string, daysPaperTraded?: number, winRate?: number, profitFactor?: number }}
 */
function evaluatePaperGate(strategy) {
  const daysPaperTraded = daysSince(strategy.paperTradingStart);

  if (daysPaperTraded < GATES.paper.minDays) {
    return {
      passed: false,
      reason: `Only ${daysPaperTraded.toFixed(1)} days of paper trading (need ${GATES.paper.minDays}).`,
      daysPaperTraded: Math.round(daysPaperTraded * 10) / 10,
    };
  }

  // Get paper trading performance from the trade journal
  const perf = getLivePerformance(strategy.name);
  const winRate = perf ? (perf.winRate || 0) : (strategy.performance.winRate || 0);
  const profitFactor = perf ? (perf.profitFactor || 0) : (strategy.performance.profitFactor || 0);

  const failures = [];

  if (winRate < GATES.paper.minWinRatePct) {
    failures.push(`WinRate ${winRate}% < ${GATES.paper.minWinRatePct}%`);
  }
  if (profitFactor < GATES.paper.minProfitFactor) {
    failures.push(`ProfitFactor ${profitFactor} < ${GATES.paper.minProfitFactor}`);
  }

  if (failures.length > 0) {
    return {
      passed: false,
      reason: failures.join(', '),
      daysPaperTraded: Math.round(daysPaperTraded * 10) / 10,
      winRate,
      profitFactor,
    };
  }

  return { passed: true, daysPaperTraded: Math.round(daysPaperTraded * 10) / 10, winRate, profitFactor };
}

/**
 * Evaluate the live-small gate for LIVE_SMALL -> LIVE_FULL.
 *
 * Requires: 14+ days at LIVE_SMALL, Sharpe > 0.3, no kill switch triggers.
 *
 * @param {object} strategy
 * @returns {{ passed: boolean, reason?: string, daysLiveSmall?: number, sharpe?: number, killSwitchClean?: boolean }}
 */
function evaluateLiveSmallGate(strategy) {
  const daysLiveSmall = daysSince(strategy.liveSmallStart);

  if (daysLiveSmall < GATES.liveSmall.minDays) {
    return {
      passed: false,
      reason: `Only ${daysLiveSmall.toFixed(1)} days at LIVE_SMALL (need ${GATES.liveSmall.minDays}).`,
      daysLiveSmall: Math.round(daysLiveSmall * 10) / 10,
    };
  }

  // Get live performance
  const perf = getLivePerformance(strategy.name);
  const sharpe = perf ? (perf.sharpeRatio || 0) : (strategy.performance.sharpe || 0);

  // Check for kill switch triggers in promotion history
  const killSwitchClean = !strategy.promotionHistory.some(
    (h) => h.reason && /kill.?switch|emergency|breach/i.test(h.reason) && h.ts > (strategy.liveSmallStart || 0),
  );

  const failures = [];

  if (sharpe < GATES.liveSmall.minSharpe) {
    failures.push(`Sharpe ${sharpe} < ${GATES.liveSmall.minSharpe}`);
  }
  if (!killSwitchClean) {
    failures.push('Kill switch triggered during LIVE_SMALL period');
  }

  if (failures.length > 0) {
    return {
      passed: false,
      reason: failures.join(', '),
      daysLiveSmall: Math.round(daysLiveSmall * 10) / 10,
      sharpe,
      killSwitchClean,
    };
  }

  return {
    passed: true,
    daysLiveSmall: Math.round(daysLiveSmall * 10) / 10,
    sharpe,
    killSwitchClean,
  };
}

/**
 * Get live trading performance for a strategy from the trade journal.
 * Returns null if trade journal is unavailable.
 *
 * @param {string} strategyName
 * @returns {object|null}
 */
function getLivePerformance(strategyName) {
  if (!tradeJournal || typeof tradeJournal.getStats !== 'function') {
    return null;
  }
  try {
    // Filter stats to only trades belonging to this specific strategy
    return tradeJournal.getStats({ sinceDays: 30, strategy: strategyName });
  } catch (err) {
    _log.error(`Failed to fetch live performance for "${strategyName}"`, { error: err.message || err });
    return null;
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  registerStrategy,
  promoteStrategy,
  demoteStrategy,
  getActiveStrategies,
  reviewStrategies,

  // Exposed for testing and introspection
  STATUSES,
  STATUS_ORDER,
  GATES,
  REGISTRY_FILE,
  loadRegistry,
};
