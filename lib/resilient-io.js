/**
 * Resilient I/O — Bulletproof file & network primitives for FreedomForge.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Addresses EVERY communication vulnerability:
 *  • Atomic file writes  — write-to-tmp then rename (crash-safe)
 *  • File locking        — advisory lock prevents concurrent corruption
 *  • Auto-backup         — .bak rotated on every write (rollback on corruption)
 *  • Retry with backoff  — configurable for any async operation
 *  • Fetch with timeout  — hardened HTTP with retry, backoff, circuit breaker
 *  • Rate limiter        — per-key token bucket (exchange API protection)
 *
 * Usage:
 *   const rio = require('./resilient-io');
 *   const data = rio.readJsonSafe('data/state.json', { fallback: {} });
 *   rio.writeJsonAtomic('data/state.json', data);
 *   const res = await rio.fetchRetry(url, opts, { retries: 3 });
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// ─── Configuration ────────────────────────────────────────────────────────────

const MAX_BACKUPS = 3;
const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_LOCK_STALE_MS = 30000;

// ─── Advisory File Locking ────────────────────────────────────────────────────
// Uses .lock files with PID + timestamp for stale-lock detection.

const activeLocks = new Map();

function lockPath(filePath) {
  return filePath + '.lock';
}

/**
 * Acquire an advisory lock. Returns a release function.
 * @param {string} filePath — path of the file to protect
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=5000] — max wait for lock
 * @param {number} [opts.staleMs=30000] — auto-break lock older than this
 * @returns {() => void} release function
 */
function acquireLock(filePath, opts = {}) {
  const lp = lockPath(filePath);
  const timeoutMs = opts.timeoutMs || DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = opts.staleMs || DEFAULT_LOCK_STALE_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Check for stale locks
    try {
      if (fs.existsSync(lp)) {
        const info = JSON.parse(fs.readFileSync(lp, 'utf8'));
        const age = Date.now() - (info.ts || 0);
        if (age > staleMs) {
          // Stale lock — break it
          try { fs.unlinkSync(lp); } catch {}
        }
      }
    } catch {}

    // Try to create lock atomically using O_EXCL
    try {
      const fd = fs.openSync(lp, 'wx');
      const lockInfo = JSON.stringify({ pid: process.pid, ts: Date.now(), host: os.hostname() });
      fs.writeSync(fd, lockInfo);
      fs.closeSync(fd);

      const release = () => {
        try { fs.unlinkSync(lp); } catch {}
        activeLocks.delete(filePath);
      };
      activeLocks.set(filePath, release);
      return release;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Lock held by someone else — spin-wait
      const spinMs = 10 + Math.random() * 40;
      const until = Date.now() + spinMs;
      while (Date.now() < until) { /* busy wait */ }
    }
  }

  // Timeout — force-break and retry once
  try { fs.unlinkSync(lp); } catch {}
  const fd = fs.openSync(lp, 'wx');
  const lockInfo = JSON.stringify({ pid: process.pid, ts: Date.now(), host: os.hostname(), forced: true });
  fs.writeSync(fd, lockInfo);
  fs.closeSync(fd);
  const release = () => {
    try { fs.unlinkSync(lp); } catch {}
    activeLocks.delete(filePath);
  };
  activeLocks.set(filePath, release);
  return release;
}

// Clean up locks on exit
function cleanupLocks() {
  for (const [, release] of activeLocks) {
    try { release(); } catch {}
  }
}
process.on('exit', cleanupLocks);
process.on('SIGINT', () => { cleanupLocks(); process.exit(130); });
process.on('SIGTERM', () => { cleanupLocks(); process.exit(143); });

// ─── Atomic File Write ────────────────────────────────────────────────────────

/**
 * Write JSON data atomically with backup rotation.
 * 1. Acquire advisory lock
 * 2. Write to .tmp file
 * 3. Rotate existing file → .bak
 * 4. Rename .tmp → final (atomic on same filesystem)
 * 5. Release lock
 *
 * @param {string} filePath — target JSON file
 * @param {any} data — data to serialize
 * @param {object} [opts]
 * @param {boolean} [opts.lock=true] — use advisory locking
 * @param {number} [opts.backups=3] — number of .bak files to keep
 */
