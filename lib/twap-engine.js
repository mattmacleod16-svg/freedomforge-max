/**
 * TWAP / VWAP Execution Engine
 * ═══════════════════════════════════════════════════════════════════════
 * Advanced order execution algorithms that minimize market impact by
 * breaking large orders into smaller child orders spread over time.
 *
 * Algorithms:
 *   1. TWAP (Time-Weighted Average Price)
 *      - Splits order into N equal slices executed at fixed intervals
 *      - Best for: steady execution with minimal information leakage
 *
 *   2. VWAP (Volume-Weighted Average Price)
 *      - Allocates more volume to high-activity periods
 *      - Best for: matching market volume profile
 *
 *   3. Iceberg
 *      - Shows only a fraction of total order size, replenishes on fill
 *      - Best for: hiding large order intent
 *
 *   4. Smart Split
 *      - Splits order across multiple venues based on liquidity scores
 *      - Best for: maximizing fill rate on large orders
 *
 * Usage:
 *   const twapEngine = require('./twap-engine');
 *   const plan = twapEngine.createTWAP({ asset: 'BTC', side: 'buy', totalUsd: 200, slices: 5 });
 *   const result = await twapEngine.executePlan(plan);
 *
 * @module twap-engine
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ── Optional Dependencies ──────────────────────────────────────────────
let log;
try {
  const { createLogger } = require('./logger');
  log = createLogger('twap-engine');
} catch {
  log = { debug() {}, info() {}, warn() {}, error() {} };
}

let signalBus;
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }

// ── Configuration ──────────────────────────────────────────────────────
const TWAP_MIN_ORDER_USD = Number(process.env.TWAP_MIN_ORDER_USD || 50);
const TWAP_DEFAULT_SLICES = Number(process.env.TWAP_DEFAULT_SLICES || 5);
const TWAP_SLICE_INTERVAL_MS = Number(process.env.TWAP_SLICE_INTERVAL_MS || 30000); // 30s between slices
const ICEBERG_SHOW_RATIO = Number(process.env.ICEBERG_SHOW_RATIO || 0.20); // Show 20% of total
const MAX_SLIPPAGE_BPS = Number(process.env.TWAP_MAX_SLIPPAGE_BPS || 50); // 50 bps max acceptable slippage
const STATE_FILE = path.join(process.cwd(), 'data', 'twap-engine-state.json');

// Venue weight defaults (used for smart split)
const VENUE_WEIGHTS = {
  kraken: 0.50,
  coinbase: 0.35,
  binance: 0.15,
};

// ── State ──────────────────────────────────────────────────────────────
const activePlans = new Map(); // planId → ExecutionPlan
let completedPlans = [];

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      completedPlans = data.completedPlans || [];
      return data;
    }
  } catch { /* start fresh */ }
  return { completedPlans: [] };
}

function saveState() {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = {
      activePlans: Array.from(activePlans.entries()).map(([id, plan]) => ({ id, ...plan })),
      completedPlans: completedPlans.slice(-100), // Keep last 100
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(data, null, 2));
    fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
  } catch (e) {
    log.error('[twap] saveState failed:', e.message);
  }
}

// Initialize
loadState();

// ═══════════════════════════════════════════════════════════════════════
// 1. TWAP — Time-Weighted Average Price
// ═══════════════════════════════════════════════════════════════════════

/**
 * Create a TWAP execution plan.
 *
 * @param {Object} params
 * @param {string} params.asset      - e.g., 'BTC'
 * @param {string} params.side       - 'buy' or 'sell'
 * @param {number} params.totalUsd   - Total order size in USD
 * @param {number} [params.slices]   - Number of child orders (default: auto)
 * @param {number} [params.intervalMs] - Time between slices (default: 30s)
 * @param {string} [params.venue]    - Specific venue, or 'auto' for SOR
 * @param {number} [params.maxSlippageBps] - Max acceptable slippage per slice
 * @returns {Object} ExecutionPlan
 */
