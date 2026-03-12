/**
 * Circuit Breaker — Exchange API Resilience Layer
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Implements the circuit breaker pattern for all external API calls (exchanges,
 * data providers, webhooks). Prevents cascading failures when a service is down
 * by short-circuiting calls after N consecutive failures.
 *
 * States:
 *   CLOSED  → Normal operation. Calls pass through. Failures counted.
 *   OPEN    → Service is down. Calls fail immediately (no network hit).
 *             Auto-transitions to HALF_OPEN after cooldown.
 *   HALF_OPEN → Probe mode. Next call passed through.
 *               Success → CLOSED. Failure → OPEN again.
 *
 * Features:
 *   - Per-service independent breakers (exchange, data feed, webhook, etc.)
 *   - Configurable failure threshold, cooldown, and timeout
 *   - Exponential backoff on repeated OPEN→HALF_OPEN→OPEN cycles
 *   - Call latency tracking and health scoring
 *   - Event mesh integration for system-wide observability
 *   - Automatic recovery with jitter to prevent thundering herd
 *
 * Usage:
 *   const cb = require('./circuit-breaker');
 *   const result = await cb.call('binance', () => fetch('https://api.binance.com/...'));
 *   // If Binance is failing, calls are short-circuited without network hit
 */

'use strict';

let eventMesh;
try { eventMesh = require('./event-mesh'); } catch { eventMesh = null; }

// ─── Configuration ───────────────────────────────────────────────────────────

const FAILURE_THRESHOLD = Math.max(2, Number(process.env.CB_FAILURE_THRESHOLD || 5));
const COOLDOWN_MS = Math.max(5000, Number(process.env.CB_COOLDOWN_MS || 30000));
const MAX_COOLDOWN_MS = Math.max(60000, Number(process.env.CB_MAX_COOLDOWN_MS || 300000));
const CALL_TIMEOUT_MS = Math.max(3000, Number(process.env.CB_CALL_TIMEOUT_MS || 15000));
const HALF_OPEN_MAX_PROBES = Math.max(1, Number(process.env.CB_HALF_OPEN_PROBES || 2));
const HEALTH_WINDOW_SIZE = 50; // Track last N calls for health score

// ─── States ──────────────────────────────────────────────────────────────────

