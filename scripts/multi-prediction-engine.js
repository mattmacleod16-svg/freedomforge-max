#!/usr/bin/env node

/**
 * Multi-Venue Prediction Market Engine
 * ═════════════════════════════════════
 *
 * Aggregates prediction market data from all available venues:
 *  - Polymarket (existing CLOB engine)
 *  - Kalshi (CFTC-regulated event contracts)
 *  - Augur (decentralized, Ethereum/Polygon)
 *  - Overtime (sports markets, Optimism/Base/Arbitrum)
 *
 * Provides:
 *  - Cross-venue price comparison for similar events
 *  - Arbitrage detection across prediction platforms
 *  - Unified signal feed for the edge detector
 *  - Portfolio-level position tracking
 *
 * NOTE: Add to venue-engine.js map:
 *   predictions: ['node', ['scripts/multi-prediction-engine.js']]
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createLogger } = require('../lib/logger');
const log = createLogger('multi-pred');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

// ─── Configuration ──────────────────────────────────────────────────────────

const ENABLED = String(process.env.MULTI_PRED_ENABLED || 'false').toLowerCase() === 'true';
const DRY_RUN = String(process.env.MULTI_PRED_DRY_RUN || 'true').toLowerCase() !== 'false';
const MIN_EDGE = Math.max(0.01, Number(process.env.MULTI_PRED_MIN_EDGE || 0.05));
const MAX_ORDER_USD = Math.max(5, Number(process.env.MULTI_PRED_MAX_ORDER_USD || 25));
const CHECK_INTERVAL_SEC = Math.max(60, Number(process.env.MULTI_PRED_CHECK_INTERVAL_SEC || 600));
const STATE_FILE = process.env.MULTI_PRED_STATE_FILE || 'data/multi-prediction-state.json';

const KALSHI_ENABLED = String(process.env.KALSHI_ENABLED || 'false').toLowerCase() === 'true';
const OVERTIME_ENABLED = String(process.env.OVERTIME_ENABLED || 'false').toLowerCase() === 'true';
const AUGUR_ENABLED = String(process.env.AUGUR_ENABLED || 'false').toLowerCase() === 'true';

// ─── Optional Library Imports ───────────────────────────────────────────────

let KalshiClient, OvertimeClient, AugurClient;
try { ({ KalshiClient } = require('../lib/predictions/kalshi/client')); } catch { KalshiClient = null; }
try { ({ OvertimeClient } = require('../lib/predictions/overtime/client')); } catch { OvertimeClient = null; }
try { ({ AugurClient } = require('../lib/predictions/augur/client')); } catch { AugurClient = null; }

let signalBus;
try { signalBus = require('../lib/agent-signal-bus'); } catch { signalBus = null; }

let tradeJournal;
try { tradeJournal = require('../lib/trade-journal'); } catch { tradeJournal = null; }

let riskManager;
try { riskManager = require('../lib/risk-manager'); } catch { riskManager = null; }

let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

// ─── State Management ───────────────────────────────────────────────────────

function loadState() {
  const abs = path.resolve(process.cwd(), STATE_FILE);
  if (rio) {
    const data = rio.readJsonSafe(abs, { fallback: null });
    return { path: abs, data: data || createDefaultState() };
  }
  if (!fs.existsSync(abs)) return { path: abs, data: createDefaultState() };
  try {
    return { path: abs, data: JSON.parse(fs.readFileSync(abs, 'utf8')) };
  } catch {
    return { path: abs, data: createDefaultState() };
  }
}

function createDefaultState() {
  return {
    lastRunAt: 0,
    cycles: 0,
    venues: {
      kalshi:   { enabled: false, marketsScanned: 0, opportunities: 0, errors: 0 },
      overtime: { enabled: false, marketsScanned: 0, opportunities: 0, errors: 0 },
      augur:    { enabled: false, marketsScanned: 0, opportunities: 0, errors: 0 },
    },
    arbOpportunities: [],
    signals: [],
  };
}

function saveState(st) {
  try {
    if (rio) {
      rio.writeJsonSafe(st.path, st.data);
    } else {
      fs.writeFileSync(st.path, JSON.stringify(st.data, null, 2));
    }
  } catch (err) {
    log.error('Failed to save state', { error: err.message });
  }
}

// ─── Kill Switch Check ─────────────────────────────────────────────────────

function isKillSwitchActive() {
  try {
    const ks = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'data/kill-switch.json'), 'utf8'));
    return ks?.active === true;
  } catch { return false; }
}

// ─── Venue Scanners ─────────────────────────────────────────────────────────

async function scanKalshi() {
  if (!KalshiClient || !KALSHI_ENABLED) return { skipped: true };

  log.info('Scanning Kalshi markets...');
  const client = new KalshiClient();

  try {
    const markets = await client.getMarkets({ limit: 100 });
    const marketList = markets?.markets || [];

    const opportunities = [];
    for (const m of marketList) {
      if (m.status !== 'open') continue;

      const yesPrice = m.yes_bid || m.last_price;
      const noPrice = m.no_bid || (100 - (m.last_price || 50));

      // Look for markets where implied probability is skewed
      if (yesPrice && yesPrice > 0 && yesPrice < 100) {
        const impliedProb = yesPrice / 100;
        opportunities.push({
          venue: 'kalshi',
          ticker: m.ticker,
          title: m.title || m.subtitle,
          yesPrice,
          noPrice,
          impliedProb,
          volume: m.volume || 0,
          openInterest: m.open_interest || 0,
          closeTime: m.close_time,
        });
      }
    }

    return {
      marketsScanned: marketList.length,
      opportunities: opportunities.length,
      topOpportunities: opportunities
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 20),
    };
  } catch (err) {
    log.error('Kalshi scan failed', { error: err.message });
    return { error: err.message };
  }
}

async function scanOvertime() {
  if (!OvertimeClient || !OVERTIME_ENABLED) return { skipped: true };

  log.info('Scanning Overtime markets...');
  const client = new OvertimeClient();

  try {
    const opportunities = await client.scanOpportunities(MIN_EDGE);
    return {
      marketsScanned: opportunities.length,
      opportunities: opportunities.length,
      topOpportunities: opportunities.slice(0, 20),
    };
  } catch (err) {
    log.error('Overtime scan failed', { error: err.message });
    return { error: err.message };
  }
}

async function scanAugur() {
  if (!AugurClient || !AUGUR_ENABLED) return { skipped: true };

  log.info('Scanning Augur markets...');
  const client = new AugurClient();

  try {
    const opportunities = await client.scanOpportunities(1000);
    return {
      marketsScanned: opportunities.length,
      opportunities: opportunities.length,
      topOpportunities: opportunities.slice(0, 20),
    };
  } catch (err) {
    log.error('Augur scan failed', { error: err.message });
    return { error: err.message };
  }
}

// ─── Cross-Venue Arbitrage Detection ────────────────────────────────────────

function detectCrossVenueArbs(kalshiData, overtimeData, augurData) {
  const arbs = [];

  // Simple keyword matching between venues for similar events
  const kalshiMarkets = kalshiData?.topOpportunities || [];

  // Look for price discrepancies on similar events across venues
  // This is a heuristic — real implementation would use ML-based event matching
  for (const km of kalshiMarkets) {
    const title = (km.title || '').toLowerCase();

    // Check against Augur markets
    for (const am of (augurData?.topOpportunities || [])) {
      const desc = (am.description || '').toLowerCase();
      const overlap = title.split(' ').filter(w => w.length > 3 && desc.includes(w));

      if (overlap.length >= 3) {
        arbs.push({
          type: 'cross-venue',
          venues: ['kalshi', 'augur'],
          event: km.title,
          kalshiProb: km.impliedProb,
          augurId: am.id,
          matchConfidence: overlap.length / title.split(' ').length,
        });
      }
    }
  }

  return arbs;
}

// ─── Core Engine ────────────────────────────────────────────────────────────

async function runCycle() {
  if (!ENABLED) {
    log.info('Multi-prediction engine disabled');
    return { skipped: true, reason: 'disabled' };
  }

  if (isKillSwitchActive()) {
    log.warn('Kill switch active — skipping prediction scan');
    return { skipped: true, reason: 'kill_switch' };
  }

  const st = loadState();
  const now = Date.now();

  if (st.data.lastRunAt && (now - st.data.lastRunAt) < CHECK_INTERVAL_SEC * 1000) {
    return { skipped: true, reason: 'cooldown' };
  }

  log.info('Starting multi-venue prediction market scan...');

  // Scan all venues in parallel
  const [kalshi, overtime, augur] = await Promise.allSettled([
    scanKalshi(),
    scanOvertime(),
    scanAugur(),
  ]);

  const kalshiResult = kalshi.status === 'fulfilled' ? kalshi.value : { error: kalshi.reason?.message };
  const overtimeResult = overtime.status === 'fulfilled' ? overtime.value : { error: overtime.reason?.message };
  const augurResult = augur.status === 'fulfilled' ? augur.value : { error: augur.reason?.message };

  // Cross-venue arbitrage
  const arbs = detectCrossVenueArbs(kalshiResult, overtimeResult, augurResult);

  // Update state
  if (!kalshiResult.skipped) {
    st.data.venues.kalshi = {
      enabled: KALSHI_ENABLED,
      marketsScanned: kalshiResult.marketsScanned || 0,
      opportunities: kalshiResult.opportunities || 0,
      errors: kalshiResult.error ? (st.data.venues.kalshi.errors || 0) + 1 : 0,
      lastScan: now,
    };
  }
  if (!overtimeResult.skipped) {
    st.data.venues.overtime = {
      enabled: OVERTIME_ENABLED,
      marketsScanned: overtimeResult.marketsScanned || 0,
      opportunities: overtimeResult.opportunities || 0,
      errors: overtimeResult.error ? (st.data.venues.overtime.errors || 0) + 1 : 0,
      lastScan: now,
    };
  }
  if (!augurResult.skipped) {
    st.data.venues.augur = {
      enabled: AUGUR_ENABLED,
      marketsScanned: augurResult.marketsScanned || 0,
      opportunities: augurResult.opportunities || 0,
      errors: augurResult.error ? (st.data.venues.augur.errors || 0) + 1 : 0,
      lastScan: now,
    };
  }

  st.data.arbOpportunities = arbs.slice(0, 10);
  st.data.lastRunAt = now;
  st.data.cycles += 1;
  saveState(st);

  // Publish signals
  if (signalBus) {
    const totalOpps = (kalshiResult.opportunities || 0) +
                      (overtimeResult.opportunities || 0) +
                      (augurResult.opportunities || 0);
    signalBus.publish({
      type: 'prediction_scan',
      source: 'multi-prediction',
      data: {
        venues: ['kalshi', 'overtime', 'augur'].filter(v =>
          v === 'kalshi' ? KALSHI_ENABLED : v === 'overtime' ? OVERTIME_ENABLED : AUGUR_ENABLED
        ),
        opportunities: totalOpps,
        arbs: arbs.length,
      },
    });
  }

  const result = {
    kalshi: kalshiResult,
    overtime: overtimeResult,
    augur: augurResult,
    crossVenueArbs: arbs,
    dryRun: DRY_RUN,
  };

  log.info('Multi-prediction scan complete', {
    kalshi: kalshiResult.marketsScanned || 'skipped',
    overtime: overtimeResult.marketsScanned || 'skipped',
    augur: augurResult.marketsScanned || 'skipped',
    arbs: arbs.length,
  });

  return result;
}

// ─── CLI Entry Point ────────────────────────────────────────────────────────

if (require.main === module) {
  runCycle()
    .then(r => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r?.error ? 1 : 0);
    })
    .catch(err => {
      console.error('Fatal:', err);
      process.exit(1);
    });
}

module.exports = { runCycle };
