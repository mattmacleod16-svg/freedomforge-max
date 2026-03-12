/**
 * FreedomForge Treasury Ledger
 * ═══════════════════════════════════════════════════════════════
 * Persistent tracking of cumulative P&L, payouts, and milestones.
 * The money brain of the empire — never forgets a dollar earned.
 *
 * Mission: Track every cent flowing through FreedomForge so
 *          Matty always knows exactly how wealthy the system is making him.
 */

const fs = require('fs');
const path = require('path');

// Resilient I/O — atomic writes, backup recovery, file locking
let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

const LEDGER_FILE = path.resolve(process.cwd(), 'data/treasury-ledger.json');

// Unified milestones — matches capital-mandate.js progression
const MILESTONES = [500, 750, 1000, 2000, 5000, 10000, 25000, 50000, 100000, 250000, 1000000];

function loadLedger() {
  if (rio) return rio.readJsonSafe(LEDGER_FILE, { fallback: null }) || createFreshLedger();
  try {
    return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
  } catch {
    return createFreshLedger();
  }
}

function saveLedger(ledger) {
  ledger.updatedAt = Date.now();
  if (rio) { rio.writeJsonAtomic(LEDGER_FILE, ledger); return; }
  fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
  const tmp = LEDGER_FILE + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
  fs.renameSync(tmp, LEDGER_FILE);
}

function createFreshLedger() {
  return {
    // Core accounting
    lifetimePnl: 0,           // All-time P&L from trading
    lifetimeGrossProfit: 0,   // Sum of all winning trades
    lifetimeGrossLoss: 0,     // Sum of all losing trades (positive number)
    lifetimeTrades: 0,        // Total trades closed
    lifetimeWins: 0,          // Total winning trades
    lifetimeLosses: 0,        // Total losing trades

    // Revenue tracking
    lifetimePayouts: 0,       // Total USD paid out to owner
    lifetimeCompounded: 0,    // Total USD kept for compounding
    lifetimeFees: 0,          // Total fees paid (exchange + gas)

    // Capital tracking
    initialCapital: 0,        // Starting capital (set once)
    peakCapital: 0,           // All-time high portfolio value
    currentCapital: 0,        // Latest known portfolio value
    maxDrawdownPct: 0,        // Worst peak-to-trough drawdown %

    // Milestones
    milestonesReached: [],    // [{ amount, reachedAt, capitalAtTime }]
    nextMilestone: MILESTONES[0],

    // Daily snapshots (last 90 days rolling)
    dailySnapshots: [],       // [{ date, pnl, trades, wins, capital, cumulativePnl }]

    // Weekly summaries (last 52 weeks)
    weeklySummaries: [],      // [{ weekStart, pnl, trades, winRate, avgPnl, payoutUsd }]

    // Meta
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
  };
}

/**
 * Record a batch of reconciled trades into the treasury ledger.
 * Called by the orchestrator after each reconciliation cycle.
 */
function recordReconciliation({ closedCount = 0, totalPnl = 0, closed = [] } = {}) {
  const ledger = loadLedger();

  if (closedCount === 0 && closed.length === 0) return ledger;

  const trades = closed.length > 0 ? closed : [];
  const wins = trades.filter(t => (t.pnl || 0) > 0);
  const losses = trades.filter(t => (t.pnl || 0) < 0);

  ledger.lifetimePnl = Math.round((ledger.lifetimePnl + totalPnl) * 100) / 100;
  ledger.lifetimeTrades += closedCount;
  ledger.lifetimeWins += wins.length;
  ledger.lifetimeLosses += losses.length;
  ledger.lifetimeGrossProfit = Math.round((ledger.lifetimeGrossProfit + wins.reduce((s, t) => s + (t.pnl || 0), 0)) * 100) / 100;
  ledger.lifetimeGrossLoss = Math.round((ledger.lifetimeGrossLoss + Math.abs(losses.reduce((s, t) => s + (t.pnl || 0), 0))) * 100) / 100;

  // Keep lifetimeCompounded in sync: everything earned minus payouts
  ledger.lifetimeCompounded = Math.round((ledger.lifetimePnl - ledger.lifetimePayouts) * 100) / 100;

  // Check milestones
  checkMilestones(ledger);

  saveLedger(ledger);
  return ledger;
}

/**
 * Update the current capital snapshot (from exchange balances).
 */
function updateCapital(currentCapitalUsd) {
  const ledger = loadLedger();

  if (!ledger.initialCapital && currentCapitalUsd > 0) {
    ledger.initialCapital = currentCapitalUsd;
  }

  ledger.currentCapital = currentCapitalUsd;

  if (currentCapitalUsd > ledger.peakCapital) {
    ledger.peakCapital = currentCapitalUsd;
  }

  // Drawdown calculation
  if (ledger.peakCapital > 0) {
    const drawdownPct = ((ledger.peakCapital - currentCapitalUsd) / ledger.peakCapital) * 100;
    if (drawdownPct > ledger.maxDrawdownPct) {
      ledger.maxDrawdownPct = Math.round(drawdownPct * 100) / 100;
    }
  }

  checkMilestones(ledger);
  saveLedger(ledger);
  return ledger;
}

/**
 * Record a payout event (when profits are withdrawn to owner).
 * Validates amount > 0 and updates both payouts and compounded totals.
 */
