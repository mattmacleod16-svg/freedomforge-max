/**
 * Multi-Source Price Aggregator
 * ═════════════════════════════
 *
 * Fetches prices from multiple exchanges simultaneously and computes
 * a robust median/VWAP aggregated price. Eliminates single-source
 * dependency (was Binance-only with Coinbase fallback).
 *
 * Sources: Binance, Coinbase, Kraken, OKX, CoinGecko
 * Aggregation: Volume-weighted median with outlier rejection
 *
 * Exports:
 *   getAggregatedPrice(asset)     - best-effort multi-source spot price
 *   getAggregatedCandles(asset, interval, limit)  - multi-source OHLCV
 *   getSourceHealth()             - per-source latency + success rates
 *   updateConfig(cfg)             - runtime config override
 */

'use strict';

const { createLogger } = require('./logger');
const log = createLogger('price-agg');

// ─── Configuration ───────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = Math.max(2000, Number(process.env.PRICE_AGG_TIMEOUT_MS || 5000));
const STALE_THRESHOLD_MS = Math.max(5000, Number(process.env.PRICE_AGG_STALE_MS || 30000));
const MIN_SOURCES = Math.max(1, Math.min(5, Number(process.env.PRICE_AGG_MIN_SOURCES || 2)));
const OUTLIER_DEVIATION = Math.max(0.005, Number(process.env.PRICE_AGG_OUTLIER_DEV || 0.03)); // 3% deviation = outlier

// ─── Asset Maps per Exchange ─────────────────────────────────────────────────

const BINANCE_SYMBOLS = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', DOGE: 'DOGEUSDT',
  AVAX: 'AVAXUSDT', LINK: 'LINKUSDT', MATIC: 'MATICUSDT', ARB: 'ARBUSDT',
  OP: 'OPUSDT', XRP: 'XRPUSDT', ADA: 'ADAUSDT', DOT: 'DOTUSDT',
};

const COINBASE_PRODUCTS = {
  BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD', DOGE: 'DOGE-USD',
  AVAX: 'AVAX-USD', LINK: 'LINK-USD', MATIC: 'MATIC-USD', ARB: 'ARB-USD',
  OP: 'OP-USD', XRP: 'XRP-USD', ADA: 'ADA-USD', DOT: 'DOT-USD',
};

const KRAKEN_PAIRS = {
  BTC: 'XXBTZUSD', ETH: 'XETHZUSD', SOL: 'SOLUSD', DOGE: 'XDGUSD',
  AVAX: 'AVAXUSD', LINK: 'LINKUSD', MATIC: 'MATICUSD', ADA: 'ADAUSD',
  DOT: 'DOTUSD', XRP: 'XXRPZUSD', ARB: 'ARBUSD', OP: 'OPUSD',
};

const COINGECKO_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', DOGE: 'dogecoin',
  AVAX: 'avalanche-2', LINK: 'chainlink', MATIC: 'matic-network',
  ARB: 'arbitrum', OP: 'optimism', XRP: 'ripple', ADA: 'cardano', DOT: 'polkadot',
};

// ─── Per-Source Health Tracking ──────────────────────────────────────────────

const sourceHealth = {
  binance:  { success: 0, fail: 0, totalLatencyMs: 0, lastSuccessAt: 0 },
  coinbase: { success: 0, fail: 0, totalLatencyMs: 0, lastSuccessAt: 0 },
  kraken:   { success: 0, fail: 0, totalLatencyMs: 0, lastSuccessAt: 0 },
  coingecko:{ success: 0, fail: 0, totalLatencyMs: 0, lastSuccessAt: 0 },
};

// ─── Price Cache ─────────────────────────────────────────────────────────────

const priceCache = new Map(); // asset => { price, volume, source, ts }[]

// ─── Fetch Helpers ───────────────────────────────────────────────────────────

async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

function recordSourceResult(source, success, latencyMs) {
  const h = sourceHealth[source];
  if (!h) return;
  if (success) {
    h.success++;
    h.totalLatencyMs += latencyMs;
    h.lastSuccessAt = Date.now();
  } else {
    h.fail++;
  }
}

// ─── Individual Source Fetchers ──────────────────────────────────────────────

