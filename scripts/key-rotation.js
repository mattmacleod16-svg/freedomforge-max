#!/usr/bin/env node
/**
 * key-rotation.js – API key rotation tracker & health checker
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Monitors all API keys in the FreedomForge system for age, validity,
 * and rotation compliance. Alerts via Discord when rotation is due.
 *
 * Env vars:
 *   KEY_ROTATION_ENABLED — 'true' to enable (default: 'false')
 *   KEY_MAX_AGE_DAYS     — alert when keys are older than this (default: 90)
 *   KEY_WARNING_DAYS     — warn before expiry (default: 75)
 *   ALERT_WEBHOOK_URL    — Discord webhook for alerts
 *
 * State file: data/key-rotation-state.json
 */

'use strict';

const path = require('path');
const crypto = require('crypto');

// ─── Resilient I/O ──────────────────────────────────────────────────────────
let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

// ─── Structured Logger ──────────────────────────────────────────────────────
let log;
try {
  const { createLogger } = require('../lib/logger');
  log = createLogger('key-rotation');
} catch {
  log = {
    info:  (msg, d) => console.log(`[key-rotation] ${msg}`, d || ''),
    warn:  (msg, d) => console.warn(`[key-rotation] ${msg}`, d || ''),
    error: (msg, d) => console.error(`[key-rotation] ${msg}`, d || ''),
    debug: (msg, d) => {},
  };
}

// ─── Configuration ──────────────────────────────────────────────────────────

const KEY_ROTATION_ENABLED = String(process.env.KEY_ROTATION_ENABLED || 'false').toLowerCase() === 'true';
const KEY_MAX_AGE_DAYS     = Math.min(365, Math.max(1, parseInt(process.env.KEY_MAX_AGE_DAYS || '90', 10)));
const KEY_WARNING_DAYS     = Math.min(180, Math.max(1, parseInt(process.env.KEY_WARNING_DAYS || '75', 10)));
const ALERT_WEBHOOK_URL    = (process.env.ALERT_WEBHOOK_URL || '').trim();
const STATE_FILE           = path.resolve(process.cwd(), 'data/key-rotation-state.json');
const VALIDATION_TIMEOUT   = 10000; // 10 seconds
const DAY_MS               = 24 * 60 * 60 * 1000;

// Minimum interval between Discord alerts (1 hour) to avoid spam
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

// ─── Key Registry ───────────────────────────────────────────────────────────

const KEY_REGISTRY = [
  { name: 'COINBASE_API_KEY',       envVar: 'COINBASE_API_KEY',       service: 'Coinbase',    critical: true  },
  { name: 'KRAKEN_API_KEY',         envVar: 'KRAKEN_API_KEY',         service: 'Kraken',      critical: true  },
  { name: 'ALPACA_API_KEY',         envVar: 'ALPACA_API_KEY',         service: 'Alpaca',      critical: true  },
  { name: 'ALCHEMY_API_KEY',        envVar: 'ALCHEMY_API_KEY',        service: 'Alchemy',     critical: true  },
  { name: 'GROK_API_KEY',           envVar: 'GROK_API_KEY',           service: 'Grok',        critical: false },
  { name: 'OPENAI_API_KEY',         envVar: 'OPENAI_API_KEY',         service: 'OpenAI',      critical: false },
  { name: 'ANTHROPIC_API_KEY',      envVar: 'ANTHROPIC_API_KEY',      service: 'Anthropic',   critical: false },
  { name: 'TAVILY_API_KEY',         envVar: 'TAVILY_API_KEY',         service: 'Tavily',      critical: false },
  { name: 'POLYMARKET_PRIVATE_KEY', envVar: 'POLYMARKET_PRIVATE_KEY', service: 'Polymarket',  critical: true  },
];

// ─── Default State ──────────────────────────────────────────────────────────

