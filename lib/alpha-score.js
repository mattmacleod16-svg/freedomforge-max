/**
 * Alpha Score Engine — FreedomForge
 * ═══════════════════════════════════════════════════════════════════════════
 * Produces a single 0-100 "Alpha Score" representing the current quality
 * of our edge across all systems. This is the top-level health indicator
 * of FreedomForge's trading brain.
 *
 * Components (weighted):
 *   - Signal Quality (25%):  current composite signal confidence + edge
 *   - Regime Clarity (20%):  how well-defined the current market regime is
 *   - Kelly Calibration (20%): how well-tuned our position sizing is
 *   - Volatility Context (15%): VCB status, current vol vs historical
 *   - Brain Evolution (10%): how many learning cycles completed
 *   - Cross-Asset Consensus (10%): altcoin regime agreement with BTC
 *
 * Output:
 *   { score: 72, grade: 'B+', components: {...}, advice: '...' }
 *
 * Score → Grade:
 *   90-100: A+ (Exceptional edge — press harder)
 *   80-89:  A  (Strong edge — trade normally)
 *   70-79:  B+ (Good edge — trade standard size)
 *   60-69:  B  (Moderate edge — trade cautiously)
 *   50-59:  C  (Weak edge — minimum size only)
 *   < 50:   D  (No edge — stay out or paper only)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let log;
try { const { createLogger } = require('./logger'); log = createLogger('alpha-score'); }
catch { log = { info: console.log, warn: console.warn, error: console.error, debug() {} }; }

// ── Module imports (all optional — degrades gracefully) ───────────────────────
let _kellySizer = null, _brainModule = null, _regimeDetector = null, _vcb = null;
let _crossAssetRegime = null, _regimeForecaster = null;

try { _kellySizer       = require('./kelly-sizer'); }       catch {}
try { _brainModule      = require('./self-evolving-brain'); } catch {}
try { _regimeDetector   = require('./regime-detector-v2'); } catch {}
try { _vcb              = require('./volatility-circuit-breaker'); } catch {}
try { _crossAssetRegime = require('./cross-asset-regime'); } catch {}
try { _regimeForecaster = require('./regime-transition-forecaster'); } catch {}

const STATE_FILE = path.resolve(process.cwd(), 'data/alpha-score.json');

// ── Grading ───────────────────────────────────────────────────────────────────
function grade(score) {
  if (score >= 90) return { letter: 'A+', advice: 'Exceptional edge — maximum conviction sizing' };
  if (score >= 80) return { letter: 'A',  advice: 'Strong edge — trade at full Kelly' };
  if (score >= 70) return { letter: 'B+', advice: 'Good edge — normal sizing, stay disciplined' };
  if (score >= 60) return { letter: 'B',  advice: 'Moderate edge — trade cautiously, half-Kelly' };
  if (score >= 50) return { letter: 'C',  advice: 'Weak edge — minimum size only' };
  return { letter: 'D', advice: 'No edge — sit out or paper trade' };
}

// ── Component Scorers ─────────────────────────────────────────────────────────

function scoreSignalQuality(lastSignal) {
  // Uses most recent composite signal if available
  try {
    const sigFile = path.resolve(process.cwd(), 'data/last-signal.json');
    if (!lastSignal && fs.existsSync(sigFile)) {
      lastSignal = JSON.parse(fs.readFileSync(sigFile, 'utf8'));
    }
    if (!lastSignal) return { score: 40, detail: 'no recent signal' };

    const conf   = Math.max(0, Math.min(1, lastSignal.confidence || 0.5));
    const edge   = Math.max(0, Math.min(1, lastSignal.edge || 0));
    const side   = lastSignal.side;
    const isNeutral = side === 'neutral' || !side;

    // Neutral = no edge = 40 base; directional = up to 100
    if (isNeutral) return { score: 40, detail: 'neutral — no edge' };
    const signalScore = Math.round(40 + conf * 30 + edge * 30);
    return { score: Math.min(100, signalScore), confidence: conf, edge, side };
  } catch { return { score: 40, detail: 'signal unavailable' }; }
}

function scoreRegimeClarity() {
  try {
    const regFile = path.resolve(process.cwd(), 'data/regime-state.json');
    if (!fs.existsSync(regFile)) return { score: 50, detail: 'no regime state' };
    const state = JSON.parse(fs.readFileSync(regFile, 'utf8'));

    const regime    = state.mode || state.regime;
    const confidence = Math.max(0, Math.min(1, state.confidence || 0.5));

    // Clear regimes score higher; ambiguous/volatile score lower
    const regimeBase = {
      bullTrend:          85, bearTrend:         80,
      sideways:           55, highVolatility:    45,
      extremeVolatility:  30, unknown:           35,
    };
    const base = regimeBase[regime] || 50;
    const adjusted = Math.round(base * (0.5 + 0.5 * confidence));
    return { score: Math.min(100, adjusted), regime, confidence };
  } catch { return { score: 50, detail: 'regime unavailable' }; }
}

function scoreKellyCalibration() {
  try {
    if (!_kellySizer) return { score: 40, detail: 'kelly-sizer not loaded' };
    const stats = _kellySizer.getKellyStats ? _kellySizer.getKellyStats() : null;
    if (!stats) return { score: 45, detail: 'no kelly stats' };

    const tradeCount = stats.tradeCount || 0;
    const cal = stats.calibration;

    // Reward: enough history, good win rate, positive expectancy
    let s = 30;
    if (tradeCount >= 20) s += 20;
    else s += tradeCount;

    if (cal) {
      if (cal.expectancy > 0) s += 20;
      if (cal.winRate > 0.52) s += 15;
      if (cal.profitFactor > 1.2) s += 15;
    }
    if (stats.usingPriors) s = Math.min(s, 60); // cap until enough live data

    return { score: Math.min(100, s), tradeCount, winRate: cal?.winRate, expectancy: cal?.expectancy };
  } catch { return { score: 40, detail: 'kelly unavailable' }; }
}

function scoreVolatilityContext() {
  try {
    const vcbFile = path.resolve(process.cwd(), 'data/vcb-state.json');
    if (!fs.existsSync(vcbFile)) return { score: 70, detail: 'no VCB state' };
    const vcb = JSON.parse(fs.readFileSync(vcbFile, 'utf8'));

    if (vcb.tripped) return { score: 10, detail: `VCB tripped: ${vcb.reason}`, tripped: true };
    if (vcb.cooldown) return { score: 30, detail: 'VCB cooldown active', cooldown: true };

    // Normal vol = high score; elevated but not tripped = medium
    const volScore = vcb.volatilityNormal ? 90 : (vcb.elevated ? 55 : 70);
    return { score: volScore, tripped: false };
  } catch { return { score: 70, detail: 'VCB unavailable' }; }
}

function scoreBrainEvolution() {
  try {
    if (!_brainModule) return { score: 40, detail: 'brain not loaded' };
    const insights = _brainModule.getInsights ? _brainModule.getInsights() : null;
    if (!insights) return { score: 45, detail: 'no brain insights' };

    const generations = insights.generations || 0;
    const tradeCount  = insights.totalTrades || 0;
    const drift       = Math.max(0, Math.min(1, insights.weightDrift || 0));

    // More generations + trades = more evolved = higher score
    let s = 30;
    s += Math.min(30, Math.round(generations / 5)); // +1 per 5 generations, cap 30
    s += Math.min(25, Math.round(tradeCount / 4));  // +1 per 4 trades, cap 25
    s += Math.max(0, 15 - Math.round(drift * 100)); // penalty for high drift (instability)

    return { score: Math.min(100, s), generations, tradeCount, drift };
  } catch { return { score: 40, detail: 'brain unavailable' }; }
}

function scoreCrossAssetConsensus() {
  try {
    const caFile = path.resolve(process.cwd(), 'data/cross-asset-state.json');
    if (!fs.existsSync(caFile)) return { score: 60, detail: 'no cross-asset state' };
    const state = JSON.parse(fs.readFileSync(caFile, 'utf8'));

    const consensus = Math.max(0, Math.min(1, state.consensus || state.multiplier || 0.5));
    const multiplier = state.lastMultiplier || state.multiplier || 1;

    // High consensus (alts agree with BTC) = high score
    // Low consensus (divergence) = reduce score
    const s = Math.round(30 + consensus * 70);
    return { score: Math.min(100, s), consensus, multiplier };
  } catch { return { score: 60, detail: 'cross-asset unavailable' }; }
}

// ── Main Compute ──────────────────────────────────────────────────────────────

async function computeAlphaScore(opts = {}) {
  const { lastSignal = null } = opts;

  const weights = { signal: 0.25, regime: 0.20, kelly: 0.20, vol: 0.15, brain: 0.10, crossAsset: 0.10 };

  const components = {
    signal:    scoreSignalQuality(lastSignal),
    regime:    scoreRegimeClarity(),
    kelly:     scoreKellyCalibration(),
    vol:       scoreVolatilityContext(),
    brain:     scoreBrainEvolution(),
    crossAsset: scoreCrossAssetConsensus(),
  };

  const rawScore = (
    components.signal.score     * weights.signal     +
    components.regime.score     * weights.regime     +
    components.kelly.score      * weights.kelly      +
    components.vol.score        * weights.vol        +
    components.brain.score      * weights.brain      +
    components.crossAsset.score * weights.crossAsset
  );

  const score = Math.round(Math.min(100, Math.max(0, rawScore)));
  const { letter, advice } = grade(score);

  const result = {
    score, grade: letter, advice,
    components,
    weights,
    timestamp: new Date().toISOString(),
  };

  // Persist for dashboard
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(result, null, 2));
  } catch {}

  log.info(`Alpha Score: ${score} (${letter}) — ${advice}`, {
    signal: components.signal.score,
    regime: components.regime.score,
    kelly:  components.kelly.score,
    vol:    components.vol.score,
  });

  return result;
}

// ── Quick read (cached, no recompute) ─────────────────────────────────────────
function getCachedAlphaScore() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      const ageMs = Date.now() - new Date(data.timestamp || 0).getTime();
      if (ageMs < 30 * 60 * 1000) return data; // valid if < 30 min old
    }
  } catch {}
  return null;
}

module.exports = { computeAlphaScore, getCachedAlphaScore, grade };
