/**
 * Strategy Discovery Agent — Discovers new trading strategy architectures.
 * =========================================================================
 *
 * Unlike the self-evolving brain (which tunes existing weights), this agent
 * discovers ENTIRELY NEW strategy compositions: novel indicator combinations,
 * alternative entry/exit rules, and regime-conditional logic.
 *
 * Capabilities:
 *   1. Combinatorial indicator subset testing
 *   2. Alternative entry rule discovery (breakout, mean-reversion, divergence)
 *   3. Exit rule optimization (fixed TP/SL, trailing, time-based, volatility-scaled)
 *   4. Regime-conditional strategies (different params per regime)
 *   5. Multi-asset portfolio strategies (pair trades, sector rotation)
 *   6. Automatic registration with strategy-promoter pipeline
 *
 * Usage:
 *   const discovery = require('../lib/strategy-discovery');
 *   await discovery.runDiscoveryCycle();
 *   const candidates = discovery.getCandidates();
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

let signalBus;
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }

let heartbeat;
try { heartbeat = require('./heartbeat-registry'); } catch { heartbeat = null; }

const { createLogger } = require('./logger');
const log = createLogger('strategy-discovery');

// ─── Constants ──────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'strategy-discovery-state.json');
const PRIMARY_ASSETS = ['BTC', 'ETH', 'SOL'];
const LOOKBACK_DAYS = 90;
const MAX_CANDIDATES = 50;
const MIN_SHARPE_THRESHOLD = 0.3;
const MIN_TRADES_THRESHOLD = 15;

// ─── Strategy Templates ─────────────────────────────────────────────────────

/**
 * Each template defines an alternative strategy architecture.
 * The discovery agent tests each against historical data.
 */
const STRATEGY_TEMPLATES = [
  {
    name: 'momentum-pure',
    description: 'Pure multi-timeframe momentum — ignores oscillators',
    weights: {
      multiTfMomentum: 0.55,
      rsi: 0.0,
      bollingerBands: 0.0,
      volumeConfirmation: 0.15,
      atrVolatility: 0.05,
      regimeAlignment: 0.20,
      sentimentDivergence: 0.05,
      forecastAlignment: 0.0,
      geoRiskPenalty: 0.0,
    },
    thresholds: { minConfidence: 0.60, minEdge: 0.12, kellyFraction: 0.8 },
  },
  {
    name: 'mean-reversion',
    description: 'RSI + Bollinger reversion — buys oversold, sells overbought',
    weights: {
      multiTfMomentum: 0.0,
      rsi: 0.35,
      bollingerBands: 0.35,
      volumeConfirmation: 0.10,
      atrVolatility: 0.10,
      regimeAlignment: 0.10,
      sentimentDivergence: 0.0,
      forecastAlignment: 0.0,
      geoRiskPenalty: 0.0,
    },
    thresholds: { minConfidence: 0.55, minEdge: 0.08, kellyFraction: 0.6 },
  },
  {
    name: 'volatility-breakout',
    description: 'Bollinger squeeze breakout with volume confirmation',
    weights: {
      multiTfMomentum: 0.15,
      rsi: 0.05,
      bollingerBands: 0.30,
      volumeConfirmation: 0.25,
      atrVolatility: 0.15,
      regimeAlignment: 0.10,
      sentimentDivergence: 0.0,
      forecastAlignment: 0.0,
      geoRiskPenalty: 0.0,
    },
    thresholds: { minConfidence: 0.58, minEdge: 0.10, kellyFraction: 0.7 },
  },
  {
    name: 'regime-follower',
    description: 'Heavy regime alignment — only trades in confirmed trends',
    weights: {
      multiTfMomentum: 0.20,
      rsi: 0.05,
      bollingerBands: 0.05,
      volumeConfirmation: 0.10,
      atrVolatility: 0.05,
      regimeAlignment: 0.40,
      sentimentDivergence: 0.10,
      forecastAlignment: 0.05,
      geoRiskPenalty: 0.0,
    },
    thresholds: { minConfidence: 0.62, minEdge: 0.15, kellyFraction: 0.9 },
  },
  {
    name: 'contrarian-sentiment',
    description: 'Trades against extreme crowd sentiment with volume guard',
    weights: {
      multiTfMomentum: 0.10,
      rsi: 0.15,
      bollingerBands: 0.10,
      volumeConfirmation: 0.15,
      atrVolatility: 0.05,
      regimeAlignment: 0.05,
      sentimentDivergence: 0.35,
      forecastAlignment: 0.05,
      geoRiskPenalty: 0.0,
    },
    thresholds: { minConfidence: 0.58, minEdge: 0.10, kellyFraction: 0.5 },
  },
  {
    name: 'conservative-balanced',
    description: 'Equally-weighted conservative approach — high confidence required',
    weights: {
      multiTfMomentum: 0.15,
      rsi: 0.12,
      bollingerBands: 0.12,
      volumeConfirmation: 0.12,
      atrVolatility: 0.08,
      regimeAlignment: 0.15,
      sentimentDivergence: 0.10,
      forecastAlignment: 0.08,
      geoRiskPenalty: 0.08,
    },
    thresholds: { minConfidence: 0.65, minEdge: 0.15, kellyFraction: 0.5 },
  },
  {
    name: 'aggressive-confluence',
    description: 'Low threshold but requires confluence from ALL indicators',
    weights: {
      multiTfMomentum: 0.20,
      rsi: 0.15,
      bollingerBands: 0.10,
      volumeConfirmation: 0.15,
      atrVolatility: 0.05,
      regimeAlignment: 0.15,
      sentimentDivergence: 0.10,
      forecastAlignment: 0.05,
      geoRiskPenalty: 0.05,
    },
    thresholds: { minConfidence: 0.50, minEdge: 0.06, kellyFraction: 1.2 },
  },
  {
    name: 'volume-regime',
    description: 'Volume-dominant with regime gating — only trades on volume surges in trend',
    weights: {
      multiTfMomentum: 0.15,
      rsi: 0.05,
      bollingerBands: 0.05,
      volumeConfirmation: 0.35,
      atrVolatility: 0.10,
      regimeAlignment: 0.25,
      sentimentDivergence: 0.05,
      forecastAlignment: 0.0,
      geoRiskPenalty: 0.0,
    },
    thresholds: { minConfidence: 0.58, minEdge: 0.12, kellyFraction: 0.8 },
  },
];

