/**
 * Self-Evolving Brain — Autonomous intelligence that learns from every trade,
 * auto-tunes indicator weights, and evolves decision-making over time.
 *
 * Applies Anthropic best-practice: evaluation-driven development.
 * Every decision is scored against actual outcomes. Parameters that produce
 * winning trades get reinforced; losing parameters get dampened.
 *
 * Capabilities:
 *   1. Per-indicator attribution: Which indicators actually predict winners?
 *   2. Per-asset profiling: Which assets respond to which signal types?
 *   3. Regime-aware learning: Adjusts strategy based on detected market regime
 *   4. Auto-weight evolution: Continuously tunes composite signal weights
 *   5. Confidence calibration: Ensures stated confidence matches actual hit rate
 *   6. Time-of-day / day-of-week patterns: When do we trade best?
 *   7. Drawdown circuit breaker: Automatic risk reduction during losing streaks
 *
 * Usage:
 *   const brain = require('../lib/self-evolving-brain');
 *   const evolved = brain.getEvolvedWeights('BTC');
 *   const insights = brain.getInsights();
 *   brain.runEvolutionCycle();
 */

const fs = require('fs');
const path = require('path');

const BRAIN_STATE_FILE = path.resolve(process.cwd(), process.env.BRAIN_STATE_FILE || 'data/self-evolving-brain.json');
const JOURNAL_FILE = path.resolve(process.cwd(), process.env.TRADE_JOURNAL_FILE || 'data/trade-journal.json');
const MIN_TRADES_FOR_LEARNING = Math.max(5, parseInt(process.env.BRAIN_MIN_TRADES || '8', 10));
const LEARNING_RATE = Math.max(0.01, Math.min(0.3, Number(process.env.BRAIN_LEARNING_RATE || 0.08)));
const DECAY_RATE = Math.max(0.9, Math.min(0.999, Number(process.env.BRAIN_DECAY_RATE || 0.97)));
const MAX_GENERATIONS = Math.max(50, parseInt(process.env.BRAIN_MAX_GENERATIONS || '500', 10));

// ─── Default Indicator Weights (what we're evolving) ─────────────────────────

const DEFAULT_WEIGHTS = {
  multiTfMomentum: 0.30,
  rsi: 0.15,
  bollingerBands: 0.10,
  volumeConfirmation: 0.10,
  atrVolatility: 0.05,
  regimeAlignment: 0.15,
  sentimentDivergence: 0.08,
  forecastAlignment: 0.04,
  geoRiskPenalty: 0.03,
};

const DEFAULT_THRESHOLDS = {
  minConfidence: 0.56,
  maxConfidence: 0.95,
  overboughtRsi: 70,
  oversoldRsi: 30,
  bbPercentBHigh: 0.9,
  bbPercentBLow: 0.1,
  bbSqueezeWidth: 0.02,
  bbHighVolWidth: 0.08,
  volumeMinRatio: 0.8,
  volumeSurgeRatio: 2.0,
  minEdge: 0.10,
  maxOrderMultiplier: 3.0,
  kellyFraction: 1.0,
  drawdownPauseThreshold: 0.15, // pause if drawdown exceeds 15% of peak equity
  losingStreakThreshold: 5,      // reduce size after 5 consecutive losses
};

// ─── Persistence ─────────────────────────────────────────────────────────────

// Resilient I/O — atomic writes, backup recovery, file locking
let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

