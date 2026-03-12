#!/usr/bin/env node
/**
 * vm-failover.js – Secondary VM failover monitor
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Detects when the primary Oracle Cloud VM goes down and alerts/activates
 * a secondary instance. Designed to run on a cron or systemd timer.
 *
 * Env vars:
 *   VM_FAILOVER_ENABLED   — 'true' to enable (default: 'false')
 *   VM_PRIMARY_URL        — health endpoint of primary VM (required)
 *   VM_SECONDARY_URL      — health endpoint of secondary VM (optional)
 *   VM_CHECK_INTERVAL_SEC — seconds between checks (default: 60)
 *   VM_FAILURE_THRESHOLD  — consecutive failures before failover (default: 3)
 *   VM_RECOVERY_THRESHOLD — consecutive successes before fallback (default: 2)
 *   ALERT_WEBHOOK_URL     — Discord webhook for alerts
 *
 * State file: data/vm-failover-state.json
 * Active VM file: data/active-vm.json
 */

'use strict';

const path = require('path');
const crypto = require('crypto');

// ─── Resilient I/O ──────────────────────────────────────────────────────────
let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

// ─── Agent Signal Bus ───────────────────────────────────────────────────────
let signalBus;
try { signalBus = require('../lib/agent-signal-bus'); } catch { signalBus = null; }

// ─── Structured Logger ──────────────────────────────────────────────────────
let log;
try {
  const { createLogger } = require('../lib/logger');
  log = createLogger('vm-failover');
} catch {
  log = {
    info:  (msg, d) => console.log(`[vm-failover] ${msg}`, d || ''),
    warn:  (msg, d) => console.warn(`[vm-failover] ${msg}`, d || ''),
    error: (msg, d) => console.error(`[vm-failover] ${msg}`, d || ''),
    debug: (msg, d) => {},
  };
}

// ─── Configuration ──────────────────────────────────────────────────────────

const VM_FAILOVER_ENABLED   = String(process.env.VM_FAILOVER_ENABLED || 'false').toLowerCase() === 'true';
const VM_PRIMARY_URL        = (process.env.VM_PRIMARY_URL || '').trim();
const VM_SECONDARY_URL      = (process.env.VM_SECONDARY_URL || '').trim();
const VM_CHECK_INTERVAL_SEC = Math.min(3600, Math.max(10, parseInt(process.env.VM_CHECK_INTERVAL_SEC || '60', 10)));
const VM_FAILURE_THRESHOLD  = Math.min(100, Math.max(1, parseInt(process.env.VM_FAILURE_THRESHOLD || '3', 10)));
const VM_RECOVERY_THRESHOLD = Math.min(100, Math.max(1, parseInt(process.env.VM_RECOVERY_THRESHOLD || '2', 10)));
const ALERT_WEBHOOK_URL     = (process.env.ALERT_WEBHOOK_URL || '').trim();
const HEALTH_CHECK_TIMEOUT  = 10000; // 10 seconds

const STATE_FILE     = path.resolve(process.cwd(), 'data/vm-failover-state.json');
const ACTIVE_VM_FILE = path.resolve(process.cwd(), 'data/active-vm.json');

// Minimum interval between Discord alerts (5 minutes) to avoid spam
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

// ─── State Machine States ───────────────────────────────────────────────────

const States = Object.freeze({
  PRIMARY_ACTIVE:      'PRIMARY_ACTIVE',
  PRIMARY_DEGRADED:    'PRIMARY_DEGRADED',
  FAILOVER_ACTIVE:     'FAILOVER_ACTIVE',
  FAILOVER_RECOVERING: 'FAILOVER_RECOVERING',
});

// ─── Default State ──────────────────────────────────────────────────────────

function createDefaultState() {
  return {
    status: States.PRIMARY_ACTIVE,
    primaryHealth: {
      consecutiveFailures:  0,
      consecutiveSuccesses: 0,
      lastCheckAt:          0,
      lastSuccessAt:        0,
      lastFailAt:           0,
      lastError:            null,
    },
    secondaryHealth: {
      consecutiveFailures:  0,
      consecutiveSuccesses: 0,
      lastCheckAt:          0,
      lastSuccessAt:        0,
      lastFailAt:           0,
      lastError:            null,
    },
    failoverHistory: [],
    lastAlertAt: 0,
  };
}

// ─── State I/O ──────────────────────────────────────────────────────────────

function loadState() {
  if (rio) {
    return rio.readJsonSafe(STATE_FILE, { fallback: createDefaultState() });
  }
  const fs = require('fs');
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (err) {
    log.warn('Failed to read state file, using defaults', { error: err.message });
  }
  return createDefaultState();
}

