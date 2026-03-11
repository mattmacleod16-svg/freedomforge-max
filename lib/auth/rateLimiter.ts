/**
 * Simple in-memory sliding-window rate limiter for API endpoints.
 * Designed for Edge/Node.js middleware — no external dependencies.
 *
 * Bounded: evicts expired entries to prevent OOM. Map size capped at MAX_KEYS.
 */

interface RateLimitEntry {
  /** Timestamps of requests within the window */
  timestamps: number[];
}

const MAX_KEYS = 10000; // Max unique IPs tracked before eviction
const store = new Map<string, RateLimitEntry>();
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 60_000; // Evict stale entries every 60s

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  const cutoff = now - windowMs;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
  // Hard cap: if map still too large, evict oldest entries
  if (store.size > MAX_KEYS) {
    const excess = store.size - MAX_KEYS;
    const keys = store.keys();
    for (let i = 0; i < excess; i++) {
      const next = keys.next();
      if (!next.done) store.delete(next.value);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

/**
 * Check if a request from `key` (typically IP) is within rate limits.
 * @param key - Unique identifier (e.g., IP address)
 * @param maxRequests - Max requests allowed within the window
 * @param windowMs - Sliding window duration in milliseconds
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  cleanup(windowMs);

  const now = Date.now();
  const cutoff = now - windowMs;
  let entry = store.get(key);

  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove expired timestamps
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= maxRequests) {
    const oldest = entry.timestamps[0] || now;
    return {
      allowed: false,
      remaining: 0,
      resetMs: oldest + windowMs - now,
    };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    resetMs: windowMs,
  };
}
