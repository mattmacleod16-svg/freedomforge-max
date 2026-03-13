/**
 * Exit Manager — Position exit management, trailing stops, and trade closure.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * CRITICAL FIX: Before this module, trades NEVER CLOSED. Venue engines placed
 * entry orders and then looped — the brain never learned because every trade
 * had `outcome: null`. This module monitors open positions, checks trailing
 * stop / take-profit levels, places exit orders, and records outcomes.
 *
 * Flow:
 *   1. Load open positions from trade journal (outcome is null/undefined)
 *   2. For each position, fetch current price via public APIs
 *   3. Compare against trailing stop and take-profit levels
 *   4. If triggered, place exit order via venue API
 *   5. Update trade journal with outcome, exit price, P&L, fees
 *   6. Update exposure tracking in risk-manager (closeExposure)
 *
 * Usage:
 *   const { checkExits, runExitLoop, getOpenPositions } = require('./exit-manager');
 *   await checkExits();           // one-shot check
 *   runExitLoop(30000);           // continuous loop every 30s
 *
 * Env vars:
 *   EXIT_CHECK_INTERVAL_MS      — loop interval (default 30000, clamped 10000-120000)
 *   EXIT_SLIPPAGE_TOLERANCE      — limit price tolerance (default 0.005 = 0.5%, clamped 0.001-0.02)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { createLogger } = require('./logger');
const _log = createLogger('exit-manager');

// ─── Configuration ────────────────────────────────────────────────────────────

const EXIT_CHECK_INTERVAL_MS = Math.max(10000, Math.min(120000, Number(process.env.EXIT_CHECK_INTERVAL_MS || 30000)));
const EXIT_SLIPPAGE_TOLERANCE = Math.max(0.001, Math.min(0.02, Number(process.env.EXIT_SLIPPAGE_TOLERANCE || 0.005)));

// Default fee rates per venue (taker fees for market exits)
const VENUE_FEE_RATES = {
  coinbase: 0.006,         // 0.6% taker
  coinbase_futures: 0.004, // 0.4% taker
  kraken: 0.004,           // 0.4% taker
  binance: 0.001,          // 0.1% taker
  alpaca: 0.0,             // commission-free equities
  ibkr: 0.0005,            // ~0.05% average
};

// ─── Dependency Loading (resilient — never crash) ─────────────────────────────

let tradeJournal;
try { tradeJournal = require('./trade-journal'); } catch { tradeJournal = null; }

let riskManager;
try { riskManager = require('./risk-manager'); } catch { riskManager = null; }

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

let heartbeatRegistry;
try { heartbeatRegistry = require('./heartbeat-registry'); } catch { heartbeatRegistry = null; }

// ─── In-memory trailing state ─────────────────────────────────────────────────
// Tracks highest/lowest price seen since entry for each trade ID.
// FIX C-2: State is now restored from disk on startup (saved by orchestrator shutdown).
const trailingState = new Map();

/**
 * Restore trailing stop high-water marks from disk (called at startup).
 * @param {object} savedState - { positions: [{ asset, tradeId, highWaterMark, lowestSinceEntry, ... }] }
 */
function restoreTrailingState(savedState) {
  if (!savedState?.positions || !Array.isArray(savedState.positions)) return 0;
  let restored = 0;
  for (const p of savedState.positions) {
    const key = p.tradeId || p.id || `${p.asset}-${p.venue}-${p.side}`;
    if (key && (p.highWaterMark || p.highestSinceEntry || p.lowestSinceEntry)) {
      trailingState.set(key, {
        highestSinceEntry: p.highWaterMark || p.highestSinceEntry || p.entryPrice || 0,
        lowestSinceEntry: p.lowestSinceEntry || p.entryPrice || Infinity,
      });
      restored++;
    }
  }
  return restored;
}

// ─── Price Fetching ───────────────────────────────────────────────────────────

const KRAKEN_PAIR_MAP = {
  BTC: 'XXBTZUSD', ETH: 'XETHZUSD', SOL: 'SOLUSD', XRP: 'XXRPZUSD',
  ADA: 'ADAUSD', DOT: 'DOTUSD', AVAX: 'AVAXUSD', LINK: 'LINKUSD',
  MATIC: 'MATICUSD', DOGE: 'XDGUSD', ATOM: 'ATOMUSD', UNI: 'UNIUSD',
  OP: 'OPUSD', TRUMP: 'TRUMPUSD', ARB: 'ARBUSD', NEAR: 'NEARUSD',
  FIL: 'FILUSD', APT: 'APTUSD', SUI: 'SUIUSD', PEPE: 'PEPEUSD',
};

