/**
 * Dead Man's Switch
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Autonomous position close-all watchdog. If the master orchestrator fails to
 * heartbeat within the configured timeout, this module auto-closes all open
 * positions via market orders to prevent unmonitored exposure.
 *
 * Different from kill-switch (manual) — this triggers automatically on
 * orchestrator silence.
 *
 * Deploy as: cron job, systemd timer, or integrated into the exit-manager loop.
 *
 * @module lib/dead-mans-switch
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');
const log = createLogger('dead-mans-switch');

let heartbeatRegistry, exitManager, riskManager, signalBus;
try { heartbeatRegistry = require('./heartbeat-registry'); } catch { heartbeatRegistry = null; }
try { exitManager = require('./exit-manager'); } catch { exitManager = null; }
try { riskManager = require('./risk-manager'); } catch { riskManager = null; }
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }

// ─── Configuration ────────────────────────────────────────────────────────────
const SILENCE_THRESHOLD_MS = Number(process.env.DMS_SILENCE_THRESHOLD_MS || 600000); // 10 min
const CHECK_INTERVAL_MS = Number(process.env.DMS_CHECK_INTERVAL_MS || 60000); // Check every 1 min
const REQUIRED_AGENTS = (process.env.DMS_REQUIRED_AGENTS || 'master-orchestrator').split(',').map(s => s.trim());
const AUTO_CLOSE_ENABLED = process.env.DMS_AUTO_CLOSE !== 'false';
const COOLDOWN_AFTER_TRIGGER_MS = Number(process.env.DMS_COOLDOWN_MS || 1800000); // 30min cooldown after trigger

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'dead-mans-switch-state.json');

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  lastCheckAt: 0,
  lastTriggeredAt: 0,
  triggerCount: 0,
  status: 'armed', // armed | triggered | cooldown | disabled
  lastAgentStatus: {},
  positionsClosedOnTrigger: 0,
};

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
    }
  } catch { /* fresh state */ }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    if (rio) rio.writeJsonAtomic(STATE_FILE, state);
    else fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch { /* best effort */ }
}

loadState();

// ─── Core Check Logic ─────────────────────────────────────────────────────────

/**
 * Check if all required agents are alive. If not, trigger position closure.
 *
 * @returns {{
 *   triggered: boolean,
 *   status: string,
 *   silentAgents: string[],
 *   positionsClosed: number,
 *   reason: string
 * }}
 */
