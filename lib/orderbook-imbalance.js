/**
 * Order Book Imbalance Detector
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Analyzes L1 top-of-book data from the WebSocket feed to detect bid/ask
 * imbalance. Used to delay entries when heavy selling pressure is detected
 * (or vice versa for shorts).
 *
 * Signals:
 *   - imbalance_ratio: bid_volume / ask_volume (>1 = buy pressure)
 *   - trade_flow_imbalance: net signed trade volume over rolling window
 *   - spread_anomaly: current spread vs rolling average spread
 *
 * @module lib/orderbook-imbalance
 */

'use strict';

const { createLogger } = require('./logger');
const log = createLogger('orderbook-imbalance');

let wsFeed, signalBus;
try { wsFeed = require('./websocket-feed'); } catch { wsFeed = null; }
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }

// ─── Configuration ────────────────────────────────────────────────────────────
const TRADE_WINDOW_MS = Number(process.env.OBI_TRADE_WINDOW_MS || 60000); // 1min rolling window
const SPREAD_WINDOW_SIZE = Number(process.env.OBI_SPREAD_WINDOW_SIZE || 200); // Samples for spread average
const IMBALANCE_THRESHOLD = Number(process.env.OBI_IMBALANCE_THRESHOLD || 2.0); // 2:1 ratio = significant
const SPREAD_ANOMALY_MULT = Number(process.env.OBI_SPREAD_ANOMALY_MULT || 2.0); // 2x avg spread = anomaly
const PRESSURE_EWMA_LAMBDA = 0.85;

// ─── State per asset ─────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   buyVolume: number,
 *   sellVolume: number,
 *   trades: Array<{ts: number, side: string, size: number, price: number}>,
 *   spreads: number[],
 *   ewmaPressure: number,
 *   lastBid: number,
 *   lastAsk: number,
 *   lastSpread: number,
 *   avgSpread: number,
 *   updatedAt: number
 * }} AssetOrderBookState
 */

/** @type {Map<string, AssetOrderBookState>} */
const assetState = new Map();

function getOrInit(asset) {
  if (!assetState.has(asset)) {
    assetState.set(asset, {
      buyVolume: 0,
      sellVolume: 0,
      trades: [],
      spreads: [],
      ewmaPressure: 0,
      lastBid: 0,
      lastAsk: 0,
      lastSpread: 0,
      avgSpread: 0,
      updatedAt: 0,
    });
  }
  return assetState.get(asset);
}

// ─── Trade Flow Ingestion ─────────────────────────────────────────────────────

/**
 * Ingest a trade tick from the WebSocket feed.
 * @param {object} trade - { asset, price, size, side, source }
 */
function ingestTrade(trade) {
  const asset = (trade.asset || '').toUpperCase();
  if (!asset) return;

  const state = getOrInit(asset);
  const now = Date.now();

  state.trades.push({ ts: now, side: trade.side, size: trade.size || 0, price: trade.price || 0 });

  // Prune old trades outside window
  const cutoff = now - TRADE_WINDOW_MS;
  state.trades = state.trades.filter(t => t.ts >= cutoff);

  // Recompute volumes from current window
  state.buyVolume = 0;
  state.sellVolume = 0;
  for (const t of state.trades) {
    if (t.side === 'buy') state.buyVolume += t.size * t.price;
    else state.sellVolume += t.size * t.price;
  }

  // EWMA pressure: positive = buy pressure, negative = sell pressure
  const netFlow = state.buyVolume - state.sellVolume;
  const totalFlow = state.buyVolume + state.sellVolume || 1;
  const normalizedPressure = netFlow / totalFlow; // -1 to +1
  state.ewmaPressure = PRESSURE_EWMA_LAMBDA * state.ewmaPressure + (1 - PRESSURE_EWMA_LAMBDA) * normalizedPressure;

  state.updatedAt = now;
}

/**
 * Ingest a price tick to track spread behavior.
 * @param {object} tick - { asset, bid, ask, spread, spreadBps }
 */
function ingestPrice(tick) {
  const asset = (tick.asset || '').toUpperCase();
  if (!asset || !tick.bid || !tick.ask) return;

  const state = getOrInit(asset);
  state.lastBid = tick.bid;
  state.lastAsk = tick.ask;
  state.lastSpread = tick.spread || (tick.ask - tick.bid);

  // Rolling spread window
  state.spreads.push(state.lastSpread);
  if (state.spreads.length > SPREAD_WINDOW_SIZE) {
    state.spreads = state.spreads.slice(-SPREAD_WINDOW_SIZE);
  }

  // Compute average spread
  if (state.spreads.length > 10) {
    state.avgSpread = state.spreads.reduce((s, v) => s + v, 0) / state.spreads.length;
  }

  state.updatedAt = Date.now();
}

// ─── Analysis API ─────────────────────────────────────────────────────────────

/**
 * Get the current order book imbalance for an asset.
 *
 * @param {string} asset
 * @returns {{
 *   imbalanceRatio: number,
 *   pressure: string,
 *   ewmaPressure: number,
 *   spreadAnomaly: boolean,
 *   spreadMultiple: number,
 *   buyVolume: number,
 *   sellVolume: number,
 *   tradeCount: number,
 *   shouldDelay: boolean,
 *   delayReason: string|null,
 *   confidence: number
 * }}
 */
