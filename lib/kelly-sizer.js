/**
 * Kelly Criterion Position Sizer — FreedomForge
 * ═══════════════════════════════════════════════════════════════════════════
 * Implements the Kelly formula with fractional Kelly safety and dynamic
 * calibration from live trade history.
 *
 * Full Kelly: f* = (bp - q) / b
 *   where b = odds (avg_win / avg_loss), p = win rate, q = 1 - p
 *
 * We use Fractional Kelly (default: half-Kelly) to reduce variance while
 * still compounding faster than a fixed-fraction system.
 *
 * Features:
 *   - Auto-calibrates from trade history (updates after every trade)
 *   - Regime-aware: scales Kelly fraction based on regime confidence
 *   - Account-size-aware: Kelly bet = fraction of total equity
 *   - Hard caps: never risk more than MAX_KELLY_PCT of account per trade
 *   - Bootstrapped from Bayesian optimizer results if no trade history yet
 *   - Persists calibration state to data/kelly-state.json
 *
 * Exports:
 *   kellySize(params)        — main sizing call, returns USD amount
 *   recordOutcome(outcome)   — feed trade result to calibrator
 *   getKellyStats()          — full calibration stats
 *   calibrateFromHistory(trades) — bulk calibrate from trade array
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let log;
try { const { createLogger } = require('./logger'); log = createLogger('kelly-sizer'); }
catch { log = { info: console.log, warn: console.warn, error: console.error, debug() {} }; }

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

// ── Config ────────────────────────────────────────────────────────────────────
const STATE_FILE       = path.resolve(process.cwd(), 'data/kelly-state.json');
const KELLY_FRACTION   = Math.max(0.1, Math.min(1.0, Number(process.env.KELLY_FRACTION   || 0.5)));  // half-Kelly default
const MAX_KELLY_PCT    = Math.max(0.01, Math.min(0.25, Number(process.env.MAX_KELLY_PCT   || 0.05))); // never risk > 5% per trade
const MIN_KELLY_PCT    = Math.max(0.001, Math.min(0.05, Number(process.env.MIN_KELLY_PCT  || 0.005)));// never risk < 0.5%
const MIN_TRADES_FOR_KELLY = parseInt(process.env.KELLY_MIN_TRADES || '20', 10); // fallback to default until enough history
const LOOKBACK_TRADES  = parseInt(process.env.KELLY_LOOKBACK || '100', 10);      // use last N trades for calibration
const DEFAULT_ACCOUNT  = Number(process.env.TRADING_ACCOUNT_USD || 1000);

// ── Bootstrapped priors (from Bayesian optimizer baseline) ───────────────────
// These are the defaults before we have enough live trade history
const PRIOR_WIN_RATE   = 0.54;  // 54% win rate — conservative prior
const PRIOR_AVG_WIN    = 1.018; // avg win = 1.8% of position
const PRIOR_AVG_LOSS   = 0.025; // avg loss = 2.5% of position (slightly worse than win)

// ── State ─────────────────────────────────────────────────────────────────────
let _state = {
  trades: [],           // recent trade outcomes
  calibration: null,    // last computed Kelly params
  accountUsd: DEFAULT_ACCOUNT,
  lastUpdated: 0,
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      _state = { ..._state, ...s };
    }
  } catch {}
}

async function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const payload = JSON.stringify(_state, null, 2);
    if (rio) await rio.writeJsonAtomic(STATE_FILE, JSON.parse(payload));
    else fs.writeFileSync(STATE_FILE, payload);
  } catch (e) { log.warn('Kelly state save failed: ' + e.message); }
}

loadState();

// ── Core Kelly Calculation ─────────────────────────────────────────────────────
/**
 * Compute raw Kelly fraction from win rate + odds ratio.
 * Returns a value in [0, 1] representing fraction of bankroll to risk.
 *
 * @param {number} winRate  - probability of winning (0-1)
 * @param {number} avgWin   - average win as fraction of stake (e.g. 0.02 = 2%)
 * @param {number} avgLoss  - average loss as fraction of stake (e.g. 0.025 = 2.5%)
 */
function rawKelly(winRate, avgWin, avgLoss) {
  if (avgLoss <= 0 || avgWin <= 0) return 0;
  const p = winRate;
  const q = 1 - p;
  const b = avgWin / avgLoss;  // odds ratio
  const kelly = (b * p - q) / b;
  return Math.max(0, kelly);   // never go negative (don't bet when edge is negative)
}