function createTWAP(params) {
  const {
    asset,
    side,
    totalUsd,
    slices = autoSliceCount(totalUsd),
    intervalMs = TWAP_SLICE_INTERVAL_MS,
    venue = 'auto',
    maxSlippageBps = MAX_SLIPPAGE_BPS,
  } = params;

  if (!asset || !side || !totalUsd || totalUsd <= 0) {
    throw new Error('TWAP requires asset, side, and totalUsd > 0');
  }

  const sliceSize = totalUsd / slices;
  const planId = `twap_${asset}_${side}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  const plan = {
    id: planId,
    algorithm: 'TWAP',
    asset,
    side,
    totalUsd,
    slices,
    sliceSize,
    intervalMs,
    venue,
    maxSlippageBps,
    status: 'pending',
    createdAt: Date.now(),
    childOrders: [],
    filledSlices: 0,
    failedSlices: 0,
    totalFilled: 0,
    totalCost: 0,
    avgPrice: 0,
    referencePrice: 0, // Set when execution starts
  };

  for (let i = 0; i < slices; i++) {
    plan.childOrders.push({
      sliceIndex: i,
      targetUsd: sliceSize,
      scheduledAt: plan.createdAt + (i * intervalMs),
      status: 'pending',
      filledUsd: 0,
      price: 0,
      venue: null,
      executedAt: null,
    });
  }

  activePlans.set(planId, plan);
  saveState();

  log.info('[twap] Created TWAP plan', {
    planId, asset, side, totalUsd, slices, sliceSize, intervalMs,
  });

  return plan;
}

// ═══════════════════════════════════════════════════════════════════════
// 2. VWAP — Volume-Weighted Average Price
// ═══════════════════════════════════════════════════════════════════════

/**
 * Create a VWAP execution plan.
 * Distributes order volume according to historical volume profile.
 *
 * @param {Object} params
 * @param {string} params.asset
 * @param {string} params.side
 * @param {number} params.totalUsd
 * @param {number[]} [params.volumeProfile] - Relative volume weights per time bucket
 * @param {number} [params.buckets=5]       - Number of time buckets
 * @param {number} [params.intervalMs]      - Time between buckets
 * @returns {Object} ExecutionPlan
 */
function createVWAP(params) {
  const {
    asset,
    side,
    totalUsd,
    volumeProfile = null,
    buckets = TWAP_DEFAULT_SLICES,
    intervalMs = TWAP_SLICE_INTERVAL_MS,
    venue = 'auto',
  } = params;

  if (!asset || !side || !totalUsd || totalUsd <= 0) {
    throw new Error('VWAP requires asset, side, and totalUsd > 0');
  }

  // Generate volume profile if not provided
  // Default: higher weight in first and last buckets (U-shaped — typical intraday pattern)
  const profile = volumeProfile || generateDefaultVolumeProfile(buckets);

  // Normalize profile to sum to 1
  const total = profile.reduce((s, v) => s + v, 0);
  const normalized = profile.map(v => v / total);

  const planId = `vwap_${asset}_${side}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  const plan = {
    id: planId,
    algorithm: 'VWAP',
    asset,
    side,
    totalUsd,
    slices: buckets,
    intervalMs,
    venue,
    maxSlippageBps: MAX_SLIPPAGE_BPS,
    status: 'pending',
    createdAt: Date.now(),
    volumeProfile: normalized,
    childOrders: [],
    filledSlices: 0,
    failedSlices: 0,
    totalFilled: 0,
    totalCost: 0,
    avgPrice: 0,
    referencePrice: 0,
  };

  for (let i = 0; i < buckets; i++) {
    const sliceUsd = totalUsd * normalized[i];
    plan.childOrders.push({
      sliceIndex: i,
      targetUsd: Math.round(sliceUsd * 100) / 100,
      volumeWeight: normalized[i],
      scheduledAt: plan.createdAt + (i * intervalMs),
      status: 'pending',
      filledUsd: 0,
      price: 0,
      venue: null,
      executedAt: null,
    });
  }

  activePlans.set(planId, plan);
  saveState();

  log.info('[twap] Created VWAP plan', {
    planId, asset, side, totalUsd, buckets,
    profile: normalized.map(v => (v * 100).toFixed(1) + '%'),
  });

  return plan;
}

// ═══════════════════════════════════════════════════════════════════════
// 3. Iceberg
// ═══════════════════════════════════════════════════════════════════════

