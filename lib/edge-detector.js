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
const CONFIDENCE_BASE = Math.min(0.99, Math.max(0.01, Number(process.env.EDGE_CONFIDENCE_BASE || 0.50)));
const CONFIDENCE_SCALE = Math.min(2.0, Math.max(0.01, Number(process.env.EDGE_CONFIDENCE_SCALE || 0.75)));
const EDGE_SCALE = Math.min(10.0, Math.max(0.1, Number(process.env.EDGE_EDGE_SCALE || 2.0)));

// ─── Funding Rate Contrarian Intelligence ────────────────────────────────────
// Extreme funding = crowded positioning = potential reversal risk
const FUNDING_RATE_EXTREME_THRESHOLD = Math.max(0.0001, Math.min(0.005, Number(process.env.EDGE_FUNDING_EXTREME_THRESHOLD || 0.0005)));
const FUNDING_RATE_PENALTY = Math.max(0.5, Math.min(0.98, Number(process.env.EDGE_FUNDING_PENALTY || 0.80)));
const FUNDING_RATE_CACHE_MS = Math.max(30000, Math.min(600000, Number(process.env.EDGE_FUNDING_CACHE_MS || 120000)));

// ─── Logger ──────────────────────────────────────────────────────────────────
let _log;
try {
  const { createLogger } = require('./logger');
  _log = createLogger('edge-detector');
} catch {
  _log = { debug() {}, info: console.log, warn: console.warn, error: console.error, fatal: console.error };
}

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
  multiTfMomentum: 0.25,
  rsi: 0.12,
  macd: 0.10,
  bollingerBands: 0.10,
  volumeConfirmation: 0.10,
  atrVolatility: 0.05,
  regimeAlignment: 0.13,
  sentimentDivergence: 0.08,
  forecastAlignment: 0.03,
  geoRiskPenalty: 0.04,
}; // sums to 1.0

function getBrainWeights(regime) {
  // Check for promoted strategy weights from signal bus (highest priority)
  try {
    const bus = require('./agent-signal-bus');
    const promoted = bus.query({ type: 'promoted_weights', maxAgeMs: 30 * 60 * 1000 });
    if (promoted.length > 0 && promoted[0].payload?.weights) {
      const pw = promoted[0].payload.weights;
      if (Object.keys(pw).length > 0) return { ...DEFAULT_INDICATOR_WEIGHTS, ...pw };
    }
  } catch (err) { _log.warn('getBrainWeights: promoted weights lookup failed', { error: err?.message || err }); }
  // Fall back to brain-evolved weights
  try {
    if (_brainModule) {
      const evolved = _brainModule.getEvolvedWeights(null, regime || null);
      if (evolved && Object.keys(evolved).length > 0) return { ...DEFAULT_INDICATOR_WEIGHTS, ...evolved };
    }
  } catch (err) { _log.warn('getBrainWeights: brain-evolved weights lookup failed', { error: err?.message || err }); }
  return DEFAULT_INDICATOR_WEIGHTS;
}

