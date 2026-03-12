/**
 * Agent Supervisor — Automated Agent Lifecycle Management
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Turns the advisory-only heartbeat registry into an active supervisor that
 * detects dead/stalled agents and restarts them with exponential backoff.
 *
 * Features:
 *   - Monitors heartbeats from all registered agents
 *   - Auto-restarts dead agents via configurable restart strategies
 *   - Exponential backoff: prevents restart storms
 *   - Circuit breaker: stops restarting permanently broken agents
 *   - Publishes agent lifecycle events to event mesh
 *   - Health degradation: progressive trading restriction as agents die
 *
 * Usage:
 *   const supervisor = require('./agent-supervisor');
 *   supervisor.register('exit-manager', { restart: () => exitManager.runExitLoop() });
 *   supervisor.start();
 */

'use strict';

const { createLogger } = require('./logger');
const log = createLogger('agent-supervisor');

let heartbeatRegistry, eventMesh;
try { heartbeatRegistry = require('./heartbeat-registry'); } catch { heartbeatRegistry = null; }
try { eventMesh = require('./event-mesh'); } catch { eventMesh = null; }

// ─── Configuration ───────────────────────────────────────────────────────────

const CHECK_INTERVAL_MS = Math.max(15000, Number(process.env.SUPERVISOR_CHECK_MS || 30000));
const MAX_RESTART_ATTEMPTS = Math.max(1, Math.min(20, Number(process.env.SUPERVISOR_MAX_RESTARTS || 5)));
const BASE_BACKOFF_MS = Math.max(5000, Number(process.env.SUPERVISOR_BACKOFF_MS || 15000));
const BACKOFF_MULTIPLIER = 2;
const CIRCUIT_BREAKER_WINDOW_MS = 10 * 60 * 1000; // 10 minutes window
const CIRCUIT_BREAKER_FAILURES = 3; // trips after N failures in window

// ─── Agent Registry ──────────────────────────────────────────────────────────

/**
 * @type {Map<string, {
 *   restart: Function,
 *   critical: boolean,
 *   maxAgeMs: number,
 *   restartAttempts: number,
 *   lastRestartAt: number,
 *   consecutiveFailures: number,
 *   failureTimestamps: number[],
 *   circuitOpen: boolean,
 *   status: 'running'|'dead'|'restarting'|'circuit_open'
 * }>}
 */
const agents = new Map();

let checkTimer = null;
let running = false;

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * Register an agent for supervision.
 * @param {string} name - Unique agent identifier (must match heartbeat source)
 * @param {object} opts
 * @param {Function} opts.restart - Async function to restart the agent
 * @param {boolean} [opts.critical=false] - If true, system degrades when dead
 * @param {number} [opts.maxAgeMs] - Max heartbeat age before considered dead
 */
function register(name, opts = {}) {
  if (typeof opts.restart !== 'function') {
    throw new Error(`Agent ${name} must have a restart function`);
  }

  agents.set(name, {
    restart: opts.restart,
    critical: Boolean(opts.critical),
    maxAgeMs: opts.maxAgeMs || heartbeatRegistry?.DEFAULT_MAX_AGE_MS || 600000,
    restartAttempts: 0,
    lastRestartAt: 0,
    consecutiveFailures: 0,
    failureTimestamps: [],
    circuitOpen: false,
    status: 'running',
  });

  log.info(`Registered agent: ${name} (critical=${opts.critical || false})`);
}

/**
 * Unregister an agent.
 */
function unregister(name) {
  return agents.delete(name);
}

// ─── Health Check & Restart Logic ────────────────────────────────────────────

/**
 * Check all agents, restart dead ones.
 */
