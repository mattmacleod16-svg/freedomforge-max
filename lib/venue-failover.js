/**
 * Venue Failover Engine
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Automatically re-routes orders when the primary exchange becomes degraded.
 * Monitors WebSocket feed health + exchange-client circuit breaker status to
 * maintain a real-time ranking of venue availability.
 *
 * Integration points:
 *   - master-orchestrator.js  →  getHealthyVenues() before trade execution
 *   - exchange-client.js      →  circuit breaker states
 *   - websocket-feed.js       →  price feed health
 *   - heartbeat-registry.js   →  venue engine heartbeats
 *
 * @module lib/venue-failover
 */

'use strict';

const { createLogger } = require('./logger');
const log = createLogger('venue-failover');

// ─── Optional dependency loading ──────────────────────────────────────────────
let exchangeClient, wsFeed, heartbeatRegistry, signalBus;
try { exchangeClient = require('./exchange-client'); } catch { exchangeClient = null; }
try { wsFeed = require('./websocket-feed'); } catch { wsFeed = null; }
try { heartbeatRegistry = require('./heartbeat-registry'); } catch { heartbeatRegistry = null; }
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }

// ─── Configuration ────────────────────────────────────────────────────────────
const VENUES = (process.env.VENUE_PRIORITY || 'kraken,coinbase').split(',').map(v => v.trim().toLowerCase());
const HEALTH_CHECK_INTERVAL_MS = Number(process.env.FAILOVER_HEALTH_CHECK_MS || 15000);
const DEGRADED_THRESHOLD_MS = Number(process.env.FAILOVER_DEGRADED_MS || 30000);
const DEAD_THRESHOLD_MS = Number(process.env.FAILOVER_DEAD_MS || 120000);
const MIN_FILL_RATE = Number(process.env.FAILOVER_MIN_FILL_RATE || 0.5);
const INCIDENT_COOLDOWN_MS = Number(process.env.FAILOVER_INCIDENT_COOLDOWN_MS || 300000); // 5min

// ─── Venue health state ───────────────────────────────────────────────────────

/**
 * @typedef {'healthy'|'degraded'|'down'} VenueStatus
 * @typedef {{
 *   status: VenueStatus,
 *   lastHealthyAt: number,
 *   lastCheckedAt: number,
 *   wsConnected: boolean,
 *   circuitBreakerOpen: boolean,
 *   recentFillRate: number,
 *   latencyMs: number,
 *   incidents: Array<{ts: number, reason: string}>,
 *   failoverCount: number
 * }} VenueHealth
 */

/** @type {Map<string, VenueHealth>} */
const venueHealth = new Map();

// Initialize all venues
for (const v of VENUES) {
  venueHealth.set(v, {
    status: 'healthy',
    lastHealthyAt: Date.now(),
    lastCheckedAt: Date.now(),
    wsConnected: true,
    circuitBreakerOpen: false,
    recentFillRate: 1.0,
    latencyMs: 0,
    incidents: [],
    failoverCount: 0,
  });
}

// ─── Health Assessment ────────────────────────────────────────────────────────

/**
 * Assess the health of a single venue.
 * @param {string} venue
 * @returns {VenueHealth}
 */
function assessVenueHealth(venue) {
  const health = venueHealth.get(venue) || venueHealth.get(VENUES[0]);
  const now = Date.now();
  health.lastCheckedAt = now;

  // 1. Check WebSocket feed health
  if (wsFeed && typeof wsFeed.getHealth === 'function') {
    try {
      const wsHealth = wsFeed.getHealth();
      if (venue === 'kraken') {
        health.wsConnected = !!wsHealth.kraken;
      } else if (venue === 'coinbase') {
        health.wsConnected = !!wsHealth.coinbase;
      } else {
        health.wsConnected = true; // Unknown venues assumed OK
      }
    } catch { health.wsConnected = true; }
  }

  // 2. Check exchange-client circuit breaker
  if (exchangeClient && typeof exchangeClient.getExchangeHealth === 'function') {
    try {
      const exchHealth = exchangeClient.getExchangeHealth();
      const venueKey = Object.keys(exchHealth).find(k => k.toLowerCase().includes(venue));
      if (venueKey && exchHealth[venueKey]) {
        health.circuitBreakerOpen = exchHealth[venueKey].circuitBreaker === 'open';
        health.latencyMs = exchHealth[venueKey].avgLatencyMs || 0;
      }
    } catch { /* best effort */ }
  }

  // 3. Check heartbeat for venue engine
  if (heartbeatRegistry && typeof heartbeatRegistry.checkAgentHealth === 'function') {
    try {
      const agentName = `${venue}-spot-engine`;
      const check = heartbeatRegistry.checkAgentHealth([agentName], 120000);
      if (check.agents && check.agents[agentName] && !check.agents[agentName].alive) {
        health.wsConnected = false; // Engine not running
      }
    } catch { /* best effort */ }
  }

  // 4. Determine overall status
  const prevStatus = health.status;

  if (health.circuitBreakerOpen) {
    health.status = 'down';
  } else if (!health.wsConnected) {
    const sinceHealthy = now - health.lastHealthyAt;
    health.status = sinceHealthy > DEAD_THRESHOLD_MS ? 'down' : 'degraded';
  } else if (health.recentFillRate < MIN_FILL_RATE) {
    health.status = 'degraded';
  } else if (health.latencyMs > DEGRADED_THRESHOLD_MS) {
    health.status = 'degraded';
  } else {
    health.status = 'healthy';
    health.lastHealthyAt = now;
  }

  // 5. Record incident if status worsened
  if (prevStatus === 'healthy' && health.status !== 'healthy') {
    const reason = health.circuitBreakerOpen ? 'circuit_breaker_open'
      : !health.wsConnected ? 'ws_disconnected'
      : health.recentFillRate < MIN_FILL_RATE ? 'low_fill_rate'
      : 'high_latency';

    health.incidents.push({ ts: now, reason });
    // Keep last 20 incidents
    if (health.incidents.length > 20) health.incidents = health.incidents.slice(-20);

    log.warn('venue degraded', { venue, status: health.status, reason });

    // Publish alert to signal bus
    if (signalBus) {
      try {
        signalBus.publish({
          type: 'venue_failover',
          source: 'venue-failover',
          confidence: 0.9,
          payload: { venue, status: health.status, reason, ts: new Date().toISOString() },
          ttlMs: INCIDENT_COOLDOWN_MS,
        });
      } catch { /* best effort */ }
    }
  }

  venueHealth.set(venue, health);
  return health;
}