async function check() {
  const now = Date.now();
  state.lastCheckAt = now;

  // Skip if in cooldown
  if (state.status === 'cooldown' && (now - state.lastTriggeredAt) < COOLDOWN_AFTER_TRIGGER_MS) {
    const remaining = Math.round((COOLDOWN_AFTER_TRIGGER_MS - (now - state.lastTriggeredAt)) / 60000);
    return { triggered: false, status: 'cooldown', silentAgents: [], positionsClosed: 0, reason: `cooldown: ${remaining}min remaining` };
  }

  if (state.status === 'cooldown') {
    state.status = 'armed'; // Cooldown expired
    log.info('dead man\'s switch re-armed after cooldown');
  }

  if (state.status === 'disabled') {
    return { triggered: false, status: 'disabled', silentAgents: [], positionsClosed: 0, reason: 'disabled' };
  }

  // Check agent heartbeats
  const silentAgents = [];
  const agentStatus = {};

  if (heartbeatRegistry && typeof heartbeatRegistry.checkAgentHealth === 'function') {
    try {
      const health = heartbeatRegistry.checkAgentHealth(REQUIRED_AGENTS, SILENCE_THRESHOLD_MS);
      for (const [agent, info] of Object.entries(health.agents || {})) {
        agentStatus[agent] = {
          alive: info.alive,
          lastSeen: info.lastSeen,
          ageMs: info.ageMs,
          silent: !info.alive,
        };
        if (!info.alive) silentAgents.push(agent);
      }
    } catch (err) {
      log.warn('heartbeat check failed', { error: err?.message });
      // If heartbeat registry itself is broken, check signal bus directly
      if (signalBus) {
        try {
          const signals = signalBus.query({ type: 'agent_heartbeat', maxAgeMs: SILENCE_THRESHOLD_MS });
          const activeAgents = new Set(signals.map(s => s.source));
          for (const agent of REQUIRED_AGENTS) {
            const alive = activeAgents.has(agent);
            agentStatus[agent] = { alive, silent: !alive };
            if (!alive) silentAgents.push(agent);
          }
        } catch { /* all agents assumed silent */ 
          for (const agent of REQUIRED_AGENTS) {
            agentStatus[agent] = { alive: false, silent: true };
            silentAgents.push(agent);
          }
        }
      }
    }
  } else {
    // No heartbeat registry — check for orchestrator state file freshness
    try {
      const orchStatePath = path.join(DATA_DIR, 'orchestrator-state.json');
      if (fs.existsSync(orchStatePath)) {
        const orchState = JSON.parse(fs.readFileSync(orchStatePath, 'utf8'));
        const lastRun = orchState.lastRunAt || 0;
        if (now - lastRun > SILENCE_THRESHOLD_MS) {
          silentAgents.push('master-orchestrator');
          agentStatus['master-orchestrator'] = { alive: false, silent: true, lastSeen: lastRun };
        }
      } else {
        silentAgents.push('master-orchestrator');
      }
    } catch {
      silentAgents.push('master-orchestrator');
    }
  }

  state.lastAgentStatus = agentStatus;

  // All agents alive — no trigger
  if (silentAgents.length === 0) {
    saveState();
    return { triggered: false, status: 'armed', silentAgents: [], positionsClosed: 0, reason: 'all agents healthy' };
  }

  // ══ TRIGGER: Close all positions ══════════════════════════════════════════
  log.error('DEAD MAN\'S SWITCH TRIGGERED', {
    silentAgents,
    thresholdMs: SILENCE_THRESHOLD_MS,
    autoClose: AUTO_CLOSE_ENABLED,
  });

  state.status = 'triggered';
  state.lastTriggeredAt = now;
  state.triggerCount++;

  // Publish alert
  if (signalBus) {
    try {
      signalBus.publish({
        type: 'risk_alert',
        source: 'dead-mans-switch',
        confidence: 1.0,
        payload: {
          severity: 'critical',
          message: `Dead man's switch triggered: ${silentAgents.join(', ')} silent for ${(SILENCE_THRESHOLD_MS / 60000).toFixed(0)}min`,
          silentAgents,
          action: AUTO_CLOSE_ENABLED ? 'closing_all_positions' : 'alert_only',
        },
        ttlMs: 3600000, // 1 hour
      });
    } catch { /* best effort */ }
  }

  let positionsClosed = 0;

  if (AUTO_CLOSE_ENABLED) {
    // 1. Activate kill switch to prevent new trades
    if (riskManager && typeof riskManager.activateKillSwitch === 'function') {
      try {
        riskManager.activateKillSwitch('dead_mans_switch_auto');
        log.info('kill switch activated by dead man\'s switch');
      } catch (err) {
        log.error('failed to activate kill switch', { error: err?.message });
      }
    }

    // 2. Close all open positions
    if (exitManager && typeof exitManager.checkExits === 'function') {
      try {
        // Force all positions to exit by temporarily lowering thresholds
        const exitResult = await exitManager.checkExits();
        positionsClosed = exitResult.exited || 0;
        log.info('emergency position closure', { positionsClosed, checked: exitResult.checked });
      } catch (err) {
        log.error('failed to close positions', { error: err?.message });
      }
    }

    // 3. Write to kill-switch file directly as backup
    try {
      const ksPath = path.join(DATA_DIR, 'kill-switch.json');
      const ksData = fs.existsSync(ksPath) ? JSON.parse(fs.readFileSync(ksPath, 'utf8')) : {};
      ksData.active = true;
      ksData.activatedBy = 'dead-mans-switch';
      ksData.activatedAt = new Date().toISOString();
      ksData.reason = `Silent agents: ${silentAgents.join(', ')}`;
      if (rio) rio.writeJsonAtomic(ksPath, ksData);
      else fs.writeFileSync(ksPath, JSON.stringify(ksData, null, 2));
    } catch { /* best effort */ }
  }

  state.positionsClosedOnTrigger = positionsClosed;
  state.status = 'cooldown';
  saveState();

  return {
    triggered: true,
    status: 'triggered',
    silentAgents,
    positionsClosed,
    reason: `${silentAgents.join(', ')} silent > ${(SILENCE_THRESHOLD_MS / 60000).toFixed(0)}min`,
  };
}

/**
 * Get current dead man's switch status.
 * @returns {object}
 */
function getStatus() {
  return {
    ...state,
    config: {
      silenceThresholdMs: SILENCE_THRESHOLD_MS,
      checkIntervalMs: CHECK_INTERVAL_MS,
      requiredAgents: REQUIRED_AGENTS,
      autoCloseEnabled: AUTO_CLOSE_ENABLED,
      cooldownMs: COOLDOWN_AFTER_TRIGGER_MS,
    },
  };
}

/**
 * Disable the switch (e.g., during maintenance).
 */
function disable() {
  state.status = 'disabled';
  saveState();
  log.info('dead man\'s switch disabled');
}

/**
 * Re-arm the switch.
 */
function arm() {
  state.status = 'armed';
  saveState();
  log.info('dead man\'s switch armed');
}

// ─── Periodic check loop ──────────────────────────────────────────────────────
let _checkTimer = null;

function startLoop() {
  if (_checkTimer) return;
  _checkTimer = setInterval(() => {
    check().catch(err => {
      log.error('dead man\'s switch check error', { error: err?.message || String(err) });
    });
  }, CHECK_INTERVAL_MS);
  if (_checkTimer.unref) _checkTimer.unref();
  log.info('dead man\'s switch loop started', { intervalMs: CHECK_INTERVAL_MS });
}

function stopLoop() {
  if (_checkTimer) { clearInterval(_checkTimer); _checkTimer = null; }
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  check,
  getStatus,
  disable,
  arm,
  startLoop,
  stopLoop,
};
