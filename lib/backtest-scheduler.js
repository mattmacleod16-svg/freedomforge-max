/**
 * Backtest Scheduler — Automated parameter sweep & strategy validation engine.
 * =============================================================================
 *
 * Runs during maintenance mode to systematically backtest strategy variants,
 * parameter combinations, and brain-evolved configurations. Feeds results
 * back to the self-evolving brain and strategy promoter.
 *
 * Capabilities:
 *   1. Grid search over indicator weight combinations
 *   2. Walk-forward validation with out-of-sample windows
 *   3. Per-asset parameter optimization
 *   4. Regime-conditional backtesting (only bullish, only bearish, etc.)
 *   5. Monte Carlo performance estimation (bootstrap resampling)
 *   6. Automatic strategy registration with the promoter pipeline
 *   7. Results caching and incremental progress tracking
 *
 * Usage:
 *   const scheduler = require('../lib/backtest-scheduler');
 *   await scheduler.runScheduledBacktests();
 *   const leaderboard = scheduler.getLeaderboard();
 */

'use strict';

const fs = require('fs');
const path = require('path');

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

let backtestEngine;
try { backtestEngine = require('./backtest/engine'); } catch { backtestEngine = null; }

let dataLoader;
try { dataLoader = require('./backtest/data-loader'); } catch { dataLoader = null; }

let strategyPromoter;
try { strategyPromoter = require('./strategy-promoter'); } catch { strategyPromoter = null; }

let brain;
try { brain = require('./self-evolving-brain'); } catch { brain = null; }

let signalBus;
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }

let heartbeat;
try { heartbeat = require('./heartbeat-registry'); } catch { heartbeat = null; }

const { createLogger } = require('./logger');
const log = createLogger('backtest-scheduler');

// ─── Constants ──────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'backtest-scheduler-state.json');
const CACHE_DIR = path.join(DATA_DIR, 'backtest-cache');
const ASSETS = ['BTC', 'ETH', 'SOL', 'DOGE', 'AVAX', 'LINK', 'XRP', 'ARB', 'OP'];
const INTERVALS = ['1h', '4h'];
const LOOKBACK_DAYS = 90;
const MAX_LEADERBOARD = 50;
const MAX_VARIANTS_PER_CYCLE = 15;     // Don't blow up API rate limits
const MONTE_CARLO_ITERATIONS = 200;
const MIN_SHARPE_TO_REGISTER = 0.4;
const MIN_TRADES_TO_REGISTER = 20;

// ─── Grid Search Configuration ──────────────────────────────────────────────

const WEIGHT_GRID = {
  multiTfMomentum: [0.20, 0.25, 0.30, 0.35],
  rsi:             [0.10, 0.15, 0.20],
  bollingerBands:  [0.05, 0.10, 0.15],
  volumeConfirmation: [0.05, 0.10, 0.15],
  regimeAlignment: [0.10, 0.15, 0.20],
  sentimentDivergence: [0.05, 0.08, 0.12],
};

const THRESHOLD_GRID = {
  minConfidence: [0.52, 0.56, 0.60, 0.64],
  minEdge:       [0.08, 0.10, 0.12, 0.15],
  kellyFraction: [0.5, 0.75, 1.0],
};

// ─── I/O Helpers ────────────────────────────────────────────────────────────

function readJson(filePath, fallback) {
  if (rio) return rio.readJsonSafe(filePath, { fallback });
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) { log.error(`Failed to read ${path.basename(filePath)}`, { error: e.message }); }
  return fallback;
}

function writeJson(filePath, data) {
  if (rio) { rio.writeJsonAtomic(filePath, data); return; }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  } catch (e) { log.error(`Failed to write ${path.basename(filePath)}`, { error: e.message }); }
}

function loadState() {
  return readJson(STATE_FILE, {
    leaderboard: [],
    completedVariants: {},
    lastRunAt: 0,
    totalBacktests: 0,
    cycleCount: 0,
    bestSharpe: 0,
    bestVariant: null,
  });
}

function saveState(state) { writeJson(STATE_FILE, state); }

// ─── Variant Generation ─────────────────────────────────────────────────────

/**
 * Generate a batch of weight/threshold variants for grid search.
 * Returns only NEW variants (not already in completedVariants).
 */
