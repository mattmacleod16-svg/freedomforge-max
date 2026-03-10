/**
 * Capital Mandate — ZERO-INJECTION SELF-SUFFICIENCY PROTOCOL
 * ═══════════════════════════════════════════════════════════
 *
 * THIS IS THE LAW. No more external capital will EVER enter the system.
 * Every agent, engine, and trade loop MUST consult this mandate before
 * executing any action that risks capital.
 *
 * Rules:
 *   1. Capital Preservation First — NEVER risk more than you can recover from
 *   2. Absolute Floor — If total capital drops below CRITICAL_FLOOR, halt ALL trading
 *   3. Adaptive Sizing — Trade size scales with capital. Less capital = smaller bets
 *   4. Ironclad Payout — Owner receives >= 15% of realized net revenue (can only go UP)
 *      Remaining profits are reinvested (compounded). The payout floor is sovereignty law.
 *   5. Survival Mode — Below SURVIVAL_THRESHOLD, switch to ultra-conservative
 *   6. Growth Mode — Above GROWTH_THRESHOLD, can increase aggression slightly
 *   7. Failure Is Not An Option — every trade must pass capital mandate check
 *   8. ZERO INJECTION — No external capital will EVER enter this system again.
 *
 * The system started with ~$455 combined (CB ~$281 + KR ~$174).
 * RebalancEd to $805 initialCapital after USDC conversion.
 * This is ALL there will EVER be. Grow it or die.
 *
 * Wired into: master-orchestrator, coinbase-spot-engine, kraken-spot-engine,
 *             prediction-market-engine, risk-manager, liquidation-guardian
 */

const fs = require('fs');
const path = require('path');

// ─── Mandate Constants ───────────────────────────────────────────────────────

// The absolute minimum capital below which ALL trading halts.
// If we drop below this, we sit on our hands until a manual review.
const CRITICAL_FLOOR_USD = Number(process.env.MANDATE_CRITICAL_FLOOR_USD || 100);

// Below survival threshold, enter ultra-conservative mode:
// - Max trade size drops to SURVIVAL_MAX_TRADE_USD
// - Only take trades with confidence > 0.75 AND edge > 0.05
// - Max 1 trade per cycle
const SURVIVAL_THRESHOLD_USD = Number(process.env.MANDATE_SURVIVAL_USD || 200);
const SURVIVAL_MAX_TRADE_USD = Number(process.env.MANDATE_SURVIVAL_MAX_TRADE || 8);
const SURVIVAL_MIN_CONFIDENCE = 0.75;
const SURVIVAL_MIN_EDGE = 0.05;
const SURVIVAL_MAX_TRADES_PER_CYCLE = 1;

// Normal operating mode thresholds
const NORMAL_MIN_CAPITAL_USD = Number(process.env.MANDATE_NORMAL_MIN_USD || 300);
const NORMAL_MAX_TRADE_PCT = 0.06; // Max 6% of capital per trade
const NORMAL_MAX_DAILY_LOSS_PCT = 0.08; // Max 8% daily loss

// Growth mode: unlocked when capital exceeds this threshold
const GROWTH_THRESHOLD_USD = Number(process.env.MANDATE_GROWTH_USD || 600);
const GROWTH_MAX_TRADE_PCT = 0.08; // Can go up to 8% per trade in growth mode
const GROWTH_MAX_DAILY_LOSS_PCT = 0.10;

// Milestone tracking — the system celebrates and adjusts at each milestone
// Unified milestones — matches treasury-ledger.js progression
const MILESTONES = [500, 750, 1000, 2000, 5000, 10000, 25000, 50000, 100000, 250000, 1000000];

// State file
const MANDATE_STATE_FILE = path.resolve(process.cwd(), 'data/capital-mandate-state.json');

// ─── State Management ────────────────────────────────────────────────────────

function loadMandateState() {
  try {
    const abs = MANDATE_STATE_FILE;
    if (!fs.existsSync(abs)) return createInitialState();
    const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return raw;
  } catch { return createInitialState(); }
}

function createInitialState() {
  return {
    initialCapital: 500, // Total invested — THE ONLY CAPITAL. EVER. Zero injection.
    initializedAt: new Date().toISOString(),
    highWaterMark: 455,
    lowWaterMark: 455,
    currentMode: 'normal',
    milestonesReached: [],
    modeTransitions: [],
    dailyCapitalSnapshots: [],
    consecutiveLossDays: 0,
    consecutiveWinDays: 0,
    totalDaysActive: 0,
    mandateViolations: [],
    tradeDenials: 0,
    capitalHaltEvents: 0,
    survivalModeEntries: 0,
    growthModeEntries: 0,
    lastChecked: Date.now(),
    updatedAt: Date.now(),
  };
}