function load(filePath) {
  if (rio) return rio.readJsonSafe(filePath, { fallback: null });
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

function save(filePath, data) {
  if (rio) { rio.writeJsonAtomic(filePath, data); return; }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadBrainState() {
  const raw = load(BRAIN_STATE_FILE);
  if (!raw) {
    return {
      weights: { ...DEFAULT_WEIGHTS },
      thresholds: { ...DEFAULT_THRESHOLDS },
      assetProfiles: {},
      regimeProfiles: {},
      timePatterns: {},
      generations: [],
      calibration: {},
      streaks: { current: 0, maxWin: 0, maxLoss: 0 },
      totalEvolutions: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
  // Ensure all keys exist (forward compatibility)
  return {
    weights: { ...DEFAULT_WEIGHTS, ...(raw.weights || {}) },
    thresholds: { ...DEFAULT_THRESHOLDS, ...(raw.thresholds || {}) },
    assetProfiles: raw.assetProfiles || {},
    regimeProfiles: raw.regimeProfiles || {},
    timePatterns: raw.timePatterns || {},
    generations: raw.generations || [],
    calibration: raw.calibration || {},
    streaks: raw.streaks || { current: 0, maxWin: 0, maxLoss: 0 },
    totalEvolutions: raw.totalEvolutions || 0,
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now(),
  };
}

function saveBrainState(state) {
  state.updatedAt = Date.now();
  if (state.generations.length > MAX_GENERATIONS) {
    state.generations = state.generations.slice(-MAX_GENERATIONS);
  }
  save(BRAIN_STATE_FILE, state);
}

function loadJournal() {
  const raw = load(JOURNAL_FILE);
  return Array.isArray(raw?.trades) ? raw.trades : [];
}

// ─── Per-Indicator Attribution ───────────────────────────────────────────────

/**
 * Analyze which indicators correctly predicted winning vs losing trades.
 * Returns a map of indicator → { winContribution, lossContribution, netValue }
 */
function computeIndicatorAttribution(trades) {
  const attribution = {};
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    attribution[key] = { winTrades: 0, lossTrades: 0, totalTrades: 0, winPnl: 0, lossPnl: 0 };
  }

  for (const trade of trades) {
    if (!trade.outcome || trade.outcome === 'breakeven') continue;
    const isWin = trade.outcome === 'win';
    const components = trade.signalComponents || {};

    // Multi-TF Momentum
    if (components.mtfConfluence > 0) {
      attribution.multiTfMomentum.totalTrades++;
      if (isWin) { attribution.multiTfMomentum.winTrades++; attribution.multiTfMomentum.winPnl += trade.pnl || 0; }
      else { attribution.multiTfMomentum.lossTrades++; attribution.multiTfMomentum.lossPnl += trade.pnl || 0; }
    }

    // RSI
    if (components.rsi != null) {
      attribution.rsi.totalTrades++;
      if (isWin) { attribution.rsi.winTrades++; attribution.rsi.winPnl += trade.pnl || 0; }
      else { attribution.rsi.lossTrades++; attribution.rsi.lossPnl += trade.pnl || 0; }
    }

    // Bollinger Bands
    if (components.bbPercentB != null) {
      attribution.bollingerBands.totalTrades++;
      if (isWin) { attribution.bollingerBands.winTrades++; attribution.bollingerBands.winPnl += trade.pnl || 0; }
      else { attribution.bollingerBands.lossTrades++; attribution.bollingerBands.lossPnl += trade.pnl || 0; }
    }

    // Volume
    if (components.volRatio != null) {
      attribution.volumeConfirmation.totalTrades++;
      if (isWin) { attribution.volumeConfirmation.winTrades++; attribution.volumeConfirmation.winPnl += trade.pnl || 0; }
      else { attribution.volumeConfirmation.lossTrades++; attribution.volumeConfirmation.lossPnl += trade.pnl || 0; }
    }

    // Regime alignment
    if (components.regime) {
      attribution.regimeAlignment.totalTrades++;
      if (isWin) { attribution.regimeAlignment.winTrades++; attribution.regimeAlignment.winPnl += trade.pnl || 0; }
      else { attribution.regimeAlignment.lossTrades++; attribution.regimeAlignment.lossPnl += trade.pnl || 0; }
    }

    // Sentiment divergence
    if (components.sentDivergence) {
      attribution.sentimentDivergence.totalTrades++;
      if (isWin) { attribution.sentimentDivergence.winTrades++; attribution.sentimentDivergence.winPnl += trade.pnl || 0; }
      else { attribution.sentimentDivergence.lossTrades++; attribution.sentimentDivergence.lossPnl += trade.pnl || 0; }
    }
  }

  // Compute net value per indicator
  for (const [key, attr] of Object.entries(attribution)) {
    const winRate = attr.totalTrades > 0 ? attr.winTrades / attr.totalTrades : 0.5;
    const profitFactor = attr.lossPnl !== 0 ? Math.abs(attr.winPnl / attr.lossPnl) : attr.winPnl > 0 ? 10 : 1;
    attr.winRate = Math.round(winRate * 10000) / 100;
    attr.profitFactor = Math.round(profitFactor * 100) / 100;
    attr.netPnl = Math.round((attr.winPnl + attr.lossPnl) * 100) / 100;
    // Score: combine win rate and profit factor
    attr.score = winRate * 0.6 + Math.min(3, profitFactor) / 3 * 0.4;
  }

  return attribution;
}

// ─── Per-Asset Profiling ─────────────────────────────────────────────────────

function computeAssetProfiles(trades) {
  const profiles = {};
  for (const trade of trades) {
    if (!trade.outcome || trade.outcome === 'breakeven') continue;
    const asset = trade.asset || 'BTC';
    if (!profiles[asset]) {
      profiles[asset] = { wins: 0, losses: 0, pnl: 0, avgConfidence: 0, trades: 0, bestSide: { buy: 0, sell: 0 } };
    }
    const p = profiles[asset];
    p.trades++;
    p.avgConfidence += trade.signal?.confidence || 0;
    if (trade.outcome === 'win') { p.wins++; p.pnl += trade.pnl || 0; }
    else { p.losses++; p.pnl += trade.pnl || 0; }
    if (trade.side === 'buy') p.bestSide.buy += trade.pnl || 0;
    else p.bestSide.sell += trade.pnl || 0;
  }
  for (const p of Object.values(profiles)) {
    p.avgConfidence = p.trades > 0 ? Math.round(p.avgConfidence / p.trades * 1000) / 1000 : 0;
    p.winRate = p.trades > 0 ? Math.round(p.wins / p.trades * 10000) / 100 : 0;
    p.preferredSide = p.bestSide.buy >= p.bestSide.sell ? 'buy' : 'sell';
    p.pnl = Math.round(p.pnl * 100) / 100;
  }
  return profiles;
}

// ─── Regime Learning ─────────────────────────────────────────────────────────

function computeRegimeProfiles(trades) {
  const profiles = {};
  for (const trade of trades) {
    if (!trade.outcome || trade.outcome === 'breakeven') continue;
    const regime = trade.signalComponents?.regime || 'unknown';
    if (!profiles[regime]) {
      profiles[regime] = { wins: 0, losses: 0, pnl: 0, trades: 0 };
    }
    const p = profiles[regime];
    p.trades++;
    if (trade.outcome === 'win') { p.wins++; } else { p.losses++; }
    p.pnl += trade.pnl || 0;
  }
  for (const p of Object.values(profiles)) {
    p.winRate = p.trades > 0 ? Math.round(p.wins / p.trades * 10000) / 100 : 0;
    p.pnl = Math.round(p.pnl * 100) / 100;
  }
  return profiles;
}

// ─── Time Pattern Analysis ───────────────────────────────────────────────────

function computeTimePatterns(trades) {
  const hourBuckets = {};
  const dayBuckets = {};
  for (const trade of trades) {
    if (!trade.outcome || trade.outcome === 'breakeven') continue;
    const dt = new Date(trade.entryAt || trade.entryTs);
    const hour = dt.getUTCHours();
    const day = dt.getUTCDay();
    
    if (!hourBuckets[hour]) hourBuckets[hour] = { wins: 0, losses: 0, pnl: 0, trades: 0 };
    if (!dayBuckets[day]) dayBuckets[day] = { wins: 0, losses: 0, pnl: 0, trades: 0 };

    for (const bucket of [hourBuckets[hour], dayBuckets[day]]) {
      bucket.trades++;
      if (trade.outcome === 'win') bucket.wins++;
      else bucket.losses++;
      bucket.pnl += trade.pnl || 0;
    }
  }

  // Find best/worst hours and days
  const hourEntries = Object.entries(hourBuckets).map(([h, b]) => ({
    hour: Number(h), ...b, winRate: b.trades > 0 ? b.wins / b.trades : 0
  }));
  const dayEntries = Object.entries(dayBuckets).map(([d, b]) => ({
    day: Number(d), ...b, winRate: b.trades > 0 ? b.wins / b.trades : 0
  }));

  hourEntries.sort((a, b) => b.pnl - a.pnl);
  dayEntries.sort((a, b) => b.pnl - a.pnl);

  return {
    bestHours: hourEntries.filter(h => h.pnl > 0).slice(0, 5).map(h => h.hour),
    worstHours: hourEntries.filter(h => h.pnl < 0).slice(-3).map(h => h.hour),
    bestDays: dayEntries.filter(d => d.pnl > 0).slice(0, 3).map(d => d.day),
    worstDays: dayEntries.filter(d => d.pnl < 0).slice(-2).map(d => d.day),
    hourBreakdown: hourEntries,
    dayBreakdown: dayEntries,
  };
}

// ─── Confidence Calibration ──────────────────────────────────────────────────

function computeCalibration(trades) {
  // Bucket trades by stated confidence and measure actual win rate
  const buckets = {};
  for (const trade of trades) {
    if (!trade.outcome || trade.outcome === 'breakeven') continue;
    const conf = trade.signal?.confidence || 0.5;
    const bucket = Math.round(conf * 10) / 10; // round to nearest 0.1
    if (!buckets[bucket]) buckets[bucket] = { stated: bucket, wins: 0, total: 0 };
    buckets[bucket].total++;
    if (trade.outcome === 'win') buckets[bucket].wins++;
  }

  const entries = Object.values(buckets).map(b => ({
    ...b,
    actual: b.total > 0 ? Math.round(b.wins / b.total * 1000) / 1000 : 0,
    gap: b.total > 2 ? Math.round((b.wins / b.total - b.stated) * 1000) / 1000 : 0,
  }));

  // Overconfident = stated > actual (we think we're better than we are)
  const overconfident = entries.filter(e => e.gap < -0.1 && e.total >= 3);
  const underconfident = entries.filter(e => e.gap > 0.1 && e.total >= 3);

  return {
    buckets: entries,
    overconfidentZones: overconfident.map(e => e.stated),
    underconfidentZones: underconfident.map(e => e.stated),
    calibrationScore: entries.length > 0
      ? Math.round((1 - entries.reduce((s, e) => s + Math.abs(e.gap), 0) / entries.length) * 100) / 100
      : 0.5,
  };
}

// ─── Weight Evolution ────────────────────────────────────────────────────────

/**
 * Evolve indicator weights based on attribution analysis.
 * Uses gradient-free optimization: increase weights for indicators that
 * correlate with wins, decrease for those that correlate with losses.
 */
function evolveWeights(currentWeights, attribution, learningRate = LEARNING_RATE) {
  const newWeights = { ...currentWeights };
  const keys = Object.keys(DEFAULT_WEIGHTS);

  for (const key of keys) {
    const attr = attribution[key];
    if (!attr || attr.totalTrades < 3) continue;

    // Gradient: how much better than random (0.5) is this indicator?
    const gradient = (attr.score - 0.5) * 2; // range [-1, +1]
    
    // Apply learning: increase weight for good indicators, decrease for bad
    const delta = learningRate * gradient;
    newWeights[key] = Math.max(0.01, Math.min(0.50, newWeights[key] + delta));
  }

  // Normalize weights to sum to 1.0
  const total = keys.reduce((s, k) => s + (newWeights[k] || 0), 0);
  if (total > 0) {
    for (const key of keys) {
      newWeights[key] = Math.round(newWeights[key] / total * 10000) / 10000;
    }
  }

  return newWeights;
}

/**
 * Evolve thresholds based on calibration and regime analysis.
 * Guards against "death spiral" where threshold rises above signal range, killing all trades.
 */
const CONFIDENCE_CEILING = Number(process.env.BRAIN_CONFIDENCE_CEILING || 0.64);
const CONFIDENCE_FLOOR = Number(process.env.BRAIN_CONFIDENCE_FLOOR || 0.50);
const DROUGHT_DECAY_STEP = 0.02; // faster decay when no trades are flowing

function evolveThresholds(currentThresholds, calibration, assetProfiles, streaks) {
  const t = { ...currentThresholds };

  // If we're overconfident in high-confidence zones, raise minConfidence
  if (calibration.overconfidentZones?.length > 0) {
    const avgOverconf = calibration.overconfidentZones.reduce((s, v) => s + v, 0) / calibration.overconfidentZones.length;
    if (avgOverconf < t.minConfidence + 0.1) {
      t.minConfidence = Math.min(CONFIDENCE_CEILING, t.minConfidence + 0.02);
    }
  }
  // If we're underconfident, we can lower threshold to capture more
  if (calibration.underconfidentZones?.length > 1 && !calibration.overconfidentZones?.length) {
    t.minConfidence = Math.max(CONFIDENCE_FLOOR, t.minConfidence - 0.01);
  }

  // ═══ TRADE DROUGHT PROTECTION ═══
  // If threshold is near/at ceiling and recent trades are sparse, decay aggressively.
  // Prevents death spiral where high threshold → no trades → no learning → stuck.
  try {
    const orchStatePath = path.resolve(process.cwd(), 'data', 'orchestrator-state.json');
    if (fs.existsSync(orchStatePath)) {
      const orch = JSON.parse(fs.readFileSync(orchStatePath, 'utf8'));
      const lastTrades = orch.lastCycle?.trades ?? 0;
      const recentCycles = orch.cycleCount || 0;
      const avgTradesPerCycle = recentCycles > 0 ? (orch.totalTrades || 0) / recentCycles : 0;
      // If we're averaging < 0.1 trades/cycle (drought) and threshold is high, decay it
      if (avgTradesPerCycle < 0.15 && t.minConfidence > 0.60) {
        t.minConfidence = Math.max(CONFIDENCE_FLOOR, t.minConfidence - DROUGHT_DECAY_STEP);
      }
    }
  } catch (err) { console.error('[brain] drought threshold adjustment error:', err?.message || err); }

  // Losing streak protection
  if (streaks.current < -t.losingStreakThreshold) {
    t.minConfidence = Math.min(CONFIDENCE_CEILING + 0.02, t.minConfidence + 0.03);
    t.maxOrderMultiplier = Math.max(1.5, t.maxOrderMultiplier - 0.3);
    t.kellyFraction = Math.max(0.3, t.kellyFraction - 0.1);
  }
  // Winning streak — cautiously increase aggression
  if (streaks.current > 5) {
    t.maxOrderMultiplier = Math.min(4.0, t.maxOrderMultiplier + 0.1);
    t.kellyFraction = Math.min(1.2, t.kellyFraction + 0.05);
  }

  // Hard ceiling enforcement (never exceed ceiling regardless of path)
  t.minConfidence = Math.min(t.minConfidence, CONFIDENCE_CEILING);

  // Normalize
  t.minConfidence = Math.round(t.minConfidence * 1000) / 1000;
  t.maxOrderMultiplier = Math.round(t.maxOrderMultiplier * 100) / 100;
  t.kellyFraction = Math.round(t.kellyFraction * 100) / 100;

  return t;
}

// ─── Streak Tracking ─────────────────────────────────────────────────────────

function computeStreaks(trades) {
  let current = 0;
  let maxWin = 0;
  let maxLoss = 0;

  // Sort trades by time
  const sorted = [...trades].filter(t => t.outcome && t.outcome !== 'breakeven').sort((a, b) => (a.entryTs || 0) - (b.entryTs || 0));

  for (const trade of sorted) {
    if (trade.outcome === 'win') {
      current = current >= 0 ? current + 1 : 1;
      maxWin = Math.max(maxWin, current);
    } else {
      current = current <= 0 ? current - 1 : -1;
      maxLoss = Math.min(maxLoss, current);
    }
  }

  return { current, maxWin, maxLoss: Math.abs(maxLoss) };
}

// ─── Main Evolution Cycle ────────────────────────────────────────────────────

/**
 * Run a full evolution cycle. Analyzes all trades, updates weights/thresholds,
 * records the generation, and publishes evolved parameters to signal bus.
 */
function runEvolutionCycle() {
  const state = loadBrainState();
  const trades = loadJournal();
  const closedTrades = trades.filter(t => t.outcome);

  if (closedTrades.length < MIN_TRADES_FOR_LEARNING) {
    return {
      evolved: false,
      reason: `insufficient trades (${closedTrades.length}/${MIN_TRADES_FOR_LEARNING})`,
      state,
    };
  }

  // 1. Indicator attribution
  const attribution = computeIndicatorAttribution(closedTrades);

  // 2. Asset profiling
  const assetProfiles = computeAssetProfiles(closedTrades);

  // 3. Regime profiling
  const regimeProfiles = computeRegimeProfiles(closedTrades);

  // 4. Time patterns
  const timePatterns = computeTimePatterns(closedTrades);

  // 5. Confidence calibration
  const calibration = computeCalibration(closedTrades);

  // 6. Streak tracking
  const streaks = computeStreaks(closedTrades);

  // 7. Evolve weights
  const prevWeights = { ...state.weights };
  const newWeights = evolveWeights(state.weights, attribution);

  // 8. Evolve thresholds
  const prevThresholds = { ...state.thresholds };
  const newThresholds = evolveThresholds(state.thresholds, calibration, assetProfiles, streaks);

  // 9. Apply decay to old weights (prevent getting stuck)
  for (const key of Object.keys(newWeights)) {
    newWeights[key] = newWeights[key] * DECAY_RATE + DEFAULT_WEIGHTS[key] * (1 - DECAY_RATE);
    newWeights[key] = Math.round(newWeights[key] * 10000) / 10000;
  }

  // 10. Record generation
  const generation = {
    id: state.totalEvolutions + 1,
    ts: Date.now(),
    tradesAnalyzed: closedTrades.length,
    prevWeights,
    newWeights,
    prevThresholds,
    newThresholds,
    attribution: Object.fromEntries(
      Object.entries(attribution).map(([k, v]) => [k, { winRate: v.winRate, score: Math.round(v.score * 1000) / 1000, trades: v.totalTrades, netPnl: v.netPnl }])
    ),
    calibrationScore: calibration.calibrationScore,
    streak: streaks.current,
    topAssets: Object.entries(assetProfiles)
      .sort((a, b) => b[1].pnl - a[1].pnl)
      .slice(0, 5)
      .map(([asset, p]) => ({ asset, winRate: p.winRate, pnl: p.pnl, trades: p.trades })),
  };

  // 11. Update state
  state.weights = newWeights;
  state.thresholds = newThresholds;
  state.assetProfiles = assetProfiles;
  state.regimeProfiles = regimeProfiles;
  state.timePatterns = timePatterns;
  state.calibration = calibration;
  state.streaks = streaks;
  state.generations.push(generation);
  state.totalEvolutions += 1;
  saveBrainState(state);

  // 12. Publish to signal bus
  try {
    const bus = require('./agent-signal-bus');
    bus.publish({
      type: 'brain_evolution',
      source: 'self-evolving-brain',
      confidence: 0.95,
      payload: {
        generation: generation.id,
        weights: newWeights,
        thresholds: { minConfidence: newThresholds.minConfidence, minEdge: newThresholds.minEdge },
        calibrationScore: calibration.calibrationScore,
        streak: streaks.current,
        topChanges: Object.keys(DEFAULT_WEIGHTS)
          .filter(k => Math.abs((newWeights[k] || 0) - (prevWeights[k] || 0)) > 0.005)
          .map(k => ({ indicator: k, from: prevWeights[k], to: newWeights[k] })),
      },
      ttlMs: 6 * 60 * 60 * 1000,
    });

    // Publish asset intelligence
    for (const [asset, profile] of Object.entries(assetProfiles)) {
      if (profile.trades >= 5) {
        bus.publish({
          type: 'asset_intelligence',
          source: 'self-evolving-brain',
          confidence: Math.min(0.9, 0.5 + profile.trades * 0.02),
          payload: {
            asset,
            winRate: profile.winRate,
            preferredSide: profile.preferredSide,
            pnl: profile.pnl,
            trades: profile.trades,
          },
          ttlMs: 12 * 60 * 60 * 1000,
        });
      }
    }
  } catch (err) { console.error('[brain] signal bus publish error:', err?.message || err); }

  return {
    evolved: true,
    generation,
    weights: newWeights,
    thresholds: newThresholds,
    assetProfiles,
    regimeProfiles,
    timePatterns: {
      bestHours: timePatterns.bestHours,
      worstHours: timePatterns.worstHours,
      bestDays: timePatterns.bestDays,
    },
    calibration: {
      score: calibration.calibrationScore,
      overconfident: calibration.overconfidentZones,
      underconfident: calibration.underconfidentZones,
    },
    streaks,
  };
}

// ─── Query Methods ───────────────────────────────────────────────────────────

/**
 * Get evolved weights for a specific asset (or global if no asset-specific data).
 */
function getEvolvedWeights(asset = null) {
  const state = loadBrainState();
  return { ...state.weights };
}

/**
 * Get evolved thresholds.
 */
function getEvolvedThresholds() {
  const state = loadBrainState();
  return { ...state.thresholds };
}

/**
 * Get the evolved minimum confidence, accounting for streaks and calibration.
 */
function getEvolvedMinConfidence(defaultValue = 0.56) {
  const state = loadBrainState();
  const evolved = state.thresholds?.minConfidence;
  if (evolved && Number.isFinite(evolved)) return evolved;
  return defaultValue;
}

/**
 * Get sizing multiplier based on current streak and evolved parameters.
 */
function getEvolvedSizingMultiplier() {
  const state = loadBrainState();
  const streak = state.streaks?.current || 0;
  const kelly = state.thresholds?.kellyFraction || 1.0;
  const maxMult = state.thresholds?.maxOrderMultiplier || 3.0;

  // During losing streaks, reduce sizing
  if (streak < -3) return Math.max(0.5, kelly * 0.6);
  if (streak < -1) return Math.max(0.7, kelly * 0.8);
  // During winning streaks, cautiously increase
  if (streak > 5) return Math.min(maxMult, kelly * 1.15);
  if (streak > 3) return Math.min(maxMult, kelly * 1.05);
  return kelly;
}

/**
 * Should we trade right now? Check time patterns and drawdown.
 */
function shouldTradeNow() {
  const state = loadBrainState();
  const hour = new Date().getUTCHours();

  // If we have time pattern data, check if current hour is a consistent loser
  const worstHours = state.timePatterns?.worstHours || [];
  if (worstHours.includes(hour) && state.totalEvolutions > 5) {
    return { trade: false, reason: `hour ${hour} UTC is historically poor`, reducedSize: true };
  }

  // Drawdown check
  if (state.streaks?.current < -(state.thresholds?.losingStreakThreshold || 5)) {
    return { trade: true, reason: 'losing streak — reduced sizing', reducedSize: true };
  }

  return { trade: true, reason: 'ok', reducedSize: false };
}

/**
 * Get comprehensive insights for logging/dashboard.
 */
function getInsights() {
  const state = loadBrainState();
  const lastGen = state.generations[state.generations.length - 1] || null;

  return {
    totalEvolutions: state.totalEvolutions,
    currentWeights: state.weights,
    currentThresholds: {
      minConfidence: state.thresholds.minConfidence,
      minEdge: state.thresholds.minEdge,
      maxOrderMultiplier: state.thresholds.maxOrderMultiplier,
    },
    calibrationScore: state.calibration?.calibrationScore || 0,
    streak: state.streaks?.current || 0,
    topAssets: lastGen?.topAssets || [],
    bestHours: state.timePatterns?.bestHours || [],
    worstHours: state.timePatterns?.worstHours || [],
    lastEvolution: lastGen ? new Date(lastGen.ts).toISOString() : null,
    regimePerformance: state.regimeProfiles,
  };
}

module.exports = {
  runEvolutionCycle,
  getEvolvedWeights,
  getEvolvedThresholds,
  getEvolvedMinConfidence,
  getEvolvedSizingMultiplier,
  shouldTradeNow,
  getInsights,
  computeIndicatorAttribution,
  computeAssetProfiles,
  computeRegimeProfiles,
  computeTimePatterns,
  computeCalibration,
  computeStreaks,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  BRAIN_STATE_FILE,
};
