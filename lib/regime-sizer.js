/**
 * Regime-Aware Position Sizer
 * ═══════════════════════════
 *
 * Dynamically adjusts position sizes based on the current market regime
 * detected by the signal bus. Integrates with the brain's regime detection,
 * VIX proxy, funding rates, and correlation data.
 *
 * Regimes:
 *   risk_on     → aggressive sizing (1.3x multiplier)
 *   neutral     → standard sizing (1.0x)
 *   risk_off    → conservative sizing (0.5x)
 *   crisis      → minimal sizing (0.2x) or halt
 *
 * Also factors:
 *   - Time-of-day seasonality (London/NY overlap = best)
 *   - Day-of-week (weekends = reduced)
 *   - Volatility percentile (high vol = smaller size)
 *   - Streak momentum (winning streak = compound, losing = shrink)
 *
 * Exports:
 *   regimeAdjustedSize(params)   - main sizing function
 *   getCurrentRegime()           - detected regime + confidence
 *   getStats()                   - sizer statistics
 */

'use strict';

const { createLogger } = require('./logger');
const log = createLogger('regime-sizer');

// ─── Configuration ───────────────────────────────────────────────────────────

const REGIME_SIZING = {
  risk_on:  Math.max(0.5, Math.min(2.0, Number(process.env.REGIME_SIZE_RISK_ON  || 1.3))),
  neutral:  1.0,
  risk_off: Math.max(0.1, Math.min(1.0, Number(process.env.REGIME_SIZE_RISK_OFF || 0.5))),
  crisis:   Math.max(0.05, Math.min(0.5, Number(process.env.REGIME_SIZE_CRISIS  || 0.2))),
};

const VOL_PERCENTILE_SHRINK = Math.max(50, Number(process.env.REGIME_VOL_SHRINK_PCT || 80));
const STREAK_COMPOUND_FACTOR = Math.max(1.0, Math.min(1.5, Number(process.env.REGIME_STREAK_COMPOUND || 1.08)));
const STREAK_SHRINK_FACTOR   = Math.max(0.5, Math.min(1.0, Number(process.env.REGIME_STREAK_SHRINK   || 0.85)));
const MAX_COMPOUND_STREAK    = Math.max(1, Number(process.env.REGIME_MAX_COMPOUND_STREAK || 5));
const WEEKEND_MULTIPLIER     = Math.max(0.1, Math.min(1.0, Number(process.env.REGIME_WEEKEND_MULT || 0.6)));

// ─── Regime Detection ────────────────────────────────────────────────────────

let _lastRegime = { regime: 'neutral', confidence: 0.5, detectedAt: 0, source: 'default' };

/**
 * Detect the current market regime from multiple signals.
 * Checks (in priority order):
 *   1. Signal bus regime broadcasts (from brain/edge-detector)
 *   2. Funding rate extremes (from Binance)
 *   3. Recent PnL streak analysis
 *   4. Default to neutral
 */
function detectRegime() {
  const now = Date.now();
  const signals = [];

  // 1. Check signal bus for regime signals
  try {
    const signalBus = require('./agent-signal-bus');
    const regimeSignals = signalBus.query({ type: 'regime_update', maxAgeMs: 15 * 60 * 1000 });
    if (regimeSignals.length > 0) {
      const latest = regimeSignals[regimeSignals.length - 1];
      signals.push({
        regime: latest.payload?.regime || 'neutral',
        confidence: Number(latest.payload?.confidence || 0.5),
        source: 'signal_bus',
        weight: 2.0,
      });
    }

    // Check for market features signal
    const marketFeatures = signalBus.query({ type: 'market_features', maxAgeMs: 15 * 60 * 1000 });
    if (marketFeatures.length > 0) {
      const latest = marketFeatures[marketFeatures.length - 1];
      const volPct = latest.payload?.volatilityPercentile;
      if (volPct !== undefined) {
        const volRegime = volPct > 90 ? 'crisis' : volPct > 75 ? 'risk_off' : volPct < 25 ? 'risk_on' : 'neutral';
        signals.push({ regime: volRegime, confidence: 0.6, source: 'volatility', weight: 1.0 });
      }
    }

    // Check funding rate signal
    const fundingSignals = signalBus.query({ type: 'funding_rate', maxAgeMs: 30 * 60 * 1000 });
    if (fundingSignals.length > 0) {
      const latest = fundingSignals[fundingSignals.length - 1];
      const rate = Number(latest.payload?.fundingRate || 0);
      // Extreme positive funding = overheated longs → risk_off for longs
      // Extreme negative funding = squeezed shorts → risk_on
      if (Math.abs(rate) > 0.001) {
        const fundRegime = rate > 0.001 ? 'risk_off' : rate < -0.001 ? 'risk_on' : 'neutral';
        signals.push({ regime: fundRegime, confidence: 0.5, source: 'funding_rate', weight: 0.8 });
      }
    }
  } catch { /* signal bus not available */ }

  // 2. Check trade journal for recent streak
  try {
    const tradeJournal = require('./trade-journal');
    const recent = tradeJournal.getRecentTrades ? tradeJournal.getRecentTrades(20) : [];
    if (recent.length >= 5) {
      const wins = recent.filter(t => (t.pnl || t.pnlUsd || 0) > 0).length;
      const winRate = wins / recent.length;
      if (winRate > 0.7) signals.push({ regime: 'risk_on', confidence: 0.4, source: 'streak', weight: 0.5 });
      else if (winRate < 0.3) signals.push({ regime: 'risk_off', confidence: 0.4, source: 'streak', weight: 0.5 });
    }
  } catch { /* trade journal not available */ }

  // 3. Weighted vote
  if (signals.length === 0) {
    _lastRegime = { regime: 'neutral', confidence: 0.5, detectedAt: now, source: 'default' };
    return _lastRegime;
  }

  const regimeScores = { risk_on: 0, neutral: 0, risk_off: 0, crisis: 0 };
  let totalWeight = 0;
  for (const sig of signals) {
    const r = sig.regime in regimeScores ? sig.regime : 'neutral';
    regimeScores[r] += sig.confidence * sig.weight;
    totalWeight += sig.weight;
  }

  // Find winning regime
  let bestRegime = 'neutral';
  let bestScore = 0;
  for (const [r, score] of Object.entries(regimeScores)) {
    if (score > bestScore) { bestRegime = r; bestScore = score; }
  }

  const confidence = totalWeight > 0 ? Math.min(1.0, bestScore / totalWeight) : 0.5;
  _lastRegime = { regime: bestRegime, confidence, detectedAt: now, source: signals.map(s => s.source).join('+') };

  return _lastRegime;
}

