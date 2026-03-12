/**
 * Edge Detector — Multi-timeframe, multi-indicator composite signal engine.
 *
 * Replaces the naive 8-candle momentum check with a sophisticated system that:
 *  1. Fetches candles across multiple timeframes (1m, 5m, 15m, 1h, 4h)
 *  2. Computes RSI(14), Bollinger Bands, EMA crossovers, ATR
 *  3. Reads signal bus for regime, forecast, geo-risk, and alpha signals
 *  4. Produces a composite confidence score that gates trading decisions
 *  5. Adjusts thresholds dynamically based on volatility (ATR)
 *
 * Usage:
 *   const edge = require('../lib/edge-detector');
 *   const signal = await edge.getCompositeSignal({ asset: 'BTC', quoteCurrency: 'USD' });
 *   // signal = { side, confidence, edge, components, meta }
 */

const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.EDGE_DETECTOR_TIMEOUT_MS || 12000));

// ─── Configurable Constants ─────────────────────────────────────────────────
const EMA_FAST_PERIOD = Math.max(3, parseInt(process.env.EDGE_EMA_FAST || '8', 10));
const EMA_SLOW_PERIOD = Math.max(10, parseInt(process.env.EDGE_EMA_SLOW || '21', 10));
const CROSSOVER_BONUS = Math.max(0, Math.min(1, Number(process.env.EDGE_CROSSOVER_BONUS || 0.3)));
const SQUEEZE_BONUS = Math.max(1, Number(process.env.EDGE_SQUEEZE_BONUS || 1.15));
const HIGH_VOL_PENALTY = Math.max(0.5, Math.min(1, Number(process.env.EDGE_HIGH_VOL_PENALTY || 0.85)));
const DIVERSIFICATION_THRESHOLD = Math.max(10, Math.min(80, Number(process.env.EDGE_DIVERSIFICATION_THRESHOLD || 40)));
const MIN_DIVERSIFICATION_MULT = Math.max(0.3, Math.min(1, Number(process.env.EDGE_MIN_DIVERSIFICATION_MULT || 0.60)));
const CONFIDENCE_BASE = Number(process.env.EDGE_CONFIDENCE_BASE || 0.50);
const CONFIDENCE_SCALE = Number(process.env.EDGE_CONFIDENCE_SCALE || 0.75);
const EDGE_SCALE = Number(process.env.EDGE_EDGE_SCALE || 2.0);

// ─── Brain Integration ────────────────────────────────────────────────────────
// Load evolved weights from the self-evolving brain. Falls back to hardcoded
// defaults if the brain module isn't available (first boot, etc.).
let _brainModule = null;
try { _brainModule = require('./self-evolving-brain'); } catch {}

let _mlPipeline = null;
try { _mlPipeline = require('./ml-pipeline'); } catch {}

let _correlationMonitor = null;
try { _correlationMonitor = require('./correlation-monitor'); } catch {}

const DEFAULT_INDICATOR_WEIGHTS = {
  multiTfMomentum: 0.30,
  rsi: 0.15,
  bollingerBands: 0.10,
  volumeConfirmation: 0.10,
  atrVolatility: 0.05,
  regimeAlignment: 0.15,
  sentimentDivergence: 0.08,
  forecastAlignment: 0.03,
  geoRiskPenalty: 0.04,
};

function getBrainWeights(regime) {
  // Check for promoted strategy weights from signal bus (highest priority)
  try {
    const bus = require('./agent-signal-bus');
    const promoted = bus.query({ type: 'promoted_weights', maxAgeMs: 30 * 60 * 1000 });
    if (promoted.length > 0 && promoted[0].payload?.weights) {
      const pw = promoted[0].payload.weights;
      if (Object.keys(pw).length > 0) return { ...DEFAULT_INDICATOR_WEIGHTS, ...pw };
    }
  } catch {}
  // Fall back to brain-evolved weights
  try {
    if (_brainModule) {
      const evolved = _brainModule.getEvolvedWeights(null, regime || null);
      if (evolved && Object.keys(evolved).length > 0) return { ...DEFAULT_INDICATOR_WEIGHTS, ...evolved };
    }
  } catch {}
  return DEFAULT_INDICATOR_WEIGHTS;
}

