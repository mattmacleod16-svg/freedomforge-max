/**
 * Liquidation Guardian — Monitors margin health across all venues,
 * auto-closes dangerous positions, and blocks new margin trades when
 * utilization is high.
 *
 * Runs as a standalone watchdog (via systemd timer) AND is imported
 * by engines to gate every trade.
 *
 * Capabilities:
 *   1. Polls Coinbase futures balance_summary + positions every cycle
 *   2. Polls Kraken trade balance + open positions every cycle
 *   3. Computes margin utilization % and liquidation buffer
 *   4. Auto-closes worst-performing position when buffer is critical
 *   5. Blocks ALL new futures/margin trades when utilization > threshold
 *   6. Publishes risk alerts to signal bus
 *   7. Persistent state tracking for trend detection (worsening margin)
 *
 * Thresholds (configurable via env):
 *   GUARDIAN_WARN_MARGIN_PCT=70     — log warning
 *   GUARDIAN_BLOCK_MARGIN_PCT=80    — block new margin trades
 *   GUARDIAN_REDUCE_MARGIN_PCT=85   — auto-reduce position size
 *   GUARDIAN_EMERGENCY_MARGIN_PCT=90 — auto-close worst position
 *   GUARDIAN_LIQUIDATION_BUFFER_MIN=25 — min $ buffer before forced close
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load env
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
  dotenv.config();
} catch {}

// ─── Configuration ───────────────────────────────────────────────────────────

const STATE_FILE = path.resolve(process.cwd(), process.env.GUARDIAN_STATE_FILE || 'data/liquidation-guardian-state.json');
const WARN_MARGIN_PCT = Number(process.env.GUARDIAN_WARN_MARGIN_PCT || 70);
const BLOCK_MARGIN_PCT = Number(process.env.GUARDIAN_BLOCK_MARGIN_PCT || 80);
const REDUCE_MARGIN_PCT = Number(process.env.GUARDIAN_REDUCE_MARGIN_PCT || 85);
const EMERGENCY_MARGIN_PCT = Number(process.env.GUARDIAN_EMERGENCY_MARGIN_PCT || 90);
const MIN_LIQUIDATION_BUFFER_USD = Number(process.env.GUARDIAN_LIQUIDATION_BUFFER_MIN || 25);
const CHECK_INTERVAL_SEC = Number(process.env.GUARDIAN_CHECK_INTERVAL || 120);
const REQUEST_TIMEOUT_MS = 15000;

// Coinbase config
const CB_API_KEY = (process.env.COINBASE_API_KEY || '').trim();
const CB_API_SECRET = (process.env.COINBASE_API_SECRET || '').trim();
const CB_CDP_BASE = (process.env.COINBASE_CDP_BASE_URL || 'https://api.coinbase.com').replace(/\/$/, '');

// Kraken config
const K_API_KEY = (process.env.KRAKEN_API_KEY || '').trim();
const K_API_SECRET = (process.env.KRAKEN_API_SECRET || '').trim();
const K_BASE = (process.env.KRAKEN_BASE_URL || 'https://api.kraken.com').replace(/\/$/, '');

// ─── HTTP Helpers ────────────────────────────────────────────────────────────

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
    try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
  } finally { clearTimeout(timeout); }
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
  const res = await fetchJson(`${K_BASE}${pathname}`, {
    method: 'POST',
    headers: {
      'API-Key': K_API_KEY,
      'API-Sign': signature,
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    },
    body: body.toString(),
  });
  return res;
}

// ─── State Management ────────────────────────────────────────────────────────

function loadGuardianState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {}
  return {
    lastCheck: 0,
    coinbase: { marginPct: 0, liquidationBuffer: 999, positions: [], checksAboveWarn: 0 },
    kraken: { marginPct: 0, marginLevel: null, positions: [], checksAboveWarn: 0 },
    actions: [],
    emergencyCloses: 0,
    blockedTrades: 0,
  };
}

function saveGuardianState(state) {
  state.lastCheck = Date.now();
  if (state.actions.length > 200) state.actions = state.actions.slice(-200);
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Coinbase Margin Check ───────────────────────────────────────────────────

async function checkCoinbaseMargin() {
  const result = {
    healthy: true,
    marginPct: 0,
    liquidationBuffer: 999,
    totalBalance: 0,
    initialMargin: 0,
    unrealizedPnl: 0,
    availableMargin: 0,
    liquidationThreshold: 0,
    positions: [],
    warnings: [],
  };

  if (!CB_API_KEY || !CB_API_SECRET) {
    result.warnings.push('Coinbase credentials not configured');
    return result;
  }

  try {
    // Get balance summary
    const bal = await cbPrivate('GET', '/api/v3/brokerage/cfm/balance_summary');
    const bs = bal?.balance_summary;
    if (!bs) {
      result.warnings.push('Could not fetch Coinbase futures balance summary');
      return result;
    }

    result.totalBalance = parseFloat(bs.total_usd_balance?.value || 0);
    result.initialMargin = parseFloat(bs.initial_margin?.value || 0);
    result.availableMargin = parseFloat(bs.available_margin?.value || 0);
    result.unrealizedPnl = parseFloat(bs.unrealized_pnl?.value || 0);
    result.liquidationThreshold = parseFloat(bs.liquidation_threshold?.value || 0);
    result.liquidationBuffer = parseFloat(bs.liquidation_buffer_amount?.value || 0);
    const bufferPct = parseFloat(bs.liquidation_buffer_percentage || 0);

    // Calculate margin utilization
    if (result.totalBalance > 0 && result.initialMargin > 0) {
      result.marginPct = (result.initialMargin / result.totalBalance) * 100;
    }

    // Get positions
    const pos = await cbPrivate('GET', '/api/v3/brokerage/cfm/positions');
    if (pos?.positions && pos.positions.length > 0) {
      for (const p of pos.positions) {
        result.positions.push({
          productId: p.product_id,
          side: p.side,
          contracts: parseInt(p.number_of_contracts || 0),
          currentPrice: parseFloat(p.current_price || 0),
          unrealizedPnl: parseFloat(p.unrealized_pnl || 0),
          entryPrice: parseFloat(p.avg_entry_price || p.entry_price || 0),
        });
      }
    }

    // Check thresholds
    if (result.marginPct >= EMERGENCY_MARGIN_PCT) {
      result.healthy = false;
      result.warnings.push(`EMERGENCY: Coinbase margin at ${result.marginPct.toFixed(1)}% (>=${EMERGENCY_MARGIN_PCT}%)`);
    } else if (result.marginPct >= REDUCE_MARGIN_PCT) {
      result.healthy = false;
      result.warnings.push(`CRITICAL: Coinbase margin at ${result.marginPct.toFixed(1)}% (>=${REDUCE_MARGIN_PCT}%) — will reduce positions`);
    } else if (result.marginPct >= BLOCK_MARGIN_PCT) {
      result.warnings.push(`HIGH: Coinbase margin at ${result.marginPct.toFixed(1)}% (>=${BLOCK_MARGIN_PCT}%) — blocking new trades`);
    } else if (result.marginPct >= WARN_MARGIN_PCT) {
      result.warnings.push(`WARN: Coinbase margin at ${result.marginPct.toFixed(1)}% (>=${WARN_MARGIN_PCT}%)`);
    }

    if (result.liquidationBuffer < MIN_LIQUIDATION_BUFFER_USD && result.positions.length > 0) {
      result.healthy = false;
      result.warnings.push(`DANGER: Liquidation buffer only $${result.liquidationBuffer.toFixed(2)} (min $${MIN_LIQUIDATION_BUFFER_USD})`);
    }

  } catch (err) {
    result.warnings.push(`Coinbase check failed: ${err.message}`);
  }

  return result;
}

// ─── Kraken Margin Check ─────────────────────────────────────────────────────

async function checkKrakenMargin() {
  const result = {
    healthy: true,
    marginPct: 0,
    marginLevel: null,
    equity: 0,
    marginUsed: 0,
    freeMargin: 0,
    unrealizedPnl: 0,
    positions: [],
    warnings: [],
  };

  if (!K_API_KEY || !K_API_SECRET) {
    result.warnings.push('Kraken credentials not configured');
    return result;
  }

  try {
    // Trade balance (margin summary)
    const tb = await krakenPrivate('/0/private/TradeBalance', { asset: 'ZUSD' });
    const r = tb?.result;
    if (!r) {
      result.warnings.push('Could not fetch Kraken trade balance');
      return result;
    }

    result.equity = parseFloat(r.e || 0);
    result.marginUsed = parseFloat(r.m || 0);
    result.freeMargin = parseFloat(r.mf || 0);
    result.unrealizedPnl = parseFloat(r.n || 0);
    const mlStr = r.ml;
    result.marginLevel = mlStr ? parseFloat(mlStr) : null;

    // Calculate margin utilization
    if (result.equity > 0 && result.marginUsed > 0) {
      result.marginPct = (result.marginUsed / result.equity) * 100;
    }

    // Get open positions
    const pos = await krakenPrivate('/0/private/OpenPositions');
    if (pos?.result && Object.keys(pos.result).length > 0) {
      for (const [id, p] of Object.entries(pos.result)) {
        result.positions.push({
          id,
          pair: p.pair,
          type: p.type,
          volume: parseFloat(p.vol || 0),
          cost: parseFloat(p.cost || 0),
          pnl: parseFloat(p.net || 0),
          margin: parseFloat(p.margin || 0),
          value: parseFloat(p.value || 0),
        });
      }
    }

    // Check thresholds
    if (result.marginPct >= EMERGENCY_MARGIN_PCT) {
      result.healthy = false;
      result.warnings.push(`EMERGENCY: Kraken margin at ${result.marginPct.toFixed(1)}% (>=${EMERGENCY_MARGIN_PCT}%)`);
    } else if (result.marginPct >= REDUCE_MARGIN_PCT) {
      result.healthy = false;
      result.warnings.push(`CRITICAL: Kraken margin at ${result.marginPct.toFixed(1)}% (>=${REDUCE_MARGIN_PCT}%) — will reduce positions`);
    } else if (result.marginPct >= BLOCK_MARGIN_PCT) {
      result.warnings.push(`HIGH: Kraken margin at ${result.marginPct.toFixed(1)}% (>=${BLOCK_MARGIN_PCT}%) — blocking new trades`);
    } else if (result.marginPct >= WARN_MARGIN_PCT) {
      result.warnings.push(`WARN: Kraken margin at ${result.marginPct.toFixed(1)}% (>=${WARN_MARGIN_PCT}%)`);
    }

    // Kraken margin level < 100% = margin call territory
    if (result.marginLevel !== null && result.marginLevel < 120 && result.marginUsed > 0) {
      result.healthy = false;
      result.warnings.push(`DANGER: Kraken margin level at ${result.marginLevel.toFixed(1)}% (< 120% danger zone)`);
    }

  } catch (err) {
    result.warnings.push(`Kraken check failed: ${err.message}`);
  }

  return result;
}

// ─── Emergency Position Reduction ────────────────────────────────────────────

/**
 * Close the worst-performing Coinbase futures position to free margin.
 */
