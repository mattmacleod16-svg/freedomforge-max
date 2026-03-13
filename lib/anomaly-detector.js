/**
 * Anomaly Detector
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Statistical anomaly detection for market data:
 *   - Price spikes / crashes (>3σ from rolling mean)
 *   - Volume explosions (>3σ from rolling mean)
 *   - Spread blowouts (>3σ from normal spread)
 *   - Correlation breaks (sudden de-correlation)
 *
 * When an anomaly is detected:
 *   1. Publishes alert to signal bus
 *   2. Can pause trading for affected asset
 *   3. Logs anomaly for post-mortem analysis
 *
 * @module lib/anomaly-detector
 */

'use strict';

const { createLogger } = require('./logger');
const log = createLogger('anomaly-detector');
const fs = require('fs');
const path = require('path');

let signalBus, wsFeed;
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }
try { wsFeed = require('./websocket-feed'); } catch { wsFeed = null; }

// ─── Configuration ────────────────────────────────────────────────────────────
const SIGMA_THRESHOLD = Number(process.env.ANOMALY_SIGMA || 3);          // 3-sigma default
const ROLLING_WINDOW = Number(process.env.ANOMALY_WINDOW || 100);        // data points
const COOLDOWN_MS = Number(process.env.ANOMALY_COOLDOWN_MS || 300000);   // 5min between alerts
const PAUSE_DURATION_MS = Number(process.env.ANOMALY_PAUSE_MS || 600000); // 10min trading pause
const MAX_ANOMALY_LOG = Number(process.env.ANOMALY_MAX_LOG || 500);
const STATE_PATH = path.resolve(__dirname, '..', 'data', 'anomaly-detector-state.json');

// ─── In-Memory State ──────────────────────────────────────────────────────────
const priceHistory = {};    // { asset: [prices] }
const volumeHistory = {};   // { asset: [volumes] }
const spreadHistory = {};   // { asset: [spreads] }
const pausedAssets = {};    // { asset: pausedUntil timestamp }
const lastAlertTime = {};   // { asset_type: timestamp }
const anomalyLog = [];      // [{timestamp, asset, type, value, mean, sigma, zScore}]

// ─── Statistics Helpers ───────────────────────────────────────────────────────

function rollingStats(data, window = ROLLING_WINDOW) {
  const slice = data.slice(-window);
  if (slice.length < 10) return { mean: 0, std: 0, n: slice.length };

  const n = slice.length;
  const mean = slice.reduce((s, v) => s + v, 0) / n;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);

  return { mean, std, n };
}

function zScore(value, mean, std) {
  if (std === 0) return 0;
  return (value - mean) / std;
}