const COINBASE_PRODUCT_MAP = {
  BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD', DOGE: 'DOGE-USD',
  AVAX: 'AVAX-USD', LINK: 'LINK-USD', MATIC: 'MATIC-USD', ARB: 'ARB-USD',
  OP: 'OP-USD', XRP: 'XRP-USD', ADA: 'ADA-USD', DOT: 'DOT-USD',
  ATOM: 'ATOM-USD', UNI: 'UNI-USD', NEAR: 'NEAR-USD',
};

/**
 * Fetch current price for an asset using public APIs (no auth needed).
 * Tries Kraken first, then Coinbase, then CoinGecko.
 * @param {string} asset - e.g. 'BTC'
 * @returns {Promise<number|null>}
 */
async function fetchCurrentPrice(asset) {
  const upper = (asset || 'BTC').toUpperCase();

  // Try Kraken public ticker
  const krakenPair = KRAKEN_PAIR_MAP[upper];
  if (krakenPair) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(
          `https://api.kraken.com/0/public/Ticker?pair=${krakenPair}`,
          { signal: controller.signal }
        );
        const data = await res.json();
        if (data.result) {
          const key = Object.keys(data.result)[0];
          const price = parseFloat(data.result[key]?.c?.[0]);
          if (Number.isFinite(price) && price > 0) return price;
        }
      } finally { clearTimeout(timer); }
    } catch (err) {
      _log.debug('kraken price fetch failed, trying fallback', { asset: upper, error: err?.message });
    }
  }

  // Fallback: Coinbase public ticker
  const cbProduct = COINBASE_PRODUCT_MAP[upper];
  if (cbProduct) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(
          `https://api.exchange.coinbase.com/products/${cbProduct}/ticker`,
          { signal: controller.signal }
        );
        const data = await res.json();
        const price = parseFloat(data?.price);
        if (Number.isFinite(price) && price > 0) return price;
      } finally { clearTimeout(timer); }
    } catch (err) {
      _log.debug('coinbase price fetch failed', { asset: upper, error: err?.message });
    }
  }

  _log.warn('all price sources failed', { asset: upper });
  return null;
}

/**
 * Fetch ATR for an asset from Kraken hourly OHLC (14-period).
 * Returns absolute ATR value (not percentage).
 * @param {string} asset
 * @returns {Promise<number|null>}
 */
async function fetchATR(asset) {
  const upper = (asset || 'BTC').toUpperCase();
  const pair = KRAKEN_PAIR_MAP[upper];
  if (!pair) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(
        `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=60`,
        { signal: controller.signal }
      );
      const data = await res.json();
      if (data.error?.length) return null;
      const key = Object.keys(data.result || {}).find(k => k !== 'last');
      if (!key) return null;
      const candles = data.result[key];
      if (!candles || candles.length < 15) return null;

      const recent = candles.slice(-15);
      const periods = 14;
      let atrSum = 0;
      for (let i = 1; i < recent.length; i++) {
        const high = parseFloat(recent[i][2]);
        const low = parseFloat(recent[i][3]);
        const prevClose = parseFloat(recent[i - 1][4]);
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        atrSum += tr;
      }
      return atrSum / periods;
    } finally { clearTimeout(timer); }
  } catch (err) {
    _log.debug('ATR fetch failed', { asset: upper, error: err?.message });
    return null;
  }
}

// ─── Open Position Detection ──────────────────────────────────────────────────

const JOURNAL_FILE = path.resolve(process.cwd(), process.env.TRADE_JOURNAL_FILE || 'data/trade-journal.json');

/**
 * Load the trade journal directly from disk.
 * @returns {{ trades: Array }}
 */
function loadJournal() {
  try {
    if (rio) {
      const raw = rio.readJsonSafe(JOURNAL_FILE, { fallback: null });
      return { trades: Array.isArray(raw?.trades) ? raw.trades : [] };
    }
    if (!fs.existsSync(JOURNAL_FILE)) return { trades: [] };
    const raw = JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf8'));
    return { trades: Array.isArray(raw?.trades) ? raw.trades : [] };
  } catch (err) {
    _log.error('failed to load trade journal', { error: err?.message });
    return { trades: [] };
  }
}

/**
 * Get all open positions (trades with no outcome).
 * Filters out trades with invalid entry data (entryPrice=0, etc).
 * @returns {Array} Array of open trade records
 */