async function emergencyCloseCoinbase(positions) {
  if (!positions || positions.length === 0) return { closed: false, reason: 'no positions' };

  // Sort by worst unrealized PnL first (close the biggest loser)
  const sorted = [...positions].sort((a, b) => a.unrealizedPnl - b.unrealizedPnl);
  const worst = sorted[0];

  console.log(`[GUARDIAN] EMERGENCY CLOSE: ${worst.productId} ${worst.side} ${worst.contracts} contracts (pnl: $${worst.unrealizedPnl})`);

  // Close by placing opposite market order
  const closeSide = worst.side === 'LONG' ? 'SELL' : 'BUY';
  const clientOrderId = crypto.randomUUID();

  try {
    const payload = {
      client_order_id: clientOrderId,
      product_id: worst.productId,
      side: closeSide,
      order_configuration: {
        market_market_ioc: {
          base_size: String(worst.contracts),
        },
      },
    };

    const result = await cbPrivate('POST', '/api/v3/brokerage/orders', payload);
    console.log(`[GUARDIAN] Emergency close result:`, JSON.stringify(result).slice(0, 300));

    return {
      closed: true,
      position: worst,
      closeSide,
      orderId: result?.success_response?.order_id || null,
      result,
    };
  } catch (err) {
    console.error(`[GUARDIAN] Emergency close FAILED: ${err.message}`);
    return { closed: false, error: err.message };
  }
}

