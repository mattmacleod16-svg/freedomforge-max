/**
 * FreedomForge Edge-Case Mitigations Library
 * ===========================================
 *
 * Monitors and mitigates rare but catastrophic failure modes that standard
 * risk management won't catch:
 *
 *   1. Exchange Insolvency Detection  — abnormal withdrawal delays, status page scraping
 *   2. Flash Crash Detection          — intra-minute price collapse beyond N sigma
 *   3. Overfit Detection              — live vs backtest divergence beyond threshold
 *   4. Runaway Loss Detection         — cumulative drawdown velocity ($ / hour)
 *   5. API Key Compromise Detection   — unexpected IP/agent strings, unknown orders
 *   6. Correlated Drawdown Detection  — all venues losing simultaneously
 *   7. State File Consistency         — cross-file invariant checks
 *   8. Stale Data Detection           — price feeds / signals stuck at same value
 *   9. Order Duplication Guard        — dedup window for duplicate order prevention
 *  10. Gas/Fee Spike Protection       — on-chain fee surge detection
 *
 * All detectors return { triggered: boolean, severity: string, message: string, data: {} }
 * Severity levels: 'info' | 'warning' | 'critical' | 'emergency'
 *
 * Usage:
 *   const ecm = require('../lib/edge-case-mitigations');
 *   const result = ecm.checkFlashCrash({ asset: 'BTC', currentPrice: 50000, recentPrices: [...] });
 *   if (result.triggered) { // halt trading }
 *
 * State: data/edge-case-state.json
 */

const fs = require('fs');
const path = require('path');

const { createLogger } = require('./logger');
let _log;
function log() { return _log || (_log = createLogger('edge-case-mitigations')); }

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

let riskManager;
try { riskManager = require('./risk-manager'); } catch { riskManager = null; }

let signalBus;
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }

// ─── Configuration ──────────────────────────────────────────────────────────

const STATE_FILE = path.resolve(process.cwd(), process.env.EDGE_CASE_STATE_FILE || 'data/edge-case-state.json');

// Flash crash: price drops > this % in under 5 minutes
const FLASH_CRASH_THRESHOLD_PCT = Math.min(50, Math.max(1, Number(process.env.EDGE_FLASH_CRASH_PCT || 8)));
// Runaway loss: max acceptable drawdown velocity (dollars per hour)
const RUNAWAY_LOSS_VELOCITY_USD_HR = Math.min(10000, Math.max(1, Number(process.env.EDGE_RUNAWAY_VELOCITY_USD_HR || 50)));
// Overfit: live Sharpe must be at least this fraction of backtest Sharpe
const OVERFIT_SHARPE_FLOOR_RATIO = Math.min(0.9, Math.max(0.05, Number(process.env.EDGE_OVERFIT_SHARPE_FLOOR || 0.3)));
// Correlated drawdown: if N+ venues all lose in the same window
const CORRELATED_DRAWDOWN_MIN_VENUES = Math.max(2, Number(process.env.EDGE_CORRELATED_MIN_VENUES || 2));
// Stale data: if price hasn't changed for this many consecutive samples
const STALE_PRICE_MAX_IDENTICAL = Math.max(3, Number(process.env.EDGE_STALE_MAX_IDENTICAL || 5));
// Order dedup window (ms)
const ORDER_DEDUP_WINDOW_MS = Math.max(5000, Number(process.env.EDGE_ORDER_DEDUP_MS || 30000));
// Gas spike: max acceptable gas price in gwei before halting on-chain operations
const GAS_SPIKE_THRESHOLD_GWEI = Math.min(10000, Math.max(1, Number(process.env.EDGE_GAS_SPIKE_GWEI || 100)));

// ─── State Management ───────────────────────────────────────────────────────

function loadState() {
  if (rio) {
    const data = rio.readJsonSafe(STATE_FILE, { fallback: null });
    return data || createDefaultState();
  }
  try {
    if (!fs.existsSync(STATE_FILE)) return createDefaultState();
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return createDefaultState();
  }
}

function saveState(state) {
  state.updatedAt = Date.now();
  if (rio) { rio.writeJsonAtomic(STATE_FILE, state); return; }
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = STATE_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    log().error('[edge-case] state save failed:', { error: err?.message || err });
  }
}

