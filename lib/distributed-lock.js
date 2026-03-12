/**
 * Distributed Lock — Multi-VM Order Safety
 * ==========================================
 *
 * Prevents split-brain scenarios where two VM instances (primary + failover)
 * both attempt to place orders simultaneously. Uses Redis SETNX with TTL
 * for distributed coordination, falling back to local file locks when Redis
 * is unavailable.
 *
 * Lock types:
 *   - TRADE_LOCK: Acquired before placing any order. Only one VM can trade at a time.
 *   - LEADER_LOCK: Long-lived lease for leader election. Only the leader runs the orchestrator.
 *
 * Usage:
 *   const dlock = require('../lib/distributed-lock');
 *   const lock = await dlock.acquireTradeLock('coinbase', 'BTC-buy');
 *   if (!lock.acquired) { console.log('Another instance is trading'); return; }
 *   try {
 *     // ... place order ...
 *   } finally {
 *     await dlock.releaseLock(lock.lockId);
 *   }
 *
 *   // Or use the convenience wrapper:
 *   const result = await dlock.withTradeLock('coinbase', 'BTC-buy', async () => {
 *     return placeOrder(...);
 *   });
 *
 * Env vars:
 *   REDIS_URL               — Redis connection string (optional)
 *   DLOCK_ENABLED           — 'true' (default) to enable locking
 *   DLOCK_TRADE_TTL_MS      — Trade lock TTL (default: 30000ms / 30s)
 *   DLOCK_LEADER_TTL_MS     — Leader lock TTL (default: 300000ms / 5min)
 *   DLOCK_INSTANCE_ID       — Unique instance identifier (default: hostname-pid)
 *   DLOCK_FALLBACK_DIR      — Directory for file-based lock fallback
 *
 * State: data/locks/ directory for file fallback
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { createLogger } = require('./logger');
const log = createLogger('distributed-lock');

// ─── Configuration ──────────────────────────────────────────────────────────

const ENABLED = String(process.env.DLOCK_ENABLED || 'true').toLowerCase() !== 'false';
const TRADE_TTL_MS = Math.max(5000, Number(process.env.DLOCK_TRADE_TTL_MS || 30000));
const LEADER_TTL_MS = Math.max(30000, Number(process.env.DLOCK_LEADER_TTL_MS || 300000));
const INSTANCE_ID = process.env.DLOCK_INSTANCE_ID || `${os.hostname()}-${process.pid}`;
const REDIS_URL = process.env.REDIS_URL || '';
const LOCK_DIR = path.resolve(process.cwd(), process.env.DLOCK_FALLBACK_DIR || 'data/locks');

// ─── Redis Client (lazy connect) ───────────────────────────────────────────

let redisClient = null;
let redisAvailable = false;

async function getRedis() {
  if (redisClient) return redisClient;
  if (!REDIS_URL) return null;

  try {
    // Dynamic import for optional redis dependency
    const redis = require('redis');
    redisClient = redis.createClient({ url: REDIS_URL });
    redisClient.on('error', () => { redisAvailable = false; });
    await redisClient.connect();
    redisAvailable = true;
    return redisClient;
  } catch (err) {
    redisClient = null;
    redisAvailable = false;
    log.error('Redis connect failed', { error: err?.message || err });
    return null;
  }
}

// ─── In-Memory Lock Registry (for same-process checks) ─────────────────────

const localLocks = new Map(); // lockKey → { lockId, instanceId, expiresAt }

function cleanLocalExpired() {
  const now = Date.now();
  for (const [key, entry] of localLocks) {
    if (entry.expiresAt <= now) localLocks.delete(key);
  }
}

// ─── Redis-Based Locking ────────────────────────────────────────────────────

async function redisAcquire(lockKey, ttlMs) {
  const client = await getRedis();
  if (!client || !redisAvailable) return null; // fallback to file lock

  const lockId = `${INSTANCE_ID}:${crypto.randomBytes(4).toString('hex')}`;
  const redisKey = `ff:lock:${lockKey}`;

  try {
    // SET key value NX PX ttlMs — atomic acquire
    const result = await client.set(redisKey, lockId, { NX: true, PX: ttlMs });
    if (result === 'OK') {
      return { acquired: true, lockId, lockKey, backend: 'redis', expiresAt: Date.now() + ttlMs };
    }

    // Lock is held by someone else — check who
    const holder = await client.get(redisKey);
    return { acquired: false, lockId: null, lockKey, backend: 'redis', heldBy: holder };
  } catch (err) {
    redisAvailable = false;
    log.error('Redis acquire failed', { error: err?.message || err });
    return null; // fall through to file lock
  }
}

async function redisRelease(lockKey, lockId) {
  const client = await getRedis();
  if (!client || !redisAvailable) return false;

  const redisKey = `ff:lock:${lockKey}`;

  try {
    // Only release if we still hold the lock (compare-and-delete)
    const script = `
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
      else
        return 0
      end
    `;
    const result = await client.eval(script, { keys: [redisKey], arguments: [lockId] });
    return result === 1;
  } catch (err) {
    log.error('Redis release failed', { error: err?.message || err });
    return false;
  }
}

// ─── File-Based Lock Fallback ───────────────────────────────────────────────

function fileLockPath(lockKey) {
  const safe = lockKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(LOCK_DIR, `${safe}.lock`);
}

function fileAcquire(lockKey, ttlMs) {
  const fp = fileLockPath(lockKey);
  const lockId = `${INSTANCE_ID}:${crypto.randomBytes(4).toString('hex')}`;
  const expiresAt = Date.now() + ttlMs;

  try {
    fs.mkdirSync(LOCK_DIR, { recursive: true });

    // Check for existing lock
    if (fs.existsSync(fp)) {
      try {
        const existing = JSON.parse(fs.readFileSync(fp, 'utf8'));
        // If lock is still valid, we can't acquire
        if (existing.expiresAt > Date.now()) {
          return { acquired: false, lockId: null, lockKey, backend: 'file', heldBy: existing.instanceId };
        }
        // Lock expired — we can take it
      } catch {
        // Corrupt lock file — safe to overwrite
      }
    }

    // Write our lock
    const lockData = { lockId, instanceId: INSTANCE_ID, lockKey, expiresAt, createdAt: Date.now() };
    const tmp = fp + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(lockData));
    fs.renameSync(tmp, fp);

    // Verify we actually got it (handle race with another process)
    const verify = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (verify.lockId !== lockId) {
      return { acquired: false, lockId: null, lockKey, backend: 'file', heldBy: verify.instanceId };
    }

    return { acquired: true, lockId, lockKey, backend: 'file', expiresAt };
  } catch (err) {
    return { acquired: false, lockId: null, lockKey, backend: 'file', error: err?.message || String(err) };
  }
}

function fileRelease(lockKey, lockId) {
  const fp = fileLockPath(lockKey);
  try {
    if (!fs.existsSync(fp)) return true;
    const existing = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (existing.lockId === lockId) {
      fs.unlinkSync(fp);
      return true;
    }
    return false; // Not our lock
  } catch {
    return false;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Acquire a distributed lock.
 * @param {string} lockKey - Unique key for the lock
 * @param {object} [opts]
 * @param {number} [opts.ttlMs] - Lock TTL in ms (default: TRADE_TTL_MS)
 * @returns {Promise<{ acquired: boolean, lockId: string|null, lockKey: string, backend: string }>}
 */