/**
 * Close the worst-performing Kraken margin position to free margin.
 */
async function emergencyCloseKraken(positions) {
  if (!positions || positions.length === 0) return { closed: false, reason: 'no positions' };

  // Sort by worst PnL
  const sorted = [...positions].sort((a, b) => a.pnl - b.pnl);
  const worst = sorted[0];

  console.log(`[GUARDIAN] EMERGENCY CLOSE: Kraken ${worst.pair} ${worst.type} vol:${worst.volume} (pnl: $${worst.pnl})`);

  // Close by placing opposite order
  const closeSide = worst.type === 'buy' ? 'sell' : 'buy';

  try {
    const result = await krakenPrivate('/0/private/AddOrder', {
      pair: worst.pair,
      type: closeSide,
      ordertype: 'market',
      volume: String(worst.volume),
      leverage: '2', // match typical leverage
      reduce_only: 'true',
    });

    console.log(`[GUARDIAN] Kraken emergency close result:`, JSON.stringify(result).slice(0, 300));

    return {
      closed: true,
      position: worst,
      closeSide,
      result: result?.result || result,
    };
  } catch (err) {
    console.error(`[GUARDIAN] Kraken emergency close FAILED: ${err.message}`);
    return { closed: false, error: err.message };
  }
}

// ─── Trade Gating (imported by engines) ──────────────────────────────────────

