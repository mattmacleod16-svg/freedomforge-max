#!/usr/bin/env node

/**
 * Cross-Venue Arbitrage Scanner
 * ========================================================================
 *
 * Detects price discrepancies between Coinbase, Kraken, and Binance for
 * the same assets, then publishes profitable opportunities to the signal
 * bus for downstream trading engines to consume.
 *
 * Designed to run as a systemd timer or cron job every 30-120 seconds.
 *
 * Usage:
 *   ARB_SCANNER_ENABLED=true node scripts/arb-scanner.js
 */

const path = require('path');
const dotenv = require('dotenv');
const { createLogger } = require('../lib/logger');
const logger = createLogger('arb-scanner');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

// ─── Configuration ──────────────────────────────────────────────────────────

const ENABLED       = String(process.env.ARB_SCANNER_ENABLED || 'false').toLowerCase() === 'true';
const INTERVAL_SEC  = Math.min(3600, Math.max(10, parseInt(process.env.ARB_SCANNER_INTERVAL_SEC || '60', 10)));
const MIN_SPREAD_BPS = Math.min(1000, Math.max(1, Number(process.env.ARB_MIN_SPREAD_BPS || 15)));
const ARB_ASSETS    = String(process.env.ARB_ASSETS || 'BTC,ETH,SOL,XRP,DOGE')
  .split(',')
  .map((a) => a.trim().toUpperCase())
  .filter(Boolean);

const STATE_FILE    = path.resolve(process.cwd(), 'data/arb-scanner-state.json');
const MAX_HISTORY   = 500;  // Cap opportunity history
const MAX_SPREADS   = 200;  // Cap spread snapshots per venue pair

// ─── Venue Fee Schedule (bps) ──────────────────────────────────────────────
// Conservative fee estimates; taker fees including spread cost.

const VENUE_FEE_BPS = {
  coinbase: 60,
  kraken:   26,
  binance:  10,
};

// ─── Pair Maps ──────────────────────────────────────────────────────────────

const PAIR_MAP = {
  BTC:  { coinbase: 'BTC-USD',  kraken: 'XXBTZUSD', binance: 'BTCUSDT' },
  ETH:  { coinbase: 'ETH-USD',  kraken: 'XETHZUSD', binance: 'ETHUSDT' },
  SOL:  { coinbase: 'SOL-USD',  kraken: 'SOLUSD',   binance: 'SOLUSDT' },
  XRP:  { coinbase: 'XRP-USD',  kraken: 'XXRPZUSD', binance: 'XRPUSDT' },
  DOGE: { coinbase: 'DOGE-USD', kraken: 'XDGUSD',   binance: 'DOGEUSDT' },
};

// ─── Dependencies ───────────────────────────────────────────────────────────

let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

let signalBus;
try { signalBus = require('../lib/agent-signal-bus'); } catch { signalBus = null; }

// ─── State Persistence ──────────────────────────────────────────────────────

function loadState() {
  if (rio) {
    return rio.readJsonSafe(STATE_FILE, {
      fallback: { lastRunTs: 0, opportunities: [], spreads: {}, stats: {} },
    });
  }
  try {
    const fs = require('fs');
    if (!fs.existsSync(STATE_FILE)) return { lastRunTs: 0, opportunities: [], spreads: {}, stats: {} };
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastRunTs: 0, opportunities: [], spreads: {}, stats: {} };
  }
}