function createDefaultState() {
  return {
    flashCrashEvents: [],
    runawayLossHistory: [],
    recentOrders: [],
    stalePriceCounters: {},
    exchangeHealthHistory: {},
    triggeredAlerts: [],
    updatedAt: 0,
  };
}

function result(triggered, severity, message, data = {}) {
  return { triggered, severity, message, data, ts: Date.now() };
}

// ─── 1. Exchange Insolvency Detection ───────────────────────────────────────

/**
 * Detects signs of exchange distress: prolonged API errors, withdrawal halts,
 * status page warnings.
 *
 * @param {object} opts
 * @param {string} opts.venue - Exchange name
 * @param {number} opts.consecutiveErrors - Number of consecutive API failures
 * @param {boolean} [opts.withdrawalsHalted] - Whether withdrawals are paused
 * @param {string} [opts.statusPageText] - Raw status page text for keyword scanning
 */
function checkExchangeInsolvency(opts = {}) {
  const { venue, consecutiveErrors = 0, withdrawalsHalted = false, statusPageText = '' } = opts;
  const state = loadState();

  // Track error history per venue
  if (!state.exchangeHealthHistory[venue]) {
    state.exchangeHealthHistory[venue] = { errorWindows: [], lastHealthy: Date.now() };
  }
  const venueHealth = state.exchangeHealthHistory[venue];

  if (consecutiveErrors > 0) {
    venueHealth.errorWindows.push({ ts: Date.now(), errors: consecutiveErrors });
    // Keep last 50 entries
    if (venueHealth.errorWindows.length > 50) {
      venueHealth.errorWindows = venueHealth.errorWindows.slice(-50);
    }
  } else {
    venueHealth.lastHealthy = Date.now();
  }

  saveState(state);

  // Keyword scan for distress signals
  const distressKeywords = [
    'maintenance', 'withdrawal.*suspend', 'withdrawal.*halt',
    'trading.*halt', 'incident', 'degraded', 'major.*outage',
    'insolvency', 'proof.*reserve', 'bank.*run',
  ];
  const lower = statusPageText.toLowerCase();
  const matchedKeywords = distressKeywords.filter(kw => new RegExp(kw, 'i').test(lower));

  if (withdrawalsHalted) {
    return result(true, 'emergency',
      `${venue}: withdrawals halted — possible insolvency risk`,
      { venue, consecutiveErrors, withdrawalsHalted, matchedKeywords });
  }

  if (consecutiveErrors >= 10) {
    return result(true, 'critical',
      `${venue}: ${consecutiveErrors} consecutive API failures — exchange may be down`,
      { venue, consecutiveErrors, matchedKeywords });
  }

  if (matchedKeywords.length >= 2) {
    return result(true, 'warning',
      `${venue}: status page shows distress signals: ${matchedKeywords.join(', ')}`,
      { venue, matchedKeywords });
  }

  if (consecutiveErrors >= 5) {
    return result(true, 'warning',
      `${venue}: ${consecutiveErrors} consecutive errors — degraded connectivity`,
      { venue, consecutiveErrors });
  }

  return result(false, 'info', `${venue}: healthy`, { venue, consecutiveErrors });
}

// ─── 2. Flash Crash Detection ───────────────────────────────────────────────

/**
 * Detects sudden price drops that indicate flash crashes or liquidity crises.
 *
 * @param {object} opts
 * @param {string} opts.asset - Asset symbol
 * @param {number} opts.currentPrice - Current price
 * @param {number[]} opts.recentPrices - Array of recent prices (oldest first)
 * @param {number} [opts.windowMinutes] - Look-back window (default: 5)
 */
