#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const ENABLED = String(process.env.COINBASE_ENABLED || 'false').toLowerCase() === 'true';
const DRY_RUN = String(process.env.COINBASE_DRY_RUN || 'true').toLowerCase() !== 'false';

const BASE_URL = (process.env.COINBASE_BASE_URL || 'https://api.exchange.coinbase.com').replace(/\/$/, '');
const CDP_BASE_URL = (process.env.COINBASE_CDP_BASE_URL || 'https://api.coinbase.com').replace(/\/$/, '');
const API_KEY = (process.env.COINBASE_API_KEY || '').trim();
const API_SECRET = (process.env.COINBASE_API_SECRET || '').trim();
const API_PASSPHRASE = (process.env.COINBASE_API_PASSPHRASE || '').trim();
const COINBASE_CDP_MODE =
  String(process.env.COINBASE_CDP_MODE || '').toLowerCase() === 'true' ||
  (API_KEY.startsWith('organizations/') && API_SECRET.includes('BEGIN EC PRIVATE KEY'));
const PRODUCT_ID = (process.env.COINBASE_PRODUCT_ID || 'BTC-USD').trim();
const ORDER_USD = Math.max(5, Number(process.env.COINBASE_ORDER_USD || 15));
const MIN_CONFIDENCE = Math.max(0.5, Math.min(0.95, Number(process.env.COINBASE_MIN_CONFIDENCE || 0.56)));
const SIDE_MODE = String(process.env.COINBASE_SIDE_MODE || 'momentum').toLowerCase(); // momentum|buy_only|sell_only
const MAX_ORDERS_PER_CYCLE = Math.max(1, Math.min(3, Number(process.env.COINBASE_MAX_ORDERS_PER_CYCLE || 1)));
const MIN_INTERVAL_SEC = Math.max(0, Number(process.env.COINBASE_MIN_INTERVAL_SEC || 120));
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.COINBASE_TIMEOUT_MS || 15000));
const STATE_FILE = process.env.COINBASE_STATE_FILE || 'data/coinbase-spot-state.json';
const USE_COMPOSITE_SIGNAL = String(process.env.COINBASE_USE_COMPOSITE_SIGNAL || 'true').toLowerCase() !== 'false';
const MAX_ORDER_USD = Math.max(ORDER_USD, Number(process.env.COINBASE_MAX_ORDER_USD || 50));

let edgeDetector, tradeJournal, brain, riskManager, liquidationGuardian, capitalMandate;
try { edgeDetector = require('../lib/edge-detector'); } catch { edgeDetector = null; }
try { tradeJournal = require('../lib/trade-journal'); } catch { tradeJournal = null; }
try { brain = require('../lib/self-evolving-brain'); } catch { brain = null; }
try { riskManager = require('../lib/risk-manager'); } catch { riskManager = null; }
try { liquidationGuardian = require('../lib/liquidation-guardian'); } catch { liquidationGuardian = null; }
try { capitalMandate = require('../lib/capital-mandate'); } catch { capitalMandate = null; }

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

// Resilient I/O for atomic state writes
let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

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

async function getMomentumSignal() {
  let closes = [];

  try {
    const candles = await fetchJson('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60');
    closes = Array.isArray(candles)
      ? candles
          .slice(0, 12)
          .reverse()
          .map((c) => Number(Array.isArray(c) ? c[4] : NaN))
          .filter((x) => Number.isFinite(x) && x > 0)
      : [];
  } catch {
    closes = [];
  }

  if (closes.length < 4) {
    try {
      const klines = await fetchJson('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=8');
      closes = Array.isArray(klines)
        ? klines.map((k) => Number(Array.isArray(k) ? k[4] : NaN)).filter((x) => Number.isFinite(x) && x > 0)
        : [];
    } catch {
      closes = [];
    }
  }

  if (closes.length < 4) {
    return { side: 'neutral', confidence: 0.5, returnBps: 0 };
  }

  const first = closes[0];
  const last = closes[closes.length - 1];
  const ret = (last - first) / first;
  const returnBps = ret * 10000;
  const absBps = Math.abs(returnBps);
  const confidence = Math.min(0.82, 0.5 + absBps / 400);

  if (returnBps > 6) return { side: 'buy', confidence, returnBps };
  if (returnBps < -6) return { side: 'sell', confidence, returnBps };
  return { side: 'neutral', confidence: 0.5, returnBps };
}

function resolveSide(signal) {
  if (SIDE_MODE === 'buy_only') return 'buy';
  if (SIDE_MODE === 'sell_only') return 'sell';
  return signal;
}

