/**
 * Backtest Data Loader — Historical OHLCV candle fetcher with caching.
 * =====================================================================
 *
 * Fetches historical candle data from Binance (primary) and Coinbase (fallback),
 * caches results locally, and handles pagination for large date ranges.
 *
 * Usage:
 *   const { fetchHistoricalCandles } = require('../lib/backtest/data-loader');
 *   const candles = await fetchHistoricalCandles({
 *     asset: 'BTC',
 *     interval: '1h',
 *     startDate: '2024-01-01',
 *     endDate: '2024-06-01',
 *   });
 *   // candles = [{ ts, open, high, low, close, volume }, ...]
 */

const fs = require('fs');
const path = require('path');

// ─── Resilient I/O (optional) ─────────────────────────────────────────────────
let rio;
try { rio = require('../resilient-io'); } catch { rio = null; }

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_DIR = path.resolve(process.cwd(), 'data', 'backtest-cache');

const ASSET_MAP = {
  BTC:   { binance: 'BTCUSDT',   coinbase: 'BTC-USD'   },
  ETH:   { binance: 'ETHUSDT',   coinbase: 'ETH-USD'   },
  SOL:   { binance: 'SOLUSDT',   coinbase: 'SOL-USD'   },
  DOGE:  { binance: 'DOGEUSDT',  coinbase: 'DOGE-USD'  },
  AVAX:  { binance: 'AVAXUSDT',  coinbase: 'AVAX-USD'  },
  LINK:  { binance: 'LINKUSDT',  coinbase: 'LINK-USD'  },
  MATIC: { binance: 'MATICUSDT', coinbase: 'MATIC-USD' },
  ARB:   { binance: 'ARBUSDT',   coinbase: 'ARB-USD'   },
  OP:    { binance: 'OPUSDT',    coinbase: 'OP-USD'    },
  XRP:   { binance: 'XRPUSDT',   coinbase: 'XRP-USD'   },
};

const BINANCE_MAX_CANDLES = 1000;
const COINBASE_MAX_CANDLES = 300;
const REQUEST_TIMEOUT_MS = 15000;
const RATE_LIMIT_DELAY_MS = 200;

/** Binance interval strings (passthrough) */
const BINANCE_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];

/** Coinbase granularity in seconds */
const COINBASE_GRANULARITY = {
  '1m':  60,
  '5m':  300,
  '15m': 900,
  '1h':  3600,
  '4h':  14400,
  '1d':  86400,
};

/** Interval durations in milliseconds — used for pagination math */
const INTERVAL_MS = {
  '1m':  60 * 1000,
  '5m':  5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h':  60 * 60 * 1000,
  '4h':  4 * 60 * 60 * 1000,
  '1d':  24 * 60 * 60 * 1000,
};

const TAG = '[backtest-data]';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Native fetch with AbortController timeout.
 * @param {string} url
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch JSON with timeout. Returns null on failure.
 * @param {string} url
 * @returns {Promise<any|null>}
 */
async function fetchJson(url) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      console.error(`${TAG} HTTP ${res.status} from ${url}`);
      return null;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'timeout' : err.message;
    console.error(`${TAG} Fetch failed (${reason}): ${url}`);
    return null;
  }
}

/**
 * Ensure the cache directory exists.
 */
function ensureCacheDir() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch (err) {
    console.error(`${TAG} Failed to create cache dir: ${err.message}`);
  }
}

/**
 * Build the cache file path for a given query.
 * @param {string} asset
 * @param {string} interval
 * @param {string} startDate
 * @param {string} endDate
 * @returns {string}
 */
function cacheFilePath(asset, interval, startDate, endDate) {
  const safeName = `${asset}-${interval}-${startDate}-${endDate}.json`;
  return path.join(CACHE_DIR, safeName);
}

/**
 * Read cached candles from disk if available.
 * @param {string} filePath
 * @returns {Array|null}
 */
function readCache(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data) && data.length > 0) {
      return data;
    }
    return null;
  } catch (err) {
    console.error(`${TAG} Cache read failed for ${path.basename(filePath)}: ${err.message}`);
    return null;
  }
}

/**
 * Write candle data to the cache.
 * Uses resilient-io atomic write if available, otherwise plain fs.
 * @param {string} filePath
 * @param {Array} candles
 */
function writeCache(filePath, candles) {
  try {
    ensureCacheDir();
    if (rio && typeof rio.writeJsonAtomic === 'function') {
      rio.writeJsonAtomic(filePath, candles, { lock: false, backups: 0 });
    } else {
      fs.writeFileSync(filePath, JSON.stringify(candles, null, 2), 'utf8');
    }
  } catch (err) {
    console.error(`${TAG} Cache write failed for ${path.basename(filePath)}: ${err.message}`);
  }
}

// ─── Binance Fetcher (paginated) ──────────────────────────────────────────────

