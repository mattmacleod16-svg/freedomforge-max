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

const { createLogger } = require('./logger');
const log = createLogger('capital-mandate');

// ─── Mandate Constants ───────────────────────────────────────────────────────

// The absolute minimum capital below which ALL trading halts.
// If we drop below this, we sit on our hands until a manual review.
const CRITICAL_FLOOR_USD = Math.max(10, Math.min(5000, Number(process.env.MANDATE_CRITICAL_FLOOR_USD || 100)));

// Below survival threshold, enter ultra-conservative mode:
// - Max trade size drops to SURVIVAL_MAX_TRADE_USD
// - Only take trades with confidence > 0.75 AND edge > 0.05
// - Max 1 trade per cycle
const SURVIVAL_THRESHOLD_USD = Math.max(50, Math.min(10000, Number(process.env.MANDATE_SURVIVAL_USD || 200)));
const SURVIVAL_MAX_TRADE_USD = Math.max(1, Math.min(100, Number(process.env.MANDATE_SURVIVAL_MAX_TRADE || 8)));
const SURVIVAL_MIN_CONFIDENCE = 0.75;
const SURVIVAL_MIN_EDGE = 0.05;
const SURVIVAL_MAX_TRADES_PER_CYCLE = 1;

// Normal operating mode thresholds
const NORMAL_MIN_CAPITAL_USD = Math.max(100, Math.min(50000, Number(process.env.MANDATE_NORMAL_MIN_USD || 300)));
const NORMAL_MAX_TRADE_PCT = 0.06; // Max 6% of capital per trade
const NORMAL_MAX_DAILY_LOSS_PCT = 0.08; // Max 8% daily loss

// Growth mode: unlocked when capital exceeds this threshold
const GROWTH_THRESHOLD_USD = Math.max(200, Math.min(100000, Number(process.env.MANDATE_GROWTH_USD || 600)));
const GROWTH_MAX_TRADE_PCT = 0.08; // Can go up to 8% per trade in growth mode
const GROWTH_MAX_DAILY_LOSS_PCT = 0.10;

// Volatility-adjusted mode transition: if VaR-implied daily risk exceeds
// this fraction of capital, force conservative (survival) mode
const VAR_RISK_FORCE_CONSERVATIVE_PCT = Math.max(0.01, Math.min(0.15,
  Number(process.env.MANDATE_VAR_RISK_FORCE_PCT || 0.05)));

// Consecutive loss day sizing penalty: after this many consecutive losing days,
// reduce max position size by CONSEC_LOSS_SIZE_REDUCTION
const CONSEC_LOSS_DAYS_THRESHOLD = Math.max(1, Math.min(10,
  parseInt(process.env.MANDATE_CONSEC_LOSS_DAYS || '3', 10)));
const CONSEC_LOSS_SIZE_REDUCTION = Math.max(0.1, Math.min(0.7,
  Number(process.env.MANDATE_CONSEC_LOSS_REDUCTION || 0.30)));

// Milestone tracking — the system celebrates and adjusts at each milestone
// Unified milestones — matches treasury-ledger.js progression
const MILESTONES = [500, 750, 1000, 2000, 5000, 10000, 25000, 50000, 100000, 250000, 1000000];

// State file
const MANDATE_STATE_FILE = path.resolve(process.cwd(), 'data/capital-mandate-state.json');

// Resilient I/O — atomic writes, backup recovery, file locking
let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

// ─── State Management ────────────────────────────────────────────────────────

function loadMandateState() {
  if (rio) return rio.readJsonSafe(MANDATE_STATE_FILE, { fallback: null }) || createInitialState();
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
  if (rio) { rio.writeJsonAtomic(MANDATE_STATE_FILE, state); return; }
  fs.mkdirSync(path.dirname(MANDATE_STATE_FILE), { recursive: true });
  const tmp = MANDATE_STATE_FILE + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, MANDATE_STATE_FILE);
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
 * Determine the operating mode based on current capital and optional
 * VaR-implied daily risk. When the VaR-implied risk exceeds
 * VAR_RISK_FORCE_CONSERVATIVE_PCT of capital, the system is forced
 * into survival mode regardless of capital level.
 *
 * @param {number} totalCapital - Current total capital in USD
 * @param {{ varDailyRiskPct?: number }} [opts] - Optional risk metrics
 * @returns {string} Operating mode: 'capital_halt' | 'survival' | 'normal' | 'growth'
 */