function saveState(state) {
  if (rio) {
    rio.writeJsonAtomic(STATE_FILE, state);
    return;
  }
  const fs = require('fs');
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = STATE_FILE + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function writeActiveVm(activeVm, reason) {
  const data = {
    activeVm,
    since: new Date().toISOString(),
    reason,
    updatedAt: Date.now(),
  };

  if (rio) {
    rio.writeJsonAtomic(ACTIVE_VM_FILE, data);
    return;
  }
  const fs = require('fs');
  fs.mkdirSync(path.dirname(ACTIVE_VM_FILE), { recursive: true });
  const tmp = ACTIVE_VM_FILE + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, ACTIVE_VM_FILE);
}

// ─── Health Check ───────────────────────────────────────────────────────────

/**
 * Ping a VM health endpoint. Expects HTTP 200 with JSON { healthy: true }.
 * @param {string} url — health endpoint URL
 * @returns {Promise<{ ok: boolean, latencyMs: number, error: string|null }>}
 */
async function checkHealth(url) {
  if (!url) return { ok: false, latencyMs: 0, error: 'No URL configured' };

  const start = Date.now();
  try {
    const fetchFn = rio ? rio.fetchSafe : fetchWithTimeout;
    const res = await fetchFn(url, {}, HEALTH_CHECK_TIMEOUT);
    const latencyMs = Date.now() - start;

    if (res.status !== 200) {
      return { ok: false, latencyMs, error: `HTTP ${res.status}` };
    }

    let body;
    try {
      const text = await res.text();
      body = text ? JSON.parse(text) : {};
    } catch (parseErr) {
      return { ok: false, latencyMs, error: `Invalid JSON: ${parseErr.message}` };
    }

    if (!body.healthy) {
      return { ok: false, latencyMs, error: 'healthy !== true' };
    }

    return { ok: true, latencyMs, error: null };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const errorMsg = err.name === 'AbortError' ? 'Timeout' : (err.message || String(err));
    return { ok: false, latencyMs, error: errorMsg };
  }
}

/**
 * Minimal fetch with timeout fallback when resilient-io is unavailable.
 */
async function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Discord Alerts ─────────────────────────────────────────────────────────

/**
 * Post an alert message to Discord webhook.
 * @param {string} message — message content
 * @param {object} state — current state (for cooldown check)
 * @returns {Promise<boolean>} — whether the alert was sent
 */
async function sendDiscordAlert(message, state) {
  if (!ALERT_WEBHOOK_URL) {
    log.debug('No ALERT_WEBHOOK_URL configured, skipping Discord alert');
    return false;
  }

  // Cooldown check
  const now = Date.now();
  if (state.lastAlertAt && (now - state.lastAlertAt) < ALERT_COOLDOWN_MS) {
    log.debug('Alert cooldown active, skipping', {
      lastAlertAt: state.lastAlertAt,
      cooldownRemainingSec: Math.ceil((ALERT_COOLDOWN_MS - (now - state.lastAlertAt)) / 1000),
    });
    return false;
  }

  try {
    const fetchFn = rio ? rio.fetchSafe : fetchWithTimeout;
    const res = await fetchFn(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    }, 10000);

    if (res.status >= 200 && res.status < 300) {
      state.lastAlertAt = now;
      log.info('Discord alert sent', { status: res.status });
      return true;
    }

    log.warn('Discord alert failed', { status: res.status });
    return false;
  } catch (err) {
    log.error('Discord alert error', { error: err.message });
    return false;
  }
}

// ─── Signal Bus Publishing ──────────────────────────────────────────────────

function publishInfraAlert(payload) {
  if (!signalBus) return;
  try {
    signalBus.publish({
      type: 'infra_alert',
      source: 'vm-failover',
      confidence: 1.0,
      payload,
      ttlMs: 4 * 60 * 60 * 1000, // 4 hours
    });
    log.debug('Published infra_alert to signal bus');
  } catch (err) {
    log.warn('Failed to publish to signal bus', { error: err.message });
  }
}

// ─── State Transitions ─────────────────────────────────────────────────────

function addHistoryEntry(state, from, to, reason) {
  state.failoverHistory.push({
    from,
    to,
    ts: new Date().toISOString(),
    reason,
  });

  // Cap history at 100 entries
  if (state.failoverHistory.length > 100) {
    state.failoverHistory = state.failoverHistory.slice(-100);
  }
}

/**
 * Process a primary health check result and update the state machine.
 * @param {object} state — mutable state
 * @param {{ ok: boolean, latencyMs: number, error: string|null }} result
 * @returns {Promise<{ transitioned: boolean, prevStatus: string }>}
 */