function getBrainThresholds() {
  try {
    if (_brainModule) {
      const t = _brainModule.getEvolvedThresholds();
      if (t) return t;
    }
  } catch (err) { _log.warn('getBrainThresholds: threshold lookup failed', { error: err?.message || err }); }
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

  // ═══ ENHANCED: Circuit-breaker-wrapped multi-source candle fetching ═══
  let circuitBreaker;
  try { circuitBreaker = require('./circuit-breaker'); } catch { circuitBreaker = null; }

  // Try Binance first (wrapped in circuit breaker if available)
  let candles = [];
  if (circuitBreaker) {
    candles = await circuitBreaker.call('binance', () => binanceCandles(ids.binance, interval, limit), { fallback: [] });
  } else {
    candles = await binanceCandles(ids.binance, interval, limit);
  }

  // Fallback to Coinbase if Binance returned insufficient data
  if (candles.length < 10) {
    if (circuitBreaker) {
      candles = await circuitBreaker.call('coinbase', () => coinbaseCandles(ids.coinbase, interval, limit), { fallback: [] });
    } else {
      candles = await coinbaseCandles(ids.coinbase, interval, limit);
    }
  }

  // ═══ ENRICHMENT: Attach latest aggregated price from price aggregator ═══
  if (candles.length > 0) {
    let priceAggregator;
    try { priceAggregator = require('./price-aggregator'); } catch { priceAggregator = null; }
    if (priceAggregator) {
      try {
        const agg = await priceAggregator.getCachedOrFreshPrice(asset);
        if (agg && agg.vwap > 0 && candles.length > 0) {
          // FIX M-5: Preserve original close — store VWAP in separate field to avoid indicator contamination
          const latest = candles[candles.length - 1];
          const deviation = Math.abs(agg.vwap - latest.close) / latest.close;
          if (deviation < 0.02) { // Only if within 2% — sanity check
            latest._originalClose = latest.close;
            latest.aggregatedClose = agg.vwap;
            latest._aggregatedSources = agg.sourceCount;
            // NOTE: latest.close is NOT overwritten — indicators use original exchange price
          }
        }
      } catch { /* best-effort enrichment */ }
    }
  }

  return candles;
}

// ─── Funding Rate Fetcher ────────────────────────────────────────────────────

const _fundingRateCache = { data: null, fetchedAt: 0 };

/**
 * Fetch perpetual futures funding rate from Binance as a contrarian indicator.
 * Highly positive funding = longs are crowded (paying shorts) → reversal risk for bulls.
 * Highly negative funding = shorts are crowded (paying longs) → reversal risk for bears.
 *
 * @param {string} asset - Base asset (BTC, ETH, etc.)
 * @returns {Promise<{fundingRate: number|null, markPrice: number|null, nextFundingTime: number|null}>}
 */