/**
 * Quick margin check — blocks new trades if margin utilization is too high.
 * Called by engines before placing any order.
 * Returns { allowed: boolean, reason: string, venue: string, marginPct: number }
 */
function shouldAllowNewTrade(venue, opts = {}) {
  const state = loadGuardianState();
  const venueState = venue === 'kraken' ? state.kraken : state.coinbase;
  const tradeType = opts.tradeType || 'spot'; // 'spot' | 'futures' | 'margin'

  // If state is stale (> 10 min), allow but warn
  const staleSec = (Date.now() - state.lastCheck) / 1000;
  if (staleSec > 600) {
    return { allowed: true, reason: 'guardian-state-stale', venue, marginPct: venueState?.marginPct || 0 };
  }

  const marginPct = venueState?.marginPct || 0;
  const liqBuffer = venue === 'coinbase' ? (venueState?.liquidationBuffer || 999) : 999;

  // ═══ SPOT TRADES bypass futures margin gate ═══
  // Coinbase spot uses available cash, not futures margin.
  // Only block spot trades if there's literally no balance.
  if (tradeType === 'spot' && venue === 'coinbase') {
    const balance = venueState?.totalBalance || 0;
    const margin = venueState?.initialMargin || 0;
    const freeForSpot = balance - margin; // rough cash available after futures margin
    if (freeForSpot < 5) {
      return { allowed: false, reason: `spot-insufficient-free-balance: $${freeForSpot.toFixed(2)}`, venue, marginPct };
    }
    return { allowed: true, reason: 'spot-ok', venue, marginPct };
  }

  // Block futures/margin trades if above threshold
  if (marginPct >= BLOCK_MARGIN_PCT) {
    return {
      allowed: false,
      reason: `margin-too-high: ${marginPct.toFixed(1)}% >= ${BLOCK_MARGIN_PCT}%`,
      venue, marginPct,
    };
  }

  // Block if liquidation buffer is critically low
  if (liqBuffer < MIN_LIQUIDATION_BUFFER_USD) {
    return {
      allowed: false,
      reason: `liquidation-buffer-low: $${liqBuffer.toFixed(2)} < $${MIN_LIQUIDATION_BUFFER_USD}`,
      venue, marginPct,
    };
  }

  return { allowed: true, reason: 'ok', venue, marginPct };
}