const STATE = { CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half_open' };

// ─── Per-Service Breaker State ───────────────────────────────────────────────

/** @type {Map<string, BreakerState>} */
const breakers = new Map();

/**
 * @typedef {Object} BreakerState
 * @property {string} state - Current state (closed/open/half_open)
 * @property {number} failures - Consecutive failure count
 * @property {number} successes - Consecutive success count (in half_open)
 * @property {number} lastFailureAt - Timestamp of last failure
 * @property {number} openedAt - When breaker opened
 * @property {number} cooldownMs - Current cooldown (grows with exponential backoff)
 * @property {number} tripCount - How many times breaker has tripped to OPEN
 * @property {number[]} latencies - Recent call latencies for health scoring
 * @property {number} totalCalls - Lifetime call count
 * @property {number} totalFailures - Lifetime failure count
 * @property {number} totalShortCircuited - Calls that were short-circuited
 */

function getBreaker(service) {
  if (!breakers.has(service)) {
    breakers.set(service, {
      state: STATE.CLOSED,
      failures: 0,
      successes: 0,
      lastFailureAt: 0,
      openedAt: 0,
      cooldownMs: COOLDOWN_MS,
      tripCount: 0,
      latencies: [],
      totalCalls: 0,
      totalFailures: 0,
      totalShortCircuited: 0,
    });
  }
  return breakers.get(service);
}

// ─── State Transitions ───────────────────────────────────────────────────────

function tripOpen(service, breaker, reason) {
  const wasState = breaker.state;
  breaker.state = STATE.OPEN;
  breaker.openedAt = Date.now();
  breaker.successes = 0;
  breaker.tripCount++;

  // Exponential backoff: each trip doubles cooldown (with jitter), capped at MAX_COOLDOWN_MS
  if (breaker.tripCount > 1) {
    const backoff = COOLDOWN_MS * Math.pow(1.5, Math.min(breaker.tripCount - 1, 8));
    const jitter = Math.random() * 0.3 * backoff; // 0-30% jitter
    breaker.cooldownMs = Math.min(backoff + jitter, MAX_COOLDOWN_MS);
  } else {
    breaker.cooldownMs = COOLDOWN_MS;
  }

  if (eventMesh) {
    eventMesh.publish('circuit_breaker.opened', {
      service,
      reason,
      tripCount: breaker.tripCount,
      cooldownMs: Math.round(breaker.cooldownMs),
      consecutiveFailures: breaker.failures,
    }, { source: 'circuit-breaker', priority: 3 }); // HIGH priority
  }

  // Only log state changes
  if (wasState !== STATE.OPEN) {
    console.log(`[circuit-breaker] ${service}: OPENED after ${breaker.failures} failures (cooldown: ${Math.round(breaker.cooldownMs / 1000)}s, trips: ${breaker.tripCount})`);
  }
}

function transitionHalfOpen(service, breaker) {
  breaker.state = STATE.HALF_OPEN;
  breaker.successes = 0;

  if (eventMesh) {
    eventMesh.publish('circuit_breaker.half_open', {
      service,
      cooldownElapsed: Date.now() - breaker.openedAt,
      tripCount: breaker.tripCount,
    }, { source: 'circuit-breaker' });
  }
}

function transitionClosed(service, breaker) {
  const wasOpen = breaker.state !== STATE.CLOSED;
  breaker.state = STATE.CLOSED;
  breaker.failures = 0;
  breaker.successes = 0;

  // Reset cooldown after successful recovery
  if (wasOpen) {
    breaker.cooldownMs = COOLDOWN_MS;
    console.log(`[circuit-breaker] ${service}: CLOSED — service recovered (was tripped ${breaker.tripCount} times)`);

    if (eventMesh) {
      eventMesh.publish('circuit_breaker.closed', {
        service,
        tripCount: breaker.tripCount,
        recoveryTimeMs: Date.now() - breaker.openedAt,
      }, { source: 'circuit-breaker' });
    }
  }
}

// ─── Core Call Wrapper ───────────────────────────────────────────────────────

/**
 * Execute a function through the circuit breaker for a given service.
 *
 * @param {string} service - Service identifier (e.g., 'binance', 'coinbase', 'coingecko')
 * @param {Function} fn - Async function to execute
 * @param {object} [opts] - Options
 * @param {number} [opts.timeoutMs] - Override default timeout
 * @param {*} [opts.fallback] - Value to return when circuit is open (instead of throwing)
 * @returns {Promise<*>} Result of fn() or fallback
 */
async function call(service, fn, opts = {}) {
  const breaker = getBreaker(service);
  breaker.totalCalls++;

  const timeoutMs = opts.timeoutMs || CALL_TIMEOUT_MS;

  // ─── OPEN STATE: Check if cooldown has elapsed ─────────────────────────
  if (breaker.state === STATE.OPEN) {
    const elapsed = Date.now() - breaker.openedAt;
    if (elapsed < breaker.cooldownMs) {
      // Short-circuit: don't even try
      breaker.totalShortCircuited++;
      if (opts.fallback !== undefined) return opts.fallback;
      throw new CircuitOpenError(service, breaker.cooldownMs - elapsed);
    }
    // Cooldown elapsed → probe
    transitionHalfOpen(service, breaker);
  }

  // ─── HALF_OPEN STATE: Allow limited probes ─────────────────────────────
  // (falls through from OPEN → HALF_OPEN transition above, or already half_open)

  // ─── Execute the call with timeout ─────────────────────────────────────
  const startMs = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Circuit breaker timeout: ${service} exceeded ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);

    // SUCCESS
    const latency = Date.now() - startMs;
    breaker.latencies.push(latency);
    if (breaker.latencies.length > HEALTH_WINDOW_SIZE) breaker.latencies.shift();

    if (breaker.state === STATE.HALF_OPEN) {
      breaker.successes++;
      if (breaker.successes >= HALF_OPEN_MAX_PROBES) {
        transitionClosed(service, breaker);
      }
    } else {
      breaker.failures = 0; // Reset consecutive failures on success
    }

    return result;

  } catch (err) {
    // FAILURE
    const latency = Date.now() - startMs;
    breaker.latencies.push(latency);
    if (breaker.latencies.length > HEALTH_WINDOW_SIZE) breaker.latencies.shift();
    breaker.failures++;
    breaker.lastFailureAt = Date.now();
    breaker.totalFailures++;

    if (breaker.state === STATE.HALF_OPEN) {
      // Probe failed → back to OPEN
      tripOpen(service, breaker, `half_open probe failed: ${err?.message || err}`);
    } else if (breaker.failures >= FAILURE_THRESHOLD) {
      // Threshold exceeded → OPEN
      tripOpen(service, breaker, `${breaker.failures} consecutive failures: ${err?.message || err}`);
    }

    if (opts.fallback !== undefined) return opts.fallback;
    throw err;
  }
}

