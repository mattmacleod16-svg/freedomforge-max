/**
 * Structured JSON Logger with Correlation IDs for FreedomForge.
 * ═══════════════════════════════════════════════════════════════
 *
 * Replaces ad-hoc console.log with structured, traceable JSONL output.
 *
 * Features:
 *   - Log levels: debug, info, warn, error, fatal
 *   - Per-cycle correlation IDs for tracing across agents
 *   - JSONL output to stdout/stderr + data/events.log persistence
 *   - Automatic log file rotation (10 MB default, configurable)
 *   - Zero external dependencies (fs + path only)
 *
 * Usage:
 *   const { createLogger, createCorrelationId, setCorrelationId } = require('./logger');
 *   const log = createLogger('my-agent');
 *   setCorrelationId(createCorrelationId());
 *   log.info('trade placed', { symbol: 'ETH-USD', size: 0.5 });
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Resilient I/O (optional) ─────────────────────────────────────────────────

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

// ─── Configuration ────────────────────────────────────────────────────────────

const LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'];

const LEVEL_INDEX = Object.freeze(
  LEVELS.reduce((acc, lvl, i) => { acc[lvl] = i; return acc; }, {})
);

/** Minimum level that gets emitted. Anything below is silently dropped. */
function getMinLevel() {
  const env = (process.env.LOG_LEVEL || 'info').toLowerCase().trim();
  return LEVEL_INDEX[env] !== undefined ? LEVEL_INDEX[env] : LEVEL_INDEX.info;
}

/** Levels that route to stderr instead of stdout. */
const STDERR_LEVELS = new Set(['error', 'fatal']);

// ─── Log File Paths & Rotation ────────────────────────────────────────────────

const DATA_DIR = process.env.VERCEL
  ? '/tmp/freedomforge-data'
  : path.resolve(process.cwd(), 'data');

const LOG_FILE = path.join(DATA_DIR, 'events.log');

/** Maximum log file size in bytes before rotation kicks in. */
function getMaxLogSizeBytes() {
  const mbEnv = process.env.LOG_MAX_SIZE_MB;
  if (mbEnv) {
    const parsed = parseFloat(mbEnv);
    if (!isNaN(parsed) && parsed > 0) return Math.floor(parsed * 1024 * 1024);
  }
  return 10 * 1024 * 1024; // 10 MB default
}

const MAX_ROTATED_FILES = 5;

/** Ensure the data directory exists (lazy, one-shot). */
let dataDirReady = false;
function ensureDataDir() {
  if (dataDirReady) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    dataDirReady = true;
  } catch (err) {
    // If the directory already exists that's fine; any other error we eat
    if (err.code === 'EEXIST') {
      dataDirReady = true;
    }
    // Silently continue - logging should never crash the process
  }
}

/**
 * Rotate events.log when it exceeds the size limit.
 * events.log -> events.log.1 -> events.log.2 -> ... -> events.log.5 (dropped)
 */
function rotateIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stats = fs.statSync(LOG_FILE);
    if (stats.size < getMaxLogSizeBytes()) return;

    // Shift existing rotated files down: .4 -> .5 (dropped), .3 -> .4, ...
    for (let i = MAX_ROTATED_FILES; i >= 2; i--) {
      const older = LOG_FILE + '.' + i;
      const newer = LOG_FILE + '.' + (i - 1);
      if (fs.existsSync(newer)) {
        try { fs.renameSync(newer, older); } catch { /* best effort */ }
      }
    }

    // Current file becomes .1
    try { fs.renameSync(LOG_FILE, LOG_FILE + '.1'); } catch { /* best effort */ }
  } catch {
    // Rotation is best-effort; never let it break logging
  }
}

// ─── Correlation ID System ────────────────────────────────────────────────────

/** Module-level correlation ID for the current execution cycle. */
let _correlationId = null;

/**
 * Generate a new correlation ID.
 * Format: cyc-{timestamp}-{random4chars}
 * @returns {string}
 */
function createCorrelationId() {
  const ts = Date.now().toString(36);
  const rand = randomChars(4);
  return 'cyc-' + ts + '-' + rand;
}

/**
 * Set the current correlation ID for all subsequent log calls.
 * @param {string} id
 */
function setCorrelationId(id) {
  _correlationId = id;
}

/**
 * Get the current correlation ID.
 * @returns {string|null}
 */
function getCorrelationId() {
  return _correlationId;
}

/**
 * Generate N random alphanumeric characters without crypto dependency.
 * Uses Math.random which is fine for correlation IDs (not security).
 * @param {number} n
 * @returns {string}
 */
function randomChars(n) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < n; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// ─── Core Log Writer ──────────────────────────────────────────────────────────

/**
 * Write a single structured log entry.
 * @param {string} level - one of LEVELS
 * @param {string} agent - agent/module name
 * @param {string} msg   - human-readable message
 * @param {object} [data] - optional structured payload
 */
function writeLog(level, agent, msg, data) {
  const minLevel = getMinLevel();
  const levelIdx = LEVEL_INDEX[level];

  // Drop entries below the minimum level
  if (levelIdx < minLevel) return;

  const entry = {
    ts: new Date().toISOString(),
    level: level,
    msg: msg,
    correlationId: _correlationId || null,
    agent: agent,
  };

  // Only include data key when there is actual data to attach
  if (data !== undefined && data !== null) {
    entry.data = data;
  }

  let line;
  try {
    line = JSON.stringify(entry);
  } catch (serializeErr) {
    // If the data payload contains circular refs or BigInts, fall back to a
    // safe version with the data stringified via toString.
    const safeEntry = {
      ts: entry.ts,
      level: entry.level,
      msg: entry.msg,
      correlationId: entry.correlationId,
      agent: entry.agent,
      data: { _serializationError: serializeErr.message },
    };
    line = JSON.stringify(safeEntry);
  }

  // ── Write to stdout / stderr ──────────────────────────────────────────────
  try {
    if (STDERR_LEVELS.has(level)) {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  } catch {
    // If stdout/stderr is broken (e.g., pipe closed), continue silently.
    // Persistence to file below is the last safety net.
  }

  // ── Persist to data/events.log ────────────────────────────────────────────
  persistToFile(line);
}

/**
 * Append a JSONL line to the events log file.
 * @param {string} line - pre-serialized JSON string (no trailing newline)
 */
function persistToFile(line) {
  try {
    ensureDataDir();
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, line + '\n', { encoding: 'utf8' });
  } catch {
    // File persistence is best-effort. If the disk is full or permissions are
    // wrong, we do not want the logger to take down the trading system.
  }
}

// ─── Logger Factory ───────────────────────────────────────────────────────────

/**
 * Create a namespaced logger for a specific agent/module.
 *
 * @param {string} agentName - identifier for the module (e.g. 'risk-manager')
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function, fatal: Function }}
 *
 * Each method signature: (msg: string, data?: object) => void
 *
 * Example:
 *   const log = createLogger('risk-manager');
 *   log.info('position check passed', { exposure: 0.12 });
 */
function createLogger(agentName) {
  const logger = {};

  for (const level of LEVELS) {
    logger[level] = function logMethod(msg, data) {
      writeLog(level, agentName, msg, data);
    };
  }

  return logger;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  createLogger,
  createCorrelationId,
  setCorrelationId,
  getCorrelationId,
};