function recordPayout(amountUsd, details = {}) {
  if (!amountUsd || amountUsd <= 0) return loadLedger(); // Reject invalid amounts
  const ledger = loadLedger();
  ledger.lifetimePayouts = Math.round((ledger.lifetimePayouts + amountUsd) * 100) / 100;
  // lifetimeCompounded = everything earned minus everything paid out
  ledger.lifetimeCompounded = Math.round((ledger.lifetimePnl - ledger.lifetimePayouts) * 100) / 100;
  saveLedger(ledger);
  return ledger;
}

/**
 * Take a daily snapshot of the treasury state.
 * Should be called once per day (e.g., by daily-check or orchestrator).
 */
function takeDailySnapshot(dailyPnl = 0, dailyTrades = 0, dailyWins = 0, capital = 0) {
  const ledger = loadLedger();
  const today = new Date().toISOString().slice(0, 10);

  // Don't duplicate snapshots for the same day
  const existing = ledger.dailySnapshots.find(s => s.date === today);
  if (existing) {
    existing.pnl = Math.round((existing.pnl + dailyPnl) * 100) / 100;
    existing.trades += dailyTrades;
    existing.wins += dailyWins;
    existing.capital = capital || existing.capital;
    existing.cumulativePnl = ledger.lifetimePnl;
  } else {
    ledger.dailySnapshots.push({
      date: today,
      pnl: Math.round(dailyPnl * 100) / 100,
      trades: dailyTrades,
      wins: dailyWins,
      capital: capital || ledger.currentCapital,
      cumulativePnl: ledger.lifetimePnl,
    });
  }

  // Keep last 90 days
  if (ledger.dailySnapshots.length > 90) {
    ledger.dailySnapshots = ledger.dailySnapshots.slice(-90);
  }

  saveLedger(ledger);
  return ledger;
}

/**
 * Generate a weekly summary from accumulated daily snapshots.
 */
function generateWeeklySummary() {
  const ledger = loadLedger();
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  // Check if we already have this week
  if (ledger.weeklySummaries.some(w => w.weekStart === weekStartStr)) return ledger;

  // Get last 7 days of snapshots
  const last7 = ledger.dailySnapshots.slice(-7);
  if (last7.length === 0) return ledger;

  const weekPnl = last7.reduce((s, d) => s + d.pnl, 0);
  const weekTrades = last7.reduce((s, d) => s + d.trades, 0);
  const weekWins = last7.reduce((s, d) => s + d.wins, 0);

  ledger.weeklySummaries.push({
    weekStart: weekStartStr,
    pnl: Math.round(weekPnl * 100) / 100,
    trades: weekTrades,
    winRate: weekTrades > 0 ? Math.round(weekWins / weekTrades * 100 * 10) / 10 : 0,
    avgPnl: weekTrades > 0 ? Math.round(weekPnl / weekTrades * 100) / 100 : 0,
    capital: last7[last7.length - 1]?.capital || ledger.currentCapital,
  });

  // Keep last 52 weeks
  if (ledger.weeklySummaries.length > 52) {
    ledger.weeklySummaries = ledger.weeklySummaries.slice(-52);
  }

  saveLedger(ledger);
  return ledger;
}

function checkMilestones(ledger) {
  const capital = ledger.currentCapital || 0;
  while (ledger.nextMilestone && capital >= ledger.nextMilestone) {
    ledger.milestonesReached.push({
      amount: ledger.nextMilestone,
      reachedAt: Date.now(),
      capitalAtTime: capital,
      lifetimePnl: ledger.lifetimePnl,
    });
    const idx = MILESTONES.indexOf(ledger.nextMilestone);
    ledger.nextMilestone = idx < MILESTONES.length - 1 ? MILESTONES[idx + 1] : null;
  }
}

/**
 * Get full treasury summary for dashboard or API.
 */
function getSummary() {
  const ledger = loadLedger();
  const winRate = ledger.lifetimeTrades > 0
    ? Math.round(ledger.lifetimeWins / ledger.lifetimeTrades * 100 * 10) / 10
    : 0;
  const profitFactor = ledger.lifetimeGrossLoss > 0
    ? Math.round(ledger.lifetimeGrossProfit / ledger.lifetimeGrossLoss * 100) / 100
    : ledger.lifetimeGrossProfit > 0 ? Infinity : 0;
  const roi = ledger.initialCapital > 0
    ? Math.round(ledger.lifetimePnl / ledger.initialCapital * 100 * 100) / 100
    : 0;

  return {
    // Core metrics
    lifetimePnl: ledger.lifetimePnl,
    lifetimeTrades: ledger.lifetimeTrades,
    winRate,
    profitFactor,
    roi,

    // Capital state
    initialCapital: ledger.initialCapital,
    currentCapital: ledger.currentCapital,
    peakCapital: ledger.peakCapital,
    maxDrawdownPct: ledger.maxDrawdownPct,

    // Payouts
    lifetimePayouts: ledger.lifetimePayouts,
    lifetimeCompounded: ledger.lifetimeCompounded,
    nextMilestone: ledger.nextMilestone,
    milestonesReached: ledger.milestonesReached.length,

    // Trends
    dailySnapshots: ledger.dailySnapshots.slice(-30), // Last 30 days
    weeklySummaries: ledger.weeklySummaries.slice(-12), // Last 12 weeks

    updatedAt: ledger.updatedAt,
  };
}

module.exports = {
  recordReconciliation,
  updateCapital,
  recordPayout,
  takeDailySnapshot,
  generateWeeklySummary,
  getSummary,
  LEDGER_FILE,
};
