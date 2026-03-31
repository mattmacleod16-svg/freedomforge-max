#!/usr/bin/env node
/**
 * FreedomForge — Bayesian Parameter Optimizer
 * ═══════════════════════════════════════════════════════════════════════════
 * Replaces brute-force grid search with Gaussian Process Bayesian Optimization.
 *
 * How it works:
 *   1. Start with a small random sample (exploration phase)
 *   2. Fit a surrogate model (Gaussian Process) to observed results
 *   3. Use Expected Improvement acquisition to pick the NEXT best point to test
 *   4. Run backtest, update surrogate, repeat
 *   5. Converges on optimal params in ~40 evaluations vs 768 grid combos
 *   6. History-aware: warm-starts from previous runs (learns over time)
 *
 * Benefits vs grid search:
 *   - 5-10x fewer backtests needed (~80-120 vs 768)
 *   - Explores continuous param space (not discrete grid)
 *   - Learns which param regions WIN across runs (cross-session memory)
 *   - Adapts to regime — bull/bear/sideways each get their own prior
 *
 * Schedule: nightly at 02:00 ET via Base44 automation
 * Pushes: EDGE_EMA_FAST, EDGE_EMA_SLOW, COINBASE_MIN_CONFIDENCE,
 *         KRAKEN_MIN_CONFIDENCE, RISK_STOP_LOSS_PCT, RISK_TAKE_PROFIT_PCT,
 *         CURRENT_REGIME_MODE, CURRENT_REGIME_TREND, OPTIMIZER_LAST_RUN
 */

'use strict';

const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });
require('dotenv').config();

process.env.TRADING_MODE    = 'paper';
process.env.SIGNAL_BUS_MODE = 'file';

/* ── Config ────────────────────────────────────────────────────────────────── */
const RAILWAY_API_KEY  = process.env.RAILYWAY_TOKEN || process.env.RAILWAY_API_KEY || '';
const RAILWAY_ENV_ID   = process.env.RAILWAY_ENV_ID || process.env.RAILWAY_ENVIRONMENT_ID || '';
const RESULTS_DIR      = path.resolve(process.cwd(), 'data/backtest-results');
const OPT_HISTORY_FILE = path.resolve(process.cwd(), 'data/optimizer-history.json');
const ASSETS           = (process.env.OPTIMIZER_ASSETS || 'BTC-USD,ETH-USD,SOL-USD,XRP-USD').split(',');

// Bayesian optimizer settings
const BAYES_INIT_SAMPLES = 12;   // random exploration before GP kicks in
const BAYES_ITERATIONS   = 50;   // total evaluations per asset (was 768)
const BAYES_XI           = 0.01; // exploration-exploitation tradeoff (higher = more explore)

/* ── Param space (continuous bounds) ──────────────────────────────────────── */
const PARAM_BOUNDS = {
  fastEma:       { min: 4,     max: 20,   type: 'int'   },
  slowEma:       { min: 14,    max: 50,   type: 'int'   },
  minConf:       { min: 0.50,  max: 0.65, type: 'float' },
  stopLossPct:   { min: 0.015, max: 0.06, type: 'float' },
  takeProfitPct: { min: 0.010, max: 0.05, type: 'float' },
};

const PARAM_KEYS = Object.keys(PARAM_BOUNDS);

const TAG = '[bayesian-optimizer]';
function ts()   { return new Date().toISOString(); }
function info(m){ console.log(`${ts()} ${TAG} INFO  ${m}`); }
function warn(m){ console.warn(`${ts()} ${TAG} WARN  ${m}`); }
function done(m){ console.log(`${ts()} ${TAG} ✅  ${m}`); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ═══════════════════════════════════════════════════════════════════════════
   BAYESIAN OPTIMIZATION CORE
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Normalize params to [0,1] hypercube ──────────────────────────────────── */
function normalize(params) {
  return PARAM_KEYS.map(k => {
    const { min, max } = PARAM_BOUNDS[k];
    return (params[k] - min) / (max - min);
  });
}

function denormalize(vec) {
  const p = {};
  PARAM_KEYS.forEach((k, i) => {
    const { min, max, type } = PARAM_BOUNDS[k];
    const v = min + vec[i] * (max - min);
    p[k] = type === 'int' ? Math.round(v) : parseFloat(v.toFixed(4));
  });
  return p;
}

function randomPoint() {
  const vec = PARAM_KEYS.map(() => Math.random());
  return denormalize(vec);
}

/* ── Gaussian Process (RBF kernel, exact inference) ──────────────────────── */
function rbfKernel(x1, x2, lengthScale = 0.5, sigma = 1.0) {
  let sq = 0;
  for (let i = 0; i < x1.length; i++) sq += (x1[i] - x2[i]) ** 2;
  return sigma ** 2 * Math.exp(-sq / (2 * lengthScale ** 2));
}

function buildCovMatrix(X, ls, sigma, noise = 1e-6) {
  const n = X.length;
  const K = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => rbfKernel(X[i], X[j], ls, sigma) + (i === j ? noise : 0))
  );
  return K;
}

