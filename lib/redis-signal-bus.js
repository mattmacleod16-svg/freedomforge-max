/**
 * Redis-backed Cross-agent Signal Bus.
 * =====================================================================
 *
 * Drop-in replacement for agent-signal-bus.js that uses Redis (sorted set)
 * for storage instead of a JSON file. Eliminates race conditions from
 * concurrent file access while preserving the exact same synchronous API.
 *
 * Architecture:
 *   - In-memory cache kept in sync with Redis (background refresh every 5s)
 *   - publish() writes to cache immediately + fires Redis write (non-blocking)
 *   - query() / consensus() / summary() read from cache (fast, synchronous)
 *   - If Redis is unavailable at any point, falls back to JSON file bus seamlessly
 *
 * Redis data structure:
 *   Key:   ff:signals (sorted set)
 *   Score: publishedAt timestamp
 *   Value: JSON-stringified signal object
 *
 * Config (env vars):
 *   SIGNAL_BUS_MODE      — 'auto' (default) | 'redis' | 'file'
 *   REDIS_URL            — e.g. redis://localhost:6379
 *   REDIS_HOST           — default 127.0.0.1
 *   REDIS_PORT           — default 6379
 *   REDIS_PASSWORD       — optional
 *   AGENT_SIGNAL_TTL_MS  — default 7200000 (2 hours)
 *   AGENT_SIGNAL_MAX     — default 200
 *   AGENT_SIGNAL_BUS_FILE — JSON fallback path
 *
 * Exports the same interface as agent-signal-bus.js:
 *   { publish, query, consensus, summary, SIGNAL_FILE }
 * Plus:
 *   { getRedisStatus }
 */

const fs = require('fs');
const path = require('path');

// ─── Optional Dependencies ───────────────────────────────────────────────────

let Redis;
try { Redis = require('ioredis'); } catch { Redis = null; }

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

const { createLogger } = require('./logger');
const _busLog = createLogger('redis-signal-bus');

// ─── Configuration ───────────────────────────────────────────────────────────

const SIGNAL_FILE = path.resolve(
  process.cwd(),
  process.env.AGENT_SIGNAL_BUS_FILE || 'data/agent-signal-bus.json'
);

const DEFAULT_TTL_MS = Math.max(
  60000,
  parseInt(process.env.AGENT_SIGNAL_TTL_MS || String(2 * 60 * 60 * 1000), 10)
);

const MAX_SIGNALS = Math.max(
  20,
  parseInt(process.env.AGENT_SIGNAL_MAX || '200', 10)
);

const REDIS_KEY = 'ff:signals';
const SYNC_INTERVAL_MS = 5000;
const SIGNAL_BUS_MODE = (process.env.SIGNAL_BUS_MODE || 'auto').toLowerCase();

// ─── State ───────────────────────────────────────────────────────────────────

let redisClient = null;
let redisConnected = false;
let redisLatencyMs = -1;
let useRedis = false;
let memoryCache = [];       // In-memory signal cache
let syncTimer = null;       // Background sync interval
let initialLoadDone = false;

// ─── Logging Helper ──────────────────────────────────────────────────────────

function logWarn(msg, ...args) {
  _busLog.warn(msg, args.length ? { detail: args.join(' ') } : undefined);
}

function logError(msg, ...args) {
  _busLog.error(msg, args.length ? { detail: args.join(' ') } : undefined);
}

function logInfo(msg, ...args) {
  if (process.env.DEBUG_SIGNAL_BUS) {
    _busLog.info(msg, args.length ? { detail: args.join(' ') } : undefined);
  }
}

// ─── JSON File Fallback (same as original agent-signal-bus.js) ───────────────

