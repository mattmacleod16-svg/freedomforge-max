/**
 * Heartbeat Registry — Agent Liveness Monitoring
 * ================================================
 *
 * Provides a lightweight mechanism for agents to publish periodic heartbeats
 * and for the orchestrator to verify agent liveness before trading.
 *
 * Each heartbeat is a signal on the signal bus with type 'agent_heartbeat'.
 * The orchestrator (or any consumer) can query heartbeat freshness to determine
 * if critical agents are alive and functioning.
 *
 * Usage:
 *   const hb = require('../lib/heartbeat-registry');
 *   hb.publishHeartbeat('metrics-exporter', { metricsCount: 42 });
 *   const health = hb.checkAgentHealth(['metrics-exporter', 'watchdog-daemon']);
 *   if (!health.healthy) { // degrade trading }
 */

let signalBus;
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }
const { createLogger } = require('./logger');
const log = createLogger('heartbeat-registry');

const HEARTBEAT_TYPE = 'agent_heartbeat';
const DEFAULT_MAX_AGE_MS = Math.min(3600000, Math.max(60000, Number(process.env.HEARTBEAT_MAX_AGE_MS || 10 * 60 * 1000)));

/**
 * Publish a heartbeat for an agent.
 * @param {string} agentName - Unique agent identifier
 * @param {object} [metadata] - Additional metadata to include
 */
function publishHeartbeat(agentName, metadata = {}) {
  if (!signalBus) return null;
  return signalBus.publish({
    type: HEARTBEAT_TYPE,
    source: agentName,
    confidence: 1.0,
    payload: {
      agent: agentName,
      uptime: Math.round(process.uptime()),
      pid: process.pid,
      memMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      ...metadata,
    },
    ttlMs: DEFAULT_MAX_AGE_MS * 2,
  });
}

/**
 * Check health of required agents by verifying heartbeat freshness.
 * @param {string[]} requiredAgents - Agent names to check
 * @param {number} [maxAgeMs] - Maximum acceptable heartbeat age
 * @returns {{ healthy: boolean, agents: Object<string, { alive: boolean, lastSeen: number|null, ageMs: number|null }> }}
 */
function checkAgentHealth(requiredAgents = [], maxAgeMs = DEFAULT_MAX_AGE_MS) {
  if (!signalBus || requiredAgents.length === 0) {
    return { healthy: true, agents: {}, reason: 'no_agents_to_check' };
  }

  const results = {};
  let allHealthy = true;

  for (const agent of requiredAgents) {
    const signals = signalBus.query({
      type: HEARTBEAT_TYPE,
      source: agent,
      maxAgeMs,
    });
    const alive = signals.length > 0;
    const lastSeen = alive ? signals[0].publishedAt : null;
    const ageMs = lastSeen ? Date.now() - lastSeen : null;

    results[agent] = { alive, lastSeen, ageMs };
    if (!alive) allHealthy = false;
  }

  return { healthy: allHealthy, agents: results };
}

/**
 * Get a summary of all known agent heartbeats.
 * @returns {{ agentCount: number, agents: Object }}
 */
function getHeartbeatSummary() {
  if (!signalBus) return { agentCount: 0, agents: {} };

  const signals = signalBus.query({ type: HEARTBEAT_TYPE });
  const agents = {};
  for (const s of signals) {
    if (!agents[s.source]) {
      agents[s.source] = {
        lastSeen: s.publishedAt,
        ageMs: Date.now() - s.publishedAt,
        payload: s.payload,
      };
    }
  }
  return { agentCount: Object.keys(agents).length, agents };
}

module.exports = {
  publishHeartbeat,
  checkAgentHealth,
  getHeartbeatSummary,
  HEARTBEAT_TYPE,
  DEFAULT_MAX_AGE_MS,
};
