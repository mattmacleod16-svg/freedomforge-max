/**
 * Regime Transition Forecaster — FreedomForge
 * ═══════════════════════════════════════════════════════════════════════════
 * Predicts the NEXT market regime using a Markov Chain trained on observed
 * regime transitions, enhanced with momentum and volatility features.
 *
 * Architecture:
 *   1. Markov Chain — builds a transition probability matrix from historical
 *      regime sequences. Each (current_regime → next_regime) pair gets a
 *      probability based on how often it occurred historically.
 *   2. Feature Enhancement — adjusts raw Markov probabilities using:
 *      - Regime duration (longer regimes = higher inertia = more likely to persist)
 *      - Volatility trend (rising vol = more likely to transition to highVol)
 *      - Momentum decay (ADX falling = weakening trend = more likely to go sideways)
 *      - Cross-asset divergence (alts diverging from BTC = transition signal)
 *   3. Confidence scoring — how confident we are in the prediction
 *
 * Output:
 *   {
 *     currentRegime: 'bearTrend',
 *     nextRegime:    'sideways',       // most likely transition
 *     probability:   0.62,             // P(next = sideways | current = bearTrend)
 *     alternatives:  [{regime, prob}], // other possible transitions
 *     confidence:    0.71,             // how reliable this prediction is
 *     durationCandles: 14,             // how long current regime has lasted
 *     signal: 'regime_change_likely',  // action signal
 *     horizon: '4-12h',               // estimated time to transition
 *   }
 *
 * State persisted to data/regime-forecast-state.json
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let log;
try { const { createLogger } = require('./logger'); log = createLogger('regime-forecaster'); }
catch { log = { info: console.log, warn: console.warn, error: console.error, debug() {} }; }

const STATE_FILE = path.resolve(process.cwd(), 'data/regime-forecast-state.json');

// ── Regime universe ───────────────────────────────────────────────────────────
const REGIMES = ['bullTrend', 'bearTrend', 'sideways', 'highVolatility', 'extremeVolatility'];

// ── Built-in prior transition matrix ──────────────────────────────────────────
// Based on crypto market historical regime behavior (BTC 2019-2024)
// Rows = from, Cols = to: [bullTrend, bearTrend, sideways, highVol, extremeVol]
const PRIOR_MATRIX = {
  bullTrend:        { bullTrend: 0.60, bearTrend: 0.08, sideways: 0.22, highVolatility: 0.08, extremeVolatility: 0.02 },
  bearTrend:        { bullTrend: 0.10, bearTrend: 0.52, sideways: 0.28, highVolatility: 0.08, extremeVolatility: 0.02 },
  sideways:         { bullTrend: 0.25, bearTrend: 0.20, sideways: 0.40, highVolatility: 0.12, extremeVolatility: 0.03 },
  highVolatility:   { bullTrend: 0.20, bearTrend: 0.25, sideways: 0.30, highVolatility: 0.20, extremeVolatility: 0.05 },
  extremeVolatility:{ bullTrend: 0.05, bearTrend: 0.30, sideways: 0.25, highVolatility: 0.30, extremeVolatility: 0.10 },
};

// ── State ─────────────────────────────────────────────────────────────────────
let _state = {
  observedTransitions: {},   // { 'bullTrend→bearTrend': 5, ... }
  regimeSequence: [],        // [..., 'bearTrend', 'sideways', 'bearTrend'] — ordered history
  lastRegime: null,
  lastForecast: null,
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      _state = { ..._state, ...s };
    }
  } catch {}
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(_state, null, 2));
  } catch {}
}

loadState();

// ── Markov transition matrix (learned) ────────────────────────────────────────
function buildLearnedMatrix() {
  const matrix = {};
  for (const from of REGIMES) {
    matrix[from] = {};
    for (const to of REGIMES) {
      const key = `${from}→${to}`;
      matrix[from][to] = _state.observedTransitions[key] || 0;
    }
  }
  // Normalize rows to sum to 1
  for (const from of REGIMES) {
    const rowSum = Object.values(matrix[from]).reduce((a, b) => a + b, 0);
    if (rowSum > 0) {
      for (const to of REGIMES) matrix[from][to] /= rowSum;
    } else {
      // No observations for this regime yet — use prior
      matrix[from] = { ...PRIOR_MATRIX[from] };
    }
  }
  return matrix;
}

// ── Blend prior + learned matrix ──────────────────────────────────────────────
// As we accumulate observations, blend learned matrix towards prior less
function blendedMatrix() {
  const totalObs  = Object.values(_state.observedTransitions).reduce((a, b) => a + b, 0);
  const learnedWt = Math.min(0.90, totalObs / 200); // at 200 transitions, 90% learned / 10% prior
  const priorWt   = 1 - learnedWt;

  const learned = buildLearnedMatrix();
  const blended = {};

  for (const from of REGIMES) {
    blended[from] = {};
    for (const to of REGIMES) {
      blended[from][to] = learnedWt * learned[from][to] + priorWt * PRIOR_MATRIX[from][to];
    }
  }

  return { matrix: blended, learnedWeight: learnedWt, observations: totalObs };
}

// ── Duration inertia adjustment ────────────────────────────────────────────────
// The longer a regime has persisted, the MORE likely it is to persist
// (mean reversion eventually kicks in, but short-term momentum dominates)
function durationAdjusted(transitionProbs, currentRegime, durationCandles) {
  if (durationCandles < 3) return transitionProbs;

  // Inertia factor: rises quickly for 0-12 candles, plateaus after
  const inertia = Math.min(0.30, durationCandles * 0.025);

  const adj = { ...transitionProbs };
  // Boost self-persistence
  adj[currentRegime] = Math.min(0.85, (adj[currentRegime] || 0) + inertia);

  // Renormalize
  const total = Object.values(adj).reduce((a, b) => a + b, 0);
  for (const k in adj) adj[k] /= total;

  return adj;
}

// ── Volatility trend adjustment ────────────────────────────────────────────────
function volatilityAdjusted(transitionProbs, currentRegime, volTrend) {
  if (!volTrend || volTrend === 'stable') return transitionProbs;
  const adj = { ...transitionProbs };

  if (volTrend === 'rising') {
    // Rising vol → more likely to transition to highVol
    adj['highVolatility']    = (adj['highVolatility']    || 0) * 1.5;
    adj['extremeVolatility'] = (adj['extremeVolatility'] || 0) * 1.3;
    adj[currentRegime]       = (adj[currentRegime]       || 0) * 0.8;
  } else if (volTrend === 'falling') {
    // Falling vol → more likely to persist or move to sideways
    adj[currentRegime]  = (adj[currentRegime]  || 0) * 1.2;
    adj['sideways']     = (adj['sideways']     || 0) * 1.2;
    adj['highVolatility']    = (adj['highVolatility']    || 0) * 0.6;
    adj['extremeVolatility'] = (adj['extremeVolatility'] || 0) * 0.4;
  }

  const total = Object.values(adj).reduce((a, b) => a + b, 0);
  for (const k in adj) adj[k] /= total;
  return adj;
}

// ── ADX momentum decay adjustment ─────────────────────────────────────────────
function adxAdjusted(transitionProbs, currentRegime, adxTrend) {
  if (!adxTrend || adxTrend === 'stable') return transitionProbs;
  const adj = { ...transitionProbs };

  if (adxTrend === 'falling' && (currentRegime === 'bullTrend' || currentRegime === 'bearTrend')) {
    // ADX falling = trend weakening = more likely to go sideways
    adj['sideways']     = (adj['sideways']     || 0) * 1.6;
    adj[currentRegime]  = (adj[currentRegime]  || 0) * 0.7;
  } else if (adxTrend === 'rising' && currentRegime === 'sideways') {
    // ADX rising from sideways = breakout incoming
    adj['bullTrend']  = (adj['bullTrend']  || 0) * 1.4;
    adj['bearTrend']  = (adj['bearTrend']  || 0) * 1.4;
    adj['sideways']   = (adj['sideways']   || 0) * 0.5;
  }

  const total = Object.values(adj).reduce((a, b) => a + b, 0);
  for (const k in adj) adj[k] /= total;
  return adj;
}

// ── Compute regime duration from history ──────────────────────────────────────
function computeDuration(currentRegime) {
  const seq = _state.regimeSequence;
  if (!seq || seq.length === 0) return 0;
  let duration = 0;
  for (let i = seq.length - 1; i >= 0; i--) {
    if (seq[i] === currentRegime) duration++;
    else break;
  }
  return duration;
}

// ── Detect volatility trend from vol history ───────────────────────────────────
function computeVolTrend(volHistory = []) {
  if (volHistory.length < 4) return 'stable';
  const recent = volHistory.slice(-4);
  const older  = volHistory.slice(-8, -4);
  if (older.length < 2) return 'stable';
  const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderMean  = older.reduce((a, b)  => a + b, 0) / older.length;
  const change = (recentMean - olderMean) / olderMean;
  if (change > 0.10) return 'rising';
  if (change < -0.10) return 'falling';
  return 'stable';
}

// ── Main forecast function ─────────────────────────────────────────────────────
/**
 * Predict the next regime and time-to-transition.
 *
 * @param {object} params
 * @param {string}  params.currentRegime  - e.g. 'bearTrend'
 * @param {number}  [params.adx]          - Current ADX value
 * @param {string}  [params.adxTrend]     - 'rising' | 'falling' | 'stable'
 * @param {number[]}[params.volHistory]   - Recent volatility values (std devs)
 * @param {object}  [params.crossAsset]   - Cross-asset consensus object
 * @returns {object} Forecast result
 */