function getOpenPositions() {
  try {
    const journal = loadJournal();
    return journal.trades.filter(t => {
      // Must be unclosed
      if (t.outcome != null || t.closedAt != null) return false;
      // Must have a valid entry price (some trades have entryPrice=0)
      if (!t.entryPrice || t.entryPrice <= 0) return false;
      // Must have a valid side
      if (t.side !== 'buy' && t.side !== 'sell') return false;
      // Must have valid USD size
      if (!t.usdSize || t.usdSize <= 0) return false;
      return true;
    });
  } catch (err) {
    _log.error('getOpenPositions failed', { error: err?.message });
    return [];
  }
}

// ─── Exit Order Placement ─────────────────────────────────────────────────────

/**
 * Place an exit order for a given trade.
 * Returns { success, exitPrice, fees, orderId, method }.
 *
 * For dry-run trades, we simulate the exit (mark-to-market).
 * For live trades, we attempt venue API calls.
 *
 * @param {object} trade - The open trade record
 * @param {number} currentPrice - Current market price
 * @param {string} reason - Exit reason ('trailing_stop', 'take_profit')
 * @returns {Promise<{ success: boolean, exitPrice: number, fees: number, orderId: string|null, method: string }>}
 */
async function placeExitOrder(trade, currentPrice, reason) {
  const exitSide = trade.side === 'buy' ? 'sell' : 'buy';
  const feeRate = VENUE_FEE_RATES[trade.venue] || 0.005;
  const fees = Math.round(trade.usdSize * feeRate * 100) / 100;

  // Calculate limit price with slippage tolerance
  const slippageMultiplier = exitSide === 'sell'
    ? (1 - EXIT_SLIPPAGE_TOLERANCE)    // sell slightly below market
    : (1 + EXIT_SLIPPAGE_TOLERANCE);    // buy slightly above market
  const limitPrice = Math.round(currentPrice * slippageMultiplier * 100) / 100;

  // ── Dry-run trades: simulate exit (mark-to-market) ──
  if (trade.dryRun) {
    _log.info('dry-run exit simulated', {
      tradeId: trade.id,
      venue: trade.venue,
      asset: trade.asset,
      exitSide,
      exitPrice: currentPrice,
      reason,
    });
    return {
      success: true,
      exitPrice: currentPrice,
      fees,
      orderId: null,
      method: 'dry-run-simulated',
    };
  }

  // ── Live trades: attempt venue-specific exit ──
  try {
    const result = await placeVenueExitOrder(trade, exitSide, currentPrice, limitPrice);
    if (result.success) {
      _log.info('live exit order placed', {
        tradeId: trade.id,
        venue: trade.venue,
        asset: trade.asset,
        exitSide,
        exitPrice: result.fillPrice || currentPrice,
        orderId: result.orderId,
        reason,
      });
      return {
        success: true,
        exitPrice: result.fillPrice || currentPrice,
        fees: result.fees || fees,
        orderId: result.orderId,
        method: 'venue-api',
      };
    }
    // Order was rejected or failed — log but do not crash
    _log.warn('exit order rejected by venue', {
      tradeId: trade.id,
      venue: trade.venue,
      error: result.error,
      reason,
    });
    return { success: false, exitPrice: currentPrice, fees: 0, orderId: null, method: 'venue-rejected' };
  } catch (err) {
    _log.error('exit order placement failed', {
      tradeId: trade.id,
      venue: trade.venue,
      error: err?.message || String(err),
      reason,
    });
    // FIX C-3: Do NOT report success when the exchange order failed.
    // Previously returned success:true which caused ghost positions on exchange.
    // The journal should NOT mark this as closed — let retry or manual intervention handle it.
    return {
      success: false,
      exitPrice: currentPrice,
      fees: 0,
      orderId: null,
      method: 'mark-to-market-fallback',
      error: err?.message || 'exit order placement failed',
    };
  }
}

/**
 * Venue-specific exit order dispatch.
 * Attempts to place the exit via the appropriate exchange API.
 * @param {object} trade
 * @param {string} exitSide - 'buy' or 'sell'
 * @param {number} currentPrice
 * @param {number} limitPrice
 * @returns {Promise<{ success: boolean, fillPrice?: number, orderId?: string, fees?: number, error?: string }>}
 */
async function placeVenueExitOrder(trade, exitSide, currentPrice, limitPrice) {
  const venue = trade.venue;

  if (venue === 'coinbase') {
    return await placeCoinbaseExit(trade, exitSide, currentPrice, limitPrice);
  }
  if (venue === 'kraken') {
    return await placeKrakenExit(trade, exitSide, currentPrice, limitPrice);
  }

  // Unsupported venue — fall back to mark-to-market
  _log.warn('no exit API for venue, using mark-to-market', { venue, tradeId: trade.id });
  return {
    success: true,
    fillPrice: currentPrice,
    orderId: null,
    fees: Math.round(trade.usdSize * (VENUE_FEE_RATES[venue] || 0.005) * 100) / 100,
  };
}