function saveMandateState(state) {
  state.updatedAt = Date.now();
  // Keep snapshots trimmed
  if (state.dailyCapitalSnapshots.length > 365) {
    state.dailyCapitalSnapshots = state.dailyCapitalSnapshots.slice(-365);
  }
  if (state.mandateViolations.length > 200) {
    state.mandateViolations = state.mandateViolations.slice(-200);
  }
  if (state.modeTransitions.length > 100) {
    state.modeTransitions = state.modeTransitions.slice(-100);
  }
  fs.mkdirSync(path.dirname(MANDATE_STATE_FILE), { recursive: true });
  fs.writeFileSync(MANDATE_STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Capital Assessment ──────────────────────────────────────────────────────

/**
 * Pull live capital from guardian state (source of truth for balances).
 */
function getCurrentCapital() {
  try {
    const guardianFile = path.resolve(process.cwd(), 'data/liquidation-guardian-state.json');
    if (!fs.existsSync(guardianFile)) return { total: 0, coinbase: 0, kraken: 0, source: 'missing' };
    const g = JSON.parse(fs.readFileSync(guardianFile, 'utf8'));
    const cb = g?.coinbase?.totalBalance || 0;
    const kr = g?.kraken?.equity || 0;
    return { total: cb + kr, coinbase: cb, kraken: kr, source: 'guardian' };
  } catch {
    return { total: 0, coinbase: 0, kraken: 0, source: 'error' };
  }
}

/**
 * Determine the operating mode based on current capital.
 */
function determineMode(totalCapital) {
  if (totalCapital <= CRITICAL_FLOOR_USD) return 'capital_halt'; // FULL STOP
  if (totalCapital <= SURVIVAL_THRESHOLD_USD) return 'survival';  // Ultra-conservative
  if (totalCapital >= GROWTH_THRESHOLD_USD) return 'growth';      // Slightly more aggressive
  return 'normal'; // Standard operation
}

// ─── THE MANDATE CHECK — Every trade MUST pass this ──────────────────────────

/**
 * The central mandate enforcement function.
 * EVERY engine MUST call this before placing a trade.
 * Returns: { allowed: boolean, maxTradeUsd: number, mode: string, reasons: string[] }
 */
function checkMandate({ usdSize, confidence = 0.5, edge = 0, asset = '', venue = '' }) {
  const capital = getCurrentCapital();
  const state = loadMandateState();
  const mode = determineMode(capital.total);
  const reasons = [];

  // Update mode if changed
  if (state.currentMode !== mode) {
    state.modeTransitions.push({
      from: state.currentMode,
      to: mode,
      capital: capital.total,
      ts: Date.now(),
    });
    state.currentMode = mode;
    if (mode === 'survival') state.survivalModeEntries++;
    if (mode === 'growth') state.growthModeEntries++;
    if (mode === 'capital_halt') state.capitalHaltEvents++;
  }

  // Update watermarks
  if (capital.total > state.highWaterMark) state.highWaterMark = capital.total;
  if (capital.total < state.lowWaterMark || state.lowWaterMark === 0) state.lowWaterMark = capital.total;

  // Check milestones
  for (const m of MILESTONES) {
    if (capital.total >= m && !state.milestonesReached.includes(m)) {
      state.milestonesReached.push(m);
      console.log(`🚀 MILESTONE REACHED: $${m}! Capital is now $${capital.total.toFixed(2)}`);
    }
  }

  state.lastChecked = Date.now();

  // ═══ MODE: CAPITAL HALT ═══
  if (mode === 'capital_halt') {
    reasons.push(`CAPITAL HALT — total $${capital.total.toFixed(2)} below critical floor $${CRITICAL_FLOOR_USD}`);
    reasons.push('ALL TRADING SUSPENDED — manual review required');
    state.mandateViolations.push({
      type: 'capital_halt',
      capital: capital.total,
      requestedTrade: usdSize,
      ts: Date.now(),
    });
    state.tradeDenials++;
    saveMandateState(state);
    return { allowed: false, maxTradeUsd: 0, mode, reasons, capital };
  }

  // ═══ MODE: SURVIVAL ═══
  if (mode === 'survival') {
    const maxTrade = Math.min(SURVIVAL_MAX_TRADE_USD, capital.total * 0.03); // 3% max in survival

    if (usdSize > maxTrade) {
      reasons.push(`SURVIVAL: trade $${usdSize.toFixed(2)} exceeds max $${maxTrade.toFixed(2)} (3% of $${capital.total.toFixed(2)})`);
    }
    if (confidence < SURVIVAL_MIN_CONFIDENCE) {
      reasons.push(`SURVIVAL: confidence ${(confidence * 100).toFixed(1)}% below min ${(SURVIVAL_MIN_CONFIDENCE * 100)}%`);
    }
    if (edge < SURVIVAL_MIN_EDGE) {
      reasons.push(`SURVIVAL: edge ${(edge * 100).toFixed(1)}% below min ${(SURVIVAL_MIN_EDGE * 100)}%`);
    }

    if (reasons.length > 0) {
      state.tradeDenials++;
      state.mandateViolations.push({
        type: 'survival_denial',
        capital: capital.total,
        requestedTrade: usdSize,
        confidence,
        edge,
        ts: Date.now(),
      });
    }

    saveMandateState(state);
    return {
      allowed: reasons.length === 0,
      maxTradeUsd: maxTrade,
      maxTradesPerCycle: SURVIVAL_MAX_TRADES_PER_CYCLE,
      mode,
      reasons,
      capital,
    };
  }

  // ═══ MODE: NORMAL ═══
  if (mode === 'normal') {
    const maxTrade = capital.total * NORMAL_MAX_TRADE_PCT;
    const maxDailyLoss = capital.total * NORMAL_MAX_DAILY_LOSS_PCT;

    if (usdSize > maxTrade) {
      reasons.push(`NORMAL: trade $${usdSize.toFixed(2)} exceeds max $${maxTrade.toFixed(2)} (${(NORMAL_MAX_TRADE_PCT * 100)}% of $${capital.total.toFixed(2)})`);
    }

    // Confidence floor in normal mode
    if (confidence < 0.55) {
      reasons.push(`NORMAL: confidence ${(confidence * 100).toFixed(1)}% below minimum 55%`);
    }

    // Daily loss check — prevent trading if daily losses exceed threshold
    try {
      const riskState = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'data/risk-manager-state.json'), 'utf8'));
      const today = new Date().toISOString().slice(0, 10);
      if (riskState?.dailyPnl?.date === today && riskState.dailyPnl.pnl < -maxDailyLoss) {
        reasons.push(`NORMAL: daily loss $${Math.abs(riskState.dailyPnl.pnl).toFixed(2)} exceeds mandate max $${maxDailyLoss.toFixed(2)} (${(NORMAL_MAX_DAILY_LOSS_PCT * 100)}%)`);
      }
    } catch {}

    if (reasons.length > 0) {
      state.tradeDenials++;
    }

    saveMandateState(state);
    return {
      allowed: reasons.length === 0,
      maxTradeUsd: maxTrade,
      maxDailyLossUsd: maxDailyLoss,
      maxTradesPerCycle: 3,
      mode,
      reasons,
      capital,
    };
  }

  // ═══ MODE: GROWTH ═══
  if (mode === 'growth') {
    const maxTrade = capital.total * GROWTH_MAX_TRADE_PCT;
    const maxDailyLoss = capital.total * GROWTH_MAX_DAILY_LOSS_PCT;

    if (usdSize > maxTrade) {
      reasons.push(`GROWTH: trade $${usdSize.toFixed(2)} exceeds max $${maxTrade.toFixed(2)} (${(GROWTH_MAX_TRADE_PCT * 100)}% of $${capital.total.toFixed(2)})`);
    }

    // Daily loss check in growth mode
    try {
      const riskState = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'data/risk-manager-state.json'), 'utf8'));
      const today = new Date().toISOString().slice(0, 10);
      if (riskState?.dailyPnl?.date === today && riskState.dailyPnl.pnl < -maxDailyLoss) {
        reasons.push(`GROWTH: daily loss $${Math.abs(riskState.dailyPnl.pnl).toFixed(2)} exceeds mandate max $${maxDailyLoss.toFixed(2)} (${(GROWTH_MAX_DAILY_LOSS_PCT * 100)}%)`);
      }
    } catch {}

    if (reasons.length > 0) {
      state.tradeDenials++;
    }

    saveMandateState(state);
    return {
      allowed: reasons.length === 0,
      maxTradeUsd: maxTrade,
      maxDailyLossUsd: maxDailyLoss,
      maxTradesPerCycle: 5,
      mode,
      reasons,
      capital,
    };
  }

  // Fallback (should never reach here)
  saveMandateState(state);
  return { allowed: false, maxTradeUsd: 0, mode: 'unknown', reasons: ['unknown mode'], capital };
}

