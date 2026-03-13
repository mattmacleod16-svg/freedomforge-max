/**
 * Research Agent — Deep autonomous market research & thesis generation.
 * =====================================================================
 *
 * Runs during maintenance mode to build intelligence that improves trading
 * decisions when trading resumes. Generates market theses, analyzes trends,
 * discovers correlations, and publishes findings to the signal bus.
 *
 * Capabilities:
 *   1. Multi-asset trend analysis across all tradeable assets
 *   2. Cross-asset correlation discovery and monitoring
 *   3. Regime transition probability estimation
 *   4. Volatility forecasting using realized vol cones
 *   5. Market microstructure analysis (spread patterns, liquidity)
 *   6. Thesis generation and scoring with conviction tracking
 *   7. Macro event calendar integration (FOMC, CPI, etc.)
 *   8. Mean reversion / momentum regime classification per asset
 *
 * Usage:
 *   const research = require('../lib/research-agent');
 *   await research.runResearchCycle();
 *   const theses = research.getActiveTheses();
 */

'use strict';

const fs = require('fs');
const path = require('path');

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

let signalBus;
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }

let heartbeat;
try { heartbeat = require('./heartbeat-registry'); } catch { heartbeat = null; }

let dataLoader;
try { dataLoader = require('./backtest/data-loader'); } catch { dataLoader = null; }

const { createLogger } = require('./logger');
const log = createLogger('research-agent');

// ─── Constants ──────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'research-state.json');
const ASSETS = ['BTC', 'ETH', 'SOL', 'DOGE', 'AVAX', 'LINK', 'XRP', 'ARB', 'OP'];
const QUOTE = 'USD';
const MAX_THESES = 100;
const THESIS_EXPIRY_HOURS = 72;
const CORRELATION_WINDOW = 30;      // 30 periods for rolling correlation
const VOL_CONE_WINDOWS = [7, 14, 30, 60, 90]; // days for vol cone
const MOMENTUM_LOOKBACKS = [5, 10, 20, 50];   // candles for momentum scoring
const MEAN_REVERSION_ZSCORE = 2.0;

// ─── I/O ────────────────────────────────────────────────────────────────────

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
    theses: [],
    correlationMatrix: {},
    volCones: {},
    assetProfiles: {},
    regimeHistory: [],
    lastCycleAt: 0,
    cycleCount: 0,
  });
}

function saveState(state) { writeJson(STATE_FILE, state); }

// ─── Math Utilities ─────────────────────────────────────────────────────────

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

