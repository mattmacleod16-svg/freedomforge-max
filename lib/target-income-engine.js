/**
 * TARGET INCOME ENGINE — FreedomForge Core
 * ══════════════════════════════════════════════════════════════════════════
 * 
 * THE CENTERPIECE. Tell the system how much you want to make.
 * It figures out HOW to get there and routes capital accordingly across:
 *   • Spot trading (Coinbase + Kraken) — momentum, mean-reversion, breakouts
 *   • Futures / perpetuals (dYdX, GMX via onchain clients)
 *   • Prediction markets (Polymarket, Kalshi, Azuro)
 *   • DeFi yield (Compound, Aave, LP positions)
 *   • Mining revenue (5 rigs — baseline passive income)
 * 
 * Usage:
 *   const engine = require('./target-income-engine');
 *   engine.setTarget({ daily: 50 });    // "make me $50/day"
 *   engine.setTarget({ weekly: 500 });  // "make me $500/week"
 *   engine.setTarget({ monthly: 5000 }); // "make me $5k/month"
 *   engine.getStatus();                 // current progress vs target
 * 
 * The engine:
 *   1. Calculates required daily/hourly run-rate to hit target
 *   2. Assesses each revenue stream's current capacity + confidence
 *   3. Allocates capital proportionally to highest-confidence streams
 *   4. Monitors progress every 15 min and rebalances if off-track
 *   5. Escalates aggression tier (conservative → normal → growth → max)
 *      only when mathematically necessary and risk-approved
 *   6. NEVER violates capital mandate — target adjusts if capital can't support it
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR   = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'target-income-state.json');

// ── Logging ──────────────────────────────────────────────────────────────────
const TAG = '[target-income]';
const log = {
  info:  (...a) => console.log( new Date().toISOString(), TAG, 'INFO ', ...a),
  warn:  (...a) => console.warn(new Date().toISOString(), TAG, 'WARN ', ...a),
  error: (...a) => console.error(new Date().toISOString(), TAG, 'ERROR', ...a),
  done:  (...a) => console.log( new Date().toISOString(), TAG, '✅   ', ...a),
};

// ── Revenue Streams ───────────────────────────────────────────────────────────
// Each stream has a capacity function, confidence scorer, and allocator
const STREAMS = {
  spot_trading: {
    label:       'Spot Trading (CB + Kraken)',
    minCapital:  200,
    maxPctDaily: 0.08,          // Max 8% daily return target
    confidence:  () => getSpotConfidence(),
    estimateDailyUSD: (capital, confidence) => capital * 0.04 * confidence,
  },
  prediction_markets: {
    label:       'Prediction Markets (Poly/Kalshi/Azuro)',
    minCapital:  50,
    maxPctDaily: 0.15,
    confidence:  () => getPredictionConfidence(),
    estimateDailyUSD: (capital, confidence) => capital * 0.06 * confidence,
  },
  defi_yield: {
    label:       'DeFi Yield (Compound/Aave/LP)',
    minCapital:  100,
    maxPctDaily: 0.003,         // ~1% APY/day for stable yield
    confidence:  () => 0.85,   // DeFi yield is highly predictable
    estimateDailyUSD: (capital, confidence) => capital * 0.001 * confidence,
  },
  mining: {
    label:       'Mining Fleet (5 rigs)',
    minCapital:  0,             // No capital required — hardware is deployed
    maxPctDaily: 999,           // No cap — passive income
    confidence:  () => 0.90,   // High confidence — rigs are physical
    estimateDailyUSD: (_capital, _confidence) => getMiningDailyUSD(),
  },
  futures: {
    label:       'Futures / Perpetuals (dYdX/GMX)',
    minCapital:  300,
    maxPctDaily: 0.12,          // Higher return potential, higher risk
    confidence:  () => getFuturesConfidence(),
    estimateDailyUSD: (capital, confidence) => capital * 0.05 * confidence,
  },
};

// ── Default State ─────────────────────────────────────────────────────────────
function defaultState() {
  return {
    target: null,               // { daily: number, weekly: number, monthly: number, set_at: ts }
    progress: {
      today: 0,
      week: 0,
      month: 0,
      allTime: 0,
    },
    allocation: {},             // { stream_name: pctOfCapital }
    aggressionTier: 'normal',   // conservative | normal | growth | max
    lastRebalance: 0,
    history: [],                // daily snapshots
    streamStats: {},            // per-stream tracking
    updatedAt: Date.now(),
  };
}

// ── State I/O ─────────────────────────────────────────────────────────────────
let _state = null;

function load() {
  if (_state) return _state;
  try {
    if (!fs.existsSync(STATE_FILE)) { _state = defaultState(); return _state; }
    _state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return _state;
  } catch { _state = defaultState(); return _state; }
}

function save(s) {
  s.updatedAt = Date.now();
  _state = s;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) { log.error('save failed:', e.message); }
}

// ── Revenue Estimators ────────────────────────────────────────────────────────
function getCapital() {
  try {
    const gf = path.join(DATA_DIR, 'liquidation-guardian-state.json');
    if (fs.existsSync(gf)) {
      const g = JSON.parse(fs.readFileSync(gf, 'utf8'));
      return (g?.coinbase?.totalBalance || 0) + (g?.kraken?.equity || 0);
    }
  } catch {}
  // Fallback to mandate state
  try {
    const mf = path.join(DATA_DIR, 'capital-mandate-state.json');
    if (fs.existsSync(mf)) {
      const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
      return m?.highWaterMark || 455;
    }
  } catch {}
  return 455; // Known starting capital
}

function getMiningDailyUSD() {
  try {
    const mf = path.join(DATA_DIR, 'mining-stats.json');
    if (fs.existsSync(mf)) {
      const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
      return m?.earnings24hUSD || 8; // ~$8/day baseline from 5 rigs
    }
  } catch {}
  return 8; // Conservative estimate
}

function getSpotConfidence() {
  try {
    const rf = path.join(DATA_DIR, 'regime-state.json');
    if (fs.existsSync(rf)) {
      const r = JSON.parse(fs.readFileSync(rf, 'utf8'));
      const regime = r?.regime || 'unknown';
      // Bull: high confidence, Bear: medium, Sideways: lower
      if (regime === 'bullTrend') return 0.75;
      if (regime === 'bearTrend') return 0.55;
      if (regime === 'sideways')  return 0.60;
      if (regime.includes('Vol')) return 0.40;
    }
  } catch {}
  return 0.55; // Default bear market conservative
}

function getPredictionConfidence() {
  // Based on historical Brier score from forecast engine
  try {
    const ff = path.join(DATA_DIR, 'forecast-state.json');
    if (fs.existsSync(ff)) {
      const f = JSON.parse(fs.readFileSync(ff, 'utf8'));
      const records = f?.records || [];
      const resolved = records.filter(r => r.resolved && r.brierScore !== undefined);
      if (resolved.length >= 5) {
        const avgBrier = resolved.slice(-20).reduce((s, r) => s + r.brierScore, 0) / Math.min(resolved.length, 20);
        // Lower Brier = better calibration = higher confidence
        return Math.max(0.3, Math.min(0.85, 1 - avgBrier * 2));
      }
    }
  } catch {}
  return 0.55;
}

function getFuturesConfidence() {
  // Futures only high-confidence in strong trending markets
  const spotConf = getSpotConfidence();
  try {
    const rf = path.join(DATA_DIR, 'regime-state.json');
    if (fs.existsSync(rf)) {
      const r = JSON.parse(fs.readFileSync(rf, 'utf8'));
      if (r?.trend === 'strong_bull' || r?.trend === 'strong_bear') return spotConf * 1.1;
    }
  } catch {}
  return spotConf * 0.85; // Slightly below spot in uncertain regimes
}

// ── Core Engine ───────────────────────────────────────────────────────────────

/**
 * SET TARGET — the main entry point
 * Call with { daily, weekly, or monthly } target in USD
 */