async function fetchBinancePrice(asset) {
  const symbol = BINANCE_SYMBOLS[asset];
  if (!symbol) return null;
  const t0 = Date.now();
  try {
    const data = await fetchWithTimeout(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
    const price = Number(data.lastPrice);
    const volume = Number(data.quoteVolume || 0);
    if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
    recordSourceResult('binance', true, Date.now() - t0);
    return { source: 'binance', price, volume, ts: Date.now() };
  } catch (err) {
    recordSourceResult('binance', false, Date.now() - t0);
    return null;
  }
}

async function fetchCoinbasePrice(asset) {
  const product = COINBASE_PRODUCTS[asset];
  if (!product) return null;
  const t0 = Date.now();
  try {
    const data = await fetchWithTimeout(`https://api.exchange.coinbase.com/products/${product}/ticker`);
    const price = Number(data.price);
    const volume = Number(data.volume || 0) * price; // convert base vol to quote vol
    if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
    recordSourceResult('coinbase', true, Date.now() - t0);
    return { source: 'coinbase', price, volume, ts: Date.now() };
  } catch (err) {
    recordSourceResult('coinbase', false, Date.now() - t0);
    return null;
  }
}

async function fetchKrakenPrice(asset) {
  const pair = KRAKEN_PAIRS[asset];
  if (!pair) return null;
  const t0 = Date.now();
  try {
    const data = await fetchWithTimeout(`https://api.kraken.com/0/public/Ticker?pair=${pair}`);
    if (data.error?.length) throw new Error(data.error[0]);
    const keys = Object.keys(data.result || {});
    if (!keys.length) throw new Error('no result');
    const ticker = data.result[keys[0]];
    const price = Number(ticker.c?.[0]); // last trade close price
    const volume = Number(ticker.v?.[1] || 0) * price; // 24h volume in quote
    if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
    recordSourceResult('kraken', true, Date.now() - t0);
    return { source: 'kraken', price, volume, ts: Date.now() };
  } catch (err) {
    recordSourceResult('kraken', false, Date.now() - t0);
    return null;
  }
}

async function fetchCoinGeckoPrice(asset) {
  const id = COINGECKO_IDS[asset];
  if (!id) return null;
  const t0 = Date.now();
  try {
    const data = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_vol=true`,
      8000 // CoinGecko can be slow
    );
    const entry = data[id];
    if (!entry) throw new Error('no data');
    const price = Number(entry.usd);
    const volume = Number(entry.usd_24h_vol || 0);
    if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price');
    recordSourceResult('coingecko', true, Date.now() - t0);
    return { source: 'coingecko', price, volume, ts: Date.now() };
  } catch (err) {
    recordSourceResult('coingecko', false, Date.now() - t0);
    return null;
  }
}

// ─── Aggregation Logic ──────────────────────────────────────────────────────

/**
 * Reject outliers that deviate > OUTLIER_DEVIATION from the median.
 */
function rejectOutliers(quotes) {
  if (quotes.length <= 2) return quotes;
  const prices = quotes.map(q => q.price).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  return quotes.filter(q => Math.abs(q.price - median) / median <= OUTLIER_DEVIATION);
}

/**
 * Compute volume-weighted average price from multiple quotes.
 */
function computeVWAP(quotes) {
  if (quotes.length === 0) return null;
  if (quotes.length === 1) return quotes[0].price;

  const totalVol = quotes.reduce((sum, q) => sum + (q.volume || 1), 0);
  if (totalVol <= 0) {
    // fallback to simple median
    const sorted = quotes.map(q => q.price).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  return quotes.reduce((sum, q) => sum + q.price * ((q.volume || 1) / totalVol), 0);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get aggregated multi-source price for an asset.
 * Fetches from all sources in parallel, rejects outliers, computes VWAP.
 *
 * @param {string} asset - BTC, ETH, SOL, etc.
 * @returns {Promise<{price: number, sources: number, quotes: object[], confidence: number}|null>}
 */
async function getAggregatedPrice(asset) {
  const assetUp = (asset || 'BTC').toUpperCase();

  const results = await Promise.allSettled([
    fetchBinancePrice(assetUp),
    fetchCoinbasePrice(assetUp),
    fetchKrakenPrice(assetUp),
    fetchCoinGeckoPrice(assetUp),
  ]);

  const quotes = results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);

  if (quotes.length === 0) {
    log.warn('No price sources responded', { asset: assetUp });
    return null;
  }

  const cleanQuotes = rejectOutliers(quotes);
  const vwap = computeVWAP(cleanQuotes);
  if (!Number.isFinite(vwap)) return null;

  // Confidence = fraction of sources that agree within bounds
  const confidence = Math.min(1.0, cleanQuotes.length / 4);

  // Update cache
  priceCache.set(assetUp, { price: vwap, quotes: cleanQuotes, ts: Date.now() });

  // Publish to event mesh if available
  try {
    const eventMesh = require('./event-mesh');
    eventMesh.publish('price.aggregated', {
      asset: assetUp,
      price: vwap,
      sources: cleanQuotes.length,
      confidence,
    });
  } catch { /* event mesh optional */ }

  return {
    price: vwap,
    sources: cleanQuotes.length,
    confidence,
    quotes: cleanQuotes.map(q => ({ source: q.source, price: q.price, volume: Math.round(q.volume) })),
    stale: false,
  };
}

/**
 * Get cached price if fresh enough, otherwise fetch new.
 */
async function getCachedOrFreshPrice(asset) {
  const assetUp = (asset || 'BTC').toUpperCase();
  const cached = priceCache.get(assetUp);
  if (cached && (Date.now() - cached.ts) < STALE_THRESHOLD_MS) {
    return { price: cached.price, sources: cached.quotes.length, stale: false, fromCache: true };
  }
  return getAggregatedPrice(assetUp);
}

/**
 * Get per-source health statistics.
 */
function getSourceHealth() {
  const result = {};
  for (const [name, h] of Object.entries(sourceHealth)) {
    const total = h.success + h.fail;
    result[name] = {
      successRate: total > 0 ? Math.round(h.success / total * 1000) / 10 : 0,
      avgLatencyMs: h.success > 0 ? Math.round(h.totalLatencyMs / h.success) : 0,
      totalRequests: total,
      lastSuccessAt: h.lastSuccessAt || null,
      healthy: h.lastSuccessAt > 0 && (Date.now() - h.lastSuccessAt) < 300000, // 5 min
    };
  }
  return result;
}

/**
 * Batch fetch prices for multiple assets at once.
 */
async function batchGetPrices(assets) {
  const results = {};
  const fetches = assets.map(async (asset) => {
    const r = await getAggregatedPrice(asset);
    results[asset] = r;
  });
  await Promise.allSettled(fetches);
  return results;
}

module.exports = { getAggregatedPrice, getCachedOrFreshPrice, getSourceHealth, batchGetPrices };