/**
 * Create an Iceberg execution plan.
 * Shows only a fraction of the total order, replenishes on fill.
 *
 * @param {Object} params
 * @param {string} params.asset
 * @param {string} params.side
 * @param {number} params.totalUsd
 * @param {number} [params.showRatio=0.20] - Fraction of total to show (0-1)
 * @param {string} [params.venue]
 * @returns {Object} ExecutionPlan
 */
function createIceberg(params) {
  const {
    asset,
    side,
    totalUsd,
    showRatio = ICEBERG_SHOW_RATIO,
    venue = 'auto',
  } = params;

  const visibleSize = totalUsd * showRatio;
  const numReplenishments = Math.ceil(1 / showRatio);

  const planId = `ice_${asset}_${side}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  const plan = {
    id: planId,
    algorithm: 'ICEBERG',
    asset,
    side,
    totalUsd,
    visibleSize,
    showRatio,
    slices: numReplenishments,
    venue,
    maxSlippageBps: MAX_SLIPPAGE_BPS,
    status: 'pending',
    createdAt: Date.now(),
    childOrders: [],
    filledSlices: 0,
    failedSlices: 0,
    totalFilled: 0,
    totalCost: 0,
    avgPrice: 0,
    referencePrice: 0,
  };

  let remaining = totalUsd;
  for (let i = 0; i < numReplenishments; i++) {
    const sliceUsd = Math.min(visibleSize, remaining);
    remaining -= sliceUsd;
    plan.childOrders.push({
      sliceIndex: i,
      targetUsd: Math.round(sliceUsd * 100) / 100,
      scheduledAt: null, // Execute on previous fill
      status: 'pending',
      filledUsd: 0,
      price: 0,
      venue: null,
      executedAt: null,
    });
  }

  activePlans.set(planId, plan);
  saveState();

  log.info('[twap] Created Iceberg plan', {
    planId, asset, side, totalUsd, visibleSize, numReplenishments,
  });

  return plan;
}

// ═══════════════════════════════════════════════════════════════════════
// 4. Smart Split (Multi-Venue)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Split an order across multiple venues based on liquidity scores.
 *
 * @param {Object} params
 * @param {string} params.asset
 * @param {string} params.side
 * @param {number} params.totalUsd
 * @param {Object} [params.venueScores] - { venue: score } — higher = more allocation
 * @returns {Object} SplitPlan with per-venue child orders
 */
function createSmartSplit(params) {
  const {
    asset,
    side,
    totalUsd,
    venueScores = VENUE_WEIGHTS,
  } = params;

  const planId = `split_${asset}_${side}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  // Normalize venue scores
  const totalScore = Object.values(venueScores).reduce((s, v) => s + v, 0);
  const allocations = {};
  for (const [venue, score] of Object.entries(venueScores)) {
    allocations[venue] = (score / totalScore) * totalUsd;
  }

  const plan = {
    id: planId,
    algorithm: 'SMART_SPLIT',
    asset,
    side,
    totalUsd,
    venueAllocations: allocations,
    status: 'pending',
    createdAt: Date.now(),
    childOrders: [],
    filledSlices: 0,
    failedSlices: 0,
    totalFilled: 0,
    totalCost: 0,
    avgPrice: 0,
    referencePrice: 0,
  };

  let sliceIdx = 0;
  for (const [venue, usdAmount] of Object.entries(allocations)) {
    if (usdAmount < 1) continue; // Skip negligible allocations
    plan.childOrders.push({
      sliceIndex: sliceIdx++,
      targetUsd: Math.round(usdAmount * 100) / 100,
      venue,
      scheduledAt: plan.createdAt, // All execute simultaneously
      status: 'pending',
      filledUsd: 0,
      price: 0,
      executedAt: null,
    });
  }
  plan.slices = plan.childOrders.length;

  activePlans.set(planId, plan);
  saveState();

  log.info('[twap] Created Smart Split plan', {
    planId, asset, side, totalUsd, allocations,
  });

  return plan;
}

// ═══════════════════════════════════════════════════════════════════════
// Execution Engine
// ═══════════════════════════════════════════════════════════════════════

/**
 * Execute the next pending slice of an active plan.
 * Called by the orchestrator each cycle or by a timer.
 *
 * @param {string} planId
 * @param {Function} executeOrderFn - async (asset, side, usd, venue) => { filled, price, venue }
 * @returns {{ executed: boolean, slice: Object|null, plan: Object }}
 */
