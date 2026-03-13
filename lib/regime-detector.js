/**
 * Market Regime Detector
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Classifies current market conditions as:
 *   - trending_up / trending_down
 *   - ranging (mean-reverting)
 *   - volatile (high vol, no direction)
 *   - breakout (transition from ranging to trending)
 *   - crash (sharp sell-off)
 *
 * Uses ADX, Bollinger Band width, volume profile, and ATR regime to provide
 * a robust classification. Fed into strategy selection and position sizing.
 *
 * @module lib/regime-detector
 */

'use strict';

const { createLogger } = require('./logger');
const log = createLogger('regime-detector');

let edgeDetector, signalBus, wsFeed;
try { edgeDetector = require('./edge-detector'); } catch { edgeDetector = null; }
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }
try { wsFeed = require('./websocket-feed'); } catch { wsFeed = null; }

// ─── Configuration ────────────────────────────────────────────────────────────
const ADX_TRENDING_THRESHOLD = Number(process.env.REGIME_ADX_TRENDING || 25);
const ADX_STRONG_TRENDING = Number(process.env.REGIME_ADX_STRONG || 40);
const BB_WIDTH_SQUEEZE = Number(process.env.REGIME_BB_SQUEEZE || 0.03); // 3% width = squeeze
const BB_WIDTH_EXPANSION = Number(process.env.REGIME_BB_EXPANSION || 0.08); // 8% width = expansion
const VOL_REGIME_LOOKBACK = Number(process.env.REGIME_VOL_LOOKBACK || 20); // periods
const CRASH_THRESHOLD_PCT = Number(process.env.REGIME_CRASH_PCT || -5); // -5% = crash
const REGIME_TTL_MS = Number(process.env.REGIME_TTL_MS || 1800000); // 30min TTL on bus

// ─── Indicator Calculations ───────────────────────────────────────────────────

function ema(data, period) {
  if (!data || data.length < period) return [];
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function sma(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    const slice = data.slice(i - period + 1, i + 1);
    result.push(slice.reduce((s, v) => s + v, 0) / period);
  }
  return result;
}

function trueRange(highs, lows, closes) {
  const tr = [];
  for (let i = 0; i < highs.length; i++) {
    if (i === 0) { tr.push(highs[i] - lows[i]); continue; }
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }
  return tr;
}

/**
 * Average Directional Index (ADX) — measures trend strength.
 * ADX < 20: no trend. ADX 20-40: trending. ADX > 40: strong trend.
 */