function getBrainThresholds() {
  try {
    if (_brainModule) {
      const t = _brainModule.getEvolvedThresholds();
      if (t) return t;
    }
  } catch {}
  return { overboughtRsi: 70, oversoldRsi: 30, bbPercentBHigh: 0.9, bbPercentBLow: 0.1, bbSqueezeWidth: 0.02, bbHighVolWidth: 0.08, volumeMinRatio: 0.8, volumeSurgeRatio: 2.0, regimeBoostFactor: 0.15, regimePenaltyFactor: 0.10, forecastBoostBps: 0.03, geoRiskDamper: 0.8, contrarianBoost: 0.08, sentimentConfirmFactor: 0.5, sentimentContraPenalty: 0.3 };
}

// ─── Fetching ────────────────────────────────────────────────────────────────

function withTimeout(ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { controller, timeout };
}

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const { controller, timeout } = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Candle Providers ────────────────────────────────────────────────────────

const BINANCE_INTERVALS = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h' };
const COINBASE_GRANULARITY = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 };

/**
 * Fetch OHLCV candles from Binance.
 * @returns {Array<{open, high, low, close, volume, ts}>}
 */
async function binanceCandles(symbol, interval, limit = 50) {
  const bInterval = BINANCE_INTERVALS[interval];
  if (!bInterval) return [];
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${bInterval}&limit=${limit}`;
  const data = await fetchJson(url);
  if (!Array.isArray(data)) return [];
  return data.map((k) => ({
    ts: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  })).filter((c) => Number.isFinite(c.close) && c.close > 0);
}

/**
 * Fetch OHLCV candles from Coinbase as fallback.
 */
async function coinbaseCandles(product, interval, limit = 50) {
  const granularity = COINBASE_GRANULARITY[interval];
  if (!granularity) return [];
  const url = `https://api.exchange.coinbase.com/products/${product}/candles?granularity=${granularity}`;
  const data = await fetchJson(url);
  if (!Array.isArray(data)) return [];
  return data.slice(0, limit).reverse().map((c) => ({
    ts: Number(c[0]) * 1000,
    open: Number(c[3]),
    high: Number(c[2]),
    low: Number(c[1]),
    close: Number(c[4]),
    volume: Number(c[5]),
  })).filter((c) => Number.isFinite(c.close) && c.close > 0);
}

const ASSET_MAP = {
  BTC: { binance: 'BTCUSDT', coinbase: 'BTC-USD' },
  ETH: { binance: 'ETHUSDT', coinbase: 'ETH-USD' },
  SOL: { binance: 'SOLUSDT', coinbase: 'SOL-USD' },
  DOGE: { binance: 'DOGEUSDT', coinbase: 'DOGE-USD' },
  AVAX: { binance: 'AVAXUSDT', coinbase: 'AVAX-USD' },
  LINK: { binance: 'LINKUSDT', coinbase: 'LINK-USD' },
  MATIC: { binance: 'MATICUSDT', coinbase: 'MATIC-USD' },
  ARB: { binance: 'ARBUSDT', coinbase: 'ARB-USD' },
  OP: { binance: 'OPUSDT', coinbase: 'OP-USD' },
  XRP: { binance: 'XRPUSDT', coinbase: 'XRP-USD' },
};

async function getCandles(asset, interval, limit = 50) {
  const ids = ASSET_MAP[asset] || ASSET_MAP.BTC;
  let candles = await binanceCandles(ids.binance, interval, limit);
  if (candles.length < 10) {
    candles = await coinbaseCandles(ids.coinbase, interval, limit);
  }
  return candles;
}

// ─── Technical Indicators ────────────────────────────────────────────────────

/** Exponential Moving Average */
function ema(closes, period) {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const result = [closes.slice(0, period).reduce((s, v) => s + v, 0) / period];
  for (let i = period; i < closes.length; i++) {
    result.push(closes[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
}

/** Simple Moving Average */
function sma(closes, period) {
  const result = [];
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    result.push(slice.reduce((s, v) => s + v, 0) / period);
  }
  return result;
}

/** RSI(period) — returns 0-100 */
function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) gainSum += delta;
    else lossSum -= delta;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (delta > 0 ? delta : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (delta < 0 ? -delta : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Bollinger Bands — returns { upper, middle, lower, width, percentB } */
function bollingerBands(closes, period = 20, stdDevMultiplier = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = mean + stdDevMultiplier * stdDev;
  const lower = mean - stdDevMultiplier * stdDev;
  const lastClose = closes[closes.length - 1];
  const width = (upper - lower) / mean;
  const percentB = upper !== lower ? (lastClose - lower) / (upper - lower) : 0.5;
  return { upper, middle: mean, lower, width, percentB };
}

/** Average True Range */
function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trs.push(tr);
  }
  // Wilder's smoothing
  let atrVal = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period;
  }
  return atrVal;
}