async function acquireLock(lockKey, opts = {}) {
  if (!ENABLED) {
    return { acquired: true, lockId: 'noop', lockKey, backend: 'disabled' };
  }

  const ttlMs = opts.ttlMs || TRADE_TTL_MS;

  // Check in-memory first (same-process fast path)
  cleanLocalExpired();
  const local = localLocks.get(lockKey);
  if (local && local.expiresAt > Date.now()) {
    return { acquired: false, lockId: null, lockKey, backend: 'local', heldBy: local.instanceId };
  }

  // Try Redis first
  const redisResult = await redisAcquire(lockKey, ttlMs);
  if (redisResult) {
    if (redisResult.acquired) {
      localLocks.set(lockKey, { lockId: redisResult.lockId, instanceId: INSTANCE_ID, expiresAt: redisResult.expiresAt });
    }
    return redisResult;
  }

  // Fall back to file-based lock
  const fileResult = fileAcquire(lockKey, ttlMs);
  if (fileResult.acquired) {
    localLocks.set(lockKey, { lockId: fileResult.lockId, instanceId: INSTANCE_ID, expiresAt: fileResult.expiresAt });
  }
  return fileResult;
}

/**
 * Release a previously acquired lock.
 * @param {string} lockKey - The lock key
 * @param {string} lockId - The lock ID returned from acquireLock
 */
async function releaseLock(lockKey, lockId) {
  if (!ENABLED || lockId === 'noop') return true;

  // Remove from local registry
  const local = localLocks.get(lockKey);
  if (local?.lockId === lockId) localLocks.delete(lockKey);

  // Try Redis first
  const redisReleased = await redisRelease(lockKey, lockId);
  if (redisReleased) return true;

  // Fall back to file release
  return fileRelease(lockKey, lockId);
}

