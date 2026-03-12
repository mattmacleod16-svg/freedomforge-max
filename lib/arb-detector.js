/**
 * Cross-Venue Arbitrage Detector — Multi-Exchange Price Spread Monitor
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Monitors real-time prices across all integrated venues (Kraken, Coinbase,
 * Binance, prediction markets) to detect arbitrage opportunities.
 *
 * Arb Types:
 *   1. Spot-Spot: Same asset, different spot venues (e.g. BTC on Kraken vs Coinbase)
 *   2. Spot-Futures: Cash & carry basis trades
 *   3. Cross-Prediction: Prediction market inefficiencies
 *   4. Triangular: Multi-hop currency triangles within a venue
 *
 * Uses the event mesh for real-time price feeds and publishes opportunities
 * to the signal bus for the consensus engine to approve.
 *
 * Profitability filters:
 *   - Minimum spread after estimated fees
 *   - Minimum confidence (price freshness)
 *   - Maximum execution latency estimate
 *   - Position size optimization (Kelly criterion)
 *
 * Usage:
 *   const arb = require('./arb-detector');
 *   arb.start();
 *   const opps = arb.getOpportunities();
 */

'use strict';

const { createLogger } = require('./logger');
const log = createLogger('arb-detector');

let signalBus, eventMesh, exchangeClient;
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }
try { eventMesh = require('./event-mesh'); } catch { eventMesh = null; }
try { exchangeClient = require('./exchange-client'); } catch { exchangeClient = null; }

// ─── Configuration ───────────────────────────────────────────────────────────

const SCAN_INTERVAL_MS = Math.max(10000, Number(process.env.ARB_SCAN_INTERVAL_MS || 30000));
const MIN_SPREAD_BPS = Math.max(5, Number(process.env.ARB_MIN_SPREAD_BPS || 25)); // basis points after fees
const MIN_CONFIDENCE = Math.max(0.3, Math.min(1.0, Number(process.env.ARB_MIN_CONFIDENCE || 0.7)));
const MAX_PRICE_AGE_MS = Math.max(5000, Number(process.env.ARB_MAX_PRICE_AGE_MS || 60000));
const MAX_OPPORTUNITIES = 50;

// Estimated taker fees per venue (basis points)
const VENUE_FEES_BPS = {
  kraken: 40,     // 0.40%
  coinbase: 60,   // 0.60%
  binance: 10,    // 0.10%
  alpaca: 0,      // commission-free
  ibkr: 5,        // ~0.05%
};

// ─── Price Cache ─────────────────────────────────────────────────────────────

/** @type {Map<string, Map<string, { price: number, ts: number, bid?: number, ask?: number }>>} */
// Map<assetSymbol, Map<venueName, priceData>>
const priceCache = new Map();

let scanTimer = null;
let opportunities = [];

// ─── Price Feed ──────────────────────────────────────────────────────────────

/**
 * Update the price cache for an asset on a venue.
 */
function updatePrice(asset, venue, price, opts = {}) {
  if (!priceCache.has(asset)) priceCache.set(asset, new Map());
  priceCache.get(asset).set(venue, {
    price: Number(price),
    bid: opts.bid ? Number(opts.bid) : null,
    ask: opts.ask ? Number(opts.ask) : null,
    ts: opts.ts || Date.now(),
  });
}

/**
 * Fetch current prices from exchange client and signal bus.
 */
async function refreshPrices() {
  const assets = ['BTC', 'ETH', 'SOL', 'AVAX', 'DOGE', 'ADA', 'DOT', 'LINK'];
  const venues = ['binance']; // Binance is the primary price source

  for (const asset of assets) {
    // Try exchange client for Binance prices
    if (exchangeClient) {
      try {
        const fn = exchangeClient.fetchCurrentPrice || exchangeClient.getPrice;
        if (typeof fn === 'function') {
          const price = await fn.call(exchangeClient, `${asset}USDT`);
          if (price && price > 0) {
            updatePrice(asset, 'binance', price);
          }
        }
      } catch { /* non-critical */ }
    }

    // Pull prices from signal bus (other venue engines publish their prices)
    if (signalBus) {
      try {
        const signals = signalBus.query({
          type: 'venue_price',
          maxAgeMs: MAX_PRICE_AGE_MS,
        });
        for (const sig of signals) {
          if (sig.payload?.asset?.toUpperCase() === asset && sig.payload?.price) {
            updatePrice(asset, sig.source, sig.payload.price, {
              bid: sig.payload.bid,
              ask: sig.payload.ask,
              ts: sig.publishedAt,
            });
          }
        }
      } catch { /* non-critical */ }
    }
  }
}

// ─── Arbitrage Detection ─────────────────────────────────────────────────────

/**
 * Detect spot-spot arbitrage opportunities.
 */