function determineMode(totalCapital, opts) {
  if (totalCapital <= CRITICAL_FLOOR_USD) return 'capital_halt'; // FULL STOP

  // Volatility-adjusted override: if daily VaR risk exceeds threshold, force conservative
  const varRisk = opts?.varDailyRiskPct;
  if (Number.isFinite(varRisk) && varRisk > VAR_RISK_FORCE_CONSERVATIVE_PCT * 100) {
    log.warn('VaR-implied risk forcing survival mode', {
      varDailyRiskPct: varRisk,
      threshold: VAR_RISK_FORCE_CONSERVATIVE_PCT * 100,
      capital: totalCapital,
    });
    return 'survival';
  }

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
  const reasons = [];

  // Fetch VaR-implied daily risk for volatility-adjusted mode transitions
  let varDailyRiskPct;
  try {
    const varEngine = require('./var-engine');
    const returns = varEngine.getHistoricalReturns();
    if (returns.length >= 5) {
      const histVaR = varEngine.calculateVaR(returns);
      varDailyRiskPct = Math.abs(histVaR.var95);
    } else {
      // Parametric fallback using per-asset volatility
      const vol = varEngine.getAssetVolatility(asset || 'BTC');
      const paramVaR = varEngine.parametricVaR(0, vol);
      varDailyRiskPct = Math.abs(paramVaR.var95);
    }
  } catch (err) {
    log.warn('VaR engine unavailable for mode determination', { error: err?.message || err });
  }

  const mode = determineMode(capital.total, { varDailyRiskPct });

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
      log.info(`MILESTONE REACHED: $${m}`, { milestone: m, capital: capital.total });
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
    let maxTrade = capital.total * NORMAL_MAX_TRADE_PCT;
    const maxDailyLoss = capital.total * NORMAL_MAX_DAILY_LOSS_PCT;

    // Consecutive loss day penalty: reduce max position size
    if (state.consecutiveLossDays >= CONSEC_LOSS_DAYS_THRESHOLD) {
      const reduction = 1 - CONSEC_LOSS_SIZE_REDUCTION;
      maxTrade *= reduction;
      log.info('Consecutive loss day penalty applied', {
        mode: 'normal',
        consecutiveLossDays: state.consecutiveLossDays,
        reductionPct: CONSEC_LOSS_SIZE_REDUCTION * 100,
        adjustedMaxTrade: maxTrade,
      });
    }

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
    } catch (err) { log.error('NORMAL daily loss check error', { error: err?.message || err }); }

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
    let maxTrade = capital.total * GROWTH_MAX_TRADE_PCT;
    const maxDailyLoss = capital.total * GROWTH_MAX_DAILY_LOSS_PCT;

    // Consecutive loss day penalty: reduce max position size
    if (state.consecutiveLossDays >= CONSEC_LOSS_DAYS_THRESHOLD) {
      const reduction = 1 - CONSEC_LOSS_SIZE_REDUCTION;
      maxTrade *= reduction;
      log.info('Consecutive loss day penalty applied', {
        mode: 'growth',
        consecutiveLossDays: state.consecutiveLossDays,
        reductionPct: CONSEC_LOSS_SIZE_REDUCTION * 100,
        adjustedMaxTrade: maxTrade,
      });
    }

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
    } catch (err) { log.error('GROWTH daily loss check error', { error: err?.message || err }); }

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

  // Consecutive loss day penalty: reduce size after sustained losses
  const state = loadMandateState();
  if (state.consecutiveLossDays >= CONSEC_LOSS_DAYS_THRESHOLD) {
    size *= (1 - CONSEC_LOSS_SIZE_REDUCTION);
  }

  // Edge-weighted: higher edge = closer to max size
  if (edge > 0) {
    const edgeMultiplier = 0.5 + Math.min(0.5, edge * 5); // edge 0.1 = 1.0x
    size *= edgeMultiplier;
  }

  // Confidence-weighted: low confidence reduces size, high confidence gives small boost
  // conf 0.55 → 0.885, conf 0.7 → 0.99, conf 0.95 → 1.165
  const confMultiplier = Math.max(0.5, Math.min(1.2, 0.5 + confidence * 0.7));
  size *= confMultiplier;

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

  log.info('Daily snapshot', { capital: capital.total, dailyPnl, roiPct, mode: determineMode(capital.total), day: state.totalDaysActive });
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

// ─── Capital Health ──────────────────────────────────────────────────────────

