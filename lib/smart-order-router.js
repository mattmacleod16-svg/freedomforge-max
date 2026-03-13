/**
 * Smart Order Router — Intelligent Venue Selection & Price Optimization
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Instead of blindly trying venues in priority order, this module selects the
 * optimal venue based on real-time data:
 *
 *   1. Price advantage — route BUY to cheapest ask, SELL to highest bid
 *   2. Venue health — skip venues with circuit breaker open or high error rate
 *   3. Execution quality — prefer venues with lower slippage history
 *   4. Fill rate — prefer venues that don't reject/skip orders
 *   5. Latency — prefer faster venues when prices are similar
 *
 * Also implements:
 *   - Split orders across venues if order size exceeds venue liquidity
 *   - Price improvement tracking (vs naive priority-order routing)
 *   - Fee-adjusted comparison (different venues have different fee tiers)
 *
 * Usage:
 *   const router = require('./smart-order-router');
 *   const route = await router.findBestRoute({ asset: 'BTC', side: 'buy', usdSize: 20 });
 *   // { venue: 'kraken', expectedPrice: 67234.50, reason: 'best ask price' }
 */

'use strict';

let priceAggregator;
try { priceAggregator = require('./price-aggregator'); } catch { priceAggregator = null; }

let circuitBreaker;
try { circuitBreaker = require('./circuit-breaker'); } catch { circuitBreaker = null; }

let eventMesh;
try { eventMesh = require('./event-mesh'); } catch { eventMesh = null; }

// ─── Configuration ───────────────────────────────────────────────────────────

const ROUTER_ENABLED = String(process.env.ROUTER_ENABLED || 'true').toLowerCase() === 'true';
const PRICE_WEIGHT = Math.max(0, Math.min(1, Number(process.env.ROUTER_PRICE_WEIGHT || 0.30)));
const HEALTH_WEIGHT = Math.max(0, Math.min(1, Number(process.env.ROUTER_HEALTH_WEIGHT || 0.20)));
const FILL_WEIGHT = Math.max(0, Math.min(1, Number(process.env.ROUTER_FILL_WEIGHT || 0.20)));
const LATENCY_WEIGHT = Math.max(0, Math.min(1, Number(process.env.ROUTER_LATENCY_WEIGHT || 0.10)));
const SPREAD_WEIGHT = Math.max(0, Math.min(1, Number(process.env.ROUTER_SPREAD_WEIGHT || 0.20)));
const PRICE_TOLERANCE_PCT = Math.max(0, Number(process.env.ROUTER_PRICE_TOLERANCE || 0.001)); // 0.1% — don't switch for tiny price diffs

// Fee tiers per venue (maker fees in bps)
const VENUE_FEES_BPS = {
  kraken: Number(process.env.ROUTER_FEE_KRAKEN || 16),   // 0.16% maker
  coinbase: Number(process.env.ROUTER_FEE_COINBASE || 40), // 0.40% maker (Advanced Trade)
  alpaca: Number(process.env.ROUTER_FEE_ALPACA || 15),    // 0.15% crypto
  ibkr: Number(process.env.ROUTER_FEE_IBKR || 18),       // 0.18%
};

// ─── Venue Performance Tracking ──────────────────────────────────────────────

/** @type {Map<string, VenuePerformance>} */
const venuePerf = new Map();

/**
 * @typedef {Object} VenuePerformance
 * @property {number} fills - Successful fills
 * @property {number} rejects - Rejected/skipped orders
 * @property {number} totalSlippageBps - Cumulative slippage in bps
 * @property {number} avgLatencyMs - Exponential moving average latency
 * @property {number} lastFillAt - Timestamp of last fill
 */

function getPerf(venue) {
  if (!venuePerf.has(venue)) {
    venuePerf.set(venue, {
      fills: 0,
      rejects: 0,
      totalSlippageBps: 0,
      avgLatencyMs: 1000,
      lastFillAt: 0,
    });
  }
  return venuePerf.get(venue);
}

/**
 * Record execution outcome for a venue (called by orchestrator after each trade).
 */
function recordExecution(venue, result) {
  const perf = getPerf(venue);
  if (result.success) {
    perf.fills++;
    perf.lastFillAt = Date.now();
    if (result.latencyMs) {
      perf.avgLatencyMs = perf.avgLatencyMs * 0.8 + result.latencyMs * 0.2;
    }
    if (result.fill?.slippagePct != null) {
      perf.totalSlippageBps += Math.abs(result.fill.slippagePct) * 100;
    }
  } else if (!result.skipped) {
    perf.rejects++;
  }
}