async function executeNextSlice(planId, executeOrderFn) {
  const plan = activePlans.get(planId);
  if (!plan) return { executed: false, slice: null, plan: null };

  if (plan.status === 'completed' || plan.status === 'cancelled') {
    return { executed: false, slice: null, plan };
  }

  plan.status = 'executing';

  // Find next executable slice
  const now = Date.now();
  const nextSlice = plan.childOrders.find(o =>
    o.status === 'pending' && (o.scheduledAt === null || o.scheduledAt <= now)
  );

  if (!nextSlice) {
    // Check if all done
    const allDone = plan.childOrders.every(o => o.status !== 'pending');
    if (allDone) {
      finalizePlan(plan);
    }
    return { executed: false, slice: null, plan };
  }

  try {
    const venue = nextSlice.venue || plan.venue;
    const result = await executeOrderFn(plan.asset, plan.side, nextSlice.targetUsd, venue);

    if (result && result.filled) {
      nextSlice.status = 'filled';
      nextSlice.filledUsd = result.filledUsd || nextSlice.targetUsd;
      nextSlice.price = result.price || 0;
      nextSlice.venue = result.venue || venue;
      nextSlice.executedAt = Date.now();
      plan.filledSlices++;
      plan.totalFilled += nextSlice.filledUsd;
      plan.totalCost += nextSlice.filledUsd;

      // Update average price
      if (nextSlice.price > 0 && plan.totalFilled > 0) {
        // Weighted average by fill size
        const prevWeight = (plan.totalFilled - nextSlice.filledUsd);
        plan.avgPrice = prevWeight > 0
          ? (plan.avgPrice * prevWeight + nextSlice.price * nextSlice.filledUsd) / plan.totalFilled
          : nextSlice.price;
      }

      // Set reference price from first fill
      if (plan.referencePrice === 0 && nextSlice.price > 0) {
        plan.referencePrice = nextSlice.price;
      }

      // Slippage check
      if (plan.referencePrice > 0 && nextSlice.price > 0) {
        const slippageBps = Math.abs(nextSlice.price - plan.referencePrice) / plan.referencePrice * 10000;
        if (slippageBps > plan.maxSlippageBps) {
          log.warn('[twap] Slippage exceeded threshold', {
            planId, sliceBps: slippageBps, maxBps: plan.maxSlippageBps,
          });
          // Don't cancel — just log (orchestrator can decide)
        }
      }

      log.info('[twap] Slice filled', {
        planId, slice: nextSlice.sliceIndex, price: nextSlice.price,
        filledUsd: nextSlice.filledUsd, venue: nextSlice.venue,
        progress: `${plan.filledSlices}/${plan.slices}`,
      });
    } else {
      nextSlice.status = 'failed';
      nextSlice.executedAt = Date.now();
      plan.failedSlices++;

      log.warn('[twap] Slice failed', {
        planId, slice: nextSlice.sliceIndex,
        targetUsd: nextSlice.targetUsd,
        error: result?.error || 'no fill',
      });
    }
  } catch (err) {
    nextSlice.status = 'failed';
    nextSlice.executedAt = Date.now();
    plan.failedSlices++;
    log.error('[twap] Slice execution error', { planId, error: err.message });
  }

  // Check completion
  const remaining = plan.childOrders.filter(o => o.status === 'pending');
  if (remaining.length === 0) {
    finalizePlan(plan);
  }

  saveState();
  return { executed: true, slice: nextSlice, plan };
}

/**
 * Execute all slices of a plan sequentially (blocking).
 * Waits the appropriate interval between slices.
 *
 * @param {Object} plan - Execution plan from createTWAP/VWAP/etc.
 * @param {Function} executeOrderFn - async (asset, side, usd, venue) => result
 * @returns {Object} Final plan state
 */