/* ── Cholesky decomposition (numerically stable matrix inversion) ─────────── */
function choleskyDecompose(A) {
  const n = A.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = j === i ? Math.sqrt(Math.max(s, 1e-10)) : s / L[j][j];
    }
  }
  return L;
}

function choleskySolve(L, b) {
  const n = L.length;
  const y = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let j = 0; j < i; j++) s -= L[i][j] * y[j];
    y[i] = s / L[i][i];
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let j = i + 1; j < n; j++) s -= L[j][i] * x[j];
    x[i] = s / L[i][i];
  }
  return x;
}

/* ── GP posterior mean + variance at new point ────────────────────────────── */
function gpPredict(X_train, y_train, x_new, ls = 0.5, sigma = 1.0) {
  const n = X_train.length;
  const K = buildCovMatrix(X_train, ls, sigma);
  const L = choleskyDecompose(K);

  // k_star = covariance between training points and new point
  const k_star = X_train.map(xi => rbfKernel(xi, x_new, ls, sigma));

  // alpha = K^-1 * y
  const alpha = choleskySolve(L, y_train);

  // Posterior mean
  let mean = 0;
  for (let i = 0; i < n; i++) mean += k_star[i] * alpha[i];

  // Posterior variance
  const v = choleskySolve(L, k_star);
  let var_ = rbfKernel(x_new, x_new, ls, sigma);
  for (let i = 0; i < n; i++) var_ -= v[i] * k_star[i];
  var_ = Math.max(var_, 1e-8);

  return { mean, std: Math.sqrt(var_) };
}

/* ── Expected Improvement acquisition function ────────────────────────────── */
function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const phi  = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const cdf  = 1 - phi * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

function normalPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function expectedImprovement(mean, std, bestSoFar, xi = BAYES_XI) {
  if (std < 1e-8) return 0;
  const Z  = (mean - bestSoFar - xi) / std;
  return (mean - bestSoFar - xi) * normalCDF(Z) + std * normalPDF(Z);
}

/* ── Optimize acquisition via random + local search ──────────────────────── */
function maximizeAcquisition(X_train, y_train, bestSoFar, n_restarts = 200) {
  let bestEI = -Infinity;
  let bestVec = null;

  // Random search over 200 points
  for (let i = 0; i < n_restarts; i++) {
    const vec = PARAM_KEYS.map(() => Math.random());
    const { mean, std } = gpPredict(X_train, y_train, vec);
    const ei = expectedImprovement(mean, std, bestSoFar);
    if (ei > bestEI) { bestEI = ei; bestVec = vec; }
  }

  // Local refinement: perturb the best candidate 50 more times
  if (bestVec) {
    for (let i = 0; i < 50; i++) {
      const perturbed = bestVec.map(v => Math.max(0, Math.min(1, v + (Math.random() - 0.5) * 0.1)));
      const { mean, std } = gpPredict(X_train, y_train, perturbed);
      const ei = expectedImprovement(mean, std, bestSoFar);
      if (ei > bestEI) { bestEI = ei; bestVec = perturbed; }
    }
  }

  return bestVec ? denormalize(bestVec) : randomPoint();
}