function generateVariants(state, maxCount = MAX_VARIANTS_PER_CYCLE) {
  const variants = [];
  const done = state.completedVariants || {};

  // Strategy 1: Brain-evolved weights (highest priority)
  if (brain) {
    try {
      const evolved = brain.getEvolvedWeights();
      if (evolved && Object.keys(evolved).length > 0) {
        const key = variantKey({ weights: evolved, thresholds: brain.getEvolvedThresholds() || {} });
        if (!done[key]) {
          variants.push({
            name: `brain-gen-${state.cycleCount}`,
            weights: evolved,
            thresholds: brain.getEvolvedThresholds() || {},
            source: 'brain',
          });
        }
      }
    } catch { /* brain not ready */ }
  }

  // Strategy 2: Random perturbations of current best
  const best = state.bestVariant;
  if (best?.weights) {
    for (let i = 0; i < 3 && variants.length < maxCount; i++) {
      const perturbed = perturbWeights(best.weights, 0.15);
      const key = variantKey({ weights: perturbed, thresholds: best.thresholds || {} });
      if (!done[key]) {
        variants.push({
          name: `perturb-best-${i}`,
          weights: perturbed,
          thresholds: best.thresholds || {},
          source: 'perturbation',
        });
      }
    }
  }

  // Strategy 3: Grid search samples
  const gridKeys = Object.keys(WEIGHT_GRID);
  for (let attempt = 0; attempt < 50 && variants.length < maxCount; attempt++) {
    const weights = {};
    for (const k of gridKeys) {
      const options = WEIGHT_GRID[k];
      weights[k] = options[Math.floor(Math.random() * options.length)];
    }
    // Fill remaining weights with small values
    weights.atrVolatility = 0.05;
    weights.forecastAlignment = 0.03;
    weights.geoRiskPenalty = 0.04;
    normalizeWeights(weights);

    const thresholds = {};
    for (const [k, options] of Object.entries(THRESHOLD_GRID)) {
      thresholds[k] = options[Math.floor(Math.random() * options.length)];
    }

    const key = variantKey({ weights, thresholds });
    if (!done[key]) {
      variants.push({
        name: `grid-${attempt}`,
        weights,
        thresholds,
        source: 'grid',
      });
    }
  }

  return variants.slice(0, maxCount);
}

function perturbWeights(weights, magnitude) {
  const result = {};
  for (const [k, v] of Object.entries(weights)) {
    const delta = (Math.random() - 0.5) * 2 * magnitude * v;
    result[k] = Math.max(0.01, v + delta);
  }
  normalizeWeights(result);
  return result;
}

function normalizeWeights(weights) {
  const sum = Object.values(weights).reduce((s, v) => s + v, 0);
  if (sum > 0 && Math.abs(sum - 1) > 0.001) {
    for (const k of Object.keys(weights)) {
      weights[k] = Math.round((weights[k] / sum) * 1000) / 1000;
    }
  }
}

function variantKey(variant) {
  const wk = Object.entries(variant.weights || {}).sort().map(([k, v]) => `${k}:${v.toFixed(3)}`).join('|');
  const tk = Object.entries(variant.thresholds || {}).sort().map(([k, v]) => `${k}:${v}`).join('|');
  return `${wk}__${tk}`;
}

// ─── Monte Carlo Simulation ────────────────────────────────────────────────

/**
 * Bootstrap resample backtest trades to estimate performance distribution.
 */