function loadFromFile() {
  if (rio) {
    const raw = rio.readJsonSafe(SIGNAL_FILE, { fallback: [] });
    return Array.isArray(raw) ? raw : [];
  }
  try {
    if (!fs.existsSync(SIGNAL_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(SIGNAL_FILE, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveToFile(signals) {
  try {
    if (rio) {
      rio.writeJsonAtomic(SIGNAL_FILE, signals);
      return;
    }
    fs.mkdirSync(path.dirname(SIGNAL_FILE), { recursive: true });
    fs.writeFileSync(SIGNAL_FILE, JSON.stringify(signals, null, 2));
  } catch (err) {
    logError('Failed to save to file:', err.message);
  }
}

// ─── Pruning ─────────────────────────────────────────────────────────────────

function prune(signals) {
  const now = Date.now();
  return signals.filter((s) => {
    const expiresAt = Number(s.publishedAt || 0) + Number(s.ttlMs || DEFAULT_TTL_MS);
    return expiresAt > now;
  });
}

// ─── Redis Connection ────────────────────────────────────────────────────────

function createRedisClient() {
  if (!Redis) return null;

  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST || '127.0.0.1';
  const redisPort = Math.max(1, Math.min(65535, parseInt(process.env.REDIS_PORT || '6379', 10) || 6379));
  const redisPassword = process.env.REDIS_PASSWORD || undefined;

  let client;
  try {
    if (redisUrl) {
      client = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        retryStrategy(times) {
          if (times > 3) return null; // Stop retrying after 3 attempts
          return Math.min(times * 500, 2000);
        },
        lazyConnect: true,
        enableOfflineQueue: false,
        connectTimeout: 5000,
      });
    } else {
      client = new Redis({
        host: redisHost,
        port: redisPort,
        password: redisPassword,
        maxRetriesPerRequest: 1,
        retryStrategy(times) {
          if (times > 3) return null;
          return Math.min(times * 500, 2000);
        },
        lazyConnect: true,
        enableOfflineQueue: false,
        connectTimeout: 5000,
      });
    }
  } catch (err) {
    logWarn('Failed to create Redis client:', err.message);
    return null;
  }

  client.on('connect', () => {
    redisConnected = true;
    logInfo('Redis connected');
  });

  client.on('ready', () => {
    redisConnected = true;
  });

  client.on('error', (err) => {
    if (redisConnected) {
      logWarn('Redis error, falling back to file mode:', err.message);
    }
    redisConnected = false;
  });

  client.on('close', () => {
    redisConnected = false;
    logInfo('Redis connection closed');
  });

  client.on('end', () => {
    redisConnected = false;
  });

  return client;
}

async function connectRedis() {
  if (!redisClient) return false;

  try {
    await redisClient.connect();
    redisConnected = true;
    return true;
  } catch (err) {
    redisConnected = false;
    logWarn('Redis connection failed:', err.message);
    return false;
  }
}

// ─── Redis Operations (all async, fire-and-forget from sync callers) ─────────

async function loadFromRedis() {
  if (!redisClient || !redisConnected) return null;

  try {
    const start = Date.now();
    const raw = await redisClient.zrangebyscore(REDIS_KEY, '-inf', '+inf');
    redisLatencyMs = Date.now() - start;

    const signals = [];
    for (const item of raw) {
      try {
        signals.push(JSON.parse(item));
      } catch {
        // Skip malformed entries
      }
    }
    return signals;
  } catch (err) {
    logWarn('Redis read failed:', err.message);
    redisConnected = false;
    return null;
  }
}

async function writeSignalToRedis(signal) {
  if (!redisClient || !redisConnected) return false;

  try {
    const pipeline = redisClient.pipeline();

    // Add signal to sorted set (score = publishedAt)
    pipeline.zadd(REDIS_KEY, signal.publishedAt, JSON.stringify(signal));

    // Trim to MAX_SIGNALS (remove oldest, keep the top MAX_SIGNALS by score)
    // zremrangebyrank removes by rank (0 = lowest score = oldest)
    // Keep indices -(MAX_SIGNALS) to -1, so remove 0 to -(MAX_SIGNALS + 1)
    pipeline.zremrangebyrank(REDIS_KEY, 0, -(MAX_SIGNALS + 1));

    // Remove expired signals
    const now = Date.now();
    // We cannot compute per-signal expiry in a simple zrangebyscore since
    // TTL varies per signal. Expiry pruning happens in syncFromRedis instead.

    pipeline.exec().catch((err) => {
      logWarn('Redis pipeline error:', err.message);
    });

    return true;
  } catch (err) {
    logWarn('Redis write failed:', err.message);
    redisConnected = false;
    return false;
  }
}

async function removeExpiredFromRedis() {
  if (!redisClient || !redisConnected) return;

  try {
    // Fetch all signals and check TTL individually
    const raw = await redisClient.zrangebyscore(REDIS_KEY, '-inf', '+inf');
    const now = Date.now();
    const toRemove = [];

    for (const item of raw) {
      try {
        const signal = JSON.parse(item);
        const expiresAt = Number(signal.publishedAt || 0) + Number(signal.ttlMs || DEFAULT_TTL_MS);
        if (expiresAt <= now) {
          toRemove.push(item);
        }
      } catch {
        // Malformed entry, remove it
        toRemove.push(item);
      }
    }

    if (toRemove.length > 0) {
      await redisClient.zrem(REDIS_KEY, ...toRemove);
      logInfo(`Removed ${toRemove.length} expired signals from Redis`);
    }
  } catch (err) {
    logWarn('Redis expiry cleanup failed:', err.message);
  }
}

async function replaceAllInRedis(signals) {
  if (!redisClient || !redisConnected) return false;

  try {
    const pipeline = redisClient.pipeline();
    pipeline.del(REDIS_KEY);

    for (const signal of signals) {
      pipeline.zadd(REDIS_KEY, signal.publishedAt, JSON.stringify(signal));
    }

    await pipeline.exec();
    return true;
  } catch (err) {
    logWarn('Redis bulk write failed:', err.message);
    redisConnected = false;
    return false;
  }
}

// ─── Background Sync ─────────────────────────────────────────────────────────

async function syncFromRedis() {
  if (!useRedis || !redisClient || !redisConnected) return;

  try {
    // Remove expired signals from Redis first
    await removeExpiredFromRedis();

    // Load fresh data from Redis
    const signals = await loadFromRedis();
    if (signals !== null) {
      memoryCache = prune(signals);
      logInfo(`Synced ${memoryCache.length} signals from Redis`);
    }
  } catch (err) {
    logWarn('Background sync failed:', err.message);
  }
}

function startBackgroundSync() {
  if (syncTimer) return;

  syncTimer = setInterval(() => {
    syncFromRedis().catch((err) => {
      logWarn('Sync interval error:', err.message);
    });
  }, SYNC_INTERVAL_MS);

  // Do not keep the process alive just for signal sync
  if (syncTimer && typeof syncTimer.unref === 'function') {
    syncTimer.unref();
  }
}

function stopBackgroundSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

// ─── Initialization ──────────────────────────────────────────────────────────

function initSync() {
  if (initialLoadDone) return;
  initialLoadDone = true;

  // Determine mode
  if (SIGNAL_BUS_MODE === 'file') {
    useRedis = false;
    memoryCache = prune(loadFromFile());
    logInfo('File mode forced by SIGNAL_BUS_MODE=file');
    return;
  }

  if (!Redis) {
    if (SIGNAL_BUS_MODE === 'redis') {
      logError('SIGNAL_BUS_MODE=redis but ioredis is not installed. Falling back to file mode.');
    }
    useRedis = false;
    memoryCache = prune(loadFromFile());
    return;
  }

  // Try Redis in 'auto' or 'redis' mode
  redisClient = createRedisClient();

  if (!redisClient) {
    if (SIGNAL_BUS_MODE === 'redis') {
      logError('SIGNAL_BUS_MODE=redis but Redis client creation failed. Falling back to file mode.');
    }
    useRedis = false;
    memoryCache = prune(loadFromFile());
    return;
  }

  // Attempt async connection - load from file first, then upgrade to Redis
  memoryCache = prune(loadFromFile());

  // Fire-and-forget the async Redis connection + initial load
  connectRedis()
    .then(async (connected) => {
      if (connected) {
        useRedis = true;

        // Try to load existing data from Redis
        const redisData = await loadFromRedis();
        if (redisData !== null && redisData.length > 0) {
          // Redis has data - use it
          memoryCache = prune(redisData);
          logInfo(`Loaded ${memoryCache.length} signals from Redis`);
        } else if (memoryCache.length > 0) {
          // Redis is empty but we have file data - seed Redis
          await replaceAllInRedis(memoryCache);
          logInfo(`Seeded Redis with ${memoryCache.length} signals from file`);
        }

        startBackgroundSync();
      } else {
        useRedis = false;
        if (SIGNAL_BUS_MODE === 'redis') {
          logError(
            'SIGNAL_BUS_MODE=redis but Redis is unreachable. Operating in file mode.'
          );
        } else {
          logWarn('Redis unavailable, using file-based signal bus');
        }
      }
    })
    .catch((err) => {
      useRedis = false;
      logWarn('Redis init error, using file fallback:', err.message);
    });
}

// ─── Public API (synchronous, matching agent-signal-bus.js exactly) ──────────

/**
 * Publish a signal to the bus.
 * @param {object} signal
 * @param {string} signal.type - Signal category
 * @param {string} signal.source - Agent name
 * @param {number} signal.confidence - 0-1 confidence score
 * @param {object} signal.payload - Arbitrary data
 * @param {number} [signal.ttlMs] - Custom TTL in ms
 * @returns {object} The published signal (with id and publishedAt)
 */
function publish(signal) {
  initSync();

  const entry = {
    id: `${signal.source || 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: String(signal.type || 'unknown'),
    source: String(signal.source || 'unknown'),
    confidence: Number(signal.confidence || 0),
    payload: signal.payload || {},
    ttlMs: Number(signal.ttlMs || DEFAULT_TTL_MS),
    publishedAt: Date.now(),
  };

  // Prune expired from cache
  memoryCache = prune(memoryCache);

  // Add to cache
  memoryCache.push(entry);
  if (memoryCache.length > 5000) { memoryCache = memoryCache.slice(-5000); }

  // Trim to MAX_SIGNALS (keep newest)
  if (memoryCache.length > MAX_SIGNALS) {
    memoryCache = memoryCache.slice(-MAX_SIGNALS);
  }

  if (useRedis && redisConnected) {
    // Fire-and-forget Redis write
    writeSignalToRedis(entry).catch((err) => {
      logWarn('Async Redis publish failed:', err.message);
      // Fall back: ensure file is updated
      saveToFile(memoryCache);
    });
  } else {
    // File mode: write synchronously
    saveToFile(memoryCache);
  }

  return entry;
}

/**
 * Query live (non-expired) signals.
 * @param {object} [filter]
 * @param {string} [filter.type] - Filter by signal type
 * @param {string} [filter.source] - Filter by source agent
 * @param {number} [filter.minConfidence] - Minimum confidence threshold
 * @param {number} [filter.maxAgeMs] - Maximum age in ms
 * @returns {Array} Matching signals sorted newest-first
 */
function query(filter = {}) {
  initSync();

  // Prune expired from cache
  memoryCache = prune(memoryCache);

  const now = Date.now();
  return memoryCache
    .filter((s) => {
      if (filter.type && s.type !== filter.type) return false;
      if (filter.source && s.source !== filter.source) return false;
      if (filter.minConfidence != null && s.confidence < filter.minConfidence) return false;
      if (filter.maxAgeMs != null && now - s.publishedAt > filter.maxAgeMs) return false;
      return true;
    })
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * Get consensus signal: the most common payload value for a type, weighted by confidence.
 * @param {string} type
 * @returns {{ value: string|null, confidence: number, count: number }}
 */
function consensus(type) {
  const signals = query({ type });
  if (!signals.length) return { value: null, confidence: 0, count: 0 };

  const buckets = {};
  for (const s of signals) {
    const key = JSON.stringify(s.payload);
    if (!buckets[key]) buckets[key] = { weight: 0, count: 0, payload: s.payload };
    buckets[key].weight += s.confidence;
    buckets[key].count += 1;
  }

  const best = Object.values(buckets).sort((a, b) => b.weight - a.weight)[0];
  return {
    value: best.payload,
    confidence: Number((best.weight / signals.length).toFixed(4)),
    count: best.count,
  };
}

/**
 * Return a compact summary of all active signal types and counts.
 */
function summary() {
  initSync();

  const signals = prune(memoryCache);
  const types = {};
  for (const s of signals) {
    if (!types[s.type]) types[s.type] = { count: 0, avgConfidence: 0, sources: new Set() };
    types[s.type].count += 1;
    types[s.type].avgConfidence += s.confidence;
    types[s.type].sources.add(s.source);
  }
  for (const t of Object.values(types)) {
    t.avgConfidence = Number((t.avgConfidence / t.count).toFixed(4));
    t.sources = [...t.sources];
  }
  return { totalSignals: signals.length, types };
}

/**
 * Get Redis connection health status.
 * @returns {{ connected: boolean, mode: 'redis'|'file', latencyMs: number }}
 */
function getRedisStatus() {
  return {
    connected: useRedis && redisConnected,
    mode: useRedis && redisConnected ? 'redis' : 'file',
    latencyMs: useRedis && redisConnected ? redisLatencyMs : -1,
  };
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

function shutdown() {
  stopBackgroundSync();

  // Persist final state to file as safety net
  if (memoryCache.length > 0) {
    try {
      saveToFile(prune(memoryCache));
    } catch (err) {
      logError('Shutdown file save failed:', err.message);
    }
  }

  // Disconnect Redis
  if (redisClient) {
    try {
      redisClient.disconnect();
    } catch {
      // Ignore disconnect errors during shutdown
    }
    redisClient = null;
    redisConnected = false;
  }
}

process.on('exit', shutdown);
process.on('SIGINT', () => { shutdown(); process.exit(130); });
process.on('SIGTERM', () => { shutdown(); process.exit(143); });

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { publish, query, consensus, summary, SIGNAL_FILE, getRedisStatus };
