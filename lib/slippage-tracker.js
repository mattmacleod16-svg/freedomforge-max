/**
 * Slippage Tracker
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Records expected vs actual fill prices for every trade, building a per-venue,
 * per-asset, per-size-bucket slippage model. Feeds into TWAP engine's algo
 * recommendation and smart order router's venue scoring.
 *
 * @module lib/slippage-tracker
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');
const log = createLogger('slippage-tracker');

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

// ─── Configuration ────────────────────────────────────────────────────────────
const DATA_DIR = process.env.VERCEL ? '/tmp/freedomforge-data' : path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'slippage-tracker-state.json');
const MAX_RECORDS = Number(process.env.SLIPPAGE_MAX_RECORDS || 5000);
const SIZE_BUCKETS = [0, 25, 50, 100, 250, 500]; // USD thresholds
const EWMA_LAMBDA = 0.92; // Smoothing factor for running averages

// ─── State ────────────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   expectedPrice: number,
 *   actualPrice: number,
 *   slippageBps: number,
 *   venue: string,
 *   asset: string,
 *   side: string,
 *   usdSize: number,
 *   sizeBucket: string,
 *   ts: string,
 *   orderId?: string,
 *   method?: string
 * }} SlippageRecord
 */

let state = {
  records: [],
  // Aggregated running averages: venueAssetBucket → { avgBps, count, ewmaBps, worstBps }
  aggregates: {},
  totalRecords: 0,
  lastUpdatedAt: null,
};

// Load state
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      state = { ...state, ...raw };
    }
  } catch (err) {
    log.warn('failed to load slippage state', { error: err?.message });
  }
}
loadState();

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    if (rio) rio.writeJsonAtomic(STATE_FILE, state);
    else fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    log.warn('failed to save slippage state', { error: err?.message });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSizeBucket(usdSize) {
  let bucket = '0';
  for (const threshold of SIZE_BUCKETS) {
    if (usdSize >= threshold) bucket = String(threshold);
  }
  return bucket;
}