/**
 * Get ordered list of healthy venues for order routing.
 * Failed venues are moved to the end; dead venues are excluded.
 *
 * @param {object} [opts]
 * @param {string} [opts.asset] - Asset being traded (for venue-specific scoring)
 * @param {number} [opts.usdSize] - Order size (larger orders prefer deeper venues)
 * @returns {Array<{venue: string, status: VenueStatus, score: number}>}
 */
function getHealthyVenues(opts = {}) {
  const now = Date.now();
  const results = [];

  for (const venue of VENUES) {
    const health = assessVenueHealth(venue);

    // Skip venues that are down
    if (health.status === 'down') {
      log.info('venue excluded (down)', { venue });
      continue;
    }

    // Score: healthy=100, degraded=50, weighted by fill rate + inverse latency
    let score = health.status === 'healthy' ? 100 : 50;
    score *= health.recentFillRate; // 0-1 multiplier
    if (health.latencyMs > 0) {
      score *= Math.max(0.3, 1 - (health.latencyMs / 10000)); // Penalize high latency
    }

    // Bonus for recently incident-free venues
    const recentIncidents = health.incidents.filter(i => now - i.ts < INCIDENT_COOLDOWN_MS).length;
    if (recentIncidents === 0) score *= 1.1;
    else score *= Math.max(0.5, 1 - recentIncidents * 0.15);

    results.push({ venue, status: health.status, score: Math.round(score * 100) / 100 });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  if (results.length === 0) {
    log.error('all venues down — no healthy venues available');
  }

  return results;
}

/**
 * Record a fill result to update venue health scoring.
 * Call after every order attempt.
 *
 * @param {string} venue
 * @param {boolean} success - Whether the order filled
 * @param {number} [latencyMs] - Order round-trip time
 * @param {number} [slippageBps] - Slippage in basis points
 */
function recordFillResult(venue, success, latencyMs = 0, slippageBps = 0) {
  const health = venueHealth.get(venue);
  if (!health) return;

  // EWMA fill rate (λ = 0.9 — recent fills weight more)
  const lambda = 0.9;
  health.recentFillRate = lambda * health.recentFillRate + (1 - lambda) * (success ? 1 : 0);

  if (latencyMs > 0) {
    health.latencyMs = lambda * health.latencyMs + (1 - lambda) * latencyMs;
  }

  if (!success) {
    health.failoverCount++;
    log.info('fill failure recorded', { venue, fillRate: health.recentFillRate.toFixed(3), failoverCount: health.failoverCount });
  }

  venueHealth.set(venue, health);
}

/**
 * Get the next fallback venue when the primary fails.
 *
 * @param {string} failedVenue - Venue that just failed
 * @param {object} [opts]
 * @returns {string|null} - Next venue to try, or null if none available
 */
function getFailoverVenue(failedVenue, opts = {}) {
  recordFillResult(failedVenue, false);
  const healthy = getHealthyVenues(opts);
  const fallback = healthy.find(v => v.venue !== failedVenue);

  if (fallback) {
    log.info('failover routing', { from: failedVenue, to: fallback.venue, score: fallback.score });
    return fallback.venue;
  }

  log.error('no failover venue available', { failedVenue });
  return null;
}

/**
 * Get full health dashboard for all venues.
 * @returns {object}
 */
function getVenueHealthDashboard() {
  const dashboard = {};
  for (const [venue, health] of venueHealth) {
    assessVenueHealth(venue); // Refresh
    dashboard[venue] = { ...health };
  }
  return {
    venues: dashboard,
    healthyCount: [...venueHealth.values()].filter(h => h.status === 'healthy').length,
    degradedCount: [...venueHealth.values()].filter(h => h.status === 'degraded').length,
    downCount: [...venueHealth.values()].filter(h => h.status === 'down').length,
    totalFailovers: [...venueHealth.values()].reduce((s, h) => s + h.failoverCount, 0),
    checkedAt: new Date().toISOString(),
  };
}

// ─── Periodic health check ────────────────────────────────────────────────────
let _healthTimer = null;

function startHealthLoop() {
  if (_healthTimer) return;
  _healthTimer = setInterval(() => {
    for (const venue of VENUES) {
      assessVenueHealth(venue);
    }
  }, HEALTH_CHECK_INTERVAL_MS);
  if (_healthTimer.unref) _healthTimer.unref();
}

function stopHealthLoop() {
  if (_healthTimer) { clearInterval(_healthTimer); _healthTimer = null; }
}

// Auto-start on require
startHealthLoop();

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  getHealthyVenues,
  getFailoverVenue,
  recordFillResult,
  assessVenueHealth,
  getVenueHealthDashboard,
  startHealthLoop,
  stopHealthLoop,
};