/**
 * Check if a specific venue has any margin/futures positions at all.
 */
function hasOpenMarginPositions(venue) {
  const state = loadGuardianState();
  const venueState = venue === 'kraken' ? state.kraken : state.coinbase;
  return (venueState?.positions?.length || 0) > 0;
}

/**
 * Get the current margin health summary for a venue.
 */
function getMarginHealth(venue) {
  const state = loadGuardianState();
  if (venue === 'kraken') return state.kraken;
  if (venue === 'coinbase') return state.coinbase;
  return { marginPct: 0, positions: [], healthy: true };
}

// ─── Main Guardian Cycle ─────────────────────────────────────────────────────

async function runGuardianCycle() {
  console.log(`[GUARDIAN] === Liquidation Guardian Check @ ${new Date().toISOString()} ===`);

  const state = loadGuardianState();
  const actions = [];

  // ── 1. Check Coinbase ──
  const cb = await checkCoinbaseMargin();
  state.coinbase = {
    marginPct: cb.marginPct,
    liquidationBuffer: cb.liquidationBuffer,
    totalBalance: cb.totalBalance,
    initialMargin: cb.initialMargin,
    unrealizedPnl: cb.unrealizedPnl,
    positions: cb.positions,
    checksAboveWarn: cb.marginPct >= WARN_MARGIN_PCT
      ? (state.coinbase?.checksAboveWarn || 0) + 1
      : 0,
    healthy: cb.healthy,
  };

  if (cb.warnings.length > 0) {
    for (const w of cb.warnings) console.log(`[GUARDIAN] ${w}`);
  } else {
    console.log(`[GUARDIAN] Coinbase: margin ${cb.marginPct.toFixed(1)}% | buffer $${cb.liquidationBuffer.toFixed(2)} | ${cb.positions.length} positions | OK`);
  }

  // Emergency action for Coinbase
  if (cb.marginPct >= EMERGENCY_MARGIN_PCT || cb.liquidationBuffer < MIN_LIQUIDATION_BUFFER_USD) {
    if (cb.positions.length > 0) {
      console.log(`[GUARDIAN] TAKING EMERGENCY ACTION on Coinbase — closing worst position`);
      const closeResult = await emergencyCloseCoinbase(cb.positions);
      actions.push({ venue: 'coinbase', action: 'emergency_close', ts: Date.now(), ...closeResult });
      state.emergencyCloses = (state.emergencyCloses || 0) + 1;
    }
  } else if (cb.marginPct >= REDUCE_MARGIN_PCT && cb.positions.length > 1) {
    // If multiple positions and margin is critical, close the worst one
    console.log(`[GUARDIAN] Margin critical (${cb.marginPct.toFixed(1)}%) — reducing Coinbase positions`);
    const closeResult = await emergencyCloseCoinbase(cb.positions);
    actions.push({ venue: 'coinbase', action: 'reduce_position', ts: Date.now(), ...closeResult });
    state.emergencyCloses = (state.emergencyCloses || 0) + 1;
  }

  // ── 2. Check Kraken ──
  const kr = await checkKrakenMargin();
  state.kraken = {
    marginPct: kr.marginPct,
    marginLevel: kr.marginLevel,
    equity: kr.equity,
    marginUsed: kr.marginUsed,
    freeMargin: kr.freeMargin,
    unrealizedPnl: kr.unrealizedPnl,
    positions: kr.positions,
    checksAboveWarn: kr.marginPct >= WARN_MARGIN_PCT
      ? (state.kraken?.checksAboveWarn || 0) + 1
      : 0,
    healthy: kr.healthy,
  };

  if (kr.warnings.length > 0) {
    for (const w of kr.warnings) console.log(`[GUARDIAN] ${w}`);
  } else {
    console.log(`[GUARDIAN] Kraken: margin ${kr.marginPct.toFixed(1)}% | equity $${kr.equity.toFixed(2)} | ${kr.positions.length} positions | OK`);
  }

  // Emergency action for Kraken
  if (kr.marginPct >= EMERGENCY_MARGIN_PCT || (kr.marginLevel !== null && kr.marginLevel < 120 && kr.marginUsed > 0)) {
    if (kr.positions.length > 0) {
      console.log(`[GUARDIAN] TAKING EMERGENCY ACTION on Kraken — closing worst position`);
      const closeResult = await emergencyCloseKraken(kr.positions);
      actions.push({ venue: 'kraken', action: 'emergency_close', ts: Date.now(), ...closeResult });
      state.emergencyCloses = (state.emergencyCloses || 0) + 1;
    }
  } else if (kr.marginPct >= REDUCE_MARGIN_PCT && kr.positions.length > 1) {
    console.log(`[GUARDIAN] Margin critical (${kr.marginPct.toFixed(1)}%) — reducing Kraken positions`);
    const closeResult = await emergencyCloseKraken(kr.positions);
    actions.push({ venue: 'kraken', action: 'reduce_position', ts: Date.now(), ...closeResult });
    state.emergencyCloses = (state.emergencyCloses || 0) + 1;
  }

  // ── 3. Publish alerts to signal bus ──
  try {
    const bus = require('./agent-signal-bus');
    const allWarnings = [...cb.warnings, ...kr.warnings];
    if (allWarnings.length > 0) {
      bus.publish({
        type: 'risk_alert',
        source: 'liquidation-guardian',
        confidence: 1.0,
        payload: {
          coinbaseMarginPct: cb.marginPct,
          coinbaseLiqBuffer: cb.liquidationBuffer,
          krakenMarginPct: kr.marginPct,
          krakenMarginLevel: kr.marginLevel,
          warnings: allWarnings,
          actions: actions.length,
        },
        ttlMs: 10 * 60 * 1000,
      });
    }
  } catch {}

  // ── 4. Activate risk manager kill switch if things are really bad ──
  if (!cb.healthy || !kr.healthy) {
    try {
      const riskManager = require('./risk-manager');
      if (cb.marginPct >= EMERGENCY_MARGIN_PCT || (kr.marginLevel !== null && kr.marginLevel < 110)) {
        riskManager.activateKillSwitch(`liquidation-guardian: CB margin ${cb.marginPct.toFixed(1)}%, KR margin ${kr.marginPct.toFixed(1)}%`);
        console.log(`[GUARDIAN] Kill switch ACTIVATED due to critical margin levels`);
      }
    } catch {}
  }

  // Save
  state.actions = [...(state.actions || []), ...actions];
  saveGuardianState(state);

  // Summary
  console.log(`[GUARDIAN] Summary: CB=${cb.marginPct.toFixed(1)}% KR=${kr.marginPct.toFixed(1)}% | positions: CB=${cb.positions.length} KR=${kr.positions.length} | actions: ${actions.length} | emergency_closes_total: ${state.emergencyCloses || 0}`);

  return { coinbase: cb, kraken: kr, actions };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  runGuardianCycle,
  shouldAllowNewTrade,
  hasOpenMarginPositions,
  getMarginHealth,
  checkCoinbaseMargin,
  checkKrakenMargin,
  BLOCK_MARGIN_PCT,
  EMERGENCY_MARGIN_PCT,
};

// ─── CLI Mode ────────────────────────────────────────────────────────────────

if (require.main === module) {
  runGuardianCycle()
    .then(result => {
      console.log('\n[GUARDIAN] Cycle complete.');
    })
    .catch(err => {
      console.error('[GUARDIAN] Fatal error:', err.message);
      process.exit(1);
    });
}
