/**
 * Health Check Module — Pre-flight validation for external services.
 * Prevents trades/mutations from being sent to unreachable backends.
 */

interface HealthCheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  timestamp: number;
}

const CACHE_TTL_MS = 5000; // Cache health for 5s
const cache = new Map<string, { result: HealthCheckResult; expiresAt: number }>();

async function cachedCheck(
  key: string,
  checkFn: () => Promise<HealthCheckResult>
): Promise<HealthCheckResult> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const result = await checkFn();
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

/**
 * Ping OCI backend (Coinbase + Kraken trading gateway)
 * OCI address: 150.136.245.31:9091
 */
export async function pingOCI(
  timeoutMs: number = 2000
): Promise<HealthCheckResult> {
  return cachedCheck('oci', async () => {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // Call a lightweight OCI endpoint (assumes /health exists)
      const res = await fetch('http://150.136.245.31:9091/health', {
        method: 'GET',
        signal: controller.signal,
      }).catch(() => {
        throw new Error('OCI unreachable');
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;

      if (!res.ok) {
        return { ok: false, latencyMs, error: `HTTP ${res.status}`, timestamp: Date.now() };
      }

      return { ok: true, latencyMs, timestamp: Date.now() };
    } catch (err) {
      const latencyMs = Date.now() - start;
      return {
        ok: false,
        latencyMs,
        error: err instanceof Error ? err.message : 'Unknown error',
        timestamp: Date.now(),
      };
    }
  });
}

/**
 * Validate Coinbase API connectivity
 */
export async function validateCoinbaseConnection(
  timeoutMs: number = 2000
): Promise<HealthCheckResult> {
  return cachedCheck('coinbase', async () => {
    const start = Date.now();
    try {
      const apiKey = process.env.COINBASE_API_KEY;
      if (!apiKey) {
        return {
          ok: false,
          latencyMs: 0,
          error: 'No COINBASE_API_KEY configured',
          timestamp: Date.now(),
        };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch('https://api.coinbase.com/v1/currency?currency=BTC', {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      }).catch(() => {
        throw new Error('Coinbase unreachable');
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;

      if (res.status === 401 || res.status === 403) {
        return { ok: false, latencyMs, error: 'Invalid Coinbase credentials', timestamp: Date.now() };
      }
      if (!res.ok) {
        return { ok: false, latencyMs, error: `HTTP ${res.status}`, timestamp: Date.now() };
      }

      return { ok: true, latencyMs, timestamp: Date.now() };
    } catch (err) {
      const latencyMs = Date.now() - start;
      return {
        ok: false,
        latencyMs,
        error: err instanceof Error ? err.message : 'Unknown error',
        timestamp: Date.now(),
      };
    }
  });
}

/**
 * Validate Kraken API connectivity
 */
export async function validateKrakenConnection(
  timeoutMs: number = 2000
): Promise<HealthCheckResult> {
  return cachedCheck('kraken', async () => {
    const start = Date.now();
    try {
      const apiKey = process.env.KRAKEN_API_KEY;
      if (!apiKey) {
        return {
          ok: false,
          latencyMs: 0,
          error: 'No KRAKEN_API_KEY configured',
          timestamp: Date.now(),
        };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch('https://api.kraken.com/0/public/Time', {
        method: 'GET',
        signal: controller.signal,
      }).catch(() => {
        throw new Error('Kraken unreachable');
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;

      if (!res.ok) {
        return { ok: false, latencyMs, error: `HTTP ${res.status}`, timestamp: Date.now() };
      }

      return { ok: true, latencyMs, timestamp: Date.now() };
    } catch (err) {
      const latencyMs = Date.now() - start;
      return {
        ok: false,
        latencyMs,
        error: err instanceof Error ? err.message : 'Unknown error',
        timestamp: Date.now(),
      };
    }
  });
}

/**
 * Validate specific exchange before trade
 */
export async function validateExchangeConnection(
  exchange: 'coinbase' | 'kraken',
  timeoutMs: number = 2000
): Promise<HealthCheckResult> {
  if (exchange === 'coinbase') {
    return validateCoinbaseConnection(timeoutMs);
  } else if (exchange === 'kraken') {
    return validateKrakenConnection(timeoutMs);
  }
  return {
    ok: false,
    latencyMs: 0,
    error: `Unknown exchange: ${exchange}`,
    timestamp: Date.now(),
  };
}

/**
 * Clear health check cache (for testing)
 */
export function clearHealthCheckCache(): void {
  cache.clear();
}