/**
 * Return a comprehensive capital health summary combining mandate state,
 * current risk metrics from the VaR engine, and actionable recommendations.
 *
 * Designed for dashboards, alerts, and autonomous decision-making agents.
 *
 * @returns {{
 *   mode: string,
 *   capital: { total: number, coinbase: number, kraken: number, source: string },
 *   riskMetrics: {
 *     varDailyRiskPct: number | null,
 *     cvar95: number | null,
 *     stressedVar95: number | null,
 *     consecutiveLossDays: number,
 *     consecutiveLossPenaltyActive: boolean,
 *     varForceConservativeActive: boolean,
 *   },
 *   sizing: {
 *     normalMaxTradePct: number,
 *     effectiveMaxTradePct: number,
 *   },
 *   recommendations: string[],
 * }}
 */
function getCapitalHealth() {
  const state = loadMandateState();
  const capital = getCurrentCapital();

  // Fetch VaR metrics
  let varDailyRiskPct = null;
  let cvar95 = null;
  let stressedVar95 = null;
  try {
    const varEngine = require('./var-engine');
    const returns = varEngine.getHistoricalReturns();
    if (returns.length >= 5) {
      const histVaR = varEngine.calculateVaR(returns);
      varDailyRiskPct = Math.abs(histVaR.var95);
      cvar95 = Math.abs(histVaR.cvar95);
      const stressed = varEngine.stressedVaR({ var95: histVaR.var95 });
      stressedVar95 = stressed.stressedVar95;
    } else {
      const vol = varEngine.getAssetVolatility('BTC');
      const paramVaR = varEngine.parametricVaR(0, vol);
      varDailyRiskPct = Math.abs(paramVaR.var95);
      cvar95 = Math.abs(paramVaR.cvar95);
      const stressed = varEngine.stressedVaR({ var95: paramVaR.var95 });
      stressedVar95 = stressed.stressedVar95;
    }
  } catch (err) {
    log.warn('VaR engine unavailable for capital health', { error: err?.message || err });
  }

  const varForceConservativeActive = Number.isFinite(varDailyRiskPct) &&
    varDailyRiskPct > VAR_RISK_FORCE_CONSERVATIVE_PCT * 100;
  const consecutiveLossPenaltyActive = state.consecutiveLossDays >= CONSEC_LOSS_DAYS_THRESHOLD;

  const mode = determineMode(capital.total, { varDailyRiskPct });

  // Compute effective max trade %
  let effectiveMaxTradePct;
  if (mode === 'capital_halt') {
    effectiveMaxTradePct = 0;
  } else if (mode === 'survival') {
    effectiveMaxTradePct = 3; // 3% cap in survival
  } else if (mode === 'growth') {
    effectiveMaxTradePct = GROWTH_MAX_TRADE_PCT * 100;
  } else {
    effectiveMaxTradePct = NORMAL_MAX_TRADE_PCT * 100;
  }
  if (consecutiveLossPenaltyActive && mode !== 'capital_halt' && mode !== 'survival') {
    effectiveMaxTradePct *= (1 - CONSEC_LOSS_SIZE_REDUCTION);
  }

  // Build recommendations
  const recommendations = [];
  if (mode === 'capital_halt') {
    recommendations.push('CRITICAL: All trading halted. Manual review required before resuming.');
  }
  if (varForceConservativeActive) {
    recommendations.push(`Reduce portfolio risk: VaR-implied daily risk (${varDailyRiskPct?.toFixed(2)}%) exceeds ${(VAR_RISK_FORCE_CONSERVATIVE_PCT * 100).toFixed(1)}% threshold.`);
  }
  if (consecutiveLossPenaltyActive) {
    recommendations.push(`${state.consecutiveLossDays} consecutive loss days detected. Position sizing reduced by ${(CONSEC_LOSS_SIZE_REDUCTION * 100).toFixed(0)}%. Consider pausing or tightening signal filters.`);
  }
  if (stressedVar95 !== null && capital.total > 0 && stressedVar95 > 10) {
    recommendations.push(`Stressed VaR (${stressedVar95.toFixed(2)}%) is elevated. Consider de-risking correlated altcoin positions.`);
  }
  if (recommendations.length === 0) {
    recommendations.push('Capital health nominal. No corrective action needed.');
  }

  return {
    mode,
    capital,
    riskMetrics: {
      varDailyRiskPct,
      cvar95,
      stressedVar95,
      consecutiveLossDays: state.consecutiveLossDays,
      consecutiveLossPenaltyActive,
      varForceConservativeActive,
    },
    sizing: {
      normalMaxTradePct: NORMAL_MAX_TRADE_PCT * 100,
      effectiveMaxTradePct: Math.round(effectiveMaxTradePct * 100) / 100,
    },
    recommendations,
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
  getCapitalHealth,
  loadMandateState,
  CRITICAL_FLOOR_USD,
  SURVIVAL_THRESHOLD_USD,
  GROWTH_THRESHOLD_USD,
  MILESTONES,
};