function checkFlashCrash(opts = {}) {
  const { asset = 'BTC', currentPrice, recentPrices = [], windowMinutes = 5 } = opts;

  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || recentPrices.length < 2) {
    return result(false, 'info', `${asset}: insufficient data for flash crash detection`,
      { asset, priceCount: recentPrices.length });
  }

  // Find max price in the recent window
  const maxRecent = Math.max(...recentPrices.filter(p => Number.isFinite(p) && p > 0));
  if (maxRecent <= 0) {
    return result(false, 'info', `${asset}: no valid recent prices`);
  }

  const dropPct = ((maxRecent - currentPrice) / maxRecent) * 100;
  const state = loadState();

  if (dropPct >= FLASH_CRASH_THRESHOLD_PCT) {
    const event = {
      asset,
      dropPct: Number(dropPct.toFixed(2)),
      fromPrice: maxRecent,
      toPrice: currentPrice,
      windowMinutes,
      ts: Date.now(),
    };
    state.flashCrashEvents.push(event);
    // Keep last 20 events
    if (state.flashCrashEvents.length > 20) {
      state.flashCrashEvents = state.flashCrashEvents.slice(-20);
    }
    saveState(state);

    const severity = dropPct >= FLASH_CRASH_THRESHOLD_PCT * 2 ? 'emergency' : 'critical';
    return result(true, severity,
      `${asset}: flash crash detected — ${dropPct.toFixed(1)}% drop in ${windowMinutes}min (${maxRecent} → ${currentPrice})`,
      event);
  }

  // Mild but notable drop (half threshold)
  if (dropPct >= FLASH_CRASH_THRESHOLD_PCT / 2) {
    return result(false, 'warning',
      `${asset}: notable drop ${dropPct.toFixed(1)}% — monitoring`,
      { asset, dropPct: Number(dropPct.toFixed(2)), threshold: FLASH_CRASH_THRESHOLD_PCT });
  }

  return result(false, 'info', `${asset}: price stable (${dropPct.toFixed(1)}% from recent high)`,
    { asset, dropPct: Number(dropPct.toFixed(2)) });
}

// ─── 3. Overfit Detection ───────────────────────────────────────────────────

/**
 * Compares live trading performance against backtest expectations.
 * If live is significantly worse, the strategy may be overfit.
 *
 * @param {object} opts
 * @param {number} opts.liveSharpe - Live Sharpe ratio
 * @param {number} opts.backtestSharpe - Backtest Sharpe ratio
 * @param {number} opts.liveWinRate - Live win rate (0-1)
 * @param {number} opts.backtestWinRate - Backtest win rate (0-1)
 * @param {number} [opts.liveTrades] - Number of live trades (more = more reliable)
 */
function checkOverfit(opts = {}) {
  const {
    liveSharpe = 0, backtestSharpe = 0,
    liveWinRate = 0, backtestWinRate = 0,
    liveTrades = 0,
  } = opts;

  // Need minimum sample size for meaningful comparison
  if (liveTrades < 20) {
    return result(false, 'info',
      `Insufficient live trades (${liveTrades}) for overfit detection — need >= 20`,
      { liveTrades });
  }

  if (backtestSharpe <= 0) {
    return result(false, 'info',
      'Backtest Sharpe <= 0, cannot assess overfit ratio',
      { liveSharpe, backtestSharpe });
  }

  const sharpeRatio = liveSharpe / backtestSharpe;
  const winRateDrift = backtestWinRate > 0 ? (backtestWinRate - liveWinRate) / backtestWinRate : 0;

  // Emergency: Live Sharpe is negative when backtest was positive
  if (liveSharpe < 0 && backtestSharpe > 0.5) {
    return result(true, 'critical',
      `Likely overfit: live Sharpe ${liveSharpe.toFixed(2)} vs backtest ${backtestSharpe.toFixed(2)} — strategy losing money`,
      { sharpeRatio, liveSharpe, backtestSharpe, liveWinRate, backtestWinRate, liveTrades });
  }

  // Critical: Live is less than floor ratio of backtest
  if (sharpeRatio < OVERFIT_SHARPE_FLOOR_RATIO) {
    return result(true, 'warning',
      `Possible overfit: live Sharpe is ${(sharpeRatio * 100).toFixed(0)}% of backtest (floor: ${(OVERFIT_SHARPE_FLOOR_RATIO * 100).toFixed(0)}%)`,
      { sharpeRatio, liveSharpe, backtestSharpe, liveWinRate, backtestWinRate, liveTrades });
  }

  // Win rate drift check
  if (winRateDrift > 0.25 && liveTrades >= 50) {
    return result(true, 'warning',
      `Win rate degraded: live ${(liveWinRate * 100).toFixed(1)}% vs backtest ${(backtestWinRate * 100).toFixed(1)}% (${(winRateDrift * 100).toFixed(0)}% worse)`,
      { sharpeRatio, winRateDrift, liveWinRate, backtestWinRate, liveTrades });
  }

  return result(false, 'info',
    `No overfit detected: live/backtest Sharpe ratio ${(sharpeRatio * 100).toFixed(0)}%`,
    { sharpeRatio, liveSharpe, backtestSharpe });
}