// ─── Health Scoring ──────────────────────────────────────────────────────────

/**
 * Get health score for a service (0.0 = dead, 1.0 = perfect).
 * Based on: success rate, latency, and current breaker state.
 */
function getHealth(service) {
  const breaker = getBreaker(service);

  if (breaker.state === STATE.OPEN) return 0;
  if (breaker.totalCalls === 0) return 1; // No data = assume healthy

  const successRate = breaker.totalCalls > 0
    ? (breaker.totalCalls - breaker.totalFailures) / breaker.totalCalls
    : 1;

  // Latency score: penalize if avg latency is high relative to timeout
  let latencyScore = 1;
  if (breaker.latencies.length > 0) {
    const avgLatency = breaker.latencies.reduce((a, b) => a + b, 0) / breaker.latencies.length;
    latencyScore = Math.max(0, 1 - (avgLatency / CALL_TIMEOUT_MS));
  }

  // State penalty
  const statePenalty = breaker.state === STATE.HALF_OPEN ? 0.5 : 1.0;

  return Math.round(successRate * latencyScore * statePenalty * 1000) / 1000;
}

/**
 * Get comprehensive stats for all tracked services.
 */
function getStats() {
  const stats = {};
  for (const [service, breaker] of breakers) {
    const avgLatency = breaker.latencies.length > 0
      ? Math.round(breaker.latencies.reduce((a, b) => a + b, 0) / breaker.latencies.length)
      : 0;
    const p95Latency = breaker.latencies.length >= 5
      ? Math.round(breaker.latencies.slice().sort((a, b) => a - b)[Math.floor(breaker.latencies.length * 0.95)])
      : 0;

    stats[service] = {
      state: breaker.state,
      health: getHealth(service),
      consecutiveFailures: breaker.failures,
      tripCount: breaker.tripCount,
      cooldownMs: breaker.state === STATE.OPEN ? Math.round(breaker.cooldownMs) : 0,
      cooldownRemainingMs: breaker.state === STATE.OPEN
        ? Math.max(0, Math.round(breaker.cooldownMs - (Date.now() - breaker.openedAt)))
        : 0,
      totalCalls: breaker.totalCalls,
      totalFailures: breaker.totalFailures,
      totalShortCircuited: breaker.totalShortCircuited,
      successRate: breaker.totalCalls > 0
        ? Number(((breaker.totalCalls - breaker.totalFailures) / breaker.totalCalls).toFixed(4))
        : 1,
      avgLatencyMs: avgLatency,
      p95LatencyMs: p95Latency,
    };
  }
  return stats;
}

/**
 * Check if a service is currently available (not in OPEN state).
 */
function isAvailable(service) {
  const breaker = getBreaker(service);
  if (breaker.state === STATE.CLOSED) return true;
  if (breaker.state === STATE.HALF_OPEN) return true;
  // OPEN: check if cooldown elapsed
  return (Date.now() - breaker.openedAt) >= breaker.cooldownMs;
}

/**
 * Force-reset a breaker to CLOSED state (manual recovery).
 */
function reset(service) {
  const breaker = getBreaker(service);
  breaker.state = STATE.CLOSED;
  breaker.failures = 0;
  breaker.successes = 0;
  breaker.cooldownMs = COOLDOWN_MS;
  console.log(`[circuit-breaker] ${service}: manually reset to CLOSED`);
}

// ─── Custom Error ────────────────────────────────────────────────────────────

class CircuitOpenError extends Error {
  constructor(service, remainingMs) {
    super(`Circuit breaker OPEN for ${service} — ${Math.round(remainingMs / 1000)}s until probe`);
    this.name = 'CircuitOpenError';
    this.service = service;
    this.remainingMs = remainingMs;
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  call,
  isAvailable,
  getHealth,
  getStats,
  reset,
  CircuitOpenError,
  STATE,
};
