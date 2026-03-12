/**
 * Portfolio Hedging Engine
 * ═══════════════════════
 *
 * Computes and recommends hedge positions to reduce portfolio delta exposure.
 * Monitors correlation between held positions and suggests offsetting trades.
 *
 * Features:
 *  - Net exposure tracking per asset and direction
 *  - Correlation-aware hedge recommendations
 *  - Delta-neutral target with configurable tolerance
 *  - Automatic hedge sizing (half-Kelly on the hedge leg)
 *  - Integration with risk-manager exposure data
 *  - Event mesh notifications for hedge opportunities
 *
 * Exports:
 *   computeHedgeRecommendations(positions)  - main hedge calculator
 *   getNetExposure()                        - current aggregated exposure
 *   shouldHedge(newTrade)                   - check if new trade increases risk
 *   getStats()                              - hedge engine statistics
 */

'use strict';

const { createLogger } = require('./logger');
const log = createLogger('hedge-engine');

// ─── Configuration ───────────────────────────────────────────────────────────

const MAX_NET_EXPOSURE_USD = Math.max(50, Number(process.env.HEDGE_MAX_NET_EXPOSURE_USD || 300));
const HEDGE_TOLERANCE_PCT = Math.max(0.05, Math.min(0.5, Number(process.env.HEDGE_TOLERANCE_PCT || 0.20)));
const HEDGE_ENABLED = String(process.env.HEDGE_ENGINE_ENABLED || 'true').toLowerCase() !== 'false';
const CORRELATION_THRESHOLD = Math.max(0.3, Math.min(0.95, Number(process.env.HEDGE_CORRELATION_THRESHOLD || 0.7)));

// ─── State ───────────────────────────────────────────────────────────────────

const exposureMap = new Map(); // asset => { longUsd, shortUsd, netUsd, positions: [] }
let stats = { hedgesRecommended: 0, hedgesApplied: 0, totalReductionUsd: 0, lastCheckAt: 0 };

// ─── Correlation Matrix (simplified rolling) ─────────────────────────────────

const returnHistory = new Map(); // asset => number[] (last N returns)
const HISTORY_LENGTH = 50;

function recordReturn(asset, pctReturn) {
  const hist = returnHistory.get(asset) || [];
  hist.push(pctReturn);
  if (hist.length > HISTORY_LENGTH) hist.shift();
  returnHistory.set(asset, hist);
}