/** Volume-weighted average price of recent candles */
function vwap(candles, period = 20) {
  const slice = candles.slice(-period);
  let cumPV = 0;
  let cumVol = 0;
  for (const c of slice) {
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * c.volume;
    cumVol += c.volume;
  }
  return cumVol > 0 ? cumPV / cumVol : null;
}

/** Check if volume is above average */
function volumeConfirmation(candles, lookback = 20) {
  if (candles.length < lookback + 1) return { confirmed: true, ratio: 1 };
  const avgVol = candles.slice(-lookback - 1, -1).reduce((s, c) => s + c.volume, 0) / lookback;
  const currentVol = candles[candles.length - 1].volume;
  return { confirmed: avgVol > 0 && currentVol >= avgVol * 0.8, ratio: avgVol > 0 ? currentVol / avgVol : 1 };
}

// ─── Multi-Timeframe Momentum ────────────────────────────────────────────────

/**
 * Compute momentum across multiple timeframes.
 * Returns confluence score: how many timeframes agree on direction.
 */
async function multiTimeframeMomentum(asset) {
  const timeframes = ['1m', '5m', '15m', '1h', '4h'];
  const results = [];

  const promises = timeframes.map(async (tf) => {
    const candles = await getCandles(asset, tf, 50);
    if (candles.length < 10) return { tf, side: 'neutral', strength: 0 };

    const closes = candles.map((c) => c.close);
    const ema8 = ema(closes, EMA_FAST_PERIOD);
    const ema21 = ema(closes, EMA_SLOW_PERIOD);

    if (ema8.length < 2 || ema21.length < 2) return { tf, side: 'neutral', strength: 0 };

    // EMA crossover direction
    const ema8Last = ema8[ema8.length - 1];
    const ema21Last = ema21[ema21.length - 1];
    const ema8Prev = ema8[ema8.length - 2];
    const ema21Prev = ema21[ema21.length - 2];

    // Simple momentum: last vs first in window
    const first = closes[0];
    const last = closes[closes.length - 1];
    const returnBps = ((last - first) / first) * 10000;

    let side = 'neutral';
    let strength = 0;

    // EMA cross gives direction
    if (ema8Last > ema21Last) {
      side = 'buy';
      strength = Math.min(1, (ema8Last - ema21Last) / ema21Last * 1000);
    } else if (ema8Last < ema21Last) {
      side = 'sell';
      strength = Math.min(1, (ema21Last - ema8Last) / ema21Last * 1000);
    }

    // Fresh crossover bonus
    const justCrossedUp = ema8Prev <= ema21Prev && ema8Last > ema21Last;
    const justCrossedDown = ema8Prev >= ema21Prev && ema8Last < ema21Last;
    if (justCrossedUp || justCrossedDown) strength = Math.min(1, strength + CROSSOVER_BONUS);

    return { tf, side, strength, returnBps };
  });

  const settled = await Promise.allSettled(promises);
  for (const r of settled) {
    if (r.status === 'fulfilled') results.push(r.value);
  }

  // Confluence: how many timeframes agree
  const buys = results.filter((r) => r.side === 'buy');
  const sells = results.filter((r) => r.side === 'sell');
  const total = results.filter((r) => r.side !== 'neutral').length || 1;

  let direction = 'neutral';
  let confluence = 0;
  let avgStrength = 0;

  if (buys.length > sells.length) {
    direction = 'buy';
    confluence = buys.length / total;
    avgStrength = buys.reduce((s, r) => s + r.strength, 0) / buys.length;
  } else if (sells.length > buys.length) {
    direction = 'sell';
    confluence = sells.length / total;
    avgStrength = sells.reduce((s, r) => s + r.strength, 0) / sells.length;
  }

  return { direction, confluence, avgStrength, timeframes: results };
}