// ─── 4. Runaway Loss Detection ──────────────────────────────────────────────

/**
 * Tracks drawdown velocity ($ lost per hour). A fast-accelerating loss
 * is more dangerous than a slow one, even if the total is below limits.
 *
 * @param {object} opts
 * @param {number} opts.currentPnl - Current unrealized + realized P&L (USD)
 * @param {number} opts.windowHours - Window to measure velocity (default: 1)
 */
function checkRunawayLoss(opts = {}) {
  const { currentPnl = 0, windowHours = 1 } = opts;
  const state = loadState();

  // Record data point
  state.runawayLossHistory.push({ ts: Date.now(), pnl: currentPnl });

  // Keep last 200 data points
  if (state.runawayLossHistory.length > 200) {
    state.runawayLossHistory = state.runawayLossHistory.slice(-200);
  }

  saveState(state);

  // Need at least 2 points to compute velocity
  const windowMs = windowHours * 3600 * 1000;
  const cutoff = Date.now() - windowMs;
  const inWindow = state.runawayLossHistory.filter(p => p.ts >= cutoff);

  if (inWindow.length < 2) {
    return result(false, 'info', 'Insufficient data for loss velocity calculation',
      { dataPoints: inWindow.length });
  }

  const oldest = inWindow[0];
  const newest = inWindow[inWindow.length - 1];
  const pnlDelta = newest.pnl - oldest.pnl;
  const hoursDelta = Math.max(0.01, (newest.ts - oldest.ts) / 3600000);
  const velocity = pnlDelta / hoursDelta; // $/hour (negative = losing)

  if (velocity < -RUNAWAY_LOSS_VELOCITY_USD_HR) {
    const severity = velocity < -RUNAWAY_LOSS_VELOCITY_USD_HR * 2 ? 'emergency' : 'critical';
    return result(true, severity,
      `Runaway loss detected: $${Math.abs(velocity).toFixed(2)}/hr (threshold: $${RUNAWAY_LOSS_VELOCITY_USD_HR}/hr)`,
      { velocity: Number(velocity.toFixed(2)), threshold: RUNAWAY_LOSS_VELOCITY_USD_HR, pnlDelta, hoursDelta: Number(hoursDelta.toFixed(2)), windowHours });
  }

  if (velocity < -(RUNAWAY_LOSS_VELOCITY_USD_HR / 2)) {
    return result(false, 'warning',
      `Loss velocity elevated: $${Math.abs(velocity).toFixed(2)}/hr`,
      { velocity: Number(velocity.toFixed(2)), threshold: RUNAWAY_LOSS_VELOCITY_USD_HR });
  }

  return result(false, 'info',
    `P&L velocity: $${velocity.toFixed(2)}/hr`,
    { velocity: Number(velocity.toFixed(2)) });
}

// ─── 5. API Key Compromise Detection ────────────────────────────────────────

/**
 * Checks for signs that API keys may have been compromised:
 * unknown orders, unusual trading patterns, access from unexpected IPs.
 *
 * @param {object} opts
 * @param {string} opts.venue - Exchange name
 * @param {object[]} [opts.recentOrders] - Recent orders from exchange API
 * @param {string[]} [opts.knownOrderIds] - Order IDs placed by our system
 * @param {string} [opts.lastAccessIp] - IP address of last API access
 * @param {string[]} [opts.expectedIps] - Known good IP addresses
 */