/**
 * Acquire a trade lock for a specific venue/asset operation.
 * @param {string} venue - Exchange name
 * @param {string} operation - e.g., 'BTC-buy', 'ETH-sell'
 */
async function acquireTradeLock(venue, operation) {
  return acquireLock(`trade:${venue}:${operation}`, { ttlMs: TRADE_TTL_MS });
}

/**
 * Acquire the leader election lock. Only one instance should be the leader.
 * Call this periodically (e.g., every minute) to maintain leadership.
 */
async function acquireLeaderLock() {
  return acquireLock('leader:orchestrator', { ttlMs: LEADER_TTL_MS });
}

/**
 * Convenience: Execute a function while holding a trade lock.
 * Automatically acquires and releases the lock.
 *
 * @param {string} venue
 * @param {string} operation
 * @param {Function} fn - Async function to execute while holding the lock
 * @returns {Promise<{ locked: boolean, result?: any, error?: string }>}
 */
async function withTradeLock(venue, operation, fn) {
  const lock = await acquireTradeLock(venue, operation);
  if (!lock.acquired) {
    return { locked: false, heldBy: lock.heldBy, backend: lock.backend };
  }

  try {
    const result = await fn();
    return { locked: true, result, lockId: lock.lockId, backend: lock.backend };
  } catch (err) {
    return { locked: true, error: err?.message || String(err), lockId: lock.lockId, backend: lock.backend };
  } finally {
    await releaseLock(lock.lockKey, lock.lockId);
  }
}

/**
 * Check if a lock is currently held (diagnostic).
 */
async function isLocked(lockKey) {
  cleanLocalExpired();
  if (localLocks.has(lockKey)) return true;

  const client = await getRedis();
  if (client && redisAvailable) {
    try {
      const val = await client.get(`ff:lock:${lockKey}`);
      return val !== null;
    } catch (err) { log.error('Redis isLocked check failed', { error: err?.message || err }); /* fall through */ }
  }

  // Check file
  const fp = fileLockPath(lockKey);
  try {
    if (!fs.existsSync(fp)) return false;
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return data.expiresAt > Date.now();
  } catch { return false; }
}

/**
 * Get status of all known locks (diagnostic).
 */
function getLockStatus() {
  cleanLocalExpired();
  const status = {
    enabled: ENABLED,
    instanceId: INSTANCE_ID,
    redisAvailable,
    activeLocks: [],
  };

  for (const [key, entry] of localLocks) {
    status.activeLocks.push({
      key,
      lockId: entry.lockId,
      instanceId: entry.instanceId,
      expiresIn: Math.max(0, entry.expiresAt - Date.now()),
    });
  }

  // Also check file-based locks
  try {
    if (fs.existsSync(LOCK_DIR)) {
      const files = fs.readdirSync(LOCK_DIR).filter(f => f.endsWith('.lock'));
      for (const f of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(LOCK_DIR, f), 'utf8'));
          if (data.expiresAt > Date.now()) {
            const already = status.activeLocks.find(l => l.key === data.lockKey);
            if (!already) {
              status.activeLocks.push({
                key: data.lockKey,
                lockId: data.lockId,
                instanceId: data.instanceId,
                expiresIn: Math.max(0, data.expiresAt - Date.now()),
                backend: 'file',
              });
            }
          }
        } catch { /* corrupt lock file — skip */ }
      }
    }
  } catch { /* lock dir doesn't exist yet */ }

  return status;
}

/**
 * Clean up expired file-based locks.
 */
function cleanupExpiredLocks() {
  try {
    if (!fs.existsSync(LOCK_DIR)) return 0;
    const files = fs.readdirSync(LOCK_DIR).filter(f => f.endsWith('.lock'));
    let cleaned = 0;
    for (const f of files) {
      const fp = path.join(LOCK_DIR, f);
      try {
        const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (data.expiresAt <= Date.now()) {
          fs.unlinkSync(fp);
          cleaned++;
        }
      } catch {
        // Corrupt file — remove it
        try { fs.unlinkSync(fp); cleaned++; } catch { /* ignore */ }
      }
    }
    return cleaned;
  } catch { return 0; }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  acquireLock,
  releaseLock,
  acquireTradeLock,
  acquireLeaderLock,
  withTradeLock,
  isLocked,
  getLockStatus,
  cleanupExpiredLocks,
  INSTANCE_ID,
  TRADE_TTL_MS,
  LEADER_TTL_MS,
};