function computeCorrelation(assetA, assetB) {
  const histA = returnHistory.get(assetA);
  const histB = returnHistory.get(assetB);
  if (!histA || !histB) return 0;

  const n = Math.min(histA.length, histB.length);
  if (n < 10) return 0;

  const sliceA = histA.slice(-n);
  const sliceB = histB.slice(-n);
  const meanA = sliceA.reduce((s, v) => s + v, 0) / n;
  const meanB = sliceB.reduce((s, v) => s + v, 0) / n;

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const da = sliceA[i] - meanA;
    const db = sliceB[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  const denom = Math.sqrt(varA * varB);
  return denom > 0 ? cov / denom : 0;
}

// ─── Exposure Tracking ──────────────────────────────────────────────────────

function updateExposure(asset, side, usdSize, venue) {
  const key = asset.toUpperCase();
  const entry = exposureMap.get(key) || { longUsd: 0, shortUsd: 0, netUsd: 0, positions: [] };

  if (side === 'buy' || side === 'long') {
    entry.longUsd += usdSize;
  } else {
    entry.shortUsd += usdSize;
  }
  entry.netUsd = entry.longUsd - entry.shortUsd;
  entry.positions.push({ side, usdSize, venue, ts: Date.now() });

  // Keep last 100 positions per asset
  if (entry.positions.length > 100) entry.positions = entry.positions.slice(-100);

  exposureMap.set(key, entry);
}

function closeExposure(asset, side, usdSize) {
  const key = asset.toUpperCase();
  const entry = exposureMap.get(key);
  if (!entry) return;

  if (side === 'buy' || side === 'long') {
    entry.longUsd = Math.max(0, entry.longUsd - usdSize);
  } else {
    entry.shortUsd = Math.max(0, entry.shortUsd - usdSize);
  }
  entry.netUsd = entry.longUsd - entry.shortUsd;
}

function getNetExposure() {
  const result = {};
  let totalLong = 0, totalShort = 0;

  for (const [asset, entry] of exposureMap.entries()) {
    result[asset] = {
      longUsd: Math.round(entry.longUsd * 100) / 100,
      shortUsd: Math.round(entry.shortUsd * 100) / 100,
      netUsd: Math.round(entry.netUsd * 100) / 100,
      direction: entry.netUsd > 0 ? 'long' : entry.netUsd < 0 ? 'short' : 'flat',
    };
    totalLong += entry.longUsd;
    totalShort += entry.shortUsd;
  }

  return {
    perAsset: result,
    totalLongUsd: Math.round(totalLong * 100) / 100,
    totalShortUsd: Math.round(totalShort * 100) / 100,
    netExposureUsd: Math.round((totalLong - totalShort) * 100) / 100,
    exposedAssets: Object.keys(result).length,
  };
}

// ─── Hedge Recommendations ──────────────────────────────────────────────────

/**
 * Compute hedge recommendations for the current portfolio.
 * Returns array of { asset, side, usdSize, reason, priority } recommendations.
 */
function computeHedgeRecommendations() {
  if (!HEDGE_ENABLED) return [];

  const recommendations = [];
  const exposure = getNetExposure();

  // 1. Per-asset hedge if net exposure too high
  for (const [asset, exp] of Object.entries(exposure.perAsset)) {
    const absNet = Math.abs(exp.netUsd);
    const threshold = MAX_NET_EXPOSURE_USD * (1 + HEDGE_TOLERANCE_PCT);

    if (absNet > threshold) {
      const hedgeSide = exp.netUsd > 0 ? 'sell' : 'buy';
      const hedgeSize = Math.round((absNet - MAX_NET_EXPOSURE_USD) * 0.5 * 100) / 100; // half-Kelly

      if (hedgeSize >= 5) { // minimum $5 hedge
        recommendations.push({
          asset,
          side: hedgeSide,
          usdSize: hedgeSize,
          reason: `Net ${exp.direction} exposure $${absNet.toFixed(2)} exceeds $${threshold.toFixed(2)} limit`,
          priority: absNet > MAX_NET_EXPOSURE_USD * 2 ? 'critical' : 'normal',
          type: 'direct_hedge',
        });
      }
    }
  }

  // 2. Cross-asset correlation hedge — if two highly correlated assets both long, reduce one
  const assets = Object.keys(exposure.perAsset);
  for (let i = 0; i < assets.length; i++) {
    for (let j = i + 1; j < assets.length; j++) {
      const corr = computeCorrelation(assets[i], assets[j]);
      if (Math.abs(corr) < CORRELATION_THRESHOLD) continue;

      const expA = exposure.perAsset[assets[i]];
      const expB = exposure.perAsset[assets[j]];

      // Both same direction with high correlation = concentrated risk
      if (expA.netUsd > 10 && expB.netUsd > 10 && corr > CORRELATION_THRESHOLD) {
        const smaller = expA.netUsd < expB.netUsd ? assets[i] : assets[j];
        const smallerExp = exposure.perAsset[smaller];
        const reduceSize = Math.round(Math.abs(smallerExp.netUsd) * 0.3 * 100) / 100;

        if (reduceSize >= 5) {
          recommendations.push({
            asset: smaller,
            side: 'sell',
            usdSize: reduceSize,
            reason: `${assets[i]}/${assets[j]} correlation ${(corr * 100).toFixed(1)}% — reduce concentrated risk`,
            priority: 'normal',
            type: 'correlation_hedge',
            correlatedWith: smaller === assets[i] ? assets[j] : assets[i],
            correlation: Math.round(corr * 1000) / 1000,
          });
        }
      }
    }
  }

  if (recommendations.length > 0) {
    stats.hedgesRecommended += recommendations.length;
    stats.lastCheckAt = Date.now();
    log.info('Hedge recommendations generated', { count: recommendations.length });

    // Publish to event mesh
    try {
      const eventMesh = require('./event-mesh');
      eventMesh.publish('hedge.recommendations', {
        recommendations: recommendations.length,
        totalExposure: exposure.netExposureUsd,
        ts: Date.now(),
      });
    } catch { /* optional */ }
  }

  return recommendations;
}

/**
 * Check if a proposed new trade would push exposure beyond hedge limits.
 * Returns { allowed, hedgeNeeded, recommendation }
 */
function shouldHedge(newTrade) {
  if (!HEDGE_ENABLED) return { allowed: true, hedgeNeeded: false };

  const asset = (newTrade.asset || 'BTC').toUpperCase();
  const entry = exposureMap.get(asset) || { longUsd: 0, shortUsd: 0, netUsd: 0 };
  const side = newTrade.side || 'buy';
  const size = newTrade.usdSize || 0;

  // Project new exposure
  const projectedNet = side === 'buy' || side === 'long'
    ? entry.netUsd + size
    : entry.netUsd - size;

  const absProjected = Math.abs(projectedNet);
  const threshold = MAX_NET_EXPOSURE_USD * (1 + HEDGE_TOLERANCE_PCT);

  if (absProjected <= threshold) {
    return { allowed: true, hedgeNeeded: false };
  }

  // Trade would exceed limits
  const overshoot = absProjected - MAX_NET_EXPOSURE_USD;
  return {
    allowed: false,
    hedgeNeeded: true,
    recommendation: {
      asset,
      side: projectedNet > 0 ? 'sell' : 'buy',
      usdSize: Math.round(overshoot * 0.5 * 100) / 100,
      reason: `Projected net exposure $${absProjected.toFixed(2)} exceeds limit`,
    },
  };
}

function getStats() {
  return {
    ...stats,
    exposure: getNetExposure(),
    hedgeEnabled: HEDGE_ENABLED,
    maxNetExposureUsd: MAX_NET_EXPOSURE_USD,
    tolerancePct: HEDGE_TOLERANCE_PCT,
  };
}

module.exports = {
  updateExposure,
  closeExposure,
  getNetExposure,
  computeHedgeRecommendations,
  shouldHedge,
  getStats,
  recordReturn,
  computeCorrelation,
};