async function processHealthResult(state, result) {
  const now = Date.now();
  const prevStatus = state.status;
  const ph = state.primaryHealth;

  ph.lastCheckAt = now;

  if (result.ok) {
    ph.consecutiveSuccesses++;
    ph.consecutiveFailures = 0;
    ph.lastSuccessAt = now;
    ph.lastError = null;
  } else {
    ph.consecutiveFailures++;
    ph.consecutiveSuccesses = 0;
    ph.lastFailAt = now;
    ph.lastError = result.error;
  }

  let transitioned = false;

  switch (state.status) {
    case States.PRIMARY_ACTIVE: {
      if (ph.consecutiveFailures >= VM_FAILURE_THRESHOLD) {
        state.status = States.PRIMARY_DEGRADED;
        addHistoryEntry(state, prevStatus, state.status, `${ph.consecutiveFailures} consecutive failures: ${result.error}`);
        transitioned = true;
        log.warn('Primary VM degraded', {
          failures: ph.consecutiveFailures,
          threshold: VM_FAILURE_THRESHOLD,
          lastError: result.error,
        });
      }
      break;
    }

    case States.PRIMARY_DEGRADED: {
      if (result.ok && ph.consecutiveSuccesses >= VM_RECOVERY_THRESHOLD) {
        // Recovered before full failover
        state.status = States.PRIMARY_ACTIVE;
        addHistoryEntry(state, prevStatus, state.status, 'Primary recovered during degraded state');
        transitioned = true;
        log.info('Primary VM recovered from degraded state');
      } else if (ph.consecutiveFailures >= VM_FAILURE_THRESHOLD) {
        // Escalate to full failover
        state.status = States.FAILOVER_ACTIVE;
        addHistoryEntry(state, prevStatus, state.status, `Failover triggered after ${ph.consecutiveFailures} consecutive failures: ${result.error}`);
        transitioned = true;
        log.error('Failover activated', {
          failures: ph.consecutiveFailures,
          lastError: result.error,
        });

        // ── Failover actions ────────────────────────────────────────
        const alertMsg = [
          '\u{1F6A8} **VM FAILOVER ALERT**',
          `Primary VM at \`${VM_PRIMARY_URL}\` is unreachable.`,
          `Consecutive failures: **${ph.consecutiveFailures}**`,
          `Last error: ${result.error}`,
          `Status: **${state.status}**`,
          VM_SECONDARY_URL ? `Secondary VM: \`${VM_SECONDARY_URL}\`` : 'No secondary VM configured.',
          `Time: ${new Date().toISOString()}`,
        ].join('\n');

        await sendDiscordAlert(alertMsg, state);

        publishInfraAlert({
          event: 'failover_activated',
          primaryUrl: VM_PRIMARY_URL,
          secondaryUrl: VM_SECONDARY_URL || null,
          consecutiveFailures: ph.consecutiveFailures,
          lastError: result.error,
        });

        // Check secondary health if configured
        if (VM_SECONDARY_URL) {
          const secResult = await checkHealth(VM_SECONDARY_URL);
          const sh = state.secondaryHealth;
          sh.lastCheckAt = now;
          if (secResult.ok) {
            sh.consecutiveSuccesses++;
            sh.consecutiveFailures = 0;
            sh.lastSuccessAt = now;
            sh.lastError = null;
            log.info('Secondary VM is healthy', { latencyMs: secResult.latencyMs });
          } else {
            sh.consecutiveFailures++;
            sh.consecutiveSuccesses = 0;
            sh.lastFailAt = now;
            sh.lastError = secResult.error;
            log.error('Secondary VM is also unhealthy', { error: secResult.error });
          }
        }

        // Write active-vm marker
        writeActiveVm(
          VM_SECONDARY_URL ? 'secondary' : 'primary',
          `Failover: primary unreachable after ${ph.consecutiveFailures} failures`
        );
      }
      break;
    }

    case States.FAILOVER_ACTIVE: {
      if (result.ok) {
        state.status = States.FAILOVER_RECOVERING;
        addHistoryEntry(state, prevStatus, state.status, 'Primary showing signs of recovery');
        transitioned = true;
        log.info('Primary VM responding again, entering recovery');
      }
      break;
    }

    case States.FAILOVER_RECOVERING: {
      if (!result.ok) {
        // Recovery failed, go back to failover
        state.status = States.FAILOVER_ACTIVE;
        addHistoryEntry(state, prevStatus, state.status, `Recovery interrupted: ${result.error}`);
        transitioned = true;
        log.warn('Recovery interrupted, back to failover', { error: result.error });
      } else if (ph.consecutiveSuccesses >= VM_RECOVERY_THRESHOLD) {
        // Fully recovered
        state.status = States.PRIMARY_ACTIVE;
        addHistoryEntry(state, prevStatus, state.status,
          `Primary recovered after ${ph.consecutiveSuccesses} consecutive successes`);
        transitioned = true;
        log.info('Primary VM fully recovered, returning to primary');

        // ── Recovery actions ────────────────────────────────────────
        const recoveryMsg = [
          '\u{2705} **VM RECOVERY**',
          `Primary VM at \`${VM_PRIMARY_URL}\` is back online.`,
          `Consecutive successes: **${ph.consecutiveSuccesses}**`,
          `Status: **${state.status}**`,
          `Time: ${new Date().toISOString()}`,
        ].join('\n');

        await sendDiscordAlert(recoveryMsg, state);

        publishInfraAlert({
          event: 'primary_recovered',
          primaryUrl: VM_PRIMARY_URL,
          consecutiveSuccesses: ph.consecutiveSuccesses,
        });

        writeActiveVm('primary', 'Primary recovered');
      }
      break;
    }

    default: {
      // Unknown state — reset to PRIMARY_ACTIVE
      log.warn('Unknown state, resetting', { status: state.status });
      state.status = States.PRIMARY_ACTIVE;
      transitioned = true;
    }
  }

  return { transitioned, prevStatus };
}

