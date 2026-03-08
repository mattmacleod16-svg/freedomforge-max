#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const ENABLED = String(process.env.KRAKEN_ENABLED || 'false').toLowerCase() === 'true';
const DRY_RUN = String(process.env.KRAKEN_DRY_RUN || 'true').toLowerCase() !== 'false';

const BASE_URL = (process.env.KRAKEN_BASE_URL || 'https://api.kraken.com').replace(/\/$/, '');
const API_KEY = (process.env.KRAKEN_API_KEY || '').trim();
const API_SECRET = (process.env.KRAKEN_API_SECRET || '').trim();
const PAIR = (process.env.KRAKEN_PAIR || 'XXBTZUSD').trim();
const ORDER_USD = Math.max(5, Number(process.env.KRAKEN_ORDER_USD || 15));
const MIN_CONFIDENCE = Math.max(0.5, Math.min(0.95, Number(process.env.KRAKEN_MIN_CONFIDENCE || 0.56)));
const SIDE_MODE = String(process.env.KRAKEN_SIDE_MODE || 'momentum').toLowerCase(); // momentum|buy_only|sell_only
const MAX_ORDERS_PER_CYCLE = Math.max(1, Math.min(3, Number(process.env.KRAKEN_MAX_ORDERS_PER_CYCLE || 1)));
const MIN_INTERVAL_SEC = Math.max(0, Number(process.env.KRAKEN_MIN_INTERVAL_SEC || 120));
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.KRAKEN_TIMEOUT_MS || 15000));
const STATE_FILE = process.env.KRAKEN_STATE_FILE || 'data/kraken-spot-state.json';
const USE_COMPOSITE_SIGNAL = String(process.env.KRAKEN_USE_COMPOSITE_SIGNAL || 'true').toLowerCase() !== 'false';
const MAX_ORDER_USD = Math.max(ORDER_USD, Number(process.env.KRAKEN_MAX_ORDER_USD || 50));

let edgeDetector, tradeJournal, brain, riskManager, liquidationGuardian;
try { edgeDetector = require('../lib/edge-detector'); } catch { edgeDetector = null; }
try { tradeJournal = require('../lib/trade-journal'); } catch { tradeJournal = null; }
try { brain = require('../lib/self-evolving-brain'); } catch { brain = null; }
try { riskManager = require('../lib/risk-manager'); } catch { riskManager = null; }
try { liquidationGuardian = require('../lib/liquidation-guardian'); } catch { liquidationGuardian = null; }

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

function loadState() {
  const abs = path.resolve(process.cwd(), STATE_FILE);
  if (!fs.existsSync(abs)) return { path: abs, data: { lastRunAt: 0 } };
  try {
    return { path: abs, data: JSON.parse(fs.readFileSync(abs, 'utf8')) };
  } catch {
    return { path: abs, data: { lastRunAt: 0 } };
  }
}

function saveState(abs, data) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(data, null, 2));
}

async function getMomentumSignal() {
  let closes = [];

  try {
    const klines = await fetchJson('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=8');
    closes = Array.isArray(klines)
      ? klines.map((k) => Number(Array.isArray(k) ? k[4] : NaN)).filter((x) => Number.isFinite(x) && x > 0)
      : [];
  } catch {
    closes = [];
  }

  if (closes.length < 4) {
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

function nonce() {
  return String(Date.now() * 1000 + Math.floor(Math.random() * 1000));
}

function signKraken(pathname, body) {
  const secret = Buffer.from(API_SECRET, 'base64');
  const np = body.get('nonce');
  const postData = body.toString();
  const hash = crypto.createHash('sha256').update(np + postData).digest();
  const hmac = crypto.createHmac('sha512', secret);
  const signature = hmac.update(pathname).update(hash).digest('base64');
  return signature;
}

async function krakenPublic(pathname, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${pathname}${qs ? `?${qs}` : ''}`;
  const payload = await fetchJson(url);
  if (Array.isArray(payload?.error) && payload.error.length > 0) {
    throw new Error(`Kraken public API error: ${payload.error.join(', ')}`);
  }
  return payload?.result || {};
}

async function krakenPrivate(pathname, fields = {}) {
  const body = new URLSearchParams({ nonce: nonce(), ...fields });
  const signature = signKraken(pathname, body);
  const payload = await fetchJson(`${BASE_URL}${pathname}`, {
    method: 'POST',
    headers: {
      'API-Key': API_KEY,
      'API-Sign': signature,
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    },
    body: body.toString(),
  });
  if (Array.isArray(payload?.error) && payload.error.length > 0) {
    throw new Error(`Kraken private API error: ${payload.error.join(', ')}`);
  }
  return payload?.result || {};
}

function roundDown(value, decimals) {
  const factor = 10 ** Math.max(0, decimals);
  return Math.floor(value * factor) / factor;
}

async function getPairMeta(pairCode) {
  const result = await krakenPublic('/0/public/AssetPairs', { pair: pairCode });
  const key = Object.keys(result || {})[0];
  const row = key ? result[key] : null;
  if (!row) throw new Error(`Kraken pair metadata unavailable for ${pairCode}`);
  return {
    wsname: row.wsname || pairCode,
    altname: row.altname || pairCode,
    pairKey: key,
    lotDecimals: Number.isFinite(Number(row.lot_decimals)) ? Number(row.lot_decimals) : 8,
    ordmin: Number(row.ordermin || 0),
  };
}

async function getLastPrice(pairCode) {
  const result = await krakenPublic('/0/public/Ticker', { pair: pairCode });
  const key = Object.keys(result || {})[0];
  const row = key ? result[key] : null;
  const price = Number(row?.c?.[0] || 0);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid ticker price for ${pairCode}`);
  }
  return price;
}