async function executePlan(plan, executeOrderFn) {
  if (!plan || !plan.id) throw new Error('Invalid plan');
  if (!executeOrderFn) throw new Error('executeOrderFn is required');

  const startTime = Date.now();
  log.info('[twap] Starting plan execution', { planId: plan.id, algorithm: plan.algorithm });

  for (let i = 0; i < plan.childOrders.length; i++) {
    const child = plan.childOrders[i];
    if (child.status !== 'pending') continue;

    // Wait for scheduled time
    if (child.scheduledAt && child.scheduledAt > Date.now()) {
      const waitMs = child.scheduledAt - Date.now();
      if (waitMs > 0 && waitMs < 600000) { // Max 10 min wait
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }

    await executeNextSlice(plan.id, executeOrderFn);
  }

  const elapsed = Date.now() - startTime;
  const finalPlan = activePlans.get(plan.id) || plan;

  log.info('[twap] Plan execution complete', {
    planId: plan.id,
    algorithm: plan.algorithm,
    filledSlices: finalPlan.filledSlices,
    failedSlices: finalPlan.failedSlices,
    totalFilled: finalPlan.totalFilled,
    avgPrice: finalPlan.avgPrice,
    elapsedMs: elapsed,
  });

  return finalPlan;
}

// ═══════════════════════════════════════════════════════════════════════
// Plan Management
// ═══════════════════════════════════════════════════════════════════════

function finalizePlan(plan) {
  plan.status = 'completed';
  plan.completedAt = Date.now();
  plan.totalDurationMs = plan.completedAt - plan.createdAt;

  // Calculate execution quality metrics
  const fillRate = plan.slices > 0 ? plan.filledSlices / plan.slices : 0;
  const slippage = plan.referencePrice > 0 && plan.avgPrice > 0
    ? ((plan.avgPrice - plan.referencePrice) / plan.referencePrice) * 10000
    : 0;

  plan.metrics = {
    fillRate,
    slippageBps: Math.round(slippage * 100) / 100,
    avgSliceLatencyMs: plan.totalDurationMs / Math.max(1, plan.filledSlices),
    implementation_shortfall: slippage, // Alias for quant folk
  };

  completedPlans.push({
    id: plan.id,
    algorithm: plan.algorithm,
    asset: plan.asset,
    side: plan.side,
    totalUsd: plan.totalUsd,
    totalFilled: plan.totalFilled,
    avgPrice: plan.avgPrice,
    fillRate,
    slippageBps: plan.metrics.slippageBps,
    completedAt: plan.completedAt,
    durationMs: plan.totalDurationMs,
  });

  // Keep only last 100 completed plans
  if (completedPlans.length > 100) completedPlans = completedPlans.slice(-100);

  activePlans.delete(plan.id);

  if (signalBus) {
    try {
      signalBus.publish('execution_complete', {
        planId: plan.id,
        algorithm: plan.algorithm,
        asset: plan.asset,
        side: plan.side,
        totalFilled: plan.totalFilled,
        avgPrice: plan.avgPrice,
        fillRate,
        slippageBps: plan.metrics.slippageBps,
      });
    } catch { /* non-critical */ }
  }

  saveState();
  log.info('[twap] Plan finalized', { planId: plan.id, metrics: plan.metrics });
}

function cancelPlan(planId) {
  const plan = activePlans.get(planId);
  if (!plan) return null;

  plan.status = 'cancelled';
  plan.cancelledAt = Date.now();

  // Cancel remaining pending slices
  for (const child of plan.childOrders) {
    if (child.status === 'pending') {
      child.status = 'cancelled';
    }
  }

  finalizePlan(plan);
  return plan;
}

function getPlan(planId) {
  return activePlans.get(planId) || completedPlans.find(p => p.id === planId) || null;
}

function getActivePlans() {
  return Array.from(activePlans.values());
}

function getCompletedPlans(limit = 20) {
  return completedPlans.slice(-limit);
}

/**
 * Recommend which algorithm to use based on order characteristics.
 *
 * @param {Object} params
 * @param {number} params.totalUsd
 * @param {string} params.urgency - 'low', 'medium', 'high'
 * @param {number} params.spreadBps - Current bid-ask spread
 * @returns {{ algorithm: string, reason: string, params: Object }}
 */
function recommendAlgorithm(params) {
  const { totalUsd = 0, urgency = 'medium', spreadBps = 0 } = params;

  // Small orders: just execute directly
  if (totalUsd < TWAP_MIN_ORDER_USD) {
    return {
      algorithm: 'DIRECT',
      reason: `Order $${totalUsd} below TWAP threshold ($${TWAP_MIN_ORDER_USD})`,
      params: {},
    };
  }

  // High urgency: use fewer slices, shorter intervals
  if (urgency === 'high') {
    return {
      algorithm: 'TWAP',
      reason: 'High urgency — fast TWAP with minimal slices',
      params: { slices: 2, intervalMs: 5000 },
    };
  }

  // Wide spread: use TWAP to avoid impact
  if (spreadBps > 30) {
    return {
      algorithm: 'TWAP',
      reason: `Wide spread (${spreadBps}bps) — TWAP reduces market impact`,
      params: { slices: autoSliceCount(totalUsd), intervalMs: TWAP_SLICE_INTERVAL_MS },
    };
  }

  // Large orders (>$200): VWAP for better execution
  if (totalUsd > 200) {
    return {
      algorithm: 'VWAP',
      reason: `Large order ($${totalUsd}) — VWAP matches volume profile`,
      params: { buckets: autoSliceCount(totalUsd) },
    };
  }

  // Very large orders (>$500): Smart Split across venues
  if (totalUsd > 500) {
    return {
      algorithm: 'SMART_SPLIT',
      reason: `Very large order ($${totalUsd}) — multi-venue split`,
      params: {},
    };
  }

  // Default: TWAP
  return {
    algorithm: 'TWAP',
    reason: 'Standard order — TWAP provides steady execution',
    params: { slices: autoSliceCount(totalUsd) },
  };
}

/**
 * Get execution quality statistics across all completed plans.
 */
function getExecutionStats() {
  if (completedPlans.length === 0) {
    return { totalPlans: 0, avgFillRate: 0, avgSlippageBps: 0, totalVolumeUsd: 0 };
  }

  const filled = completedPlans.filter(p => p.fillRate > 0);
  const avgFillRate = filled.length > 0
    ? filled.reduce((s, p) => s + p.fillRate, 0) / filled.length
    : 0;
  const avgSlippage = filled.length > 0
    ? filled.reduce((s, p) => s + Math.abs(p.slippageBps || 0), 0) / filled.length
    : 0;
  const totalVolume = completedPlans.reduce((s, p) => s + (p.totalFilled || 0), 0);

  const byAlgorithm = {};
  for (const p of completedPlans) {
    if (!byAlgorithm[p.algorithm]) {
      byAlgorithm[p.algorithm] = { count: 0, totalVolume: 0, avgSlippage: 0, fills: [] };
    }
    byAlgorithm[p.algorithm].count++;
    byAlgorithm[p.algorithm].totalVolume += p.totalFilled || 0;
    byAlgorithm[p.algorithm].fills.push(p.slippageBps || 0);
  }
  for (const algo of Object.values(byAlgorithm)) {
    algo.avgSlippage = algo.fills.length > 0
      ? algo.fills.reduce((s, v) => s + Math.abs(v), 0) / algo.fills.length
      : 0;
    delete algo.fills;
  }

  return {
    totalPlans: completedPlans.length,
    avgFillRate: Math.round(avgFillRate * 10000) / 100, // As percentage
    avgSlippageBps: Math.round(avgSlippage * 100) / 100,
    totalVolumeUsd: Math.round(totalVolume * 100) / 100,
    byAlgorithm,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function autoSliceCount(totalUsd) {
  if (totalUsd < 50) return 1;
  if (totalUsd < 100) return 2;
  if (totalUsd < 200) return 3;
  if (totalUsd < 500) return 5;
  if (totalUsd < 1000) return 7;
  return 10;
}

function generateDefaultVolumeProfile(buckets) {
  // U-shaped profile: more volume at start and end, less in middle
  const profile = [];
  for (let i = 0; i < buckets; i++) {
    const t = i / (buckets - 1); // 0 to 1
    // U-shape: higher at edges, lower in middle
    const weight = 1 + 0.5 * Math.cos(Math.PI * t);
    profile.push(Math.max(0.5, weight));
  }
  return profile;
}

// ═══════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════

module.exports = {
  // Plan creation
  createTWAP,
  createVWAP,
  createIceberg,
  createSmartSplit,

  // Execution
  executeNextSlice,
  executePlan,

  // Plan management
  cancelPlan,
  getPlan,
  getActivePlans,
  getCompletedPlans,

  // Intelligence
  recommendAlgorithm,
  getExecutionStats,

  // Configuration
  TWAP_MIN_ORDER_USD,
};