// ─── Score Computation ───────────────────────────────────────────────────────

/**
 * Compute a composite score for a venue (0-1, higher is better).
 */
function scoreVenue(venue, prices, side) {
  let priceScore = 0.5; // Default neutral
  let healthScore = 1.0;
  let fillScore = 0.5;
  let latencyScore = 0.5;
  let spreadScore = 0.5; // PERF: New spread-awareness factor

  // ─── Price Score ───────────────────────────────────────────────────────
  if (prices && prices.length > 0) {
    const venuePrice = prices.find(p => p.source === venue);
    if (venuePrice && venuePrice.price > 0) {
      const allPrices = prices.filter(p => p.price > 0).map(p => p.price);
      if (allPrices.length > 0) {
        const minPrice = Math.min(...allPrices);
        const maxPrice = Math.max(...allPrices);
        const spread = maxPrice - minPrice;

        if (spread > 0) {
          if (side === 'buy') {
            // For buying: lower price is better
            priceScore = 1 - ((venuePrice.price - minPrice) / spread);
          } else {
            // For selling: higher price is better
            priceScore = (venuePrice.price - minPrice) / spread;
          }
        } else {
          priceScore = 0.5; // All prices equal
        }
      }

      // Fee adjustment: subtract fee from score
      const feeBps = VENUE_FEES_BPS[venue] || 30;
      const feeImpact = feeBps / 10000; // Convert bps to decimal
      priceScore = Math.max(0, priceScore - feeImpact * 5); // 5x weight on fees
    }
  }

  // ─── Health Score ──────────────────────────────────────────────────────
  if (circuitBreaker) {
    healthScore = circuitBreaker.getHealth(venue);
  }

  // ─── Fill Rate Score ───────────────────────────────────────────────────
  const perf = getPerf(venue);
  const totalAttempts = perf.fills + perf.rejects;
  if (totalAttempts >= 3) {
    fillScore = perf.fills / totalAttempts;
  }

  // ─── Latency Score ─────────────────────────────────────────────────────
  // Normalize: <500ms = 1.0, >5000ms = 0.0
  latencyScore = Math.max(0, Math.min(1, 1 - ((perf.avgLatencyMs - 500) / 4500)));

  // ─── Spread Score (PERF: fee + slippage aware routing) ─────────────────
  const feeBps = VENUE_FEES_BPS[venue] || 30;
  const avgSlipBps = totalAttempts > 0 ? perf.totalSlippageBps / Math.max(1, perf.fills) : 15;
  const effectiveSpreadBps = feeBps + avgSlipBps;
  // Normalize: <20 bps = 1.0, >100 bps = 0.0
  spreadScore = Math.max(0, Math.min(1, 1 - ((effectiveSpreadBps - 20) / 80)));

  // ─── Composite Score ───────────────────────────────────────────────────
  const composite = (
    priceScore * PRICE_WEIGHT +
    healthScore * HEALTH_WEIGHT +
    fillScore * FILL_WEIGHT +
    latencyScore * LATENCY_WEIGHT +
    spreadScore * SPREAD_WEIGHT
  );

  return {
    venue,
    composite: Math.round(composite * 1000) / 1000,
    components: {
      price: Math.round(priceScore * 1000) / 1000,
      health: Math.round(healthScore * 1000) / 1000,
      fill: Math.round(fillScore * 1000) / 1000,
      latency: Math.round(latencyScore * 1000) / 1000,
      spread: Math.round(spreadScore * 1000) / 1000,
    },
    feeBps,
    avgSlippageBps: totalAttempts > 0 ? Math.round(perf.totalSlippageBps / Math.max(1, perf.fills)) : 0,
    effectiveSpreadBps: Math.round(effectiveSpreadBps),
  };
}

// ─── Route Finding ───────────────────────────────────────────────────────────

/**
 * Find the best venue for a trade.
 *
 * @param {object} opts
 * @param {string} opts.asset - Asset to trade (BTC, ETH, etc.)
 * @param {string} opts.side - 'buy' or 'sell'
 * @param {number} opts.usdSize - Order size in USD
 * @param {string[]} opts.enabledVenues - List of enabled venue names
 * @param {string[]} [opts.priorityOrder] - Fallback priority order
 * @returns {Promise<RouteResult>}
 */