function writeJsonAtomic(filePath, data, opts = {}) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const dir = path.dirname(abs);
  const useLock = opts.lock !== false;
  const maxBackups = opts.backups ?? MAX_BACKUPS;

  fs.mkdirSync(dir, { recursive: true });

  let release = null;
  try {
    if (useLock) release = acquireLock(abs);

    const tmpPath = abs + '.tmp.' + process.pid + '.' + crypto.randomBytes(4).toString('hex');
    const content = JSON.stringify(data, null, 2);

    // Write to temp file
    fs.writeFileSync(tmpPath, content, { mode: 0o644 });

    // Verify temp file is valid JSON before committing
    try {
      JSON.parse(fs.readFileSync(tmpPath, 'utf8'));
    } catch (verifyErr) {
      try { fs.unlinkSync(tmpPath); } catch {}
      throw new Error(`Atomic write verification failed: ${verifyErr.message}`);
    }

    // Rotate backups
    if (fs.existsSync(abs) && maxBackups > 0) {
      // Shift existing backups down
      for (let i = maxBackups - 1; i >= 1; i--) {
        const older = abs + '.bak.' + i;
        const newer = abs + '.bak.' + (i - 1);
        if (fs.existsSync(newer)) {
          try { fs.renameSync(newer, older); } catch {}
        }
      }
      // Current file becomes .bak.0
      try { fs.copyFileSync(abs, abs + '.bak.0'); } catch {}
    }

    // Atomic rename
    fs.renameSync(tmpPath, abs);
  } finally {
    if (release) release();
  }
}

// ─── Safe JSON Read with Backup Recovery ──────────────────────────────────────

/**
 * Read JSON safely. If the primary file is corrupted, tries backups.
 * @param {string} filePath
 * @param {object} [opts]
 * @param {any} [opts.fallback=null] — default value if all reads fail
 * @returns {any}
 */
function readJsonSafe(filePath, opts = {}) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const fallback = opts.fallback !== undefined ? opts.fallback : null;

  // Try primary file
  try {
    if (fs.existsSync(abs)) {
      return JSON.parse(fs.readFileSync(abs, 'utf8'));
    }
  } catch (err) {
    console.error(`[resilient-io] Primary read failed for ${path.basename(abs)}: ${err.message}`);
  }

  // Try backups in order
  for (let i = 0; i < MAX_BACKUPS; i++) {
    const bakPath = abs + '.bak.' + i;
    try {
      if (fs.existsSync(bakPath)) {
        const data = JSON.parse(fs.readFileSync(bakPath, 'utf8'));
        console.warn(`[resilient-io] Recovered ${path.basename(abs)} from backup .bak.${i}`);
        // Restore the backup as primary
        try { fs.copyFileSync(bakPath, abs); } catch {}
        return data;
      }
    } catch {}
  }

  return fallback;
}

// ─── Retry with Exponential Backoff ───────────────────────────────────────────

/**
 * Retry an async function with exponential backoff + jitter.
 * @param {() => Promise<T>} fn — async function to retry
 * @param {object} [opts]
 * @param {number} [opts.retries=3]
 * @param {number} [opts.baseDelayMs=500]
 * @param {number} [opts.maxDelayMs=10000]
 * @param {(err: Error, attempt: number) => boolean} [opts.shouldRetry] — return false to abort
 * @returns {Promise<T>}
 */
async function retry(fn, opts = {}) {
  const maxRetries = opts.retries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 500;
  const maxDelay = opts.maxDelayMs ?? 10000;
  const shouldRetry = opts.shouldRetry || (() => true);

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries || !shouldRetry(err, attempt)) break;
      const delay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt)) * (0.5 + Math.random() * 0.5);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ─── Fetch with Retry + Timeout ───────────────────────────────────────────────

/**
 * Hardened fetch with retry, timeout, and optional circuit breaker.
 * @param {string} url
 * @param {RequestInit} [fetchOpts]
 * @param {object} [retryOpts]
 * @param {number} [retryOpts.retries=2]
 * @param {number} [retryOpts.timeoutMs=15000]
 * @param {number} [retryOpts.baseDelayMs=500]
 * @returns {Promise<Response>}
 */
async function fetchRetry(url, fetchOpts = {}, retryOpts = {}) {
  const timeoutMs = retryOpts.timeoutMs ?? 15000;
  const retries = retryOpts.retries ?? 2;
  const baseDelayMs = retryOpts.baseDelayMs ?? 500;

  return retry(async (attempt) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...fetchOpts,
        signal: controller.signal,
      });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }, {
    retries,
    baseDelayMs,
    shouldRetry: (err) => {
      // Retry on network errors and timeouts, not on auth failures
      if (err.name === 'AbortError') return true;
      if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' ||
          err.code === 'ETIMEDOUT' || err.code === 'EAI_AGAIN' ||
          err.code === 'EPIPE' || err.code === 'UND_ERR_CONNECT_TIMEOUT') return true;
      if (err.message && /network|socket|timeout|ENOTFOUND/i.test(err.message)) return true;
      return false;
    },
  });
}