/* ── Main Bayesian loop ───────────────────────────────────────────────────── */
function bayesianOptimize(candles, regime, priorHistory = []) {
  const observations = []; // { params, score, x_norm }

  // Warm-start: seed with top results from same regime in history
  const regimePriors = priorHistory.filter(h =>
    h.regime === regime.mode && h.composite > 0
  ).slice(0, 5);

  if (regimePriors.length > 0) {
    info(`  Warm-starting with ${regimePriors.length} prior observations (regime: ${regime.mode})`);
    for (const prior of regimePriors) {
      if (!prior.params) continue;
      const r = runBacktest(candles, prior.params);
      if (r && r.trades >= 3) {
        observations.push({ params: prior.params, score: r.composite, x_norm: normalize(prior.params), result: r });
      }
    }
  }

  // Phase 1: Random exploration
  const initCount = Math.max(BAYES_INIT_SAMPLES - observations.length, 4);
  info(`  Phase 1: ${initCount} random explorations`);
  for (let i = 0; i < initCount; i++) {
    let params;
    let attempts = 0;
    do {
      params = randomPoint();
      attempts++;
    } while (params.fastEma >= params.slowEma && attempts < 20);
    if (params.fastEma >= params.slowEma) params.slowEma = params.fastEma + 4;

    const r = runBacktest(candles, params);
    if (r && r.trades >= 3) {
      observations.push({ params, score: r.composite, x_norm: normalize(params), result: r });
    }
  }

  // Phase 2: Bayesian guided search
  info(`  Phase 2: Bayesian guided search (${BAYES_ITERATIONS - observations.length} iterations)`);
  let iter = 0;
  while (observations.length < BAYES_ITERATIONS) {
    iter++;
    const X_train = observations.map(o => o.x_norm);
    const y_train = observations.map(o => o.score);
    const bestSoFar = Math.max(...y_train);

    // Get next candidate via Expected Improvement
    let nextParams = maximizeAcquisition(X_train, y_train, bestSoFar, 250);

    // Enforce constraint: fastEma < slowEma
    if (nextParams.fastEma >= nextParams.slowEma) {
      nextParams.slowEma = Math.min(PARAM_BOUNDS.slowEma.max, nextParams.fastEma + Math.ceil(Math.random() * 10) + 2);
    }

    const r = runBacktest(candles, nextParams);
    if (r && r.trades >= 3) {
      observations.push({ params: nextParams, score: r.composite, x_norm: normalize(nextParams), result: r });
    }

    // Every 10 iterations, show progress
    if (iter % 10 === 0) {
      const best = observations.reduce((a, b) => a.score > b.score ? a : b);
      info(`  [iter ${observations.length}] best composite so far: ${best.score.toFixed(4)}`);
    }
  }

  // Final result
  observations.sort((a, b) => b.score - a.score);
  const best = observations[0];
  const top10 = observations.slice(0, 10);

  return {
    best: { ...best.params, ...best.result },
    top10: top10.map(o => ({ ...o.params, ...o.result })),
    total: observations.length,
    method: 'bayesian',
    regimePriorsUsed: regimePriors.length,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   MARKET DATA + INDICATORS (unchanged from grid version)
   ═══════════════════════════════════════════════════════════════════════════ */

async function fetchCandles(symbol, days = 45) {
  const granularity = 3600;
  const maxBars     = 280;
  const endMs       = Date.now();
  const startMs     = endMs - days * 24 * 3600 * 1000;
  const allCandles  = [];
  let current       = startMs;
  let batches       = 0;

  while (current < endMs && batches < 40) {
    const batchEnd = Math.min(endMs, current + maxBars * granularity * 1000);
    const url = `https://api.exchange.coinbase.com/products/${symbol}/candles?granularity=${granularity}&start=${new Date(current).toISOString()}&end=${new Date(batchEnd).toISOString()}`;
    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res   = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      const data  = await res.json();
      if (Array.isArray(data) && data.length > 0) allCandles.push(...data);
    } catch (e) { warn(`candle fetch: ${e.message}`); }
    current = batchEnd;
    batches++;
    await sleep(250);
  }

  const seen = new Set();
  return allCandles.filter(c => {
    if (seen.has(c[0])) return false;
    seen.add(c[0]);
    return true;
  }).sort((a, b) => a[0] - b[0]);
}

function ema(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [prev];
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) ag += d; else al -= d;
  }
  ag /= period; al /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function bollingerBands(closes, period = 20) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean  = slice.reduce((a, b) => a + b, 0) / period;
  const std   = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  return { upper: mean + 2 * std, middle: mean, lower: mean - 2 * std, width: (4 * std) / mean };
}

