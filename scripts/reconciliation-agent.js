#!/usr/bin/env node
/**
 * Position Reconciliation Agent
 * ==============================
 *
 * Periodically fetches actual balances and positions from each exchange,
 * compares them against local state (risk-manager positions + trade journal),
 * and flags discrepancies.
 *
 * This catches:
 *   - Partial fills that weren't recorded
 *   - Rejected orders that appeared successful (HTTP 200 but no fill)
 *   - Positions opened outside this system
 *   - State corruption from crashes
 *   - Phantom positions in risk state with no exchange backing
 *
 * Env vars:
 *   RECONCILER_ENABLED       (default: 'true')
 *   COINBASE_API_KEY, COINBASE_API_SECRET, COINBASE_API_PASSPHRASE
 *   KRAKEN_API_KEY, KRAKEN_API_SECRET
 *   ALPACA_API_KEY, ALPACA_API_SECRET, ALPACA_BASE_URL
 *   ALERT_WEBHOOK_URL        — Discord webhook for discrepancy alerts
 *   RECONCILER_TOLERANCE_USD — ignore discrepancies below this (default: 1.0)
 *
 * State: data/reconciliation-state.json
 * Run:  node scripts/reconciliation-agent.js
 *       npm run reconcile
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

// ─── Configuration ──────────────────────────────────────────────────────────

const ENABLED = String(process.env.RECONCILER_ENABLED || 'true').toLowerCase() !== 'false';
const TOLERANCE_USD = Math.min(1000, Math.max(0, Number(process.env.RECONCILER_TOLERANCE_USD || 1.0)));
const STATE_FILE = path.resolve(process.cwd(), process.env.RECONCILER_STATE_FILE || 'data/reconciliation-state.json');
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL || '';

// Coinbase
const CB_API_KEY = process.env.COINBASE_API_KEY || '';
const CB_API_SECRET = process.env.COINBASE_API_SECRET || '';
const CB_API_PASSPHRASE = process.env.COINBASE_API_PASSPHRASE || '';
const CB_BASE = process.env.COINBASE_API_URL || 'https://api.exchange.coinbase.com';

// Kraken
const KR_API_KEY = process.env.KRAKEN_API_KEY || '';
const KR_API_SECRET = process.env.KRAKEN_API_SECRET || '';
const KR_BASE = 'https://api.kraken.com';

// Alpaca
const ALP_API_KEY = process.env.ALPACA_API_KEY || '';
const ALP_API_SECRET = process.env.ALPACA_API_SECRET || '';
const ALP_BASE = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

// ─── Graceful Module Loading ────────────────────────────────────────────────

let rio, riskManager, tradeJournal, signalBus;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }
try { riskManager = require('../lib/risk-manager'); } catch { riskManager = null; }
try { tradeJournal = require('../lib/trade-journal'); } catch { tradeJournal = null; }
try { signalBus = require('../lib/agent-signal-bus'); } catch { signalBus = null; }

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadState() {
  if (rio) return rio.readJsonSafe(STATE_FILE, { fallback: null }) || defaultState();
  try {
    if (!fs.existsSync(STATE_FILE)) return defaultState();
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch { return defaultState(); }
}

function saveState(state) {
  state.updatedAt = Date.now();
  if (rio) { rio.writeJsonAtomic(STATE_FILE, state); return; }
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = STATE_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) { console.error('[reconciler] state save failed:', err?.message || err); }
}

function defaultState() {
  return {
    history: [],
    lastRun: null,
    discrepancyCount: 0,
    updatedAt: 0,
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => 'no body')}`);
    return res.json();
  } finally { clearTimeout(timer); }
}

async function sendAlert(message) {
  if (!ALERT_WEBHOOK_URL) return;
  try {
    const { execFileSync } = require('child_process');
    execFileSync('curl', [
      '-s', '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({ content: message.slice(0, 1900) }),
      ALERT_WEBHOOK_URL,
    ], { encoding: 'utf8', timeout: 10000 });
  } catch (err) { console.error('[reconciler] alert failed:', err?.message || err); }
}

// ─── Exchange Balance Fetchers ──────────────────────────────────────────────

/**
 * Fetch Coinbase Exchange balances via /accounts
 * Returns { asset: holdUsd } for non-zero balances
 */