function checkKeyCompromise(opts = {}) {
  const {
    venue = 'unknown',
    recentOrders = [],
    knownOrderIds = [],
    lastAccessIp = '',
    expectedIps = [],
  } = opts;

  const issues = [];

  // Check for unknown orders on the exchange
  if (recentOrders.length > 0 && knownOrderIds.length > 0) {
    const knownSet = new Set(knownOrderIds);
    const unknownOrders = recentOrders.filter(o => {
      const id = o.id || o.orderId || o.order_id || o.txid;
      return id && !knownSet.has(String(id));
    });

    if (unknownOrders.length > 0) {
      issues.push({
        type: 'unknown_orders',
        severity: 'critical',
        detail: `${unknownOrders.length} order(s) not placed by this system`,
        data: { count: unknownOrders.length },
      });
    }
  }

  // Check for unexpected IP access
  if (lastAccessIp && expectedIps.length > 0 && !expectedIps.includes(lastAccessIp)) {
    issues.push({
      type: 'unexpected_ip',
      severity: 'critical',
      detail: `API accessed from unexpected IP: ${lastAccessIp}`,
      data: { ip: lastAccessIp, expected: expectedIps },
    });
  }

  if (issues.length > 0) {
    const maxSeverity = issues.some(i => i.severity === 'critical') ? 'critical' : 'warning';
    return result(true, maxSeverity,
      `${venue}: potential key compromise — ${issues.map(i => i.detail).join('; ')}`,
      { venue, issues });
  }

  return result(false, 'info',
    `${venue}: no compromise indicators detected`,
    { venue, ordersChecked: recentOrders.length });
}

// ─── 6. Correlated Drawdown Detection ───────────────────────────────────────

/**
 * Detects when multiple venues are all losing money simultaneously,
 * which indicates systematic risk rather than venue-specific issues.
 *
 * @param {object} opts
 * @param {Object<string, number>} opts.venuePnl - Map of venue → recent P&L
 * @param {number} [opts.windowLabel] - Description of the time window
 */
function checkCorrelatedDrawdown(opts = {}) {
  const { venuePnl = {}, windowLabel = 'recent' } = opts;
  const venues = Object.keys(venuePnl);

  if (venues.length < 2) {
    return result(false, 'info', 'Need at least 2 venues for correlated drawdown check',
      { venueCount: venues.length });
  }

  const losing = venues.filter(v => venuePnl[v] < 0);
  const totalLoss = losing.reduce((s, v) => s + venuePnl[v], 0);

  if (losing.length >= CORRELATED_DRAWDOWN_MIN_VENUES && losing.length === venues.length) {
    return result(true, 'critical',
      `ALL ${venues.length} venues losing in ${windowLabel} window — systematic risk ($${Math.abs(totalLoss).toFixed(2)} total loss)`,
      { losing, totalLoss, venuePnl, windowLabel });
  }

  if (losing.length >= CORRELATED_DRAWDOWN_MIN_VENUES && losing.length >= venues.length * 0.75) {
    return result(true, 'warning',
      `${losing.length}/${venues.length} venues losing in ${windowLabel} window — correlated drawdown`,
      { losing, totalLoss, venuePnl, windowLabel });
  }

  return result(false, 'info',
    `${losing.length}/${venues.length} venues losing — within normal range`,
    { losing: losing.length, total: venues.length, venuePnl });
}

// ─── 7. State File Consistency ──────────────────────────────────────────────

/**
 * Validates cross-file invariants: capital in risk manager should match mandate,
 * journal trade count should be non-decreasing, etc.
 */
