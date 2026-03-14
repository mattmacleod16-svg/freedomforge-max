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

// ─── Metrics Counters ─────────────────────────────────────────────────────────

/** In-memory counters for log volume by level + agent. Reset on export. */
const _metrics = {
  byLevel: { debug: 0, info: 0, warn: 0, error: 0, fatal: 0 },
  byAgent: {},   // agentName → count
  totalEntries: 0,
  droppedEntries: 0,  // Entries dropped due to buffer overflow
  startedAt: Date.now(),
};

/**
 * Get a snapshot of log metrics.
 * @param {boolean} [reset=false] - Reset counters after snapshot
 * @returns {object}
 */
function getMetrics(reset = false) {
  const snapshot = JSON.parse(JSON.stringify(_metrics));
  snapshot.uptimeMs = Date.now() - _metrics.startedAt;
  snapshot.bufferSize = _writeBuffer.length;
  if (reset) {
    for (const lvl of LEVELS) _metrics.byLevel[lvl] = 0;
    _metrics.byAgent = {};
    _metrics.totalEntries = 0;
    _metrics.droppedEntries = 0;
    _metrics.startedAt = Date.now();
  }
  return snapshot;
}

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

const DATA_DIR = (process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL)
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

  // ── Metrics tracking ──────────────────────────────────────────────────────
  _metrics.totalEntries++;
  _metrics.byLevel[level] = (_metrics.byLevel[level] || 0) + 1;
  _metrics.byAgent[agent] = (_metrics.byAgent[agent] || 0) + 1;

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
 * Uses an async write buffer to avoid blocking I/O on every log call.
 * Buffer flushes every FLUSH_INTERVAL_MS or when it reaches MAX_BUFFER_SIZE.
 * @param {string} line - pre-serialized JSON string (no trailing newline)
 */

const FLUSH_INTERVAL_MS = Number(process.env.LOG_FLUSH_INTERVAL_MS || 500);
const MAX_BUFFER_SIZE = Number(process.env.LOG_MAX_BUFFER_SIZE || 100);
const _writeBuffer = [];
let _flushTimer = null;
let _flushing = false;

function persistToFile(line) {
  _writeBuffer.push(line);

  // If buffer is full, flush immediately
  if (_writeBuffer.length >= MAX_BUFFER_SIZE) {
    flushBuffer();
    return;
  }

  // Otherwise schedule a flush if not already scheduled
  if (!_flushTimer) {
    _flushTimer = setTimeout(() => {
      _flushTimer = null;
      flushBuffer();
    }, FLUSH_INTERVAL_MS);
    if (_flushTimer.unref) _flushTimer.unref(); // Don't hold process open
  }
}

/**
 * Flush all buffered log lines to disk in a single write.
 * Non-blocking; synchronous fallback if async fails.
 */
function flushBuffer() {
  if (_flushing || _writeBuffer.length === 0) return;
  _flushing = true;

  // Take all buffered lines
  const lines = _writeBuffer.splice(0);
  const chunk = lines.join('\n') + '\n';

  try {
    ensureDataDir();
    rotateIfNeeded();

    // Prefer async write for non-blocking I/O
    fs.appendFile(LOG_FILE, chunk, { encoding: 'utf8' }, (err) => {
      _flushing = false;
      if (err) {
        // Async write failed — try sync as last resort
        try {
          fs.appendFileSync(LOG_FILE, chunk, { encoding: 'utf8' });
        } catch {
          _metrics.droppedEntries += lines.length;
        }
      }
    });
  } catch {
    _flushing = false;
    _metrics.droppedEntries += lines.length;
  }
}

/**
 * Force-flush the buffer synchronously (for shutdown hooks).
 */
function flushSync() {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  if (_writeBuffer.length === 0) return;
  const lines = _writeBuffer.splice(0);
  const chunk = lines.join('\n') + '\n';
  try {
    ensureDataDir();
    fs.appendFileSync(LOG_FILE, chunk, { encoding: 'utf8' });
  } catch {
    _metrics.droppedEntries += lines.length;
  }
}

// Flush on process exit
process.on('exit', () => flushSync());
process.on('SIGINT', () => { flushSync(); process.exit(0); });
process.on('SIGTERM', () => { flushSync(); process.exit(0); });

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

/**
 * Compatibility with logger.ts: log a typed event.
 * @param {string} type - Event type
 * @param {object} payload - Event data
 */
function logEvent(type, payload) {
  writeLog('info', 'event', type, payload);
}

/**
 * Compatibility with logger.ts: read the last N log entries from events.log.
 * @param {number} [n=200] - Number of entries to return
 * @returns {Array<object>}
 */
function readLast(n = 200) {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const stats = fs.statSync(LOG_FILE);
    const MAX_READ_BYTES = 2 * 1024 * 1024; // 2MB max read
    let raw;
    if (stats.size > MAX_READ_BYTES) {
      const fd = fs.openSync(LOG_FILE, 'r');
      const buffer = Buffer.alloc(MAX_READ_BYTES);
      fs.readSync(fd, buffer, 0, MAX_READ_BYTES, stats.size - MAX_READ_BYTES);
      fs.closeSync(fd);
      raw = buffer.toString('utf8');
      const firstNewline = raw.indexOf('\n');
      if (firstNewline >= 0) raw = raw.slice(firstNewline + 1);
    } else {
      raw = fs.readFileSync(LOG_FILE, 'utf8');
    }
    const lines = raw.trim().split('\n');
    return lines.slice(-n).map(l => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    });
  } catch {
    return [];
  }
}

module.exports = {
  createLogger,
  createCorrelationId,
  setCorrelationId,
  getCorrelationId,
  getMetrics,
  flushSync,
  logEvent,
  readLast,
};