async function fetchFundingRate(asset) {
  const now = Date.now();
  const cacheKey = asset || 'BTC';

  // Return cached data if still fresh
  if (_fundingRateCache.data && _fundingRateCache.asset === cacheKey && (now - _fundingRateCache.fetchedAt) < FUNDING_RATE_CACHE_MS) {
    return _fundingRateCache.data;
  }

  const ids = ASSET_MAP[asset] || ASSET_MAP.BTC;
  const symbol = ids.binance; // e.g. BTCUSDT

  try {
    const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`;
    const data = await fetchJson(url);
    if (!data || !data.lastFundingRate) {
      _log.debug('funding rate unavailable', { asset, symbol });
      return { fundingRate: null, markPrice: null, nextFundingTime: null };
    }

    const result = {
      fundingRate: Number(data.lastFundingRate),
      markPrice: Number(data.markPrice) || null,
      nextFundingTime: Number(data.nextFundingTime) || null,
    };

    // Cache it
    _fundingRateCache.data = result;
    _fundingRateCache.asset = cacheKey;
    _fundingRateCache.fetchedAt = now;

    return result;
  } catch (err) {
    _log.debug('funding rate fetch failed (non-fatal)', { asset, error: err?.message || err });
    return { fundingRate: null, markPrice: null, nextFundingTime: null };
  }
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
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / (period - 1);
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

/** MACD — returns { macd, signal, histogram } */
function macd(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const emaFast = ema(closes, fastPeriod);
  const emaSlow = ema(closes, slowPeriod);
  if (emaFast.length === 0 || emaSlow.length === 0) return null;
  // Align arrays (emaSlow is shorter)
  const offset = emaFast.length - emaSlow.length;
  const macdLine = emaSlow.map((s, i) => emaFast[i + offset] - s);
  const signalLine = ema(macdLine, signalPeriod);
  if (signalLine.length === 0) return null;
  const sigOffset = macdLine.length - signalLine.length;
  const histogram = signalLine.map((s, i) => macdLine[i + sigOffset] - s);
  return {
    macd: macdLine[macdLine.length - 1],
    signal: signalLine[signalLine.length - 1],
    histogram: histogram[histogram.length - 1],
    histogramPrev: histogram.length > 1 ? histogram[histogram.length - 2] : 0,
  };
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
  const TF_WEIGHTS = { '1m': 0.05, '5m': 0.20, '15m': 0.25, '1h': 0.30, '4h': 0.20 };
  const results = [];
  const candleCache = {};

  const promises = timeframes.map(async (tf) => {
    const candles = await getCandles(asset, tf, 50);
    candleCache[tf] = candles;
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

    // ATR-based strength normalization (avoids saturation at 1.0 for all assets)
    const priceRange = candles.slice(-14).reduce((max, c) => Math.max(max, c.high - c.low), 0.0001);
    const localAtr = candles.slice(-14).reduce((sum, c) => sum + (c.high - c.low), 0) / Math.min(14, candles.length);

    // EMA cross gives direction
    if (ema8Last > ema21Last) {
      side = 'buy';
      strength = Math.min(1, Math.abs(ema8Last - ema21Last) / (localAtr || priceRange));
    } else if (ema8Last < ema21Last) {
      side = 'sell';
      strength = Math.min(1, Math.abs(ema8Last - ema21Last) / (localAtr || priceRange));
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

  // Weighted confluence: timeframes contribute proportionally to their weight
  let buyWeight = 0;
  let sellWeight = 0;
  let totalWeight = 0;
  let buyStrengthSum = 0;
  let sellStrengthSum = 0;
  let buyCount = 0;
  let sellCount = 0;

  for (const r of results) {
    const tfW = TF_WEIGHTS[r.tf] || 0.10;
    if (r.side === 'buy') {
      buyWeight += tfW;
      buyStrengthSum += r.strength * tfW;
      buyCount++;
    } else if (r.side === 'sell') {
      sellWeight += tfW;
      sellStrengthSum += r.strength * tfW;
      sellCount++;
    }
    if (r.side !== 'neutral') totalWeight += tfW;
  }

  let direction = 'neutral';
  let confluence = 0;
  let avgStrength = 0;

  if (buyWeight > sellWeight) {
    direction = 'buy';
    confluence = totalWeight > 0 ? buyWeight / totalWeight : 0;
    avgStrength = buyWeight > 0 ? buyStrengthSum / buyWeight : 0;
  } else if (sellWeight > buyWeight) {
    direction = 'sell';
    confluence = totalWeight > 0 ? sellWeight / totalWeight : 0;
    avgStrength = sellWeight > 0 ? sellStrengthSum / sellWeight : 0;
  }

  return { direction, confluence, avgStrength, timeframes: results, candleCache };
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
  const hourCandles = mtf.candleCache?.['1h'] || await getCandles(asset, '1h', 50);
  const hourCloses = hourCandles.map((c) => c.close);
  const rsiVal = rsi(hourCloses, 14);
  components.rsi = rsiVal;

  if (rsiVal !== null) {
    if (rsiVal > (bt.overboughtRsi || 70)) compositeScore -= w.rsi; // overbought → bearish pressure
    else if (rsiVal < (bt.oversoldRsi || 30)) compositeScore += w.rsi; // oversold → bullish pressure
    else if (rsiVal > 55) compositeScore += w.rsi * 0.33;
    else if (rsiVal < 45) compositeScore -= w.rsi * 0.33;
  }

  // 2b. MACD — momentum divergence detector (uses dedicated w.macd weight)
  const macdVal = macd(hourCloses);
  components.macd = macdVal;
  if (macdVal) {
    // MACD histogram acceleration: positive & increasing = bullish, negative & decreasing = bearish
    const histStrength = Math.min(1, Math.abs(macdVal.histogram) / (Math.abs(macdVal.signal) || 1));
    if (macdVal.histogram > 0 && macdVal.histogram > macdVal.histogramPrev) {
      compositeScore += w.macd * histStrength;
    } else if (macdVal.histogram < 0 && macdVal.histogram < macdVal.histogramPrev) {
      compositeScore -= w.macd * histStrength;
    }
    // FIX H-3: MACD crossover — use 0.3x instead of 0.5x to prevent double-counting
    // Total MACD contribution capped at ~1.3x nominal weight (histogram + crossover)
    const crossoverDirection = macdVal.macd > macdVal.signal ? 1 : macdVal.macd < macdVal.signal ? -1 : 0;
    if (crossoverDirection !== 0) {
      compositeScore += w.macd * 0.3 * crossoverDirection;
    }
  }

  // 3. Bollinger Bands — detect squeeze and expansion
  const bb = bollingerBands(hourCloses, 20, 2);
  components.bollingerBands = bb;

  if (bb) {
    // High %B (near upper band) → overbought, low %B → oversold (brain-tuned thresholds)
    if (bb.percentB > (bt.bbPercentBHigh || 0.9)) compositeScore -= w.bollingerBands;
    else if (bb.percentB < (bt.bbPercentBLow || 0.1)) compositeScore += w.bollingerBands;

    // Wide bands = high volatility → reduce confidence
    // Narrow bands = squeeze → directional uncertainty, reduce magnitude
    if (bb.width < (bt.bbSqueezeWidth || 0.02)) {
      // Squeeze = directional uncertainty. Reduce magnitude, wait for breakout.
      compositeScore *= 0.85;
      components.bbSqueeze = true;
    }
    else if (bb.width > (bt.bbHighVolWidth || 0.08)) compositeScore *= HIGH_VOL_PENALTY; // high vol penalty
  }

  // Compute lastPrice early (needed by VWAP and ATR sections)
  const lastPrice = hourCandles.length > 0 ? hourCandles[hourCandles.length - 1].close : 0;

  // 3b. VWAP deviation — institutional reference price
  const vwapVal = vwap(hourCandles, 20);
  components.vwap = vwapVal;
  if (vwapVal && lastPrice > 0) {
    const vwapDev = (lastPrice - vwapVal) / vwapVal;
    // Price above VWAP = bullish bias, below = bearish bias
    if (vwapDev > 0.005) compositeScore += w.atrVolatility * 0.5; // reuse a small weight
    else if (vwapDev < -0.005) compositeScore -= w.atrVolatility * 0.5;
    // Extreme deviation from VWAP (>2%) = mean reversion risk
    if (Math.abs(vwapDev) > 0.02) {
      compositeScore *= 0.90; // reduce conviction at extremes
    }
  }

  // 4. ATR-based volatility threshold
  const atrVal = atr(hourCandles, 14);
  components.atr = atrVal;
  const atrPercent = lastPrice > 0 && atrVal ? (atrVal / lastPrice) * 100 : 1;

  // Dynamic threshold: in low vol require less move, in high vol require more
  const dynamicThresholdBps = Math.max(3, Math.min(20, atrPercent * 100 * 0.15));
  components.dynamicThresholdBps = dynamicThresholdBps;

  // 5. Volume confirmation
  const minCandles5m = mtf.candleCache?.['5m'] || await getCandles(asset, '5m', 25);
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
      const damper = bt.geoRiskDamper || 0.8;
      compositeScore = Math.sign(compositeScore) * Math.abs(compositeScore) * damper;
      // For buy signals during geo-risk: dampen (reduce)
      // For sell signals during geo-risk: STRENGTHEN (invert damper)
      if (compositeScore < 0) {
        compositeScore /= damper; // undo damping on sell, then boost
        compositeScore *= (2 - damper); // e.g., 0.8 -> 1.2 boost for sells
      }
    }

    // Edge signals from scanner — if scanner found a specific opportunity, boost it
    const matchingEdge = busCtx.edgeSignals.find((e) => e.asset === asset);
    if (matchingEdge) {
      if (matchingEdge.side === 'buy' && compositeScore > 0) compositeScore += 0.05 * matchingEdge.confidence;
      else if (matchingEdge.side === 'sell' && compositeScore < 0) compositeScore -= 0.05 * matchingEdge.confidence;
    }
  }

  // 7. Sentiment-momentum divergence detector (tracked as component only — weighted
  //    sentiment contribution is applied in section 7b to avoid double-counting)
  if (busCtx.available && busCtx.alphaRegime) {
    const alphaStr = typeof busCtx.alphaRegime === 'object' ? busCtx.alphaRegime.regime || busCtx.alphaRegime.label : String(busCtx.alphaRegime);
    // Fear + upward momentum = contrarian bullish
    if (alphaStr === 'risk_off' && mtf.direction === 'buy' && mtf.confluence > 0.6) {
      components.sentimentDivergence = { type: 'bullish_divergence', note: 'fear + uptrend momentum' };
    }
    // Greed + downward momentum = contrarian bearish
    if (alphaStr === 'risk_on' && mtf.direction === 'sell' && mtf.confluence > 0.6) {
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
        // FIX C-4: Use Math.sign to preserve direction — previously Math.abs() weakened sell signals
        compositeScore += Math.sign(compositeScore) * Math.abs(sentimentBoost) * sentConfirmFactor; // confirming sentiment
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

  // 10. Funding rate contrarian intelligence — crowded positioning detection
  //     Extreme positive funding + bullish signal = crowded long → reduce conviction
  //     Extreme negative funding + bearish signal = crowded short → reduce conviction
  try {
    const fundingData = await fetchFundingRate(asset);
    components.fundingRate = fundingData;
    if (fundingData.fundingRate !== null && Number.isFinite(fundingData.fundingRate)) {
      const fr = fundingData.fundingRate;
      const absFr = Math.abs(fr);
      if (absFr > FUNDING_RATE_EXTREME_THRESHOLD) {
        // Crowded longs (positive funding) + bullish signal = contrarian warning
        if (fr > 0 && compositeScore > 0) {
          const scaledPenalty = Math.max(FUNDING_RATE_PENALTY, 1 - (absFr / FUNDING_RATE_EXTREME_THRESHOLD) * (1 - FUNDING_RATE_PENALTY));
          compositeScore *= scaledPenalty;
          components.fundingWarning = { type: 'crowded_longs', fundingRate: fr, penalty: scaledPenalty };
          _log.info('funding rate contrarian: crowded longs penalizing bullish signal', { asset, fundingRate: fr, penalty: scaledPenalty });
        }
        // Crowded shorts (negative funding) + bearish signal = contrarian warning
        else if (fr < 0 && compositeScore < 0) {
          const scaledPenalty = Math.max(FUNDING_RATE_PENALTY, 1 - (absFr / FUNDING_RATE_EXTREME_THRESHOLD) * (1 - FUNDING_RATE_PENALTY));
          compositeScore *= scaledPenalty;
          components.fundingWarning = { type: 'crowded_shorts', fundingRate: fr, penalty: scaledPenalty };
          _log.info('funding rate contrarian: crowded shorts penalizing bearish signal', { asset, fundingRate: fr, penalty: scaledPenalty });
        }
        // Opposite: extreme funding AGAINST our signal = extra edge (contrarian confirmation)
        else if ((fr > 0 && compositeScore < 0) || (fr < 0 && compositeScore > 0)) {
          const contrarianBonus = Math.min(0.05, absFr * 20); // small bonus for contrarian alignment
          compositeScore += Math.sign(compositeScore) * contrarianBonus;
          components.fundingWarning = { type: 'contrarian_confirmation', fundingRate: fr, bonus: contrarianBonus };
          _log.info('funding rate contrarian: crowded positioning confirms our contrarian signal', { asset, fundingRate: fr, bonus: contrarianBonus });
        }
      }
    }
  } catch (err) {
    // Funding rate failure is non-fatal — do not block signals
    _log.debug('funding rate integration skipped', { error: err?.message || err });
  }

  // ─── Final resolution ──────────────────────────────────────────────────────
  const absScore = Math.abs(compositeScore);

  // Determine side (dynamic threshold from ATR instead of fixed 0.06)
  const neutralBound = Math.max(0.03, Math.min(0.12, dynamicThresholdBps / 100));
  if (compositeScore > neutralBound) side = 'buy';
  else if (compositeScore < -neutralBound) side = 'sell';
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
  fetchFundingRate,
  // Individual indicators (exported for testing)
  ema,
  sma,
  rsi,
  macd,
  bollingerBands,
  atr,
  vwap,
  volumeConfirmation,
  getCandles,
  ASSET_MAP,
};
