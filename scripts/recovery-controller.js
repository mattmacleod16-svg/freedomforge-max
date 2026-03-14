#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.vercel.app').replace(/\/$/, '');
const ENABLED = String(process.env.RECOVERY_CONTROLLER_ENABLED || 'true').toLowerCase() !== 'false';
const WINDOW_HOURS = Math.max(1, Number(process.env.RECOVERY_WINDOW_HOURS || 2));
const LOG_LIMIT = Math.max(200, Number(process.env.RECOVERY_LOG_LIMIT || 3000));
const POSITIVE_WINDOWS_REQUIRED = Math.max(1, Number(process.env.RECOVERY_POSITIVE_WINDOWS_REQUIRED || 3));
const MIN_NET_ETH = Math.max(0.0001, Math.min(1.0, Number(process.env.RECOVERY_MIN_NET_ETH || 0.002)));
const MIN_SUCCESS_RATE = Math.max(0.1, Math.min(1.0, Number(process.env.RECOVERY_MIN_SUCCESS_RATE || 0.85)));
const MIN_ATTEMPTS = Math.max(1, Number(process.env.RECOVERY_MIN_ATTEMPTS || 3));
const AUTO_REDEPLOY = String(process.env.RECOVERY_AUTO_REDEPLOY || 'true').toLowerCase() === 'true';
const STATE_FILE = process.env.RECOVERY_STATE_FILE || 'data/recovery-controller-state.json';

// ── 5-Level Mode System ───────────────────────────────────────────────────────
// Promotion: safe → cautious → moderate → aggressive → full-live
// Demotion: drops 1 level on negative window, 2 levels on drawdown breach
const MODE_LADDER = ['safe', 'cautious', 'moderate', 'aggressive', 'full-live'];
const MODE_INDEX = Object.freeze(MODE_LADDER.reduce((acc, m, i) => { acc[m] = i; return acc; }, {}));
const MODE_COOLDOWN_HOURS = Math.max(1, Number(process.env.RECOVERY_MODE_COOLDOWN_HOURS || 6)); // Min 6h per mode
const DRAWDOWN_DEMOTE_PCT = Number(process.env.RECOVERY_DRAWDOWN_DEMOTE_PCT || 5); // 5% drawdown → emergency demote
const NEGATIVE_STREAK_EMERGENCY = Math.max(1, Number(process.env.RECOVERY_NEGATIVE_STREAK_EMERGENCY || 3)); // 3 negative → drop to safe

const { upsertEnvVar: platformUpsertEnvVar, redeploy: platformRedeploy, platform: deployPlatform } = require('../lib/deploy-platform');

function parseBigIntSafe(value) {
  try {
    if (value === undefined || value === null || value === '') return BigInt(0);
    return BigInt(String(value));
  } catch {
    return BigInt(0);
  }
}

function weiToEthNumber(wei) {
  const base = BigInt('1000000000000000000');
  const whole = Number(wei / base);
  const frac = Number(wei % base) / 1e18;
  return whole + frac;
}

function loadState(absPath) {
  if (!fs.existsSync(absPath)) {
    return { mode: 'safe', modeIndex: 0, positiveStreak: 0, negativeStreak: 0, lastUpdatedAt: 0, lastModeChangeAt: 0, modeHistory: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    // Migrate old 'phase2-conservative' mode to 'cautious'
    if (raw.mode === 'phase2-conservative') raw.mode = 'cautious';
    if (MODE_INDEX[raw.mode] === undefined) raw.mode = 'safe';
    raw.modeIndex = MODE_INDEX[raw.mode] || 0;
    raw.negativeStreak = raw.negativeStreak || 0;
    raw.lastModeChangeAt = raw.lastModeChangeAt || raw.lastUpdatedAt || 0;
    raw.modeHistory = raw.modeHistory || [];
    return raw;
  } catch {
    return { mode: 'safe', modeIndex: 0, positiveStreak: 0, negativeStreak: 0, lastUpdatedAt: 0, lastModeChangeAt: 0, modeHistory: [] };
  }
}

let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

function saveState(absPath, state) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  if (rio) { rio.writeJsonAtomic(absPath, state); }
  else { fs.writeFileSync(absPath, JSON.stringify(state, null, 2)); }
}