// ── Calibrate from trade array ─────────────────────────────────────────────────
function computeCalibration(trades) {
  if (!trades || trades.length === 0) return null;

  const recent = trades.slice(-LOOKBACK_TRADES);
  const wins   = recent.filter(t => t.pnlPct > 0);
  const losses = recent.filter(t => t.pnlPct <= 0);

  if (wins.length === 0 && losses.length === 0) return null;

  const winRate = recent.length > 0 ? wins.length / recent.length : PRIOR_WIN_RATE;
  const avgWin  = wins.length > 0
    ? wins.reduce((a, t) => a + t.pnlPct, 0) / wins.length
    : PRIOR_AVG_WIN;
  const avgLoss = losses.length > 0
    ? Math.abs(losses.reduce((a, t) => a + t.pnlPct, 0) / losses.length)
    : PRIOR_AVG_LOSS;

  const kelly        = rawKelly(winRate, avgWin, avgLoss);
  const fractional   = kelly * KELLY_FRACTION;
  const clamped      = Math.max(MIN_KELLY_PCT, Math.min(MAX_KELLY_PCT, fractional));
  const expectancy   = winRate * avgWin - (1 - winRate) * avgLoss;
  const profitFactor = losses.length > 0 && avgLoss > 0
    ? (wins.length * avgWin) / (losses.length * avgLoss)
    : 0;

  return {
    winRate:       parseFloat(winRate.toFixed(4)),
    avgWinPct:     parseFloat(avgWin.toFixed(4)),
    avgLossPct:    parseFloat(avgLoss.toFixed(4)),
    oddsRatio:     parseFloat((avgWin / avgLoss).toFixed(4)),
    rawKelly:      parseFloat(kelly.toFixed(4)),
    fractionalKelly: parseFloat(fractional.toFixed(4)),
    clampedKelly:  parseFloat(clamped.toFixed(4)),
    expectancy:    parseFloat(expectancy.toFixed(4)),
    profitFactor:  parseFloat(profitFactor.toFixed(4)),
    tradeCount:    recent.length,
    usingPriors:   recent.length < MIN_TRADES_FOR_KELLY,
    calibratedAt:  new Date().toISOString(),
  };
}

// ── Regime confidence modifier ─────────────────────────────────────────────────
// In high-confidence regimes (strong bull/bear), we scale up slightly
// In low-confidence or extreme vol, we scale down
function regimeModifier(regime) {
  if (!regime) return 1.0;
  const { mode, confidence = 0.5, volatility } = regime;
  if (volatility === 'extreme')    return 0.40;  // black swan protection
  if (volatility === 'high')       return 0.65;
  if (mode === 'bullTrend')        return 0.8 + confidence * 0.4;  // 0.8-1.2
  if (mode === 'bearTrend')        return 0.5 + confidence * 0.3;  // 0.5-0.8 (conservative in bear)
  if (mode === 'sideways')         return 0.70;
  return 1.0;
}

// ── Main sizing function ───────────────────────────────────────────────────────
/**
 * Compute Kelly-optimal position size in USD.
 *
 * @param {object} params
 * @param {number}  params.accountUsd    - Total account equity in USD
 * @param {number}  params.confidence    - Signal confidence (0-1) from edge detector
 * @param {object}  [params.regime]      - Current regime object from regime-detector-v2
 * @param {string}  [params.asset]       - Asset being sized
 * @param {boolean} [params.usePriors]   - Force use of prior params (ignores live history)
 * @returns {{sizeUsd: number, details: object}}
 */