// ─── Signal Bus Integration ──────────────────────────────────────────────────

function getSignalBusContext() {
  try {
    const bus = require('./agent-signal-bus');
    const regime = bus.consensus('market_regime');
    const alphaRegime = bus.consensus('alpha_regime');
    const forecast = bus.query({ type: 'forecast', maxAgeMs: 4 * 60 * 60 * 1000 }).slice(0, 3);
    const geoRisk = bus.query({ type: 'geo_risk', maxAgeMs: 6 * 60 * 60 * 1000 }).slice(0, 1);
    const edgeSignals = bus.query({ type: 'edge_opportunity', maxAgeMs: 30 * 60 * 1000 });
    const sentimentSignals = bus.query({ type: 'sentiment', maxAgeMs: 2 * 60 * 60 * 1000 });

    return {
      available: true,
      regime: regime?.value || null,
      regimeConfidence: regime?.confidence || 0,
      alphaRegime: alphaRegime?.value || null,
      alphaConfidence: alphaRegime?.confidence || 0,
      forecasts: forecast.map((f) => f.payload),
      geoRisk: geoRisk[0]?.payload || null,
      geoRiskConfidence: geoRisk[0]?.confidence || 0,
      edgeSignals: edgeSignals.map((e) => ({ asset: e.payload?.asset, side: e.payload?.side, confidence: e.confidence })),
      sentimentSignals: sentimentSignals.map((s) => ({ asset: s.payload?.asset, sentiment: s.payload?.sentiment, direction: s.payload?.direction, confidence: s.confidence })),
    };
  } catch {
    return { available: false };
  }
}

// ─── Composite Signal ────────────────────────────────────────────────────────

/**
 * Produce a composite trading signal that combines:
 *  - Multi-timeframe EMA momentum + confluence
 *  - RSI (overbought/oversold filter)
 *  - Bollinger Bands (squeeze/expansion)
 *  - ATR-adjusted volatility thresholds
 *  - Volume confirmation
 *  - Signal bus regime/forecast/geo context
 *
 * @param {object} opts
 * @param {string} opts.asset - Base asset (BTC, ETH, SOL, etc.)
 * @param {string} [opts.quoteCurrency='USD']
 * @param {object} [opts.weightsOverride=null] - Optional weight overrides for A/B testing strategies
 * @returns {Promise<{side, confidence, edge, components, meta}>}
 */