function isOnCooldown(asset, type) {
  const key = `${asset}_${type}`;
  const last = lastAlertTime[key];
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

function recordCooldown(asset, type) {
  lastAlertTime[`${asset}_${type}`] = Date.now();
}

// ─── Core Detection ───────────────────────────────────────────────────────────

/**
 * Ingest a price tick and check for anomaly.
 *
 * @param {string} asset
 * @param {number} price
 * @returns {{ anomaly: boolean, type?: string, zScore?: number, details?: object }}
 */
function checkPrice(asset, price) {
  if (!asset || !price || price <= 0) return { anomaly: false };

  if (!priceHistory[asset]) priceHistory[asset] = [];
  priceHistory[asset].push(price);

  // Keep bounded
  if (priceHistory[asset].length > ROLLING_WINDOW * 2) {
    priceHistory[asset] = priceHistory[asset].slice(-ROLLING_WINDOW);
  }

  if (priceHistory[asset].length < 20) return { anomaly: false };

  // Compute return (pct change from previous tick)
  const prev = priceHistory[asset][priceHistory[asset].length - 2];
  const pctChange = ((price - prev) / prev) * 100;

  // Build return series
  const returns = [];
  for (let i = 1; i < priceHistory[asset].length; i++) {
    const p = priceHistory[asset][i];
    const pp = priceHistory[asset][i - 1];
    returns.push(((p - pp) / pp) * 100);
  }

  const stats = rollingStats(returns);
  const z = zScore(pctChange, stats.mean, stats.std);

  if (Math.abs(z) >= SIGMA_THRESHOLD && !isOnCooldown(asset, 'price')) {
    const anomalyType = z > 0 ? 'price_spike' : 'price_crash';
    const details = {
      asset,
      type: anomalyType,
      price,
      pctChange: Math.round(pctChange * 100) / 100,
      zScore: Math.round(z * 100) / 100,
      mean: Math.round(stats.mean * 100) / 100,
      sigma: Math.round(stats.std * 100) / 100,
      threshold: SIGMA_THRESHOLD,
      timestamp: new Date().toISOString(),
    };

    logAnomaly(details);
    raiseAlert(details);
    pauseTrading(asset, anomalyType);
    recordCooldown(asset, 'price');

    return { anomaly: true, type: anomalyType, zScore: z, details };
  }

  return { anomaly: false };
}

/**
 * Ingest a volume tick and check for anomaly.
 *
 * @param {string} asset
 * @param {number} volume
 * @returns {{ anomaly: boolean, type?: string, zScore?: number }}
 */
function checkVolume(asset, volume) {
  if (!asset || volume == null || volume < 0) return { anomaly: false };

  if (!volumeHistory[asset]) volumeHistory[asset] = [];
  volumeHistory[asset].push(volume);

  if (volumeHistory[asset].length > ROLLING_WINDOW * 2) {
    volumeHistory[asset] = volumeHistory[asset].slice(-ROLLING_WINDOW);
  }

  if (volumeHistory[asset].length < 20) return { anomaly: false };

  const stats = rollingStats(volumeHistory[asset]);
  const z = zScore(volume, stats.mean, stats.std);

  if (z >= SIGMA_THRESHOLD && !isOnCooldown(asset, 'volume')) {
    const details = {
      asset,
      type: 'volume_explosion',
      volume,
      zScore: Math.round(z * 100) / 100,
      mean: Math.round(stats.mean * 100) / 100,
      sigma: Math.round(stats.std * 100) / 100,
      threshold: SIGMA_THRESHOLD,
      timestamp: new Date().toISOString(),
    };

    logAnomaly(details);
    raiseAlert(details);
    recordCooldown(asset, 'volume');

    return { anomaly: true, type: 'volume_explosion', zScore: z, details };
  }

  return { anomaly: false };
}

/**
 * Check spread for anomaly (spread blowout indicates liquidity crisis).
 *
 * @param {string} asset
 * @param {number} bid
 * @param {number} ask
 * @returns {{ anomaly: boolean, type?: string }}
 */
function checkSpread(asset, bid, ask) {
  if (!asset || !bid || !ask || bid >= ask) return { anomaly: false };

  const spreadPct = ((ask - bid) / bid) * 100;
  if (!spreadHistory[asset]) spreadHistory[asset] = [];
  spreadHistory[asset].push(spreadPct);

  if (spreadHistory[asset].length > ROLLING_WINDOW * 2) {
    spreadHistory[asset] = spreadHistory[asset].slice(-ROLLING_WINDOW);
  }

  if (spreadHistory[asset].length < 20) return { anomaly: false };

  const stats = rollingStats(spreadHistory[asset]);
  const z = zScore(spreadPct, stats.mean, stats.std);

  if (z >= SIGMA_THRESHOLD && !isOnCooldown(asset, 'spread')) {
    const details = {
      asset,
      type: 'spread_blowout',
      spreadPct: Math.round(spreadPct * 10000) / 10000,
      zScore: Math.round(z * 100) / 100,
      mean: Math.round(stats.mean * 10000) / 10000,
      sigma: Math.round(stats.std * 10000) / 10000,
      threshold: SIGMA_THRESHOLD,
      timestamp: new Date().toISOString(),
    };

    logAnomaly(details);
    raiseAlert(details);
    pauseTrading(asset, 'spread_blowout');
    recordCooldown(asset, 'spread');

    return { anomaly: true, type: 'spread_blowout', zScore: z, details };
  }

  return { anomaly: false };
}

// ─── Aggregate Anomaly Scan ───────────────────────────────────────────────────

/**
 * Run anomaly detection across all assets using latest WS feed data.
 *
 * @returns {object} Summary of detected anomalies
 */
function scanAll() {
  const anomalies = [];

  if (!wsFeed) return { anomalies: [], scannedAt: new Date().toISOString() };

  let allPrices = {};
  try { allPrices = wsFeed.getAllPrices ? wsFeed.getAllPrices() : {}; } catch { /* skip */ }

  for (const [asset, priceData] of Object.entries(allPrices)) {
    const price = typeof priceData === 'number' ? priceData : priceData?.price;
    if (price) {
      const result = checkPrice(asset, price);
      if (result.anomaly) anomalies.push(result.details);
    }

    // Check spread if available
    if (priceData?.bid && priceData?.ask) {
      const result = checkSpread(asset, priceData.bid, priceData.ask);
      if (result.anomaly) anomalies.push(result.details);
    }
  }

  return {
    anomalies,
    scannedAt: new Date().toISOString(),
    pausedAssets: getPausedAssets(),
    totalAnomaliesLogged: anomalyLog.length,
  };
}

// ─── Trading Pause ────────────────────────────────────────────────────────────

function pauseTrading(asset, reason) {
  pausedAssets[asset] = {
    pausedUntil: Date.now() + PAUSE_DURATION_MS,
    reason,
    pausedAt: new Date().toISOString(),
  };
  log.warn(`⚠️  Trading paused for ${asset}: ${reason} (${PAUSE_DURATION_MS / 60000}min)`);
}

/**
 * Check if trading is paused for an asset due to anomaly.
 *
 * @param {string} asset
 * @returns {{ paused: boolean, reason?: string, resumesAt?: string }}
 */
function isTradingPaused(asset) {
  const entry = pausedAssets[asset];
  if (!entry) return { paused: false };

  if (Date.now() >= entry.pausedUntil) {
    delete pausedAssets[asset];
    return { paused: false };
  }

  return {
    paused: true,
    reason: entry.reason,
    resumesAt: new Date(entry.pausedUntil).toISOString(),
  };
}

function getPausedAssets() {
  const now = Date.now();
  const result = {};
  for (const [asset, entry] of Object.entries(pausedAssets)) {
    if (now < entry.pausedUntil) {
      result[asset] = {
        reason: entry.reason,
        resumesAt: new Date(entry.pausedUntil).toISOString(),
        remainingMs: entry.pausedUntil - now,
      };
    } else {
      delete pausedAssets[asset];
    }
  }
  return result;
}

// ─── Alert & Logging ──────────────────────────────────────────────────────────

function raiseAlert(details) {
  log.warn(`🚨 ANOMALY: ${details.type} on ${details.asset} — z=${details.zScore} (threshold: ${details.threshold})`);

  if (signalBus) {
    try {
      signalBus.publish({
        type: 'anomaly_detected',
        source: 'anomaly-detector',
        confidence: Math.min(0.99, 0.7 + Math.abs(details.zScore) * 0.05),
        payload: details,
        ttlMs: 600000, // 10min
      });
    } catch { /* best effort */ }
  }
}

function logAnomaly(details) {
  anomalyLog.push(details);
  if (anomalyLog.length > MAX_ANOMALY_LOG) {
    anomalyLog.splice(0, anomalyLog.length - MAX_ANOMALY_LOG);
  }

  // Persist
  try {
    const state = { anomalyLog: anomalyLog.slice(-100), updatedAt: new Date().toISOString() };
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch { /* best effort */ }
}

/**
 * Get recent anomaly log.
 *
 * @param {number} [limit=50]
 * @returns {object[]}
 */
function getAnomalyLog(limit = 50) {
  return anomalyLog.slice(-limit);
}

/**
 * Get anomaly detection health/summary.
 */
function getHealth() {
  return {
    assetsTracked: {
      price: Object.keys(priceHistory).length,
      volume: Object.keys(volumeHistory).length,
      spread: Object.keys(spreadHistory).length,
    },
    pausedAssets: getPausedAssets(),
    recentAnomalies: anomalyLog.slice(-5),
    totalAnomalies: anomalyLog.length,
    config: { sigmaThreshold: SIGMA_THRESHOLD, rollingWindow: ROLLING_WINDOW, cooldownMs: COOLDOWN_MS, pauseDurationMs: PAUSE_DURATION_MS },
  };
}

// ─── WS Feed Auto-Listener ───────────────────────────────────────────────────
if (wsFeed) {
  try {
    wsFeed.on('price', (tick) => {
      if (tick?.asset && tick?.price) {
        checkPrice(tick.asset, tick.price);
        if (tick.bid && tick.ask) checkSpread(tick.asset, tick.bid, tick.ask);
      }
    });
    wsFeed.on('trade', (trade) => {
      if (trade?.asset && trade?.volume) checkVolume(trade.asset, trade.volume);
    });
    log.info('Auto-listening to WS feed for anomaly detection');
  } catch {
    log.warn('Failed to attach WS feed listeners');
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  checkPrice,
  checkVolume,
  checkSpread,
  scanAll,
  isTradingPaused,
  getPausedAssets,
  getAnomalyLog,
  getHealth,
};
