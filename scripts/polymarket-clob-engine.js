#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Wallet } = require('ethers5');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const ENABLED = String(process.env.POLY_CLOB_ENABLED || 'false').toLowerCase() === 'true';
const DRY_RUN = String(process.env.POLY_CLOB_DRY_RUN || 'true').toLowerCase() !== 'false';

const POLY_CLOB_REST_URL = (process.env.POLY_CLOB_REST_URL || 'https://clob.polymarket.com').replace(/\/$/, '');
const POLY_CLOB_ORDER_ENDPOINT = process.env.POLY_CLOB_ORDER_ENDPOINT || '/order';
const POLY_CLOB_API_KEY = (process.env.POLY_CLOB_API_KEY || '').trim();
const POLY_CLOB_API_SECRET = (process.env.POLY_CLOB_API_SECRET || '').trim();
const POLY_CLOB_API_PASSPHRASE = (process.env.POLY_CLOB_API_PASSPHRASE || '').trim();
const POLY_PRIVATE_KEY = (process.env.POLYMARKET_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || '').trim();
const POLY_CHAIN_ID = Number(process.env.POLY_CHAIN_ID || 137);
const POLY_SIGNATURE_TYPE = Number(process.env.POLY_SIGNATURE_TYPE || 0);
const POLY_FUNDER_ADDRESS = (process.env.POLY_FUNDER_ADDRESS || process.env.FUNDER_ADDRESS || '').trim();
const POLY_USE_SDK_AUTH = String(process.env.POLY_CLOB_USE_SDK_AUTH || 'true').toLowerCase() !== 'false';

const MARKET_ENDPOINT = process.env.PREDICTION_MARKET_ENDPOINT || 'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200';
const MAX_ORDERS_PER_CYCLE = Math.max(1, Math.min(5, Number(process.env.POLY_CLOB_MAX_ORDERS_PER_CYCLE || 2)));
const MICRO_SPLITS = Math.max(1, Math.min(5, Number(process.env.POLY_CLOB_MICRO_SPLITS || 2)));
const ORDER_USD_BASE = Math.max(1, Number(process.env.POLY_CLOB_ORDER_USD || 5));
const ORDER_USD_MAX = Math.max(ORDER_USD_BASE, Number(process.env.POLY_CLOB_ORDER_USD_MAX || 25));
const MIN_CONFIDENCE = Math.max(0.5, Math.min(0.95, Number(process.env.POLY_CLOB_MIN_CONFIDENCE || 0.56)));
const PRICE_CAP = Math.max(0.5, Math.min(0.95, Number(process.env.POLY_CLOB_PRICE_CAP || 0.62)));
const PRICE_FLOOR = Math.max(0.05, Math.min(0.5, Number(process.env.POLY_CLOB_PRICE_FLOOR || 0.38)));
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.POLY_CLOB_TIMEOUT_MS || 15000));
const MIN_INTERVAL_SEC = Math.max(0, Number(process.env.POLY_CLOB_MIN_INTERVAL_SEC || 120));
const STATE_FILE = process.env.POLY_CLOB_STATE_FILE || 'data/polymarket-clob-state.json';
const STRATEGY_MODE = String(process.env.POLY_CLOB_STRATEGY || 'maker_rebate').trim().toLowerCase();
const MAKER_PRICE_OFFSET_BPS = Math.max(1, Math.min(500, Number(process.env.POLY_CLOB_MAKER_PRICE_OFFSET_BPS || 30)));
const INCLUDE_DYNAMIC_FEE_RATE = String(process.env.POLY_CLOB_INCLUDE_DYNAMIC_FEE_RATE || 'true').toLowerCase() !== 'false';
const FEE_RATE_ENDPOINT_TEMPLATE = process.env.POLY_CLOB_FEE_RATE_ENDPOINT || '/fee-rate?tokenID={tokenId}';
const SHORT_FALLBACK_ENABLED = String(process.env.POLY_CLOB_SHORT_FALLBACK_ENABLED || 'true').toLowerCase() !== 'false';
const SHORT_FALLBACK_MAX_HOURS = Math.max(1, Number(process.env.POLY_CLOB_SHORT_FALLBACK_MAX_HOURS || 72));
const ASSET_FALLBACK_ENABLED = String(process.env.POLY_CLOB_ASSET_FALLBACK_ENABLED || 'true').toLowerCase() !== 'false';
const ASSET_FALLBACK_LIST = String(process.env.POLY_CLOB_FALLBACK_ASSETS || 'eth,sol')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const ANY_ACTIVE_FALLBACK_ENABLED = String(process.env.POLY_CLOB_ANY_ACTIVE_FALLBACK_ENABLED || 'true').toLowerCase() !== 'false';

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

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'POLY_API_KEY': POLY_CLOB_API_KEY,
    'POLY_API_SECRET': POLY_CLOB_API_SECRET,
    'POLY_API_PASSPHRASE': POLY_CLOB_API_PASSPHRASE,
  };
}