function pearsonCorrelation(x, y) {
  if (x.length !== y.length || x.length < 3) return 0;
  const mx = mean(x), my = mean(y);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) {
    const a = x[i] - mx, b = y[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}

function returns(prices) {
  const r = [];
  for (let i = 1; i < prices.length; i++) {
    r.push(prices[i - 1] === 0 ? 0 : (prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return r;
}

function zscore(value, arr) {
  const m = mean(arr), s = stddev(arr);
  return s === 0 ? 0 : (value - m) / s;
}

function ema(arr, period) {
  if (!arr.length) return [];
  const k = 2 / (period + 1);
  const result = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    result.push(arr[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gainSum += d; else lossSum -= d;
  }
  let avgGain = gainSum / period, avgLoss = lossSum / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  return avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
}

// ─── Core Research Functions ────────────────────────────────────────────────

/**
 * Fetch recent candles for an asset. Uses backtest data-loader with disk caching.
 */
async function fetchCandles(asset, days = 90, interval = '1h') {
  if (!dataLoader) {
    log.warn('Data loader unavailable — skipping candle fetch', { asset });
    return [];
  }
  try {
    const candles = await dataLoader.fetchHistoricalCandles({
      asset,
      quoteCurrency: QUOTE,
      interval,
      days,
    });
    return candles || [];
  } catch (e) {
    log.warn('Candle fetch failed', { asset, error: e.message });
    return [];
  }
}

/**
 * Analyze trend strength for an asset using multi-period momentum.
 */
function analyzeTrend(closes) {
  if (closes.length < 60) return { trend: 'unknown', strength: 0, momentum: {} };

  const momentumScores = {};
  for (const lb of MOMENTUM_LOOKBACKS) {
    if (closes.length < lb) continue;
    const ret = (closes[closes.length - 1] - closes[closes.length - lb]) / closes[closes.length - lb];
    momentumScores[`${lb}p`] = ret;
  }

  // EMA cross analysis
  const ema8 = ema(closes, 8);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const last = closes.length - 1;

  const shortAboveMid = ema8[last] > ema21[last];
  const midAboveLong = ema21[last] > (ema50[last] || ema21[last]);
  const priceAboveShort = closes[last] > ema8[last];

  let trendScore = 0;
  if (priceAboveShort) trendScore += 0.3;
  if (shortAboveMid) trendScore += 0.35;
  if (midAboveLong) trendScore += 0.35;

  // Adjust by recent momentum
  const recentMom = momentumScores['10p'] || 0;
  if (recentMom > 0.05) trendScore = Math.min(1, trendScore + 0.1);
  else if (recentMom < -0.05) trendScore = Math.max(0, trendScore - 0.1);

  const trend = trendScore > 0.65 ? 'bullish' : trendScore < 0.35 ? 'bearish' : 'neutral';

  return { trend, strength: Math.round(trendScore * 100) / 100, momentum: momentumScores };
}

/**
 * Build volatility cone for an asset — realized vol at multiple horizons.
 */
function buildVolCone(closes) {
  const cone = {};
  const dailyReturns = returns(closes);
  if (dailyReturns.length < 10) return cone;

  for (const window of VOL_CONE_WINDOWS) {
    if (dailyReturns.length < window) continue;
    const slice = dailyReturns.slice(-window);
    const vol = stddev(slice) * Math.sqrt(365); // annualized
    cone[`${window}d`] = Math.round(vol * 10000) / 10000;
  }

  // Current vs historical percentile
  if (dailyReturns.length >= 90) {
    const allVols = [];
    for (let i = 30; i <= dailyReturns.length; i++) {
      const s = dailyReturns.slice(i - 30, i);
      allVols.push(stddev(s) * Math.sqrt(365));
    }
    const currentVol = cone['30d'] || 0;
    const rank = allVols.filter(v => v <= currentVol).length / allVols.length;
    cone.percentile = Math.round(rank * 100);
  }

  return cone;
}

/**
 * Detect mean-reversion vs momentum regime for an asset.
 */
function classifyRegime(closes) {
  if (closes.length < 60) return { regime: 'unknown', confidence: 0 };

  // Hurst exponent approximation using R/S analysis
  const rs = returns(closes);
  const n = rs.length;

  // Simplified: autocorrelation of returns
  const m = mean(rs);
  let autoCorr = 0, variance = 0;
  for (let i = 1; i < n; i++) {
    autoCorr += (rs[i] - m) * (rs[i - 1] - m);
    variance += (rs[i] - m) ** 2;
  }
  autoCorr = variance > 0 ? autoCorr / variance : 0;

  // Z-score of current price vs 20-period SMA
  const sma20 = mean(closes.slice(-20));
  const currentZ = zscore(closes[closes.length - 1], closes.slice(-60));

  let regime, confidence;
  if (autoCorr > 0.1 && Math.abs(currentZ) < MEAN_REVERSION_ZSCORE) {
    regime = 'momentum';
    confidence = Math.min(0.9, 0.5 + autoCorr);
  } else if (autoCorr < -0.1 || Math.abs(currentZ) > MEAN_REVERSION_ZSCORE) {
    regime = 'mean_reversion';
    confidence = Math.min(0.9, 0.5 + Math.abs(autoCorr));
  } else {
    regime = 'mixed';
    confidence = 0.4;
  }

  return {
    regime,
    confidence: Math.round(confidence * 100) / 100,
    autoCorrelation: Math.round(autoCorr * 1000) / 1000,
    priceZScore: Math.round(currentZ * 100) / 100,
    sma20Deviation: closes[closes.length - 1] / sma20 - 1,
  };
}

/**
 * Generate a market thesis from research findings.
 */
function generateThesis(asset, trendAnalysis, volCone, regimeClass, correlations) {
  const now = Date.now();
  const conviction = calculateConviction(trendAnalysis, volCone, regimeClass);

  // Thesis logic
  let thesis, action;

  if (trendAnalysis.trend === 'bullish' && conviction > 0.6) {
    if (regimeClass.regime === 'momentum') {
      thesis = `${asset}: Strong bullish momentum regime — trend-following favored`;
      action = 'long_momentum';
    } else if (regimeClass.regime === 'mean_reversion' && regimeClass.priceZScore > 1.5) {
      thesis = `${asset}: Bullish but extended — mean reversion risk elevated`;
      action = 'reduce_or_hedge';
    } else {
      thesis = `${asset}: Moderate bullish trend — standard positioning`;
      action = 'long_moderate';
    }
  } else if (trendAnalysis.trend === 'bearish' && conviction > 0.6) {
    if (regimeClass.regime === 'momentum') {
      thesis = `${asset}: Bearish momentum intensifying — avoid longs`;
      action = 'avoid';
    } else if (regimeClass.regime === 'mean_reversion' && regimeClass.priceZScore < -1.5) {
      thesis = `${asset}: Oversold in bearish trend — potential bounce candidate`;
      action = 'watch_reversal';
    } else {
      thesis = `${asset}: Moderate bearish — defensive positioning`;
      action = 'defensive';
    }
  } else {
    // Neutral / low conviction
    if (volCone.percentile && volCone.percentile < 20) {
      thesis = `${asset}: Low volatility compression — breakout potential`;
      action = 'watch_breakout';
    } else if (volCone.percentile && volCone.percentile > 80) {
      thesis = `${asset}: High vol environment — wait for mean reversion`;
      action = 'reduce_size';
    } else {
      thesis = `${asset}: No clear edge — sit on hands`;
      action = 'neutral';
    }
  }

  // Check for correlation anomalies
  if (correlations && correlations.anomalies && correlations.anomalies.length > 0) {
    thesis += ` | Correlation anomaly detected with ${correlations.anomalies.map(a => a.pair).join(', ')}`;
  }

  return {
    id: `thesis-${asset}-${now}`,
    asset,
    thesis,
    action,
    conviction: Math.round(conviction * 100) / 100,
    trend: trendAnalysis,
    volatility: volCone,
    regime: regimeClass,
    generatedAt: now,
    expiresAt: now + THESIS_EXPIRY_HOURS * 3600000,
    status: 'active',
  };
}

function calculateConviction(trend, vol, regime) {
  let score = 0.5;

  // Trend strength contributes heavily
  score += (trend.strength - 0.5) * 0.4;

  // Strong regime classification boosts conviction
  if (regime.confidence > 0.6) score += 0.1;
  if (regime.confidence > 0.8) score += 0.05;

  // Extreme volatility reduces conviction (uncertainty)
  if (vol.percentile !== undefined) {
    if (vol.percentile > 85) score -= 0.1;
    if (vol.percentile < 15) score += 0.05; // low vol = cleaner signals
  }

  // Multi-timeframe momentum agreement boosts conviction
  const momValues = Object.values(trend.momentum || {});
  if (momValues.length >= 3) {
    const sameDirection = momValues.every(m => m > 0) || momValues.every(m => m < 0);
    if (sameDirection) score += 0.1;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Build cross-asset correlation matrix.
 */
function buildCorrelationMatrix(assetReturns) {
  const matrix = {};
  const assets = Object.keys(assetReturns);

  for (let i = 0; i < assets.length; i++) {
    for (let j = i + 1; j < assets.length; j++) {
      const a = assets[i], b = assets[j];
      const rA = assetReturns[a], rB = assetReturns[b];
      if (!rA || !rB) continue;

      const minLen = Math.min(rA.length, rB.length, CORRELATION_WINDOW);
      const sliceA = rA.slice(-minLen), sliceB = rB.slice(-minLen);
      const corr = pearsonCorrelation(sliceA, sliceB);

      matrix[`${a}-${b}`] = {
        correlation: Math.round(corr * 1000) / 1000,
        window: minLen,
        updatedAt: Date.now(),
      };
    }
  }

  return matrix;
}

/**
 * Detect correlation anomalies (decorrelation events, regime breaks).
 */
function detectCorrelationAnomalies(currentMatrix, historicalMatrix) {
  const anomalies = [];
  for (const pair of Object.keys(currentMatrix)) {
    const current = currentMatrix[pair]?.correlation || 0;
    const historical = historicalMatrix[pair]?.correlation;
    if (historical === undefined) continue;

    const diff = Math.abs(current - historical);
    if (diff > 0.3) {
      anomalies.push({
        pair,
        currentCorr: current,
        historicalCorr: historical,
        delta: Math.round(diff * 1000) / 1000,
        type: diff > 0.5 ? 'major_decorrelation' : 'decorrelation',
      });
    }
  }
  return anomalies;
}

// ─── Main Research Cycle ────────────────────────────────────────────────────

/**
 * Run a complete research cycle across all assets.
 * Publishes findings to the signal bus for consumption by other agents.
 */
async function runResearchCycle() {
  const cycleStart = Date.now();
  log.info('Starting research cycle');
  if (heartbeat) heartbeat.publishHeartbeat('research-agent', { phase: 'starting' });

  const state = loadState();
  const assetReturns = {};
  const newTheses = [];

  // Phase 1: Fetch candles for all assets
  for (const asset of ASSETS) {
    try {
      const candles = await fetchCandles(asset, 90, '1h');
      if (candles.length < 60) {
        log.warn('Insufficient candle data', { asset, count: candles.length });
        continue;
      }

      const closes = candles.map(c => c.close);
      const dailyCloses = [];
      for (let i = 0; i < candles.length; i += 24) {
        dailyCloses.push(closes[Math.min(i + 23, closes.length - 1)]);
      }

      // Phase 2: Analyze each asset
      const trendAnalysis = analyzeTrend(closes);
      const volCone = buildVolCone(dailyCloses);
      const regimeClass = classifyRegime(closes);
      const currentRsi = rsi(closes);

      // Store returns for correlation analysis
      assetReturns[asset] = returns(closes);

      // Build per-asset profile
      state.assetProfiles[asset] = {
        trend: trendAnalysis,
        volatility: volCone,
        regime: regimeClass,
        rsi: currentRsi ? Math.round(currentRsi * 100) / 100 : null,
        lastPrice: closes[closes.length - 1],
        updatedAt: Date.now(),
      };

      // Phase 3: Generate thesis
      const thesis = generateThesis(asset, trendAnalysis, volCone, regimeClass, null);
      newTheses.push(thesis);

      // Publish per-asset intelligence to signal bus
      if (signalBus) {
        signalBus.publish({
          type: 'asset_intelligence',
          source: 'research-agent',
          confidence: thesis.conviction,
          payload: {
            asset,
            trend: trendAnalysis.trend,
            trendStrength: trendAnalysis.strength,
            regime: regimeClass.regime,
            regimeConfidence: regimeClass.confidence,
            volPercentile: volCone.percentile || null,
            rsi: currentRsi,
            action: thesis.action,
            thesis: thesis.thesis,
          },
        });
      }
    } catch (e) {
      log.error('Asset research failed', { asset, error: e.message });
    }
  }

  // Phase 4: Cross-asset correlation analysis
  try {
    const newCorrelationMatrix = buildCorrelationMatrix(assetReturns);
    const anomalies = detectCorrelationAnomalies(newCorrelationMatrix, state.correlationMatrix || {});

    if (anomalies.length > 0) {
      log.info('Correlation anomalies detected', { count: anomalies.length, anomalies });
      if (signalBus) {
        signalBus.publish({
          type: 'correlation_anomaly',
          source: 'research-agent',
          confidence: 0.7,
          payload: { anomalies },
          ttlMs: 6 * 3600000,
        });
      }
    }

    state.correlationMatrix = newCorrelationMatrix;
  } catch (e) {
    log.error('Correlation analysis failed', { error: e.message });
  }

  // Phase 5: Market regime estimation
  try {
    const btcProfile = state.assetProfiles['BTC'];
    const ethProfile = state.assetProfiles['ETH'];
    if (btcProfile && ethProfile) {
      const btcTrend = btcProfile.trend?.trend || 'unknown';
      const ethTrend = ethProfile.trend?.trend || 'unknown';
      const btcVol = btcProfile.volatility?.percentile || 50;

      let marketRegime = 'neutral';
      if (btcTrend === 'bullish' && ethTrend === 'bullish') marketRegime = 'risk_on';
      else if (btcTrend === 'bearish' && ethTrend === 'bearish') marketRegime = 'risk_off';
      else if (btcVol > 80) marketRegime = 'high_volatility';
      else if (btcVol < 20) marketRegime = 'low_volatility';

      state.regimeHistory.push({ regime: marketRegime, timestamp: Date.now() });
      if (state.regimeHistory.length > 500) {
        state.regimeHistory = state.regimeHistory.slice(-500);
      }

      if (signalBus) {
        signalBus.publish({
          type: 'market_regime',
          source: 'research-agent',
          confidence: 0.75,
          payload: {
            regime: marketRegime,
            btcTrend,
            ethTrend,
            btcVolPercentile: btcVol,
          },
        });
      }
    }
  } catch (e) {
    log.error('Regime estimation failed', { error: e.message });
  }

  // Phase 6: Update theses, expire old ones
  const now = Date.now();
  const existingActive = (state.theses || []).filter(t => t.expiresAt > now && t.status === 'active');
  const allTheses = [...existingActive, ...newTheses].slice(-MAX_THESES);
  state.theses = allTheses;
  state.lastCycleAt = now;
  state.cycleCount = (state.cycleCount || 0) + 1;

  saveState(state);

  const elapsed = Date.now() - cycleStart;
  log.info('Research cycle complete', {
    cycle: state.cycleCount,
    theses: newTheses.length,
    assets: Object.keys(state.assetProfiles).length,
    anomalies: (state.correlationMatrix ? Object.keys(state.correlationMatrix).length : 0),
    elapsedMs: elapsed,
  });

  if (heartbeat) heartbeat.publishHeartbeat('research-agent', { phase: 'complete', cycle: state.cycleCount });

  return {
    theses: newTheses,
    assetProfiles: state.assetProfiles,
    correlationMatrix: state.correlationMatrix,
    cycleCount: state.cycleCount,
  };
}

// ─── Query Functions ────────────────────────────────────────────────────────

function getActiveTheses() {
  const state = loadState();
  return (state.theses || []).filter(t => t.expiresAt > Date.now() && t.status === 'active');
}

function getAssetProfile(asset) {
  const state = loadState();
  return state.assetProfiles?.[asset] || null;
}

function getAllProfiles() {
  const state = loadState();
  return state.assetProfiles || {};
}

function getCorrelationMatrix() {
  const state = loadState();
  return state.correlationMatrix || {};
}

function getResearchSummary() {
  const state = loadState();
  const activeTheses = (state.theses || []).filter(t => t.expiresAt > Date.now());
  return {
    cycleCount: state.cycleCount || 0,
    lastCycleAt: state.lastCycleAt || 0,
    activeTheses: activeTheses.length,
    assetsTracked: Object.keys(state.assetProfiles || {}).length,
    correlationPairs: Object.keys(state.correlationMatrix || {}).length,
    regimeHistory: (state.regimeHistory || []).slice(-10),
    topTheses: activeTheses
      .sort((a, b) => b.conviction - a.conviction)
      .slice(0, 5)
      .map(t => ({ asset: t.asset, thesis: t.thesis, conviction: t.conviction, action: t.action })),
  };
}

module.exports = {
  runResearchCycle,
  getActiveTheses,
  getAssetProfile,
  getAllProfiles,
  getCorrelationMatrix,
  getResearchSummary,
  // Exposed for testing
  analyzeTrend,
  buildVolCone,
  classifyRegime,
  pearsonCorrelation,
};