async function getCompositeSignal({ asset = 'BTC', quoteCurrency = 'USD', weightsOverride = null } = {}) {
  const components = {};
  let side = 'neutral';
  let compositeScore = 0; // -1 (strong sell) to +1 (strong buy)

  // Load evolved brain weights (falls back to defaults if brain unavailable)
  // Detect current regime from signal bus so brain uses regime-specific weights
  const busCtxEarly = getSignalBusContext();
  let detectedRegime = null;
  if (busCtxEarly.available && busCtxEarly.regime) {
    const r = busCtxEarly.regime;
    detectedRegime = typeof r === 'object' ? r.regime || r.label : String(r);
  }
  // Allow explicit weight override (for A/B testing, strategy promoter validation, etc.)
  const w = weightsOverride && Object.keys(weightsOverride).length > 0
    ? { ...DEFAULT_INDICATOR_WEIGHTS, ...weightsOverride }
    : getBrainWeights(detectedRegime);
  const bt = getBrainThresholds();

  // 1. Multi-timeframe momentum (brain-weighted)
  const mtf = await multiTimeframeMomentum(asset);
  components.multiTfMomentum = mtf;

  if (mtf.direction === 'buy') compositeScore += w.multiTfMomentum * mtf.confluence * (0.5 + 0.5 * mtf.avgStrength);
  else if (mtf.direction === 'sell') compositeScore -= w.multiTfMomentum * mtf.confluence * (0.5 + 0.5 * mtf.avgStrength);

  // 2. RSI — fetch 1h candles for RSI(14)
  const hourCandles = await getCandles(asset, '1h', 50);
  const hourCloses = hourCandles.map((c) => c.close);
  const rsiVal = rsi(hourCloses, 14);
  components.rsi = rsiVal;

  if (rsiVal !== null) {
    if (rsiVal > (bt.overboughtRsi || 70)) compositeScore -= w.rsi; // overbought → bearish pressure
    else if (rsiVal < (bt.oversoldRsi || 30)) compositeScore += w.rsi; // oversold → bullish pressure
    else if (rsiVal > 55) compositeScore += w.rsi * 0.33;
    else if (rsiVal < 45) compositeScore -= w.rsi * 0.33;
  }

  // 3. Bollinger Bands — detect squeeze and expansion
  const bb = bollingerBands(hourCloses, 20, 2);
  components.bollingerBands = bb;

  if (bb) {
    // High %B (near upper band) → overbought, low %B → oversold (brain-tuned thresholds)
    if (bb.percentB > (bt.bbPercentBHigh || 0.9)) compositeScore -= w.bollingerBands;
    else if (bb.percentB < (bt.bbPercentBLow || 0.1)) compositeScore += w.bollingerBands;

    // Wide bands = high volatility → reduce confidence
    // Narrow bands = squeeze → potential breakout, increase confidence
    if (bb.width < (bt.bbSqueezeWidth || 0.02)) compositeScore *= SQUEEZE_BONUS; // squeeze bonus
    else if (bb.width > (bt.bbHighVolWidth || 0.08)) compositeScore *= HIGH_VOL_PENALTY; // high vol penalty
  }

  // 4. ATR-based volatility threshold
  const atrVal = atr(hourCandles, 14);
  components.atr = atrVal;
  const lastPrice = hourCandles.length > 0 ? hourCandles[hourCandles.length - 1].close : 0;
  const atrPercent = lastPrice > 0 && atrVal ? (atrVal / lastPrice) * 100 : 1;

  // Dynamic threshold: in low vol require less move, in high vol require more
  const dynamicThresholdBps = Math.max(3, Math.min(20, atrPercent * 100 * 0.15));
  components.dynamicThresholdBps = dynamicThresholdBps;

  // 5. Volume confirmation
  const minCandles5m = await getCandles(asset, '5m', 25);
  const volCheck = volumeConfirmation(minCandles5m, 20);
  components.volumeConfirmation = volCheck;

  if (!volCheck.confirmed && Math.abs(compositeScore) > 0.1) {
    compositeScore *= (1 - w.volumeConfirmation * 2.5); // reduce conviction if volume doesn't confirm
  }
  if (volCheck.ratio > (bt.volumeSurgeRatio || 2.0)) {
    compositeScore *= 1.1; // volume surge bonus
  }

  // 6. Signal bus context — regime, forecasts, geo risk (reuse early fetch)
  const busCtx = busCtxEarly;
  components.signalBus = busCtx;

  if (busCtx.available) {
    // Regime alignment (brain-tuned factors)
    const regime = busCtx.regime;
    if (regime) {
      const regimeStr = typeof regime === 'object' ? regime.regime || regime.label : String(regime);
      const regimeBoost = bt.regimeBoostFactor || 0.15;
      const regimePenalty = bt.regimePenaltyFactor || 0.10;
      if (regimeStr === 'risk_on' && compositeScore > 0) {
        compositeScore *= 1 + regimeBoost * busCtx.regimeConfidence;
      } else if (regimeStr === 'risk_off' && compositeScore < 0) {
        compositeScore *= 1 + regimeBoost * busCtx.regimeConfidence;
      } else if (regimeStr === 'risk_off' && compositeScore > 0) {
        compositeScore *= 1 - regimePenalty * busCtx.regimeConfidence; // contra-regime penalty
      } else if (regimeStr === 'risk_on' && compositeScore < 0) {
        compositeScore *= 1 - regimePenalty * busCtx.regimeConfidence;
      }
    }

    // Forecast alignment (brain-tuned boost)
    const fcBoost = bt.forecastBoostBps || 0.03;
    for (const f of busCtx.forecasts) {
      if (f.direction === 'bullish' && compositeScore > 0) compositeScore += fcBoost;
      else if (f.direction === 'bearish' && compositeScore < 0) compositeScore -= fcBoost;
    }

    // Geo risk — if high geo risk, reduce position conviction (brain-tuned damper)
    if (busCtx.geoRiskConfidence > 0.7) {
      compositeScore *= (bt.geoRiskDamper || 0.8);
    }

    // Edge signals from scanner — if scanner found a specific opportunity, boost it
    const matchingEdge = busCtx.edgeSignals.find((e) => e.asset === asset);
    if (matchingEdge) {
      if (matchingEdge.side === 'buy' && compositeScore > 0) compositeScore += 0.05 * matchingEdge.confidence;
      else if (matchingEdge.side === 'sell' && compositeScore < 0) compositeScore -= 0.05 * matchingEdge.confidence;
    }
  }

  // 7. Sentiment-momentum divergence detector (brain-tuned contrarian boost)
  const contrarianBoost = bt.contrarianBoost || 0.08;
  if (busCtx.available && busCtx.alphaRegime) {
    const alphaStr = typeof busCtx.alphaRegime === 'object' ? busCtx.alphaRegime.regime || busCtx.alphaRegime.label : String(busCtx.alphaRegime);
    // Fear + upward momentum = contrarian bullish
    if (alphaStr === 'risk_off' && mtf.direction === 'buy' && mtf.confluence > 0.6) {
      compositeScore += contrarianBoost; // contrarian signal
      components.sentimentDivergence = { type: 'bullish_divergence', note: 'fear + uptrend momentum' };
    }
    // Greed + downward momentum = contrarian bearish
    if (alphaStr === 'risk_on' && mtf.direction === 'sell' && mtf.confluence > 0.6) {
      compositeScore -= contrarianBoost;
      components.sentimentDivergence = { type: 'bearish_divergence', note: 'greed + downtrend momentum' };
    }
  }

  // 7b. Direct sentiment signal — consume sentiment agent's per-asset scores (brain-tuned factors)
  const sentConfirmFactor = bt.sentimentConfirmFactor || 0.5;
  const sentContraPenalty = bt.sentimentContraPenalty || 0.3;
  if (busCtx.available && Array.isArray(busCtx.sentimentSignals) && busCtx.sentimentSignals.length > 0) {
    const assetSentiment = busCtx.sentimentSignals.find(s => s.asset === asset);
    const globalSentiment = busCtx.sentimentSignals[0]; // most recent if no asset match
    const sentData = assetSentiment || globalSentiment;
    if (sentData && Number.isFinite(sentData.sentiment)) {
      // sentiment ranges -1 (extreme fear) to +1 (extreme greed)
      const sentimentBoost = sentData.sentiment * w.sentimentDivergence * (sentData.confidence || 0.5);
      // Align: positive sentiment + bullish score = reinforce; negative sentiment + bearish = reinforce
      if ((sentData.sentiment > 0 && compositeScore > 0) || (sentData.sentiment < 0 && compositeScore < 0)) {
        compositeScore += Math.abs(sentimentBoost) * sentConfirmFactor; // confirming sentiment
      } else if (Math.abs(sentData.sentiment) > 0.5) {
        compositeScore *= 1 - Math.abs(sentimentBoost) * sentContraPenalty; // contra-sentiment penalty
      }
      components.sentimentAgent = { asset: sentData.asset, sentiment: sentData.sentiment, direction: sentData.direction, confidence: sentData.confidence };
    }
  }

  // 8. ML Pipeline signal boost — blend GBM win probability into confidence
  if (_mlPipeline && typeof _mlPipeline.getMLSignalBoost === 'function') {
    try {
      const mlBoost = _mlPipeline.getMLSignalBoost(
        { side: compositeScore > 0 ? 'buy' : compositeScore < 0 ? 'sell' : 'neutral', confidence: Math.min(0.95, 0.5 + Math.abs(compositeScore) * 0.75), edge: Math.min(1, Math.abs(compositeScore) * 2), compositeScore },
        components
      );
      components.mlPipeline = {
        prediction: mlBoost.mlPrediction,
        adjustedConfidence: mlBoost.adjustedConfidence,
        shouldTrade: mlBoost.shouldTrade,
      };
      // ML model vetoes weak signals it predicts will lose
      if (!mlBoost.shouldTrade && Math.abs(compositeScore) < 0.15) {
        compositeScore *= 0.5; // halve conviction when ML says don't trade and signal is weak
      }
      // Boost strong agreement: when ML is confident and aligns with composite direction
      if (mlBoost.mlPrediction > 0.65 && compositeScore > 0) {
        compositeScore *= 1 + 0.10 * (mlBoost.mlPrediction - 0.5);
      } else if (mlBoost.mlPrediction < 0.35 && compositeScore < 0) {
        compositeScore *= 1 + 0.10 * (0.5 - mlBoost.mlPrediction);
      }
    } catch (err) {
      // ML pipeline failure is non-fatal
    }
  }

  // 9. Correlation-based diversification penalty — reduce conviction for crowded trades
  if (_correlationMonitor && typeof _correlationMonitor.getDiversificationScore === 'function') {
    try {
      const divScore = _correlationMonitor.getDiversificationScore();
      components.diversificationScore = divScore;
      // Below threshold diversification = high concentration risk → reduce new positions
      if (divScore < DIVERSIFICATION_THRESHOLD) {
        const penalty = 1 - (DIVERSIFICATION_THRESHOLD - divScore) / 100;
        compositeScore *= Math.max(MIN_DIVERSIFICATION_MULT, penalty);
      }
    } catch (err) {
      // Correlation monitor failure is non-fatal
    }
  }

  // ─── Final resolution ──────────────────────────────────────────────────────
  const absScore = Math.abs(compositeScore);

  // Determine side
  if (compositeScore > 0.02) side = 'buy';
  else if (compositeScore < -0.02) side = 'sell';
  else side = 'neutral';

  // Confidence: map |compositeScore| from [0, 0.6] → [CONFIDENCE_BASE, 0.95]
  const confidence = Math.min(0.95, CONFIDENCE_BASE + absScore * CONFIDENCE_SCALE);

  // Edge: how much better than random (edge = |score| essentially)
  const edge = Math.min(1, absScore * EDGE_SCALE);

  return {
    side,
    confidence,
    edge,
    compositeScore,
    dynamicThresholdBps,
    components,
    meta: {
      asset,
      quoteCurrency,
      computedAt: new Date().toISOString(),
      lastPrice,
      regime: detectedRegime,
    },
  };
}