function computeSignal(candles, opts = {}) {
  const { fastEma = 8, slowEma = 21, minConf = 0.56 } = opts;
  if (!candles || candles.length < slowEma + 5) return { side: 'hold', confidence: 0 };
  const closes  = candles.map(c => parseFloat(c[4]));
  const volumes = candles.map(c => parseFloat(c[5]));
  const fe = ema(closes, fastEma);
  const se = ema(closes, slowEma);
  if (!fe.length || !se.length) return { side: 'hold', confidence: 0 };
  const lf = fe[fe.length - 1], ls = se[se.length - 1];
  const rsiVal = rsi(closes, 14);
  const bb     = bollingerBands(closes, 20);
  const lc     = closes[closes.length - 1];
  const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volR   = avgVol > 0 ? volumes[volumes.length - 1] / avgVol : 1;

  let score = 0;
  score += lf > ls ? 0.30 : -0.30;
  if (rsiVal !== null) score += rsiVal < 35 ? 0.20 : rsiVal > 65 ? -0.20 : (50 - rsiVal) / 50 * 0.20;
  if (bb) {
    const pct = (lc - bb.lower) / (bb.upper - bb.lower);
    score += pct < 0.2 ? 0.20 : pct > 0.8 ? -0.20 : (0.5 - pct) * 0.40;
    if (bb.width < 0.02) score *= 1.15;
  }
  score += volR > 1.5 ? 0.15 : volR > 1.0 ? 0.08 : 0;
  const mom5 = (closes[closes.length - 1] / closes[closes.length - 5] - 1);
  score += Math.max(-0.15, Math.min(0.15, mom5 * 5));

  const conf = Math.min(0.95, Math.max(0, 0.50 + score * 0.75));
  const side = conf > minConf ? 'buy' : conf < (1 - minConf) ? 'sell' : 'hold';
  return { side, confidence: conf };
}

function runBacktest(candles, opts = {}) {
  const {
    initialCapital = 1000, fees = 0.001, slippage = 0.0005,
    fastEma = 8, slowEma = 21, minConf = 0.56,
    stopLossPct = 0.03, takeProfitPct = 0.015,
  } = opts;

  if (candles.length < slowEma + 10) return null;

  const closes  = candles.map(c => parseFloat(c[4]));
  let capital = initialCapital, position = 0, entryPrice = 0;
  const sells = [];
  let maxCap = capital, minCap = capital;

  for (let i = slowEma; i < candles.length - 1; i++) {
    const price  = closes[i];
    const signal = computeSignal(candles.slice(Math.max(0, i - 60), i + 1), { fastEma, slowEma, minConf });
    const curVal = capital + position * price;
    maxCap = Math.max(maxCap, curVal); minCap = Math.min(minCap, curVal);

    if (position === 0 && signal.side === 'buy') {
      const size = Math.min(capital * 0.95, 500);
      const exec = price * (1 + slippage);
      const fee  = size * fees;
      position   = (size - fee) / exec;
      entryPrice = exec;
      capital   -= size;
    } else if (position > 0) {
      const pct = (price - entryPrice) / entryPrice;
      if (signal.side === 'sell' || pct <= -stopLossPct || pct >= takeProfitPct) {
        const exec = price * (1 - slippage);
        const proc = position * exec;
        const fee  = proc * fees;
        capital   += proc - fee;
        sells.push({ pnl: proc - fee - position * entryPrice, win: proc - fee > position * entryPrice });
        position = 0; entryPrice = 0;
      }
    }
  }
  if (position > 0) { capital += position * closes[closes.length - 1] * (1 - fees); }

  const totalReturn = (capital - initialCapital) / initialCapital * 100;
  const wins        = sells.filter(s => s.win);
  const losses      = sells.filter(s => !s.win);
  const winRate     = sells.length > 0 ? wins.length / sells.length * 100 : 0;
  const maxDrawdown = maxCap > 0 ? (maxCap - minCap) / maxCap * 100 : 0;
  const avgWin      = wins.length > 0 ? wins.reduce((a, s) => a + s.pnl, 0) / wins.length : 0;
  const avgLoss     = losses.length > 0 ? Math.abs(losses.reduce((a, s) => a + s.pnl, 0) / losses.length) : 0;
  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;

  const rets   = closes.slice(1).map((v, i) => (v - closes[i]) / closes[i]);
  const mR     = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sR     = Math.sqrt(rets.reduce((a, b) => a + (b - mR) ** 2, 0) / rets.length);
  const sharpe = sR > 0 ? (mR / sR) * Math.sqrt(8760 / 24) : 0;

  const composite = (
    (sharpe * 0.40) +
    (totalReturn / 20 * 0.30) +
    ((1 - maxDrawdown / 100) * 0.20) +
    (winRate / 100 * 0.10)
  );

  return {
    finalCapital:  parseFloat(capital.toFixed(2)),
    totalReturn:   parseFloat(totalReturn.toFixed(3)),
    trades:        sells.length,
    winRate:       parseFloat(winRate.toFixed(2)),
    maxDrawdown:   parseFloat(maxDrawdown.toFixed(3)),
    profitFactor:  parseFloat(profitFactor.toFixed(4)),
    sharpe:        parseFloat(sharpe.toFixed(4)),
    composite:     parseFloat(composite.toFixed(4)),
  };
}