function resolveSide(signal) {
  if (SIDE_MODE === 'buy_only') return 'buy';
  if (SIDE_MODE === 'sell_only') return 'sell';
  return signal;
}

async function main() {
  if (!ENABLED) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'KRAKEN_ENABLED is false' }, null, 2));
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
    } catch {}
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

  const pair = await getPairMeta(PAIR);
  const price = await getLastPrice(PAIR);
  const requestedVolume = effectiveOrderUsd / price;
  const volume = roundDown(requestedVolume, pair.lotDecimals);

  if (!Number.isFinite(volume) || volume <= 0) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'computed order volume is zero', price, requestedVolume }, null, 2));
    return;
  }

  if (pair.ordmin > 0 && volume < pair.ordmin) {
    console.log(JSON.stringify({
      status: 'skipped',
      reason: 'volume below Kraken ordmin',
      volume,
      ordmin: pair.ordmin,
      pair: pair.pairKey,
    }, null, 2));
    return;
  }

  // Liquidation guardian gate
  if (liquidationGuardian) {
    const marginCheck = liquidationGuardian.shouldAllowNewTrade('kraken');
    if (!marginCheck.allowed) {
      console.log(JSON.stringify({ status: 'skipped', reason: `guardian-blocked: ${marginCheck.reason}`, marginPct: marginCheck.marginPct }, null, 2));
      return;
    }
  }

  // Risk manager gate
  if (riskManager) {
    const check = riskManager.checkTradeAllowed({ asset: 'BTC', side, usdSize: effectiveOrderUsd, venue: 'kraken', confidence: signal.confidence });
    if (!check.allowed) {
      console.log(JSON.stringify({ status: 'skipped', reason: `risk-denied: ${check.reasons.join(', ')}`, exposure: check.exposure }, null, 2));
      return;
    }
    // Risk-adjust the order size
    effectiveOrderUsd = riskManager.riskAdjustedSize({ baseUsd: effectiveOrderUsd, confidence: signal.confidence, edge: signal.edge || 0, asset: 'BTC', venue: 'kraken' });
  }

  if (!DRY_RUN && (!API_KEY || !API_SECRET)) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'missing KRAKEN_API_KEY/KRAKEN_API_SECRET' }, null, 2));
    return;
  }

  const actions = [];
  for (let i = 0; i < MAX_ORDERS_PER_CYCLE; i += 1) {
    const order = {
      pair: pair.altname,
      type: side,
      ordertype: 'market',
      volume: String(volume),
      validate: DRY_RUN ? 'true' : undefined,
    };

    if (DRY_RUN) {
      actions.push({ status: 'dry-run', order, usdNotional: Number((volume * price).toFixed(4)), signal });
      continue;
    }

    const result = await krakenPrivate('/0/private/AddOrder', order);
    actions.push({ status: 'placed', order, result });
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
          venue: 'kraken',
          asset: 'BTC',
          side,
          entryPrice: price,
          usdSize: effectiveOrderUsd,
          signal,
          signalComponents,
          dryRun: DRY_RUN,
          orderId: action.result?.txid || null,
        });
      }
    } catch {}
  }

  console.log(JSON.stringify({
    ts: new Date(nowMs).toISOString(),
    enabled: true,
    dryRun: DRY_RUN,
    pair: pair.wsname,
    pairCode: pair.pairKey,
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
