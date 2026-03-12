#!/usr/bin/env node

// NOTE: Add to venue-engine.js map:
//   ibkr: ['node', ['scripts/ibkr-engine.js']]

// IBKR Client Portal API requires ignoring self-signed certs on localhost gateway
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const ENABLED = String(process.env.IBKR_ENABLED || 'false').toLowerCase() === 'true';
const DRY_RUN = String(process.env.IBKR_DRY_RUN || 'true').toLowerCase() !== 'false';

const GATEWAY_URL = (process.env.IBKR_GATEWAY_URL || 'https://localhost:5000').replace(/\/$/, '');
const ACCOUNT_ID = (process.env.IBKR_ACCOUNT_ID || '').trim();
const SYMBOLS = String(process.env.IBKR_SYMBOLS || 'AAPL,MSFT,GOOGL,AMZN,NVDA,SPY,QQQ')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const ORDER_USD = Math.min(10000, Math.max(5, Number(process.env.IBKR_ORDER_USD || 50)));
const MAX_ORDER_USD = Math.min(50000, Math.max(ORDER_USD, Number(process.env.IBKR_MAX_ORDER_USD || 200)));
const MIN_CONFIDENCE = Math.max(0.5, Math.min(0.95, Number(process.env.IBKR_MIN_CONFIDENCE || 0.58)));
const MAX_ORDERS_PER_CYCLE = Math.max(1, Math.min(5, Number(process.env.IBKR_MAX_ORDERS_PER_CYCLE || 2)));
const MIN_INTERVAL_SEC = Math.min(86400, Math.max(0, Number(process.env.IBKR_MIN_INTERVAL_SEC || 600)));
const SIDE_MODE = String(process.env.IBKR_SIDE_MODE || 'momentum').toLowerCase(); // momentum|buy_only|sell_only
const REQUEST_TIMEOUT_MS = Math.min(120000, Math.max(3000, Number(process.env.IBKR_TIMEOUT_MS || 15000)));
const STATE_FILE = process.env.IBKR_STATE_FILE || 'data/ibkr-state.json';