/**
 * Fetch historical candles from Binance with automatic pagination.
 * Binance /api/v3/klines returns max 1000 candles per request.
 *
 * @param {string} symbol  - e.g. 'BTCUSDT'
 * @param {string} interval - e.g. '1h'
 * @param {number} startMs  - start time in ms
 * @param {number} endMs    - end time in ms
 * @param {string} asset    - for logging
 * @returns {Promise<Array<{ts, open, high, low, close, volume}>>}
 */
async function fetchBinanceCandles(symbol, interval, startMs, endMs, asset) {
  if (!BINANCE_INTERVALS.includes(interval)) {
    console.error(`${TAG} Unsupported Binance interval: ${interval}`);
    return [];
  }

  const allCandles = [];
  let currentStart = startMs;
  const intervalMs = INTERVAL_MS[interval];
  if (!intervalMs) return [];

  // Estimate total candle count for progress logging
  const estimatedTotal = Math.ceil((endMs - startMs) / intervalMs);

  while (currentStart < endMs) {
    const url =
      `https://api.binance.com/api/v3/klines` +
      `?symbol=${symbol}` +
      `&interval=${interval}` +
      `&startTime=${currentStart}` +
      `&endTime=${endMs}` +
      `&limit=${BINANCE_MAX_CANDLES}`;

    const data = await fetchJson(url);

    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    for (const k of data) {
      const candle = {
        ts:     Number(k[0]),
        open:   Number(k[1]),
        high:   Number(k[2]),
        low:    Number(k[3]),
        close:  Number(k[4]),
        volume: Number(k[5]),
      };
      // Validate numeric fields
      if (Number.isFinite(candle.close) && candle.close > 0 && candle.ts >= startMs && candle.ts <= endMs) {
        allCandles.push(candle);
      }
    }

    console.log(`${TAG} Fetched ${allCandles.length}/${estimatedTotal} candles for ${asset} (Binance)...`);

    // Advance startTime past the last candle we received
    const lastTs = Number(data[data.length - 1][0]);
    if (lastTs <= currentStart) {
      // Safety: avoid infinite loop if API returns same data
      break;
    }
    currentStart = lastTs + intervalMs;

    // If we got fewer than the max, we have all available data
    if (data.length < BINANCE_MAX_CANDLES) {
      break;
    }

    // Rate limit delay between paginated requests
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  return allCandles;
}

// ─── Coinbase Fetcher (paginated) ─────────────────────────────────────────────

/**
 * Fetch historical candles from Coinbase as fallback.
 * Coinbase returns max 300 candles per request.
 * Candle format: [timestamp, low, high, open, close, volume]
 *
 * @param {string} productId - e.g. 'BTC-USD'
 * @param {string} interval  - e.g. '1h'
 * @param {number} startMs   - start time in ms
 * @param {number} endMs     - end time in ms
 * @param {string} asset     - for logging
 * @returns {Promise<Array<{ts, open, high, low, close, volume}>>}
 */
async function fetchCoinbaseCandles(productId, interval, startMs, endMs, asset) {
  const granularity = COINBASE_GRANULARITY[interval];
  if (!granularity) {
    console.error(`${TAG} Unsupported Coinbase interval: ${interval}`);
    return [];
  }

  const allCandles = [];
  const intervalMs = INTERVAL_MS[interval];
  if (!intervalMs) return [];

  // Coinbase expects ISO timestamps for start/end
  let currentStart = startMs;
  const estimatedTotal = Math.ceil((endMs - startMs) / intervalMs);

  while (currentStart < endMs) {
    // Each request covers at most COINBASE_MAX_CANDLES intervals
    const batchEndMs = Math.min(endMs, currentStart + COINBASE_MAX_CANDLES * intervalMs);

    const startISO = new Date(currentStart).toISOString();
    const endISO = new Date(batchEndMs).toISOString();

    const url =
      `https://api.exchange.coinbase.com/products/${productId}/candles` +
      `?granularity=${granularity}` +
      `&start=${startISO}` +
      `&end=${endISO}`;

    const data = await fetchJson(url);

    if (!Array.isArray(data) || data.length === 0) {
      // No more data available
      break;
    }

    // Coinbase returns newest first; reverse to get chronological order
    const sorted = data.slice().sort((a, b) => a[0] - b[0]);

    for (const c of sorted) {
      const ts = Number(c[0]) * 1000; // Coinbase returns seconds
      if (ts < startMs || ts > endMs) continue;

      const candle = {
        ts,
        open:   Number(c[3]),
        high:   Number(c[2]),
        low:    Number(c[1]),
        close:  Number(c[4]),
        volume: Number(c[5]),
      };

      if (Number.isFinite(candle.close) && candle.close > 0) {
        allCandles.push(candle);
      }
    }

    console.log(`${TAG} Fetched ${allCandles.length}/${estimatedTotal} candles for ${asset} (Coinbase)...`);

    // Advance past this batch
    currentStart = batchEndMs;

    if (data.length < COINBASE_MAX_CANDLES) {
      break;
    }

    // Rate limit delay
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  return allCandles;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Fetch historical OHLCV candles for backtesting.
 *
 * @param {object} opts
 * @param {string} opts.asset      - Asset symbol: 'BTC', 'ETH', 'SOL', etc.
 * @param {string} opts.interval   - Candle interval: '1m', '5m', '15m', '1h', '4h', '1d'
 * @param {string} opts.startDate  - Start date ISO string: '2024-01-01'
 * @param {string} opts.endDate    - End date ISO string: '2024-06-01'
 * @returns {Promise<Array<{ts: number, open: number, high: number, low: number, close: number, volume: number}>>}
 */
async function fetchHistoricalCandles({ asset, interval, startDate, endDate }) {
  // ── Validate inputs ──
  if (!asset || typeof asset !== 'string') {
    throw new Error(`${TAG} "asset" is required (e.g. 'BTC', 'ETH')`);
  }
  const assetUpper = asset.toUpperCase();
  const ids = ASSET_MAP[assetUpper];
  if (!ids) {
    throw new Error(`${TAG} Unsupported asset: "${asset}". Supported: ${Object.keys(ASSET_MAP).join(', ')}`);
  }

  if (!interval || !INTERVAL_MS[interval]) {
    throw new Error(`${TAG} Unsupported interval: "${interval}". Supported: ${Object.keys(INTERVAL_MS).join(', ')}`);
  }

  if (!startDate || !endDate) {
    throw new Error(`${TAG} "startDate" and "endDate" are required (ISO format, e.g. '2024-01-01')`);
  }

  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();

  if (isNaN(startMs) || isNaN(endMs)) {
    throw new Error(`${TAG} Invalid date format. Use ISO strings like '2024-01-01'.`);
  }

  if (startMs >= endMs) {
    throw new Error(`${TAG} startDate must be before endDate.`);
  }

  // ── Check cache ──
  const cachePath = cacheFilePath(assetUpper, interval, startDate, endDate);
  const cached = readCache(cachePath);
  if (cached) {
    console.log(`${TAG} Cache hit: ${path.basename(cachePath)} (${cached.length} candles)`);
    return cached;
  }

  console.log(`${TAG} Fetching ${assetUpper} ${interval} candles from ${startDate} to ${endDate}...`);

  // ── Fetch from Binance (primary) ──
  let candles = await fetchBinanceCandles(ids.binance, interval, startMs, endMs, assetUpper);

  // ── Fallback to Coinbase if Binance returned no data ──
  if (!candles || candles.length === 0) {
    console.log(`${TAG} Binance returned no data for ${assetUpper}. Falling back to Coinbase...`);
    candles = await fetchCoinbaseCandles(ids.coinbase, interval, startMs, endMs, assetUpper);
  }

  if (!candles || candles.length === 0) {
    console.warn(`${TAG} No candle data available for ${assetUpper} ${interval} from ${startDate} to ${endDate}`);
    return [];
  }

  // ── Deduplicate and sort by timestamp ascending ──
  const seen = new Set();
  const deduped = [];
  for (const c of candles) {
    if (!seen.has(c.ts)) {
      seen.add(c.ts);
      deduped.push(c);
    }
  }
  deduped.sort((a, b) => a.ts - b.ts);

  console.log(`${TAG} Completed: ${deduped.length} candles for ${assetUpper} ${interval} [${startDate} -> ${endDate}]`);

  // ── Write to cache ──
  writeCache(cachePath, deduped);

  return deduped;
}

// ─── Cache Management ─────────────────────────────────────────────────────────

/**
 * Remove all cached backtest data files.
 * @returns {{ removed: number, errors: string[] }}
 */
function clearCache() {
  const result = { removed: 0, errors: [] };

  try {
    if (!fs.existsSync(CACHE_DIR)) {
      return result;
    }

    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(CACHE_DIR, file);
      try {
        fs.unlinkSync(filePath);
        result.removed++;
      } catch (err) {
        result.errors.push(`${file}: ${err.message}`);
      }
    }

    console.log(`${TAG} Cache cleared: ${result.removed} files removed.`);
  } catch (err) {
    result.errors.push(`readdir: ${err.message}`);
    console.error(`${TAG} Failed to clear cache: ${err.message}`);
  }

  return result;
}

/**
 * Get information about cached backtest data files.
 * @returns {Array<{ file: string, sizeBytes: number, sizeKB: string }>}
 */
function getCacheInfo() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      return [];
    }

    const files = fs.readdirSync(CACHE_DIR);
    const info = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(CACHE_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        info.push({
          file,
          sizeBytes: stat.size,
          sizeKB: (stat.size / 1024).toFixed(1) + ' KB',
        });
      } catch {
        // Skip files we cannot stat
      }
    }

    return info;
  } catch (err) {
    console.error(`${TAG} Failed to read cache info: ${err.message}`);
    return [];
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  fetchHistoricalCandles,
  clearCache,
  getCacheInfo,
};