function saveState(state) {
  // Cap arrays to prevent unbounded growth
  if (Array.isArray(state.opportunities) && state.opportunities.length > MAX_HISTORY) {
    state.opportunities = state.opportunities.slice(-MAX_HISTORY);
  }
  for (const key of Object.keys(state.spreads || {})) {
    if (Array.isArray(state.spreads[key]) && state.spreads[key].length > MAX_SPREADS) {
      state.spreads[key] = state.spreads[key].slice(-MAX_SPREADS);
    }
  }

  if (rio) {
    rio.writeJsonAtomic(STATE_FILE, state);
    return;
  }
  const fs = require('fs');
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Price Fetching ─────────────────────────────────────────────────────────

/**
 * Fetch bid/ask from Coinbase Exchange.
 * GET https://api.exchange.coinbase.com/products/{PAIR}/ticker
 * Response: { price, bid, ask, ... }
 *
 * @param {string} pair - e.g. 'BTC-USD'
 * @returns {Promise<{bid: number, ask: number}|null>}
 */
async function fetchCoinbase(pair) {
  const url = `https://api.exchange.coinbase.com/products/${pair}/ticker`;
  try {
    const res = rio
      ? await rio.fetchJsonRetry(url, {}, { retries: 1, timeoutMs: 10000 })
      : await fetchJsonFallback(url);
    if (!res || !res.bid || !res.ask) return null;
    const bid = Number(res.bid);
    const ask = Number(res.ask);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return null;
    return { bid, ask };
  } catch (err) {
    logger.error(`Coinbase fetch failed for ${pair}`, { error: err.message || err });
    return null;
  }
}

/**
 * Fetch bid/ask from Kraken.
 * GET https://api.kraken.com/0/public/Ticker?pair={PAIR}
 * Response: { error: [], result: { XXBTZUSD: { a: [askPrice, ...], b: [bidPrice, ...] } } }
 *
 * @param {string} pair - e.g. 'XXBTZUSD'
 * @returns {Promise<{bid: number, ask: number}|null>}
 */
async function fetchKraken(pair) {
  const url = `https://api.kraken.com/0/public/Ticker?pair=${pair}`;
  try {
    const res = rio
      ? await rio.fetchJsonRetry(url, {}, { retries: 1, timeoutMs: 10000 })
      : await fetchJsonFallback(url);
    if (!res || !res.result) return null;
    // Kraken returns result keyed by the pair name; key may differ from input
    const keys = Object.keys(res.result);
    if (keys.length === 0) return null;
    const ticker = res.result[keys[0]];
    if (!ticker || !ticker.a || !ticker.b) return null;
    const ask = Number(ticker.a[0]);
    const bid = Number(ticker.b[0]);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return null;
    return { bid, ask };
  } catch (err) {
    logger.error(`Kraken fetch failed for ${pair}`, { error: err.message || err });
    return null;
  }
}

/**
 * Fetch bid/ask from Binance.
 * GET https://api.binance.com/api/v3/ticker/bookTicker?symbol={PAIR}
 * Response: { bidPrice, askPrice, ... }
 *
 * @param {string} pair - e.g. 'BTCUSDT'
 * @returns {Promise<{bid: number, ask: number}|null>}
 */
async function fetchBinance(pair) {
  const url = `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${pair}`;
  try {
    const res = rio
      ? await rio.fetchJsonRetry(url, {}, { retries: 1, timeoutMs: 10000 })
      : await fetchJsonFallback(url);
    if (!res || !res.bidPrice || !res.askPrice) return null;
    const bid = Number(res.bidPrice);
    const ask = Number(res.askPrice);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return null;
    return { bid, ask };
  } catch (err) {
    logger.error(`Binance fetch failed for ${pair}`, { error: err.message || err });
    return null;
  }
}

/**
 * Plain fetch fallback when resilient-io is unavailable.
 * @param {string} url
 * @returns {Promise<any>}
 */
async function fetchJsonFallback(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Spread Calculation ─────────────────────────────────────────────────────

/**
 * All venue fetchers keyed by venue name.
 */
const VENUE_FETCHERS = {
  coinbase: fetchCoinbase,
  kraken:   fetchKraken,
  binance:  fetchBinance,
};

const VENUE_NAMES = Object.keys(VENUE_FETCHERS);

/**
 * Fetch quotes from all venues for a single asset in parallel.
 * @param {string} asset - e.g. 'BTC'
 * @returns {Promise<Record<string, {bid: number, ask: number}|null>>}
 */
async function fetchAllVenueQuotes(asset) {
  const pairInfo = PAIR_MAP[asset];
  if (!pairInfo) return {};

  const results = {};
  const fetches = VENUE_NAMES.map(async (venue) => {
    const pair = pairInfo[venue];
    if (!pair) { results[venue] = null; return; }
    results[venue] = await VENUE_FETCHERS[venue](pair);
  });

  await Promise.all(fetches);
  return results;
}

/**
 * Compute all pairwise arbitrage spreads between venues that returned quotes.
 *
 * For venues A and B:
 *   - Buy on the venue with the lower ask, sell on the venue with the higher bid.
 *   - grossSpreadBps = ((bidHigh - askLow) / askLow) * 10000
 *   - netSpreadBps   = grossSpreadBps - feeA_bps - feeB_bps
 *
 * @param {string} asset
 * @param {Record<string, {bid: number, ask: number}|null>} quotes
 * @returns {Array<object>}
 */
function computePairwiseSpreads(asset, quotes) {
  const opportunities = [];
  const venues = VENUE_NAMES.filter((v) => quotes[v] !== null);

  for (let i = 0; i < venues.length; i++) {
    for (let j = i + 1; j < venues.length; j++) {
      const venueA = venues[i];
      const venueB = venues[j];
      const qA = quotes[venueA];
      const qB = quotes[venueB];

      // Direction 1: buy on A (lower ask), sell on B (higher bid)
      if (qB.bid > qA.ask) {
        const grossBps = ((qB.bid - qA.ask) / qA.ask) * 10000;
        const netBps = grossBps - VENUE_FEE_BPS[venueA] - VENUE_FEE_BPS[venueB];
        if (netBps > 0) {
          const estimatedPnlUsd = (netBps / 10000) * 1000; // Profit per $1000 notional
          opportunities.push({
            asset,
            buyVenue: venueA,
            sellVenue: venueB,
            buyPrice: qA.ask,
            sellPrice: qB.bid,
            grossSpreadBps: Math.round(grossBps * 100) / 100,
            netSpreadBps: Math.round(netBps * 100) / 100,
            estimatedPnlUsd: Math.round(estimatedPnlUsd * 100) / 100,
          });
        }
      }

      // Direction 2: buy on B (lower ask), sell on A (higher bid)
      if (qA.bid > qB.ask) {
        const grossBps = ((qA.bid - qB.ask) / qB.ask) * 10000;
        const netBps = grossBps - VENUE_FEE_BPS[venueA] - VENUE_FEE_BPS[venueB];
        if (netBps > 0) {
          const estimatedPnlUsd = (netBps / 10000) * 1000;
          opportunities.push({
            asset,
            buyVenue: venueB,
            sellVenue: venueA,
            buyPrice: qB.ask,
            sellPrice: qA.bid,
            grossSpreadBps: Math.round(grossBps * 100) / 100,
            netSpreadBps: Math.round(netBps * 100) / 100,
            estimatedPnlUsd: Math.round(estimatedPnlUsd * 100) / 100,
          });
        }
      }
    }
  }

  return opportunities;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const startMs = Date.now();

  // ── Gate: enabled check ────────────────────────────────────────────────────
  if (!ENABLED) {
    process.stdout.write(JSON.stringify({
      ts: new Date().toISOString(),
      scanner: 'arb-scanner',
      status: 'disabled',
      message: 'Set ARB_SCANNER_ENABLED=true to activate.',
    }, null, 2) + '\n');
    process.exit(0);
  }

  // ── Gate: interval check ───────────────────────────────────────────────────
  const state = loadState();
  const elapsed = (Date.now() - (state.lastRunTs || 0)) / 1000;
  if (elapsed < INTERVAL_SEC) {
    process.stdout.write(JSON.stringify({
      ts: new Date().toISOString(),
      scanner: 'arb-scanner',
      status: 'skipped',
      message: `Last run ${Math.round(elapsed)}s ago (interval: ${INTERVAL_SEC}s).`,
    }, null, 2) + '\n');
    process.exit(0);
  }

  logger.info(`Scanning ${ARB_ASSETS.length} assets across ${VENUE_NAMES.length} venues`);

  // ── Scan all assets ────────────────────────────────────────────────────────
  const allOpportunities = [];
  const assetQuotes = {};
  const errors = [];

  for (const asset of ARB_ASSETS) {
    if (!PAIR_MAP[asset]) {
      errors.push(`No pair mapping for asset: ${asset}`);
      continue;
    }

    try {
      const quotes = await fetchAllVenueQuotes(asset);
      assetQuotes[asset] = quotes;

      const activeVenues = VENUE_NAMES.filter((v) => quotes[v] !== null);
      if (activeVenues.length < 2) {
        logger.info(`${asset}: Only ${activeVenues.length} venue(s) responded, need >= 2`);
        continue;
      }

      const spreads = computePairwiseSpreads(asset, quotes);

      // Filter by minimum spread threshold
      const qualifying = spreads.filter((s) => s.netSpreadBps >= MIN_SPREAD_BPS);
      allOpportunities.push(...qualifying);

      // Record all spread snapshots (even sub-threshold) for state tracking
      for (const spread of spreads) {
        const pairKey = `${asset}:${spread.buyVenue}-${spread.sellVenue}`;
        if (!state.spreads[pairKey]) state.spreads[pairKey] = [];
        state.spreads[pairKey].push({
          ts: Date.now(),
          grossBps: spread.grossSpreadBps,
          netBps: spread.netSpreadBps,
        });
      }
    } catch (err) {
      logger.error(`Error scanning ${asset}`, { error: err.message || err });
      errors.push(`${asset}: ${err.message || String(err)}`);
    }
  }

  // ── Publish opportunities to signal bus ────────────────────────────────────
  let published = 0;
  if (signalBus) {
    for (const opp of allOpportunities) {
      try {
        signalBus.publish({
          type: 'edge_opportunity',
          source: 'arb-scanner',
          confidence: Math.min(0.9, opp.netSpreadBps / 100),
          payload: {
            asset: opp.asset,
            buyVenue: opp.buyVenue,
            sellVenue: opp.sellVenue,
            buyPrice: opp.buyPrice,
            sellPrice: opp.sellPrice,
            grossSpreadBps: opp.grossSpreadBps,
            netSpreadBps: opp.netSpreadBps,
            estimatedPnlUsd: opp.estimatedPnlUsd,
          },
          ttlMs: 5 * 60 * 1000, // 5 min TTL (arb opportunities are fleeting)
        });
        published += 1;
      } catch (err) {
        logger.error('Failed to publish signal', { error: err.message || err });
      }
    }

    // Publish scan summary
    try {
      signalBus.publish({
        type: 'arb_scan_summary',
        source: 'arb-scanner',
        confidence: 0.9,
        payload: {
          assetsScanned: ARB_ASSETS.length,
          venuesQueried: VENUE_NAMES.length,
          opportunitiesFound: allOpportunities.length,
          published,
          bestSpreadBps: allOpportunities.length > 0
            ? Math.max(...allOpportunities.map((o) => o.netSpreadBps))
            : 0,
          durationMs: Date.now() - startMs,
        },
        ttlMs: 30 * 60 * 1000,
      });
    } catch (err) {
      logger.error('Failed to publish summary signal', { error: err.message || err });
    }
  }

  // ── Update state ──────────────────────────────────────────────────────────
  state.lastRunTs = Date.now();

  for (const opp of allOpportunities) {
    state.opportunities.push({
      ts: Date.now(),
      asset: opp.asset,
      buyVenue: opp.buyVenue,
      sellVenue: opp.sellVenue,
      netSpreadBps: opp.netSpreadBps,
      estimatedPnlUsd: opp.estimatedPnlUsd,
    });
  }

  // Update rolling stats
  if (!state.stats) state.stats = {};
  state.stats.totalScans = (state.stats.totalScans || 0) + 1;
  state.stats.totalOpportunities = (state.stats.totalOpportunities || 0) + allOpportunities.length;
  state.stats.lastScanDurationMs = Date.now() - startMs;
  state.stats.lastScanTs = new Date().toISOString();
  if (allOpportunities.length > 0) {
    const bestOpp = allOpportunities.reduce((best, o) =>
      o.netSpreadBps > best.netSpreadBps ? o : best, allOpportunities[0]);
    state.stats.bestEverSpreadBps = Math.max(
      state.stats.bestEverSpreadBps || 0,
      bestOpp.netSpreadBps,
    );
  }

  saveState(state);

  // ── Output JSON result ────────────────────────────────────────────────────
  const result = {
    ts: new Date().toISOString(),
    scanner: 'arb-scanner',
    status: 'ok',
    assetsScanned: ARB_ASSETS.length,
    venuesQueried: VENUE_NAMES.length,
    opportunitiesFound: allOpportunities.length,
    publishedSignals: published,
    durationMs: Date.now() - startMs,
    minSpreadBps: MIN_SPREAD_BPS,
    opportunities: allOpportunities.map((o) => ({
      asset: o.asset,
      buyVenue: o.buyVenue,
      sellVenue: o.sellVenue,
      buyPrice: o.buyPrice,
      sellPrice: o.sellPrice,
      grossSpreadBps: o.grossSpreadBps,
      netSpreadBps: o.netSpreadBps,
      estimatedPnlPer1k: `$${o.estimatedPnlUsd}`,
    })),
    quotes: Object.fromEntries(
      Object.entries(assetQuotes).map(([asset, quotes]) => [
        asset,
        Object.fromEntries(
          VENUE_NAMES
            .filter((v) => quotes[v] !== null)
            .map((v) => [v, { bid: quotes[v].bid, ask: quotes[v].ask }]),
        ),
      ]),
    ),
    errors: errors.length > 0 ? errors : undefined,
    stats: state.stats,
  };

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

main().catch((err) => {
  logger.fatal('Fatal error', { error: err.message || err });
  process.exit(1);
});