// ─── Adaptive Trade Sizing ───────────────────────────────────────────────────

/**
 * Get the mandate-adjusted trade size.
 * Call this INSTEAD of hardcoding order sizes.
 * It scales the base size according to current capital and mode.
 */
function mandateAdjustedSize({ baseUsd, confidence = 0.5, edge = 0 }) {
  const capital = getCurrentCapital();
  const mode = determineMode(capital.total);

  let size = baseUsd;

  if (mode === 'capital_halt') return 0;

  if (mode === 'survival') {
    // In survival: max 3% of capital, hard cap at SURVIVAL_MAX_TRADE_USD
    size = Math.min(baseUsd, capital.total * 0.03, SURVIVAL_MAX_TRADE_USD);
    // Only high-conviction trades
    if (confidence < SURVIVAL_MIN_CONFIDENCE || edge < SURVIVAL_MIN_EDGE) return 0;
  } else if (mode === 'normal') {
    // In normal: scale base by capital ratio (more capital = full size, less = scaled down)
    const capitalRatio = Math.min(1, capital.total / NORMAL_MIN_CAPITAL_USD);
    size = baseUsd * capitalRatio;
    // Cap at 6% of capital
    size = Math.min(size, capital.total * NORMAL_MAX_TRADE_PCT);
  } else if (mode === 'growth') {
    // In growth: can go slightly larger
    const growthBoost = Math.min(1.5, capital.total / GROWTH_THRESHOLD_USD);
    size = baseUsd * growthBoost;
    // Cap at 8% of capital
    size = Math.min(size, capital.total * GROWTH_MAX_TRADE_PCT);
  }

  // Edge-weighted: higher edge = closer to max size
  if (edge > 0) {
    const edgeMultiplier = 0.5 + Math.min(0.5, edge * 5); // edge 0.1 = 1.0x
    size *= edgeMultiplier;
  }

  // Confidence-weighted: higher confidence = larger bet
  if (confidence > 0.5) {
    const confMultiplier = 0.7 + (confidence - 0.5) * 0.6; // conf 0.8 = 0.88x, conf 1.0 = 1.0x
    size *= confMultiplier;
  }

  // Floor at $5 (exchanges reject smaller), ceiling at mandate max
  size = Math.max(5, Math.round(size * 100) / 100);

  return size;
}