/**
 * Place exit order on Coinbase.
 * Uses the same API patterns as coinbase-spot-engine.js.
 */
async function placeCoinbaseExit(trade, exitSide, currentPrice, limitPrice) {
  const crypto = require('crypto');
  const apiKey = (process.env.COINBASE_API_KEY || '').trim();
  const apiSecret = (process.env.COINBASE_API_SECRET || '').trim();
  const apiPassphrase = (process.env.COINBASE_API_PASSPHRASE || '').trim();
  const cdpMode = String(process.env.COINBASE_CDP_MODE || '').toLowerCase() === 'true' ||
    (apiKey.startsWith('organizations/') && apiSecret.includes('BEGIN EC PRIVATE KEY'));

  if (!apiKey || !apiSecret) {
    return { success: false, error: 'missing Coinbase API credentials for exit' };
  }

  const productId = COINBASE_PRODUCT_MAP[(trade.asset || 'BTC').toUpperCase()] || 'BTC-USD';
  const baseSize = trade.usdSize / currentPrice;

  if (cdpMode) {
    // CDP mode — Advanced Trade API
    const clientOrderId = crypto.randomUUID();
    // PERF: Use limit_limit_gtc with tight slippage buffer for better fills (was market_market_ioc)
    const limitBuf = exitSide === 'sell' ? limitPrice : limitPrice;
    const payload = exitSide === 'sell'
      ? {
          client_order_id: clientOrderId,
          product_id: productId,
          side: 'SELL',
          order_configuration: { limit_limit_gtc: { base_size: String(roundDown(baseSize, 8)), limit_price: String(roundDown(limitBuf, 2)), post_only: false } },
        }
      : {
          client_order_id: clientOrderId,
          product_id: productId,
          side: 'BUY',
          order_configuration: { limit_limit_gtc: { base_size: String(roundDown(trade.usdSize / limitBuf, 8)), limit_price: String(Math.ceil(limitBuf * 100) / 100), post_only: false } },
        };

    const requestPath = '/api/v3/brokerage/orders';
    const cdpBaseUrl = (process.env.COINBASE_CDP_BASE_URL || 'https://api.coinbase.com').replace(/\/$/, '');
    const token = createCdpJwt(apiKey, apiSecret, 'POST', requestPath);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${cdpBaseUrl}${requestPath}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const result = await res.json();
      const success = result?.success === true && !result?.error_response?.error;
      return {
        success,
        fillPrice: currentPrice,
        orderId: result?.success_response?.order_id || clientOrderId,
        error: success ? undefined : (result?.error_response?.error || 'order_rejected'),
      };
    } finally { clearTimeout(timer); }
  }

  // Legacy Exchange API mode
  const baseUrl = (process.env.COINBASE_BASE_URL || 'https://api.exchange.coinbase.com').replace(/\/$/, '');
  const timestamp = (Date.now() / 1000).toFixed(3);
  const requestPath = '/orders';

  const bodyObj = exitSide === 'sell'
    ? { type: 'limit', side: 'sell', product_id: productId, size: String(roundDown(baseSize, 8)), price: String(roundDown(limitPrice, 2)), time_in_force: 'IOC' }
    : { type: 'limit', side: 'buy', product_id: productId, size: String(roundDown(trade.usdSize / limitPrice, 8)), price: String(Math.ceil(limitPrice * 100) / 100), time_in_force: 'IOC' };

  const body = JSON.stringify(bodyObj);
  const prehash = `${timestamp}POST${requestPath}${body}`;
  const key = Buffer.from(apiSecret, 'base64');
  const signature = crypto.createHmac('sha256', key).update(prehash).digest('base64');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${baseUrl}${requestPath}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'CB-ACCESS-KEY': apiKey,
        'CB-ACCESS-SIGN': signature,
        'CB-ACCESS-TIMESTAMP': timestamp,
        'CB-ACCESS-PASSPHRASE': apiPassphrase,
      },
      body,
      signal: controller.signal,
    });
    const result = await res.json();
    const success = !result?.message;
    return {
      success,
      fillPrice: currentPrice,
      orderId: result?.id || null,
      error: success ? undefined : (result?.message || 'order_rejected'),
    };
  } finally { clearTimeout(timer); }
}

/**
 * Place exit order on Kraken.
 * Uses the same API patterns as kraken-spot-engine.js.
 */