// ─── Multi-Asset Scanner ─────────────────────────────────────────────────────

/**
 * Scan multiple assets and return the best opportunities.
 * @param {string[]} assets - Assets to scan
 * @param {number} topN - Return top N opportunities
 * @returns {Promise<Array<{asset, side, confidence, edge, compositeScore}>>}
 */
async function scanAssets(assets = ['BTC', 'ETH', 'SOL'], topN = 3) {
  const results = [];
  const promises = assets.map(async (asset) => {
    try {
      const signal = await getCompositeSignal({ asset });
      return { asset, ...signal };
    } catch {
      return null;
    }
  });

  const settled = await Promise.allSettled(promises);
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value && r.value.side !== 'neutral') {
      results.push(r.value);
    }
  }

  // Sort by edge * confidence (best opportunities first)
  results.sort((a, b) => (b.edge * b.confidence) - (a.edge * a.confidence));
  return results.slice(0, topN);
}

// ─── Dynamic Position Sizing ─────────────────────────────────────────────────

/**
 * Kelly-inspired position sizing based on edge and confidence.
 * @param {object} signal - Output of getCompositeSignal
 * @param {number} baseUsd - Base order size in USD
 * @param {number} maxMultiplier - Maximum scaling factor
 * @returns {number} Adjusted USD order size
 */
function dynamicOrderSize(signal, baseUsd = 15, maxMultiplier = 3) {
  const { confidence, edge } = signal;
  if (!edge || edge < 0.1) return baseUsd; // no edge, use minimum

  // Simplified Kelly: bet fraction = edge * confidence
  // But we cap at maxMultiplier * baseUsd
  const kellyFraction = Math.min(1, edge * confidence);
  const multiplier = 1 + kellyFraction * (maxMultiplier - 1);
  return Math.round(baseUsd * multiplier * 100) / 100;
}

module.exports = {
  getCompositeSignal,
  scanAssets,
  dynamicOrderSize,
  multiTimeframeMomentum,
  getSignalBusContext,
  // Individual indicators (exported for testing)
  ema,
  sma,
  rsi,
  bollingerBands,
  atr,
  vwap,
  volumeConfirmation,
  getCandles,
  ASSET_MAP,
};