// ─── Daily Capital Snapshot ──────────────────────────────────────────────────

/**
 * Take a daily capital snapshot for long-term tracking.
 * Should be called once per day (e.g., by the orchestrator).
 */
function takeDailySnapshot() {
  const state = loadMandateState();
  const capital = getCurrentCapital();
  const today = new Date().toISOString().slice(0, 10);

  // Skip if already snapshotted today
  const last = state.dailyCapitalSnapshots[state.dailyCapitalSnapshots.length - 1];
  if (last?.date === today) return;

  const prevCapital = last?.total || state.initialCapital;
  const dailyPnl = capital.total - prevCapital;
  const roiPct = state.initialCapital > 0
    ? ((capital.total - state.initialCapital) / state.initialCapital) * 100
    : 0;

  state.dailyCapitalSnapshots.push({
    date: today,
    total: capital.total,
    coinbase: capital.coinbase,
    kraken: capital.kraken,
    dailyPnl,
    roiPct,
    mode: determineMode(capital.total),
    highWaterMark: state.highWaterMark,
  });

  // Track consecutive win/loss days
  if (dailyPnl > 0) {
    state.consecutiveWinDays++;
    state.consecutiveLossDays = 0;
  } else if (dailyPnl < 0) {
    state.consecutiveLossDays++;
    state.consecutiveWinDays = 0;
  }

  state.totalDaysActive++;
  saveMandateState(state);

  console.log(`📊 Daily snapshot: $${capital.total.toFixed(2)} | Day P&L: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)} | ROI: ${roiPct.toFixed(1)}% | Mode: ${determineMode(capital.total)} | Day ${state.totalDaysActive}`);
}

// ─── Mandate Summary ─────────────────────────────────────────────────────────

function getMandateSummary() {
  const state = loadMandateState();
  const capital = getCurrentCapital();
  const mode = determineMode(capital.total);

  return {
    mode,
    capital,
    initialCapital: state.initialCapital,
    highWaterMark: state.highWaterMark,
    lowWaterMark: state.lowWaterMark,
    roiPct: state.initialCapital > 0
      ? ((capital.total - state.initialCapital) / state.initialCapital) * 100
      : 0,
    milestonesReached: state.milestonesReached,
    totalDaysActive: state.totalDaysActive,
    consecutiveWinDays: state.consecutiveWinDays,
    consecutiveLossDays: state.consecutiveLossDays,
    tradeDenials: state.tradeDenials,
    capitalHaltEvents: state.capitalHaltEvents,
    survivalModeEntries: state.survivalModeEntries,
    growthModeEntries: state.growthModeEntries,
    mandateActive: true,
    message: 'ZERO INJECTION PROTOCOL — No external capital. Owner receives ≥15% of net revenue (Ironclad). Self-sufficient or bust.',
  };
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  checkMandate,
  mandateAdjustedSize,
  getCurrentCapital,
  determineMode,
  takeDailySnapshot,
  getMandateSummary,
  loadMandateState,
  CRITICAL_FLOOR_USD,
  SURVIVAL_THRESHOLD_USD,
  GROWTH_THRESHOLD_USD,
  MILESTONES,
};