function createDefaultState() {
  return {
    keys: {},
    lastAlertAt: 0,
    lastRunAt: 0,
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

// ─── Fingerprinting ─────────────────────────────────────────────────────────

/**
 * Compute a short SHA-256 fingerprint of a key value.
 * This detects key rotation without storing the actual key.
 * @param {string} keyValue — the raw API key
 * @returns {string} — first 8 hex characters of SHA-256
 */
function fingerprint(keyValue) {
  return crypto.createHash('sha256').update(keyValue).digest('hex').slice(0, 8);
}

// ─── HTTP Helpers ───────────────────────────────────────────────────────────

/**
 * Fetch with timeout, preferring resilient-io when available.
 */
async function safeFetch(url, opts = {}) {
  if (rio) return rio.fetchSafe(url, opts, VALIDATION_TIMEOUT);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Per-Service Validation ─────────────────────────────────────────────────

/**
 * Validate that a key/service is reachable and working.
 * Only critical keys are validated via network calls.
 * @param {object} keyDef — registry entry
 * @returns {Promise<{ valid: boolean|null, error: string|null }>}
 */
async function validateKey(keyDef) {
  if (!keyDef.critical) {
    return { valid: null, error: null }; // skip non-critical
  }

  try {
    switch (keyDef.service) {
      case 'Coinbase': {
        const res = await safeFetch('https://api.exchange.coinbase.com/time');
        if (res.status === 200) return { valid: true, error: null };
        return { valid: false, error: `Coinbase time endpoint returned HTTP ${res.status}` };
      }

      case 'Kraken': {
        const res = await safeFetch('https://api.kraken.com/0/public/Time');
        if (res.status === 200) return { valid: true, error: null };
        return { valid: false, error: `Kraken time endpoint returned HTTP ${res.status}` };
      }

      case 'Alpaca': {
        const apiKey = process.env.ALPACA_API_KEY || '';
        const apiSecret = process.env.ALPACA_API_SECRET || '';
        if (!apiKey || !apiSecret) {
          return { valid: null, error: 'Missing ALPACA_API_KEY or ALPACA_API_SECRET' };
        }
        const res = await safeFetch('https://paper-api.alpaca.markets/v2/clock', {
          headers: {
            'APCA-API-KEY-ID': apiKey,
            'APCA-API-SECRET-KEY': apiSecret,
          },
        });
        if (res.status === 200) return { valid: true, error: null };
        if (res.status === 401 || res.status === 403) {
          return { valid: false, error: `Alpaca auth failed: HTTP ${res.status}` };
        }
        return { valid: false, error: `Alpaca returned HTTP ${res.status}` };
      }

      case 'Alchemy': {
        const apiKey = process.env.ALCHEMY_API_KEY || '';
        if (!apiKey) return { valid: null, error: 'Missing ALCHEMY_API_KEY' };
        const rpcUrl = `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;
        const res = await safeFetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_blockNumber',
            params: [],
            id: 1,
          }),
        });
        if (res.status === 200) {
          try {
            const text = await res.text();
            const body = text ? JSON.parse(text) : {};
            if (body.result) return { valid: true, error: null };
            if (body.error) return { valid: false, error: `Alchemy RPC error: ${body.error.message || JSON.stringify(body.error)}` };
          } catch {
            return { valid: false, error: 'Alchemy returned invalid JSON' };
          }
        }
        return { valid: false, error: `Alchemy returned HTTP ${res.status}` };
      }

      case 'Polymarket': {
        // No public validation endpoint for Polymarket private keys.
        // Just confirm the env var is set and looks like a valid hex private key.
        const pk = process.env.POLYMARKET_PRIVATE_KEY || '';
        if (/^(0x)?[0-9a-fA-F]{64}$/.test(pk)) {
          return { valid: true, error: null };
        }
        return { valid: false, error: 'Does not appear to be a valid hex private key' };
      }

      default:
        return { valid: null, error: null };
    }
  } catch (err) {
    const errorMsg = err.name === 'AbortError' ? 'Timeout' : (err.message || String(err));
    return { valid: false, error: errorMsg };
  }
}

// ─── Key Status Computation ─────────────────────────────────────────────────

/**
 * Status levels for key age assessment.
 */
const KeyStatus = Object.freeze({
  OK:       'OK',
  WARNING:  'WARNING',
  EXPIRED:  'EXPIRED',
  MISSING:  'MISSING',
  UNKNOWN:  'UNKNOWN',
});

/**
 * Assess a single key's rotation status.
 * @param {object} keyDef — registry entry
 * @param {object} state — full state object
 * @returns {Promise<object>} — key report
 */
async function assessKey(keyDef, state) {
  const now = Date.now();
  const envValue = (process.env[keyDef.envVar] || '').trim();

  // Initialize state entry if missing
  if (!state.keys[keyDef.name]) {
    state.keys[keyDef.name] = {
      fingerprint: null,
      lastRotatedAt: 0,
      lastCheckedAt: 0,
      valid: null,
    };
  }
  const keyState = state.keys[keyDef.name];

  // ── Missing key ─────────────────────────────────────────────────────────
  if (!envValue) {
    keyState.lastCheckedAt = now;
    return {
      name: keyDef.name,
      service: keyDef.service,
      critical: keyDef.critical,
      status: KeyStatus.MISSING,
      set: false,
      ageDays: null,
      daysUntilExpiry: null,
      fingerprint: null,
      valid: null,
      error: null,
      message: 'NOT SET',
    };
  }

  // ── Compute fingerprint & detect rotation ───────────────────────────────
  const currentFingerprint = fingerprint(envValue);

  if (keyState.fingerprint && keyState.fingerprint !== currentFingerprint) {
    // Key has been rotated since last check
    log.info('Key rotation detected', {
      key: keyDef.name,
      oldFingerprint: keyState.fingerprint,
      newFingerprint: currentFingerprint,
    });
    keyState.lastRotatedAt = now;
  } else if (!keyState.fingerprint) {
    // First time seeing this key — record but don't set lastRotatedAt if already set
    if (!keyState.lastRotatedAt) {
      keyState.lastRotatedAt = now;
    }
  }

  keyState.fingerprint = currentFingerprint;
  keyState.lastCheckedAt = now;

  // ── Compute age ─────────────────────────────────────────────────────────
  const ageDays = Math.floor((now - keyState.lastRotatedAt) / DAY_MS);
  const daysUntilExpiry = KEY_MAX_AGE_DAYS - ageDays;

  // ── Determine status ────────────────────────────────────────────────────
  let status;
  let message;

  if (ageDays >= KEY_MAX_AGE_DAYS) {
    status = KeyStatus.EXPIRED;
    message = `${ageDays} days old (EXPIRED - rotate immediately!)`;
  } else if (ageDays >= KEY_WARNING_DAYS) {
    status = KeyStatus.WARNING;
    message = `${ageDays} days old (WARNING - rotate within ${daysUntilExpiry} days)`;
  } else {
    status = KeyStatus.OK;
    message = `${ageDays} days old (OK)`;
  }

  // ── Validate critical keys ──────────────────────────────────────────────
  let validationResult = { valid: null, error: null };
  if (keyDef.critical) {
    validationResult = await validateKey(keyDef);
    keyState.valid = validationResult.valid;
  }

  return {
    name: keyDef.name,
    service: keyDef.service,
    critical: keyDef.critical,
    status,
    set: true,
    ageDays,
    daysUntilExpiry,
    fingerprint: currentFingerprint,
    valid: validationResult.valid,
    error: validationResult.error,
    message,
  };
}

// ─── Discord Alert ──────────────────────────────────────────────────────────

/**
 * Build and send a Discord alert summarizing key statuses.
 * @param {Array<object>} reports — per-key reports
 * @param {object} state — mutable state for cooldown tracking
 * @returns {Promise<boolean>}
 */
async function sendDiscordAlert(reports, state) {
  if (!ALERT_WEBHOOK_URL) {
    log.debug('No ALERT_WEBHOOK_URL configured, skipping Discord alert');
    return false;
  }

  // Only alert if there are warnings, expirations, or missing critical keys
  const alertable = reports.filter(r =>
    r.status === KeyStatus.EXPIRED ||
    r.status === KeyStatus.WARNING ||
    (r.status === KeyStatus.MISSING && r.critical) ||
    (r.valid === false && r.critical)
  );

  if (alertable.length === 0) {
    log.debug('No alertable keys, skipping Discord notification');
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

  // Build message
  const lines = ['\u{1F511} **KEY ROTATION ALERT**', ''];

  for (const r of reports) {
    let statusIcon;
    switch (r.status) {
      case KeyStatus.OK:       statusIcon = '\u{2705}'; break;
      case KeyStatus.WARNING:  statusIcon = '\u{26A0}\u{FE0F}'; break;
      case KeyStatus.EXPIRED:  statusIcon = '\u{1F534}'; break;
      case KeyStatus.MISSING:  statusIcon = '\u{2753}'; break;
      default:                 statusIcon = '\u{2B1C}'; break;
    }

    let line = `${statusIcon} **${r.service}** (${r.name}): ${r.message}`;

    if (r.valid === false && r.error) {
      line += ` | Validation FAILED: ${r.error}`;
    }

    lines.push(`- ${line}`);
  }

  lines.push('');
  lines.push(`Time: ${new Date().toISOString()}`);

  const content = lines.join('\n');

  try {
    const fetchFn = rio ? rio.fetchSafe : safeFetchFallback;
    const res = await fetchFn(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }, 10000);

    if (res.status >= 200 && res.status < 300) {
      state.lastAlertAt = now;
      log.info('Discord alert sent', { status: res.status, alertableKeys: alertable.length });
      return true;
    }

    log.warn('Discord alert failed', { status: res.status });
    return false;
  } catch (err) {
    log.error('Discord alert error', { error: err.message });
    return false;
  }
}

/**
 * Minimal fetch with timeout fallback when resilient-io is unavailable.
 */
async function safeFetchFallback(url, opts = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // ── Gate: enabled? ──────────────────────────────────────────────────────
  if (!KEY_ROTATION_ENABLED) {
    const result = {
      ok: true,
      status: 'disabled',
      message: 'Key rotation tracking is disabled (KEY_ROTATION_ENABLED != true)',
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  log.info('Starting key rotation check', {
    maxAgeDays: KEY_MAX_AGE_DAYS,
    warningDays: KEY_WARNING_DAYS,
    keysTracked: KEY_REGISTRY.length,
  });

  // ── Load state ──────────────────────────────────────────────────────────
  const state = loadState();

  // ── Assess all keys ─────────────────────────────────────────────────────
  const reports = [];
  for (const keyDef of KEY_REGISTRY) {
    try {
      const report = await assessKey(keyDef, state);
      reports.push(report);

      log.info('Key assessed', {
        key: keyDef.name,
        status: report.status,
        ageDays: report.ageDays,
        valid: report.valid,
        set: report.set,
      });
    } catch (err) {
      log.error('Key assessment failed', { key: keyDef.name, error: err.message });
      reports.push({
        name: keyDef.name,
        service: keyDef.service,
        critical: keyDef.critical,
        status: KeyStatus.UNKNOWN,
        set: null,
        ageDays: null,
        daysUntilExpiry: null,
        fingerprint: null,
        valid: null,
        error: err.message,
        message: `Assessment error: ${err.message}`,
      });
    }
  }

  // ── Send alerts if needed ───────────────────────────────────────────────
  await sendDiscordAlert(reports, state);

  // ── Update state & persist ──────────────────────────────────────────────
  state.lastRunAt = Date.now();
  saveState(state);

  // ── Summary statistics ──────────────────────────────────────────────────
  const summary = {
    total: reports.length,
    ok: reports.filter(r => r.status === KeyStatus.OK).length,
    warning: reports.filter(r => r.status === KeyStatus.WARNING).length,
    expired: reports.filter(r => r.status === KeyStatus.EXPIRED).length,
    missing: reports.filter(r => r.status === KeyStatus.MISSING).length,
    unknown: reports.filter(r => r.status === KeyStatus.UNKNOWN).length,
    validationFailed: reports.filter(r => r.valid === false).length,
  };

  const allHealthy = summary.expired === 0 &&
                     summary.missing === 0 &&
                     summary.validationFailed === 0;

  // ── Output report ───────────────────────────────────────────────────────
  const result = {
    ok: allHealthy,
    status: allHealthy ? 'healthy' : 'attention_needed',
    summary,
    keys: reports,
    config: {
      maxAgeDays: KEY_MAX_AGE_DAYS,
      warningDays: KEY_WARNING_DAYS,
    },
    checkedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(result, null, 2));

  if (!allHealthy) {
    process.exitCode = 1;
  }

  return result;
}

// ─── Run ────────────────────────────────────────────────────────────────────

main().catch((err) => {
  log.error('key-rotation crashed', { error: err.message, stack: err.stack });
  console.error(JSON.stringify({
    ok: false,
    status: 'error',
    message: err.message,
  }, null, 2));
  process.exitCode = 1;
});