function detectRegime(candles) {
  if (candles.length < 50) return { mode: 'sideways', trend: 'neutral', volatility: 'normal' };
  const closes = candles.map(c => parseFloat(c[4]));
  const sma12  = closes.slice(-12).reduce((a, b) => a + b, 0) / 12;
  const sma26  = closes.slice(-26).reduce((a, b) => a + b, 0) / 26;
  const mom    = (closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10];

  const rets  = closes.slice(-30).slice(1).map((v, i) => (v - closes.slice(-30)[i]) / closes.slice(-30)[i]);
  const mean  = rets.reduce((a, b) => a + b, 0) / rets.length;
  const std   = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);

  const trend      = sma12 > sma26 && mom > 0.005 ? 'bull' : sma12 < sma26 && mom < -0.005 ? 'bear' : 'sideways';
  const volatility = std < 0.005 ? 'low' : std < 0.015 ? 'normal' : std < 0.03 ? 'high' : 'extreme';
  const mode = volatility === 'extreme' ? 'extremeVolatility'
    : volatility === 'high' ? 'highVolatility'
    : trend === 'bull' ? 'bullTrend'
    : trend === 'bear' ? 'bearTrend'
    : 'sideways';

  return { mode, trend, volatility, std: parseFloat(std.toFixed(5)), mom: parseFloat(mom.toFixed(4)) };
}

/* ── Railway push (unchanged) ────────────────────────────────────────────── */
async function pushToRailway(vars) {
  if (!RAILWAY_API_KEY || !RAILWAY_ENV_ID) {
    warn('Railway push skipped — RAILYWAY_TOKEN or RAILWAY_ENVIRONMENT_ID not set');
    return false;
  }
  const projId = process.env.RAILWAY_PROJECT_ID || '';
  const svcId  = process.env.RAILWAY_SERVICE_ID  || '';
  let pushed = 0, failed = 0;

  for (const [name, value] of Object.entries(vars)) {
    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res   = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RAILWAY_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `mutation { variableUpsert(input: { projectId: "${projId}", environmentId: "${RAILWAY_ENV_ID}", serviceId: "${svcId}", name: "${name}", value: "${value}" }) }`
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const json = await res.json();
      if (json.data?.variableUpsert === true) pushed++;
      else { failed++; warn(`Railway var failed: ${name} — ${JSON.stringify(json.errors)}`); }
    } catch (e) { failed++; warn(`Railway push failed for ${name}: ${e.message}`); }
  }
  if (pushed > 0) done(`Railway: ${pushed} vars updated, ${failed} failed`);
  return pushed > 0;
}

/* ── History load/save ───────────────────────────────────────────────────── */
function loadHistory() {
  try {
    if (fs.existsSync(OPT_HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(OPT_HISTORY_FILE, 'utf8'));
    }
  } catch {}
  return [];
}

function saveHistory(entry) {
  try {
    fs.mkdirSync(path.dirname(OPT_HISTORY_FILE), { recursive: true });
    const existing = loadHistory();
    existing.unshift(entry);
    fs.writeFileSync(OPT_HISTORY_FILE, JSON.stringify(existing.slice(0, 180), null, 2));
  } catch (e) { warn(`History save failed: ${e.message}`); }
}