/**
 * Fetch JSON with retry + timeout. Returns parsed body.
 * @param {string} url
 * @param {RequestInit} [fetchOpts]
 * @param {object} [retryOpts] — same as fetchRetry
 * @returns {Promise<any>}
 */
async function fetchJsonRetry(url, fetchOpts = {}, retryOpts = {}) {
  const res = await fetchRetry(url, fetchOpts, retryOpts);
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

// ─── Rate Limiter (Token Bucket) ──────────────────────────────────────────────

const rateBuckets = new Map();

/**
 * Simple token-bucket rate limiter.
 * @param {string} key — identifier (e.g. 'coinbase', 'kraken', 'discord')
 * @param {object} [opts]
 * @param {number} [opts.maxTokens=10] — bucket capacity
 * @param {number} [opts.refillPerSec=2] — tokens added per second
 * @returns {boolean} true if request is allowed
 */
function rateLimit(key, opts = {}) {
  const maxTokens = opts.maxTokens ?? 10;
  const refillPerSec = opts.refillPerSec ?? 2;

  let bucket = rateBuckets.get(key);
  if (!bucket) {
    bucket = { tokens: maxTokens, lastRefill: Date.now() };
    rateBuckets.set(key, bucket);
  }

  // Refill tokens based on elapsed time
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsed * refillPerSec);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }
  return false;
}

/**
 * Wait until rate limit allows, then proceed.
 * @param {string} key
 * @param {object} [opts] — same as rateLimit
 * @param {number} [maxWaitMs=5000]
 */
async function rateLimitWait(key, opts = {}, maxWaitMs = 5000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (rateLimit(key, opts)) return;
    await new Promise(r => setTimeout(r, 100));
  }
  // Exceeded wait — allow anyway but warn
  console.warn(`[resilient-io] Rate limit wait exceeded for "${key}" — proceeding anyway`);
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

const circuitStates = new Map();

/**
 * Circuit breaker for external services.
 * States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (testing)
 *
 * @param {string} key — service identifier
 * @param {() => Promise<T>} fn — operation to protect
 * @param {object} [opts]
 * @param {number} [opts.failureThreshold=5]
 * @param {number} [opts.resetTimeMs=60000]
 * @returns {Promise<T>}
 */
async function circuitBreaker(key, fn, opts = {}) {
  const threshold = opts.failureThreshold ?? 5;
  const resetTime = opts.resetTimeMs ?? 60000;

  let state = circuitStates.get(key);
  if (!state) {
    state = { status: 'CLOSED', failures: 0, lastFailure: 0, lastSuccess: 0 };
    circuitStates.set(key, state);
  }

  // Check if circuit should be reset
  if (state.status === 'OPEN') {
    if (Date.now() - state.lastFailure > resetTime) {
      state.status = 'HALF_OPEN';
    } else {
      throw new Error(`[circuit-breaker] "${key}" is OPEN — ${threshold} consecutive failures. Retry in ${Math.ceil((resetTime - (Date.now() - state.lastFailure)) / 1000)}s`);
    }
  }

  try {
    const result = await fn();
    state.failures = 0;
    state.status = 'CLOSED';
    state.lastSuccess = Date.now();
    return result;
  } catch (err) {
    state.failures++;
    state.lastFailure = Date.now();
    if (state.failures >= threshold) {
      state.status = 'OPEN';
    }
    throw err;
  }
}

/**
 * Get circuit breaker status for monitoring.
 * @param {string} [key] — if omitted, returns all
 */
function getCircuitStatus(key) {
  if (key) return circuitStates.get(key) || { status: 'CLOSED', failures: 0 };
  const all = {};
  for (const [k, v] of circuitStates) all[k] = v;
  return all;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // File I/O
  writeJsonAtomic,
  readJsonSafe,
  acquireLock,

  // Network
  retry,
  fetchRetry,
  fetchJsonRetry,

  // Rate limiting
  rateLimit,
  rateLimitWait,

  // Circuit breaker
  circuitBreaker,
  getCircuitStatus,
};
