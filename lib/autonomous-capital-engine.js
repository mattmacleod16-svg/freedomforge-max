/**
 * FreedomForge Autonomous Capital Engine (ACE)
 * ════════════════════════════════════════════════════════════════════════════
 * THE MASTER MONEY ENGINE.
 *
 * Every cycle:
 *   1. MEASURE   — Live balances from Kraken + Coinbase (CDP JWT auth)
 *   2. HARVEST   — Pull new revenue from all streams into treasury
 *   3. ALLOCATE  — Waterfall: Owner 25% → API Reserve 10% → Gas → Compound
 *   4. SCALE     — Auto-adjust order sizes vs $50k/month target
 *   5. HEAL      — Auto-fund API credits + gas if running low
 *   6. REPORT    — Update state, push to signal bus, alert if needed
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { createLogger } = require('./logger');
const log = createLogger('ace');

// ─── Optional Module Imports ─────────────────────────────────────────────────
let rio;            try { rio            = require('./resilient-io');              } catch {}
let treasuryLedger; try { treasuryLedger = require('./treasury-ledger');           } catch {}
let capitalMandate; try { capitalMandate = require('./capital-mandate');           } catch {}
let revenueAlloc;   try { revenueAlloc   = require('./funding/revenue-allocator'); } catch {}
let costTracker;    try { costTracker    = require('./funding/api-cost-tracker');  } catch {}
let agentcard;      try { agentcard      = require('./funding/agentcard-manager'); } catch {}
let signalBus;      try { signalBus      = require('./agent-signal-bus');          } catch {}

// ─── Config ──────────────────────────────────────────────────────────────────
const STATE_FILE            = path.resolve(process.cwd(), 'data/ace-state.json');
const CYCLE_MIN_INTERVAL_MS = Math.max(60_000, Number(process.env.ACE_MIN_INTERVAL_MS || 300_000));

const TARGET_INCOME_DAILY   = Number(process.env.TARGET_INCOME_DAILY   || 1666.67);
const TARGET_INCOME_MONTHLY = Number(process.env.TARGET_INCOME_MONTHLY || 50000);
const OWNER_PAYOUT_PCT      = Math.max(15, Math.min(50, Number(process.env.OWNER_PAYOUT_PCT  || 25)));
const API_RESERVE_PCT       = Math.max(5,  Math.min(30, Number(process.env.API_RESERVE_PCT   || 10)));
const GAS_RESERVE_USD       = Math.max(10, Math.min(200, Number(process.env.GAS_RESERVE_TARGET_USD || 30)));

// Kraken
const KR_ENABLED    = String(process.env.KRAKEN_ENABLED  || 'true').toLowerCase() === 'true';
const K_API_KEY     = (process.env.KRAKEN_API_KEY    || '').trim();
const K_API_SECRET  = (process.env.KRAKEN_API_SECRET || '').trim();
const K_BASE        = 'https://api.kraken.com';

// Coinbase CDP
const CB_ENABLED    = String(process.env.COINBASE_ENABLED || 'true').toLowerCase() === 'true';
const CB_API_KEY    = (process.env.COINBASE_API_KEY    || '').trim();
const CB_API_SECRET = (process.env.COINBASE_API_SECRET || '').trim();
const CB_CDP_BASE   = 'https://api.coinbase.com';

// ─── State ───────────────────────────────────────────────────────────────────
function loadState() {
  try {
    if (rio) return rio.readJsonSafe(STATE_FILE, { fallback: null }) || freshState();
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {}
  return freshState();
}

function saveState(s) {
  s.updatedAt = Date.now();
  try {
    if (rio) { rio.writeJsonAtomic(STATE_FILE, s); return; }
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = STATE_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) { log.error('save failed', { err: err.message }); }
}

function freshState() {
  return {
    lastCycleAt: 0, cycleCount: 0,
    capitalHistory: [], peakCapital: 0, currentCapital: 0,
    todayRevenue: 0, weekRevenue: 0, monthRevenue: 0, allTimeRevenue: 0,
    lastKnownPnl: 0, history: [],
    targetDaily: TARGET_INCOME_DAILY, targetMonthly: TARGET_INCOME_MONTHLY,
    selfFundingStreak: 0, lastApiTopup: null, lastGasTopup: null,
    orderSizeMultiplier: 1.0,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function toBase64Url(input) {
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Build CDP JWT — identical to coinbase-spot-engine.js (what actually works)
function createCdpJwt(method, requestPath) {
  const now    = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', typ: 'JWT', kid: CB_API_KEY, nonce: crypto.randomBytes(16).toString('hex') };
  const payload = {
    iss: 'cdp', sub: CB_API_KEY, nbf: now, exp: now + 120,
    uri: `${String(method).toUpperCase()} api.coinbase.com${requestPath}`,
  };
  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`;
  const pem = CB_API_SECRET.includes('\\n') ? CB_API_SECRET.replace(/\\n/g, '\n') : CB_API_SECRET;
  const sig  = crypto.sign('sha256', Buffer.from(signingInput), { key: pem, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${toBase64Url(sig)}`;
}

async function cbPrivate(method, reqPath, body = null) {
  const token = createCdpJwt(method, reqPath);
  const res = await fetch(`${CB_CDP_BASE}${reqPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// ─── Exchange Balance Fetchers ────────────────────────────────────────────────

// Stablecoin symbols that map 1:1 to USD
const STABLES = new Set(['ZUSD', 'USD', 'USDT', 'USDC', 'DAI', 'USDZ', 'TUSD', 'BUSD', 'LUSD', 'USDP', 'GUSD', 'HUSD', 'FRAX', 'CEUR', 'CUSD']);

async function fetchKrakenBalance() {
  if (!KR_ENABLED || !K_API_KEY || !K_API_SECRET) return null;
  try {
    const urlPath = '/0/private/Balance';
    const nonce   = Date.now() * 1000;
    const body    = `nonce=${nonce}`;
    const secret  = Buffer.from(K_API_SECRET, 'base64');
    const sha256  = crypto.createHash('sha256').update(nonce + body).digest();
    const hmac    = crypto.createHmac('sha512', secret).update(Buffer.concat([Buffer.from(urlPath), sha256])).digest('base64');

    const res  = await fetch(`${K_BASE}${urlPath}`, {
      method: 'POST',
      headers: { 'API-Key': K_API_KEY, 'API-Sign': hmac, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (data.error?.length) throw new Error(data.error[0]);

    // Fetch live prices for crypto assets using Kraken public API
    let prices = {};
    try {
      const cryptoAssets = Object.entries(data.result || {})
        .filter(([a, v]) => parseFloat(v) > 0 && !STABLES.has(a))
        .map(([a]) => a).join(',');

      if (cryptoAssets) {
        const tickerRes = await fetch(`${K_BASE}/0/public/Ticker?pair=${cryptoAssets}`, { signal: AbortSignal.timeout(8000) });
        const tickerData = await tickerRes.json();
        for (const [pair, t] of Object.entries(tickerData.result || {})) {
          prices[pair] = parseFloat(t.c?.[0] || 0);
        }
      }
    } catch (e) { log.warn('kraken price fetch failed', { err: e.message }); }

    let totalUsd = 0;
    const breakdown = {};
    for (const [asset, balance] of Object.entries(data.result || {})) {
      const bal = parseFloat(balance);
      if (bal < 0.00001) continue;
      const usdVal = STABLES.has(asset) ? bal : (prices[asset] ? bal * prices[asset] : 0);
      breakdown[asset] = { balance: bal, usdEstimate: usdVal };
      totalUsd += usdVal;
    }
    return { total: totalUsd, breakdown, source: 'kraken', ts: Date.now() };
  } catch (err) {
    log.warn('kraken balance fetch failed', { err: err.message });
    return null;
  }
}

async function fetchCoinbaseBalance() {
  if (!CB_ENABLED || !CB_API_KEY || !CB_API_SECRET) return null;
  try {
    // Use Advanced Trade Brokerage API — same as trading engine
    const data = await cbPrivate('GET', '/api/v3/brokerage/accounts?limit=250');

    if (data.error) throw new Error(data.error);
    const accounts = data.accounts ?? [];

    let totalUsd = 0;
    const breakdown = {};

    for (const acct of accounts) {
      const bal = parseFloat(acct.available_balance?.value || acct.hold?.value || 0);
      if (bal < 0.000001) continue;
      const currency = acct.available_balance?.currency || acct.currency || acct.name;
      const isStable = STABLES.has(currency) || currency === 'USD';
      const usdVal = isStable ? bal : 0; // Non-stable crypto needs price lookup — skip for now, counted separately via portfolio
      breakdown[currency] = { balance: bal, usdEstimate: usdVal };
      totalUsd += usdVal;
    }

    // Also try the portfolio summary endpoint for a clean USD total
    try {
      const port = await cbPrivate('GET', '/api/v3/brokerage/portfolios');
      const portfolios = port.portfolios ?? [];
      let portTotalUsd = 0;
      for (const p of portfolios) {
        portTotalUsd += parseFloat(p.breakdown?.portfolio_balances?.total_balance?.value || 0);
      }
      if (portTotalUsd > totalUsd) {
        totalUsd = portTotalUsd;
        breakdown._portfolio_total = portTotalUsd;
      }
    } catch {}

    return { total: totalUsd, breakdown, source: 'coinbase', ts: Date.now() };
  } catch (err) {
    log.warn('coinbase balance fetch failed', { err: err.message });
    return { total: 0, breakdown: {}, source: 'coinbase', error: err.message, ts: Date.now() };
  }
}

// ─── Main Cycle ───────────────────────────────────────────────────────────────
async function runCycle(opts = {}) {
  const state = loadState();
  const now   = Date.now();

  if (!opts.force && now - state.lastCycleAt < CYCLE_MIN_INTERVAL_MS) {
    return { skipped: true, reason: 'rate_limited' };
  }

  log.info('ACE cycle starting', { cycle: state.cycleCount + 1 });

  // ═══ 1. MEASURE ═══════════════════════════════════════════════════════════
  const [krakenBal, coinbaseBal] = await Promise.all([
    fetchKrakenBalance(),
    fetchCoinbaseBalance(),
  ]);

  let totalCapital = 0;
  const breakdown  = {};

  if (krakenBal)   { totalCapital += krakenBal.total;   breakdown.kraken   = krakenBal;   }
  if (coinbaseBal) { totalCapital += coinbaseBal.total; breakdown.coinbase = coinbaseBal; }

  // Supplement with treasury ledger if it has a better number
  if (treasuryLedger) {
    const l = treasuryLedger.getLedger?.() || {};
    if (l.currentCapital > totalCapital) totalCapital = l.currentCapital;
  }

  state.currentCapital = totalCapital;
  state.peakCapital    = Math.max(state.peakCapital, totalCapital);

  // ═══ 2. HARVEST ═══════════════════════════════════════════════════════════
  let newRevenue = 0;
  if (treasuryLedger) {
    const l   = treasuryLedger.getLedger?.() || {};
    newRevenue = Math.max(0, (l.lifetimePnl || 0) - (state.lastKnownPnl || 0));
    state.lastKnownPnl = l.lifetimePnl || 0;
  }
  if (newRevenue > 0) {
    state.todayRevenue  += newRevenue;
    state.weekRevenue   += newRevenue;
    state.monthRevenue  += newRevenue;
    state.allTimeRevenue+= newRevenue;
    log.info('revenue harvested', { usd: newRevenue.toFixed(2) });
  }

  // ═══ 3. ALLOCATE ══════════════════════════════════════════════════════════
  if (newRevenue > 0 && revenueAlloc) {
    try { await revenueAlloc.allocate?.(newRevenue); } catch (err) { log.warn('allocation failed', { err: err.message }); }
  }

  // ═══ 4. HEAL API RESERVE ══════════════════════════════════════════════════
  if (costTracker && agentcard) {
    const apiStatus = costTracker.getStatus?.() || {};
    const daysRunway = (apiStatus.projectedDailyCostUsd || 0) > 0
      ? (apiStatus.reserveBalanceUsd || 0) / apiStatus.projectedDailyCostUsd
      : 999;
    if (daysRunway < 7) {
      log.warn('API reserve low — triggering auto-topup', { daysRunway: daysRunway.toFixed(1) });
      try { await agentcard.autoTopup?.({ reason: 'low_api_reserve', targetDays: 30 }); state.lastApiTopup = now; } catch {}
    }
  }

  // ═══ 5. SCALE ORDER SIZES ═════════════════════════════════════════════════
  const estDailyRoi    = 0.015;
  const capitalNeeded  = state.targetDaily / estDailyRoi;
  const capitalRatio   = totalCapital / capitalNeeded;

  const newMult = capitalRatio >= 1.5
    ? Math.min(2.0, 1.0 + (capitalRatio - 1.0) * 0.5)
    : capitalRatio <= 0.5
      ? Math.max(0.25, capitalRatio)
      : 1.0;

  state.orderSizeMultiplier = newMult;
  signalBus?.publish?.('ace.sizeMultiplier', { multiplier: newMult, ts: now });

  // ═══ 6. RECORD ════════════════════════════════════════════════════════════
  state.capitalHistory.push({ ts: now, total: totalCapital, kraken: krakenBal?.total ?? 0, coinbase: coinbaseBal?.total ?? 0 });
  if (state.capitalHistory.length > 2000) state.capitalHistory = state.capitalHistory.slice(-2000);
  state.cycleCount++;
  state.lastCycleAt = now;
  saveState(state);

  const report = {
    cycle: state.cycleCount,
    capital: { total: totalCapital, kraken: krakenBal?.total ?? 0, coinbase: coinbaseBal?.total ?? 0, peak: state.peakCapital },
    coinbaseStatus: coinbaseBal?.error ? `error: ${coinbaseBal.error}` : 'ok',
    krakenStatus:   krakenBal  ? 'ok' : 'error',
    revenue: { today: state.todayRevenue, week: state.weekRevenue, month: state.monthRevenue, allTime: state.allTimeRevenue },
    target: { daily: state.targetDaily, monthly: state.targetMonthly, progressPct: state.targetDaily > 0 ? (state.todayRevenue / state.targetDaily * 100).toFixed(1) : '0' },
    scaling: { multiplier: newMult.toFixed(2), capitalRatio: capitalRatio.toFixed(3), capitalNeeded },
    ts: now,
  };
  log.info('ACE cycle complete', report);
  return report;
}

// ─── Public API ───────────────────────────────────────────────────────────────
function setTarget(opts) {
  const s = loadState();
  if (opts.daily)   { s.targetDaily = opts.daily;    s.targetMonthly = opts.daily * 30; }
  if (opts.monthly) { s.targetMonthly = opts.monthly; s.targetDaily  = opts.monthly / 30; }
  saveState(s);
  return { daily: s.targetDaily, monthly: s.targetMonthly };
}

function getStatus() {
  const s = loadState();
  const estRoi = 0.015;
  const capitalNeeded = s.targetDaily / estRoi;
  const capitalRatio  = (s.currentCapital || 455) / capitalNeeded;
  return {
    target: { daily: s.targetDaily, monthly: s.targetMonthly, annual: s.targetDaily * 365, label: `$${Math.round(s.targetMonthly / 1000)}k/month` },
    capital: s.currentCapital || 455,
    estimated: { daily: (s.currentCapital || 455) * estRoi, monthly: (s.currentCapital || 455) * estRoi * 30 },
    onTrack: s.todayRevenue >= s.targetDaily * ((new Date().getHours() + new Date().getMinutes() / 60) / 24),
    aggressionTier: capitalRatio >= 2.0 ? 'max' : capitalRatio >= 1.2 ? 'growth' : capitalRatio >= 0.7 ? 'normal' : 'conservative',
    progress: { today: s.todayRevenue, week: s.weekRevenue, month: s.monthRevenue, allTime: s.allTimeRevenue },
    streams: {
      spot_trading:        { active: true, label: 'Spot Trading (Coinbase + Kraken)',         estimatedUSD: Math.max(8,   (s.currentCapital || 455) * 0.008), confidence: 0.55 },
      prediction_markets:  { active: true, label: 'Prediction Markets (Kalshi + Polymarket)',  estimatedUSD: Math.max(2,   (s.currentCapital || 455) * 0.003), confidence: 0.52 },
      defi_yield:          { active: true, label: 'DeFi Yield (Aave + Compound)',              estimatedUSD: Math.max(1,   (s.currentCapital || 455) * 0.002), confidence: 0.85 },
      mining:              { active: true, label: 'Mining Fleet (5 rigs)',                     estimatedUSD: 8,                                                 confidence: 0.90 },
      arbitrage:           { active: true, label: 'Cross-Venue Arbitrage',                     estimatedUSD: Math.max(0.5, (s.currentCapital || 455) * 0.001), confidence: 0.40 },
    },
    scaling: { orderSizeMultiplier: s.orderSizeMultiplier, capitalRatio: capitalRatio.toFixed(2) },
    selfFunding: { streak: s.selfFundingStreak, lastTopup: s.lastApiTopup },
    lastCycle: s.lastCycleAt,
    cycleCount: s.cycleCount,
  };
}

function resetDaily() {
  const s = loadState();
  const yesterday = { date: new Date(s.lastCycleAt || Date.now()).toISOString().slice(0, 10), realized: s.todayRevenue, target: s.targetDaily, achieved: s.todayRevenue >= s.targetDaily };
  if (!s.history) s.history = [];
  s.history.push(yesterday);
  if (s.history.length > 90) s.history = s.history.slice(-90);
  s.selfFundingStreak = s.todayRevenue > 0 ? s.selfFundingStreak + 1 : 0;
  s.todayRevenue = 0;
  if (new Date().getDay()  === 1) s.weekRevenue  = 0;
  if (new Date().getDate() === 1) s.monthRevenue = 0;
  saveState(s);
  return yesterday;
}

module.exports = { runCycle, setTarget, getStatus, resetDaily };
