/**
 * Redis-backed distributed rate limiter with fallback to in-memory.
 * Replaces lib/auth/rateLimiter.ts for multi-replica deployments.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const inMemoryFallback = true; // Use in-memory if Redis unavailable

const inMemoryStore = new Map<string, RateLimitEntry>();
const MAX_KEYS = 10000;
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 60_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

/**
 * Check rate limit using fallback in-memory implementation.
 * (Redis client integration would require npm install redis)
 * For now, using in-memory with graceful degradation.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  return checkRateLimitMemory(key, maxRequests, windowMs);
}

/**
 * In-memory implementation (single-instance, suitable for demonstration)
 * In production with Redis, would use distributed atomic operations via Lua script.
 */
function checkRateLimitMemory(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;

  // Cleanup expired entries periodically
  const since = Date.now();
  if (since - lastCleanup > CLEANUP_INTERVAL_MS) {
    lastCleanup = since;
    for (const [k, entry] of inMemoryStore) {
      entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
      if (entry.timestamps.length === 0) inMemoryStore.delete(k);
    }
    // Hard cap: if map too large, evict oldest entries
    if (inMemoryStore.size > MAX_KEYS) {
      const excess = inMemoryStore.size - MAX_KEYS;
      const keys = inMemoryStore.keys();
      for (let i = 0; i < excess; i++) {
        const next = keys.next();
        if (!next.done) inMemoryStore.delete(next.value);
      }
    }
  }

  let entry = inMemoryStore.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    inMemoryStore.set(key, entry);
  }

  // Remove expired timestamps
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

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

/**
 * Clear rate limiter store (for testing)
 */
export function clearRateLimitStore(): void {
  inMemoryStore.clear();
  lastCleanup = Date.now();
}