async function fetchJson(pathname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${APP_BASE_URL}${pathname}`, {
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${pathname}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function summarizeWindow(logs) {
  const cutoff = Date.now() - WINDOW_HOURS * 60 * 60 * 1000;
  let transferSuccess = 0;
  let transferFailed = 0;
  let payoutsWei = BigInt(0);
  let topupsWei = BigInt(0);

  for (const row of logs) {
    const ts = Date.parse(row?.time || '');
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const type = row?.type;
    const payload = row?.payload || {};

    if (type === 'transfer') {
      transferSuccess += 1;
      payoutsWei += parseBigIntSafe(payload.amount);
    }
    if (type === 'transfer_failed') transferFailed += 1;
    if (type === 'gas_topup') {
      const amountEth = Number(payload.amount || 0) || 0;
      topupsWei += BigInt(Math.floor(amountEth * 1e18));
    }
  }

  const attempts = transferSuccess + transferFailed;
  const successRate = attempts > 0 ? transferSuccess / attempts : 1;
  const netEth = weiToEthNumber(payoutsWei - topupsWei);
  const isPositive = attempts >= MIN_ATTEMPTS && successRate >= MIN_SUCCESS_RATE && netEth >= MIN_NET_ETH;

  return {
    attempts,
    transferSuccess,
    transferFailed,
    successRate,
    netEth,
    isPositive,
  };
}

async function upsertEnvVar(key, value) {
  return platformUpsertEnvVar(key, value);
}

async function tryRedeployLatestProduction() {
  return platformRedeploy();
}

function profileForMode(mode) {
  // 5-level risk profiles with progressively less conservative settings
  const profiles = {
    'safe': {
      POLY_CLOB_ENABLED: 'false',
      POLY_CLOB_DRY_RUN: 'true',
      CONVERSION_ENGINE_ENABLED: 'false',
      CONVERSION_ENGINE_DRY_RUN: 'true',
      MIN_PAYOUT_ETH_POLYGON_MAINNET: '10',
      MIN_PAYOUT_GAS_MULTIPLIER_POLYGON_MAINNET: '100',
      GAS_RESERVE_ETH_POLYGON_MAINNET: '100',
      GAS_TOPUP_THRESHOLD_POLYGON_MAINNET: '100',
      GAS_TOPUP_AMOUNT_POLYGON_MAINNET: '0',
      SELF_SUSTAIN_REINVEST_BPS_POLYGON_MAINNET: '9800',
      MAX_TRADES_PER_CYCLE: '1',
      BASE_ORDER_USD: '10',
    },
    'cautious': {
      POLY_CLOB_ENABLED: 'false',
      POLY_CLOB_DRY_RUN: 'true',
      CONVERSION_ENGINE_ENABLED: 'false',
      CONVERSION_ENGINE_DRY_RUN: 'true',
      MIN_PAYOUT_ETH_POLYGON_MAINNET: '5',
      MIN_PAYOUT_GAS_MULTIPLIER_POLYGON_MAINNET: '60',
      GAS_RESERVE_ETH_POLYGON_MAINNET: '20',
      GAS_TOPUP_THRESHOLD_POLYGON_MAINNET: '20',
      GAS_TOPUP_AMOUNT_POLYGON_MAINNET: '0',
      SELF_SUSTAIN_REINVEST_BPS_POLYGON_MAINNET: '9800',
      MAX_TRADES_PER_CYCLE: '2',
      BASE_ORDER_USD: '12',
    },
    'moderate': {
      POLY_CLOB_ENABLED: 'true',
      POLY_CLOB_DRY_RUN: 'true',
      CONVERSION_ENGINE_ENABLED: 'true',
      CONVERSION_ENGINE_DRY_RUN: 'true',
      MIN_PAYOUT_ETH_POLYGON_MAINNET: '3',
      MIN_PAYOUT_GAS_MULTIPLIER_POLYGON_MAINNET: '40',
      GAS_RESERVE_ETH_POLYGON_MAINNET: '10',
      GAS_TOPUP_THRESHOLD_POLYGON_MAINNET: '10',
      GAS_TOPUP_AMOUNT_POLYGON_MAINNET: '0',
      SELF_SUSTAIN_REINVEST_BPS_POLYGON_MAINNET: '9500',
      MAX_TRADES_PER_CYCLE: '3',
      BASE_ORDER_USD: '15',
    },
    'aggressive': {
      POLY_CLOB_ENABLED: 'true',
      POLY_CLOB_DRY_RUN: 'false',
      CONVERSION_ENGINE_ENABLED: 'true',
      CONVERSION_ENGINE_DRY_RUN: 'false',
      MIN_PAYOUT_ETH_POLYGON_MAINNET: '2',
      MIN_PAYOUT_GAS_MULTIPLIER_POLYGON_MAINNET: '20',
      GAS_RESERVE_ETH_POLYGON_MAINNET: '5',
      GAS_TOPUP_THRESHOLD_POLYGON_MAINNET: '5',
      GAS_TOPUP_AMOUNT_POLYGON_MAINNET: '0.01',
      SELF_SUSTAIN_REINVEST_BPS_POLYGON_MAINNET: '9000',
      MAX_TRADES_PER_CYCLE: '4',
      BASE_ORDER_USD: '20',
    },
    'full-live': {
      POLY_CLOB_ENABLED: 'true',
      POLY_CLOB_DRY_RUN: 'false',
      CONVERSION_ENGINE_ENABLED: 'true',
      CONVERSION_ENGINE_DRY_RUN: 'false',
      MIN_PAYOUT_ETH_POLYGON_MAINNET: '1',
      MIN_PAYOUT_GAS_MULTIPLIER_POLYGON_MAINNET: '10',
      GAS_RESERVE_ETH_POLYGON_MAINNET: '3',
      GAS_TOPUP_THRESHOLD_POLYGON_MAINNET: '3',
      GAS_TOPUP_AMOUNT_POLYGON_MAINNET: '0.02',
      SELF_SUSTAIN_REINVEST_BPS_POLYGON_MAINNET: '8500',
      MAX_TRADES_PER_CYCLE: '5',
      BASE_ORDER_USD: '25',
    },
  };

  return profiles[mode] || profiles['safe'];
}

async function applyMode(mode) {
  const updates = profileForMode(mode);
  for (const [key, value] of Object.entries(updates)) {
    await upsertEnvVar(key, value);
  }
  if (AUTO_REDEPLOY) {
    try {
      await tryRedeployLatestProduction();
    } catch (error) {
      console.warn(`recovery-controller redeploy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function main() {
  if (!ENABLED) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'RECOVERY_CONTROLLER_ENABLED=false' }, null, 2));
    return;
  }

  const logsPayload = await fetchJson(`/api/alchemy/wallet/logs?limit=${LOG_LIMIT}`);
  const logs = Array.isArray(logsPayload?.logs) ? logsPayload.logs : [];
  const window = summarizeWindow(logs);

  // ═══ ENHANCED: Also check trade journal for dry-run profitability ═══
  // If wallet logs show 0 attempts (common during DRY_RUN mode), check
  // whether the orchestrator's simulated trades have been profitable.
  // This prevents the system from being stuck in 'safe' mode forever
  // when DRY_RUN=true prevents actual wallet transactions.
  let journalPositive = false;
  let journalStats = null;
  if (window.attempts < MIN_ATTEMPTS) {
    try {
      const journalPath = path.resolve(process.cwd(), 'data/trade-journal.json');
      if (fs.existsSync(journalPath)) {
        const journalData = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
        const trades = Array.isArray(journalData) ? journalData : (journalData.trades || []);
        const cutoff = Date.now() - WINDOW_HOURS * 60 * 60 * 1000;
        const recentTrades = trades.filter(t => {
          const ts = Date.parse(t?.openedAt || t?.closedAt || '');
          return Number.isFinite(ts) && ts >= cutoff;
        });

        const closedRecent = recentTrades.filter(t => t.closedAt && t.pnl != null);
        const totalPnl = closedRecent.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
        const winCount = closedRecent.filter(t => (Number(t.pnl) || 0) > 0).length;
        const journalAttempts = recentTrades.length;

        journalStats = {
          recentTrades: journalAttempts,
          closedTrades: closedRecent.length,
          totalPnl: Math.round(totalPnl * 100) / 100,
          winRate: closedRecent.length > 0 ? Math.round(winCount / closedRecent.length * 100) / 100 : 0,
        };

        // Journal counts as positive if:
        // 1. At least MIN_ATTEMPTS dry-run trades in the window
        // 2. Closed trades have net positive P&L
        // 3. Win rate >= 50%
        if (journalAttempts >= MIN_ATTEMPTS && closedRecent.length >= 2 && totalPnl > 0 && winCount / closedRecent.length >= 0.5) {
          journalPositive = true;
        }
      }
    } catch (err) {
      // Non-fatal — fall through to wallet-only logic
      console.warn(`Journal check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Also check orchestrator state for cycle health
  let orchestratorHealthy = false;
  try {
    const orchStatePath = path.resolve(process.cwd(), 'data/orchestrator-state.json');
    if (fs.existsSync(orchStatePath)) {
      const orchState = JSON.parse(fs.readFileSync(orchStatePath, 'utf8'));
      const sinceLastCycle = Date.now() - (orchState.lastRunAt || 0);
      // Orchestrator ran within last 10 minutes and has completed >5 cycles
      orchestratorHealthy = sinceLastCycle < 10 * 60 * 1000 && (orchState.cycleCount || 0) >= 5;
    }
  } catch { /* ignore */ }

  const statePath = path.resolve(process.cwd(), STATE_FILE);
  const state = loadState(statePath);

  // Window is positive if either wallet logs OR journal data show positive performance
  const windowIsPositive = window.isPositive || (journalPositive && orchestratorHealthy);
  const nextPositiveStreak = windowIsPositive ? state.positiveStreak + 1 : 0;
  const nextNegativeStreak = !windowIsPositive ? (state.negativeStreak || 0) + 1 : 0;

  // ── Check drawdown from risk-manager state ──────────────────────────────
  let drawdownPct = 0;
  let drawdownBreach = false;
  try {
    const riskStatePath = path.resolve(process.cwd(), 'data/risk-manager-state.json');
    if (fs.existsSync(riskStatePath)) {
      const riskState = JSON.parse(fs.readFileSync(riskStatePath, 'utf8'));
      drawdownPct = Math.abs(Number(riskState.currentDrawdownPct || riskState.drawdownPct || 0));
      drawdownBreach = drawdownPct >= DRAWDOWN_DEMOTE_PCT;
    }
  } catch { /* ignore */ }

  // ── Mode transition logic: 5-level ladder with cooldown ─────────────────
  const currentModeIdx = MODE_INDEX[state.mode] !== undefined ? MODE_INDEX[state.mode] : 0;
  const cooldownMs = MODE_COOLDOWN_HOURS * 60 * 60 * 1000;
  const timeSinceLastChange = Date.now() - (state.lastModeChangeAt || 0);
  const cooldownMet = timeSinceLastChange >= cooldownMs;

  let nextModeIdx = currentModeIdx;
  let transitionReason = 'hold';

  // Emergency: drawdown breach → drop 2 levels
  if (drawdownBreach) {
    nextModeIdx = Math.max(0, currentModeIdx - 2);
    transitionReason = `drawdown_emergency: ${drawdownPct.toFixed(1)}% >= ${DRAWDOWN_DEMOTE_PCT}% threshold`;
  }
  // Emergency: too many consecutive negative windows → drop to safe
  else if (nextNegativeStreak >= NEGATIVE_STREAK_EMERGENCY) {
    nextModeIdx = 0; // safe
    transitionReason = `negative_streak_emergency: ${nextNegativeStreak} consecutive negative windows`;
  }
  // Demotion: single negative window → drop 1 level (cooldown ignored for demotions)
  else if (!windowIsPositive && currentModeIdx > 0) {
    nextModeIdx = currentModeIdx - 1;
    transitionReason = `demotion: negative window (attempts=${window.attempts}, successRate=${window.successRate.toFixed(2)}, netEth=${window.netEth.toFixed(4)})`;
  }
  // Promotion: enough positive windows + cooldown met → promote 1 level
  else if (windowIsPositive && nextPositiveStreak >= POSITIVE_WINDOWS_REQUIRED && cooldownMet && currentModeIdx < MODE_LADDER.length - 1) {
    nextModeIdx = currentModeIdx + 1;
    transitionReason = `promotion: ${nextPositiveStreak} positive windows (needed ${POSITIVE_WINDOWS_REQUIRED}), cooldown met`;
  }
  // Hold: positive but not enough streak or cooldown
  else if (windowIsPositive) {
    transitionReason = `hold: positive window ${nextPositiveStreak}/${POSITIVE_WINDOWS_REQUIRED}` +
      (!cooldownMet ? `, cooldown ${Math.round(timeSinceLastChange / 60000)}m/${MODE_COOLDOWN_HOURS * 60}m` : '');
  }

  const nextMode = MODE_LADDER[nextModeIdx];

  let changed = false;
  if (nextMode !== state.mode) {
    await applyMode(nextMode);
    changed = true;
  }

  const nextState = {
    mode: nextMode,
    modeIndex: nextModeIdx,
    positiveStreak: nextPositiveStreak,
    negativeStreak: nextNegativeStreak,
    lastModeChangeAt: changed ? Date.now() : (state.lastModeChangeAt || Date.now()),
    lastUpdatedAt: Date.now(),
    transitionReason,
    drawdownPct,
    lastWindow: {
      ...window,
      journalPositive,
      journalStats,
      orchestratorHealthy,
      windowIsPositive,
      ts: new Date().toISOString(),
    },
    modeHistory: [
      ...(state.modeHistory || []).slice(-19), // Keep last 20 transitions
      ...(changed ? [{ from: state.mode, to: nextMode, reason: transitionReason, ts: new Date().toISOString() }] : []),
    ],
  };

  saveState(statePath, nextState);

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        changed,
        fromMode: state.mode,
        toMode: nextMode,
        modeIndex: nextModeIdx,
        modeLadder: MODE_LADDER,
        positiveStreak: nextPositiveStreak,
        negativeStreak: nextNegativeStreak,
        requiredPositiveStreak: POSITIVE_WINDOWS_REQUIRED,
        cooldownHours: MODE_COOLDOWN_HOURS,
        cooldownMet,
        drawdownPct,
        drawdownBreach,
        transitionReason,
        window,
        stateFile: STATE_FILE,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