let sdkContextPromise = null;

function normalizePrivateKey(raw) {
  if (!raw) return '';
  return raw.startsWith('0x') ? raw : `0x${raw}`;
}

async function getSdkContext() {
  if (!POLY_USE_SDK_AUTH) return null;
  if (!POLY_PRIVATE_KEY || !POLY_CLOB_API_KEY || !POLY_CLOB_API_SECRET || !POLY_CLOB_API_PASSPHRASE) return null;

  if (!sdkContextPromise) {
    sdkContextPromise = (async () => {
      const mod = await import('@polymarket/clob-client');
      const { ClobClient, Side, OrderType } = mod;

      const signer = new Wallet(normalizePrivateKey(POLY_PRIVATE_KEY));
      const apiCreds = {
        key: POLY_CLOB_API_KEY,
        apiKey: POLY_CLOB_API_KEY,
        secret: POLY_CLOB_API_SECRET,
        passphrase: POLY_CLOB_API_PASSPHRASE,
      };

      const funder = POLY_FUNDER_ADDRESS || signer.address;
      const client = new ClobClient(
        POLY_CLOB_REST_URL,
        POLY_CHAIN_ID,
        signer,
        apiCreds,
        POLY_SIGNATURE_TYPE,
        funder,
      );

      return { client, Side, OrderType };
    })();
  }

  try {
    return await sdkContextPromise;
  } catch {
    sdkContextPromise = null;
    return null;
  }
}

function normalizeMarkets(payload) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.markets) ? payload.markets : [];
  return rows.filter((row) => row && typeof row === 'object');
}

function parseOutcomeNamesForDetection(row) {
  const raw = row?.outcomes;
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item || '').toLowerCase()).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || '').toLowerCase()).filter(Boolean);
      }
    } catch {
      // ignore malformed outcome payload
    }
  }
  return [];
}

function hasAssetAndBinary(row, assetTokens) {
  const q = String(row?.question || row?.title || '').toLowerCase();
  if (!q) return false;
  const patterns = {
    btc: /\bbtc\b|bitcoin/,
    eth: /\beth\b|ethereum/,
    sol: /\bsol\b|solana/,
    arb: /\barb\b|arbitrum/,
    op: /\bop\b|optimism/,
  };

  const hasAsset = assetTokens.some((token) => {
    const rx = patterns[token] || new RegExp(`\\b${token.replace(/[^a-z0-9]/g, '')}\\b`, 'i');
    return rx.test(q);
  });

  const hasBinaryInQuestion = /up|down|above|below|yes|no/.test(q);
  const outcomeNames = parseOutcomeNamesForDetection(row).join(' ');
  const hasBinaryInOutcomes = /\byes\b|\bno\b|\bup\b|\bdown\b|\babove\b|\bbelow\b/.test(outcomeNames);
  const hasBinary = hasBinaryInQuestion || hasBinaryInOutcomes;
  return hasAsset && hasBinary;
}

function parseTimestampMs(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw > 1e12) return Math.floor(raw);
    if (raw > 1e9) return Math.floor(raw * 1000);
    return null;
  }
  const text = String(raw).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const value = Number(text);
    if (!Number.isFinite(value)) return null;
    if (value > 1e12) return Math.floor(value);
    if (value > 1e9) return Math.floor(value * 1000);
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMarketEndTsMs(row) {
  const candidates = [
    row?.endDate,
    row?.endTime,
    row?.endTimestamp,
    row?.closeTime,
    row?.closeDate,
    row?.expirationTime,
    row?.resolutionDate,
    row?.end_date,
    row?.closedTime,
  ];
  for (const value of candidates) {
    const parsed = parseTimestampMs(value);
    if (parsed) return parsed;
  }
  return null;
}