function roundDown(value, decimals) {
  const factor = 10 ** Math.max(0, decimals);
  return Math.floor(value * factor) / factor;
}

function nowTs() {
  return (Date.now() / 1000).toFixed(3);
}

function signRequest(timestamp, method, requestPath, body = '') {
  const prehash = `${timestamp}${method}${requestPath}${body}`;
  const key = Buffer.from(API_SECRET, 'base64');
  return crypto.createHmac('sha256', key).update(prehash).digest('base64');
}

function toBase64Url(input) {
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return raw
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createCdpJwt(method, requestPath) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'ES256',
    typ: 'JWT',
    kid: API_KEY,
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  const payload = {
    iss: 'cdp',
    sub: API_KEY,
    nbf: now,
    exp: now + 120,
    uri: `${String(method || 'GET').toUpperCase()} api.coinbase.com${requestPath}`,
  };
  const headerPart = toBase64Url(JSON.stringify(header));
  const payloadPart = toBase64Url(JSON.stringify(payload));
  const signingInput = `${headerPart}.${payloadPart}`;

  const privateKeyPem = API_SECRET.includes('\\n') ? API_SECRET.replace(/\\n/g, '\n') : API_SECRET;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  });
  const sigPart = toBase64Url(signature);
  return `${signingInput}.${sigPart}`;
}

async function coinbasePublic(requestPath) {
  return fetchJson(`${BASE_URL}${requestPath}`, {
    headers: { Accept: 'application/json' },
  });
}

async function coinbasePrivate(method, requestPath, bodyObj = null) {
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const timestamp = nowTs();
  const signature = signRequest(timestamp, method, requestPath, body);

  return fetchJson(`${BASE_URL}${requestPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'CB-ACCESS-KEY': API_KEY,
      'CB-ACCESS-SIGN': signature,
      'CB-ACCESS-TIMESTAMP': timestamp,
      'CB-ACCESS-PASSPHRASE': API_PASSPHRASE,
    },
    body: body || undefined,
  });
}

async function coinbasePrivateCdp(method, requestPath, bodyObj = null) {
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const token = createCdpJwt(method, requestPath);
  return fetchJson(`${CDP_BASE_URL}${requestPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body || undefined,
  });
}