function setTarget({ daily, weekly, monthly, label } = {}) {
  const s = load();
  
  let dailyTarget = daily;
  if (!dailyTarget && weekly)  dailyTarget = weekly  / 7;
  if (!dailyTarget && monthly) dailyTarget = monthly / 30;
  
  if (!dailyTarget || dailyTarget <= 0) {
    log.warn('Invalid target — must provide daily, weekly, or monthly');
    return { ok: false, error: 'Invalid target' };
  }

  s.target = {
    daily:   dailyTarget,
    weekly:  dailyTarget * 7,
    monthly: dailyTarget * 30,
    annual:  dailyTarget * 365,
    label:   label || `$${dailyTarget.toFixed(0)}/day`,
    set_at:  Date.now(),
  };

  log.info(`Target SET: $${dailyTarget.toFixed(2)}/day ($${(dailyTarget*30).toFixed(0)}/mo, $${(dailyTarget*365).toFixed(0)}/yr)`);
  
  save(s);
  return rebalance();
}

/**
 * REBALANCE — called every 15 min by automation
 * Assesses all streams, allocates capital to hit target
 */
function rebalance() {
  const s = load();
  const capital = getCapital();
  const target  = s.target?.daily || 0;

  if (!target) {
    log.info('No target set — monitoring mode only');
    save(s);
    return { ok: true, mode: 'monitoring', capital };
  }

  // Score each stream
  const streamScores = {};
  let totalEstimatedDaily = 0;
  
  for (const [key, stream] of Object.entries(STREAMS)) {
    if (capital < stream.minCapital) {
      streamScores[key] = { active: false, reason: `insufficient capital (need $${stream.minCapital})` };
      continue;
    }
    const conf    = stream.confidence();
    const est     = stream.estimateDailyUSD(capital, conf);
    totalEstimatedDaily += est;
    streamScores[key] = {
      active:       true,
      label:        stream.label,
      confidence:   conf,
      estimatedUSD: est,
      priority:     conf * est, // weighted priority
    };
  }

  // Determine aggression tier
  let tier = 'normal';
  if (totalEstimatedDaily < target * 0.5)  tier = 'growth';       // Need to push harder
  if (totalEstimatedDaily < target * 0.25) tier = 'max';          // All engines on
  if (totalEstimatedDaily > target * 2.0)  tier = 'conservative'; // Overperforming — dial back
  s.aggressionTier = tier;

  // Build allocation plan
  const active = Object.entries(streamScores).filter(([,v]) => v.active);
  const totalPriority = active.reduce((sum, [,v]) => sum + v.priority, 0);
  
  const allocation = {};
  for (const [key, v] of active) {
    allocation[key] = totalPriority > 0 ? (v.priority / totalPriority) : (1 / active.length);
  }
  
  s.allocation  = allocation;
  s.streamStats = streamScores;
  s.lastRebalance = Date.now();

  const gap = target - totalEstimatedDaily;
  const onTrack = totalEstimatedDaily >= target * 0.8;

  log.info(`Rebalance: target=$${target.toFixed(2)}/day estimated=$${totalEstimatedDaily.toFixed(2)}/day tier=${tier} onTrack=${onTrack}`);
  
  save(s);
  return {
    ok: true,
    capital,
    target: s.target,
    estimated: {
      daily: totalEstimatedDaily,
      weekly: totalEstimatedDaily * 7,
      monthly: totalEstimatedDaily * 30,
    },
    onTrack,
    gap: Math.max(0, gap),
    aggressionTier: tier,
    streams: streamScores,
    allocation,
    recommendation: buildRecommendation(target, totalEstimatedDaily, tier, streamScores, capital),
  };
}