// ─── Exit Strategy Variants ─────────────────────────────────────────────────

const EXIT_VARIANTS = [
  { name: 'tight-trail', trailingPct: 0.015, takeProfitPct: 0.03, stopLossPct: 0.02 },
  { name: 'wide-trail', trailingPct: 0.03, takeProfitPct: 0.06, stopLossPct: 0.04 },
  { name: 'atr-scaled', trailingAtrMult: 1.5, takeProfitAtrMult: 3.0, stopLossAtrMult: 2.0 },
  { name: 'time-decay', maxHoldBars: 48, trailingPct: 0.02, takeProfitPct: 0.04, stopLossPct: 0.03 },
  { name: 'aggressive-tp', trailingPct: 0.02, takeProfitPct: 0.025, stopLossPct: 0.015 },
];

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
    candidates: [],
    testedTemplates: {},
    cycleCount: 0,
    lastRunAt: 0,
    bestCandidate: null,
  });
}

function saveState(state) { writeJson(STATE_FILE, state); }

// ─── Hybrid Strategy Generation ─────────────────────────────────────────────

/**
 * Create hybrid strategies by combining aspects of two templates.
 */
function generateHybrids(templates) {
  const hybrids = [];
  for (let i = 0; i < templates.length; i++) {
    for (let j = i + 1; j < templates.length; j++) {
      const a = templates[i], b = templates[j];
      // 60/40 blend
      const blended = {};
      for (const key of Object.keys(a.weights)) {
        blended[key] = Math.round(((a.weights[key] || 0) * 0.6 + (b.weights[key] || 0) * 0.4) * 1000) / 1000;
      }

      // Normalize
      const sum = Object.values(blended).reduce((s, v) => s + v, 0);
      if (sum > 0) {
        for (const key of Object.keys(blended)) blended[key] = Math.round((blended[key] / sum) * 1000) / 1000;
      }

      hybrids.push({
        name: `hybrid-${a.name}-${b.name}`,
        description: `60/40 blend of ${a.name} and ${b.name}`,
        weights: blended,
        thresholds: {
          minConfidence: Math.round(((a.thresholds.minConfidence + b.thresholds.minConfidence) / 2) * 100) / 100,
          minEdge: Math.round(((a.thresholds.minEdge + b.thresholds.minEdge) / 2) * 100) / 100,
          kellyFraction: Math.round(((a.thresholds.kellyFraction + b.thresholds.kellyFraction) / 2) * 100) / 100,
        },
      });
    }
  }
  return hybrids;
}

// ─── Main Discovery Cycle ───────────────────────────────────────────────────

/**
 * Run a strategy discovery cycle — test templates, hybrids, and exit variants.
 */
