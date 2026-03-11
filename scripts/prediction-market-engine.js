#!/usr/bin/env node

/**
 * Prediction Market Engine — Trades event contracts, futures, and prediction tokens
 * across Coinbase (futures/perps) and Kraken (event tokens like TRUMP).
 *
 * Also ingests Polymarket Gamma API (read-only, works from US) as a signal source.
 *
 * Strategy:
 *   1. Scan Coinbase futures for basis-trade / directional opportunities
 *   2. Scan Kraken event tokens (TRUMP, etc.) for mispricing
 *   3. Fetch Polymarket market data as intelligence signal
 *   4. Use edge-detector composite signals for directional conviction
 *   5. Place orders via existing authenticated APIs
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

// ─── Configuration ───────────────────────────────────────────────────────────

const ENABLED = String(process.env.PRED_MARKET_ENABLED || 'true').toLowerCase() === 'true';
const DRY_RUN = String(process.env.PRED_MARKET_DRY_RUN || 'true').toLowerCase() !== 'false';
const MIN_CONFIDENCE = Math.max(0.5, Math.min(0.95, Number(process.env.PRED_MARKET_MIN_CONFIDENCE || 0.60)));
const ORDER_USD = Math.max(5, Number(process.env.PRED_MARKET_ORDER_USD || 15));
const MAX_ORDER_USD = Math.max(ORDER_USD, Number(process.env.PRED_MARKET_MAX_ORDER_USD || 50));
const MIN_INTERVAL_SEC = Math.max(0, Number(process.env.PRED_MARKET_MIN_INTERVAL_SEC || 300));
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.PRED_MARKET_TIMEOUT_MS || 15000));
const STATE_FILE = process.env.PRED_MARKET_STATE_FILE || 'data/prediction-market-state.json';
const MAX_ORDERS_PER_CYCLE = Math.max(1, Math.min(10, Number(process.env.PRED_MARKET_MAX_ORDERS || 4)));

// Coinbase futures config
const CB_API_KEY = (process.env.COINBASE_API_KEY || '').trim();
const CB_API_SECRET = (process.env.COINBASE_API_SECRET || '').trim();
const CB_CDP_BASE = (process.env.COINBASE_CDP_BASE_URL || 'https://api.coinbase.com').replace(/\/$/, '');

// Kraken config
const K_API_KEY = (process.env.KRAKEN_API_KEY || '').trim();
const K_API_SECRET = (process.env.KRAKEN_API_SECRET || '').trim();
const K_BASE = (process.env.KRAKEN_BASE_URL || 'https://api.kraken.com').replace(/\/$/, '');

// Coinbase futures toggle (disable when margin is high or performance is poor)
const CB_FUTURES_ENABLED = String(process.env.PRED_MARKET_FUTURES_ENABLED || 'true').toLowerCase() === 'true';
// Minimum basis (annualized %) to trigger a futures basis trade
const MIN_BASIS_ANNUAL_PCT = Math.max(1, Number(process.env.PRED_MARKET_MIN_BASIS_PCT || 5));
// Minimum edge for event token trades (meme tokens typically yield 0.005-0.015)
const MIN_EVENT_EDGE = Math.max(0.005, Number(process.env.PRED_MARKET_MIN_EVENT_EDGE || 0.01));

let edgeDetector, tradeJournal, signalBus, liquidationGuardian, capitalMandate;
try { edgeDetector = require('../lib/edge-detector'); } catch { edgeDetector = null; }
try { tradeJournal = require('../lib/trade-journal'); } catch { tradeJournal = null; }
try { signalBus = require('../lib/agent-signal-bus'); } catch { signalBus = null; }
try { liquidationGuardian = require('../lib/liquidation-guardian'); } catch { liquidationGuardian = null; }
try { capitalMandate = require('../lib/capital-mandate'); } catch { capitalMandate = null; }

let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

// ─── Utilities ───────────────────────────────────────────────────────────────

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
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) throw new Error(`HTTP ${response.status} ${JSON.stringify(payload).slice(0, 280)}`);
    return payload;
  } finally { clearTimeout(timeout); }
}

function loadState() {
  const abs = path.resolve(process.cwd(), STATE_FILE);
  if (!fs.existsSync(abs)) return { path: abs, data: { lastRunAt: 0, trades: [] } };
  try { return { path: abs, data: JSON.parse(fs.readFileSync(abs, 'utf8')) }; }
  catch { return { path: abs, data: { lastRunAt: 0, trades: [] } }; }
}

function saveState(filepath, data) {
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (rio) { rio.writeJsonAtomic(filepath, data); }
  else {
    const tmp = filepath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filepath);
  }
}

function roundDown(value, decimals) {
  const factor = 10 ** Math.max(0, decimals);
  return Math.floor(value * factor) / factor;
}

// ─── Coinbase CDP JWT Auth ───────────────────────────────────────────────────

function toBase64Url(input) {
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function cbCdpJwt(method, requestPath) {
  const now = Math.floor(Date.now() / 1000);
  const pathOnly = requestPath.split('?')[0];
  const header = { alg: 'ES256', typ: 'JWT', kid: CB_API_KEY, nonce: crypto.randomBytes(16).toString('hex') };
  const payload = {
    iss: 'cdp', sub: CB_API_KEY, nbf: now, exp: now + 120,
    uri: method.toUpperCase() + ' api.coinbase.com' + pathOnly,
  };
  const hdr = toBase64Url(JSON.stringify(header));
  const pld = toBase64Url(JSON.stringify(payload));
  const sigInput = hdr + '.' + pld;
  const pem = CB_API_SECRET.includes('\\n') ? CB_API_SECRET.replace(/\\n/g, '\n') : CB_API_SECRET;
  const sig = crypto.sign('sha256', Buffer.from(sigInput), { key: pem, dsaEncoding: 'ieee-p1363' });
  return sigInput + '.' + toBase64Url(sig);
}

async function cbPrivate(method, requestPath, bodyObj = null) {
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const token = cbCdpJwt(method, requestPath);
  return fetchJson(`${CB_CDP_BASE}${requestPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body || undefined,
  });
}

// ─── Kraken Auth ─────────────────────────────────────────────────────────────

function kNonce() { return String(Date.now() * 1000 + Math.floor(Math.random() * 1000)); }

function kSign(pathname, body) {
  const secret = Buffer.from(K_API_SECRET, 'base64');
  const np = body.get('nonce');
  const hash = crypto.createHash('sha256').update(np + body.toString()).digest();
  return crypto.createHmac('sha512', secret).update(pathname).update(hash).digest('base64');
}

async function krakenPrivate(pathname, fields = {}) {
  const body = new URLSearchParams({ nonce: kNonce(), ...fields });
  const signature = kSign(pathname, body);
  return fetchJson(`${K_BASE}${pathname}`, {
    method: 'POST',
    headers: {
      'API-Key': K_API_KEY,
      'API-Sign': signature,
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    },
    body: body.toString(),
  });
}

async function krakenPublic(pathname, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${K_BASE}${pathname}${qs ? '?' + qs : ''}`;
  const payload = await fetchJson(url);
  if (Array.isArray(payload?.error) && payload.error.length > 0)
    throw new Error(`Kraken public: ${payload.error.join(', ')}`);
  return payload?.result || {};
}

// ─── Polymarket Gamma API (read-only intelligence) ───────────────────────────

const GAMMA_BASE = 'https://gamma-api.polymarket.com';

async function getPolymarketIntelligence() {
  const markets = [];
  try {
    // Fetch active markets — focus on high-volume near-term events
    const data = await fetchJson(`${GAMMA_BASE}/markets?closed=false&limit=50&order=volume24hr&ascending=false`);
    if (Array.isArray(data)) {
      for (const m of data) {
        const yes = Number(m.outcomePrices?.[0] || m.bestAsk || 0);
        const no = Number(m.outcomePrices?.[1] || 0);
        const volume = Number(m.volume24hr || m.volume || 0);
        const liquidity = Number(m.liquidityNum || m.liquidity || 0);
        if (yes <= 0 || volume <= 0) continue;
        markets.push({
          id: m.id || m.conditionId,
          question: (m.question || m.title || '').slice(0, 120),
          yesPrice: yes,
          noPrice: no || (1 - yes),
          volume24h: volume,
          liquidity,
          endDate: m.endDate || m.resolutionDate || null,
          category: m.category || m.groupSlug || '',
          // Detect if this relates to crypto prices
          isCrypto: /bitcoin|btc|ethereum|eth|solana|sol|crypto|defi/i.test(m.question || m.title || ''),
          isPolitics: /trump|biden|harris|election|president|congress|senate/i.test(m.question || m.title || ''),
          isEcon: /gdp|inflation|fed|interest rate|unemployment|recession/i.test(m.question || m.title || ''),
        });
      }
    }
  } catch (err) {
    console.error('[polymarket-intel] fetch error:', err.message);
  }
  return markets;
}

// ─── Coinbase Futures Scanner ────────────────────────────────────────────────

async function scanCoinbaseFutures() {
  const opportunities = [];
  try {
    const data = await cbPrivate('GET', '/api/v3/brokerage/products?product_type=FUTURE');
    const products = data?.products || [];

    // Separate into perps and dated futures
    const perps = products.filter(p => /PERP/i.test(p.display_name || ''));
    const dated = products.filter(p => !/PERP/i.test(p.display_name || '') && p.future_product_details?.contract_expiry);

    // For each dated future, calculate basis vs spot
    for (const fut of dated) {
      try {
        const expiry = new Date(fut.future_product_details.contract_expiry);
        const daysToExpiry = Math.max(1, (expiry - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysToExpiry > 90) continue; // Focus on near-term

        // Determine base asset
        const baseMatch = (fut.display_name || '').match(/^(\w+)\s/);
        const baseAsset = baseMatch ? baseMatch[1] : null;
        if (!baseAsset) continue;

        // Get futures price
        const futTicker = await cbPrivate('GET', `/api/v3/brokerage/products/${encodeURIComponent(fut.product_id)}`);
        const futPrice = Number(futTicker?.price || 0);
        if (futPrice <= 0) continue;

        // Get spot price for the base asset
        const spotProductId = `${baseAsset}-USD`;
        let spotPrice = 0;
        try {
          const spotData = await fetchJson(`https://api.coinbase.com/v2/prices/${spotProductId}/spot`);
          spotPrice = Number(spotData?.data?.amount || 0);
        } catch { continue; }
        if (spotPrice <= 0) continue;

        // Calculate basis
        const basisPct = ((futPrice - spotPrice) / spotPrice) * 100;
        const annualizedBasis = (basisPct / daysToExpiry) * 365;

        opportunities.push({
          venue: 'coinbase_futures',
          type: 'basis_trade',
          productId: fut.product_id,
          displayName: fut.display_name,
          baseAsset,
          futPrice,
          spotPrice,
          basisPct: Number(basisPct.toFixed(3)),
          annualizedBasisPct: Number(annualizedBasis.toFixed(2)),
          daysToExpiry: Number(daysToExpiry.toFixed(1)),
          expiry: expiry.toISOString(),
          side: annualizedBasis > 0 ? 'sell' : 'buy', // sell overpriced futures, buy underpriced
          edge: Math.abs(annualizedBasis) / 100,
          confidence: Math.min(0.95, 0.5 + Math.abs(annualizedBasis) / 40),
        });
      } catch (err) {
        // Skip individual failures
      }
    }

    // For perps — use directional signals from edge detector
    for (const perp of perps) {
      try {
        const baseMatch = (perp.display_name || '').match(/^(\w+)\s/);
        const baseAsset = baseMatch ? baseMatch[1] : null;
        if (!baseAsset) continue;

        // Only process majors for perps
        if (!['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'LINK', 'AVAX'].includes(baseAsset)) continue;

        if (edgeDetector) {
          try {
            const composite = await edgeDetector.getCompositeSignal({ asset: baseAsset });
            if (composite.confidence >= MIN_CONFIDENCE && composite.side !== 'neutral') {
              const orderUsd = edgeDetector.dynamicOrderSize(composite, ORDER_USD, MAX_ORDER_USD / ORDER_USD);
              opportunities.push({
                venue: 'coinbase_futures',
                type: 'perp_directional',
                productId: perp.product_id,
                displayName: perp.display_name,
                baseAsset,
                side: composite.side,
                confidence: composite.confidence,
                edge: composite.edge,
                compositeScore: composite.compositeScore,
                orderUsd,
                components: composite.components,
              });
            }
          } catch {}
        }
      } catch {}
    }
  } catch (err) {
    console.error('[coinbase-futures] scan error:', err.message);
  }

  return opportunities;
}

// ─── Kraken Event Token Scanner ──────────────────────────────────────────────

// Event/prediction-adjacent tokens on Kraken — auto-expanded from API probe
const KRAKEN_EVENT_TOKENS = [
  // Political / event tokens
  { pair: 'TRUMPUSD', name: 'TRUMP', category: 'politics' },
  // Meme / prediction-adjacent tokens (high volatility = high opportunity)
  { pair: 'PEPEUSD', name: 'PEPE', category: 'meme' },
  { pair: 'BONKUSD', name: 'BONK', category: 'meme' },
  { pair: 'WIFUSD', name: 'WIF', category: 'meme' },
  { pair: 'FLOKIUSD', name: 'FLOKI', category: 'meme' },
  { pair: 'MOGUSD', name: 'MOG', category: 'meme' },
  { pair: 'POPCATUSD', name: 'POPCAT', category: 'meme' },
  { pair: 'PNUTUSD', name: 'PNUT', category: 'meme' },
  { pair: 'SPXUSD', name: 'SPX', category: 'meme' },
  { pair: 'TURBOUSD', name: 'TURBO', category: 'meme' },
  { pair: 'NEIROUSD', name: 'NEIRO', category: 'meme' },
  { pair: 'ACTUSD', name: 'ACT', category: 'meme' },
  { pair: 'MEMEUSD', name: 'MEME', category: 'meme' },
  { pair: 'SHIBUSD', name: 'SHIB', category: 'meme' },
];

async function scanKrakenEventTokens(polymarketIntel) {
  const opportunities = [];

  for (const token of KRAKEN_EVENT_TOKENS) {
    try {
      const ticker = await krakenPublic('/0/public/Ticker', { pair: token.pair });
      const info = Object.values(ticker)[0];
      if (!info) continue;

      const price = Number(info.c?.[0] || 0);
      const ask = Number(info.a?.[0] || 0);
      const bid = Number(info.b?.[0] || 0);
      const vol24h = Number(info.v?.[1] || 0);
      const high24h = Number(info.h?.[1] || 0);
      const low24h = Number(info.l?.[1] || 0);
      if (price <= 0) continue;

      const spread = ask > 0 && bid > 0 ? (ask - bid) / ask : 0;
      const range24h = high24h > 0 && low24h > 0 ? (high24h - low24h) / price : 0;

      // Use edge detector for directional signal
      let signal = null;
      if (edgeDetector) {
        try {
          signal = await edgeDetector.getCompositeSignal({ asset: token.name });
        } catch {
          // Token may not have candle data — use momentum from price action
        }
      }

      // Cross-reference with Polymarket intelligence
      let polySignal = null;
      if (polymarketIntel.length > 0) {
        const related = polymarketIntel.filter(m =>
          m.isPolitics && /trump/i.test(m.question)
        );
        if (related.length > 0) {
          // Average Polymarket probability for TRUMP-related markets
          const avgYes = related.reduce((s, m) => s + m.yesPrice, 0) / related.length;
          polySignal = {
            avgProbability: avgYes,
            marketCount: related.length,
            sentiment: avgYes > 0.6 ? 'bullish' : avgYes < 0.4 ? 'bearish' : 'neutral',
          };
        }
      }

      // Compute trade signal
      let side = 'neutral';
      let confidence = 0.5;
      let edge = 0;

      if (signal && signal.side !== 'neutral' && signal.confidence >= MIN_CONFIDENCE) {
        side = signal.side;
        confidence = signal.confidence;
        edge = signal.edge || 0;
      } else {
        // Momentum from 24h range
        const momentum = price > 0 ? (price - low24h) / (high24h - low24h || 1) : 0.5;
        if (momentum > 0.65) { side = 'buy'; confidence = 0.5 + momentum * 0.2; }
        else if (momentum < 0.35) { side = 'sell'; confidence = 0.5 + (1 - momentum) * 0.2; }
        // Edge = directional strength * volatility, with range as floor for volatile tokens
        edge = Math.abs(momentum - 0.5) * range24h;
        if (range24h > 0.03 && side !== 'neutral') edge = Math.max(edge, range24h * 0.15);
      }

      // Boost confidence if Polymarket confirms direction
      if (polySignal) {
        if (
          (polySignal.sentiment === 'bullish' && side === 'buy') ||
          (polySignal.sentiment === 'bearish' && side === 'sell')
        ) {
          confidence = Math.min(0.95, confidence + 0.05);
          edge += 0.02;
        } else if (
          (polySignal.sentiment === 'bullish' && side === 'sell') ||
          (polySignal.sentiment === 'bearish' && side === 'buy')
        ) {
          confidence = Math.max(0.5, confidence - 0.05);
        }
      }

      if (side !== 'neutral' && confidence >= MIN_CONFIDENCE && edge >= MIN_EVENT_EDGE) {
        const orderUsd = edgeDetector
          ? edgeDetector.dynamicOrderSize({ edge, confidence, compositeScore: edge }, ORDER_USD, MAX_ORDER_USD / ORDER_USD)
          : ORDER_USD;

        opportunities.push({
          venue: 'kraken_event',
          type: 'event_token',
          pair: token.pair,
          name: token.name,
          category: token.category,
          price,
          bid,
          ask,
          spread: Number(spread.toFixed(4)),
          vol24h: Number(vol24h.toFixed(2)),
          range24h: Number((range24h * 100).toFixed(2)),
          side,
          confidence: Number(confidence.toFixed(3)),
          edge: Number(edge.toFixed(4)),
          orderUsd: Number(orderUsd.toFixed(2)),
          polySignal,
          compositeSignal: signal ? { side: signal.side, confidence: signal.confidence } : null,
        });
      }
    } catch (err) {
      console.error(`[kraken-event] ${token.name} error:`, err.message);
    }
  }

  return opportunities;
}

// ─── Coinbase Spot Event Token Scanner ────────────────────────────────────────

// Prediction/event tokens available on Coinbase spot
const COINBASE_EVENT_TOKENS = [
  { productId: 'TRUMP-USD', name: 'TRUMP', category: 'politics' },
  { productId: 'PEPE-USD', name: 'PEPE', category: 'meme' },
  { productId: 'BONK-USD', name: 'BONK', category: 'meme' },
  { productId: 'WIF-USD', name: 'WIF', category: 'meme' },
  { productId: 'POPCAT-USD', name: 'POPCAT', category: 'meme' },
  { productId: 'SPX-USD', name: 'SPX', category: 'meme' },
  { productId: 'MOG-USD', name: 'MOG', category: 'meme' },
  { productId: 'TURBO-USD', name: 'TURBO', category: 'meme' },
];

async function scanCoinbaseEventTokens(polymarketIntel) {
  const opportunities = [];

  for (const token of COINBASE_EVENT_TOKENS) {
    try {
      const data = await cbPrivate('GET', `/api/v3/brokerage/products/${encodeURIComponent(token.productId)}`);
      const price = Number(data?.price || 0);
      if (price <= 0) continue;

      // Get 24h candles for momentum
      const end = Math.floor(Date.now() / 1000);
      const start = end - 86400;
      let high24h = price, low24h = price;
      try {
        const candles = await cbPrivate('GET', `/api/v3/brokerage/products/${encodeURIComponent(token.productId)}/candles?start=${start}&end=${end}&granularity=ONE_HOUR`);
        if (Array.isArray(candles?.candles) && candles.candles.length > 0) {
          for (const c of candles.candles) {
            const h = Number(c.high || 0);
            const l = Number(c.low || 0);
            if (h > high24h) high24h = h;
            if (l > 0 && l < low24h) low24h = l;
          }
        }
      } catch {}

      const range24h = high24h > 0 && low24h > 0 ? (high24h - low24h) / price : 0;

      // Use edge detector for directional signal
      let signal = null;
      if (edgeDetector) {
        try {
          signal = await edgeDetector.getCompositeSignal({ asset: token.name });
        } catch {}
      }

      // Cross-reference with Polymarket intelligence for political tokens
      let polySignal = null;
      if (polymarketIntel.length > 0 && token.category === 'politics') {
        const tokenRe = new RegExp(token.name, 'i');
        const related = polymarketIntel.filter(m => tokenRe.test(m.question));
        if (related.length > 0) {
          const avgYes = related.reduce((s, m) => s + m.yesPrice, 0) / related.length;
          polySignal = {
            avgProbability: avgYes,
            marketCount: related.length,
            sentiment: avgYes > 0.6 ? 'bullish' : avgYes < 0.4 ? 'bearish' : 'neutral',
          };
        }
      }

      // Compute trade signal
      let side = 'neutral';
      let confidence = 0.5;
      let edge = 0;

      if (signal && signal.side !== 'neutral' && signal.confidence >= MIN_CONFIDENCE) {
        side = signal.side;
        confidence = signal.confidence;
        edge = signal.edge || 0;
      } else {
        // Momentum from 24h range
        const momentum = price > 0 && high24h !== low24h ? (price - low24h) / (high24h - low24h) : 0.5;
        if (momentum > 0.65) { side = 'buy'; confidence = 0.5 + momentum * 0.2; }
        else if (momentum < 0.35) { side = 'sell'; confidence = 0.5 + (1 - momentum) * 0.2; }
        // Edge = directional strength * volatility, with range as floor for volatile tokens
        edge = Math.abs(momentum - 0.5) * range24h;
        if (range24h > 0.03 && side !== 'neutral') edge = Math.max(edge, range24h * 0.15);
      }

      // Boost confidence if Polymarket confirms direction
      if (polySignal) {
        if (
          (polySignal.sentiment === 'bullish' && side === 'buy') ||
          (polySignal.sentiment === 'bearish' && side === 'sell')
        ) {
          confidence = Math.min(0.95, confidence + 0.05);
          edge += 0.02;
        } else if (
          (polySignal.sentiment === 'bullish' && side === 'sell') ||
          (polySignal.sentiment === 'bearish' && side === 'buy')
        ) {
          confidence = Math.max(0.5, confidence - 0.05);
        }
      }

      if (side !== 'neutral' && confidence >= MIN_CONFIDENCE && edge >= MIN_EVENT_EDGE) {
        const orderUsd = edgeDetector
          ? edgeDetector.dynamicOrderSize({ edge, confidence, compositeScore: edge }, ORDER_USD, MAX_ORDER_USD / ORDER_USD)
          : ORDER_USD;

        opportunities.push({
          venue: 'coinbase_event',
          type: 'event_token',
          productId: token.productId,
          name: token.name,
          category: token.category,
          price,
          range24h: Number((range24h * 100).toFixed(2)),
          side,
          confidence: Number(confidence.toFixed(3)),
          edge: Number(edge.toFixed(4)),
          orderUsd: Number(orderUsd.toFixed(2)),
          polySignal,
          compositeSignal: signal ? { side: signal.side, confidence: signal.confidence } : null,
        });
      }
    } catch (err) {
      console.error(`[coinbase-event] ${token.name} error:`, err.message);
    }
  }

  return opportunities;
}

// ─── Order Execution ─────────────────────────────────────────────────────────

async function executeCoinbaseFuturesOrder(opp) {
  const clientOrderId = crypto.randomUUID();
  const side = opp.side.toUpperCase();
  const orderUsd = opp.orderUsd || ORDER_USD;

  // For futures, we need to determine contract size
  // Coinbase futures use contract multiplier — get product details
  let productDetail;
  try {
    productDetail = await cbPrivate('GET', `/api/v3/brokerage/products/${encodeURIComponent(opp.productId)}`);
  } catch { productDetail = {}; }

  const contractSize = Number(productDetail?.future_product_details?.contract_size || 1);
  const price = opp.futPrice || Number(productDetail?.price || 0);
  if (price <= 0) return { status: 'skipped', reason: 'could not determine futures price' };

  const contractValue = price * contractSize;
  const numContracts = Math.max(1, Math.floor(orderUsd / contractValue));

  const payload = {
    client_order_id: clientOrderId,
    product_id: opp.productId,
    side,
    order_configuration: {
      market_market_ioc: {
        base_size: String(numContracts),
      },
    },
  };

  if (DRY_RUN) {
    return {
      status: 'dry-run',
      venue: 'coinbase_futures',
      type: opp.type,
      product: opp.productId,
      side: opp.side,
      numContracts,
      usdNotional: Number((numContracts * contractValue).toFixed(2)),
      confidence: opp.confidence,
      edge: opp.edge,
    };
  }

  const result = await cbPrivate('POST', '/api/v3/brokerage/orders', payload);
  return {
    status: 'placed',
    venue: 'coinbase_futures',
    type: opp.type,
    product: opp.productId,
    side: opp.side,
    result,
  };
}

async function executeCoinbaseEventOrder(opp) {
  // Use Coinbase Advanced Trade spot order
  const clientOrderId = crypto.randomUUID();
  const volume = opp.orderUsd / opp.price;
  // Get product details for size increments
  let productDetail;
  try { productDetail = await cbPrivate('GET', `/api/v3/brokerage/products/${encodeURIComponent(opp.productId)}`); } catch {}
  const baseIncrement = Number(productDetail?.base_increment || 0.01);
  const precision = Math.max(0, -Math.floor(Math.log10(baseIncrement)));
  const roundedVolume = roundDown(volume, precision);
  const minSize = Number(productDetail?.base_min_size || 0);
  if (roundedVolume <= 0 || (minSize > 0 && roundedVolume < minSize)) {
    return { status: 'skipped', reason: 'volume too low', volume: roundedVolume, minSize };
  }

  const payload = {
    client_order_id: clientOrderId,
    product_id: opp.productId,
    side: opp.side.toUpperCase(),
    order_configuration: {
      market_market_ioc: {
        base_size: String(roundedVolume),
      },
    },
  };

  if (DRY_RUN) {
    return {
      status: 'dry-run',
      venue: 'coinbase_event',
      type: 'event_token',
      product: opp.productId,
      name: opp.name,
      side: opp.side,
      volume: roundedVolume,
      usdNotional: Number((roundedVolume * opp.price).toFixed(2)),
      confidence: opp.confidence,
      edge: opp.edge,
    };
  }

  const result = await cbPrivate('POST', '/api/v3/brokerage/orders', payload);
  return {
    status: 'placed',
    venue: 'coinbase_event',
    type: 'event_token',
    product: opp.productId,
    name: opp.name,
    side: opp.side,
    volume: roundedVolume,
    result,
  };
}

async function executeKrakenEventOrder(opp) {
  // Get pair metadata
  const pairInfo = await krakenPublic('/0/public/AssetPairs', { pair: opp.pair });
  const info = Object.values(pairInfo)[0];
  if (!info) return { status: 'skipped', reason: 'pair info not found' };

  const lotDecimals = Number(info.lot_decimals || 8);
  const ordMin = Number(info.ordermin || 0);
  const rawVolume = (opp.orderUsd || ORDER_USD) / opp.price;
  const volume = roundDown(rawVolume, lotDecimals);

  if (volume <= 0 || (ordMin > 0 && volume < ordMin)) {
    return { status: 'skipped', reason: 'volume too low', volume, ordMin };
  }

  const order = {
    pair: info.altname || opp.pair,
    type: opp.side,
    ordertype: 'market',
    volume: String(volume),
    validate: DRY_RUN ? 'true' : undefined,
  };

  if (DRY_RUN) {
    return {
      status: 'dry-run',
      venue: 'kraken_event',
      type: 'event_token',
      pair: opp.pair,
      name: opp.name,
      side: opp.side,
      volume,
      usdNotional: Number((volume * opp.price).toFixed(2)),
      confidence: opp.confidence,
      edge: opp.edge,
      polySignal: opp.polySignal,
    };
  }

  const result = await krakenPrivate('/0/private/AddOrder', order);
  return {
    status: 'placed',
    venue: 'kraken_event',
    type: 'event_token',
    pair: opp.pair,
    name: opp.name,
    side: opp.side,
    volume,
    result,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!ENABLED) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'PRED_MARKET_ENABLED is false' }, null, 2));
    return;
  }

  const state = loadState();
  const nowMs = Date.now();
  const sinceLastRunSec = state.data?.lastRunAt ? Math.floor((nowMs - Number(state.data.lastRunAt)) / 1000) : null;
  if (sinceLastRunSec !== null && sinceLastRunSec < MIN_INTERVAL_SEC) {
    console.log(JSON.stringify({
      status: 'skipped',
      reason: `min-interval-not-met (${sinceLastRunSec}s/${MIN_INTERVAL_SEC}s)`,
    }, null, 2));
    return;
  }

  console.error('[pred-market] Starting prediction market scan...');

  // ─── Phase 1: Gather intelligence ───
  const polyIntel = await getPolymarketIntelligence();
  console.error(`[pred-market] Polymarket intelligence: ${polyIntel.length} markets`);

  // ─── Phase 2: Scan all venues for opportunities ───
  const [cbFuturesOpps, krakenEventOpps, cbEventOpps] = await Promise.all([
    CB_API_KEY && CB_API_SECRET && CB_FUTURES_ENABLED ? scanCoinbaseFutures() : [],
    K_API_KEY && K_API_SECRET ? scanKrakenEventTokens(polyIntel) : [],
    CB_API_KEY && CB_API_SECRET ? scanCoinbaseEventTokens(polyIntel) : [],
  ]);

  const allOpps = [...cbFuturesOpps, ...krakenEventOpps, ...cbEventOpps];

  // Sort by confidence * edge (best opportunities first)
  allOpps.sort((a, b) => (b.confidence * (b.edge || 0.01)) - (a.confidence * (a.edge || 0.01)));

  console.error(`[pred-market] Found ${allOpps.length} opportunities (${cbFuturesOpps.length} CB futures, ${krakenEventOpps.length} KR events, ${cbEventOpps.length} CB events)`);

  if (allOpps.length === 0) {
    // Publish to signal bus
    if (signalBus) {
      signalBus.publish({
        source: 'prediction-market-engine',
        type: 'pred_market_scan',
        confidence: 0.5,
        payload: {
          polymarketMarkets: polyIntel.length,
          coinbaseFutures: cbFuturesOpps.length,
          coinbaseEvents: cbEventOpps.length,
          krakenEvents: krakenEventOpps.length,
          result: 'no_opportunities',
        },
      });
    }

    console.log(JSON.stringify({
      ts: new Date(nowMs).toISOString(),
      status: 'no_opportunities',
      polymarketIntel: polyIntel.slice(0, 5).map(m => ({
        question: m.question,
        yesPrice: m.yesPrice,
        volume24h: m.volume24h,
        category: m.category,
      })),
    }, null, 2));
    return;
  }

  // ─── Phase 3: Execute top opportunities ───
  const actions = [];
  let ordersPlaced = 0;

  for (const opp of allOpps) {
    if (ordersPlaced >= MAX_ORDERS_PER_CYCLE) break;

    // === CAPITAL MANDATE GATE — ZERO INJECTION PROTOCOL ===
    if (capitalMandate) {
      const mandateSize = capitalMandate.mandateAdjustedSize({ baseUsd: opp.orderUsd || ORDER_USD, confidence: opp.confidence || 0.5, edge: opp.edge || 0 });
      if (mandateSize <= 0) {
        console.error(`[pred-market] Mandate denied ${opp.venue}: capital mode prevents trade`);
        actions.push({ status: 'mandate_denied', venue: opp.venue, reason: 'capital halt or survival mode' });
        continue;
      }
      const mandateCheck = capitalMandate.checkMandate({ usdSize: mandateSize, confidence: opp.confidence || 0.5, edge: opp.edge || 0, asset: opp.baseAsset || '', venue: opp.venue });
      if (!mandateCheck.allowed) {
        console.error(`[pred-market] Mandate denied ${opp.venue}: ${mandateCheck.reasons.join(', ')}`);
        actions.push({ status: 'mandate_denied', venue: opp.venue, reasons: mandateCheck.reasons });
        continue;
      }
      if (opp.orderUsd) opp.orderUsd = Math.min(opp.orderUsd, mandateSize);
    }

    // Liquidation guardian gate — check venue margin before every order
    if (liquidationGuardian) {
      const guardianVenue = opp.venue === 'coinbase_futures' ? 'coinbase' : opp.venue === 'coinbase_event' ? 'coinbase' : 'kraken';
      // Spot/event token trades bypass futures margin check; only futures need margin gate
      const tradeType = opp.venue === 'coinbase_futures' ? 'futures' : 'spot';
      const marginCheck = liquidationGuardian.shouldAllowNewTrade(guardianVenue, { tradeType });
      if (!marginCheck.allowed) {
        console.error(`[pred-market] Guardian blocked ${opp.venue} trade: ${marginCheck.reason}`);
        actions.push({ status: 'guardian_blocked', venue: opp.venue, reason: marginCheck.reason, marginPct: marginCheck.marginPct });
        continue;
      }
    }

    let action;
    try {
      if (opp.venue === 'coinbase_futures') {
        action = await executeCoinbaseFuturesOrder(opp);
      } else if (opp.venue === 'coinbase_event') {
        action = await executeCoinbaseEventOrder(opp);
      } else if (opp.venue === 'kraken_event') {
        action = await executeKrakenEventOrder(opp);
      }
    } catch (err) {
      action = { status: 'error', venue: opp.venue, error: err.message };
    }

    if (action) {
      actions.push(action);
      if (action.status === 'placed' || action.status === 'dry-run') {
        ordersPlaced++;

        // Record in trade journal
        if (tradeJournal) {
          try {
            tradeJournal.recordTrade({
              venue: opp.venue,
              asset: opp.baseAsset || opp.name || opp.productId,
              side: opp.side,
              entryPrice: opp.futPrice || opp.spotPrice || opp.price || 0,
              usdSize: opp.orderUsd || ORDER_USD,
              signal: { side: opp.side, confidence: opp.confidence, edge: opp.edge },
              dryRun: DRY_RUN,
            });
          } catch {}
        }
      }
    }
  }

  // Update state
  state.data.lastRunAt = nowMs;
  state.data.lastScan = {
    polymarketMarkets: polyIntel.length,
    opportunities: allOpps.length,
    ordersPlaced,
    topOpportunity: allOpps[0] ? {
      venue: allOpps[0].venue,
      type: allOpps[0].type,
      side: allOpps[0].side,
      confidence: allOpps[0].confidence,
    } : null,
  };
  if (!Array.isArray(state.data.trades)) state.data.trades = [];
  for (const a of actions) {
    state.data.trades.push({ ts: nowMs, ...a });
  }
  // Keep only last 200 trades in state
  if (state.data.trades.length > 200) {
    state.data.trades = state.data.trades.slice(-200);
  }
  saveState(state.path, state.data);

  // Publish to signal bus
  if (signalBus) {
    signalBus.publish({
      source: 'prediction-market-engine',
      type: 'pred_market_trade',
      confidence: allOpps[0]?.confidence || 0.5,
      payload: {
        opportunities: allOpps.length,
        ordersPlaced,
        dryRun: DRY_RUN,
        topOpps: allOpps.slice(0, 3).map(o => ({
          venue: o.venue,
          type: o.type,
          side: o.side,
          confidence: o.confidence,
          edge: o.edge,
        })),
      },
    });
  }

  console.log(JSON.stringify({
    ts: new Date(nowMs).toISOString(),
    enabled: true,
    dryRun: DRY_RUN,
    polymarketIntel: {
      totalMarkets: polyIntel.length,
      cryptoMarkets: polyIntel.filter(m => m.isCrypto).length,
      politicsMarkets: polyIntel.filter(m => m.isPolitics).length,
      econMarkets: polyIntel.filter(m => m.isEcon).length,
      topMarkets: polyIntel.slice(0, 5).map(m => ({
        question: m.question,
        yesPrice: m.yesPrice,
        volume24h: m.volume24h,
      })),
    },
    opportunities: {
      total: allOpps.length,
      coinbaseFutures: cbFuturesOpps.length,
      coinbaseEvents: cbEventOpps.length,
      krakenEvents: krakenEventOpps.length,
      basisTrades: allOpps.filter(o => o.type === 'basis_trade').length,
      perpDirectional: allOpps.filter(o => o.type === 'perp_directional').length,
      eventTokens: allOpps.filter(o => o.type === 'event_token').length,
    },
    actions,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