function aggKey(venue, asset, sizeBucket) {
  return `${venue}:${asset}:${sizeBucket}`;
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Record a fill and compute slippage.
 *
 * @param {object} params
 * @param {number} params.expectedPrice - Price at signal generation time
 * @param {number} params.actualPrice - Actual fill price
 * @param {string} params.venue - Exchange venue
 * @param {string} params.asset - Asset symbol
 * @param {string} params.side - 'buy' or 'sell'
 * @param {number} params.usdSize - Order size in USD
 * @param {string} [params.orderId] - Order ID
 * @param {string} [params.method] - Execution method (limit_ioc, market, etc.)
 * @returns {{ slippageBps: number, isAdverse: boolean }}
 */
function recordSlippage({ expectedPrice, actualPrice, venue, asset, side, usdSize, orderId, method }) {
  if (!expectedPrice || !actualPrice || expectedPrice <= 0 || actualPrice <= 0) {
    return { slippageBps: 0, isAdverse: false };
  }

  // Slippage: positive = adverse (paid more/received less than expected)
  let slippageBps;
  if (side === 'buy') {
    slippageBps = ((actualPrice - expectedPrice) / expectedPrice) * 10000;
  } else {
    slippageBps = ((expectedPrice - actualPrice) / expectedPrice) * 10000;
  }
  slippageBps = Math.round(slippageBps * 100) / 100;

  const sizeBucket = getSizeBucket(usdSize);
  const record = {
    expectedPrice,
    actualPrice,
    slippageBps,
    venue: (venue || 'unknown').toLowerCase(),
    asset: (asset || 'unknown').toUpperCase(),
    side,
    usdSize: Math.round(usdSize * 100) / 100,
    sizeBucket,
    ts: new Date().toISOString(),
    orderId,
    method,
  };

  // Append to records (rolling window)
  state.records.push(record);
  if (state.records.length > MAX_RECORDS) {
    state.records = state.records.slice(-MAX_RECORDS);
  }
  state.totalRecords++;

  // Update running aggregate
  const key = aggKey(record.venue, record.asset, sizeBucket);
  if (!state.aggregates[key]) {
    state.aggregates[key] = { avgBps: 0, count: 0, ewmaBps: 0, worstBps: 0, bestBps: Infinity };
  }
  const agg = state.aggregates[key];
  agg.count++;
  agg.avgBps = agg.avgBps + (slippageBps - agg.avgBps) / agg.count; // Running mean
  agg.ewmaBps = EWMA_LAMBDA * agg.ewmaBps + (1 - EWMA_LAMBDA) * slippageBps;
  agg.worstBps = Math.max(agg.worstBps, slippageBps);
  agg.bestBps = Math.min(agg.bestBps, slippageBps);

  state.lastUpdatedAt = record.ts;

  // Periodic save (every 10 records)
  if (state.totalRecords % 10 === 0) saveState();

  const isAdverse = slippageBps > 5; // More than 5bps adverse
  if (isAdverse) {
    log.info('adverse slippage recorded', {
      venue: record.venue, asset: record.asset, slippageBps, usdSize, method,
    });
  }

  return { slippageBps, isAdverse };
}

/**
 * Get expected slippage for a planned order.
 * Uses EWMA of historical slippage for the venue/asset/size combination.
 *
 * @param {string} venue
 * @param {string} asset
 * @param {number} usdSize
 * @returns {{ expectedBps: number, confidence: number, sampleSize: number }}
 */
function getExpectedSlippage(venue, asset, usdSize) {
  const sizeBucket = getSizeBucket(usdSize);
  const key = aggKey(venue.toLowerCase(), asset.toUpperCase(), sizeBucket);
  const agg = state.aggregates[key];

  if (!agg || agg.count < 3) {
    // Not enough data — use venue-level average
    const venueRecords = state.records.filter(r => r.venue === venue.toLowerCase());
    if (venueRecords.length >= 3) {
      const avg = venueRecords.reduce((s, r) => s + r.slippageBps, 0) / venueRecords.length;
      return { expectedBps: Math.round(avg * 100) / 100, confidence: 0.3, sampleSize: venueRecords.length };
    }
    return { expectedBps: 5, confidence: 0.1, sampleSize: 0 }; // Default assumption: 5bps
  }

  return {
    expectedBps: Math.round(agg.ewmaBps * 100) / 100,
    confidence: Math.min(0.95, 0.3 + agg.count * 0.05),
    sampleSize: agg.count,
  };
}

/**
 * Get slippage analytics for a venue.
 *
 * @param {string} [venue] - Filter by venue (null = all)
 * @param {object} [opts]
 * @param {number} [opts.sinceDays=7] - Lookback window
 * @returns {object}
 */
function getAnalytics(venue, opts = {}) {
  const sinceDays = opts.sinceDays || 7;
  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

  let records = state.records.filter(r => new Date(r.ts).getTime() >= cutoff);
  if (venue) records = records.filter(r => r.venue === venue.toLowerCase());

  if (records.length === 0) {
    return { totalRecords: 0, avgSlippageBps: 0, medianSlippageBps: 0, worstSlippageBps: 0, adverseRate: 0 };
  }

  const bpsValues = records.map(r => r.slippageBps).sort((a, b) => a - b);
  const totalAdverse = records.filter(r => r.slippageBps > 5).length;

  // Per-asset breakdown
  const byAsset = {};
  for (const r of records) {
    if (!byAsset[r.asset]) byAsset[r.asset] = { count: 0, totalBps: 0, worstBps: 0 };
    byAsset[r.asset].count++;
    byAsset[r.asset].totalBps += r.slippageBps;
    byAsset[r.asset].worstBps = Math.max(byAsset[r.asset].worstBps, r.slippageBps);
  }
  for (const asset of Object.keys(byAsset)) {
    byAsset[asset].avgBps = Math.round((byAsset[asset].totalBps / byAsset[asset].count) * 100) / 100;
  }

  // Per-method breakdown
  const byMethod = {};
  for (const r of records) {
    const m = r.method || 'unknown';
    if (!byMethod[m]) byMethod[m] = { count: 0, totalBps: 0 };
    byMethod[m].count++;
    byMethod[m].totalBps += r.slippageBps;
  }
  for (const m of Object.keys(byMethod)) {
    byMethod[m].avgBps = Math.round((byMethod[m].totalBps / byMethod[m].count) * 100) / 100;
  }

  return {
    totalRecords: records.length,
    avgSlippageBps: Math.round((bpsValues.reduce((s, v) => s + v, 0) / bpsValues.length) * 100) / 100,
    medianSlippageBps: bpsValues[Math.floor(bpsValues.length / 2)],
    worstSlippageBps: bpsValues[bpsValues.length - 1],
    bestSlippageBps: bpsValues[0],
    adverseRate: Math.round((totalAdverse / records.length) * 100) / 100,
    byAsset,
    byMethod,
    sinceDays,
  };
}

/**
 * Rank venues by slippage quality for a specific asset/size.
 *
 * @param {string} asset
 * @param {number} usdSize
 * @returns {Array<{venue: string, expectedBps: number, confidence: number}>}
 */
function rankVenuesBySlippage(asset, usdSize) {
  const rankings = [];
  for (const venue of ['kraken', 'coinbase', 'binance']) {
    const expected = getExpectedSlippage(venue, asset, usdSize);
    rankings.push({ venue, ...expected });
  }
  return rankings.sort((a, b) => a.expectedBps - b.expectedBps);
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  recordSlippage,
  getExpectedSlippage,
  getAnalytics,
  rankVenuesBySlippage,
  saveState,
};