async function placeKrakenExit(trade, exitSide, currentPrice, limitPrice) {
  const crypto = require('crypto');
  const apiKey = (process.env.KRAKEN_API_KEY || '').trim();
  const apiSecret = (process.env.KRAKEN_API_SECRET || '').trim();

  if (!apiKey || !apiSecret) {
    return { success: false, error: 'missing Kraken API credentials for exit' };
  }

  const pair = KRAKEN_PAIR_MAP[(trade.asset || 'BTC').toUpperCase()] || 'XXBTZUSD';
  const volume = roundDown(trade.usdSize / currentPrice, 8);

  if (volume <= 0 || !Number.isFinite(volume)) {
    return { success: false, error: 'computed exit volume is zero or invalid' };
  }

  const nonceVal = String(Date.now() * 1000 + Math.floor(Math.random() * 1000));
  const pathname = '/0/private/AddOrder';
  // PERF: Use limit IOC instead of market for better fill quality
  const bodyParams = new URLSearchParams({
    nonce: nonceVal,
    pair: pair,
    type: exitSide,
    ordertype: 'limit',
    price: exitSide === 'sell' ? String(roundDown(limitPrice, 2)) : String(Math.ceil(limitPrice * 100) / 100),
    volume: String(volume),
    timeinforce: 'IOC',
  });

  const secret = Buffer.from(apiSecret, 'base64');
  const hash = crypto.createHash('sha256').update(nonceVal + bodyParams.toString()).digest();
  const signature = crypto.createHmac('sha512', secret).update(pathname).update(hash).digest('base64');

  const baseUrl = (process.env.KRAKEN_BASE_URL || 'https://api.kraken.com').replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: {
        'API-Key': apiKey,
        'API-Sign': signature,
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body: bodyParams.toString(),
      signal: controller.signal,
    });
    const payload = await res.json();
    if (Array.isArray(payload?.error) && payload.error.length > 0) {
      return { success: false, error: payload.error.join(', ') };
    }
    return {
      success: true,
      fillPrice: currentPrice,
      orderId: payload?.result?.txid?.[0] || null,
    };
  } finally { clearTimeout(timer); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roundDown(value, decimals) {
  const factor = 10 ** Math.max(0, decimals);
  return Math.floor(value * factor) / factor;
}

/**
 * Create a CDP JWT for Coinbase Advanced Trade API.
 * Mirrors the pattern in coinbase-spot-engine.js.
 */
function createCdpJwt(apiKey, apiSecret, method, requestPath) {
  const crypto = require('crypto');
  const now = Math.floor(Date.now() / 1000);

  function toBase64Url(input) {
    const raw = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
    return raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  const header = {
    alg: 'ES256',
    typ: 'JWT',
    kid: apiKey,
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  const payload = {
    iss: 'cdp',
    sub: apiKey,
    nbf: now,
    exp: now + 120,
    uri: `${String(method || 'GET').toUpperCase()} api.coinbase.com${requestPath}`,
  };

  const headerPart = toBase64Url(JSON.stringify(header));
  const payloadPart = toBase64Url(JSON.stringify(payload));
  const signingInput = `${headerPart}.${payloadPart}`;

  const privateKeyPem = apiSecret.includes('\\n') ? apiSecret.replace(/\\n/g, '\n') : apiSecret;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${toBase64Url(signature)}`;
}

// ─── Core Exit Logic ──────────────────────────────────────────────────────────

/**
 * Check all open positions and exit any that hit stop-loss or take-profit.
 * This is the main function — call it periodically.
 * @returns {Promise<{ checked: number, exited: number, errors: number, exits: Array }>}
 */
async function checkExits() {
  const result = { checked: 0, exited: 0, errors: 0, exits: [] };

  try {
    const openPositions = getOpenPositions();
    result.checked = openPositions.length;

    if (openPositions.length === 0) {
      _log.debug('no open positions to check');
      return result;
    }

    _log.info('checking open positions for exits', { count: openPositions.length });

    // Group positions by asset to avoid duplicate price fetches
    const assetGroups = new Map();
    for (const trade of openPositions) {
      const asset = (trade.asset || 'BTC').toUpperCase();
      if (!assetGroups.has(asset)) assetGroups.set(asset, []);
      assetGroups.get(asset).push(trade);
    }

    // Fetch prices and ATR for all assets in parallel
    const assets = [...assetGroups.keys()];
    const [priceResults, atrResults] = await Promise.all([
      Promise.allSettled(assets.map(a => fetchCurrentPrice(a))),
      Promise.allSettled(assets.map(a => fetchATR(a))),
    ]);

    const prices = new Map();
    const atrs = new Map();
    for (let i = 0; i < assets.length; i++) {
      if (priceResults[i].status === 'fulfilled' && priceResults[i].value) {
        prices.set(assets[i], priceResults[i].value);
      }
      if (atrResults[i].status === 'fulfilled' && atrResults[i].value) {
        atrs.set(assets[i], atrResults[i].value);
      }
    }

    // Evaluate each position
    for (const trade of openPositions) {
      try {
        const asset = (trade.asset || 'BTC').toUpperCase();
        const currentPrice = prices.get(asset);

        if (!currentPrice) {
          _log.warn('skipping position — no price available', { tradeId: trade.id, asset });
          continue;
        }

        const atr = atrs.get(asset) || null;
        const exitDecision = evaluateExit(trade, currentPrice, atr);

        if (exitDecision.shouldExit) {
          const exitResult = await executeExit(trade, currentPrice, exitDecision.reason, exitDecision);
          if (exitResult.success) {
            result.exited++;
            result.exits.push({
              tradeId: trade.id,
              asset,
              venue: trade.venue,
              side: trade.side,
              entryPrice: trade.entryPrice,
              exitPrice: exitResult.exitPrice,
              pnl: exitResult.pnl,
              reason: exitDecision.reason,
            });
          } else {
            result.errors++;
          }
        }
      } catch (err) {
        result.errors++;
        _log.error('error processing position for exit', {
          tradeId: trade.id,
          error: err?.message || String(err),
        });
      }
    }

    // Clean up trailing state for closed trades
    cleanupTrailingState();

    if (result.exited > 0) {
      _log.info('exit check complete', {
        checked: result.checked,
        exited: result.exited,
        errors: result.errors,
      });
    }

    // Publish heartbeat
    if (heartbeatRegistry) {
      try {
        heartbeatRegistry.publishHeartbeat('exit-manager', {
          openPositions: result.checked,
          exited: result.exited,
          errors: result.errors,
        });
      } catch { /* heartbeat is best-effort */ }
    }
  } catch (err) {
    _log.error('checkExits top-level error', { error: err?.message || String(err) });
  }

  return result;
}

/**
 * Evaluate whether a position should be exited.
 * Uses trailing stop from risk-manager and fixed SL/TP as fallback.
 *
 * @param {object} trade - Trade record from journal
 * @param {number} currentPrice - Current market price
 * @param {number|null} atr - Current ATR value (null if unavailable)
 * @returns {{ shouldExit: boolean, reason: string, trailingStop?: number, takeProfit?: number }}
 */
function evaluateExit(trade, currentPrice, atr) {
  const tradeId = trade.id;
  const side = trade.side;
  const entryPrice = trade.entryPrice;

  // ── Initialize or update trailing state ──
  if (!trailingState.has(tradeId)) {
    trailingState.set(tradeId, {
      highestSinceEntry: entryPrice,
      lowestSinceEntry: entryPrice,
    });
  }
  const state = trailingState.get(tradeId);

  // Update peaks/troughs
  if (currentPrice > state.highestSinceEntry) state.highestSinceEntry = currentPrice;
  if (currentPrice < state.lowestSinceEntry) state.lowestSinceEntry = currentPrice;

  // ── Use risk-manager's trailing stop calculator if available ──
  if (riskManager && typeof riskManager.calculateTrailingStop === 'function') {
    const trailResult = riskManager.calculateTrailingStop({
      side,
      entryPrice,
      currentPrice,
      highestSinceEntry: state.highestSinceEntry,
      lowestSinceEntry: state.lowestSinceEntry,
      atr: atr || entryPrice * 0.03, // fallback to 3% of entry for ATR
    });

    // Check trailing stop
    if (trailResult.shouldExit) {
      return {
        shouldExit: true,
        reason: trailResult.reason || 'trailing_stop',
        trailingStop: trailResult.trailingStop,
      };
    }

    // Check take-profit (progressive — only triggers on extreme extension)
    if (trailResult.takeProfit != null) {
      if (side === 'buy' && currentPrice >= trailResult.takeProfit) {
        return {
          shouldExit: true,
          reason: `take_profit: price ${currentPrice} >= TP ${trailResult.takeProfit.toFixed(4)}`,
          takeProfit: trailResult.takeProfit,
        };
      }
      if (side === 'sell' && currentPrice <= trailResult.takeProfit) {
        return {
          shouldExit: true,
          reason: `take_profit: price ${currentPrice} <= TP ${trailResult.takeProfit.toFixed(4)}`,
          takeProfit: trailResult.takeProfit,
        };
      }
    }

    return { shouldExit: false, reason: 'ok', trailingStop: trailResult.trailingStop };
  }

  // ── Fallback: use calculateStopLoss for fixed levels ──
  if (riskManager && typeof riskManager.calculateStopLoss === 'function') {
    const slCalc = riskManager.calculateStopLoss({
      asset: trade.asset,
      entryPrice,
      side,
      atr: atr || 0,
    });

    // Check stop-loss
    if (side === 'buy' && currentPrice <= slCalc.stopLoss) {
      return { shouldExit: true, reason: `stop_loss: price ${currentPrice} <= SL ${slCalc.stopLoss}` };
    }
    if (side === 'sell' && currentPrice >= slCalc.stopLoss) {
      return { shouldExit: true, reason: `stop_loss: price ${currentPrice} >= SL ${slCalc.stopLoss}` };
    }

    // Check take-profit
    if (side === 'buy' && currentPrice >= slCalc.takeProfit) {
      return { shouldExit: true, reason: `take_profit: price ${currentPrice} >= TP ${slCalc.takeProfit}` };
    }
    if (side === 'sell' && currentPrice <= slCalc.takeProfit) {
      return { shouldExit: true, reason: `take_profit: price ${currentPrice} <= TP ${slCalc.takeProfit}` };
    }

    return { shouldExit: false, reason: 'ok' };
  }

  // ── Last-resort fallback: simple percentage stops ──
  const HIGH_VOL_ASSETS = ['DOGE', 'AVAX', 'SOL', 'ARB', 'OP', 'LINK', 'MATIC', 'XRP'];
  const isHighVol = HIGH_VOL_ASSETS.includes((trade.asset || '').toUpperCase());
  const slPct = isHighVol ? 0.04 : 0.03;
  const tpPct = isHighVol ? 0.08 : 0.06;

  if (side === 'buy') {
    if (currentPrice <= entryPrice * (1 - slPct)) {
      return { shouldExit: true, reason: `fallback_stop_loss: ${((1 - currentPrice / entryPrice) * 100).toFixed(2)}% loss` };
    }
    if (currentPrice >= entryPrice * (1 + tpPct)) {
      return { shouldExit: true, reason: `fallback_take_profit: ${((currentPrice / entryPrice - 1) * 100).toFixed(2)}% gain` };
    }
  } else {
    if (currentPrice >= entryPrice * (1 + slPct)) {
      return { shouldExit: true, reason: `fallback_stop_loss: ${((currentPrice / entryPrice - 1) * 100).toFixed(2)}% loss (short)` };
    }
    if (currentPrice <= entryPrice * (1 - tpPct)) {
      return { shouldExit: true, reason: `fallback_take_profit: ${((1 - currentPrice / entryPrice) * 100).toFixed(2)}% gain (short)` };
    }
  }

  return { shouldExit: false, reason: 'ok' };
}

/**
 * Execute the exit: place exit order, record outcome, update risk exposure.
 *
 * @param {object} trade - The open trade record
 * @param {number} currentPrice - Current market price
 * @param {string} reason - Why we are exiting
 * @param {object} exitDecision - Full exit decision context
 * @returns {Promise<{ success: boolean, pnl: number, exitPrice: number }>}
 */
async function executeExit(trade, currentPrice, reason, exitDecision) {
  try {
    // 1. Place exit order
    const orderResult = await placeExitOrder(trade, currentPrice, reason);

    if (!orderResult.success) {
      _log.warn('exit order failed, will retry next cycle', {
        tradeId: trade.id,
        reason,
        method: orderResult.method,
      });
      return { success: false, pnl: 0, exitPrice: currentPrice };
    }

    const exitPrice = orderResult.exitPrice;
    const fees = orderResult.fees;

    // 2. Calculate P&L
    const rawPnl = trade.side === 'buy'
      ? (exitPrice - trade.entryPrice) / trade.entryPrice * trade.usdSize
      : (trade.entryPrice - exitPrice) / trade.entryPrice * trade.usdSize;
    const pnl = Math.round((rawPnl - fees) * 100) / 100;
    const pnlPercent = Math.round((rawPnl / trade.usdSize) * 10000) / 100;

    // 3. Record outcome in trade journal
    if (tradeJournal && typeof tradeJournal.recordOutcome === 'function') {
      try {
        tradeJournal.recordOutcome(trade.id, {
          exitPrice,
          fillPrice: exitPrice,
          pnl,
          pnlPercent,
          fees,
        });
      } catch (err) {
        _log.error('failed to record outcome in journal', {
          tradeId: trade.id,
          error: err?.message,
        });
        // Fallback: try updateTradeById
        if (tradeJournal.updateTradeById) {
          try {
            tradeJournal.updateTradeById(trade.id, {
              exitPrice,
              fillPrice: exitPrice,
              pnl,
              pnlPercent,
              fees,
              outcome: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven',
              closedAt: new Date().toISOString(),
              exitReason: reason,
              exitMethod: orderResult.method,
            });
          } catch (e2) {
            _log.error('fallback updateTradeById also failed', { tradeId: trade.id, error: e2?.message });
          }
        }
      }
    }

    // 4. Update risk-manager exposure tracking
    if (riskManager) {
      try {
        if (typeof riskManager.closeExposure === 'function') {
          // Close by orderId (from entry) if available
          const exposureKey = trade.orderId || trade.id;
          riskManager.closeExposure(exposureKey);
        }
      } catch (err) {
        _log.warn('failed to close exposure in risk-manager', {
          tradeId: trade.id,
          error: err?.message,
        });
      }

      // Record P&L for drawdown / equity tracking
      try {
        if (typeof riskManager.recordPnl === 'function') {
          riskManager.recordPnl(pnl);
        }
      } catch (err) {
        _log.warn('failed to record P&L in risk-manager', {
          tradeId: trade.id,
          error: err?.message,
        });
      }
    }

    // 5. Clean up trailing state
    trailingState.delete(trade.id);

    _log.info('position closed', {
      tradeId: trade.id,
      venue: trade.venue,
      asset: trade.asset,
      side: trade.side,
      entryPrice: trade.entryPrice,
      exitPrice,
      pnl,
      pnlPercent,
      fees,
      reason,
      method: orderResult.method,
      holdTimeMs: Date.now() - (trade.entryTs || 0),
    });

    return { success: true, pnl, exitPrice };
  } catch (err) {
    _log.error('executeExit failed', {
      tradeId: trade.id,
      error: err?.message || String(err),
    });
    return { success: false, pnl: 0, exitPrice: currentPrice };
  }
}

/**
 * Remove trailing state entries for trades that are no longer open.
 */
function cleanupTrailingState() {
  if (trailingState.size === 0) return;
  try {
    const openIds = new Set(getOpenPositions().map(t => t.id));
    for (const tradeId of trailingState.keys()) {
      if (!openIds.has(tradeId)) {
        trailingState.delete(tradeId);
      }
    }
  } catch {
    // Best-effort cleanup
  }
}

// ─── Exit Loop ────────────────────────────────────────────────────────────────

let exitLoopTimer = null;
let _trailPersistCounter = 0;

/**
 * Run checkExits on a recurring interval.
 * @param {number} [intervalMs] - Override interval (defaults to EXIT_CHECK_INTERVAL_MS)
 * @returns {{ stop: Function }} - Call .stop() to halt the loop
 */
function runExitLoop(intervalMs) {
  const interval = intervalMs != null
    ? Math.max(10000, Math.min(120000, intervalMs))
    : EXIT_CHECK_INTERVAL_MS;

  // Prevent duplicate loops
  if (exitLoopTimer) {
    _log.warn('exit loop already running, not starting another');
    return { stop: () => stopExitLoop() };
  }

  _log.info('starting exit manager loop', { intervalMs: interval });

  // Run immediately on start, then on interval
  checkExits().catch(err => {
    _log.error('initial exit check failed', { error: err?.message || String(err) });
  });

  exitLoopTimer = setInterval(() => {
    checkExits().then(() => {
      // PERF: Persist trailing stop state every 5 cycles (~2.5 min) instead of only at shutdown
      _trailPersistCounter++;
      if (_trailPersistCounter % 5 === 0 && trailingState.size > 0) {
        try {
          const asyncExec = require('./async-executor');
          const positions = [];
          for (const [tradeId, state] of trailingState.entries()) {
            positions.push({ tradeId, highestSinceEntry: state.highestSinceEntry, lowestSinceEntry: state.lowestSinceEntry });
          }
          asyncExec.saveTrailingStopState({ positions });
        } catch { /* best-effort periodic persist */ }
      }
    }).catch(err => {
      _log.error('exit check cycle failed', { error: err?.message || String(err) });
    });
  }, interval);

  // Allow the process to exit cleanly (don't hold event loop)
  if (exitLoopTimer.unref) exitLoopTimer.unref();

  return { stop: () => stopExitLoop() };
}

/**
 * Stop the exit loop.
 */
function stopExitLoop() {
  if (exitLoopTimer) {
    clearInterval(exitLoopTimer);
    exitLoopTimer = null;
    _log.info('exit manager loop stopped');
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  checkExits,
  runExitLoop,
  getOpenPositions,
  restoreTrailingState,
};