// Alpaca data API credentials for historical bars fallback
const ALPACA_DATA_URL = (process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets').replace(/\/$/, '');
const ALPACA_API_KEY = (process.env.ALPACA_API_KEY || '').trim();
const ALPACA_API_SECRET = (process.env.ALPACA_API_SECRET || '').trim();

let edgeDetector, tradeJournal, brain, riskManager, liquidationGuardian, capitalMandate;
try { edgeDetector = require('../lib/edge-detector'); } catch { edgeDetector = null; }
try { tradeJournal = require('../lib/trade-journal'); } catch { tradeJournal = null; }
try { brain = require('../lib/self-evolving-brain'); } catch { brain = null; }
try { riskManager = require('../lib/risk-manager'); } catch { riskManager = null; }
try { liquidationGuardian = require('../lib/liquidation-guardian'); } catch { liquidationGuardian = null; }
try { capitalMandate = require('../lib/capital-mandate'); } catch { capitalMandate = null; }

// Resilient I/O for atomic state writes
let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

// --- Timeout / Fetch Helpers ------------------------------------------------

function withTimeout(ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { controller, timeout };
}

async function fetchJson(url, options = {}) {
  const { controller, timeout } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${JSON.stringify(payload).slice(0, 280)}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

// --- IBKR Client Portal API Client ------------------------------------------

async function ibkrFetch(urlPath, options = {}) {
  const url = `${GATEWAY_URL}${urlPath}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (rio) {
    return rio.circuitBreaker('ibkr', () =>
      rio.fetchJsonRetry(url, { ...options, headers }, { timeoutMs: REQUEST_TIMEOUT_MS, retries: 2 }),
      { failureThreshold: 5, resetTimeMs: 120000 }
    );
  }

  return fetchJson(url, { ...options, headers });
}

// --- State Management -------------------------------------------------------

function loadState() {
  const abs = path.resolve(process.cwd(), STATE_FILE);
  if (rio) {
    const data = rio.readJsonSafe(abs, { fallback: null });
    return { path: abs, data: data || { lastRunAt: 0, conidCache: {} } };
  }
  if (!fs.existsSync(abs)) return { path: abs, data: { lastRunAt: 0, conidCache: {} } };
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (!parsed.conidCache) parsed.conidCache = {};
    return { path: abs, data: parsed };
  } catch {
    return { path: abs, data: { lastRunAt: 0, conidCache: {} } };
  }
}

function saveState(abs, data) {
  if (rio) { rio.writeJsonAtomic(abs, data); return; }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, abs);
}

// --- Market Hours Check -----------------------------------------------------

function isMarketOpen() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const hour = et.getHours();
  const min = et.getMinutes();
  const timeMinutes = hour * 60 + min;
  // Mon-Fri, 9:30 AM - 4:00 PM ET
  return day >= 1 && day <= 5 && timeMinutes >= 570 && timeMinutes < 960;
}

// --- IBKR Auth Check --------------------------------------------------------

async function checkAuth() {
  try {
    const status = await ibkrFetch('/v1/api/iserver/auth/status');
    return {
      authenticated: !!(status?.authenticated),
      competing: !!(status?.competing),
      connected: !!(status?.connected),
      raw: status,
    };
  } catch (err) {
    return { authenticated: false, competing: false, connected: false, error: err?.message || String(err) };
  }
}

// --- Contract Resolution (conid) --------------------------------------------

let _stateRef = null; // set during main() so resolveConid can access the shared state

async function resolveConid(symbol) {
  // Check cache first
  if (_stateRef && _stateRef.data.conidCache[symbol]) {
    return _stateRef.data.conidCache[symbol];
  }

  try {
    const results = await ibkrFetch(
      `/v1/api/iserver/secdef/search?symbol=${encodeURIComponent(symbol)}&secType=STK`
    );

    const contracts = Array.isArray(results) ? results : [];
    // Find the US-listed stock match (prefer NASDAQ/NYSE)
    const match = contracts.find((c) =>
      String(c?.description || '').toUpperCase().includes(symbol) ||
      String(c?.symbol || '').toUpperCase() === symbol
    ) || contracts[0];

    if (!match?.conid) {
      throw new Error(`no conid found for ${symbol}`);
    }

    const conid = Number(match.conid);

    // Cache in state
    if (_stateRef) {
      _stateRef.data.conidCache[symbol] = conid;
      const keys = Object.keys(_stateRef.data.conidCache);
      if (keys.length > 500) {
        const keep = keys.slice(-250);
        const trimmed = {};
        for (const k of keep) trimmed[k] = _stateRef.data.conidCache[k];
        _stateRef.data.conidCache = trimmed;
      }
    }

    return conid;
  } catch (err) {
    console.error(`[ibkr] conid resolution failed for ${symbol}: ${err?.message || err}`);
    return null;
  }
}

// --- Market Data (snapshot) -------------------------------------------------

async function getMarketData(conid) {
  // The Client Portal API may need two calls: first initiates the subscription,
  // second returns actual data. We retry once with a short delay.
  const url = `/v1/api/iserver/marketdata/snapshot?conids=${conid}&fields=31,84,86`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await ibkrFetch(url);
      const row = Array.isArray(resp) ? resp[0] : resp;
      const lastPrice = Number(row?.['31'] || 0);
      const bid = Number(row?.['84'] || 0);
      const ask = Number(row?.['86'] || 0);

      if (lastPrice > 0) {
        return { lastPrice, bid, ask, conid };
      }

      // First call may return empty; wait briefly and retry
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      console.error(`[ibkr] market data attempt ${attempt + 1} for conid ${conid}: ${err?.message || err}`);
    }
  }

  return { lastPrice: 0, bid: 0, ask: 0, conid };
}

// --- Signal Generation (Alpaca data fallback for historical bars) -----------

async function alpacaDataFetch(url) {
  const headers = {};
  if (ALPACA_API_KEY && ALPACA_API_SECRET) {
    headers['APCA-API-KEY-ID'] = ALPACA_API_KEY;
    headers['APCA-API-SECRET-KEY'] = ALPACA_API_SECRET;
  }
  return fetchJson(url, { headers });
}

function resolveSide(signal) {
  if (SIDE_MODE === 'buy_only') return 'buy';
  if (SIDE_MODE === 'sell_only') return 'sell';
  return signal;
}

/**
 * Fetch 1h bars via Alpaca data API and compute indicators using edge-detector.
 * Falls back gracefully if Alpaca creds are missing or data fetch fails.
 */
async function getSymbolSignal(symbol) {
  const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const barsUrl = `${ALPACA_DATA_URL}/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=1Hour&start=${encodeURIComponent(start)}&limit=100`;

  let bars = [];
  try {
    const resp = await alpacaDataFetch(barsUrl);
    bars = Array.isArray(resp?.bars) ? resp.bars : [];
  } catch (err) {
    console.error(`[ibkr] bars fetch failed for ${symbol}: ${err?.message || err}`);
    return { side: 'neutral', confidence: 0.5, returnBps: 0, edge: 0, symbol };
  }

  if (bars.length < 20) {
    return { side: 'neutral', confidence: 0.5, returnBps: 0, edge: 0, symbol, reason: 'insufficient bars' };
  }

  const candles = bars.map((b) => ({
    ts: new Date(b.t).getTime(),
    open: Number(b.o),
    high: Number(b.h),
    low: Number(b.l),
    close: Number(b.c),
    volume: Number(b.v),
  })).filter((c) => Number.isFinite(c.close) && c.close > 0);

  if (candles.length < 20) {
    return { side: 'neutral', confidence: 0.5, returnBps: 0, edge: 0, symbol, reason: 'insufficient valid candles' };
  }

  const closes = candles.map((c) => c.close);
  const lastPrice = closes[closes.length - 1];
  const components = {};

  let compositeScore = 0;

  // 1. EMA crossover (8/21)
  let ema8Arr = [], ema21Arr = [];
  if (edgeDetector) {
    ema8Arr = edgeDetector.ema(closes, 8);
    ema21Arr = edgeDetector.ema(closes, 21);
  }

  if (ema8Arr.length >= 2 && ema21Arr.length >= 2) {
    const ema8Last = ema8Arr[ema8Arr.length - 1];
    const ema21Last = ema21Arr[ema21Arr.length - 1];
    const ema8Prev = ema8Arr[ema8Arr.length - 2];
    const ema21Prev = ema21Arr[ema21Arr.length - 2];

    let emaStrength = 0;
    let emaDirection = 'neutral';
    if (ema8Last > ema21Last) {
      emaDirection = 'buy';
      emaStrength = Math.min(1, (ema8Last - ema21Last) / ema21Last * 1000);
    } else if (ema8Last < ema21Last) {
      emaDirection = 'sell';
      emaStrength = Math.min(1, (ema21Last - ema8Last) / ema21Last * 1000);
    }

    const justCrossedUp = ema8Prev <= ema21Prev && ema8Last > ema21Last;
    const justCrossedDown = ema8Prev >= ema21Prev && ema8Last < ema21Last;
    if (justCrossedUp || justCrossedDown) emaStrength = Math.min(1, emaStrength + 0.3);

    if (emaDirection === 'buy') compositeScore += 0.30 * emaStrength;
    else if (emaDirection === 'sell') compositeScore -= 0.30 * emaStrength;

    components.ema = { direction: emaDirection, strength: emaStrength, ema8: ema8Last, ema21: ema21Last };
  }

  // 2. RSI(14)
  let rsiVal = null;
  if (edgeDetector) {
    rsiVal = edgeDetector.rsi(closes, 14);
  }
  components.rsi = rsiVal;

  if (rsiVal !== null) {
    if (rsiVal > 70) compositeScore -= 0.15;
    else if (rsiVal < 30) compositeScore += 0.15;
    else if (rsiVal > 55) compositeScore += 0.15 * 0.33;
    else if (rsiVal < 45) compositeScore -= 0.15 * 0.33;
  }

  // 3. Bollinger Bands
  let bb = null;
  if (edgeDetector) {
    bb = edgeDetector.bollingerBands(closes, 20, 2);
  }
  components.bollingerBands = bb;

  if (bb) {
    if (bb.percentB > 0.9) compositeScore -= 0.10;
    else if (bb.percentB < 0.1) compositeScore += 0.10;
    if (bb.width < 0.02) compositeScore *= 1.15;
    else if (bb.width > 0.08) compositeScore *= 0.85;
  }

  // 4. ATR-based volatility
  let atrVal = null;
  if (edgeDetector) {
    atrVal = edgeDetector.atr(candles, 14);
  }
  components.atr = atrVal;

  const atrPercent = lastPrice > 0 && atrVal ? (atrVal / lastPrice) * 100 : 1;
  components.atrPercent = atrPercent;

  // 5. Volume confirmation
  let volCheck = { confirmed: true, ratio: 1 };
  if (edgeDetector) {
    volCheck = edgeDetector.volumeConfirmation(candles, 20);
  }
  components.volumeConfirmation = volCheck;

  if (!volCheck.confirmed && Math.abs(compositeScore) > 0.1) {
    compositeScore *= 0.75;
  }
  if (volCheck.ratio > 2.0) {
    compositeScore *= 1.1;
  }

  // 6. Price momentum (simple return)
  const firstClose = closes[0];
  const returnBps = ((lastPrice - firstClose) / firstClose) * 10000;
  components.returnBps = returnBps;

  // --- Final resolution
  const absScore = Math.abs(compositeScore);

  let side = 'neutral';
  if (compositeScore > 0.02) side = 'buy';
  else if (compositeScore < -0.02) side = 'sell';

  const confidence = Math.min(0.95, 0.5 + absScore * 0.75);
  const edge = Math.min(1, absScore * 2);

  return { side, confidence, edge, compositeScore, returnBps, symbol, lastPrice, components };
}

// --- Order Placement --------------------------------------------------------

async function placeOrder(symbol, side, conid, orderUsd, lastPrice) {
  const quantity = lastPrice > 0 ? Math.max(1, Math.floor(orderUsd / lastPrice)) : 1;

  const orderPayload = {
    orders: [{
      conid,
      orderType: 'MKT',
      side: side.toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
      quantity,
      tif: 'DAY',
      outsideRTH: false,
    }],
  };

  if (DRY_RUN) {
    return {
      status: 'dry-run',
      order: orderPayload.orders[0],
      usdNotional: Number((quantity * lastPrice).toFixed(2)),
    };
  }

  try {
    const result = await ibkrFetch(`/v1/api/iserver/account/${ACCOUNT_ID}/orders`, {
      method: 'POST',
      body: JSON.stringify(orderPayload),
    });

    // IBKR may return a confirmation prompt that requires a reply
    if (Array.isArray(result) && result[0]?.id && result[0]?.message) {
      // Confirm the order by replying to the confirmation
      try {
        const confirmResult = await ibkrFetch(`/v1/api/iserver/reply/${result[0].id}`, {
          method: 'POST',
          body: JSON.stringify({ confirmed: true }),
        });

        const confirmed = Array.isArray(confirmResult)
          ? confirmResult.some((r) => r?.order_id || r?.orderId)
          : !!(confirmResult?.order_id || confirmResult?.orderId);

        return {
          status: confirmed ? 'placed' : 'error',
          order: orderPayload.orders[0],
          result: confirmResult,
          ...(confirmed ? {} : { error: 'confirmation failed' }),
        };
      } catch (confirmErr) {
        return { status: 'error', order: orderPayload.orders[0], error: `confirm-error: ${confirmErr?.message || confirmErr}` };
      }
    }

    // Direct placement (no confirmation needed)
    const success = Array.isArray(result)
      ? result.some((r) => r?.order_id || r?.orderId)
      : !!(result?.order_id || result?.orderId);

    return {
      status: success ? 'placed' : 'error',
      order: orderPayload.orders[0],
      result,
      ...(success ? {} : { error: result?.error || result?.message || 'order_rejected' }),
    };
  } catch (err) {
    return { status: 'error', order: orderPayload.orders[0], error: err?.message || String(err) };
  }
}

// --- Account / Positions Info -----------------------------------------------

async function getAccountSummary() {
  try {
    const accounts = await ibkrFetch('/v1/api/portfolio/accounts');
    const acctId = ACCOUNT_ID || (Array.isArray(accounts) && accounts[0]?.id) || '';
    if (!acctId) return { equity: 0, buyingPower: 0, status: 'no-account' };

    const positions = await ibkrFetch(`/v1/api/portfolio/${acctId}/positions/0`);
    const totalValue = Array.isArray(positions)
      ? positions.reduce((sum, p) => sum + Number(p?.mktValue || 0), 0)
      : 0;

    return { accountId: acctId, positionCount: Array.isArray(positions) ? positions.length : 0, totalPositionValue: totalValue, status: 'ok' };
  } catch (err) {
    return { equity: 0, buyingPower: 0, status: 'error', error: err?.message || String(err) };
  }
}

// --- Main -------------------------------------------------------------------

async function main() {
  if (!ENABLED) {
    console.log(JSON.stringify({ venue: 'ibkr', status: 'skipped', reason: 'IBKR_ENABLED is false' }, null, 2));
    return;
  }

  const state = loadState();
  _stateRef = state;
  const nowMs = Date.now();
  const sinceLastRunSec = state.data?.lastRunAt ? Math.floor((nowMs - Number(state.data.lastRunAt)) / 1000) : null;
  if (sinceLastRunSec !== null && sinceLastRunSec < MIN_INTERVAL_SEC) {
    console.log(JSON.stringify({ venue: 'ibkr', status: 'skipped', reason: `min-interval-not-met (${sinceLastRunSec}s/${MIN_INTERVAL_SEC}s)` }, null, 2));
    return;
  }

  // --- Market hours gate
  const marketOpen = isMarketOpen();
  if (!marketOpen) {
    console.log(JSON.stringify({ venue: 'ibkr', status: 'skipped', reason: 'market closed (outside 9:30am-4:00pm ET, Mon-Fri)', market: { open: false }, ts: new Date(nowMs).toISOString() }, null, 2));
    return;
  }

  // --- Gateway auth check
  const auth = await checkAuth();
  if (!auth.authenticated) {
    console.log(JSON.stringify({ venue: 'ibkr', status: 'skipped', reason: 'IBKR gateway not authenticated', auth, ts: new Date(nowMs).toISOString() }, null, 2));
    return;
  }

  // --- Brain time-of-day check
  const adaptiveMinConf = brain ? brain.getEvolvedMinConfidence(MIN_CONFIDENCE) : (tradeJournal ? tradeJournal.getAdaptiveMinConfidence(MIN_CONFIDENCE) : MIN_CONFIDENCE);

  if (brain) {
    try {
      const timeCheck = brain.shouldTradeNow();
      if (!timeCheck.trade) {
        console.log(JSON.stringify({ venue: 'ibkr', status: 'skipped', reason: `brain-time-filter: ${timeCheck.reason}` }, null, 2));
        return;
      }
    } catch (err) { console.error('[ibkr] brain time-check error:', err?.message || err); }
  }

  // --- Fetch account summary
  let account = { status: 'unknown' };
  if (!DRY_RUN && ACCOUNT_ID) {
    account = await getAccountSummary();
  }

  // --- Process each symbol
  const actions = [];
  let ordersPlaced = 0;

  for (const symbol of SYMBOLS) {
    if (ordersPlaced >= MAX_ORDERS_PER_CYCLE) break;

    // Resolve IBKR contract ID
    const conid = await resolveConid(symbol);
    if (!conid) {
      actions.push({ symbol, status: 'skipped', reason: 'conid resolution failed' });
      continue;
    }

    // Fetch live quote from IBKR for price reference
    const quote = await getMarketData(conid);

    // Get composite signal via edge-detector or local indicator computation
    let signal, signalComponents = {}, effectiveOrderUsd = ORDER_USD;

    if (edgeDetector) {
      try {
        const composite = await edgeDetector.getCompositeSignal({ asset: symbol });
        signal = { side: composite.side, confidence: composite.confidence, returnBps: composite.compositeScore * 100, edge: composite.edge, compositeScore: composite.compositeScore, symbol };
        signalComponents = composite.components || {};
        effectiveOrderUsd = edgeDetector.dynamicOrderSize(composite, ORDER_USD, MAX_ORDER_USD / ORDER_USD);
      } catch {
        // Asset not in edge-detector map -- use local bars-based signal
        signal = await getSymbolSignal(symbol);
        signalComponents = signal.components || {};
      }
    } else {
      signal = await getSymbolSignal(symbol);
      signalComponents = signal.components || {};
    }

    // Use IBKR live price if available, otherwise signal's last price
    const livePrice = quote.lastPrice > 0 ? quote.lastPrice : (signal.lastPrice || 0);

    const side = resolveSide(signal.side);

    // --- Confidence gate
    if (side === 'neutral' || signal.confidence < adaptiveMinConf) {
      actions.push({
        symbol,
        status: 'skipped',
        reason: signal.confidence < adaptiveMinConf
          ? `confidence ${signal.confidence.toFixed(3)} below threshold ${adaptiveMinConf.toFixed(3)}`
          : 'neutral signal',
        signal: { side: signal.side, confidence: signal.confidence, returnBps: signal.returnBps },
      });
      continue;
    }

    // --- Capital mandate gate
    if (capitalMandate) {
      const mandateSize = capitalMandate.mandateAdjustedSize({ baseUsd: effectiveOrderUsd, confidence: signal.confidence, edge: signal.edge || 0 });
      if (mandateSize <= 0) {
        actions.push({ symbol, status: 'skipped', reason: 'capital-mandate: mode prevents trade' });
        continue;
      }
      const mandateCheck = capitalMandate.checkMandate({ usdSize: mandateSize, confidence: signal.confidence, edge: signal.edge || 0, asset: symbol, venue: 'ibkr' });
      if (!mandateCheck.allowed) {
        actions.push({ symbol, status: 'skipped', reason: `mandate-denied: ${mandateCheck.reasons.join(', ')}`, mode: mandateCheck.mode });
        continue;
      }
      effectiveOrderUsd = Math.min(effectiveOrderUsd, mandateSize);
    }

    // --- Liquidation guardian gate
    if (liquidationGuardian) {
      const marginCheck = liquidationGuardian.shouldAllowNewTrade('ibkr', { tradeType: 'equity' });
      if (!marginCheck.allowed) {
        actions.push({ symbol, status: 'skipped', reason: `guardian-blocked: ${marginCheck.reason}` });
        continue;
      }
    }

    // --- Risk manager gate
    if (riskManager) {
      const check = riskManager.checkTradeAllowed({ asset: symbol, side, usdSize: effectiveOrderUsd, venue: 'ibkr', confidence: signal.confidence });
      if (!check.allowed) {
        actions.push({ symbol, status: 'skipped', reason: `risk-denied: ${check.reasons.join(', ')}`, exposure: check.exposure });
        continue;
      }
      effectiveOrderUsd = riskManager.riskAdjustedSize({ baseUsd: effectiveOrderUsd, confidence: signal.confidence, edge: signal.edge || 0, asset: symbol, venue: 'ibkr' });
    }

    // --- Account ID gate (required for live trading)
    if (!DRY_RUN && !ACCOUNT_ID) {
      actions.push({ symbol, status: 'skipped', reason: 'missing IBKR_ACCOUNT_ID for live trading' });
      continue;
    }

    // --- Place order
    const action = await placeOrder(symbol, side, conid, effectiveOrderUsd, livePrice);
    action.symbol = symbol;
    action.side = side;
    action.effectiveOrderUsd = effectiveOrderUsd;
    action.livePrice = livePrice;
    action.signal = { side: signal.side, confidence: signal.confidence, returnBps: signal.returnBps, edge: signal.edge };
    actions.push(action);

    if (action.status === 'placed' || action.status === 'dry-run') {
      ordersPlaced += 1;
    }

    // Record in trade journal
    if (tradeJournal) {
      try {
        tradeJournal.recordTrade({
          venue: 'ibkr',
          asset: symbol,
          side,
          entryPrice: livePrice,
          usdSize: effectiveOrderUsd,
          signal,
          signalComponents,
          dryRun: DRY_RUN,
          orderId: action.result?.order_id || action.result?.orderId || null,
        });
      } catch (err) { console.error(`[ibkr] journal record error for ${symbol}:`, err?.message || err); }
    }
  }

  // --- Update state
  state.data.lastRunAt = nowMs;
  state.data.lastActions = actions.map((a) => ({ symbol: a.symbol, status: a.status, side: a.side }));
  saveState(state.path, state.data);

  // --- Final output
  const overallStatus = actions.some((a) => a.status === 'placed') ? 'placed'
    : actions.some((a) => a.status === 'dry-run') ? 'dry-run'
    : actions.some((a) => a.status === 'error') ? 'error'
    : 'skipped';

  console.log(JSON.stringify({
    venue: 'ibkr',
    status: overallStatus,
    ts: new Date(nowMs).toISOString(),
    enabled: true,
    dryRun: DRY_RUN,
    symbols: SYMBOLS,
    sideMode: SIDE_MODE,
    adaptiveMinConf,
    market: { open: marketOpen },
    auth: { authenticated: auth.authenticated, connected: auth.connected },
    account,
    actions,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