/* ── Main ────────────────────────────────────────────────────────────────── */
async function main() {
  info('═══════════════════════════════════════════════════════════════');
  info('  FREEDOMFORGE — BAYESIAN PARAMETER OPTIMIZER v2');
  info(`  Assets: ${ASSETS.join(', ')} · ${BAYES_ITERATIONS} evaluations per asset`);
  info('  Method: Gaussian Process + Expected Improvement');
  info('═══════════════════════════════════════════════════════════════');

  const history = loadHistory();
  info(`Loaded ${history.length} historical observations for warm-starting`);

  const report       = { timestamp: new Date().toISOString(), method: 'bayesian', assets: {} };
  const railwayVars  = {};
  const summaryLines = [];

  for (const sym of ASSETS) {
    info(`\n── ${sym} ─────────────────────────────────────────────────────`);
    info(`Fetching 45d candles...`);

    const candles = await fetchCandles(sym, 45);
    if (candles.length < 100) { warn(`${sym}: only ${candles.length} candles — skipping`); continue; }
    info(`${candles.length} bars loaded`);

    const regime = detectRegime(candles);
    info(`Regime: mode=${regime.mode} | trend=${regime.trend} | vol=${regime.volatility} | std=${regime.std}`);

    // Pull prior observations for this asset+regime from history
    const priorHistory = history
      .filter(h => h.sym === sym && h.best)
      .map(h => ({ regime: h.regime?.mode, composite: h.best?.composite, params: {
        fastEma:       h.best?.fastEma,
        slowEma:       h.best?.slowEma,
        minConf:       h.best?.minConf,
        stopLossPct:   h.best?.stopLossPct,
        takeProfitPct: h.best?.takeProfitPct,
      }}));

    info(`Running Bayesian optimization...`);
    const startTime = Date.now();
    const result = bayesianOptimize(candles, regime, priorHistory);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const { best, top10, total, regimePriorsUsed } = result;
    info(`Evaluated ${total} parameter sets in ${elapsed}s (${regimePriorsUsed} from prior history)`);
    info(`Best: EMA ${best.fastEma}/${best.slowEma} | conf=${best.minConf} | SL=${(best.stopLossPct*100).toFixed(1)}% | TP=${(best.takeProfitPct*100).toFixed(1)}%`);
    info(`  → Composite: ${best.composite} | Sharpe: ${best.sharpe} | Return: ${best.totalReturn}% | WinRate: ${best.winRate}% | Drawdown: ${best.maxDrawdown}%`);

    report.assets[sym] = { regime, best, top10, total, elapsed: parseFloat(elapsed), sym };
    summaryLines.push(`${sym}: ${best.totalReturn}% return | ${best.winRate}% WR | Sharpe ${best.sharpe} | mode=${regime.mode}`);

    // Persist to history
    saveHistory({ timestamp: new Date().toISOString(), sym, regime: regime.mode, best, composite: best.composite });

    // Push BTC params to Railway
    if (sym === 'BTC-USD') {
      railwayVars['EDGE_EMA_FAST']            = String(best.fastEma);
      railwayVars['EDGE_EMA_SLOW']            = String(best.slowEma);
      railwayVars['COINBASE_MIN_CONFIDENCE']  = String(best.minConf);
      railwayVars['KRAKEN_MIN_CONFIDENCE']    = String(best.minConf);
      railwayVars['RISK_STOP_LOSS_PCT']       = String(best.stopLossPct);
      railwayVars['RISK_TAKE_PROFIT_PCT']     = String(best.takeProfitPct);
      railwayVars['CURRENT_REGIME_MODE']      = regime.mode;
      railwayVars['CURRENT_REGIME_TREND']     = regime.trend;
      railwayVars['OPTIMIZER_LAST_RUN']       = new Date().toISOString();
      railwayVars['OPTIMIZER_COMPOSITE']      = String(best.composite);
      railwayVars['OPTIMIZER_METHOD']         = 'bayesian';
    }

    // Save per-asset results
    try {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(RESULTS_DIR, `${sym.replace('/', '-')}-opt-latest.json`),
        JSON.stringify({ timestamp: new Date().toISOString(), sym, regime, ...report.assets[sym] }, null, 2)
      );
    } catch {}

    await sleep(400);
  }

  // Push to Railway
  if (Object.keys(railwayVars).length > 0) {
    info('\nPushing Bayesian-optimal params to Railway...');
    const pushed = await pushToRailway(railwayVars);
    report.railwayPushed = pushed;
    report.railwayVars   = railwayVars;
  }

  // Final summary
  info('\n═══════════════════════════════════════════════════════════════');
  info('  BAYESIAN OPTIMIZATION COMPLETE');
  info('═══════════════════════════════════════════════════════════════');
  summaryLines.forEach(l => done(l));
  if (report.railwayPushed) done('Railway updated — engine now running Bayesian-optimal params');

  // Save full report
  const reportPath = path.join(RESULTS_DIR, 'optimizer-run-latest.json');
  try {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    done(`Full report → ${reportPath}`);
  } catch {}

  return report;
}

main().catch(err => {
  console.error(`${ts()} ${TAG} ERROR Optimizer crashed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