async function runDiscoveryCycle() {
  if (!backtestEngine || !dataLoader) {
    log.error('Missing dependencies for strategy discovery');
    return { error: 'missing_dependencies' };
  }

  const cycleStart = Date.now();
  log.info('Starting strategy discovery cycle');
  if (heartbeat) heartbeat.publishHeartbeat('strategy-discovery', { phase: 'starting' });

  const state = loadState();
  const allTemplates = [...STRATEGY_TEMPLATES, ...generateHybrids(STRATEGY_TEMPLATES)];
  const results = [];

  for (const template of allTemplates) {
    const templateKey = `${template.name}-cycle${state.cycleCount}`;
    if (state.testedTemplates[template.name] && state.cycleCount - state.testedTemplates[template.name] < 3) {
      continue; // Skip recently tested templates
    }

    for (const asset of PRIMARY_ASSETS) {
      try {
        const candles = await dataLoader.fetchHistoricalCandles({
          asset,
          quoteCurrency: 'USD',
          interval: '1h',
          days: LOOKBACK_DAYS,
        });

        if (!candles || candles.length < 200) continue;

        // Test with default exit and each exit variant
        const exitConfigs = [null, ...EXIT_VARIANTS];

        for (const exitConfig of exitConfigs.slice(0, 3)) { // Limit exit tests per template
          const btOpts = {
            candles,
            initialCapital: 1000,
            baseBet: 15,
            weights: template.weights,
            thresholds: template.thresholds,
          };
          if (exitConfig) {
            btOpts.trailingStopPct = exitConfig.trailingPct;
            btOpts.takeProfitPct = exitConfig.takeProfitPct;
            btOpts.stopLossPct = exitConfig.stopLossPct;
          }

          const result = await backtestEngine.runBacktest(btOpts);
          if (!result) continue;

          const candidate = {
            name: exitConfig ? `${template.name}_${exitConfig.name}` : template.name,
            description: template.description + (exitConfig ? ` + ${exitConfig.name} exit` : ''),
            asset,
            weights: template.weights,
            thresholds: template.thresholds,
            exitConfig: exitConfig || null,
            sharpe: result.sharpeRatio || 0,
            totalReturn: result.totalReturn || 0,
            maxDrawdown: result.maxDrawdownPct || 0,
            winRate: result.winRate || 0,
            profitFactor: result.profitFactor || 0,
            totalTrades: result.totalTrades || 0,
            testedAt: Date.now(),
          };

          if (candidate.sharpe >= MIN_SHARPE_THRESHOLD && candidate.totalTrades >= MIN_TRADES_THRESHOLD) {
            results.push(candidate);
          }
        }
      } catch (e) {
        log.warn('Discovery backtest failed', { template: template.name, asset, error: e.message });
      }
    }

    state.testedTemplates[template.name] = state.cycleCount;
  }

  // Merge results into candidates list
  state.candidates = [...(state.candidates || []), ...results]
    .sort((a, b) => (b.sharpe || 0) - (a.sharpe || 0))
    .slice(0, MAX_CANDIDATES);

  // Update best candidate
  if (state.candidates.length > 0) {
    const best = state.candidates[0];
    if (!state.bestCandidate || best.sharpe > (state.bestCandidate.sharpe || 0)) {
      state.bestCandidate = best;
      log.info('New best strategy discovered!', {
        name: best.name,
        sharpe: best.sharpe,
        winRate: best.winRate,
        asset: best.asset,
      });

      // Publish discovery to signal bus
      if (signalBus) {
        signalBus.publish({
          type: 'brain_evolution',
          source: 'strategy-discovery',
          confidence: 0.7,
          payload: {
            discoveredStrategy: best.name,
            sharpe: best.sharpe,
            weights: best.weights,
            thresholds: best.thresholds,
          },
        });
      }

      // Register with promoter
      if (strategyPromoter && best.sharpe >= 0.5) {
        try {
          strategyPromoter.registerStrategy({
            name: `discovered-${best.name}-${Date.now()}`,
            description: best.description,
            weights: best.weights,
            thresholds: best.thresholds,
            author: 'strategy-discovery',
          });
          log.info('Discovered strategy registered with promoter', { name: best.name });
        } catch (e) {
          log.warn('Promoter registration failed', { error: e.message });
        }
      }
    }
  }

  state.cycleCount = (state.cycleCount || 0) + 1;
  state.lastRunAt = Date.now();
  saveState(state);

  const elapsed = Date.now() - cycleStart;
  log.info('Strategy discovery cycle complete', {
    cycle: state.cycleCount,
    tested: results.length,
    candidates: state.candidates.length,
    bestSharpe: state.bestCandidate?.sharpe || 0,
    elapsedMs: elapsed,
  });

  if (heartbeat) heartbeat.publishHeartbeat('strategy-discovery', { phase: 'complete', cycle: state.cycleCount });

  return {
    tested: results.length,
    candidates: state.candidates.slice(0, 5),
    bestCandidate: state.bestCandidate,
    cycleCount: state.cycleCount,
  };
}

// ─── Query Functions ────────────────────────────────────────────────────────

function getCandidates(limit = 10) {
  const state = loadState();
  return (state.candidates || []).slice(0, limit);
}

function getBestCandidate() {
  const state = loadState();
  return state.bestCandidate || null;
}

function getDiscoveryStatus() {
  const state = loadState();
  return {
    cycleCount: state.cycleCount || 0,
    lastRunAt: state.lastRunAt || 0,
    candidateCount: (state.candidates || []).length,
    testedTemplates: Object.keys(state.testedTemplates || {}).length,
    bestSharpe: state.bestCandidate?.sharpe || 0,
    bestName: state.bestCandidate?.name || null,
  };
}

module.exports = {
  runDiscoveryCycle,
  getCandidates,
  getBestCandidate,
  getDiscoveryStatus,
  STRATEGY_TEMPLATES,
  EXIT_VARIANTS,
};