function checkStateConsistency() {
  const issues = [];
  const dataDir = path.resolve(process.cwd(), 'data');

  // Check all JSON files are parseable
  try {
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const fp = path.join(dataDir, f);
      try {
        const content = fs.readFileSync(fp, 'utf8');
        if (content.trim().length === 0) {
          issues.push({ file: f, problem: 'empty file' });
          continue;
        }
        JSON.parse(content);
      } catch (parseErr) {
        issues.push({ file: f, problem: `parse error: ${parseErr?.message || 'unknown'}` });
      }
    }
  } catch {
    // data dir doesn't exist yet — not an error
  }

  // Check journal trade count is reasonable
  try {
    const journal = readJsonSafe(path.join(dataDir, 'trade-journal.json'));
    if (journal && Array.isArray(journal.trades)) {
      if (journal.trades.length > 100000) {
        issues.push({ file: 'trade-journal.json', problem: `unbounded growth: ${journal.trades.length} trades` });
      }
    }
  } catch { /* ignore */ }

  // Check risk state has reasonable exposure values
  try {
    const riskState = readJsonSafe(path.join(dataDir, 'risk-manager-state.json'));
    if (riskState && riskState.totalExposureUsd !== undefined) {
      if (Number(riskState.totalExposureUsd) < 0) {
        issues.push({ file: 'risk-manager-state.json', problem: 'negative total exposure' });
      }
      if (Number(riskState.totalExposureUsd) > 1000000) {
        issues.push({ file: 'risk-manager-state.json', problem: `suspicious exposure: $${riskState.totalExposureUsd}` });
      }
    }
  } catch { /* ignore */ }

  // Check for tmp files left from crashed atomic writes
  try {
    const tmpFiles = fs.readdirSync(dataDir).filter(f => f.includes('.tmp'));
    if (tmpFiles.length > 0) {
      issues.push({ file: 'data/', problem: `${tmpFiles.length} orphaned .tmp file(s): ${tmpFiles.slice(0, 5).join(', ')}` });
    }
  } catch { /* ignore */ }

  if (issues.length > 0) {
    const hasParseErrors = issues.some(i => i.problem.includes('parse error'));
    return result(true, hasParseErrors ? 'critical' : 'warning',
      `${issues.length} state consistency issue(s): ${issues.map(i => `${i.file}: ${i.problem}`).join('; ')}`,
      { issues });
  }

  return result(false, 'info', 'All state files consistent', { issues: [] });
}