function isMarketActive(row, nowMs) {
  if (row?.closed === true || row?.isClosed === true || row?.active === false || row?.isActive === false) {
    return false;
  }

  const endTs = getMarketEndTsMs(row);
  if (endTs !== null && endTs <= nowMs) return false;
  return true;
}

function isUltraShortBtcMarket(row) {
  const q = String(row?.question || row?.title || '').toLowerCase();
  if (!hasAssetAndBinary(row, ['btc'])) return false;
  const hasUltraShort = /5\s*min|5m|15\s*min|15m/.test(q);
  return hasUltraShort;
}

function isShortFallbackBtcMarket(row, nowMs) {
  if (!hasAssetAndBinary(row, ['btc'])) return false;

  const q = String(row?.question || row?.title || '').toLowerCase();
  const hasShortText = /30\s*min|30m|60\s*min|1\s*h|1hr|2\s*h|4\s*h|6\s*h|12\s*h|24\s*h|today|tonight|tomorrow|this week|weekend|end of week/.test(q);

  const endTs = getMarketEndTsMs(row);
  const withinWindow = endTs !== null
    ? ((endTs - nowMs) >= 0 && ((endTs - nowMs) / (60 * 60 * 1000)) <= SHORT_FALLBACK_MAX_HOURS)
    : false;

  return hasShortText || withinWindow;
}

function isShortFallbackAssetMarket(row, nowMs, assets) {
  if (!hasAssetAndBinary(row, assets)) return false;
  if (!isMarketActive(row, nowMs)) return false;

  const q = String(row?.question || row?.title || '').toLowerCase();
  const hasShortText = /30\s*min|30m|60\s*min|1\s*h|1hr|2\s*h|4\s*h|6\s*h|12\s*h|24\s*h|today|tonight|tomorrow|this week|weekend|end of week/.test(q);

  const endTs = getMarketEndTsMs(row);
  const withinWindow = endTs !== null
    ? ((endTs - nowMs) >= 0 && ((endTs - nowMs) / (60 * 60 * 1000)) <= SHORT_FALLBACK_MAX_HOURS)
    : false;

  return hasShortText || withinWindow;
}

function isAnyActiveAssetBinaryMarket(row, nowMs, assets) {
  if (!hasAssetAndBinary(row, assets)) return false;
  return isMarketActive(row, nowMs);
}

function selectCandidateMarkets(rows, nowMs) {
  const ultraShort = rows.filter(isUltraShortBtcMarket);
  if (ultraShort.length > 0) {
    return {
      mode: 'ultra-short',
      markets: ultraShort,
    };
  }

  if (!SHORT_FALLBACK_ENABLED) {
    return {
      mode: 'none',
      markets: [],
      reason: 'no ultra-short BTC markets found and fallback disabled',
    };
  }

  const fallback = rows.filter((row) => isShortFallbackBtcMarket(row, nowMs));
  if (fallback.length === 0) {
    if (ASSET_FALLBACK_ENABLED && ASSET_FALLBACK_LIST.length > 0) {
      const assetFallback = rows.filter((row) => isShortFallbackAssetMarket(row, nowMs, ASSET_FALLBACK_LIST));
      if (assetFallback.length > 0) {
        assetFallback.sort((a, b) => {
          const aTs = getMarketEndTsMs(a) || Number.MAX_SAFE_INTEGER;
          const bTs = getMarketEndTsMs(b) || Number.MAX_SAFE_INTEGER;
          return aTs - bTs;
        });
        return {
          mode: 'asset-short-fallback',
          markets: assetFallback,
        };
      }

      if (ANY_ACTIVE_FALLBACK_ENABLED) {
        const broadAssets = Array.from(new Set(['btc', ...ASSET_FALLBACK_LIST]));
        const anyActiveFallback = rows.filter((row) => isAnyActiveAssetBinaryMarket(row, nowMs, broadAssets));
        if (anyActiveFallback.length > 0) {
          anyActiveFallback.sort((a, b) => {
            const aTs = getMarketEndTsMs(a) || Number.MAX_SAFE_INTEGER;
            const bTs = getMarketEndTsMs(b) || Number.MAX_SAFE_INTEGER;
            return aTs - bTs;
          });
          return {
            mode: 'asset-any-active-fallback',
            markets: anyActiveFallback,
          };
        }
      }
    }

    return {
      mode: 'none',
      markets: [],
      reason: `no eligible markets found across ultra-short BTC, short-horizon BTC, short-horizon asset fallback, or any-active fallback`,
    };
  }

  fallback.sort((a, b) => {
    const aTs = getMarketEndTsMs(a) || Number.MAX_SAFE_INTEGER;
    const bTs = getMarketEndTsMs(b) || Number.MAX_SAFE_INTEGER;
    return aTs - bTs;
  });

  return {
    mode: 'short-fallback',
    markets: fallback,
  };
}

