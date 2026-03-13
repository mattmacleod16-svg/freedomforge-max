/**
 * Drawdown Circuit Breaker
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Halts ALL new trades (not just reduces sizing) when portfolio drawdown
 * exceeds a threshold. Auto-resumes after recovery, with a graduated
 * re-entry schedule.
 *
 * Levels:
 *   L0 - Normal:        drawdown < 3%   → full trading
 *   L1 - Caution:       3-5% drawdown   → reduce max positions by 50%
 *   L2 - Restricted:    5-10% drawdown  → 1 trade/cycle, halve sizes
 *   L3 - Halted:        10-15% drawdown → NO new trades, exit-only mode
 *   L4 - Emergency:     >15% drawdown   → close all, activate kill switch
 *
 * @module lib/drawdown-circuit-breaker
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');
const log = createLogger('drawdown-breaker');

let riskManager, signalBus, tradeJournal;
try { riskManager = require('./risk-manager'); } catch { riskManager = null; }
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }
try { tradeJournal = require('./trade-journal'); } catch { tradeJournal = null; }

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

// ─── Configuration ────────────────────────────────────────────────────────────
const L1_THRESHOLD = Number(process.env.CB_L1_DRAWDOWN_PCT || 3);
const L2_THRESHOLD = Number(process.env.CB_L2_DRAWDOWN_PCT || 5);
const L3_THRESHOLD = Number(process.env.CB_L3_DRAWDOWN_PCT || 10);
const L4_THRESHOLD = Number(process.env.CB_L4_DRAWDOWN_PCT || 15);
const RECOVERY_BUFFER_PCT = Number(process.env.CB_RECOVERY_BUFFER_PCT || 1); // Must recover by 1% below threshold to step down
const MIN_RECOVERY_TIME_MS = Number(process.env.CB_MIN_RECOVERY_TIME_MS || 3600000); // 1h min per level recovery
const LOOKBACK_HOURS = Number(process.env.CB_LOOKBACK_HOURS || 24);

const DATA_DIR = process.env.VERCEL ? '/tmp/freedomforge-data' : path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'drawdown-breaker-state.json');

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  level: 0, // 0-4
  currentDrawdownPct: 0,
  peakEquity: 0,
  currentEquity: 0,
  levelChangedAt: 0,
  lastCheckedAt: 0,
  consecutiveRecoveries: 0,
  history: [], // Last 20 level changes
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
    }
  } catch { /* fresh */ }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    if (rio) rio.writeJsonAtomic(STATE_FILE, state);
    else fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch { /* best effort */ }
}

loadState();

// ─── Drawdown Measurement ─────────────────────────────────────────────────────

/**
 * Compute current drawdown from trade journal P&L.
 * @returns {{ drawdownPct: number, peakEquity: number, currentEquity: number, windowTrades: number }}
 */
function measureDrawdown() {
  let totalPnl = 0;
  let peakPnl = 0;
  let troughPnl = 0;
  let windowTrades = 0;

  // Method 1: From trade journal
  if (tradeJournal && typeof tradeJournal.getStats === 'function') {
    try {
      const stats = tradeJournal.getStats({ sinceDays: LOOKBACK_HOURS / 24 });
      totalPnl = stats.netPnl || stats.totalPnlUsd || 0;
      windowTrades = stats.totalTrades || 0;
    } catch { /* fall through */ }
  }

  // Method 2: From risk-manager's rolling P&L
  if (riskManager && typeof riskManager.getRiskHealth === 'function') {
    try {
      const health = riskManager.getRiskHealth();
      if (health.drawdownPct !== undefined) {
        return {
          drawdownPct: Math.abs(health.drawdownPct || 0),
          peakEquity: health.peakEquity || 100,
          currentEquity: health.currentEquity || 100,
          windowTrades,
        };
      }
      if (health.dailyPnl !== undefined) {
        totalPnl = health.dailyPnl;
      }
    } catch { /* fall through */ }
  }

  // Compute from cumulative P&L curve
  const baseEquity = 100; // Normalized to $100
  const currentEquity = baseEquity + totalPnl;
  const peakEquity = Math.max(state.peakEquity || baseEquity, currentEquity);
  const drawdownPct = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;

  return {
    drawdownPct: Math.max(0, Math.round(drawdownPct * 100) / 100),
    peakEquity: Math.round(peakEquity * 100) / 100,
    currentEquity: Math.round(currentEquity * 100) / 100,
    windowTrades,
  };
}

// ─── Level Determination ──────────────────────────────────────────────────────

function getLevel(drawdownPct) {
  if (drawdownPct >= L4_THRESHOLD) return 4;
  if (drawdownPct >= L3_THRESHOLD) return 3;
  if (drawdownPct >= L2_THRESHOLD) return 2;
  if (drawdownPct >= L1_THRESHOLD) return 1;
  return 0;
}

function getLevelName(level) {
  return ['normal', 'caution', 'restricted', 'halted', 'emergency'][level] || 'unknown';
}

// ─── Core Check ───────────────────────────────────────────────────────────────

/**
 * Check drawdown and update circuit breaker level.
 *
 * @returns {{
 *   level: number,
 *   levelName: string,
 *   drawdownPct: number,
 *   tradingAllowed: boolean,
 *   maxTradesPerCycle: number,
 *   sizeMultiplier: number,
 *   changed: boolean,
 *   reason: string
 * }}
 */