function calculateADX(highs, lows, closes, period = 14) {
  if (!highs || highs.length < period * 2) return { adx: 0, plusDI: 0, minusDI: 0 };

  const n = highs.length;
  const plusDM = [];
  const minusDM = [];

  for (let i = 0; i < n; i++) {
    if (i === 0) { plusDM.push(0); minusDM.push(0); continue; }
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const tr = trueRange(highs, lows, closes);
  const smoothedTR = ema(tr, period);
  const smoothedPlusDM = ema(plusDM, period);
  const smoothedMinusDM = ema(minusDM, period);

  const last = n - 1;
  const atr = smoothedTR[last] || 1;
  const plusDI = (smoothedPlusDM[last] / atr) * 100;
  const minusDI = (smoothedMinusDM[last] / atr) * 100;

  const dx = (plusDI + minusDI) > 0
    ? (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100
    : 0;

  // Smooth DX with EMA to get ADX
  const dxSeries = [];
  for (let i = 0; i < n; i++) {
    const a = smoothedTR[i] || 1;
    const pdi = (smoothedPlusDM[i] / a) * 100;
    const mdi = (smoothedMinusDM[i] / a) * 100;
    dxSeries.push((pdi + mdi) > 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0);
  }
  const adxSeries = ema(dxSeries, period);
  const adx = adxSeries[last] || 0;

  return { adx: Math.round(adx * 100) / 100, plusDI: Math.round(plusDI * 100) / 100, minusDI: Math.round(minusDI * 100) / 100 };
}

/**
 * Bollinger Band width — measures volatility compression/expansion.
 */
function bollingerBandWidth(closes, period = 20, stdMultiplier = 2) {
  if (!closes || closes.length < period) return { width: 0, percentB: 0.5, squeeze: false };

  const slice = closes.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);

  const upper = mean + stdMultiplier * std;
  const lower = mean - stdMultiplier * std;
  const width = mean > 0 ? (upper - lower) / mean : 0;
  const lastPrice = closes[closes.length - 1];
  const percentB = (upper - lower) > 0 ? (lastPrice - lower) / (upper - lower) : 0.5;

  return {
    width: Math.round(width * 10000) / 10000,
    percentB: Math.round(percentB * 1000) / 1000,
    squeeze: width < BB_WIDTH_SQUEEZE,
    expansion: width > BB_WIDTH_EXPANSION,
    upper: Math.round(upper * 100) / 100,
    lower: Math.round(lower * 100) / 100,
    middle: Math.round(mean * 100) / 100,
  };
}

/**
 * Volume profile analysis — is volume confirming the move?
 */
function volumeProfile(volumes, closes) {
  if (!volumes || volumes.length < VOL_REGIME_LOOKBACK) {
    return { volumeTrend: 'flat', relativeVolume: 1, climax: false };
  }

  const recentVol = volumes.slice(-5);
  const historicalVol = volumes.slice(-VOL_REGIME_LOOKBACK);
  const avgRecent = recentVol.reduce((s, v) => s + v, 0) / recentVol.length;
  const avgHistorical = historicalVol.reduce((s, v) => s + v, 0) / historicalVol.length;
  const relativeVolume = avgHistorical > 0 ? avgRecent / avgHistorical : 1;

  // Volume climax: >3x normal
  const climax = relativeVolume > 3;

  // Volume trend: are volumes increasing?
  const firstHalf = volumes.slice(-VOL_REGIME_LOOKBACK, -VOL_REGIME_LOOKBACK / 2);
  const secondHalf = volumes.slice(-VOL_REGIME_LOOKBACK / 2);
  const avgFirst = firstHalf.length > 0 ? firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length : 0;
  const avgSecond = secondHalf.length > 0 ? secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length : 0;
  const volumeTrend = avgSecond > avgFirst * 1.2 ? 'increasing' : avgSecond < avgFirst * 0.8 ? 'decreasing' : 'flat';

  return {
    volumeTrend,
    relativeVolume: Math.round(relativeVolume * 100) / 100,
    climax,
  };
}

/**
 * ATR regime — is volatility expanding or contracting?
 */
function atrRegime(highs, lows, closes, period = 14) {
  if (!highs || highs.length < period * 2) return { atrPct: 0, regime: 'normal', expanding: false };

  const tr = trueRange(highs, lows, closes);
  const atrSeries = ema(tr, period);
  const lastPrice = closes[closes.length - 1] || 1;
  const currentATR = atrSeries[atrSeries.length - 1] || 0;
  const prevATR = atrSeries[Math.max(0, atrSeries.length - period)] || currentATR;

  const atrPct = (currentATR / lastPrice) * 100;
  const expanding = currentATR > prevATR * 1.3;
  const contracting = currentATR < prevATR * 0.7;

  return {
    atrPct: Math.round(atrPct * 100) / 100,
    atr: Math.round(currentATR * 100) / 100,
    regime: expanding ? 'expanding' : contracting ? 'contracting' : 'normal',
    expanding,
    contracting,
  };
}

// ─── Regime Classification ────────────────────────────────────────────────────

/**
 * Classify the market regime for an asset using multi-indicator confluence.
 *
 * @param {object} params
 * @param {number[]} params.closes - Close prices
 * @param {number[]} params.highs - High prices
 * @param {number[]} params.lows - Low prices
 * @param {number[]} params.volumes - Volume data
 * @returns {{
 *   regime: string,
 *   confidence: number,
 *   indicators: object,
 *   recommendation: object,
 *   timestamp: string
 * }}
 */
function classifyRegime({ closes, highs, lows, volumes }) {
  if (!closes || closes.length < 30) {
    return { regime: 'unknown', confidence: 0, indicators: {}, recommendation: {}, timestamp: new Date().toISOString() };
  }

  const adxResult = calculateADX(highs, lows, closes);
  const bbResult = bollingerBandWidth(closes);
  const volResult = volumeProfile(volumes, closes);
  const atrResult = atrRegime(highs, lows, closes);

  // Price change over lookback
  const recentReturn = (closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10] * 100;
  const shortReturn = (closes[closes.length - 1] - closes[closes.length - 3]) / closes[closes.length - 3] * 100;

  // ── Classification Logic ────────────────────────────────────────────────
  let regime = 'ranging';
  let confidence = 0.5;

  // CRASH: sharp sell-off
  if (shortReturn <= CRASH_THRESHOLD_PCT) {
    regime = 'crash';
    confidence = Math.min(0.95, 0.7 + Math.abs(shortReturn) * 0.02);
  }
  // BREAKOUT: squeeze resolving to trend
  else if (bbResult.squeeze && adxResult.adx > ADX_TRENDING_THRESHOLD && atrResult.expanding) {
    regime = recentReturn > 0 ? 'breakout_up' : 'breakout_down';
    confidence = Math.min(0.9, 0.5 + adxResult.adx * 0.01 + (volResult.relativeVolume > 1.5 ? 0.15 : 0));
  }
  // STRONG TRENDING
  else if (adxResult.adx >= ADX_STRONG_TRENDING) {
    regime = adxResult.plusDI > adxResult.minusDI ? 'trending_up' : 'trending_down';
    confidence = Math.min(0.95, 0.6 + adxResult.adx * 0.005);
    // Volume confirmation boosts confidence
    if (volResult.volumeTrend === 'increasing') confidence = Math.min(0.95, confidence + 0.1);
  }
  // TRENDING
  else if (adxResult.adx >= ADX_TRENDING_THRESHOLD) {
    regime = adxResult.plusDI > adxResult.minusDI ? 'trending_up' : 'trending_down';
    confidence = Math.min(0.85, 0.4 + adxResult.adx * 0.01);
  }
  // VOLATILE (high vol but no direction)
  else if (bbResult.expansion || atrResult.atrPct > 5) {
    regime = 'volatile';
    confidence = Math.min(0.8, 0.5 + atrResult.atrPct * 0.01);
  }
  // RANGING
  else {
    regime = 'ranging';
    confidence = Math.min(0.8, 0.4 + (ADX_TRENDING_THRESHOLD - adxResult.adx) * 0.02);
  }

  // ── Strategy Recommendation ─────────────────────────────────────────────
  const recommendation = getRecommendation(regime);

  return {
    regime,
    confidence: Math.round(confidence * 1000) / 1000,
    indicators: {
      adx: adxResult,
      bollingerBand: bbResult,
      volume: volResult,
      atr: atrResult,
      recentReturn: Math.round(recentReturn * 100) / 100,
    },
    recommendation,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get strategy recommendations based on regime.
 */
function getRecommendation(regime) {
  const recommendations = {
    'trending_up': {
      strategies: ['momentum', 'breakout', 'trend_follow'],
      sizeMultiplier: 1.2,
      exitStyle: 'trailing_stop',
      minConfidence: 0.5,
      notes: 'Favor long momentum plays. Tighten trailing stops.',
    },
    'trending_down': {
      strategies: ['momentum', 'trend_follow'],
      sizeMultiplier: 0.8,
      exitStyle: 'trailing_stop',
      minConfidence: 0.6,
      notes: 'Reduce exposure. Only short if enabled.',
    },
    'ranging': {
      strategies: ['mean_reversion', 'grid', 'rsi_oversold'],
      sizeMultiplier: 0.9,
      exitStyle: 'fixed_target',
      minConfidence: 0.55,
      notes: 'BB %B extremes are reliable. Use tight take-profits.',
    },
    'volatile': {
      strategies: ['volatility_breakout'],
      sizeMultiplier: 0.5,
      exitStyle: 'wide_stop',
      minConfidence: 0.65,
      notes: 'Reduce size significantly. Widen stops to avoid whipsaws.',
    },
    'breakout_up': {
      strategies: ['breakout', 'momentum'],
      sizeMultiplier: 1.1,
      exitStyle: 'trailing_stop',
      minConfidence: 0.55,
      notes: 'Squeeze resolution — enter on confirmation with volume.',
    },
    'breakout_down': {
      strategies: ['breakout'],
      sizeMultiplier: 0.7,
      exitStyle: 'trailing_stop',
      minConfidence: 0.6,
      notes: 'Bearish breakout — defensive posture.',
    },
    'crash': {
      strategies: [],
      sizeMultiplier: 0,
      exitStyle: 'emergency',
      minConfidence: 1.0,
      notes: 'NO new entries. Exit existing positions. Wait for stabilization.',
    },
    'unknown': {
      strategies: ['conservative'],
      sizeMultiplier: 0.5,
      exitStyle: 'fixed_target',
      minConfidence: 0.7,
      notes: 'Insufficient data. Trade conservatively.',
    },
  };

  return recommendations[regime] || recommendations['unknown'];
}

/**
 * Detect regime for a specific asset using the edge-detector's candle fetcher.
 *
 * @param {string} asset
 * @returns {Promise<object>}
 */
async function detectRegime(asset) {
  // Try to get OHLCV data
  let candles = null;

  if (edgeDetector && typeof edgeDetector.getCandles === 'function') {
    try {
      candles = await edgeDetector.getCandles(asset, '1h', 100);
    } catch { /* fall through */ }
  }

  if (!candles || !Array.isArray(candles) || candles.length < 30) {
    return { regime: 'unknown', confidence: 0, asset, reason: 'insufficient candle data' };
  }

  const closes = candles.map(c => c.close || c[4] || 0).filter(v => v > 0);
  const highs = candles.map(c => c.high || c[2] || 0).filter(v => v > 0);
  const lows = candles.map(c => c.low || c[3] || 0).filter(v => v > 0);
  const volumes = candles.map(c => c.volume || c[5] || 0);

  const result = classifyRegime({ closes, highs, lows, volumes });
  result.asset = asset;

  // Publish to signal bus
  if (signalBus) {
    try {
      signalBus.publish({
        type: 'market_regime',
        source: 'regime-detector',
        confidence: result.confidence,
        payload: { asset, regime: result.regime, ...result.recommendation },
        ttlMs: REGIME_TTL_MS,
      });
    } catch { /* best effort */ }
  }

  return result;
}

/**
 * Scan all assets and return regime classification for each.
 *
 * @param {string[]} [assets]
 * @returns {Promise<Object<string, object>>}
 */
async function scanRegimes(assets) {
  const targetAssets = assets || ['BTC', 'ETH', 'SOL', 'DOGE', 'AVAX', 'LINK', 'XRP', 'ARB', 'OP'];
  const results = {};

  for (const asset of targetAssets) {
    try {
      results[asset] = await detectRegime(asset);
    } catch (err) {
      results[asset] = { regime: 'unknown', confidence: 0, asset, error: err?.message };
    }
  }

  // Compute market-wide regime consensus
  const regimeCounts = {};
  for (const r of Object.values(results)) {
    const reg = r.regime || 'unknown';
    regimeCounts[reg] = (regimeCounts[reg] || 0) + 1;
  }
  const dominantRegime = Object.entries(regimeCounts).sort((a, b) => b[1] - a[1])[0];

  return {
    assets: results,
    marketRegime: dominantRegime ? dominantRegime[0] : 'unknown',
    regimeDistribution: regimeCounts,
    scannedAt: new Date().toISOString(),
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  classifyRegime,
  detectRegime,
  scanRegimes,
  getRecommendation,
  calculateADX,
  bollingerBandWidth,
  volumeProfile,
  atrRegime,
};