async function checkAll() {
  if (!heartbeatRegistry) return { checked: 0, restarted: 0, dead: 0 };

  const agentNames = [...agents.keys()];
  const health = heartbeatRegistry.checkAgentHealth(agentNames);
  let restarted = 0;
  let dead = 0;

  for (const [name, agentState] of agents) {
    const agentHealth = health.agents?.[name];
    const isAlive = agentHealth?.alive ?? true; // assume alive if no data

    if (isAlive) {
      // Reset failure tracking when agent is healthy
      if (agentState.status !== 'running') {
        log.info(`Agent ${name} recovered (was ${agentState.status})`);
        publishLifecycleEvent(name, 'recovered');
      }
      agentState.status = 'running';
      agentState.consecutiveFailures = 0;
      agentState.restartAttempts = 0;
      continue;
    }

    // Agent is dead
    dead++;
    agentState.status = 'dead';

    // Circuit breaker check
    if (agentState.circuitOpen) {
      // Check if circuit breaker should reset (after window expires)
      const recentFailures = agentState.failureTimestamps.filter(
        ts => Date.now() - ts < CIRCUIT_BREAKER_WINDOW_MS
      );
      if (recentFailures.length < CIRCUIT_BREAKER_FAILURES) {
        agentState.circuitOpen = false;
        agentState.status = 'dead';
        log.info(`Circuit breaker closed for ${name} — will attempt restart`);
      } else {
        agentState.status = 'circuit_open';
        continue; // Skip restart
      }
    }

    // Max restart attempts check
    if (agentState.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      log.warn(`Agent ${name} exhausted ${MAX_RESTART_ATTEMPTS} restart attempts — circuit open`);
      agentState.circuitOpen = true;
      agentState.status = 'circuit_open';
      publishLifecycleEvent(name, 'circuit_open');
      continue;
    }

    // Backoff check
    const backoffMs = BASE_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, agentState.restartAttempts);
    const timeSinceLastRestart = Date.now() - agentState.lastRestartAt;
    if (timeSinceLastRestart < backoffMs) {
      continue; // Still in backoff period
    }

    // Attempt restart
    agentState.status = 'restarting';
    agentState.restartAttempts++;
    agentState.lastRestartAt = Date.now();

    log.info(`Restarting agent ${name} (attempt ${agentState.restartAttempts}/${MAX_RESTART_ATTEMPTS}, backoff=${backoffMs}ms)`);
    publishLifecycleEvent(name, 'restarting', { attempt: agentState.restartAttempts });

    try {
      await agentState.restart();
      restarted++;
      log.info(`Agent ${name} restart initiated successfully`);
      publishLifecycleEvent(name, 'restart_initiated');
    } catch (err) {
      agentState.consecutiveFailures++;
      agentState.failureTimestamps.push(Date.now());
      // Trim old timestamps
      agentState.failureTimestamps = agentState.failureTimestamps.filter(
        ts => Date.now() - ts < CIRCUIT_BREAKER_WINDOW_MS
      );

      log.error(`Agent ${name} restart failed: ${err.message}`);
      publishLifecycleEvent(name, 'restart_failed', { error: err.message });

      // Trip circuit breaker if too many recent failures
      if (agentState.failureTimestamps.length >= CIRCUIT_BREAKER_FAILURES) {
        agentState.circuitOpen = true;
        agentState.status = 'circuit_open';
        log.error(`Circuit breaker OPEN for ${name} — ${CIRCUIT_BREAKER_FAILURES} failures in ${CIRCUIT_BREAKER_WINDOW_MS / 60000}min`);
        publishLifecycleEvent(name, 'circuit_open');
      }
    }
  }

  return { checked: agentNames.length, restarted, dead };
}

function publishLifecycleEvent(agentName, event, extra = {}) {
  if (!eventMesh) return;
  try {
    eventMesh.publish('agent.lifecycle', {
      agent: agentName,
      event,
      ts: Date.now(),
      ...extra,
    }, { source: 'agent-supervisor', priority: eventMesh.PRIORITY?.HIGH });
  } catch { /* non-critical */ }
}

// ─── Health Degradation ──────────────────────────────────────────────────────

/**
 * Get system health degradation level based on dead/circuit-open agents.
 * @returns {{ level: 'healthy'|'degraded'|'critical'|'halt', deadAgents: string[], criticalDead: string[] }}
 */
function getDegradationLevel() {
  const deadAgents = [];
  const criticalDead = [];

  for (const [name, state] of agents) {
    if (state.status === 'dead' || state.status === 'circuit_open') {
      deadAgents.push(name);
      if (state.critical) criticalDead.push(name);
    }
  }

  let level = 'healthy';
  if (deadAgents.length > 0) level = 'degraded';
  if (criticalDead.length > 0) level = 'critical';
  if (criticalDead.length >= 2) level = 'halt';

  return { level, deadAgents, criticalDead };
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

function start() {
  if (running) return;
  running = true;

  // Initial check
  checkAll().then(r => {
    log.info(`Supervisor started: ${r.checked} agents monitored, ${r.dead} dead, ${r.restarted} restarted`);
  });

  checkTimer = setInterval(async () => {
    try {
      const result = await checkAll();
      if (result.dead > 0 || result.restarted > 0) {
        log.info(`Supervisor tick: ${result.dead} dead, ${result.restarted} restarted`);
      }
    } catch (err) {
      log.error(`Supervisor tick error: ${err.message}`);
    }
  }, CHECK_INTERVAL_MS);

  if (checkTimer.unref) checkTimer.unref();
}

function stop() {
  running = false;
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

function getStats() {
  const agentDetails = {};
  for (const [name, state] of agents) {
    agentDetails[name] = {
      status: state.status,
      critical: state.critical,
      restartAttempts: state.restartAttempts,
      consecutiveFailures: state.consecutiveFailures,
      circuitOpen: state.circuitOpen,
      lastRestartAt: state.lastRestartAt || null,
    };
  }

  return {
    running,
    agentCount: agents.size,
    agents: agentDetails,
    degradation: getDegradationLevel(),
    checkIntervalMs: CHECK_INTERVAL_MS,
    maxRestartAttempts: MAX_RESTART_ATTEMPTS,
  };
}

module.exports = {
  register,
  unregister,
  checkAll,
  getDegradationLevel,
  start,
  stop,
  getStats,
};