function checkDrawdown() {
  const now = Date.now();
  const measurement = measureDrawdown();

  state.currentDrawdownPct = measurement.drawdownPct;
  state.peakEquity = Math.max(state.peakEquity, measurement.peakEquity);
  state.currentEquity = measurement.currentEquity;
  state.lastCheckedAt = now;

  const targetLevel = getLevel(measurement.drawdownPct);
  const prevLevel = state.level;
  let reason = '';

  // Escalation: always immediate
  if (targetLevel > state.level) {
    state.level = targetLevel;
    state.levelChangedAt = now;
    state.consecutiveRecoveries = 0;
    reason = `escalated: drawdown ${measurement.drawdownPct.toFixed(1)}% → L${targetLevel} (${getLevelName(targetLevel)})`;
    log.warn('circuit breaker escalated', { level: targetLevel, name: getLevelName(targetLevel), drawdownPct: measurement.drawdownPct });

    state.history.push({ from: prevLevel, to: targetLevel, reason, ts: new Date().toISOString() });
    if (state.history.length > 20) state.history = state.history.slice(-20);

    // Publish alert
    if (signalBus) {
      try {
        signalBus.publish({
          type: 'risk_alert',
          source: 'drawdown-breaker',
          confidence: 0.95,
          payload: {
            severity: targetLevel >= 3 ? 'critical' : targetLevel >= 2 ? 'warning' : 'info',
            level: targetLevel,
            levelName: getLevelName(targetLevel),
            drawdownPct: measurement.drawdownPct,
          },
          ttlMs: 3600000,
        });
      } catch { /* best effort */ }
    }

    // L4: Activate kill switch
    if (targetLevel >= 4 && riskManager && typeof riskManager.activateKillSwitch === 'function') {
      try {
        riskManager.activateKillSwitch('drawdown_circuit_breaker_L4');
        log.error('kill switch activated by drawdown breaker L4', { drawdownPct: measurement.drawdownPct });
      } catch { /* best effort */ }
    }
  }
  // De-escalation: requires recovery below threshold - buffer + min time
  else if (targetLevel < state.level) {
    const timeSinceLevelChange = now - state.levelChangedAt;
    const recoveryTarget = [0, L1_THRESHOLD - RECOVERY_BUFFER_PCT, L2_THRESHOLD - RECOVERY_BUFFER_PCT,
      L3_THRESHOLD - RECOVERY_BUFFER_PCT, L4_THRESHOLD - RECOVERY_BUFFER_PCT][state.level];

    if (measurement.drawdownPct <= Math.max(0, recoveryTarget) && timeSinceLevelChange >= MIN_RECOVERY_TIME_MS) {
      state.level = Math.max(0, state.level - 1); // Step down one level at a time
      state.levelChangedAt = now;
      state.consecutiveRecoveries++;
      reason = `de-escalated: drawdown ${measurement.drawdownPct.toFixed(1)}% → L${state.level} (${getLevelName(state.level)})`;
      log.info('circuit breaker de-escalated', { level: state.level, name: getLevelName(state.level), drawdownPct: measurement.drawdownPct });

      state.history.push({ from: prevLevel, to: state.level, reason, ts: new Date().toISOString() });
      if (state.history.length > 20) state.history = state.history.slice(-20);
    } else {
      reason = `holding L${state.level}: recovery not sufficient (dd=${measurement.drawdownPct.toFixed(1)}%, target=${recoveryTarget?.toFixed(1)}%, time=${Math.round(timeSinceLevelChange / 60000)}m/${Math.round(MIN_RECOVERY_TIME_MS / 60000)}m)`;
    }
  } else {
    reason = `steady at L${state.level} (${getLevelName(state.level)})`;
  }

  saveState();

  // Compute trading constraints for this level
  const constraints = getConstraints(state.level);

  return {
    level: state.level,
    levelName: getLevelName(state.level),
    drawdownPct: measurement.drawdownPct,
    ...constraints,
    changed: state.level !== prevLevel,
    reason,
  };
}

/**
 * Get trading constraints for a given level.
 * @param {number} level
 * @returns {{ tradingAllowed: boolean, maxTradesPerCycle: number, sizeMultiplier: number }}
 */
function getConstraints(level) {
  switch (level) {
    case 0: return { tradingAllowed: true, maxTradesPerCycle: Infinity, sizeMultiplier: 1.0 };
    case 1: return { tradingAllowed: true, maxTradesPerCycle: 2, sizeMultiplier: 0.75 };
    case 2: return { tradingAllowed: true, maxTradesPerCycle: 1, sizeMultiplier: 0.5 };
    case 3: return { tradingAllowed: false, maxTradesPerCycle: 0, sizeMultiplier: 0 };
    case 4: return { tradingAllowed: false, maxTradesPerCycle: 0, sizeMultiplier: 0 };
    default: return { tradingAllowed: true, maxTradesPerCycle: Infinity, sizeMultiplier: 1.0 };
  }
}

/**
 * Get full circuit breaker status.
 * @returns {object}
 */
function getStatus() {
  return {
    ...state,
    levelName: getLevelName(state.level),
    constraints: getConstraints(state.level),
    thresholds: { L1: L1_THRESHOLD, L2: L2_THRESHOLD, L3: L3_THRESHOLD, L4: L4_THRESHOLD },
    recoveryBuffer: RECOVERY_BUFFER_PCT,
    minRecoveryTimeMs: MIN_RECOVERY_TIME_MS,
  };
}

/**
 * Force reset to L0 (for manual override after maintenance).
 */
function reset() {
  const prev = state.level;
  state.level = 0;
  state.levelChangedAt = Date.now();
  state.consecutiveRecoveries = 0;
  state.history.push({ from: prev, to: 0, reason: 'manual_reset', ts: new Date().toISOString() });
  saveState();
  log.info('circuit breaker manually reset to L0');
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  checkDrawdown,
  getConstraints,
  getStatus,
  reset,
  measureDrawdown,
};