async function fetchCoinbaseBalances() {
  if (!CB_API_KEY || !CB_API_SECRET || !CB_API_PASSPHRASE) {
    return { available: false, reason: 'missing credentials', balances: {} };
  }
  try {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const method = 'GET';
    const requestPath = '/accounts';
    const message = timestamp + method + requestPath;
    const hmac = crypto.createHmac('sha256', Buffer.from(CB_API_SECRET, 'base64'));
    hmac.update(message);
    const signature = hmac.digest('base64');

    const data = await fetchWithTimeout(`${CB_BASE}${requestPath}`, {
      method,
      headers: {
        'CB-ACCESS-KEY': CB_API_KEY,
        'CB-ACCESS-SIGN': signature,
        'CB-ACCESS-TIMESTAMP': timestamp,
        'CB-ACCESS-PASSPHRASE': CB_API_PASSPHRASE,
        'Content-Type': 'application/json',
      },
    });

    const balances = {};
    if (Array.isArray(data)) {
      for (const acct of data) {
        const balance = Number(acct.balance || 0);
        const hold = Number(acct.hold || 0);
        const total = balance + hold;
        if (total > 0 && acct.currency !== 'USD') {
          balances[acct.currency] = { balance, hold, total, currency: acct.currency };
        } else if (acct.currency === 'USD' && total > 0) {
          balances['USD'] = { balance, hold, total, currency: 'USD' };
        }
      }
    }
    return { available: true, balances };
  } catch (err) {
    return { available: false, reason: err?.message || String(err), balances: {} };
  }
}

/**
 * Fetch Kraken balances via /0/private/Balance
 * Returns { asset: amount } for non-zero balances
 */