function forecastNextRegime(params = {}) {
  const {
    currentRegime,
    adx         = null,
    adxTrend    = 'stable',
    volHistory  = [],
    crossAsset  = null,
  } = params;

  if (!currentRegime || !REGIMES.includes(currentRegime)) {
    return { currentRegime, nextRegime: 'unknown', probability: 0, confidence: 0 };
  }

  // Record current regime observation
  _state.regimeSequence.push(currentRegime);
  if (_state.regimeSequence.length > 500) _state.regimeSequence = _state.regimeSequence.slice(-500);

  const durationCandles = computeDuration(currentRegime);
  const volTrend        = computeVolTrend(volHistory);

  // 1. Get blended Markov transition probabilities
  const { matrix, learnedWeight, observations } = blendedMatrix();
  let transProbs = { ...matrix[currentRegime] };

  // 2. Apply feature adjustments
  transProbs = durationAdjusted(transProbs, currentRegime, durationCandles);
  transProbs = volatilityAdjusted(transProbs, currentRegime, volTrend);
  transProbs = adxAdjusted(transProbs, currentRegime, adxTrend);

  // 3. Cross-asset divergence: if alts strongly disagree with BTC, boost transition prob
  if (crossAsset && crossAsset.consensus !== undefined) {
    const divergence = 1 - crossAsset.consensus; // 0 = full agreement, 1 = full divergence
    if (divergence > 0.4) {
      // Alts diverging — current regime less stable, boost all non-self transitions
      const selfProb = transProbs[currentRegime] || 0;
      const boostOthers = divergence * 0.15;
      for (const regime of REGIMES) {
        if (regime !== currentRegime) transProbs[regime] = (transProbs[regime] || 0) + boostOthers / (REGIMES.length - 1);
      }
      transProbs[currentRegime] = Math.max(0, selfProb - boostOthers);
      const total = Object.values(transProbs).reduce((a, b) => a + b, 0);
      for (const k in transProbs) transProbs[k] /= total;
    }
  }

  // 4. Find most likely next regime
  const sorted = Object.entries(transProbs)
    .sort(([, a], [, b]) => b - a)
    .map(([regime, prob]) => ({ regime, prob: parseFloat(prob.toFixed(4)) }));

  const nextRegime    = sorted[0].regime;
  const nextProb      = sorted[0].prob;
  const persistProb   = transProbs[currentRegime] || 0;
  const changeProb    = 1 - persistProb;

  // 5. Confidence: how much do we trust this forecast?
  // Higher confidence when: more observations, clear winner, high probability
  const probGap   = sorted[0].prob - (sorted[1]?.prob || 0);
  const obsWeight = Math.min(1.0, observations / 100);
  const confidence = parseFloat(Math.min(0.90, (0.4 + obsWeight * 0.3 + probGap * 1.5)).toFixed(3));

  // 6. Signal interpretation
  let signal = 'hold';
  let horizon = '> 24h';

  if (changeProb > 0.50 && nextRegime !== currentRegime) {
    signal  = 'regime_change_likely';
    horizon = durationCandles > 20 ? '2-6h' : '6-12h';
  } else if (changeProb > 0.35 && nextRegime !== currentRegime) {
    signal  = 'regime_change_possible';
    horizon = '12-24h';
  } else {
    signal  = 'regime_stable';
    horizon = '> 24h';
  }

  // Special: if ADX is falling hard in a trend, that's a near-term signal
  if (adxTrend === 'falling' && adx !== null && adx < 20 && (currentRegime === 'bullTrend' || currentRegime === 'bearTrend')) {
    signal  = 'trend_exhaustion';
    horizon = '2-8h';
  }

  const forecast = {
    currentRegime,
    nextRegime,
    probability:       nextProb,
    persistProbability: parseFloat(persistProb.toFixed(4)),
    changeProbability:  parseFloat(changeProb.toFixed(4)),
    alternatives:      sorted.slice(1, 4),
    confidence,
    signal,
    horizon,
    durationCandles,
    volTrend,
    adxTrend,
    learnedWeight:     parseFloat(learnedWeight.toFixed(3)),
    totalObservations: observations,
    timestamp:         new Date().toISOString(),
  };

  _state.lastForecast = forecast;
  _state.lastRegime   = currentRegime;
  saveState();

  log.info(`Forecast [${currentRegime}]: next=${nextRegime} (${(nextProb*100).toFixed(0)}%) | signal=${signal} | horizon=${horizon} | conf=${confidence}`);

  return forecast;
}

