#!/usr/bin/env node

// NOTE: Add to venue-engine.js map:
//   alpaca: ['node', ['scripts/alpaca-equities-engine.js']]

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const ENABLED = String(process.env.ALPACA_ENABLED || 'false').toLowerCase() === 'true';
const DRY_RUN = String(process.env.ALPACA_DRY_RUN || 'true').toLowerCase() !== 'false';

const BASE_URL = (process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets').replace(/\/$/, '');
const DATA_URL = (process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets').replace(/\/$/, '');
const API_KEY = (process.env.ALPACA_API_KEY || '').trim();
const API_SECRET = (process.env.ALPACA_API_SECRET || '').trim();
const SYMBOLS = String(process.env.ALPACA_SYMBOLS || 'SPY,QQQ,AAPL,MSFT,NVDA')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const ORDER_USD = Math.min(10000, Math.max(5, Number(process.env.ALPACA_ORDER_USD || 25)));
const MAX_ORDER_USD = Math.min(50000, Math.max(ORDER_USD, Number(process.env.ALPACA_MAX_ORDER_USD || 100)));
const MIN_CONFIDENCE = Math.max(0.5, Math.min(0.95, Number(process.env.ALPACA_MIN_CONFIDENCE || 0.56)));
const MAX_ORDERS_PER_CYCLE = Math.max(1, Math.min(5, Number(process.env.ALPACA_MAX_ORDERS_PER_CYCLE || 2)));
const MIN_INTERVAL_SEC = Math.min(86400, Math.max(0, Number(process.env.ALPACA_MIN_INTERVAL_SEC || 300)));
const SIDE_MODE = String(process.env.ALPACA_SIDE_MODE || 'momentum').toLowerCase(); // momentum|buy_only|sell_only
const REQUEST_TIMEOUT_MS = Math.min(120000, Math.max(3000, Number(process.env.ALPACA_TIMEOUT_MS || 15000)));
const STATE_FILE = process.env.ALPACA_STATE_FILE || 'data/alpaca-equities-state.json';
const USE_COMPOSITE_SIGNAL = String(process.env.ALPACA_USE_COMPOSITE_SIGNAL || 'true').toLowerCase() !== 'false';

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

// ─── Timeout / Fetch Helpers ──────────────────────────────────────────────────

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

// ─── Alpaca API Client ────────────────────────────────────────────────────────

async function alpacaFetch(urlPath, options = {}) {
  const url = urlPath.startsWith('http') ? urlPath : `${BASE_URL}${urlPath}`;
  const headers = {
    'APCA-API-KEY-ID': API_KEY,
    'APCA-API-SECRET-KEY': API_SECRET,
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (rio) {
    return rio.circuitBreaker('alpaca', () =>
      rio.fetchJsonRetry(url, { ...options, headers }, { timeoutMs: REQUEST_TIMEOUT_MS, retries: 2 }),
      { failureThreshold: 5, resetTimeMs: 120000 }
    );
  }

  // Fallback: basic fetch with timeout
  return fetchJson(url, { ...options, headers });
}

async function alpacaDataFetch(urlPath, options = {}) {
  const url = urlPath.startsWith('http') ? urlPath : `${DATA_URL}${urlPath}`;
  const headers = {
    'APCA-API-KEY-ID': API_KEY,
    'APCA-API-SECRET-KEY': API_SECRET,
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (rio) {
    return rio.circuitBreaker('alpaca-data', () =>
      rio.fetchJsonRetry(url, { ...options, headers }, { timeoutMs: REQUEST_TIMEOUT_MS, retries: 2 }),
      { failureThreshold: 5, resetTimeMs: 120000 }
    );
  }

  return fetchJson(url, { ...options, headers });
}

// ─── State Management ─────────────────────────────────────────────────────────

function loadState() {
  const abs = path.resolve(process.cwd(), STATE_FILE);
  if (rio) {
    const data = rio.readJsonSafe(abs, { fallback: null });
    return { path: abs, data: data || { lastRunAt: 0 } };
  }
  if (!fs.existsSync(abs)) return { path: abs, data: { lastRunAt: 0 } };
  try {
    return { path: abs, data: JSON.parse(fs.readFileSync(abs, 'utf8')) };
  } catch {
    return { path: abs, data: { lastRunAt: 0 } };
  }
}

function saveState(abs, data) {
  if (rio) { rio.writeJsonAtomic(abs, data); return; }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, abs);
}

// ─── Market Hours Check ───────────────────────────────────────────────────────

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

// ─── Signal Helpers ───────────────────────────────────────────────────────────

function resolveSide(signal) {
  if (SIDE_MODE === 'buy_only') return 'buy';
  if (SIDE_MODE === 'sell_only') return 'sell';
  return signal;
}

/**
 * Fetch 1h bars from Alpaca market data API and compute indicators.
 * Returns a signal with side, confidence, edge, returnBps, and components.
 */
async function getSymbolSignal(symbol) {
  const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const barsUrl = `${DATA_URL}/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=1Hour&start=${encodeURIComponent(start)}&limit=100`;

  let bars = [];
  try {
    const resp = await alpacaDataFetch(barsUrl);
    bars = Array.isArray(resp?.bars) ? resp.bars : [];
  } catch (err) {
    console.error(`[alpaca] bars fetch failed for ${symbol}: ${err?.message || err}`);
    return { side: 'neutral', confidence: 0.5, returnBps: 0, edge: 0, symbol };
  }

  if (bars.length < 20) {
    return { side: 'neutral', confidence: 0.5, returnBps: 0, edge: 0, symbol, reason: 'insufficient bars' };
  }

  // Build candle array compatible with edge-detector indicators
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

  // ─── Compute Indicators ───────────────────────────────────────────────────

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

    // Fresh crossover bonus
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
    if (rsiVal > 70) compositeScore -= 0.15;        // overbought -> bearish
    else if (rsiVal < 30) compositeScore += 0.15;    // oversold -> bullish
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

    if (bb.width < 0.02) compositeScore *= 1.15;        // squeeze bonus
    else if (bb.width > 0.08) compositeScore *= 0.85;    // high vol penalty
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
    compositeScore *= 0.75; // reduce conviction without volume confirmation
  }
  if (volCheck.ratio > 2.0) {
    compositeScore *= 1.1; // volume surge bonus
  }

  // 6. Price momentum (simple return)
  const firstClose = closes[0];
  const returnBps = ((lastPrice - firstClose) / firstClose) * 10000;
  components.returnBps = returnBps;

  // ─── Final resolution ─────────────────────────────────────────────────────
  const absScore = Math.abs(compositeScore);

  let side = 'neutral';
  if (compositeScore > 0.02) side = 'buy';
  else if (compositeScore < -0.02) side = 'sell';

  // Map |compositeScore| from [0, 0.6] -> [0.5, 0.95]
  const confidence = Math.min(0.95, 0.5 + absScore * 0.75);
  const edge = Math.min(1, absScore * 2);

  return {
    side,
    confidence,
    edge,
    compositeScore,
    returnBps,
    symbol,
    lastPrice,
    components,
  };
}

// ─── Order Placement ──────────────────────────────────────────────────────────

async function placeOrder(symbol, side, orderUsd) {
  const order = {
    symbol,
    notional: orderUsd.toFixed(2),
    side,
    type: 'market',
    time_in_force: 'day',
  };

  if (DRY_RUN) {
    return { status: 'dry-run', order, usdNotional: Number(order.notional) };
  }

  try {
    const result = await alpacaFetch('/v2/orders', {
      method: 'POST',
      body: JSON.stringify(order),
    });

    const success = result?.id && !result?.message;
    return {
      status: success ? 'placed' : 'error',
      order,
      result,
      ...(success ? {} : { error: result?.message || 'order_rejected' }),
    };
  } catch (err) {
    return { status: 'error', order, error: err?.message || String(err) };
  }
}

// ─── Account Info ─────────────────────────────────────────────────────────────

async function getAccount() {
  try {
    const acct = await alpacaFetch('/v2/account');
    return {
      equity: Number(acct?.equity || 0),
      buyingPower: Number(acct?.buying_power || 0),
      cash: Number(acct?.cash || 0),
      portfolioValue: Number(acct?.portfolio_value || 0),
      status: acct?.status || 'unknown',
    };
  } catch (err) {
    return { equity: 0, buyingPower: 0, cash: 0, portfolioValue: 0, status: 'error', error: err?.message || String(err) };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!ENABLED) {
    console.log(JSON.stringify({ venue: 'alpaca', status: 'skipped', reason: 'ALPACA_ENABLED is false' }, null, 2));
    return;
  }

  const state = loadState();
  const nowMs = Date.now();
  const sinceLastRunSec = state.data?.lastRunAt ? Math.floor((nowMs - Number(state.data.lastRunAt)) / 1000) : null;
  if (sinceLastRunSec !== null && sinceLastRunSec < MIN_INTERVAL_SEC) {
    console.log(JSON.stringify({ venue: 'alpaca', status: 'skipped', reason: `min-interval-not-met (${sinceLastRunSec}s/${MIN_INTERVAL_SEC}s)` }, null, 2));
    return;
  }

  // ─── Market hours gate ──────────────────────────────────────────────────
  const marketOpen = isMarketOpen();
  if (!marketOpen) {
    console.log(JSON.stringify({ venue: 'alpaca', status: 'skipped', reason: 'market closed (outside 9:30am-4:00pm ET, Mon-Fri)', market: { open: false }, ts: new Date(nowMs).toISOString() }, null, 2));
    return;
  }

  // ─── Brain time-of-day check ────────────────────────────────────────────
  const adaptiveMinConf = brain ? brain.getEvolvedMinConfidence(MIN_CONFIDENCE) : (tradeJournal ? tradeJournal.getAdaptiveMinConfidence(MIN_CONFIDENCE) : MIN_CONFIDENCE);

  if (brain) {
    try {
      const timeCheck = brain.shouldTradeNow();
      if (!timeCheck.trade) {
        console.log(JSON.stringify({ venue: 'alpaca', status: 'skipped', reason: `brain-time-filter: ${timeCheck.reason}` }, null, 2));
        return;
      }
    } catch (err) { console.error('[alpaca] brain time-check error:', err?.message || err); }
  }

  // ─── Fetch account info ─────────────────────────────────────────────────
  let account = { equity: 0, buyingPower: 0, cash: 0, portfolioValue: 0, status: 'unknown' };
  if (!DRY_RUN && API_KEY && API_SECRET) {
    account = await getAccount();
  }

  // ─── Process each symbol ────────────────────────────────────────────────
  const actions = [];
  let ordersPlaced = 0;

  for (const symbol of SYMBOLS) {
    if (ordersPlaced >= MAX_ORDERS_PER_CYCLE) break;

    // Get composite signal for symbol
    let signal, signalComponents = {}, effectiveOrderUsd = ORDER_USD;

    if (USE_COMPOSITE_SIGNAL && edgeDetector) {
      try {
        // Use edge-detector's composite signal if the asset is in its map
        const composite = await edgeDetector.getCompositeSignal({ asset: symbol });
        signal = { side: composite.side, confidence: composite.confidence, returnBps: composite.compositeScore * 100, edge: composite.edge, compositeScore: composite.compositeScore, symbol };
        signalComponents = composite.components || {};
        effectiveOrderUsd = edgeDetector.dynamicOrderSize(composite, ORDER_USD, MAX_ORDER_USD / ORDER_USD);
      } catch {
        // Asset not in edge-detector map — use our local Alpaca bars signal
        signal = await getSymbolSignal(symbol);
        signalComponents = signal.components || {};
      }
    } else {
      signal = await getSymbolSignal(symbol);
      signalComponents = signal.components || {};
    }

    const side = resolveSide(signal.side);

    // ─── Confidence gate ──────────────────────────────────────────────────
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

    // ─── Capital mandate gate ─────────────────────────────────────────────
    if (capitalMandate) {
      const mandateSize = capitalMandate.mandateAdjustedSize({ baseUsd: effectiveOrderUsd, confidence: signal.confidence, edge: signal.edge || 0 });
      if (mandateSize <= 0) {
        actions.push({ symbol, status: 'skipped', reason: 'capital-mandate: mode prevents trade' });
        continue;
      }
      const mandateCheck = capitalMandate.checkMandate({ usdSize: mandateSize, confidence: signal.confidence, edge: signal.edge || 0, asset: symbol, venue: 'alpaca' });
      if (!mandateCheck.allowed) {
        actions.push({ symbol, status: 'skipped', reason: `mandate-denied: ${mandateCheck.reasons.join(', ')}`, mode: mandateCheck.mode });
        continue;
      }
      effectiveOrderUsd = Math.min(effectiveOrderUsd, mandateSize);
    }

    // ─── Liquidation guardian gate ────────────────────────────────────────
    if (liquidationGuardian) {
      const marginCheck = liquidationGuardian.shouldAllowNewTrade('alpaca', { tradeType: 'equity' });
      if (!marginCheck.allowed) {
        actions.push({ symbol, status: 'skipped', reason: `guardian-blocked: ${marginCheck.reason}` });
        continue;
      }
    }

    // ─── Risk manager gate ────────────────────────────────────────────────
    if (riskManager) {
      const check = riskManager.checkTradeAllowed({ asset: symbol, side, usdSize: effectiveOrderUsd, venue: 'alpaca', confidence: signal.confidence });
      if (!check.allowed) {
        actions.push({ symbol, status: 'skipped', reason: `risk-denied: ${check.reasons.join(', ')}`, exposure: check.exposure });
        continue;
      }
      effectiveOrderUsd = riskManager.riskAdjustedSize({ baseUsd: effectiveOrderUsd, confidence: signal.confidence, edge: signal.edge || 0, asset: symbol, venue: 'alpaca' });
    }

    // ─── Credentials gate ─────────────────────────────────────────────────
    if (!DRY_RUN && (!API_KEY || !API_SECRET)) {
      actions.push({ symbol, status: 'skipped', reason: 'missing ALPACA_API_KEY/ALPACA_API_SECRET' });
      continue;
    }

    // ─── Place order ──────────────────────────────────────────────────────
    const action = await placeOrder(symbol, side, effectiveOrderUsd);
    action.symbol = symbol;
    action.side = side;
    action.effectiveOrderUsd = effectiveOrderUsd;
    action.signal = { side: signal.side, confidence: signal.confidence, returnBps: signal.returnBps, edge: signal.edge };
    actions.push(action);

    if (action.status === 'placed' || action.status === 'dry-run') {
      ordersPlaced += 1;
    }

    // Record in trade journal
    if (tradeJournal) {
      try {
        tradeJournal.recordTrade({
          venue: 'alpaca',
          asset: symbol,
          side,
          entryPrice: signal.lastPrice || 0,
          usdSize: effectiveOrderUsd,
          signal,
          signalComponents,
          dryRun: DRY_RUN,
          orderId: action.result?.id || null,
        });
      } catch (err) { console.error(`[alpaca] journal record error for ${symbol}:`, err?.message || err); }
    }
  }

  // ─── Update state ───────────────────────────────────────────────────────
  state.data.lastRunAt = nowMs;
  state.data.lastActions = actions.map((a) => ({ symbol: a.symbol, status: a.status, side: a.side }));
  saveState(state.path, state.data);

  // ─── Final output ───────────────────────────────────────────────────────
  const overallStatus = actions.some((a) => a.status === 'placed') ? 'placed'
    : actions.some((a) => a.status === 'dry-run') ? 'dry-run'
    : actions.some((a) => a.status === 'error') ? 'error'
    : 'skipped';

  console.log(JSON.stringify({
    venue: 'alpaca',
    status: overallStatus,
    ts: new Date(nowMs).toISOString(),
    enabled: true,
    dryRun: DRY_RUN,
    symbols: SYMBOLS,
    sideMode: SIDE_MODE,
    compositeMode: USE_COMPOSITE_SIGNAL && !!edgeDetector,
    adaptiveMinConf,
    market: { open: marketOpen },
    account: {
      equity: account.equity,
      buyingPower: account.buyingPower,
    },
    actions,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