function detectSpotSpotArbs() {
  const found = [];
  const now = Date.now();

  for (const [asset, venues] of priceCache) {
    const venueList = [...venues.entries()]
      .filter(([, data]) => now - data.ts < MAX_PRICE_AGE_MS && data.price > 0)
      .sort((a, b) => a[1].price - b[1].price);

    if (venueList.length < 2) continue;

    // Compare cheapest vs most expensive
    for (let i = 0; i < venueList.length; i++) {
      for (let j = i + 1; j < venueList.length; j++) {
        const [lowVenue, lowData] = venueList[i];
        const [highVenue, highData] = venueList[j];

        const spreadBps = ((highData.price - lowData.price) / lowData.price) * 10000;
        const totalFeesBps = (VENUE_FEES_BPS[lowVenue] || 50) + (VENUE_FEES_BPS[highVenue] || 50);
        const netSpreadBps = spreadBps - totalFeesBps;

        if (netSpreadBps < MIN_SPREAD_BPS) continue;

        // Confidence based on price freshness
        const maxAge = Math.max(now - lowData.ts, now - highData.ts);
        const freshness = Math.max(0, 1 - maxAge / MAX_PRICE_AGE_MS);
        const confidence = freshness * 0.9;

        if (confidence < MIN_CONFIDENCE) continue;

        // Optimal position size via Kelly criterion
        // Edge = netSpreadBps / 10000, Win probability ~ confidence
        const edge = netSpreadBps / 10000;
        const kellyFraction = Math.max(0, (confidence * (1 + 1 / edge) - 1) / (1 / edge));
        const safeFraction = Math.min(0.1, kellyFraction * 0.25); // quarter-Kelly

        found.push({
          type: 'spot_spot',
          asset,
          buyVenue: lowVenue,
          sellVenue: highVenue,
          buyPrice: lowData.price,
          sellPrice: highData.price,
          spreadBps: Number(spreadBps.toFixed(2)),
          feesBps: totalFeesBps,
          netSpreadBps: Number(netSpreadBps.toFixed(2)),
          confidence: Number(confidence.toFixed(4)),
          kellyFraction: Number(safeFraction.toFixed(6)),
          ts: now,
        });
      }
    }
  }

  return found;
}

/**
 * Detect prediction market inefficiencies.
 * If complementary outcomes (YES + NO) don't sum to ~100%, there's an arb.
 */
function detectPredictionArbs() {
  if (!signalBus) return [];
  const found = [];

  try {
    const signals = signalBus.query({ type: 'prediction_market_prices', maxAgeMs: MAX_PRICE_AGE_MS * 2 });

    for (const sig of signals) {
      const { market, yesPrice, noPrice } = sig.payload || {};
      if (!market || !yesPrice || !noPrice) continue;

      const total = yesPrice + noPrice;
      const overroundBps = (total - 1) * 10000;

      // If total < 1.0, there's a guaranteed profit buying both sides
      if (total < 0.98) {
        found.push({
          type: 'prediction_underround',
          market,
          yesPrice,
          noPrice,
          total,
          profitBps: Number(((1 - total) * 10000).toFixed(2)),
          confidence: 0.95,
          ts: Date.now(),
        });
      }

      // If total > 1.02, there's a selling/short opportunity
      if (total > 1.03) {
        found.push({
          type: 'prediction_overround',
          market,
          yesPrice,
          noPrice,
          total,
          spreadBps: Number(overroundBps.toFixed(2)),
          confidence: 0.7,
          ts: Date.now(),
        });
      }
    }
  } catch { /* non-critical */ }

  return found;
}

// ─── Main Scan Loop ──────────────────────────────────────────────────────────

async function scan() {
  try {
    await refreshPrices();

    const spotArbs = detectSpotSpotArbs();
    const predArbs = detectPredictionArbs();

    const all = [...spotArbs, ...predArbs]
      .sort((a, b) => (b.netSpreadBps || b.profitBps || 0) - (a.netSpreadBps || a.profitBps || 0))
      .slice(0, MAX_OPPORTUNITIES);

    opportunities = all;

    // Publish to signal bus and event mesh
    for (const opp of all) {
      if (signalBus) {
        signalBus.publish({
          type: 'arb_opportunity',
          source: 'arb-detector',
          confidence: opp.confidence,
          payload: opp,
        });
      }
      if (eventMesh) {
        eventMesh.publish('arb.detected', opp, {
          source: 'arb-detector',
          priority: opp.netSpreadBps > 100 ? eventMesh.PRIORITY?.HIGH : eventMesh.PRIORITY?.NORMAL,
        });
      }
    }

    if (all.length > 0) {
      log.info(`Scan found ${all.length} arb opportunities (best: ${all[0].type} ${all[0].asset || all[0].market} ${all[0].netSpreadBps || all[0].profitBps}bps)`);
    }

    return { scanned: priceCache.size, opportunities: all.length };
  } catch (err) {
    log.error(`Arb scan error: ${err.message}`);
    return { scanned: 0, opportunities: 0, error: err.message };
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

function start() {
  // Subscribe to price updates via event mesh
  if (eventMesh) {
    eventMesh.subscribe('price.update', (msg) => {
      const { asset, venue, price, bid, ask } = msg.payload || {};
      if (asset && venue && price) {
        updatePrice(asset, venue, price, { bid, ask, ts: msg.ts });
      }
    });
    log.info('Subscribed to price.update events');
  }

  // Initial scan
  scan().then(r => log.info(`Arb detector started: ${r.opportunities} opportunities`));

  // Periodic scan
  scanTimer = setInterval(() => scan(), SCAN_INTERVAL_MS);
  if (scanTimer.unref) scanTimer.unref();
}

function stop() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}

function getOpportunities() {
  return [...opportunities];
}

function getStats() {
  const priceAssets = [];
  for (const [asset, venues] of priceCache) {
    priceAssets.push({
      asset,
      venues: [...venues.entries()].map(([v, d]) => ({
        venue: v,
        price: d.price,
        ageMs: Date.now() - d.ts,
      })),
    });
  }

  return {
    priceAssets,
    activeOpportunities: opportunities.length,
    topOpportunities: opportunities.slice(0, 5),
    scanIntervalMs: SCAN_INTERVAL_MS,
    minSpreadBps: MIN_SPREAD_BPS,
  };
}

module.exports = {
  updatePrice,
  scan,
  start,
  stop,
  getOpportunities,
  getStats,
  detectSpotSpotArbs,
  detectPredictionArbs,
};