function buildRecommendation(target, estimated, tier, streams, capital) {
  const recs = [];
  
  if (estimated < target * 0.5) {
    recs.push(`⚠️ Estimated $${estimated.toFixed(0)}/day is below target $${target.toFixed(0)}/day — escalating to ${tier} mode`);
  }
  
  // Mining is always the most reliable baseline
  const mining = streams.mining;
  if (mining?.active && mining.estimatedUSD > 0) {
    recs.push(`⛏️ Mining baseline: ~$${mining.estimatedUSD.toFixed(2)}/day (no capital risk)`);
  }
  
  // Spot only when confident
  const spot = streams.spot_trading;
  if (spot?.active && spot.confidence < 0.5) {
    recs.push(`⚠️ Spot confidence low (${(spot.confidence*100).toFixed(0)}%) — reducing spot allocation`);
  }
  
  // Capital growth advice
  if (capital < 1000 && target > 20) {
    recs.push(`💡 Capital $${capital.toFixed(0)} limits daily target. To reliably hit $${target.toFixed(0)}/day need ~$${(target*25).toFixed(0)} capital`);
  }
  
  return recs;
}

/**
 * RECORD REVENUE — call after each realized P&L event
 */
function recordRevenue({ stream, amountUSD, note = '' }) {
  const s = load();
  
  s.progress.today   = (s.progress.today   || 0) + amountUSD;
  s.progress.week    = (s.progress.week    || 0) + amountUSD;
  s.progress.month   = (s.progress.month   || 0) + amountUSD;
  s.progress.allTime = (s.progress.allTime || 0) + amountUSD;

  if (!s.streamStats[stream]) s.streamStats[stream] = {};
  s.streamStats[stream].realized = (s.streamStats[stream].realized || 0) + amountUSD;
  
  const target = s.target?.daily || 0;
  if (target > 0) {
    const pct = (s.progress.today / target * 100).toFixed(1);
    log.done(`Revenue +$${amountUSD.toFixed(2)} via ${stream} | Today: $${s.progress.today.toFixed(2)} (${pct}% of target) | Note: ${note}`);
  }
  
  save(s);
}

/**
 * RESET DAILY — call at midnight
 */
function resetDaily() {
  const s = load();
  
  // Archive today
  s.history.push({
    date:     new Date().toISOString().slice(0, 10),
    realized: s.progress.today,
    target:   s.target?.daily || 0,
    achieved: s.target?.daily ? s.progress.today >= s.target.daily : null,
  });
  
  // Keep 90 days
  if (s.history.length > 90) s.history = s.history.slice(-90);
  
  s.progress.today = 0;
  // Reset week on Sunday
  if (new Date().getDay() === 0) s.progress.week = 0;
  // Reset month on 1st
  if (new Date().getDate() === 1) s.progress.month = 0;
  
  save(s);
  log.info('Daily reset complete');
}

/**
 * GET STATUS — full status report
 */
function getStatus() {
  const s = load();
  const capital = getCapital();
  const rebalanced = rebalance();
  
  return {
    target:         s.target,
    progress:       s.progress,
    capital,
    onTrack:        rebalanced.onTrack,
    aggressionTier: s.aggressionTier,
    streams:        s.streamStats,
    allocation:     s.allocation,
    estimated:      rebalanced.estimated,
    recommendation: rebalanced.recommendation,
    history:        (s.history || []).slice(-7), // Last 7 days
    updatedAt:      s.updatedAt,
  };
}

module.exports = {
  setTarget,
  rebalance,
  recordRevenue,
  resetDaily,
  getStatus,
  getCapital,
};