// ── Record transition (call when regime actually changes) ──────────────────────
function recordTransition(fromRegime, toRegime) {
  if (!fromRegime || !toRegime || fromRegime === toRegime) return;
  const key = `${fromRegime}→${toRegime}`;
  _state.observedTransitions[key] = (_state.observedTransitions[key] || 0) + 1;
  log.info(`Transition recorded: ${key} (total: ${_state.observedTransitions[key]})`);
  saveState();
}

// ── Get last forecast ──────────────────────────────────────────────────────────
function getLastForecast() {
  return _state.lastForecast;
}

// ── Stats ──────────────────────────────────────────────────────────────────────
function getForecasterStats() {
  const totalObs = Object.values(_state.observedTransitions).reduce((a, b) => a + b, 0);
  return {
    totalTransitions:    totalObs,
    regimeSequenceLen:   _state.regimeSequence.length,
    observedTransitions: _state.observedTransitions,
    lastRegime:          _state.lastRegime,
    lastForecast:        _state.lastForecast,
    priorWeight:         parseFloat((1 - Math.min(0.90, totalObs / 200)).toFixed(3)),
  };
}

module.exports = {
  forecastNextRegime,
  recordTransition,
  getLastForecast,
  getForecasterStats,
  blendedMatrix,
  PRIOR_MATRIX,
  REGIMES,
};