function parseOutcomes(row) {
  const outcomes = row?.outcomes;
  const outcomePrices = row?.outcomePrices;
  let names = [];
  let prices = [];

  try {
    names = Array.isArray(outcomes) ? outcomes : JSON.parse(outcomes || '[]');
  } catch {
    names = [];
  }
  try {
    prices = Array.isArray(outcomePrices) ? outcomePrices : JSON.parse(outcomePrices || '[]');
  } catch {
    prices = [];
  }

  const tokenIdsRaw = row?.clobTokenIds;
  let tokenIds = [];
  try {
    tokenIds = Array.isArray(tokenIdsRaw) ? tokenIdsRaw : JSON.parse(tokenIdsRaw || '[]');
  } catch {
    tokenIds = [];
  }

  const entries = [];
  const n = Math.max(names.length, prices.length, tokenIds.length);
  for (let i = 0; i < n; i += 1) {
    const name = String(names[i] || '').trim();
    const price = Number(prices[i] || 0);
    const tokenId = tokenIds[i] ? String(tokenIds[i]) : '';
    if (!name || !Number.isFinite(price) || price <= 0 || !tokenId) continue;
    entries.push({ name, price, tokenId });
  }
  return entries;
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

  if (returnBps > 6) return { side: 'up', confidence, returnBps };
  if (returnBps < -6) return { side: 'down', confidence, returnBps };
  return { side: 'neutral', confidence: 0.5, returnBps };
}

function chooseOutcome(outcomes, side) {
  const normalized = outcomes.map((o) => ({ ...o, lower: o.name.toLowerCase() }));
  if (side === 'up') {
    return normalized.find((o) => /yes|up|above/.test(o.lower)) || null;
  }
  if (side === 'down') {
    return normalized.find((o) => /no|down|below/.test(o.lower)) || null;
  }
  return null;
}

function splitOrderSizes(totalUsd, splits) {
  if (splits <= 1) return [totalUsd];
  const base = totalUsd / splits;
  return Array.from({ length: splits }, (_, idx) => (idx === splits - 1 ? totalUsd - base * (splits - 1) : base));
}

function clampPrice(price) {
  return Number(Math.max(PRICE_FLOOR, Math.min(PRICE_CAP, price)).toFixed(4));
}

function getOutcomePair(outcomes) {
  const normalized = outcomes.map((o) => ({ ...o, lower: o.name.toLowerCase() }));
  const yes = normalized.find((o) => /\byes\b|\bup\b|\babove\b/.test(o.lower)) || null;
  const no = normalized.find((o) => /\bno\b|\bdown\b|\bbelow\b/.test(o.lower)) || null;
  return { yes, no };
}

function buildMakerOrders(row, outcomes) {
  const pair = getOutcomePair(outcomes);
  if (!pair.yes || !pair.no) return [];

  const marketName = row.question || row.title || row.slug || 'unknown';
  const eachSideUsd = ORDER_USD_BASE;
  const seen = new Set();
  const uniqueSides = [pair.yes, pair.no].filter((outcome) => {
    const key = String(outcome.tokenId || '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const bySide = uniqueSides.flatMap((outcome) => {
    const shifted = outcome.price - (MAKER_PRICE_OFFSET_BPS / 10000);
    const makerPrice = clampPrice(shifted);
    const sizes = splitOrderSizes(eachSideUsd, MICRO_SPLITS);
    return sizes.map((usd) => ({
      tokenId: outcome.tokenId,
      side: 'buy',
      price: makerPrice,
      sizeUsd: Number(usd.toFixed(4)),
      market: marketName,
      strategy: 'maker-rebate',
      sourcePrice: Number(outcome.price.toFixed(4)),
      offsetBps: MAKER_PRICE_OFFSET_BPS,
      outcome: outcome.name,
    }));
  });

  return bySide;
}

const feeRateCache = new Map();

function normalizeFeeRateBps(payload) {
  const candidates = [
    payload?.feeRateBps,
    payload?.fee_rate_bps,
    payload?.takerFeeRateBps,
    payload?.taker_fee_rate_bps,
    payload?.feeBps,
    payload?.fee,
  ];

  for (const value of candidates) {
    if (value === undefined || value === null || value === '') continue;
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) return Math.round(num);
  }

  return null;
}

