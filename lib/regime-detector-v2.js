/**
 * Regime Detector V2 — Market regime identification + adaptive weight engine
 * ═══════════════════════════════════════════════════════════════════════════
 * Detects:
 *   1. Trend Direction   — Bull, Bear, Sideways
 *   2. Volatility Level  — Low, Normal, High, Extreme
 *   3. Momentum Strength — ADX-based trend strength
 *   4. Trading Mode      — bullTrend | bearTrend | sideways | highVol | extremeVol
 *
 * Outputs adapted indicator weights per regime so the signal engine
 * automatically becomes a trend-follower in trending markets and a
 * mean-reverter in ranging markets.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

let log;
try { const { createLogger } = require('./logger'); log = createLogger('regime-v2'); }
catch { log = { debug(){}, info: console.log, warn: console.warn, error: console.error }; }

const REGIME_STATE_FILE = path.resolve(process.cwd(), process.env.REGIME_STATE_FILE || 'data/regime-detector-state.json');

// ── Thresholds ────────────────────────────────────────────────────────────────
const VOL = { low: 0.005, normal: 0.015, high: 0.03, extreme: 0.05 };
const ADX_THRESH = { weak: 20, moderate: 40, strong: 60 };

// ── Default weights (mirrored from self-evolving-brain) ──────────────────────
const DEFAULT_WEIGHTS = {
  multiTfMomentum:    0.25,
  rsi:                0.12,
  bollingerBands:     0.10,
  volumeConfirmation: 0.10,
  atrVolatility:      0.08,
  regimeAlignment:    0.15,
  sentimentDivergence:0.08,
  forecastAlignment:  0.04,
  geoRiskPenalty:     0.08,
};

// ── Per-regime multipliers ────────────────────────────────────────────────────
const ADJUSTMENTS = {
  bullTrend: {
    multiTfMomentum: 1.4, rsi: 0.9, bollingerBands: 0.8,
    volumeConfirmation: 1.2, atrVolatility: 0.7, regimeAlignment: 1.5,
  },
  bearTrend: {
    multiTfMomentum: 1.4, rsi: 0.9, bollingerBands: 0.8,
    volumeConfirmation: 1.2, atrVolatility: 0.7, regimeAlignment: 1.5,
  },
  sideways: {
    multiTfMomentum: 0.5, rsi: 1.5, bollingerBands: 1.8,
    volumeConfirmation: 0.9, atrVolatility: 1.2, regimeAlignment: 0.6,
  },
  highVolatility: {
    multiTfMomentum: 0.6, rsi: 1.3, bollingerBands: 1.5,
    volumeConfirmation: 1.0, atrVolatility: 1.8, regimeAlignment: 0.7,
  },
  extremeVolatility: {
    multiTfMomentum: 0.2, rsi: 0.5, bollingerBands: 0.3,
    volumeConfirmation: 0.2, atrVolatility: 2.5, regimeAlignment: 0.3,
  },
};

// ── Math helpers ─────────────────────────────────────────────────────────────
function sma(values, period) {
  if (values.length < period) return [];
  const out = [];
  for (let i = period - 1; i < values.length; i++) {
    out.push(values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period);
  }
  return out;
}

function calculateVolatility(closes, period = 20) {
  if (closes.length < period) return 0;
  const slice   = closes.slice(-period);
  const returns = slice.slice(1).map((v, i) => (v - slice[i]) / slice[i]);
  const mean    = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

function calculateADX(candles, period = 14) {
  if (candles.length < period * 2) return null;
  const closes = candles.map(c => parseFloat(Array.isArray(c) ? c[4] : c.close));
  const highs  = candles.map(c => parseFloat(Array.isArray(c) ? c[2] : c.high));
  const lows   = candles.map(c => parseFloat(Array.isArray(c) ? c[3] : c.low));

  const dmP = [], dmM = [], tr = [];
  for (let i = 1; i < candles.length; i++) {
    const up   = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    dmP.push(up > down && up > 0 ? up : 0);
    dmM.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }

  let sdmP = dmP.slice(0, period).reduce((a, b) => a + b, 0);
  let sdmM = dmM.slice(0, period).reduce((a, b) => a + b, 0);
  let str  = tr.slice(0, period).reduce((a, b) => a + b, 0);
  const diP = [], diM = [], dx = [];

  for (let i = period; i < candles.length; i++) {
    sdmP = sdmP - dmP[i - period] + dmP[i];
    sdmM = sdmM - dmM[i - period] + dmM[i];
    str  = str  - tr[i - period]  + tr[i];
    const dip = str > 0 ? (sdmP / str) * 100 : 0;
    const dim = str > 0 ? (sdmM / str) * 100 : 0;
    diP.push(dip); diM.push(dim);
    const diSum = Math.abs(dip + dim);
    dx.push(diSum > 0 ? Math.abs(dip - dim) / diSum * 100 : 0);
  }

  let adxVal = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++) adxVal = (adxVal * (period - 1) + dx[i]) / period;

  return {
    adx:    adxVal,
    diPlus: diP[diP.length - 1],
    diMinus:diM[diM.length - 1],
  };
}

// ── Core detection ────────────────────────────────────────────────────────────
function detectTrend(candles) {
  if (candles.length < 26) return 'neutral';
  const closes  = candles.map(c => parseFloat(Array.isArray(c) ? c[4] : c.close));
  const fast    = sma(closes, 12);
  const slow    = sma(closes, 26);
  if (!fast.length || !slow.length) return 'neutral';
  const lastFast  = fast[fast.length - 1];
  const lastSlow  = slow[slow.length - 1];
  const recent    = closes.slice(-10);
  const momentum  = (closes[closes.length - 1] - recent[0]) / recent[0];
  if (lastFast > lastSlow && momentum > 0.003)  return 'bull';
  if (lastFast < lastSlow && momentum < -0.003) return 'bear';
  return 'sideways';
}

function detectVolatility(candles) {
  if (candles.length < 30) return 'normal';
  const closes = candles.map(c => parseFloat(Array.isArray(c) ? c[4] : c.close));
  const vol    = calculateVolatility(closes, 30);
  if (vol < VOL.low)    return 'low';
  if (vol < VOL.normal) return 'normal';
  if (vol < VOL.high)   return 'high';
  return 'extreme';
}

// ── Main API ─────────────────────────────────────────────────────────────────
async function detectRegime(opts = {}) {
  const { candles, asset = 'BTC' } = opts;

  if (!candles || candles.length < 50) {
    return { trend: 'neutral', volatility: 'normal', mode: 'sideways', confidence: 0.3, asset };
  }

  const trend      = detectTrend(candles);
  const volatility = detectVolatility(candles);
  const adxData    = calculateADX(candles, 14);
  const adxVal     = adxData?.adx || 0;
  const adxDir     = adxData ? (adxData.diPlus > adxData.diMinus ? 'up' : 'down') : 'neutral';
  const strength   = adxVal > ADX_THRESH.strong ? 'strong' : adxVal > ADX_THRESH.moderate ? 'moderate' : 'weak';

  let mode = 'sideways';
  if (volatility === 'extreme') mode = 'extremeVolatility';
  else if (volatility === 'high') mode = 'highVolatility';
  else if (strength === 'strong' || strength === 'moderate') {
    mode = trend === 'bull' ? 'bullTrend' : trend === 'bear' ? 'bearTrend' : 'sideways';
  }

  const regime = {
    asset, trend, volatility, mode,
    adx: parseFloat(adxVal.toFixed(2)),
    adxDirection: adxDir,
    momentumStrength: strength,
    confidence: Math.min(0.95, 0.4 + adxVal / 80),
    timestamp: Date.now(),
  };

  // Persist
  try {
    const existing = fs.existsSync(REGIME_STATE_FILE)
      ? JSON.parse(fs.readFileSync(REGIME_STATE_FILE, 'utf8'))
      : {};
    existing[asset] = regime;
    const payload = JSON.stringify(existing, null, 2);
    if (rio) await rio.writeJsonAtomic(REGIME_STATE_FILE, JSON.parse(payload));
    else { fs.mkdirSync(path.dirname(REGIME_STATE_FILE), { recursive: true }); fs.writeFileSync(REGIME_STATE_FILE, payload); }
  } catch (e) { log.warn('regime state save failed: ' + e.message); }

  log.info(`[${asset}] mode=${mode} vol=${volatility} trend=${trend} ADX=${adxVal.toFixed(1)}`);
  return regime;
}

function getWeightsForRegime(regime) {
  const adj = ADJUSTMENTS[regime.mode] || {};
  const raw = {};
  for (const [k, v] of Object.entries(DEFAULT_WEIGHTS)) {
    raw[k] = v * (adj[k] || 1.0);
  }
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  const weights = {};
  for (const k in raw) weights[k] = parseFloat((raw[k] / sum).toFixed(4));
  return { weights, mode: regime.mode, volatility: regime.volatility };
}

function getCachedRegime(asset) {
  try {
    if (!fs.existsSync(REGIME_STATE_FILE)) return null;
    const state  = JSON.parse(fs.readFileSync(REGIME_STATE_FILE, 'utf8'));
    const cached = state[asset];
    if (!cached || Date.now() - cached.timestamp > 3_600_000) return null;
    return cached;
  } catch { return null; }
}

module.exports = {
  detectRegime, getWeightsForRegime, getCachedRegime,
  detectTrend, detectVolatility, calculateADX, calculateVolatility,
  ADJUSTMENTS, DEFAULT_WEIGHTS, VOL, ADX_THRESH,
};
