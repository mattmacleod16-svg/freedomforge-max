/**
 * Correlation Monitor -- Real-time cross-asset correlation tracking
 * and portfolio diversification surveillance for FreedomForge.
 * =====================================================================
 *
 * Tracks rolling correlations between all actively traded assets and
 * fires alerts when diversification breaks down (correlation spikes,
 * herd risk, concentration risk).
 *
 * Provides:
 *   1. updateCorrelations()     - Refresh rolling correlation matrix
 *   2. getCorrelationAlert()    - Check for dangerous correlation patterns
 *   3. getDiversificationScore()- 0-100 portfolio diversification score
 *   4. getCorrelationMatrix()   - Full state including alerts & score
 *
 * State persisted to data/correlation-state.json via resilient-io.
 *
 * Usage:
 *   const corrMon = require('./correlation-monitor');
 *   corrMon.updateCorrelations();
 *   const alerts = corrMon.getCorrelationAlert();
 *   const score  = corrMon.getDiversificationScore();
 *   const full   = corrMon.getCorrelationMatrix();
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ── Resilient I/O ────────────────────────────────────────────────────────────

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

// ── Logger ───────────────────────────────────────────────────────────────────

let log;
try {
  const { createLogger } = require('./logger');
  log = createLogger('correlation-monitor');
} catch {
  log = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
  };
}

// ── Configuration ────────────────────────────────────────────────────────────

const CORR_STATE_FILE = path.resolve(
  process.cwd(),
  process.env.CORRELATION_STATE_FILE || 'data/correlation-state.json'
);

const ROLLING_WINDOW_DAYS = Math.max(7, Math.min(90, parseInt(process.env.CORR_ROLLING_DAYS || '30', 10)));
const HIGH_CORR_THRESHOLD = Math.max(0.5, Math.min(0.99, Number(process.env.CORR_HIGH_THRESHOLD || 0.8)));
const HERD_RISK_THRESHOLD = Math.max(0.3, Math.min(0.9, Number(process.env.CORR_HERD_THRESHOLD || 0.6)));
const SPIKE_THRESHOLD = Math.max(0.05, Math.min(0.5, Number(process.env.CORR_SPIKE_THRESHOLD || 0.2)));
const SPIKE_LOOKBACK_DAYS = 7;

// ── State Persistence ────────────────────────────────────────────────────────

function loadState() {
  if (rio) return rio.readJsonSafe(CORR_STATE_FILE, { fallback: null });
  try {
    if (!fs.existsSync(CORR_STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CORR_STATE_FILE, 'utf8'));
  } catch { return null; }
}

function saveState(state) {
  if (rio) { rio.writeJsonAtomic(CORR_STATE_FILE, state); return; }
  fs.mkdirSync(path.dirname(CORR_STATE_FILE), { recursive: true });
  const tmp = CORR_STATE_FILE + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, CORR_STATE_FILE);
}

/**
 * Get the default empty state structure.
 */
function emptyState() {
  return {
    matrix: {},
    assets: [],
    diversificationScore: 100,
    alerts: [],
    history: [],          // rolling snapshots for spike detection
    updatedAt: null,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Update Correlations
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Refresh the correlation matrix using recent price data.
 *
 * Data sources (in priority order):
 *   A) Edge detector's getCandles() for live exchange price data
 *   B) Trade journal for assets with recent trade activity
 *
 * Computes rolling ROLLING_WINDOW_DAYS correlations between all pairs
 * of actively traded assets and persists the result.
 */