async function fetchFeeRateBps(tokenId) {
  if (!INCLUDE_DYNAMIC_FEE_RATE || !tokenId) return null;
  if (feeRateCache.has(tokenId)) return feeRateCache.get(tokenId);

  const endpoint = FEE_RATE_ENDPOINT_TEMPLATE.includes('{tokenId}')
    ? FEE_RATE_ENDPOINT_TEMPLATE.replace('{tokenId}', encodeURIComponent(tokenId))
    : `${FEE_RATE_ENDPOINT_TEMPLATE}${FEE_RATE_ENDPOINT_TEMPLATE.includes('?') ? '&' : '?'}tokenID=${encodeURIComponent(tokenId)}`;

  const url = endpoint.startsWith('http') ? endpoint : `${POLY_CLOB_REST_URL}${endpoint}`;

  try {
    const payload = await fetchJson(url, { method: 'GET' });
    const normalized = normalizeFeeRateBps(payload);
    feeRateCache.set(tokenId, normalized);
    return normalized;
  } catch {
    feeRateCache.set(tokenId, null);
    return null;
  }
}

async function placeOrder(order, row) {
  const sdk = await getSdkContext();
  if (sdk) {
    const side = String(order.side || 'buy').toLowerCase() === 'sell' ? sdk.Side.SELL : sdk.Side.BUY;
    const size = Number((Number(order.sizeUsd || 0) / Math.max(Number(order.price || 0), 0.0001)).toFixed(4));
    if (!Number.isFinite(size) || size <= 0) {
      throw new Error('invalid-order-size');
    }

    const tickSize = String(row?.minimum_tick_size || '0.01');
    const negRisk = Boolean(row?.neg_risk);
    const userOrder = {
      tokenID: String(order.tokenId),
      price: Number(order.price),
      size,
      side,
    };

    if (order.feeRateBps !== undefined && order.feeRateBps !== null && order.feeRateBps !== '') {
      const feeRate = Number(order.feeRateBps);
      if (Number.isFinite(feeRate) && feeRate >= 0) {
        userOrder.feeRateBps = feeRate;
      }
    }

    if (order.strategy === 'maker-rebate') {
      const signed = await sdk.client.createOrder(userOrder, { tickSize, negRisk });
      return sdk.client.postOrder(signed, sdk.OrderType.GTC, true);
    }

    return sdk.client.createAndPostOrder(userOrder, { tickSize, negRisk }, sdk.OrderType.GTC);
  }

  const endpoint = `${POLY_CLOB_REST_URL}${POLY_CLOB_ORDER_ENDPOINT}`;
  return fetchJson(endpoint, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(order),
  });
}

