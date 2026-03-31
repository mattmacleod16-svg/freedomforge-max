#!/usr/bin/env node
/**
 * Nightly Parameter Optimizer — Self-evolving strategy engine
 * ═══════════════════════════════════════════════════════════════
 * Runs nightly to:
 *   1. Fetch latest 45 days of candle data (BTC, ETH, SOL, XRP)
 *   2. Run 648+ parameter combination grid search per asset
 *   3. Select winners by composite score (Sharpe + return + drawdown)
 *   4. Detect current market regime per asset
 *   5. Push optimal parameters to Railway env vars
 *   6. Emit summary report via agent signal bus
 *
 * Schedule: nightly at 02:00 ET (07:00 UTC)
 * Railway env vars updated: EDGE_EMA_FAST, EDGE_EMA_SLOW,
 *   COINBASE_MIN_CONFIDENCE, KRAKEN_MIN_CONFIDENCE,
 *   RISK_STOP_LOSS_ATR_MULT, RISK_TAKE_PROFIT_ATR_MULT
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });
require('dotenv').config();

process.env.TRADING_MODE  = 'paper';
process.env.SIGNAL_BUS_MODE = 'file';

const RAILWAY_API_KEY  = process.env.RAILWAY_API_KEY || '';
const RAILWAY_ENV_ID   = process.env.RAILWAY_ENV_ID  || '';
const RESULTS_DIR      = path.resolve(process.cwd(), 'data/backtest-results');
const OPT_HISTORY_FILE = path.resolve(process.cwd(), 'data/optimizer-history.json');
const ASSETS           = (process.env.OPTIMIZER_ASSETS || 'BTC-USD,ETH-USD,SOL-USD,XRP-USD').split(',');

const TAG = '[nightly-optimizer]';

// ── Logger ────────────────────────────────────────────────────────────────────
function ts()  { return new Date().toISOString(); }
function info(msg)  { console.log(`${ts()} ${TAG} INFO  ${msg}`); }
function warn(msg)  { console.warn(`${ts()} ${TAG} WARN  ${msg}`); }
function error(msg) { console.error(`${ts()} ${TAG} ERROR ${msg}`); }
function done(msg)  { console.log(`${ts()} ${TAG} ✅  ${msg}`); }

// ── Fetch candles with batching ───────────────────────────────────────────────
async function fetchCandles(symbol, days = 45) {
  const granularity    = 3600;
  const maxBars        = 280;
  const endMs          = Date.now();
  const startMs        = endMs - days * 24 * 3600 * 1000;
  const allCandles     = [];
  let current          = startMs;
  let batches          = 0;

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
    } catch (e) { warn(`candle fetch error: ${e.message}`); }
    current = batchEnd;
    batches++;
    await sleep(250);
  }

  // Deduplicate + sort ascending
  const seen = new Set();
  return allCandles.filter(c => {
    const k = c[0];
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => a[0] - b[0]);
}

// ── Technical indicators ──────────────────────────────────────────────────────
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
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

function bollingerBands(closes, period = 20) {
  if (closes.length < period) return null;
  const slice  = closes.slice(-period);
  const mean   = slice.reduce((a, b) => a + b, 0) / period;
  const std    = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
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
  const lf = fe[fe.length - 1];
  const ls = se[se.length - 1];
  const rsiVal = rsi(closes, 14);
  const bb     = bollingerBands(closes, 20);
  const lc     = closes[closes.length - 1];
  const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volR   = avgVol > 0 ? volumes[volumes.length - 1] / avgVol : 1;

  let score = 0;
  score += lf > ls ? 0.30 : -0.30;
  if (rsiVal !== null) {
    score += rsiVal < 35 ? 0.20 : rsiVal > 65 ? -0.20 : (50 - rsiVal) / 50 * 0.20;
  }
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

// ── Backtest engine ───────────────────────────────────────────────────────────
function runBacktest(candles, opts = {}) {
  const {
    initialCapital = 1000, fees = 0.001, slippage = 0.0005,
    fastEma = 8, slowEma = 21, minConf = 0.56,
    stopLossPct = 0.03, takeProfitPct = 0.015,
  } = opts;

  if (candles.length < slowEma + 10) return null;

  const closes  = candles.map(c => parseFloat(c[4]));
  const volumes = candles.map(c => parseFloat(c[5]));
  let capital = initialCapital, position = 0, entryPrice = 0;
  const sells = [];
  let maxCap = capital, minCap = capital;

  for (let i = slowEma; i < candles.length - 1; i++) {
    const price  = closes[i];
    const signal = computeSignal(candles.slice(Math.max(0, i - 60), i + 1), { fastEma, slowEma, minConf });
    const curVal = capital + position * price;
    maxCap = Math.max(maxCap, curVal);
    minCap = Math.min(minCap, curVal);

    if (position === 0 && signal.side === 'buy') {
      const size  = Math.min(capital * 0.95, 500);
      const exec  = price * (1 + slippage);
      const fee   = size * fees;
      position    = (size - fee) / exec;
      entryPrice  = exec;
      capital    -= size;
    } else if (position > 0) {
      const pct = (price - entryPrice) / entryPrice;
      if (signal.side === 'sell' || pct <= -stopLossPct || pct >= takeProfitPct) {
        const exec  = price * (1 - slippage);
        const proc  = position * exec;
        const fee   = proc * fees;
        const pnl   = proc - fee - position * entryPrice;
        capital    += proc - fee;
        sells.push({ pnl, win: pnl > 0 });
        position   = 0; entryPrice = 0;
      }
    }
  }

  if (position > 0) {
    capital += position * closes[closes.length - 1] * (1 - fees);
    position = 0;
  }

  const totalReturn  = (capital - initialCapital) / initialCapital * 100;
  const wins         = sells.filter(s => s.win);
  const losses       = sells.filter(s => !s.win);
  const winRate      = sells.length > 0 ? wins.length / sells.length * 100 : 0;
  const maxDrawdown  = maxCap > 0 ? (maxCap - minCap) / maxCap * 100 : 0;
  const avgWin       = wins.length > 0 ? wins.reduce((a, s) => a + s.pnl, 0) / wins.length : 0;
  const avgLoss      = losses.length > 0 ? Math.abs(losses.reduce((a, s) => a + s.pnl, 0) / losses.length) : 0;
  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;

  const rets = closes.slice(1).map((v, i) => (v - closes[i]) / closes[i]);
  const mR   = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sR   = Math.sqrt(rets.reduce((a, b) => a + (b - mR) ** 2, 0) / rets.length);
  const sharpe = sR > 0 ? (mR / sR) * Math.sqrt(8760 / 24) : 0;

  // Composite score: Sharpe (40%) + return (30%) + invDrawdown (20%) + winRate (10%)
  const composite = (
    (sharpe * 0.40) +
    (totalReturn / 20 * 0.30) +
    ((1 - maxDrawdown / 100) * 0.20) +
    (winRate / 100 * 0.10)
  );

  return {
    finalCapital: parseFloat(capital.toFixed(2)),
    totalReturn:  parseFloat(totalReturn.toFixed(3)),
    trades:       sells.length,
    winRate:      parseFloat(winRate.toFixed(2)),
    maxDrawdown:  parseFloat(maxDrawdown.toFixed(3)),
    profitFactor: parseFloat(profitFactor.toFixed(4)),
    sharpe:       parseFloat(sharpe.toFixed(4)),
    composite:    parseFloat(composite.toFixed(4)),
  };
}

// ── Grid search ───────────────────────────────────────────────────────────────
function gridSearch(candles) {
  const grid = {
    fastEma:       [6, 8, 10, 13],
    slowEma:       [18, 21, 26, 34],
    minConf:       [0.52, 0.54, 0.56, 0.58],
    stopLossPct:   [0.025, 0.03, 0.04],
    takeProfitPct: [0.015, 0.02, 0.025, 0.03],
  };

  const results = [];

  for (const fastEma of grid.fastEma) {
    for (const slowEma of grid.slowEma) {
      if (fastEma >= slowEma) continue;
      for (const minConf of grid.minConf) {
        for (const stopLossPct of grid.stopLossPct) {
          for (const takeProfitPct of grid.takeProfitPct) {
            const r = runBacktest(candles, { fastEma, slowEma, minConf, stopLossPct, takeProfitPct });
            if (!r || r.trades < 3) continue;
            results.push({ fastEma, slowEma, minConf, stopLossPct, takeProfitPct, ...r });
          }
        }
      }
    }
  }

  if (results.length === 0) return null;

  results.sort((a, b) => b.composite - a.composite);
  return { best: results[0], top10: results.slice(0, 10), total: results.length };
}

// ── Regime detection ──────────────────────────────────────────────────────────
function detectRegime(candles) {
  if (candles.length < 50) return { mode: 'sideways', trend: 'neutral', volatility: 'normal' };
  const closes = candles.map(c => parseFloat(c[4]));
  const sma12  = closes.slice(-12).reduce((a, b) => a + b, 0) / 12;
  const sma26  = closes.slice(-26).reduce((a, b) => a + b, 0) / 26;
  const mom    = (closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10];

  const rets   = closes.slice(-30).slice(1).map((v, i) => (v - closes.slice(-30)[i]) / closes.slice(-30)[i]);
  const mean   = rets.reduce((a, b) => a + b, 0) / rets.length;
  const std    = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);

  const trend = sma12 > sma26 && mom > 0.005 ? 'bull' : sma12 < sma26 && mom < -0.005 ? 'bear' : 'sideways';
  const volatility = std < 0.005 ? 'low' : std < 0.015 ? 'normal' : std < 0.03 ? 'high' : 'extreme';
  const mode = volatility === 'extreme' ? 'extremeVolatility'
    : volatility === 'high' ? 'highVolatility'
    : trend === 'bull' ? 'bullTrend'
    : trend === 'bear' ? 'bearTrend'
    : 'sideways';

  return { mode, trend, volatility, std: parseFloat(std.toFixed(5)), mom: parseFloat(mom.toFixed(4)) };
}

// ── Railway env push ──────────────────────────────────────────────────────────
async function pushToRailway(vars) {
  if (!RAILWAY_API_KEY || !RAILWAY_ENV_ID) {
    warn('Railway push skipped — RAILWAY_API_KEY or RAILWAY_ENV_ID not set');
    return false;
  }

  const query = `
    mutation upsertVariables($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }
  `;

  const variables = {
    input: {
      environmentId: RAILWAY_ENV_ID,
      variables: vars,
    },
  };

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res   = await fetch('https://backboard.railway.app/graphql/v2', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RAILWAY_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body:   JSON.stringify({ query, variables }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const json = await res.json();
    if (json.errors) {
      warn(`Railway push errors: ${JSON.stringify(json.errors)}`);
      return false;
    }
    done(`Railway env vars updated: ${Object.keys(vars).join(', ')}`);
    return true;
  } catch (e) {
    warn(`Railway push failed: ${e.message}`);
    return false;
  }
}

// ── Save history ──────────────────────────────────────────────────────────────
function saveHistory(entry) {
  try {
    fs.mkdirSync(path.dirname(OPT_HISTORY_FILE), { recursive: true });
    const existing = fs.existsSync(OPT_HISTORY_FILE)
      ? JSON.parse(fs.readFileSync(OPT_HISTORY_FILE, 'utf8'))
      : [];
    existing.unshift(entry);
    fs.writeFileSync(OPT_HISTORY_FILE, JSON.stringify(existing.slice(0, 90), null, 2));
  } catch (e) { warn(`History save failed: ${e.message}`); }
}

// ── Sleep helper ──────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  info('═══════════════════════════════════════════════════════');
  info('  FREEDOMFORGE — NIGHTLY PARAMETER OPTIMIZER');
  info(`  Assets: ${ASSETS.join(', ')}`);
  info('═══════════════════════════════════════════════════════');

  const report    = { timestamp: new Date().toISOString(), assets: {} };
  const railwayVars = {};
  const summaryLines = [];

  for (const sym of ASSETS) {
    info(`\n── ${sym} ──────────────────────────────────────────`);
    info(`Fetching 45d candles...`);

    const candles = await fetchCandles(sym, 45);
    if (candles.length < 100) {
      warn(`${sym}: only ${candles.length} candles — skipping`);
      continue;
    }
    info(`${candles.length} bars loaded`);

    // Regime
    const regime = detectRegime(candles);
    info(`Regime: mode=${regime.mode} | trend=${regime.trend} | vol=${regime.volatility} | std=${regime.std}`);

    // Grid search
    info(`Running grid search...`);
    const grid = gridSearch(candles);
    if (!grid) { warn(`${sym}: no valid combinations`); continue; }

    const { best, top10, total } = grid;
    info(`Tested ${total} combinations`);
    info(`Best: EMA ${best.fastEma}/${best.slowEma} | conf=${best.minConf} | SL=${(best.stopLossPct*100).toFixed(1)}% | TP=${(best.takeProfitPct*100).toFixed(1)}%`);
    info(`  → Composite: ${best.composite} | Sharpe: ${best.sharpe} | Return: ${best.totalReturn}% | WinRate: ${best.winRate}% | Drawdown: ${best.maxDrawdown}%`);

    report.assets[sym] = { regime, best, top10, total, candles: candles.length };
    summaryLines.push(`${sym}: ${best.totalReturn}% return | ${best.winRate}% WR | Sharpe ${best.sharpe} | mode=${regime.mode}`);

    // Only push BTC params to Railway (primary signal asset)
    if (sym === 'BTC-USD') {
      railwayVars['EDGE_EMA_FAST']         = String(best.fastEma);
      railwayVars['EDGE_EMA_SLOW']         = String(best.slowEma);
      railwayVars['COINBASE_MIN_CONFIDENCE'] = String(best.minConf);
      railwayVars['KRAKEN_MIN_CONFIDENCE']   = String(best.minConf);
      railwayVars['RISK_STOP_LOSS_PCT']      = String(best.stopLossPct);
      railwayVars['RISK_TAKE_PROFIT_PCT']    = String(best.takeProfitPct);
      railwayVars['CURRENT_REGIME_MODE']     = regime.mode;
      railwayVars['CURRENT_REGIME_TREND']    = regime.trend;
      railwayVars['OPTIMIZER_LAST_RUN']      = new Date().toISOString();
      railwayVars['OPTIMIZER_COMPOSITE']     = String(best.composite);
    }

    // Save per-asset results
    try {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(RESULTS_DIR, `${sym.replace('/', '-')}-opt-latest.json`),
        JSON.stringify({ timestamp: new Date().toISOString(), sym, regime, ...report.assets[sym] }, null, 2)
      );
    } catch {}

    await sleep(500); // rate limit courtesy
  }

  // Push to Railway
  if (Object.keys(railwayVars).length > 0) {
    info('\nPushing optimal params to Railway...');
    const pushed = await pushToRailway(railwayVars);
    report.railwayPushed = pushed;
    report.railwayVars   = railwayVars;
  }

  // Save run to history
  saveHistory({ timestamp: report.timestamp, summary: summaryLines, vars: railwayVars });

  // Final summary
  info('\n═══════════════════════════════════════════════════════');
  info('  OPTIMIZATION COMPLETE');
  info('═══════════════════════════════════════════════════════');
  summaryLines.forEach(l => done(l));
  if (report.railwayPushed) done('Railway env vars updated — engine will use new params on next cycle');
  else warn('Railway not updated — set RAILWAY_API_KEY + RAILWAY_ENV_ID to enable auto-push');

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
  error('Optimizer crashed: ' + err.message);
  console.error(err);
  process.exit(1);
});