async function getTicker(product) {
  const row = await coinbasePublic(`/products/${encodeURIComponent(product)}/ticker`);
  const price = Number(row?.price || 0);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid ticker for ${product}`);
  }
  return { price, raw: row };
}

async function getProductMeta(product) {
  const row = await coinbasePublic(`/products/${encodeURIComponent(product)}`);
  const baseIncrement = Number(row?.base_increment || 0.00000001);
  let decimals = 8;
  if (Number.isFinite(baseIncrement) && baseIncrement > 0) {
    const s = String(baseIncrement);
    if (s.includes('.')) decimals = s.split('.')[1].replace(/0+$/, '').length;
  }
  return {
    id: row?.id || product,
    baseMinSize: Number(row?.base_min_size || 0),
    quoteMinSize: Number(row?.quote_min_size || 0),
    decimals,
  };
}

async function placeOrder(side, price, meta, orderUsd = ORDER_USD) {
  if (COINBASE_CDP_MODE) {
    const clientOrderId = crypto.randomUUID();
    if (side === 'buy') {
      const quoteSize = Number(orderUsd.toFixed(2));
      const payload = {
        client_order_id: clientOrderId,
        product_id: meta.id,
        side: 'BUY',
        order_configuration: {
          market_market_ioc: {
            quote_size: String(quoteSize),
          },
        },
      };
      if (DRY_RUN) {
        return { status: 'dry-run', order: payload, usdNotional: quoteSize, estBaseSize: Number((quoteSize / price).toFixed(meta.decimals)) };
      }
      const result = await coinbasePrivateCdp('POST', '/api/v3/brokerage/orders', payload);
      const success = result?.success === true && !result?.error_response?.error;
      return { status: success ? 'placed' : 'error', order: payload, result, ...(success ? {} : { error: result?.error_response?.error || 'order_rejected' }) };
    }

    const rawSize = orderUsd / price;
    // FIX H-6: Guard against price=0 or NaN causing Infinity order size
    if (!Number.isFinite(rawSize) || rawSize <= 0) {
      return { status: 'skipped', reason: 'invalid rawSize from bad price', rawSize, price };
    }
    const size = roundDown(rawSize, meta.decimals);
    if (size <= 0) {
      return { status: 'skipped', reason: 'computed sell size is zero', rawSize, price };
    }
    if (meta.baseMinSize > 0 && size < meta.baseMinSize) {
      return { status: 'skipped', reason: 'size below Coinbase base_min_size', size, baseMinSize: meta.baseMinSize };
    }

    const payload = {
      client_order_id: clientOrderId,
      product_id: meta.id,
      side: 'SELL',
      order_configuration: {
        market_market_ioc: {
          base_size: String(size),
        },
      },
    };

    if (DRY_RUN) {
      return { status: 'dry-run', order: payload, usdNotional: Number((size * price).toFixed(2)) };
    }

    const result = await coinbasePrivateCdp('POST', '/api/v3/brokerage/orders', payload);
    const sellSuccess = result?.success === true && !result?.error_response?.error;
    return { status: sellSuccess ? 'placed' : 'error', order: payload, result, ...(sellSuccess ? {} : { error: result?.error_response?.error || 'order_rejected' }) };
  }

  if (side === 'buy') {
    const funds = Number(orderUsd.toFixed(2));
    const payload = {
      type: 'market',
      side: 'buy',
      product_id: meta.id,
      funds: String(funds),
    };
    if (DRY_RUN) {
      return { status: 'dry-run', order: payload, usdNotional: funds, estBaseSize: Number((funds / price).toFixed(meta.decimals)) };
    }
    const result = await coinbasePrivate('POST', '/orders', payload);
    const buyOk = !result?.message;
    return { status: buyOk ? 'placed' : 'error', order: payload, result, ...(buyOk ? {} : { error: result?.message || 'order_rejected' }) };
  }

  const rawSize = orderUsd / price;
  const size = roundDown(rawSize, meta.decimals);
  if (size <= 0) {
    return { status: 'skipped', reason: 'computed sell size is zero', rawSize, price };
  }
  if (meta.baseMinSize > 0 && size < meta.baseMinSize) {
    return { status: 'skipped', reason: 'size below Coinbase base_min_size', size, baseMinSize: meta.baseMinSize };
  }

  const payload = {
    type: 'market',
    side: 'sell',
    product_id: meta.id,
    size: String(size),
  };

  if (DRY_RUN) {
    return { status: 'dry-run', order: payload, usdNotional: Number((size * price).toFixed(2)) };
  }

  const result = await coinbasePrivate('POST', '/orders', payload);
  const sellOk = !result?.message;
  return { status: sellOk ? 'placed' : 'error', order: payload, result, ...(sellOk ? {} : { error: result?.message || 'order_rejected' }) };
}

async function main() {
  if (!ENABLED) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'COINBASE_ENABLED is false' }, null, 2));
    return;
  }

  const state = loadState();
  const nowMs = Date.now();
  const sinceLastRunSec = state.data?.lastRunAt ? Math.floor((nowMs - Number(state.data.lastRunAt)) / 1000) : null;
  if (sinceLastRunSec !== null && sinceLastRunSec < MIN_INTERVAL_SEC) {
    console.log(JSON.stringify({ status: 'skipped', reason: `min-interval-not-met (${sinceLastRunSec}s/${MIN_INTERVAL_SEC}s)` }, null, 2));
    return;
  }

  // ─── Composite Signal (multi-TF, RSI, BB, ATR, bus) or fallback to basic momentum ───
  let signal, signalComponents = {}, effectiveOrderUsd = ORDER_USD;
  const adaptiveMinConf = brain ? brain.getEvolvedMinConfidence(MIN_CONFIDENCE) : (tradeJournal ? tradeJournal.getAdaptiveMinConfidence(MIN_CONFIDENCE) : MIN_CONFIDENCE);

  // Brain time-of-day check
  if (brain) {
    try {
      const timeCheck = brain.shouldTradeNow();
      if (!timeCheck.trade) {
        console.log(JSON.stringify({ status: 'skipped', reason: `brain-time-filter: ${timeCheck.reason}` }, null, 2));
        return;
      }
    } catch (err) { console.error('[coinbase] brain time-check error:', err?.message || err); }
  }

  if (USE_COMPOSITE_SIGNAL && edgeDetector) {
    try {
      const composite = await edgeDetector.getCompositeSignal({ asset: 'BTC' });
      signal = { side: composite.side, confidence: composite.confidence, returnBps: composite.compositeScore * 100, edge: composite.edge, compositeScore: composite.compositeScore };
      signalComponents = composite.components || {};
      effectiveOrderUsd = edgeDetector.dynamicOrderSize(composite, ORDER_USD, MAX_ORDER_USD / ORDER_USD);
    } catch (err) {
      console.error(`[edge-detector] fallback to momentum: ${err.message}`);
      signal = await getMomentumSignal();
    }
  } else {
    signal = await getMomentumSignal();
  }

  const side = resolveSide(signal.side);

  if (side === 'neutral' || signal.confidence < adaptiveMinConf) {
    console.log(JSON.stringify({
      status: 'skipped',
      reason: signal.confidence < adaptiveMinConf ? `confidence ${signal.confidence.toFixed(3)} below adaptive threshold ${adaptiveMinConf.toFixed(3)}` : 'neutral signal',
      signal,
      sideMode: SIDE_MODE,
      adaptiveMinConf,
    }, null, 2));
    return;
  }

  if (!DRY_RUN && (COINBASE_CDP_MODE ? (!API_KEY || !API_SECRET) : (!API_KEY || !API_SECRET || !API_PASSPHRASE))) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'missing Coinbase API credentials' }, null, 2));
    return;
  }

  // === CAPITAL MANDATE GATE — ZERO INJECTION PROTOCOL ===
  if (capitalMandate) {
    const mandateSize = capitalMandate.mandateAdjustedSize({ baseUsd: effectiveOrderUsd, confidence: signal.confidence, edge: signal.edge || 0 });
    if (mandateSize <= 0) {
      console.log(JSON.stringify({ status: 'skipped', reason: 'capital-mandate: mode prevents trade', mode: capitalMandate.determineMode(capitalMandate.getCurrentCapital().total) }, null, 2));
      return;
    }
    const mandateCheck = capitalMandate.checkMandate({ usdSize: mandateSize, confidence: signal.confidence, edge: signal.edge || 0, asset: 'BTC', venue: 'coinbase' });
    if (!mandateCheck.allowed) {
      console.log(JSON.stringify({ status: 'skipped', reason: `mandate-denied: ${mandateCheck.reasons.join(', ')}`, mode: mandateCheck.mode }, null, 2));
      return;
    }
    effectiveOrderUsd = Math.min(effectiveOrderUsd, mandateSize);
  }

  // Liquidation guardian gate
  if (liquidationGuardian) {
    const marginCheck = liquidationGuardian.shouldAllowNewTrade('coinbase', { tradeType: 'spot' });
    if (!marginCheck.allowed) {
      console.log(JSON.stringify({ status: 'skipped', reason: `guardian-blocked: ${marginCheck.reason}`, marginPct: marginCheck.marginPct }, null, 2));
      return;
    }
  }

  // Risk manager gate
  if (riskManager) {
    const check = riskManager.checkTradeAllowed({ asset: 'BTC', side, usdSize: effectiveOrderUsd, venue: 'coinbase', confidence: signal.confidence });
    if (!check.allowed) {
      console.log(JSON.stringify({ status: 'skipped', reason: `risk-denied: ${check.reasons.join(', ')}`, exposure: check.exposure }, null, 2));
      return;
    }
    effectiveOrderUsd = riskManager.riskAdjustedSize({ baseUsd: effectiveOrderUsd, confidence: signal.confidence, edge: signal.edge || 0, asset: 'BTC', venue: 'coinbase' });
  }

  const { price } = await getTicker(PRODUCT_ID);
  const meta = await getProductMeta(PRODUCT_ID);
  const actions = [];

  for (let i = 0; i < MAX_ORDERS_PER_CYCLE; i += 1) {
    const action = await placeOrder(side, price, meta, effectiveOrderUsd);
    actions.push(action);
  }

  state.data.lastRunAt = nowMs;
  state.data.lastSide = side;
  state.data.lastConfidence = signal.confidence;
  saveState(state.path, state.data);

  // Record in trade journal
  if (tradeJournal) {
    try {
      for (const action of actions) {
        tradeJournal.recordTrade({
          venue: 'coinbase',
          asset: 'BTC',
          side,
          entryPrice: price,
          usdSize: effectiveOrderUsd,
          signal,
          signalComponents,
          dryRun: DRY_RUN,
          orderId: action.result?.order_id || action.result?.success_response?.order_id || null,
        });
      }
    } catch (err) { console.error('[coinbase] journal record error:', err?.message || err); }
  }

  console.log(JSON.stringify({
    ts: new Date(nowMs).toISOString(),
    enabled: true,
    dryRun: DRY_RUN,
    venue: 'coinbase',
    cdpMode: COINBASE_CDP_MODE,
    productId: PRODUCT_ID,
    price,
    side,
    signal,
    compositeMode: USE_COMPOSITE_SIGNAL && !!edgeDetector,
    adaptiveMinConf,
    effectiveOrderUsd,
    actions,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