async function main() {
  if (!ENABLED) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'POLY_CLOB_ENABLED is false' }, null, 2));
    return;
  }

  const state = loadState();
  const nowMs = Date.now();
  const sinceLastRunSec = state.data?.lastRunAt ? Math.floor((nowMs - Number(state.data.lastRunAt)) / 1000) : null;
  if (sinceLastRunSec !== null && sinceLastRunSec < MIN_INTERVAL_SEC) {
    console.log(JSON.stringify({ status: 'skipped', reason: `min-interval-not-met (${sinceLastRunSec}s/${MIN_INTERVAL_SEC}s)` }, null, 2));
    return;
  }

  if (!DRY_RUN && (!POLY_CLOB_API_KEY || !POLY_CLOB_API_SECRET || !POLY_CLOB_API_PASSPHRASE)) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'missing Polymarket CLOB credentials' }, null, 2));
    return;
  }

  const [marketsPayload, momentum] = await Promise.all([
    fetchJson(MARKET_ENDPOINT),
    getMomentumSignal(),
  ]);

  const selection = selectCandidateMarkets(normalizeMarkets(marketsPayload), nowMs);
  const markets = selection.markets;
  if (markets.length === 0) {
    console.log(JSON.stringify({ status: 'skipped', reason: selection.reason || 'no candidate BTC markets found' }, null, 2));
    return;
  }

  const requiresDirectionalSignal = STRATEGY_MODE !== 'maker_rebate';
  if (requiresDirectionalSignal && (momentum.side === 'neutral' || momentum.confidence < MIN_CONFIDENCE)) {
    console.log(JSON.stringify({
      status: 'skipped',
      reason: 'momentum confidence below threshold',
      signal: momentum,
      marketsSeen: markets.length,
    }, null, 2));
    return;
  }

  const actions = [];
  let executedCount = 0;

  for (const row of markets) {
    if (executedCount >= MAX_ORDERS_PER_CYCLE) break;

    const outcomes = parseOutcomes(row);
    const marketName = row.question || row.title || row.slug || 'unknown';

    let orders = [];
    if (STRATEGY_MODE === 'maker_rebate') {
      orders = buildMakerOrders(row, outcomes);
      if (orders.length === 0) {
        actions.push({ market: marketName, status: 'skipped', reason: 'maker-outcomes-unavailable' });
      }
    }

    if (orders.length === 0) {
      const outcome = chooseOutcome(outcomes, momentum.side);
      if (!outcome) continue;

      if (outcome.price < PRICE_FLOOR || outcome.price > PRICE_CAP) {
        actions.push({ market: marketName, status: 'skipped', reason: 'price-out-of-band', price: outcome.price });
        continue;
      }

      const confidenceScale = Math.max(0, (momentum.confidence - MIN_CONFIDENCE) / (0.9 - MIN_CONFIDENCE || 1));
      const orderUsd = Math.min(ORDER_USD_MAX, ORDER_USD_BASE + confidenceScale * (ORDER_USD_MAX - ORDER_USD_BASE));
      const sizes = splitOrderSizes(orderUsd, MICRO_SPLITS);
      orders = sizes.map((usd) => ({
        tokenId: outcome.tokenId,
        side: 'buy',
        price: Number(outcome.price.toFixed(4)),
        sizeUsd: Number(usd.toFixed(4)),
        market: marketName,
        strategy: 'directional-momentum',
        signal: {
          direction: momentum.side,
          confidence: Number(momentum.confidence.toFixed(4)),
          returnBps: Number(momentum.returnBps.toFixed(2)),
        },
      }));
    }

    for (const order of orders) {
      if (executedCount >= MAX_ORDERS_PER_CYCLE) break;

      const feeRateBps = await fetchFeeRateBps(order.tokenId);
      const orderPayload = feeRateBps !== null
        ? { ...order, feeRateBps: String(feeRateBps) }
        : order;

      if (DRY_RUN) {
        actions.push({ ...orderPayload, status: 'dry-run' });
        executedCount += 1;
        continue;
      }

      try {
        const placed = await placeOrder(orderPayload, row);
        actions.push({ ...orderPayload, status: 'placed', response: placed });
        executedCount += 1;
      } catch (error) {
        actions.push({ ...orderPayload, status: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  state.data.lastRunAt = nowMs;
  saveState(state.path, state.data);

  console.log(JSON.stringify({
    ts: new Date(nowMs).toISOString(),
    enabled: true,
    dryRun: DRY_RUN,
    strategy: STRATEGY_MODE,
    makerPriceOffsetBps: MAKER_PRICE_OFFSET_BPS,
    includeDynamicFeeRate: INCLUDE_DYNAMIC_FEE_RATE,
    marketSelectionMode: selection.mode,
    shortFallbackEnabled: SHORT_FALLBACK_ENABLED,
    shortFallbackMaxHours: SHORT_FALLBACK_MAX_HOURS,
    assetFallbackEnabled: ASSET_FALLBACK_ENABLED,
    assetFallbackList: ASSET_FALLBACK_LIST,
    anyActiveFallbackEnabled: ANY_ACTIVE_FALLBACK_ENABLED,
    marketEndpoint: MARKET_ENDPOINT,
    signal: momentum,
    marketsConsidered: markets.length,
    actions,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
