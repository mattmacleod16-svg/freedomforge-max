/**
 * Volatility Circuit Breaker — Black Swan & Flash Crash Protection
 * ═══════════════════════════════════════════════════════════════════
 * Monitors real-time price action and automatically pauses trading
 * when extreme moves are detected. Protects capital during:
 *   - Flash crashes (rapid drops > threshold in short window)
 *   - Black swan spikes (sudden pumps > threshold)
 *   - Sustained high volatility (vol > 2× normal for extended period)
 *   - Exchange anomalies (price feed divergence between venues)
 *
 * When triggered, trading is halted for a configurable cooldown period.
 * After cooldown, the system resumes only if conditions normalize.
 *
 * Usage:
 *   const vcb = require('./volatility-circuit-breaker');
 *   const check = await vcb.check({ asset: 'BTC', currentPrice, priceHistory });
 *   if (check.halt) { ... skip this trade ... }
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

let log;
try { const { createLogger } = require('./logger'); log = createLogger('vcb'); }
catch { log = { debug(){}, info: console.log, warn: console.warn, error: console.error }; }

const VCB_STATE_FILE = path.resolve(process.cwd(), process.env.VCB_STATE_FILE || 'data/vcb-state.json');

// ── Configuration ─────────────────────────────────────────────────────────────
const CFG = {
  // Flash crash: price drops > X% in Y candles
  flashCrashPct:       parseFloat(process.env.VCB_FLASH_CRASH_PCT     || '0.07'),   // 7%
  flashCrashWindow:    parseInt(process.env.VCB_FLASH_CRASH_WINDOW    || '4', 10),   // 4 candles
  // Black swan spike
  spikePct:            parseFloat(process.env.VCB_SPIKE_PCT           || '0.10'),   // 10%
  spikeWindow:         parseInt(process.env.VCB_SPIKE_WINDOW          || '4', 10),
  // Sustained volatility
  sustainedVolPct:     parseFloat(process.env.VCB_SUSTAINED_VOL_PCT   || '0.04'),   // 4% hourly vol
  sustainedVolPeriod:  parseInt(process.env.VCB_SUSTAINED_VOL_PERIOD  || '6', 10),  // 6 candles
  // Single candle move
  singleCandlePct:     parseFloat(process.env.VCB_SINGLE_CANDLE_PCT   || '0.05'),   // 5% single candle
  // Cross-exchange divergence (CB vs Kraken)
  exchangeDivergencePct: parseFloat(process.env.VCB_DIVERGENCE_PCT    || '0.005'),  // 0.5%
  // Cooldown after trigger
  cooldownMs:          parseInt(process.env.VCB_COOLDOWN_MS           || String(30 * 60 * 1000), 10), // 30 min
  // Auto-resume: require vol to drop below threshold before resuming
  resumeVolThreshold:  parseFloat(process.env.VCB_RESUME_VOL_PCT      || '0.02'),
};

// ── State management ──────────────────────────────────────────────────────────
function loadState() {
  try {
    if (!fs.existsSync(VCB_STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(VCB_STATE_FILE, 'utf8'));
  } catch { return {}; }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(VCB_STATE_FILE), { recursive: true });
    const payload = JSON.stringify(state, null, 2);
    if (rio) rio.writeJsonAtomic(VCB_STATE_FILE, state);
    else fs.writeFileSync(VCB_STATE_FILE, payload);
  } catch (e) { log.warn('VCB state save failed: ' + e.message); }
}

// ── Breaker logic ─────────────────────────────────────────────────────────────

function checkFlashCrash(prices, window, threshold) {
  if (prices.length < window) return { triggered: false };
  const recent = prices.slice(-window);
  const high   = Math.max(...recent);
  const last   = recent[recent.length - 1];
  const drop   = (high - last) / high;
  if (drop >= threshold) {
    return { triggered: true, type: 'flash_crash', pct: parseFloat((drop * 100).toFixed(2)), window };
  }
  return { triggered: false };
}

function checkSpike(prices, window, threshold) {
  if (prices.length < window) return { triggered: false };
  const recent = prices.slice(-window);
  const low    = Math.min(...recent);
  const last   = recent[recent.length - 1];
  const spike  = (last - low) / low;
  if (spike >= threshold) {
    return { triggered: true, type: 'spike', pct: parseFloat((spike * 100).toFixed(2)), window };
  }
  return { triggered: false };
}

function checkSingleCandle(prices, threshold) {
  if (prices.length < 2) return { triggered: false };
  const last = prices[prices.length - 1];
  const prev = prices[prices.length - 2];
  const move = Math.abs(last - prev) / prev;
  if (move >= threshold) {
    return {
      triggered: true,
      type: 'single_candle',
      pct: parseFloat((move * 100).toFixed(2)),
      direction: last > prev ? 'up' : 'down',
    };
  }
  return { triggered: false };
}

function checkSustainedVolatility(prices, period, threshold) {
  if (prices.length < period) return { triggered: false };
  const recent  = prices.slice(-period);
  const returns = recent.slice(1).map((v, i) => Math.abs((v - recent[i]) / recent[i]));
  const avgVol  = returns.reduce((a, b) => a + b, 0) / returns.length;
  if (avgVol >= threshold) {
    return { triggered: true, type: 'sustained_volatility', avgVolPct: parseFloat((avgVol * 100).toFixed(3)) };
  }
  return { triggered: false };
}

function checkCrossExchangeDivergence(priceA, priceB, threshold) {
  if (!priceA || !priceB || priceA === 0 || priceB === 0) return { triggered: false };
  const delta = Math.abs(priceA - priceB) / Math.min(priceA, priceB);
  if (delta >= threshold) {
    return {
      triggered: true,
      type: 'exchange_divergence',
      deltaPct: parseFloat((delta * 100).toFixed(4)),
      priceA, priceB,
    };
  }
  return { triggered: false };
}

// ── Main check function ───────────────────────────────────────────────────────
async function check(opts = {}) {
  const {
    asset         = 'BTC',
    prices        = [],       // Array of recent close prices (most recent last)
    priceA        = null,     // Coinbase price (for divergence check)
    priceB        = null,     // Kraken price
    forceResume   = false,
  } = opts;

  const state   = loadState();
  const assetSt = state[asset] || { halted: false, haltedAt: null, triggers: [] };

  // ── Force resume ──────────────────────────────────────────────────────────
  if (forceResume) {
    assetSt.halted   = false;
    assetSt.haltedAt = null;
    state[asset]     = assetSt;
    saveState(state);
    log.info(`[${asset}] VCB: force resumed`);
    return { halt: false, asset, resumed: true };
  }

  // ── Check if currently halted ─────────────────────────────────────────────
  if (assetSt.halted && assetSt.haltedAt) {
    const elapsed    = Date.now() - assetSt.haltedAt;
    const remaining  = CFG.cooldownMs - elapsed;

    if (remaining > 0) {
      // Still in cooldown
      log.warn(`[${asset}] VCB: halted — ${Math.ceil(remaining / 60000)}min remaining`);
      return {
        halt:          true,
        asset,
        reason:        assetSt.lastTrigger?.type || 'cooldown',
        remainingMs:   remaining,
        remainingMins: Math.ceil(remaining / 60000),
        triggers:      assetSt.triggers || [],
      };
    }

    // Cooldown expired — check if vol normalized
    if (prices.length >= CFG.sustainedVolPeriod) {
      const stillHigh = checkSustainedVolatility(prices, CFG.sustainedVolPeriod, CFG.resumeVolThreshold);
      if (stillHigh.triggered) {
        // Extend cooldown
        assetSt.haltedAt = Date.now();
        state[asset]     = assetSt;
        saveState(state);
        log.warn(`[${asset}] VCB: cooldown extended — vol still elevated at ${stillHigh.avgVolPct}%`);
        return {
          halt:        true,
          asset,
          reason:      'extended_cooldown_high_vol',
          avgVolPct:   stillHigh.avgVolPct,
          remainingMs: CFG.cooldownMs,
        };
      }
    }

    // Resume
    assetSt.halted   = false;
    assetSt.haltedAt = null;
    state[asset]     = assetSt;
    saveState(state);
    log.info(`[${asset}] VCB: cooldown expired, trading RESUMED`);
  }

  // ── Not halted — run all breaker checks ──────────────────────────────────
  if (prices.length < 3) {
    return { halt: false, asset, reason: 'insufficient_data' };
  }

  const checks = [
    checkFlashCrash(prices, CFG.flashCrashWindow, CFG.flashCrashPct),
    checkSpike(prices, CFG.spikeWindow, CFG.spikePct),
    checkSingleCandle(prices, CFG.singleCandlePct),
    checkSustainedVolatility(prices, CFG.sustainedVolPeriod, CFG.sustainedVolPct),
    checkCrossExchangeDivergence(priceA, priceB, CFG.exchangeDivergencePct),
  ];

  const triggered = checks.filter(c => c.triggered);

  if (triggered.length > 0) {
    const primary = triggered[0];
    assetSt.halted      = true;
    assetSt.haltedAt    = Date.now();
    assetSt.lastTrigger = primary;
    assetSt.triggers    = [...(assetSt.triggers || []).slice(-19), { ...primary, timestamp: Date.now() }];
    state[asset]        = assetSt;
    saveState(state);

    log.error(`[${asset}] VCB TRIGGERED: ${primary.type} | ${JSON.stringify(primary)} | halting for ${CFG.cooldownMs / 60000}min`);

    return {
      halt:       true,
      asset,
      reason:     primary.type,
      detail:     primary,
      allTriggers:triggered,
      cooldownMs: CFG.cooldownMs,
      cooldownMins: CFG.cooldownMs / 60000,
      haltedAt:   assetSt.haltedAt,
    };
  }

  // All clear
  return {
    halt:   false,
    asset,
    checks: checks.length,
    prices: prices.length,
  };
}

// ── Status query ──────────────────────────────────────────────────────────────
function getStatus(asset) {
  const state   = loadState();
  const assetSt = state[asset];
  if (!assetSt) return { halted: false, asset };
  const elapsed    = assetSt.haltedAt ? Date.now() - assetSt.haltedAt : 0;
  const remaining  = Math.max(0, CFG.cooldownMs - elapsed);
  return {
    asset,
    halted:         assetSt.halted || false,
    haltedAt:       assetSt.haltedAt,
    remainingMs:    remaining,
    remainingMins:  Math.ceil(remaining / 60000),
    lastTrigger:    assetSt.lastTrigger,
    triggerHistory: assetSt.triggers || [],
  };
}

function getAllStatuses() {
  const state = loadState();
  return Object.keys(state).map(asset => getStatus(asset));
}

module.exports = {
  check, getStatus, getAllStatuses,
  // Exposed for testing
  checkFlashCrash, checkSpike, checkSingleCandle,
  checkSustainedVolatility, checkCrossExchangeDivergence,
  CFG,
};