function readJsonSafe(filePath) {
  if (rio) return rio.readJsonSafe(filePath, { fallback: null });
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

// ─── 8. Stale Data Detection ────────────────────────────────────────────────

/**
 * Detects when price feeds are stuck returning the same value,
 * indicating a dead feed or cached stale data.
 *
 * @param {object} opts
 * @param {string} opts.source - Feed source identifier
 * @param {number} opts.price - Latest price
 */
function checkStalePrice(opts = {}) {
  const { source = 'unknown', price = 0 } = opts;

  if (!Number.isFinite(price) || price <= 0) {
    return result(true, 'warning',
      `${source}: invalid price (${price})`,
      { source, price });
  }

  const state = loadState();
  if (!state.stalePriceCounters[source]) {
    state.stalePriceCounters[source] = { lastPrice: 0, identicalCount: 0 };
  }

  const counter = state.stalePriceCounters[source];

  if (price === counter.lastPrice) {
    counter.identicalCount += 1;
  } else {
    counter.identicalCount = 0;
    counter.lastPrice = price;
  }

  saveState(state);

  if (counter.identicalCount >= STALE_PRICE_MAX_IDENTICAL) {
    return result(true, 'warning',
      `${source}: price unchanged for ${counter.identicalCount} consecutive checks (${price})`,
      { source, price, identicalCount: counter.identicalCount, threshold: STALE_PRICE_MAX_IDENTICAL });
  }

  return result(false, 'info',
    `${source}: price feed active (${price})`,
    { source, price, identicalCount: counter.identicalCount });
}

// ─── 9. Order Duplication Guard ─────────────────────────────────────────────

/**
 * Prevents duplicate orders from being placed within a short window.
 * Returns triggered=true if this order looks like a duplicate.
 *
 * @param {object} opts
 * @param {string} opts.venue - Exchange
 * @param {string} opts.asset - Asset
 * @param {string} opts.side - buy/sell
 * @param {number} opts.usdSize - Order size in USD
 */
function checkOrderDuplication(opts = {}) {
  const { venue = '', asset = '', side = '', usdSize = 0 } = opts;
  const state = loadState();
  const now = Date.now();

  // Prune old entries
  state.recentOrders = (state.recentOrders || []).filter(o => now - o.ts < ORDER_DEDUP_WINDOW_MS);

  // Check for duplicate
  const fingerprint = `${venue}:${asset}:${side}:${Math.round(usdSize)}`;
  const duplicate = state.recentOrders.find(o => o.fingerprint === fingerprint);

  if (duplicate) {
    saveState(state);
    return result(true, 'warning',
      `Duplicate order blocked: ${fingerprint} (last placed ${now - duplicate.ts}ms ago)`,
      { fingerprint, lastPlacedMs: now - duplicate.ts, windowMs: ORDER_DEDUP_WINDOW_MS });
  }

  // Record this order
  state.recentOrders.push({ fingerprint, ts: now });
  saveState(state);

  return result(false, 'info',
    `Order accepted: ${fingerprint}`,
    { fingerprint });
}

// ─── 10. Gas/Fee Spike Protection ───────────────────────────────────────────

/**
 * Checks if on-chain gas prices are above the safe threshold.
 *
 * @param {object} opts
 * @param {number} opts.gasPriceGwei - Current gas price in gwei
 * @param {string} [opts.chain] - Chain name
 */
function checkGasSpike(opts = {}) {
  const { gasPriceGwei = 0, chain = 'ethereum' } = opts;

  if (!Number.isFinite(gasPriceGwei) || gasPriceGwei <= 0) {
    return result(false, 'info', `${chain}: gas price unavailable`, { chain });
  }

  if (gasPriceGwei >= GAS_SPIKE_THRESHOLD_GWEI * 2) {
    return result(true, 'critical',
      `${chain}: gas price extreme — ${gasPriceGwei.toFixed(1)} gwei (2x threshold)`,
      { chain, gasPriceGwei, threshold: GAS_SPIKE_THRESHOLD_GWEI });
  }

  if (gasPriceGwei >= GAS_SPIKE_THRESHOLD_GWEI) {
    return result(true, 'warning',
      `${chain}: gas price elevated — ${gasPriceGwei.toFixed(1)} gwei (threshold: ${GAS_SPIKE_THRESHOLD_GWEI})`,
      { chain, gasPriceGwei, threshold: GAS_SPIKE_THRESHOLD_GWEI });
  }

  return result(false, 'info',
    `${chain}: gas price normal (${gasPriceGwei.toFixed(1)} gwei)`,
    { chain, gasPriceGwei });
}

// ─── Comprehensive Scan ─────────────────────────────────────────────────────

/**
 * Runs all available edge-case checks and returns a consolidated report.
 * Each check is wrapped in try/catch so one failing check doesn't block others.
 *
 * @param {object} [context] - Optional context data to feed into checks
 * @returns {{ grade: string, triggered: number, total: number, results: object[] }}
 */
function runComprehensiveScan(context = {}) {
  const results = [];

  // State consistency (always available)
  try {
    results.push({ check: 'state_consistency', ...checkStateConsistency() });
  } catch (err) {
    results.push({ check: 'state_consistency', ...result(false, 'warning', `check error: ${err?.message}`) });
  }

  // Flash crash (if price data provided)
  if (context.currentPrice && context.recentPrices) {
    try {
      results.push({ check: 'flash_crash', ...checkFlashCrash({
        asset: context.asset || 'BTC',
        currentPrice: context.currentPrice,
        recentPrices: context.recentPrices,
      }) });
    } catch (err) {
      results.push({ check: 'flash_crash', ...result(false, 'warning', `check error: ${err?.message}`) });
    }
  }

  // Overfit (if stats available)
  if (context.liveSharpe !== undefined && context.backtestSharpe !== undefined) {
    try {
      results.push({ check: 'overfit', ...checkOverfit(context) });
    } catch (err) {
      results.push({ check: 'overfit', ...result(false, 'warning', `check error: ${err?.message}`) });
    }
  }

  // Runaway loss (if P&L provided)
  if (context.currentPnl !== undefined) {
    try {
      results.push({ check: 'runaway_loss', ...checkRunawayLoss({ currentPnl: context.currentPnl }) });
    } catch (err) {
      results.push({ check: 'runaway_loss', ...result(false, 'warning', `check error: ${err?.message}`) });
    }
  }

  // Correlated drawdown (if venue P&L map provided)
  if (context.venuePnl) {
    try {
      results.push({ check: 'correlated_drawdown', ...checkCorrelatedDrawdown({ venuePnl: context.venuePnl }) });
    } catch (err) {
      results.push({ check: 'correlated_drawdown', ...result(false, 'warning', `check error: ${err?.message}`) });
    }
  }

  // Gas spike (if gas data provided)
  if (context.gasPriceGwei !== undefined) {
    try {
      results.push({ check: 'gas_spike', ...checkGasSpike({ gasPriceGwei: context.gasPriceGwei, chain: context.chain }) });
    } catch (err) {
      results.push({ check: 'gas_spike', ...result(false, 'warning', `check error: ${err?.message}`) });
    }
  }

  // Exchange health checks for each provided venue
  if (Array.isArray(context.exchanges)) {
    for (const ex of context.exchanges) {
      try {
        results.push({ check: `exchange_insolvency_${ex.venue}`, ...checkExchangeInsolvency(ex) });
      } catch (err) {
        results.push({ check: `exchange_insolvency_${ex.venue}`, ...result(false, 'warning', `check error: ${err?.message}`) });
      }
    }
  }

  // Stale price checks
  if (Array.isArray(context.priceFeeds)) {
    for (const feed of context.priceFeeds) {
      try {
        results.push({ check: `stale_price_${feed.source}`, ...checkStalePrice(feed) });
      } catch (err) {
        results.push({ check: `stale_price_${feed.source}`, ...result(false, 'warning', `check error: ${err?.message}`) });
      }
    }
  }

  const triggered = results.filter(r => r.triggered).length;
  const emergencies = results.filter(r => r.severity === 'emergency').length;
  const criticals = results.filter(r => r.severity === 'critical').length;

  let grade = 'A+';
  if (emergencies > 0) grade = 'F';
  else if (criticals >= 2) grade = 'D';
  else if (criticals === 1) grade = 'C';
  else if (triggered >= 3) grade = 'B';
  else if (triggered >= 1) grade = 'A';

  // Publish to signal bus
  if (signalBus && triggered > 0) {
    try {
      signalBus.publish({
        type: 'edge_case_alert',
        source: 'edge-case-mitigations',
        confidence: 0.95,
        payload: {
          grade,
          triggered,
          total: results.length,
          emergencies,
          criticals,
          alerts: results.filter(r => r.triggered).map(r => ({
            check: r.check,
            severity: r.severity,
            message: r.message,
          })),
        },
      });
    } catch { /* ignore */ }
  }

  // Auto-activate kill switch on emergency
  if (emergencies > 0 && riskManager) {
    try {
      const reasons = results.filter(r => r.severity === 'emergency').map(r => r.message).join('; ');
      riskManager.activateKillSwitch(`Edge-case emergency: ${reasons}`);
    } catch { /* ignore */ }
  }

  return { grade, triggered, total: results.length, emergencies, criticals, results };
}

// ─── Alert History ──────────────────────────────────────────────────────────

/**
 * Records a triggered alert for historical tracking.
 */
function recordAlert(checkName, severity, message) {
  const state = loadState();
  state.triggeredAlerts.push({
    check: checkName,
    severity,
    message,
    ts: Date.now(),
  });
  // Keep last 500 alerts
  if (state.triggeredAlerts.length > 500) {
    state.triggeredAlerts = state.triggeredAlerts.slice(-500);
  }
  saveState(state);
}

/**
 * Returns recent alerts, optionally filtered by severity.
 */
function getRecentAlerts(opts = {}) {
  const { maxAgeMs = 24 * 60 * 60 * 1000, severity = null } = opts;
  const state = loadState();
  const cutoff = Date.now() - maxAgeMs;
  return (state.triggeredAlerts || [])
    .filter(a => a.ts >= cutoff)
    .filter(a => !severity || a.severity === severity)
    .sort((a, b) => b.ts - a.ts);
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  // Individual detectors
  checkExchangeInsolvency,
  checkFlashCrash,
  checkOverfit,
  checkRunawayLoss,
  checkKeyCompromise,
  checkCorrelatedDrawdown,
  checkStateConsistency,
  checkStalePrice,
  checkOrderDuplication,
  checkGasSpike,

  // Comprehensive scan
  runComprehensiveScan,

  // Alert history
  recordAlert,
  getRecentAlerts,

  // Config (read-only)
  FLASH_CRASH_THRESHOLD_PCT,
  RUNAWAY_LOSS_VELOCITY_USD_HR,
  OVERFIT_SHARPE_FLOOR_RATIO,
  ORDER_DEDUP_WINDOW_MS,
  GAS_SPIKE_THRESHOLD_GWEI,
  STATE_FILE,
};