function updateCorrelations() {
  try {
    const priceHistory = gatherPriceHistory();

    if (!priceHistory || Object.keys(priceHistory).length < 2) {
      log.debug('Not enough assets for correlation computation', {
        assetCount: priceHistory ? Object.keys(priceHistory).length : 0,
      });
      return;
    }

    // Build the correlation matrix using var-engine's utility
    let varEngine;
    try { varEngine = require('./var-engine'); } catch { varEngine = null; }

    let matrix = {};
    let assets = Object.keys(priceHistory);

    if (varEngine && typeof varEngine.buildCorrelationMatrix === 'function') {
      const result = varEngine.buildCorrelationMatrix(priceHistory);
      matrix = result.matrix;
      assets = result.assets;
    } else {
      // Inline fallback: build correlations without var-engine
      const returnSeries = {};
      for (const asset of assets) {
        returnSeries[asset] = pricesToReturns(priceHistory[asset]);
      }
      for (let i = 0; i < assets.length; i++) {
        for (let j = i + 1; j < assets.length; j++) {
          const corr = pearsonCorrelation(returnSeries[assets[i]], returnSeries[assets[j]]);
          matrix[`${assets[i]}-${assets[j]}`] = round4(corr);
        }
      }
    }

    // Load existing state for history tracking
    const state = loadState() || emptyState();
    const previousMatrix = state.matrix || {};

    // Detect correlation spikes by comparing to the previous snapshot
    const spikes = detectSpikes(previousMatrix, matrix);

    // Archive current snapshot for future spike detection
    const snapshot = {
      ts: Date.now(),
      matrix: { ...matrix },
    };
    state.history = state.history || [];
    state.history.push(snapshot);

    // Keep only the last 30 snapshots to prevent unbounded growth
    const MAX_HISTORY_SNAPSHOTS = 30;
    if (state.history.length > MAX_HISTORY_SNAPSHOTS) {
      state.history = state.history.slice(-MAX_HISTORY_SNAPSHOTS);
    }

    // Update state
    state.matrix = matrix;
    state.assets = assets;
    state.diversificationScore = computeDiversificationScore(matrix);
    state.alerts = buildAlerts(matrix, assets, spikes);
    state.updatedAt = new Date().toISOString();

    saveState(state);

    log.info('Correlations updated', {
      assets: assets.length,
      pairs: Object.keys(matrix).length,
      diversificationScore: state.diversificationScore,
      alertCount: state.alerts.length,
    });

    // Publish alerts to signal bus if any are high severity
    publishAlertsToSignalBus(state.alerts);

  } catch (err) {
    log.error('Failed to update correlations', { error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. Correlation Alerts
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Returns warnings about dangerous correlation patterns.
 *
 * Alert types:
 *   - high_concentration: Two held positions with correlation > 0.8
 *   - herd_risk: Portfolio average correlation > 0.6
 *   - correlation_spike: Correlation increased >0.2 in 7 days
 *
 * @returns {Array<{type: string, severity: string, message: string, data: object}>}
 */
function getCorrelationAlert() {
  const state = loadState();
  if (!state || !state.alerts) return [];
  return state.alerts;
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. Diversification Score
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Returns a 0-100 diversification score.
 *   100 = perfectly diversified (all correlations near 0)
 *   0   = all assets perfectly correlated
 *
 * Formula: 100 * (1 - avgAbsCorrelation)
 *
 * @returns {number} Score between 0 and 100
 */
function getDiversificationScore() {
  const state = loadState();
  if (!state || !state.matrix || Object.keys(state.matrix).length === 0) {
    return 100; // No correlations tracked yet = assumed diversified
  }
  return state.diversificationScore;
}

/**
 * Internal: compute the diversification score from a correlation matrix.
 * @param {{ [key: string]: number }} matrix
 * @returns {number}
 */
function computeDiversificationScore(matrix) {
  const values = Object.values(matrix).filter(v => Number.isFinite(v));
  if (values.length === 0) return 100;

  const avgAbsCorrelation = values.reduce((sum, v) => sum + Math.abs(v), 0) / values.length;
  return Math.round(Math.max(0, Math.min(100, 100 * (1 - avgAbsCorrelation))));
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. Get Full Correlation Matrix State
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Returns the complete correlation state.
 *
 * @returns {{
 *   matrix: object,
 *   assets: string[],
 *   diversificationScore: number,
 *   alerts: Array,
 *   updatedAt: string|null
 * }}
 */
function getCorrelationMatrix() {
  const state = loadState() || emptyState();
  return {
    matrix: state.matrix || {},
    assets: state.assets || [],
    diversificationScore: state.diversificationScore != null ? state.diversificationScore : 100,
    alerts: state.alerts || [],
    updatedAt: state.updatedAt || null,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Internal: Data Gathering
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Gather price history from available data sources.
 * Returns { ASSET: [prices...], ... } keyed by asset symbol.
 */
function gatherPriceHistory() {
  const priceHistory = {};

  // Source A: Trade journal -- extract entry/exit prices per asset
  try {
    const journalFile = path.resolve(
      process.cwd(),
      process.env.TRADE_JOURNAL_FILE || 'data/trade-journal.json'
    );

    let raw;
    if (rio) {
      raw = rio.readJsonSafe(journalFile, { fallback: null });
    } else {
      try {
        if (fs.existsSync(journalFile)) {
          raw = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
        }
      } catch { raw = null; }
    }

    if (raw && Array.isArray(raw.trades)) {
      const cutoff = Date.now() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      const recentTrades = raw.trades.filter(t => (t.entryTs || 0) >= cutoff);

      for (const trade of recentTrades) {
        const asset = trade.asset || 'BTC';
        if (!priceHistory[asset]) priceHistory[asset] = [];

        if (Number.isFinite(trade.entryPrice) && trade.entryPrice > 0) {
          priceHistory[asset].push({
            price: trade.entryPrice,
            ts: trade.entryTs || 0,
          });
        }
        if (Number.isFinite(trade.exitPrice) && trade.exitPrice > 0) {
          priceHistory[asset].push({
            price: trade.exitPrice,
            ts: trade.entryTs ? trade.entryTs + 1 : 1,
          });
        }
      }
    }
  } catch (err) {
    log.debug('Trade journal price extraction failed', { error: err.message });
  }

  // Source B: Signal bus -- look for price/candle signals
  try {
    const bus = require('./agent-signal-bus');
    const priceSignals = bus.query({
      type: 'price_update',
      maxAgeMs: ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    });

    for (const sig of priceSignals) {
      const asset = sig.payload?.asset;
      const price = sig.payload?.price;
      if (asset && Number.isFinite(price) && price > 0) {
        if (!priceHistory[asset]) priceHistory[asset] = [];
        priceHistory[asset].push({
          price,
          ts: sig.publishedAt || 0,
        });
      }
    }
  } catch {
    // Signal bus unavailable -- continue with journal data only
  }

  // Source C: Venue state files for recent price snapshots
  try {
    const dataDir = path.resolve(process.cwd(), 'data');
    const venueFiles = [
      'coinbase-spot-state.json',
      'kraken-spot-state.json',
    ];

    for (const vf of venueFiles) {
      const venuePath = path.join(dataDir, vf);
      let venueData;
      if (rio) {
        venueData = rio.readJsonSafe(venuePath, { fallback: null });
      } else {
        try {
          if (fs.existsSync(venuePath)) {
            venueData = JSON.parse(fs.readFileSync(venuePath, 'utf8'));
          }
        } catch { venueData = null; }
      }

      if (venueData && typeof venueData === 'object') {
        // Extract price data from venue state (structure varies per venue engine)
        const prices = venueData.recentPrices || venueData.prices || {};
        for (const [asset, priceData] of Object.entries(prices)) {
          if (!priceHistory[asset]) priceHistory[asset] = [];
          if (Array.isArray(priceData)) {
            for (const p of priceData) {
              const price = typeof p === 'number' ? p : p?.price;
              const ts = typeof p === 'object' ? (p?.ts || 0) : 0;
              if (Number.isFinite(price) && price > 0) {
                priceHistory[asset].push({ price, ts });
              }
            }
          } else if (Number.isFinite(priceData) && priceData > 0) {
            priceHistory[asset].push({ price: priceData, ts: Date.now() });
          }
        }
      }
    }
  } catch (err) {
    log.debug('Venue state price extraction failed', { error: err.message });
  }

  // Sort all series by timestamp and extract just the prices
  const result = {};
  for (const [asset, entries] of Object.entries(priceHistory)) {
    if (entries.length < 3) continue;
    if (entries.length > 10000) {
      entries.splice(0, entries.length - 10000);
    }
    entries.sort((a, b) => a.ts - b.ts);
    result[asset] = entries.map(e => e.price);
  }

  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// Internal: Alert Building
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Build alerts from the current correlation matrix.
 *
 * @param {{ [key: string]: number }} matrix
 * @param {string[]} assets
 * @param {Array} spikes - Detected correlation spikes
 * @returns {Array<{type: string, severity: string, message: string, data: object}>}
 */
function buildAlerts(matrix, assets, spikes) {
  const alerts = [];

  // Check for held positions with high correlation
  // Load current portfolio positions from risk-manager
  let heldAssets = new Set(assets);
  try {
    const riskManager = require('./risk-manager');
    const exposure = riskManager.getPortfolioExposure();
    if (exposure.assetExposure && Object.keys(exposure.assetExposure).length > 0) {
      heldAssets = new Set(Object.keys(exposure.assetExposure));
    }
  } catch {
    // Risk manager unavailable -- check all tracked assets
  }

  // Alert 1: High concentration risk (two held positions with correlation > threshold)
  for (const [pair, corr] of Object.entries(matrix)) {
    if (Math.abs(corr) <= HIGH_CORR_THRESHOLD) continue;
    const [a, b] = pair.split('-');
    if (heldAssets.has(a) && heldAssets.has(b)) {
      alerts.push({
        type: 'high_concentration',
        severity: Math.abs(corr) > 0.9 ? 'critical' : 'warning',
        message: `${a} and ${b} are highly correlated (${corr.toFixed(2)}) -- concentrated risk`,
        data: { assetA: a, assetB: b, correlation: corr },
      });
    }
  }

  // Alert 2: Portfolio herd risk (average correlation too high)
  const corrValues = Object.values(matrix).filter(v => Number.isFinite(v));
  if (corrValues.length > 0) {
    const avgCorr = corrValues.reduce((s, v) => s + v, 0) / corrValues.length;
    if (avgCorr > HERD_RISK_THRESHOLD) {
      alerts.push({
        type: 'herd_risk',
        severity: avgCorr > 0.8 ? 'critical' : 'warning',
        message: `Portfolio average correlation ${avgCorr.toFixed(2)} exceeds herd risk threshold ${HERD_RISK_THRESHOLD} -- assets moving in sync`,
        data: { averageCorrelation: round4(avgCorr), threshold: HERD_RISK_THRESHOLD },
      });
    }
  }

  // Alert 3: Correlation spikes
  for (const spike of spikes) {
    alerts.push({
      type: 'correlation_spike',
      severity: spike.delta > 0.3 ? 'critical' : 'warning',
      message: `${spike.pair} correlation spiked by ${spike.delta.toFixed(2)} (${spike.oldCorr.toFixed(2)} -> ${spike.newCorr.toFixed(2)}) -- diversification breakdown`,
      data: {
        pair: spike.pair,
        previousCorrelation: spike.oldCorr,
        currentCorrelation: spike.newCorr,
        delta: spike.delta,
      },
    });
  }

  return alerts;
}

/**
 * Detect pairs where correlation increased by more than SPIKE_THRESHOLD.
 * Compares current matrix against the history snapshot from ~7 days ago.
 */
function detectSpikes(previousMatrix, currentMatrix) {
  const spikes = [];
  if (!previousMatrix || !currentMatrix) return spikes;

  // Compare against the previous snapshot
  // In production, we'd compare against the snapshot from SPIKE_LOOKBACK_DAYS ago
  // from the history array, but for immediate detection we compare to the last known state
  const state = loadState();
  let oldMatrix = previousMatrix;

  if (state && Array.isArray(state.history) && state.history.length > 0) {
    // Find the snapshot closest to SPIKE_LOOKBACK_DAYS ago
    const targetTs = Date.now() - SPIKE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    let bestSnapshot = state.history[0];
    let bestDelta = Math.abs((bestSnapshot.ts || 0) - targetTs);

    for (const snap of state.history) {
      const delta = Math.abs((snap.ts || 0) - targetTs);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestSnapshot = snap;
      }
    }

    if (bestSnapshot.matrix) {
      oldMatrix = bestSnapshot.matrix;
    }
  }

  for (const [pair, newCorr] of Object.entries(currentMatrix)) {
    if (!Number.isFinite(newCorr)) continue;
    const oldCorr = oldMatrix[pair];
    if (oldCorr === undefined || !Number.isFinite(oldCorr)) continue;

    const delta = newCorr - oldCorr;
    if (delta > SPIKE_THRESHOLD) {
      spikes.push({
        pair,
        oldCorr: round4(oldCorr),
        newCorr: round4(newCorr),
        delta: round4(delta),
      });
    }
  }

  return spikes;
}

/**
 * Publish high-severity alerts to the signal bus.
 */
function publishAlertsToSignalBus(alerts) {
  if (!alerts || alerts.length === 0) return;

  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  if (criticalAlerts.length === 0) return;

  try {
    const bus = require('./agent-signal-bus');
    bus.publish({
      type: 'risk_alert',
      source: 'correlation-monitor',
      confidence: 0.9,
      payload: {
        event: 'correlation_alert',
        alertCount: criticalAlerts.length,
        alerts: criticalAlerts.map(a => ({
          type: a.type,
          message: a.message,
        })),
      },
      ttlMs: 4 * 60 * 60 * 1000, // 4 hours
    });
  } catch (err) {
    log.debug('Signal bus publish failed', { error: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Internal: Math Utilities (standalone fallbacks when var-engine unavailable)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Convert price series to percentage returns.
 * @param {number[]} prices
 * @returns {number[]}
 */
function pricesToReturns(prices) {
  if (!Array.isArray(prices) || prices.length < 2) return [];
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0 && Number.isFinite(prices[i]) && Number.isFinite(prices[i - 1])) {
      returns.push(((prices[i] - prices[i - 1]) / prices[i - 1]) * 100);
    }
  }
  return returns;
}

/**
 * Pearson correlation coefficient between two series.
 * @param {number[]} x
 * @param {number[]} y
 * @returns {number} -1 to 1
 */
function pearsonCorrelation(x, y) {
  if (!Array.isArray(x) || !Array.isArray(y)) return 0;
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;

  const xSlice = x.slice(-n);
  const ySlice = y.slice(-n);

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += xSlice[i];
    sumY += ySlice[i];
    sumXY += xSlice[i] * ySlice[i];
    sumX2 += xSlice[i] * xSlice[i];
    sumY2 += ySlice[i] * ySlice[i];
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
  );

  if (denominator === 0) return 0;
  return Math.max(-1, Math.min(1, numerator / denominator));
}

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

// ══════════════════════════════════════════════════════════════════════════════
// Exports
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
  updateCorrelations,
  getCorrelationAlert,
  getDiversificationScore,
  getCorrelationMatrix,
};