function getCurrentRegime() {
  // Refresh if stale (> 5 min)
  if (Date.now() - _lastRegime.detectedAt > 5 * 60 * 1000) {
    detectRegime();
  }
  return { ..._lastRegime };
}

// ─── Time-of-Day / Day-of-Week Adjustments ──────────────────────────────────

function getTimeMultiplier() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 6=Sat

  // Weekend reduction
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return WEEKEND_MULTIPLIER;
  }

  // Prime trading hours (London + NY overlap: 13-17 UTC)
  if (utcHour >= 13 && utcHour <= 17) return 1.15;
  // Asian session (00-08 UTC) — decent liquidity
  if (utcHour >= 0 && utcHour <= 8) return 1.0;
  // Off-peak (early morning US, late night EU)
  if (utcHour >= 21 || utcHour <= 5) return 0.85;

  return 1.0;
}

// ─── Streak Tracking ─────────────────────────────────────────────────────────

let _streak = { count: 0, direction: 'none' }; // positive = wins, negative = losses

function recordTradeOutcome(won) {
  if (won) {
    if (_streak.direction === 'win') {
      _streak.count = Math.min(_streak.count + 1, MAX_COMPOUND_STREAK);
    } else {
      _streak = { count: 1, direction: 'win' };
    }
  } else {
    if (_streak.direction === 'loss') {
      _streak.count = Math.min(_streak.count + 1, MAX_COMPOUND_STREAK);
    } else {
      _streak = { count: 1, direction: 'loss' };
    }
  }
}

function getStreakMultiplier() {
  if (_streak.count === 0) return 1.0;
  if (_streak.direction === 'win') {
    return Math.min(1.5, Math.pow(STREAK_COMPOUND_FACTOR, _streak.count));
  }
  return Math.max(0.3, Math.pow(STREAK_SHRINK_FACTOR, _streak.count));
}

// ─── Main Sizing Function ───────────────────────────────────────────────────

let _calls = 0;

/**
 * Compute regime-aware position size.
 *
 * @param {object} params
 * @param {number} params.baseUsd       - Base order size from risk manager
 * @param {number} params.confidence    - Signal confidence (0-1)
 * @param {number} params.edge          - Detected edge magnitude
 * @param {string} params.asset         - Asset symbol
 * @returns {number} Adjusted order size in USD
 */
function regimeAdjustedSize(params) {
  const { baseUsd = 15, confidence = 0.5, edge = 0, asset = 'BTC' } = params;
  _calls++;

  // 1. Regime multiplier
  const regime = getCurrentRegime();
  const regimeMult = REGIME_SIZING[regime.regime] || 1.0;

  // 2. Time multiplier
  const timeMult = getTimeMultiplier();

  // 3. Streak multiplier
  const streakMult = getStreakMultiplier();

  // 4. Confidence scaling (square root for diminishing returns)
  const confMult = 0.5 + 0.5 * Math.sqrt(Math.max(0, Math.min(1, confidence)));

  // 5. Edge bonus (larger edge = slightly larger size)
  const edgeMult = 1.0 + Math.min(0.3, Math.max(0, edge) * 2);

  const adjusted = baseUsd * regimeMult * timeMult * streakMult * confMult * edgeMult;

  // Clamp to reasonable bounds
  const finalSize = Math.max(5, Math.min(adjusted, baseUsd * 3));

  if (_calls % 10 === 1) {
    log.info('Regime-adjusted size', {
      asset,
      regime: regime.regime,
      regimeMult: regimeMult.toFixed(2),
      timeMult: timeMult.toFixed(2),
      streakMult: streakMult.toFixed(2),
      confMult: confMult.toFixed(2),
      edgeMult: edgeMult.toFixed(2),
      baseUsd: baseUsd.toFixed(2),
      finalUsd: finalSize.toFixed(2),
    });
  }

  return Math.round(finalSize * 100) / 100;
}

function getStats() {
  return {
    currentRegime: getCurrentRegime(),
    streak: { ..._streak },
    timeMultiplier: getTimeMultiplier(),
    streakMultiplier: getStreakMultiplier(),
    totalCalls: _calls,
    config: {
      regimeSizing: REGIME_SIZING,
      volPctShrink: VOL_PERCENTILE_SHRINK,
      weekendMult: WEEKEND_MULTIPLIER,
    },
  };
}

module.exports = {
  regimeAdjustedSize,
  getCurrentRegime,
  detectRegime,
  recordTradeOutcome,
  getStats,
  getTimeMultiplier,
  getStreakMultiplier,
};