function getImbalance(asset) {
  const assetUpper = (asset || '').toUpperCase();
  const st = assetState.get(assetUpper);

  if (!st || st.trades.length < 5) {
    return {
      imbalanceRatio: 1,
      pressure: 'neutral',
      ewmaPressure: 0,
      spreadAnomaly: false,
      spreadMultiple: 1,
      buyVolume: 0,
      sellVolume: 0,
      tradeCount: 0,
      shouldDelay: false,
      delayReason: null,
      confidence: 0,
    };
  }

  const totalVolume = st.buyVolume + st.sellVolume;
  const imbalanceRatio = st.sellVolume > 0 ? st.buyVolume / st.sellVolume : st.buyVolume > 0 ? 999 : 1;

  // Pressure classification
  let pressure = 'neutral';
  if (imbalanceRatio > IMBALANCE_THRESHOLD) pressure = 'strong_buy';
  else if (imbalanceRatio > 1.3) pressure = 'mild_buy';
  else if (imbalanceRatio < 1 / IMBALANCE_THRESHOLD) pressure = 'strong_sell';
  else if (imbalanceRatio < 0.77) pressure = 'mild_sell';

  // Spread anomaly
  const spreadMultiple = st.avgSpread > 0 ? st.lastSpread / st.avgSpread : 1;
  const spreadAnomaly = spreadMultiple >= SPREAD_ANOMALY_MULT;

  // Confidence based on sample size
  const confidence = Math.min(0.95, 0.2 + st.trades.length * 0.03);

  // Should we delay entry?
  let shouldDelay = false;
  let delayReason = null;

  if (spreadAnomaly) {
    shouldDelay = true;
    delayReason = `spread_anomaly: ${spreadMultiple.toFixed(1)}x avg (${st.lastSpread.toFixed(6)} vs ${st.avgSpread.toFixed(6)})`;
  }

  return {
    imbalanceRatio: Math.round(imbalanceRatio * 100) / 100,
    pressure,
    ewmaPressure: Math.round(st.ewmaPressure * 1000) / 1000,
    spreadAnomaly,
    spreadMultiple: Math.round(spreadMultiple * 100) / 100,
    buyVolume: Math.round(st.buyVolume * 100) / 100,
    sellVolume: Math.round(st.sellVolume * 100) / 100,
    tradeCount: st.trades.length,
    shouldDelay,
    delayReason,
    confidence,
  };
}

/**
 * Check if a planned trade direction aligns with or opposes current flow.
 * Returns a sizing adjustment multiplier.
 *
 * @param {string} asset
 * @param {string} side - 'buy' or 'sell'
 * @returns {{ multiplier: number, alignment: string, reason: string }}
 */
function getFlowAlignment(asset, side) {
  const imb = getImbalance(asset);

  if (imb.confidence < 0.3) {
    return { multiplier: 1.0, alignment: 'unknown', reason: 'insufficient data' };
  }

  const isBuying = side === 'buy';
  const buyPressure = imb.ewmaPressure > 0.2;
  const sellPressure = imb.ewmaPressure < -0.2;

  // Buying into strong sell pressure = risky → reduce size
  if (isBuying && sellPressure) {
    const reduction = Math.max(0.5, 1 + imb.ewmaPressure); // ewmaPressure is negative
    return {
      multiplier: Math.round(reduction * 100) / 100,
      alignment: 'opposing',
      reason: `buying into sell pressure (ewma=${imb.ewmaPressure.toFixed(3)})`,
    };
  }

  // Selling into strong buy pressure = risky → reduce size
  if (!isBuying && buyPressure) {
    const reduction = Math.max(0.5, 1 - imb.ewmaPressure);
    return {
      multiplier: Math.round(reduction * 100) / 100,
      alignment: 'opposing',
      reason: `selling into buy pressure (ewma=${imb.ewmaPressure.toFixed(3)})`,
    };
  }

  // Aligned with flow → slight bonus
  if ((isBuying && buyPressure) || (!isBuying && sellPressure)) {
    return {
      multiplier: Math.min(1.15, 1 + Math.abs(imb.ewmaPressure) * 0.2),
      alignment: 'aligned',
      reason: `aligned with ${isBuying ? 'buy' : 'sell'} flow`,
    };
  }

  return { multiplier: 1.0, alignment: 'neutral', reason: 'neutral flow' };
}

/**
 * Get all tracked imbalances across all assets.
 * @returns {Object<string, object>}
 */
function getAllImbalances() {
  const result = {};
  for (const [asset] of assetState) {
    result[asset] = getImbalance(asset);
  }
  return result;
}

// ─── WebSocket Feed Integration ───────────────────────────────────────────────

let _wsListening = false;

/**
 * Start listening to the WebSocket feed for trade + price events.
 */
function startListening() {
  if (_wsListening || !wsFeed) return;

  try {
    wsFeed.on('trade', (trade) => {
      try { ingestTrade(trade); } catch { /* best effort */ }
    });
    wsFeed.on('price', (tick) => {
      try { ingestPrice(tick); } catch { /* best effort */ }
    });
    _wsListening = true;
    log.info('order book imbalance detector listening to WS feed');
  } catch (err) {
    log.warn('failed to listen to WS feed', { error: err?.message });
  }
}

// Auto-start if WS feed is available
startListening();

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  ingestTrade,
  ingestPrice,
  getImbalance,
  getFlowAlignment,
  getAllImbalances,
  startListening,
};