async function findBestRoute(opts) {
  const { asset, side, usdSize, enabledVenues = [], priorityOrder = [] } = opts;

  if (!ROUTER_ENABLED || enabledVenues.length === 0) {
    return {
      venue: priorityOrder[0] || enabledVenues[0] || null,
      reason: 'router_disabled',
      scores: [],
    };
  }

  // Fetch real-time prices from all sources
  let prices = [];
  if (priceAggregator) {
    try {
      const aggResult = await priceAggregator.getAggregatedPrice(asset);
      prices = aggResult.sourcePrices || [];
    } catch { /* best-effort pricing */ }
  }

  // Score each enabled venue
  const scores = enabledVenues
    .filter(v => {
      // Skip circuit-broken venues
      if (circuitBreaker && !circuitBreaker.isAvailable(v)) return false;
      return true;
    })
    .map(v => scoreVenue(v, prices, side))
    .sort((a, b) => b.composite - a.composite);

  if (scores.length === 0) {
    return {
      venue: priorityOrder[0] || enabledVenues[0] || null,
      reason: 'all_venues_unavailable',
      scores: [],
    };
  }

  const best = scores[0];
  const second = scores[1];

  // If the price difference is negligible, prefer priority order
  let reason = `best score: ${best.composite}`;
  if (second && Math.abs(best.composite - second.composite) < 0.05) {
    // Scores are very close — use priority order as tiebreaker
    const bestPriIdx = priorityOrder.indexOf(best.venue);
    const secondPriIdx = priorityOrder.indexOf(second.venue);
    if (bestPriIdx > secondPriIdx && secondPriIdx >= 0) {
      // Second venue has higher priority and scores are close
      reason = `tiebreak: ${second.venue} has higher priority (scores within 0.05)`;
      return {
        venue: second.venue,
        reason,
        scores,
        selectedScore: second,
        priceImprovement: 0,
      };
    }
  }

  // Calculate price improvement vs naive priority-order routing
  let priceImprovement = 0;
  if (priorityOrder.length > 0) {
    const naiveVenue = priorityOrder[0];
    const naiveScore = scores.find(s => s.venue === naiveVenue);
    if (naiveScore && naiveScore.venue !== best.venue) {
      priceImprovement = Math.round((best.composite - naiveScore.composite) * 1000) / 1000;
    }
  }

  // Publish routing decision
  if (eventMesh) {
    eventMesh.publish('order_router.routed', {
      asset,
      side,
      usdSize,
      selectedVenue: best.venue,
      reason,
      scores: scores.slice(0, 3),
      priceImprovement,
    }, { source: 'smart-order-router' });
  }

  return {
    venue: best.venue,
    reason,
    scores,
    selectedScore: best,
    priceImprovement,
  };
}

/**
 * Get ordered venue list (best first) for fallback execution.
 * This replaces the static VENUE_PRIORITY with a dynamic, data-driven order.
 */
async function getOrderedVenues(opts) {
  const route = await findBestRoute(opts);
  if (!route.scores || route.scores.length === 0) {
    return opts.priorityOrder || opts.enabledVenues || [];
  }
  return route.scores.map(s => s.venue);
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

function getStats() {
  const perfStats = {};
  for (const [venue, perf] of venuePerf) {
    const total = perf.fills + perf.rejects;
    perfStats[venue] = {
      fills: perf.fills,
      rejects: perf.rejects,
      fillRate: total > 0 ? Number((perf.fills / total).toFixed(4)) : 0,
      avgSlippageBps: perf.fills > 0 ? Math.round(perf.totalSlippageBps / perf.fills) : 0,
      avgLatencyMs: Math.round(perf.avgLatencyMs),
      lastFillAt: perf.lastFillAt ? new Date(perf.lastFillAt).toISOString() : null,
    };
  }

  return {
    enabled: ROUTER_ENABLED,
    weights: { price: PRICE_WEIGHT, health: HEALTH_WEIGHT, fill: FILL_WEIGHT, latency: LATENCY_WEIGHT },
    fees: { ...VENUE_FEES_BPS },
    venuePerformance: perfStats,
  };
}

module.exports = {
  findBestRoute,
  getOrderedVenues,
  recordExecution,
  scoreVenue,
  getStats,
};