function kellySize(params = {}) {
  const {
    accountUsd  = _state.accountUsd || DEFAULT_ACCOUNT,
    confidence  = 0.56,
    regime      = null,
    asset       = 'BTC',
    usePriors   = false,
  } = params;

  // Get or compute calibration
  let cal = _state.calibration;
  const hasEnoughHistory = _state.trades.length >= MIN_TRADES_FOR_KELLY;

  if (!cal || usePriors || !hasEnoughHistory) {
    // Use priors — calibrate from prior params
    cal = {
      winRate:         PRIOR_WIN_RATE,
      avgWinPct:       PRIOR_AVG_WIN,
      avgLossPct:      PRIOR_AVG_LOSS,
      oddsRatio:       PRIOR_AVG_WIN / PRIOR_AVG_LOSS,
      rawKelly:        rawKelly(PRIOR_WIN_RATE, PRIOR_AVG_WIN, PRIOR_AVG_LOSS),
      fractionalKelly: rawKelly(PRIOR_WIN_RATE, PRIOR_AVG_WIN, PRIOR_AVG_LOSS) * KELLY_FRACTION,
      clampedKelly:    Math.max(MIN_KELLY_PCT, Math.min(MAX_KELLY_PCT, rawKelly(PRIOR_WIN_RATE, PRIOR_AVG_WIN, PRIOR_AVG_LOSS) * KELLY_FRACTION)),
      expectancy:      PRIOR_WIN_RATE * PRIOR_AVG_WIN - (1 - PRIOR_WIN_RATE) * PRIOR_AVG_LOSS,
      profitFactor:    (PRIOR_WIN_RATE * PRIOR_AVG_WIN) / ((1 - PRIOR_WIN_RATE) * PRIOR_AVG_LOSS),
      tradeCount:      _state.trades.length,
      usingPriors:     true,
    };
  }

  // Confidence scaling: confidence acts as a multiplier on the Kelly fraction
  // High confidence = trade fuller Kelly; low confidence = trade smaller
  const confScale   = 0.3 + 0.7 * Math.pow(Math.max(0, Math.min(1, confidence)), 1.5);

  // Regime modifier
  const regMod      = regimeModifier(regime);

  // Final Kelly fraction of account
  const kellyFrac   = cal.clampedKelly * confScale * regMod;
  const sizeUsd     = parseFloat((accountUsd * Math.max(MIN_KELLY_PCT, Math.min(MAX_KELLY_PCT, kellyFrac))).toFixed(2));

  const details = {
    asset,
    accountUsd,
    confidence,
    confScale:      parseFloat(confScale.toFixed(4)),
    regimeModifier: parseFloat(regMod.toFixed(4)),
    kellyFraction:  parseFloat(kellyFrac.toFixed(4)),
    sizeUsd,
    calibration:    cal,
    usingPriors:    cal.usingPriors,
  };

  log.info(`Kelly size [${asset}]: $${sizeUsd} (${(kellyFrac*100).toFixed(2)}% of $${accountUsd}) | conf=${confidence.toFixed(2)} | regMod=${regMod.toFixed(2)} | WR=${cal.winRate.toFixed(2)}`);

  return { sizeUsd, details };
}

// ── Record trade outcome ───────────────────────────────────────────────────────
/**
 * Feed a trade result back into the Kelly calibrator.
 * Call this after every closed trade.
 *
 * @param {object} outcome
 * @param {number}  outcome.pnlPct     - PnL as fraction of position (e.g. 0.02 = +2%, -0.025 = -2.5%)
 * @param {string}  [outcome.asset]    - Asset traded
 * @param {string}  [outcome.regime]   - Regime mode at trade time
 * @param {number}  [outcome.entryUsd] - Position size in USD
 */
async function recordOutcome(outcome) {
  if (typeof outcome.pnlPct !== 'number') return;
  _state.trades.push({
    pnlPct:   outcome.pnlPct,
    asset:    outcome.asset || 'unknown',
    regime:   outcome.regime || 'unknown',
    entryUsd: outcome.entryUsd || 0,
    ts:       Date.now(),
  });
  // Keep only last 500 trades in memory
  if (_state.trades.length > 500) _state.trades = _state.trades.slice(-500);

  // Recalibrate every 5 trades
  if (_state.trades.length % 5 === 0) {
    _state.calibration = computeCalibration(_state.trades);
    log.info(`Kelly recalibrated: WR=${_state.calibration?.winRate} | rawKelly=${_state.calibration?.rawKelly} | clamped=${_state.calibration?.clampedKelly}`);
  }

  _state.lastUpdated = Date.now();
  await saveState();
}

// ── Bulk calibrate from history ────────────────────────────────────────────────
function calibrateFromHistory(trades) {
  _state.trades       = trades.slice(-500);
  _state.calibration  = computeCalibration(_state.trades);
  _state.lastUpdated  = Date.now();
  saveState();
  return _state.calibration;
}

// ── Update account equity ──────────────────────────────────────────────────────
function updateAccountEquity(usd) {
  _state.accountUsd = usd;
  saveState();
}

// ── Stats ──────────────────────────────────────────────────────────────────────
function getKellyStats() {
  const cal = _state.calibration || computeCalibration(_state.trades);
  return {
    calibration:   cal,
    tradeHistory:  _state.trades.length,
    accountUsd:    _state.accountUsd,
    kellyFraction: KELLY_FRACTION,
    maxKellyPct:   MAX_KELLY_PCT,
    minKellyPct:   MIN_KELLY_PCT,
    lastUpdated:   new Date(_state.lastUpdated).toISOString(),
  };
}

module.exports = {
  kellySize,
  recordOutcome,
  calibrateFromHistory,
  updateAccountEquity,
  getKellyStats,
  rawKelly,
  computeCalibration,
};