// ─── Check Interval Guard ───────────────────────────────────────────────────

/**
 * Returns true if enough time has elapsed since the last check.
 */
function shouldRunCheck(state) {
  const lastCheck = state.primaryHealth.lastCheckAt || 0;
  const elapsedSec = (Date.now() - lastCheck) / 1000;
  return elapsedSec >= VM_CHECK_INTERVAL_SEC;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // ── Gate: enabled? ──────────────────────────────────────────────────────
  if (!VM_FAILOVER_ENABLED) {
    const result = {
      ok: true,
      status: 'disabled',
      message: 'VM failover monitoring is disabled (VM_FAILOVER_ENABLED != true)',
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  // ── Gate: primary URL configured? ───────────────────────────────────────
  if (!VM_PRIMARY_URL) {
    const result = {
      ok: false,
      status: 'error',
      message: 'VM_PRIMARY_URL is required but not set',
    };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return result;
  }

  // ── Load state ──────────────────────────────────────────────────────────
  const state = loadState();

  // ── Interval guard ──────────────────────────────────────────────────────
  if (!shouldRunCheck(state)) {
    const elapsedSec = Math.round((Date.now() - (state.primaryHealth.lastCheckAt || 0)) / 1000);
    const result = {
      ok: true,
      status: state.status,
      message: `Skipped: last check ${elapsedSec}s ago (interval: ${VM_CHECK_INTERVAL_SEC}s)`,
      state: sanitizeStateForOutput(state),
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  // ── Health check ────────────────────────────────────────────────────────
  log.info('Checking primary VM health', { url: VM_PRIMARY_URL });
  const healthResult = await checkHealth(VM_PRIMARY_URL);

  log.info('Health check result', {
    ok: healthResult.ok,
    latencyMs: healthResult.latencyMs,
    error: healthResult.error,
  });

  // ── Process state machine ───────────────────────────────────────────────
  const { transitioned, prevStatus } = await processHealthResult(state, healthResult);

  if (transitioned) {
    log.info('State transition', { from: prevStatus, to: state.status });
  }

  // ── Persist state ───────────────────────────────────────────────────────
  saveState(state);

  // ── Output report ───────────────────────────────────────────────────────
  const result = {
    ok: healthResult.ok,
    status: state.status,
    primaryUrl: VM_PRIMARY_URL,
    secondaryUrl: VM_SECONDARY_URL || null,
    healthCheck: {
      healthy: healthResult.ok,
      latencyMs: healthResult.latencyMs,
      error: healthResult.error,
    },
    state: sanitizeStateForOutput(state),
    transitioned,
    prevStatus: transitioned ? prevStatus : undefined,
    checkedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Strip verbose history for compact JSON output.
 */
function sanitizeStateForOutput(state) {
  return {
    status: state.status,
    primaryHealth: state.primaryHealth,
    secondaryHealth: state.secondaryHealth,
    failoverHistoryCount: state.failoverHistory.length,
    lastTransition: state.failoverHistory.length > 0
      ? state.failoverHistory[state.failoverHistory.length - 1]
      : null,
    lastAlertAt: state.lastAlertAt,
  };
}

// ─── Run ────────────────────────────────────────────────────────────────────

main().catch((err) => {
  log.error('vm-failover crashed', { error: err.message, stack: err.stack });
  console.error(JSON.stringify({
    ok: false,
    status: 'error',
    message: err.message,
  }, null, 2));
  process.exitCode = 1;
});