function monteCarlo(trades, iterations = MONTE_CARLO_ITERATIONS) {
  if (!trades || trades.length < 10) return null;

  const sharpes = [];
  const returns_ = [];
  const drawdowns = [];

  for (let i = 0; i < iterations; i++) {
    const resampled = [];
    for (let j = 0; j < trades.length; j++) {
      resampled.push(trades[Math.floor(Math.random() * trades.length)]);
    }

    // Compute equity curve from resampled trades
    let equity = 1000;
    let peak = equity;
    let maxDD = 0;
    for (const t of resampled) {
      const pnl = t.pnlPct || t.returnPct || 0;
      equity *= (1 + pnl);
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDD) maxDD = dd;
    }

    const totalReturn = (equity - 1000) / 1000;
    returns_.push(totalReturn);
    drawdowns.push(maxDD);

    // Sharpe from resampled returns
    const pnls = resampled.map(t => t.pnlPct || t.returnPct || 0);
    const avgReturn = pnls.reduce((s, v) => s + v, 0) / pnls.length;
    const stdDev = Math.sqrt(pnls.reduce((s, v) => s + (v - avgReturn) ** 2, 0) / Math.max(1, pnls.length - 1));
    sharpes.push(stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0);
  }

  sharpes.sort((a, b) => a - b);
  returns_.sort((a, b) => a - b);
  drawdowns.sort((a, b) => a - b);

  return {
    sharpe: {
      p5: sharpes[Math.floor(iterations * 0.05)],
      p25: sharpes[Math.floor(iterations * 0.25)],
      median: sharpes[Math.floor(iterations * 0.50)],
      p75: sharpes[Math.floor(iterations * 0.75)],
      p95: sharpes[Math.floor(iterations * 0.95)],
    },
    totalReturn: {
      p5: returns_[Math.floor(iterations * 0.05)],
      median: returns_[Math.floor(iterations * 0.50)],
      p95: returns_[Math.floor(iterations * 0.95)],
    },
    maxDrawdown: {
      p5: drawdowns[Math.floor(iterations * 0.05)],
      median: drawdowns[Math.floor(iterations * 0.50)],
      p95: drawdowns[Math.floor(iterations * 0.95)],
    },
  };
}

// ─── Main Scheduler ─────────────────────────────────────────────────────────

/**
 * Run scheduled backtest batch across assets and variants.
 */