async function fetchKrakenBalances() {
  if (!KR_API_KEY || !KR_API_SECRET) {
    return { available: false, reason: 'missing credentials', balances: {} };
  }
  try {
    const nonce = String(Date.now() * 1000);
    const apiPath = '/0/private/Balance';
    const body = new URLSearchParams({ nonce });

    // Kraken signature
    const sha256 = crypto.createHash('sha256').update(nonce + body.toString()).digest();
    const hmac = crypto.createHmac('sha512', Buffer.from(KR_API_SECRET, 'base64'));
    hmac.update(Buffer.concat([Buffer.from(apiPath), sha256]));
    const signature = hmac.digest('base64');

    const data = await fetchWithTimeout(`${KR_BASE}${apiPath}`, {
      method: 'POST',
      headers: {
        'API-Key': KR_API_KEY,
        'API-Sign': signature,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (data?.error?.length > 0) {
      return { available: false, reason: data.error.join(', '), balances: {} };
    }

    const balances = {};
    const result = data?.result || {};
    // Kraken uses prefixed asset names (XXBT, XETH, ZUSD, etc.)
    const krakenMap = { XXBT: 'BTC', XETH: 'ETH', XLTC: 'LTC', XXRP: 'XRP', ZUSD: 'USD', XXLM: 'XLM', XDOT: 'DOT' };
    for (const [krakenAsset, amount] of Object.entries(result)) {
      const num = Number(amount);
      if (num > 0.000001) {
        const normalized = krakenMap[krakenAsset] || krakenAsset.replace(/^[XZ]/, '');
        balances[normalized] = { balance: num, currency: normalized };
      }
    }
    return { available: true, balances };
  } catch (err) {
    return { available: false, reason: err?.message || String(err), balances: {} };
  }
}

/**
 * Fetch Alpaca positions via /v2/positions
 */
async function fetchAlpacaPositions() {
  if (!ALP_API_KEY || !ALP_API_SECRET) {
    return { available: false, reason: 'missing credentials', positions: [] };
  }
  try {
    const data = await fetchWithTimeout(`${ALP_BASE}/v2/positions`, {
      headers: {
        'APCA-API-KEY-ID': ALP_API_KEY,
        'APCA-API-SECRET-KEY': ALP_API_SECRET,
      },
    });

    const positions = (Array.isArray(data) ? data : []).map(p => ({
      symbol: p.symbol,
      qty: Number(p.qty || 0),
      side: Number(p.qty || 0) >= 0 ? 'long' : 'short',
      marketValue: Number(p.market_value || 0),
      unrealizedPl: Number(p.unrealized_pl || 0),
      currentPrice: Number(p.current_price || 0),
    }));

    return { available: true, positions };
  } catch (err) {
    return { available: false, reason: err?.message || String(err), positions: [] };
  }
}

// ─── Local State Readers ────────────────────────────────────────────────────

function getLocalPositions() {
  if (!riskManager) return {};
  try {
    const exposure = riskManager.getPortfolioExposure();
    const state = riskManager.loadRiskState ? riskManager.loadRiskState() : null;
    return {
      positions: state?.positions || {},
      exposure,
    };
  } catch { return {}; }
}

function getJournalOpenTrades() {
  if (!tradeJournal) return [];
  try {
    const dataDir = path.resolve(process.cwd(), 'data');
    const journalPath = path.join(dataDir, 'trade-journal.json');
    if (!fs.existsSync(journalPath)) return [];
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    // Open trades: no outcome yet
    return (journal.trades || []).filter(t => !t.outcome);
  } catch { return []; }
}

// ─── Reconciliation Logic ───────────────────────────────────────────────────

function comparePositions(exchangeData, localPositions, openTrades) {
  const discrepancies = [];
  const localByVenueAsset = {};

  // Index local positions by venue+asset
  for (const [key, pos] of Object.entries(localPositions || {})) {
    const k = `${pos.venue}:${pos.asset}`;
    if (!localByVenueAsset[k]) localByVenueAsset[k] = { totalUsd: 0, positions: [] };
    localByVenueAsset[k].totalUsd += Math.abs(pos.usdSize || 0);
    localByVenueAsset[k].positions.push({ ...pos, key });
  }

  // Check Coinbase balances against local state
  if (exchangeData.coinbase?.available) {
    for (const [asset, info] of Object.entries(exchangeData.coinbase.balances)) {
      if (asset === 'USD') continue; // Skip cash
      const localKey = `coinbase:${asset}`;
      const localUsd = localByVenueAsset[localKey]?.totalUsd || 0;

      // We can't precisely compare USD value without current price,
      // but we can flag phantom locals (local says we have position, exchange says 0)
      if (info.total <= 0.000001 && localUsd > TOLERANCE_USD) {
        discrepancies.push({
          type: 'phantom_local',
          venue: 'coinbase',
          asset,
          detail: `Local state shows $${localUsd.toFixed(2)} position but exchange balance is 0`,
          localUsd,
          exchangeAmount: info.total,
        });
      }
    }

    // Check for local positions on Coinbase with no exchange balance
    for (const [k, v] of Object.entries(localByVenueAsset)) {
      if (!k.startsWith('coinbase:')) continue;
      const asset = k.split(':')[1];
      if (asset === 'USD') continue;
      const exchangeBalance = exchangeData.coinbase.balances[asset]?.total || 0;
      if (v.totalUsd > TOLERANCE_USD && exchangeBalance <= 0.000001) {
        // Only add if not already caught above
        const already = discrepancies.find(d => d.venue === 'coinbase' && d.asset === asset);
        if (!already) {
          discrepancies.push({
            type: 'phantom_local',
            venue: 'coinbase',
            asset,
            detail: `Local state shows $${v.totalUsd.toFixed(2)} but no exchange balance`,
            localUsd: v.totalUsd,
            exchangeAmount: 0,
          });
        }
      }
    }
  }

  // Check Kraken balances against local state
  if (exchangeData.kraken?.available) {
    for (const [k, v] of Object.entries(localByVenueAsset)) {
      if (!k.startsWith('kraken:')) continue;
      const asset = k.split(':')[1];
      const exchangeBalance = exchangeData.kraken.balances[asset]?.balance || 0;
      if (v.totalUsd > TOLERANCE_USD && exchangeBalance <= 0.000001) {
        discrepancies.push({
          type: 'phantom_local',
          venue: 'kraken',
          asset,
          detail: `Local state shows $${v.totalUsd.toFixed(2)} but Kraken balance is 0`,
          localUsd: v.totalUsd,
          exchangeAmount: 0,
        });
      }
    }
  }

  // Check Alpaca positions
  if (exchangeData.alpaca?.available) {
    const alpacaPositions = exchangeData.alpaca.positions || [];
    for (const pos of alpacaPositions) {
      const localKey = `alpaca:${pos.symbol}`;
      const localUsd = localByVenueAsset[localKey]?.totalUsd || 0;
      const exchangeUsd = Math.abs(pos.marketValue);

      if (Math.abs(exchangeUsd - localUsd) > TOLERANCE_USD) {
        discrepancies.push({
          type: 'size_mismatch',
          venue: 'alpaca',
          asset: pos.symbol,
          detail: `Exchange: $${exchangeUsd.toFixed(2)} vs local: $${localUsd.toFixed(2)} (diff: $${Math.abs(exchangeUsd - localUsd).toFixed(2)})`,
          exchangeUsd,
          localUsd,
        });
      }
    }

    // Check for local alpaca positions with no exchange match
    for (const [k, v] of Object.entries(localByVenueAsset)) {
      if (!k.startsWith('alpaca:')) continue;
      const symbol = k.split(':')[1];
      const exchangePos = alpacaPositions.find(p => p.symbol === symbol);
      if (v.totalUsd > TOLERANCE_USD && !exchangePos) {
        discrepancies.push({
          type: 'phantom_local',
          venue: 'alpaca',
          asset: symbol,
          detail: `Local state shows $${v.totalUsd.toFixed(2)} but no Alpaca position`,
          localUsd: v.totalUsd,
          exchangeUsd: 0,
        });
      }
    }
  }

  // Check for orphaned journal trades (open > 24h with no risk manager position)
  const dayMs = 24 * 60 * 60 * 1000;
  for (const trade of openTrades) {
    const age = Date.now() - (trade.entryTs || trade.ts || 0);
    if (age > dayMs) {
      const matchKey = Object.keys(localPositions || {}).find(k => {
        const pos = localPositions[k];
        return pos.asset === trade.asset && pos.venue === trade.venue;
      });
      if (!matchKey) {
        discrepancies.push({
          type: 'orphan_journal_trade',
          venue: trade.venue,
          asset: trade.asset,
          detail: `Journal trade ${trade.id} open for ${Math.round(age / 3600000)}h with no matching risk-manager position`,
          tradeId: trade.id,
          ageHours: Math.round(age / 3600000),
        });
      }
    }
  }

  return discrepancies;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!ENABLED) {
    console.log(JSON.stringify({ status: 'disabled', reason: 'RECONCILER_ENABLED=false' }));
    process.exit(0);
  }

  const startMs = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log('  POSITION RECONCILIATION AGENT');
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}\n`);

  // Fetch exchange data in parallel
  console.log('  Fetching exchange balances...');
  const [coinbase, kraken, alpaca] = await Promise.all([
    fetchCoinbaseBalances(),
    fetchKrakenBalances(),
    fetchAlpacaPositions(),
  ]);

  const exchangeData = { coinbase, kraken, alpaca };

  // Report exchange connectivity
  const venues = [
    { name: 'Coinbase', data: coinbase },
    { name: 'Kraken', data: kraken },
    { name: 'Alpaca', data: alpaca },
  ];
  for (const v of venues) {
    const status = v.data.available ? 'CONNECTED' : `UNAVAILABLE (${v.data.reason || 'no credentials'})`;
    console.log(`  [${v.data.available ? 'OK' : '--'}] ${v.name}: ${status}`);
  }

  // Get local state
  const local = getLocalPositions();
  const openTrades = getJournalOpenTrades();
  console.log(`\n  Local positions: ${Object.keys(local.positions || {}).length}`);
  console.log(`  Open journal trades: ${openTrades.length}`);

  // Compare
  const discrepancies = comparePositions(exchangeData, local.positions, openTrades);
  const duration = Date.now() - startMs;

  // Build report
  const report = {
    ts: new Date().toISOString(),
    duration_ms: duration,
    exchanges: {
      coinbase: { connected: coinbase.available, assetCount: Object.keys(coinbase.balances || {}).length },
      kraken: { connected: kraken.available, assetCount: Object.keys(kraken.balances || {}).length },
      alpaca: { connected: alpaca.available, positionCount: (alpaca.positions || []).length },
    },
    local: {
      riskManagerPositions: Object.keys(local.positions || {}).length,
      openJournalTrades: openTrades.length,
    },
    discrepancies,
    discrepancyCount: discrepancies.length,
    clean: discrepancies.length === 0,
  };

  // Print results
  console.log(`\n${'='.repeat(60)}`);
  if (discrepancies.length === 0) {
    console.log('  RECONCILIATION: CLEAN — no discrepancies found');
  } else {
    console.log(`  RECONCILIATION: ${discrepancies.length} DISCREPANCY(IES) FOUND`);
    for (const d of discrepancies) {
      console.log(`    [${d.type}] ${d.venue}/${d.asset}: ${d.detail}`);
    }
  }
  console.log(`  Duration: ${duration}ms`);
  console.log(`${'='.repeat(60)}\n`);

  // Save state
  const state = loadState();
  state.history.push({
    ts: report.ts,
    discrepancyCount: discrepancies.length,
    clean: report.clean,
    duration_ms: duration,
  });
  if (state.history.length > 200) state.history = state.history.slice(-200);
  state.lastRun = report;
  state.discrepancyCount = discrepancies.length;
  saveState(state);

  // Publish to signal bus
  if (signalBus) {
    try {
      signalBus.publish({
        type: 'reconciliation_result',
        source: 'reconciliation-agent',
        confidence: 1.0,
        payload: {
          clean: report.clean,
          discrepancyCount: report.discrepancyCount,
          types: discrepancies.map(d => d.type),
        },
        ttlMs: 12 * 60 * 60 * 1000,
      });
    } catch { /* ignore */ }
  }

  // Alert on discrepancies
  if (discrepancies.length > 0) {
    const details = discrepancies.map(d => `  ${d.type}: ${d.venue}/${d.asset} — ${d.detail}`).join('\n');
    await sendAlert(`**Position Reconciliation Alert**\n${discrepancies.length} discrepancy(ies) found:\n${details}`);
  }

  // Output full report
  console.log(JSON.stringify(report, null, 2));

  process.exit(discrepancies.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[reconciler] fatal:', err?.message || err);
  process.exit(1);
});