async function runScheduledBacktests() {
  if (!backtestEngine || !dataLoader) {
    log.error('Backtest engine or data loader unavailable — aborting');
    return { error: 'missing_dependencies' };
  }

  const cycleStart = Date.now();
  log.info('Starting scheduled backtest cycle');
  if (heartbeat) heartbeat.publishHeartbeat('backtest-scheduler', { phase: 'starting' });

  const state = loadState();
  const variants = generateVariants(state);
  if (variants.length === 0) {
    log.info('No new variants to test — clearing completed variants for next cycle');
    state.completedVariants = {};
    saveState(state);
    return { message: 'no_new_variants', leaderboard: state.leaderboard?.slice(0, 5) };
  }

  const results = [];

  for (const variant of variants) {
    for (const asset of ['BTC', 'ETH', 'SOL']) { // Focus on top-3 for speed
      for (const interval of INTERVALS) {
        try {
          // Check cache
          const cacheKey = `${asset}-${interval}-${variantKey(variant)}`;
          const cacheFile = path.join(CACHE_DIR, `${Buffer.from(cacheKey).toString('base64').replace(/[/+=]/g, '_').slice(0, 80)}.json`);
          const cached = readJson(cacheFile, null);
          if (cached) {
            results.push(cached);
            continue;
          }

          // Fetch candles
          const candles = await dataLoader.fetchHistoricalCandles({
            asset,
            quoteCurrency: 'USD',
            interval,
            days: LOOKBACK_DAYS,
          });

          if (!candles || candles.length < 200) {
            log.warn('Insufficient candle data for backtest', { asset, interval, count: candles?.length });
            continue;
          }

          // Run walk-forward validation (75/25 split)
          const wfResult = await backtestEngine.walkForwardValidation({
            candles,
            initialCapital: 1000,
            baseBet: 15,
            weights: variant.weights,
            thresholds: variant.thresholds,
            folds: 3,
          });

          const result = {
            variant: variant.name,
            source: variant.source,
            asset,
            interval,
            weights: variant.weights,
            thresholds: variant.thresholds,
            sharpe: wfResult?.averageSharpe || wfResult?.sharpeRatio || 0,
            totalReturn: wfResult?.averageReturn || wfResult?.totalReturn || 0,
            maxDrawdown: wfResult?.averageMaxDrawdown || wfResult?.maxDrawdownPct || 0,
            winRate: wfResult?.averageWinRate || wfResult?.winRate || 0,
            profitFactor: wfResult?.averageProfitFactor || wfResult?.profitFactor || 0,
            totalTrades: wfResult?.averageTrades || wfResult?.totalTrades || 0,
            monteCarlo: monteCarlo(wfResult?.trades || []),
            testedAt: Date.now(),
          };

          results.push(result);

          // Cache result
          fs.mkdirSync(CACHE_DIR, { recursive: true });
          writeJson(cacheFile, result);
        } catch (e) {
          log.warn('Backtest failed', { variant: variant.name, asset, interval, error: e.message });
        }
      }
    }

    // Mark variant as completed
    const key = variantKey(variant);
    state.completedVariants[key] = Date.now();
  }

  // Update leaderboard
  for (const r of results) {
    if (r.totalTrades >= MIN_TRADES_TO_REGISTER) {
      state.leaderboard.push(r);
    }
  }
  state.leaderboard.sort((a, b) => (b.sharpe || 0) - (a.sharpe || 0));
  state.leaderboard = state.leaderboard.slice(0, MAX_LEADERBOARD);
  state.totalBacktests = (state.totalBacktests || 0) + results.length;
  state.cycleCount = (state.cycleCount || 0) + 1;
  state.lastRunAt = Date.now();

  // Update best variant
  if (state.leaderboard.length > 0 && state.leaderboard[0].sharpe > (state.bestSharpe || 0)) {
    state.bestSharpe = state.leaderboard[0].sharpe;
    state.bestVariant = {
      weights: state.leaderboard[0].weights,
      thresholds: state.leaderboard[0].thresholds,
    };

    log.info('New best variant found!', {
      sharpe: state.bestSharpe,
      variant: state.leaderboard[0].variant,
      asset: state.leaderboard[0].asset,
    });

    // Publish to signal bus
    if (signalBus) {
      signalBus.publish({
        type: 'brain_evolution',
        source: 'backtest-scheduler',
        confidence: 0.8,
        payload: {
          bestSharpe: state.bestSharpe,
          bestWeights: state.bestVariant.weights,
          bestThresholds: state.bestVariant.thresholds,
        },
      });
    }

    // Auto-register with strategy promoter if good enough
    if (state.bestSharpe >= MIN_SHARPE_TO_REGISTER && strategyPromoter) {
      try {
        strategyPromoter.registerStrategy({
          name: `auto-${state.leaderboard[0].variant}-${Date.now()}`,
          description: `Auto-discovered by backtest scheduler. Sharpe: ${state.bestSharpe.toFixed(2)}`,
          weights: state.bestVariant.weights,
          thresholds: state.bestVariant.thresholds,
          author: 'backtest-scheduler',
        });
        log.info('Strategy auto-registered with promoter');
      } catch (e) {
        log.warn('Strategy registration failed', { error: e.message });
      }
    }
  }

  saveState(state);

  const elapsed = Date.now() - cycleStart;
  log.info('Backtest cycle complete', {
    cycle: state.cycleCount,
    tested: results.length,
    totalBacktests: state.totalBacktests,
    bestSharpe: state.bestSharpe,
    elapsedMs: elapsed,
  });

  if (heartbeat) heartbeat.publishHeartbeat('backtest-scheduler', { phase: 'complete', cycle: state.cycleCount });

  return {
    tested: results.length,
    leaderboard: state.leaderboard.slice(0, 5),
    bestSharpe: state.bestSharpe,
    cycleCount: state.cycleCount,
  };
}

// ─── Query Functions ────────────────────────────────────────────────────────

function getLeaderboard(limit = 10) {
  const state = loadState();
  return (state.leaderboard || []).slice(0, limit);
}

function getBestVariant() {
  const state = loadState();
  return state.bestVariant || null;
}

function getSchedulerStatus() {
  const state = loadState();
  return {
    cycleCount: state.cycleCount || 0,
    totalBacktests: state.totalBacktests || 0,
    lastRunAt: state.lastRunAt || 0,
    bestSharpe: state.bestSharpe || 0,
    leaderboardSize: (state.leaderboard || []).length,
    completedVariants: Object.keys(state.completedVariants || {}).length,
  };
}

module.exports = {
  runScheduledBacktests,
  getLeaderboard,
  getBestVariant,
  getSchedulerStatus,
  monteCarlo,
  generateVariants,
};
