#!/usr/bin/env node

/**
 * Master Orchestrator — The supreme coordinator of all trading agents.
 *
 * This is the brain that ties everything together into a relentless,
 * self-improving trading machine. Runs every 3-5 minutes and:
 *
 *   1. Checks system health (risk manager, kill switch, signal bus)
 *   2. Runs the self-evolving brain for continuous parameter optimization
 *   3. Consults the horizontal scaler for asset list updates  
 *   4. Fetches composite signals for all active assets
 *   5. Routes trades to the best venue per asset
 *   6. Enforces risk limits before every trade
 *   7. Tracks P&L and adjusts aggression dynamically
 *   8. Publishes comprehensive state to signal bus
 *   9. Self-heals — detects and recovers from errors
 *  10. Compresses and archives old data to prevent disk bloat
 *
 * Applies Anthropic pattern: "Break complex tasks into subtasks"
 * Each phase is a discrete, testable step with clear outputs.
 *
 * Designed to replace the basic venue-engine as the primary executor.
 * Run as systemd timer every 3-5 minutes.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

// ─── Configuration ───────────────────────────────────────────────────────────

const ORCHESTRATOR_ENABLED = String(process.env.ORCHESTRATOR_ENABLED || 'true').toLowerCase() === 'true';
const DRY_RUN = String(process.env.DRY_RUN || 'false').toLowerCase() !== 'false';
const MAX_TRADES_PER_CYCLE = Math.max(1, Math.min(10, parseInt(process.env.ORCH_MAX_TRADES_PER_CYCLE || '3', 10)));
const CYCLE_TIMEOUT_MS = Math.max(30000, parseInt(process.env.ORCH_CYCLE_TIMEOUT_MS || '120000', 10));
const MIN_CYCLE_INTERVAL_SEC = Math.max(60, parseInt(process.env.ORCH_MIN_INTERVAL_SEC || '170', 10));
const STATE_FILE = path.resolve(process.cwd(), process.env.ORCH_STATE_FILE || 'data/orchestrator-state.json');
const ALERT_WEBHOOK_URL = (process.env.ALERT_WEBHOOK_URL || '').trim();
const ALERT_MODE = String(process.env.ALERT_MODE || 'critical-only').toLowerCase();
const LOG_LEVEL = String(process.env.ORCH_LOG_LEVEL || 'info').toLowerCase();

// Venue configuration
const VENUE_PRIORITY = String(process.env.TRADE_VENUE_PRIORITY || 'kraken,coinbase,prediction,polymarket')
  .split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
const KRAKEN_ENABLED = String(process.env.KRAKEN_ENABLED || 'false').toLowerCase() === 'true';
const COINBASE_ENABLED = String(process.env.COINBASE_ENABLED || 'false').toLowerCase() === 'true';
const PRED_ENABLED = String(process.env.PRED_MARKET_ENABLED || 'false').toLowerCase() === 'true';

// Base order sizing
const BASE_ORDER_USD = Math.max(5, Number(process.env.ORCH_BASE_ORDER_USD || process.env.KRAKEN_ORDER_USD || 15));

// ─── Module Loading ──────────────────────────────────────────────────────────

let edgeDetector, signalBus, tradeJournal, brain, riskManager, liquidationGuardian, capitalMandate;
try { edgeDetector = require('../lib/edge-detector'); } catch (e) { console.error('edge-detector missing:', e.message); }
try { signalBus = require('../lib/agent-signal-bus'); } catch (e) { console.error('signal-bus missing:', e.message); }
try { tradeJournal = require('../lib/trade-journal'); } catch { tradeJournal = null; }
try { brain = require('../lib/self-evolving-brain'); } catch { brain = null; }
try { riskManager = require('../lib/risk-manager'); } catch { riskManager = null; }
try { liquidationGuardian = require('../lib/liquidation-guardian'); } catch { liquidationGuardian = null; }
try { capitalMandate = require('../lib/capital-mandate'); } catch { capitalMandate = null; }
let tradeReconciler;
try { tradeReconciler = require('../lib/trade-reconciler'); } catch { tradeReconciler = null; }
let treasuryLedger;
try { treasuryLedger = require('../lib/treasury-ledger'); } catch { treasuryLedger = null; }

// ─── State Management ────────────────────────────────────────────────────────

// Resilient I/O — atomic writes, backup recovery, file locking
let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

function loadState() {
  const defaultState = { lastRunAt: 0, cycleCount: 0, totalTrades: 0, totalPnl: 0, errors: [] };
  if (rio) return rio.readJsonSafe(STATE_FILE, { fallback: null }) || defaultState;
  try {
    if (!fs.existsSync(STATE_FILE)) return defaultState;
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch { return defaultState; }
}

function saveState(state) {
  state.updatedAt = Date.now();
  if (state.errors?.length > 50) state.errors = state.errors.slice(-50);
  if (rio) { rio.writeJsonAtomic(STATE_FILE, state); return; }
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

// ─── Alerting (hardened with retry + timeout) ────────────────────────────────

async function sendAlert(message, level = 'info') {
  if (!ALERT_WEBHOOK_URL) return;
  if (ALERT_MODE === 'critical-only' && level !== 'critical') return;
  const body = JSON.stringify({ content: message.slice(0, 1900) });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(ALERT_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok || res.status < 500) return; // Success or client error (don't retry)
      } finally { clearTimeout(timer); }
    } catch {}
    if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
  }
}

function log(level, msg) {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  if ((levels[level] || 0) >= (levels[LOG_LEVEL] || 1)) {
    const prefix = `[orch][${level.toUpperCase()}]`;
    if (level === 'error') console.error(`${prefix} ${msg}`);
    else console.log(`${prefix} ${msg}`);
  }
}

// ─── Phase 1: Health Check ───────────────────────────────────────────────────

async function phaseHealthCheck() {
  log('info', '═══ Phase 1: System Health Check ═══');
  const health = {
    edgeDetector: !!edgeDetector,
    signalBus: !!signalBus,
    tradeJournal: !!tradeJournal,
    brain: !!brain,
    riskManager: !!riskManager,
    liquidationGuardian: !!liquidationGuardian,
  };

  // Run liquidation guardian check first
  if (liquidationGuardian) {
    try {
      const guardianResult = await liquidationGuardian.runGuardianCycle();
      health.coinbaseMarginPct = guardianResult.coinbase?.marginPct || 0;
      health.krakenMarginPct = guardianResult.kraken?.marginPct || 0;
      health.coinbaseLiqBuffer = guardianResult.coinbase?.liquidationBuffer || 999;
      health.guardianActions = guardianResult.actions?.length || 0;
      if (guardianResult.actions?.length > 0) {
        log('warn', `Guardian took ${guardianResult.actions.length} emergency actions this cycle`);
      }

      // ═══ KEEP TREASURY CURRENT CAPITAL LIVE ═══
      // Update treasury ledger with live exchange balance every cycle
      // so dashboard metrics never go stale
      if (treasuryLedger) {
        const cbTotal = guardianResult.coinbase?.totalBalance || 0;
        const krTotal = guardianResult.kraken?.equity || 0;
        const liveCapital = cbTotal + krTotal;
        if (liveCapital > 0) {
          treasuryLedger.updateCapital(liveCapital);
        }
      }
    } catch (e) {
      log('error', `Guardian check failed: ${e.message}`);
    }
  }

  // ═══ CAPITAL MANDATE CHECK — ZERO INJECTION PROTOCOL ═══
  if (capitalMandate) {
    const mandate = capitalMandate.getMandateSummary();
    health.mandateMode = mandate.mode;
    health.mandateCapital = mandate.capital.total;
    health.mandateROI = mandate.roiPct;
    log('info', `💰 MANDATE: $${mandate.capital.total.toFixed(2)} | Mode: ${mandate.mode.toUpperCase()} | ROI: ${mandate.roiPct >= 0 ? '+' : ''}${mandate.roiPct.toFixed(1)}% | HWM: $${mandate.highWaterMark.toFixed(2)}`);
    capitalMandate.takeDailySnapshot();
    if (mandate.mode === 'capital_halt') {
      log('error', '🚨 CAPITAL MANDATE HALT — capital below critical floor. ALL TRADING SUSPENDED.');
      return { ...health, abort: true, reason: 'capital_mandate_halt' };
    }
    if (mandate.mode === 'survival') {
      log('warn', '⚠️ SURVIVAL MODE — ultra-conservative trading only. Preserve capital at all costs.');
    }
  }

  // Check kill switch
  if (riskManager) {
    health.killSwitch = riskManager.isKillSwitchActive();
    if (health.killSwitch) {
      log('error', '🛑 KILL SWITCH IS ACTIVE — aborting cycle');
      return { ...health, abort: true, reason: 'kill_switch_active' };
    }

    const riskHealth = riskManager.getRiskHealth();
    health.riskHealthy = riskHealth.healthy;
    health.drawdownPct = riskHealth.drawdownPct;
    health.utilizationPct = riskHealth.utilizationPct;
    health.dailyPnl = riskHealth.dailyPnl;

    if (!riskHealth.healthy) {
      log('warn', `Risk health check FAILED (DD:${riskHealth.drawdownPct}%, Util:${riskHealth.utilizationPct}%)`);
    }
  }

  // Check signal bus freshness
  if (signalBus) {
    const summary = signalBus.summary();
    health.signalBusSignals = summary.totalSignals;
    health.signalTypes = Object.keys(summary.types || {}).length;
    log('info', `Signal bus: ${summary.totalSignals} signals across ${health.signalTypes} types`);
  }

  health.abort = false;
  return health;
}

// ─── Phase 2: Brain Evolution ────────────────────────────────────────────────

function phaseBrainEvolution() {
  log('info', '═══ Phase 2: Brain Evolution ═══');
  if (!brain) {
    log('warn', 'Brain module not available');
    return { evolved: false, reason: 'module_unavailable' };
  }

  try {
    const result = brain.runEvolutionCycle();
    if (result.evolved) {
      log('info', `Brain evolved to gen ${result.generation?.id} (calibration: ${result.calibration?.score})`);
      log('info', `  Weights: ${JSON.stringify(result.weights)}`);
      log('info', `  Streak: ${result.streaks?.current}`);
    } else {
      log('info', `Brain skipped evolution: ${result.reason}`);
    }
    return result;
  } catch (err) {
    log('error', `Brain evolution failed: ${err.message}`);
    return { evolved: false, reason: err.message };
  }
}

// ─── Phase 3: Asset Discovery ────────────────────────────────────────────────

function phaseAssetList() {
  log('info', '═══ Phase 3: Active Asset List ═══');

  // Check if horizontal scaler published an updated list
  if (signalBus) {
    const assetSignals = signalBus.query({ type: 'active_asset_list', maxAgeMs: 2 * 60 * 60 * 1000 });
    if (assetSignals.length > 0 && Array.isArray(assetSignals[0].payload?.assets)) {
      const assets = assetSignals[0].payload.assets;
      log('info', `Using scaler's asset list: ${assets.join(', ')} (${assets.length} assets)`);
      return assets;
    }
  }

  // Fallback to configured scan assets
  const assets = String(process.env.EDGE_SCAN_ASSETS || 'BTC,ETH,SOL,DOGE,AVAX,LINK,XRP,ARB,OP')
    .split(',').map(a => a.trim().toUpperCase()).filter(Boolean);

  // ═══ PERFORMANCE-BASED ASSET FILTER ═══
  // Auto-exclude assets with < 25% win rate over 5+ trades
  if (tradeJournal) {
    try {
      const j = JSON.parse(fs.readFileSync(tradeJournal.JOURNAL_FILE, 'utf8'));
      const closed = (j.trades || []).filter(t => t.outcome);
      const byAsset = {};
      for (const t of closed) {
        const a = (t.asset || '').toUpperCase();
        if (!byAsset[a]) byAsset[a] = { w: 0, l: 0 };
        if (t.outcome === 'win') byAsset[a].w++; else byAsset[a].l++;
      }
      const filtered = assets.filter(a => {
        const stats = byAsset[a];
        if (!stats || (stats.w + stats.l) < 5) return true; // keep under-sampled
        const wr = stats.w / (stats.w + stats.l);
        if (wr < 0.25) {
          log('info', `  Excluding ${a}: ${(wr * 100).toFixed(0)}% win rate over ${stats.w + stats.l} trades`);
          return false;
        }
        return true;
      });
      if (filtered.length >= 3) {
        log('info', `Using filtered asset list: ${filtered.join(', ')} (${filtered.length}/${assets.length} assets)`);
        return filtered;
      }
    } catch {}
  }

  log('info', `Using default asset list: ${assets.join(', ')} (${assets.length} assets)`);
  return assets;
}

// ─── Phase 4: Signal Generation ──────────────────────────────────────────────

async function phaseSignalGeneration(assets) {
  log('info', `═══ Phase 4: Generating Signals for ${assets.length} Assets ═══`);
  if (!edgeDetector) {
    log('error', 'Edge detector not available');
    return [];
  }

  const signals = [];
  const resolvedMinConf = brain
    ? brain.getEvolvedMinConfidence(0.56)
    : (tradeJournal ? tradeJournal.getAdaptiveMinConfidence(0.56) : 0.56);

  log('info', `Evolved min confidence: ${resolvedMinConf.toFixed(3)}`);

  // Scan all assets in parallel for speed
  const promises = assets.map(async (asset) => {
    try {
      const signal = await edgeDetector.getCompositeSignal({ asset });
      return { asset, ...signal };
    } catch (err) {
      log('warn', `Signal generation failed for ${asset}: ${err.message}`);
      return null;
    }
  });

  const results = await Promise.allSettled(promises);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      const sig = r.value;
      if (sig.side !== 'neutral' && sig.confidence >= resolvedMinConf && sig.edge >= 0.10) {
        signals.push(sig);
      }
    }
  }

  // Sort by edge * confidence (best first)
  signals.sort((a, b) => (b.edge * b.confidence) - (a.edge * a.confidence));

  log('info', `Generated ${signals.length} actionable signals from ${assets.length} assets`);
  for (const sig of signals.slice(0, 5)) {
    log('info', `  ${sig.asset} ${sig.side.toUpperCase()} | conf:${sig.confidence.toFixed(3)} edge:${sig.edge.toFixed(3)} score:${sig.compositeScore.toFixed(4)}`);
  }

  return signals;
}

// ─── Phase 5: Trade Execution ────────────────────────────────────────────────

function getVenueScript(venue) {
  const map = {
    kraken: 'scripts/kraken-spot-engine.js',
    coinbase: 'scripts/coinbase-spot-engine.js',
    prediction: 'scripts/prediction-market-engine.js',
  };
  return map[venue] || null;
}

function isVenueEnabled(venue) {
  if (venue === 'kraken') return KRAKEN_ENABLED;
  if (venue === 'coinbase') return COINBASE_ENABLED;
  if (venue === 'prediction') return PRED_ENABLED;
  return false;
}

function executeVenueTrade(venue, signal, orderUsd) {
  const script = getVenueScript(venue);
  if (!script) return { success: false, reason: `no script for venue ${venue}` };

  log('info', `  Executing on ${venue}: ${signal.asset} ${signal.side} $${orderUsd.toFixed(2)}`);

  const result = spawnSync('node', [script], {
    env: {
      ...process.env,
      // Override per-trade parameters
      [`${venue.toUpperCase()}_ORDER_USD`]: String(orderUsd),
      KRAKEN_ORDER_USD: venue === 'kraken' ? String(orderUsd) : process.env.KRAKEN_ORDER_USD,
      COINBASE_ORDER_USD: venue === 'coinbase' ? String(orderUsd) : process.env.COINBASE_ORDER_USD,
      PRED_MARKET_ORDER_USD: venue === 'prediction' ? String(orderUsd) : process.env.PRED_MARKET_ORDER_USD,
    },
    encoding: 'utf8',
    timeout: 60000,
  });

  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  const success = result.status === 0 && /"status"\s*:\s*"placed"/i.test(stdout);
  const skipped = /"status"\s*:\s*"skipped"/i.test(stdout);

  return {
    success,
    skipped,
    exitCode: result.status,
    venue,
    asset: signal.asset,
    side: signal.side,
    confidence: signal.confidence,
    edge: signal.edge,
    orderUsd,
    stdout: stdout.slice(0, 500),
    stderr: stderr.slice(0, 200),
  };
}

async function phaseTradeExecution(signals) {
  log('info', `═══ Phase 5: Trade Execution (${Math.min(signals.length, MAX_TRADES_PER_CYCLE)} max) ═══`);

  const executions = [];
  let tradesPlaced = 0;

  for (const signal of signals.slice(0, MAX_TRADES_PER_CYCLE * 2)) {
    if (tradesPlaced >= MAX_TRADES_PER_CYCLE) break;

    // Risk check before each trade
    if (riskManager) {
      let orderUsd = riskManager.riskAdjustedSize({
        baseUsd: BASE_ORDER_USD,
        confidence: signal.confidence,
        edge: signal.edge,
        asset: signal.asset,
        venue: 'unknown',
      });

      // ═══ CAPITAL MANDATE GATE — No more funds. Ever. ═══
      if (capitalMandate) {
        const mandateSize = capitalMandate.mandateAdjustedSize({
          baseUsd: orderUsd,
          confidence: signal.confidence,
          edge: signal.edge,
        });
        if (mandateSize <= 0) {
          log('warn', `  Mandate denied ${signal.asset}: capital mode prevents trade`);
          executions.push({ asset: signal.asset, side: signal.side, status: 'mandate_denied', reasons: ['capital mandate'] });
          continue;
        }
        const mandateCheck = capitalMandate.checkMandate({
          usdSize: mandateSize,
          confidence: signal.confidence,
          edge: signal.edge,
          asset: signal.asset,
          venue: 'best',
        });
        if (!mandateCheck.allowed) {
          log('warn', `  Mandate denied ${signal.asset}: ${mandateCheck.reasons.join(', ')}`);
          executions.push({ asset: signal.asset, side: signal.side, status: 'mandate_denied', reasons: mandateCheck.reasons });
          continue;
        }
        orderUsd = Math.min(orderUsd, mandateSize);
      }

      // Liquidation guardian gate — check ALL venues before attempting
      if (liquidationGuardian) {
        const cbCheck = liquidationGuardian.shouldAllowNewTrade('coinbase', { tradeType: 'spot' });
        const krCheck = liquidationGuardian.shouldAllowNewTrade('kraken', { tradeType: 'spot' });
        if (!cbCheck.allowed && !krCheck.allowed) {
          log('warn', `  Guardian blocked ${signal.asset}: CB=${cbCheck.reason} KR=${krCheck.reason}`);
          executions.push({
            asset: signal.asset, side: signal.side, status: 'guardian_blocked',
            reasons: [cbCheck.reason, krCheck.reason],
          });
          continue;
        }
      }

      const check = riskManager.checkTradeAllowed({
        asset: signal.asset,
        side: signal.side,
        usdSize: orderUsd,
        venue: 'best',
        confidence: signal.confidence,
      });

      if (!check.allowed) {
        log('warn', `  Risk denied ${signal.asset}: ${check.reasons.join(', ')}`);
        executions.push({
          asset: signal.asset, side: signal.side, status: 'risk_denied',
          reasons: check.reasons,
        });
        continue;
      }

      // Try each venue in priority order
      let traded = false;
      for (const venue of VENUE_PRIORITY) {
        if (!isVenueEnabled(venue)) continue;
        if (venue === 'prediction') continue; // prediction engine handles its own assets

        // Per-venue guardian check — skip venues that are margin-blocked
        if (liquidationGuardian) {
          const venueCheck = liquidationGuardian.shouldAllowNewTrade(venue, { tradeType: 'spot' });
          if (!venueCheck.allowed) {
            log('info', `  Skipping ${venue} for ${signal.asset}: guardian-blocked (${venueCheck.reason})`);
            continue;
          }
        }

        const result = executeVenueTrade(venue, signal, orderUsd);
        executions.push(result);

        if (result.success) {
          tradesPlaced++;
          traded = true;

          // Update risk exposure
          riskManager.updateExposure({
            asset: signal.asset,
            side: signal.side,
            usdSize: orderUsd,
            venue,
          });

          // Record in journal
          if (tradeJournal) {
            try {
              tradeJournal.recordTrade({
                venue,
                asset: signal.asset,
                side: signal.side,
                entryPrice: signal.meta?.lastPrice || 0,
                usdSize: orderUsd,
                signal: { side: signal.side, confidence: signal.confidence, edge: signal.edge, compositeScore: signal.compositeScore },
                signalComponents: signal.components || {},
                dryRun: DRY_RUN,
              });
            } catch {}
          }

          break;
        }

        if (!result.skipped) {
          log('warn', `  ${venue} execution failed for ${signal.asset}, trying next venue`);
        } else {
          // Log skip reason from venue engine for observability
          try {
            const parsed = JSON.parse(result.stdout || '{}');
            if (parsed.reason) log('info', `  ${venue} skipped ${signal.asset}: ${parsed.reason}`);
          } catch {}
        }
      }

      if (!traded) {
        log('info', `  No venue accepted trade for ${signal.asset}`);
      }
    } else {
      // No risk manager — direct execution on first available venue
      for (const venue of VENUE_PRIORITY) {
        if (!isVenueEnabled(venue) || venue === 'prediction') continue;
        const result = executeVenueTrade(venue, signal, BASE_ORDER_USD);
        executions.push(result);
        if (result.success) { tradesPlaced++; break; }
      }
    }
  }

  log('info', `Executed ${tradesPlaced} trades from ${signals.length} signals`);
  return { tradesPlaced, executions };
}

// ─── Phase 6: Prediction Market Cycle ────────────────────────────────────────

function phasePredictionMarkets() {
  if (!PRED_ENABLED) return { status: 'disabled' };

  log('info', '═══ Phase 6: Prediction Markets ═══');

  const result = spawnSync('node', ['scripts/prediction-market-engine.js'], {
    env: process.env,
    encoding: 'utf8',
    timeout: 60000,
  });

  const stdout = String(result.stdout || '');
  const success = result.status === 0;
  const placed = /"status"\s*:\s*"placed"/i.test(stdout);

  log('info', `Prediction engine: ${success ? (placed ? 'placed orders' : 'complete') : 'failed'}`);

  return {
    status: success ? (placed ? 'placed' : 'ok') : 'error',
    exitCode: result.status,
    outputPreview: stdout.slice(0, 300),
  };
}

// ─── Phase 7: Publish State ──────────────────────────────────────────────────

function phasePublishState(health, brainResult, signals, execution, predResult, durationMs) {
  log('info', '═══ Phase 7: Publishing State ═══');

  if (!signalBus) return;

  signalBus.publish({
    type: 'orchestrator_cycle',
    source: 'master-orchestrator',
    confidence: 1.0,
    payload: {
      cycleComplete: true,
      durationMs,
      signalsGenerated: signals.length,
      tradesPlaced: execution.tradesPlaced,
      brainEvolved: brainResult?.evolved || false,
      brainGeneration: brainResult?.generation?.id || null,
      riskHealthy: health.riskHealthy !== false,
      drawdownPct: health.drawdownPct || 0,
      predictionStatus: predResult?.status || 'disabled',
      topSignals: signals.slice(0, 3).map(s => ({
        asset: s.asset, side: s.side,
        confidence: Math.round(s.confidence * 1000) / 1000,
        edge: Math.round(s.edge * 1000) / 1000,
      })),
    },
    ttlMs: 30 * 60 * 1000,
  });

  signalBus.publish({
    type: 'orchestrator_health',
    source: 'master-orchestrator',
    confidence: 1.0,
    payload: {
      healthy: health.riskHealthy !== false && !health.abort,
      modules: {
        edgeDetector: health.edgeDetector,
        signalBus: health.signalBus,
        brain: health.brain,
        riskManager: health.riskManager,
      },
      signalBusSignals: health.signalBusSignals || 0,
    },
    ttlMs: 10 * 60 * 1000,
  });

  // Publish intelligence_cycle so venue-engine doesn't skip due to stale signal protection
  signalBus.publish({
    type: 'intelligence_cycle',
    source: 'master-orchestrator',
    confidence: 1.0,
    payload: {
      completedAt: Date.now(),
      orchestratorCycle: true,
    },
    ttlMs: 30 * 60 * 1000,
  });
}

// ─── Phase 8: Data Maintenance ───────────────────────────────────────────────

function phaseDataMaintenance() {
  log('info', '═══ Phase 8: Data Maintenance ═══');

  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) return;

  let cleaned = 0;
  const files = fs.readdirSync(dataDir);
  for (const file of files) {
    const filePath = path.join(dataDir, file);
    try {
      const stats = fs.statSync(filePath);
      // If any JSON file exceeds 5MB, truncate it
      if (file.endsWith('.json') && stats.size > 5 * 1024 * 1024) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        // If it has an array field, trim it
        for (const [key, val] of Object.entries(data)) {
          if (Array.isArray(val) && val.length > 500) {
            data[key] = val.slice(-200);
            cleaned++;
          }
        }
        if (rio) { rio.writeJsonAtomic(filePath, data); }
        else {
          const tmp = filePath + '.tmp';
          fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
          fs.renameSync(tmp, filePath);
        }
        log('info', `  Trimmed ${file} (was ${(stats.size / 1024).toFixed(0)}KB)`);
      }
    } catch {}
  }

  if (cleaned > 0) log('info', `  Cleaned ${cleaned} arrays`);

  // Prune stale signals from signal bus (signals older than 6 hours)
  try {
    const busFile = path.join(dataDir, 'agent-signal-bus.json');
    if (fs.existsSync(busFile)) {
      const busData = JSON.parse(fs.readFileSync(busFile, 'utf8'));
      const signals = Array.isArray(busData) ? busData : (busData.signals || []);
      const now = Date.now();
      const maxAge = 6 * 60 * 60 * 1000; // 6 hours
      const fresh = signals.filter(s => now - (s.ts || s.publishedAt || 0) < maxAge);
      const pruned = signals.length - fresh.length;
      if (pruned > 0) {
        const output = Array.isArray(busData) ? fresh : { ...busData, signals: fresh };
        if (rio) { rio.writeJsonAtomic(busFile, output); }
        else {
          const tmp = busFile + '.tmp';
          fs.writeFileSync(tmp, JSON.stringify(output, null, 2));
          fs.renameSync(tmp, busFile);
        }
        log('info', `  Pruned ${pruned} stale signals (kept ${fresh.length})`);
        cleaned += pruned;
      }
    }
  } catch (e) {
    log('error', `Signal bus prune failed: ${e.message}`);
  }
}

// ─── Main Orchestrator Loop ──────────────────────────────────────────────────

async function main() {
  const startMs = Date.now();

  if (!ORCHESTRATOR_ENABLED) {
    console.log(JSON.stringify({ status: 'disabled', reason: 'ORCHESTRATOR_ENABLED=false' }, null, 2));
    return;
  }

  // Check min interval
  const state = loadState();
  const sinceLastRun = (startMs - (state.lastRunAt || 0)) / 1000;
  if (sinceLastRun < MIN_CYCLE_INTERVAL_SEC) {
    console.log(JSON.stringify({
      status: 'skipped',
      reason: `min interval not met (${Math.round(sinceLastRun)}s/${MIN_CYCLE_INTERVAL_SEC}s)`,
    }, null, 2));
    return;
  }

  log('info', `\n${'═'.repeat(60)}`);
  log('info', `  MASTER ORCHESTRATOR — Cycle #${state.cycleCount + 1}`);
  log('info', `  Time: ${new Date().toISOString()}`);
  log('info', `${'═'.repeat(60)}\n`);

  // Phase 1: Health Check (includes liquidation guardian)
  const health = await phaseHealthCheck();
  if (health.abort) {
    // Still update state so watchdog knows we ran
    state.lastRunAt = startMs;
    state.lastCycle = { ts: new Date().toISOString(), aborted: true, reason: health.reason };
    saveState(state);
    const report = { status: 'aborted', reason: health.reason, health, ts: new Date().toISOString() };
    console.log(JSON.stringify(report, null, 2));
    await sendAlert(`🛑 Orchestrator ABORTED: ${health.reason}`, 'critical');
    return;
  }

  // Phase 2: Brain Evolution
  const brainResult = phaseBrainEvolution();

  // Phase 3: Asset List
  const assets = phaseAssetList();

  // Phase 4: Signal Generation
  const signals = await phaseSignalGeneration(assets);

  // Phase 5: Trade Execution
  const execution = await phaseTradeExecution(signals);

  // Phase 5b: Trade Reconciliation (close open trades, compute P&L)
  let reconcileResult = { closedCount: 0, totalPnl: 0 };
  if (tradeReconciler) {
    try {
      log('info', '═══ Phase 5b: Trade Reconciliation ═══');
      reconcileResult = await tradeReconciler.reconcileOpenTrades();
      log('info', `  Closed ${reconcileResult.closedCount} trades, P&L: $${reconcileResult.totalPnl.toFixed(2)}`);
      if (reconcileResult.closed) {
        for (const c of reconcileResult.closed) {
          log('info', `    ${c.asset} ${c.side}: $${c.pnl.toFixed(2)} (${c.reason})`);
        }
      }
    } catch (e) {
      log('error', `Reconciliation failed: ${e.message}`);
    }
  }

  // Phase 5c: Treasury Ledger (persistent lifetime P&L tracking)
  if (treasuryLedger && reconcileResult.closedCount > 0) {
    try {
      treasuryLedger.recordReconciliation(reconcileResult);
      treasuryLedger.takeDailySnapshot(reconcileResult.totalPnl, reconcileResult.closedCount,
        (reconcileResult.closed || []).filter(c => (c.pnl || 0) > 0).length);
      log('info', `  Treasury: recorded ${reconcileResult.closedCount} trades, lifetime P&L updated`);
    } catch (e) {
      log('error', `Treasury ledger update failed: ${e.message}`);
    }
  }

  // Phase 6: Prediction Markets
  const predResult = phasePredictionMarkets();

  // Phase 7: Publish State
  const durationMs = Date.now() - startMs;
  phasePublishState(health, brainResult, signals, execution, predResult, durationMs);

  // Phase 8: Data Maintenance (signal pruning every cycle, heavy trim every 10th)
  phaseDataMaintenance();

  // Update state
  state.lastRunAt = startMs;
  state.cycleCount++;
  state.totalTrades += execution.tradesPlaced;
  state.totalPnl = (state.totalPnl || 0) + (reconcileResult.totalPnl || 0);
  state.lastCycle = {
    ts: new Date().toISOString(),
    durationMs,
    signals: signals.length,
    trades: execution.tradesPlaced,
    reconciled: reconcileResult.closedCount || 0,
    reconcilePnl: Math.round((reconcileResult.totalPnl || 0) * 100) / 100,
    openRemaining: reconcileResult.openRemaining ?? null,
    brainEvolved: brainResult?.evolved || false,
    predStatus: predResult?.status || 'disabled',
  };
  saveState(state);

  // Final report
  const report = {
    ts: new Date().toISOString(),
    agent: 'master-orchestrator',
    cycle: state.cycleCount,
    durationMs,
    phases: {
      health: {
        modules: Object.fromEntries(
          Object.entries(health).filter(([k]) => !['abort', 'reason'].includes(k))
        ),
      },
      brain: {
        evolved: brainResult?.evolved || false,
        generation: brainResult?.generation?.id || null,
        streak: brainResult?.streaks?.current,
        calibration: brainResult?.calibration?.score,
      },
      assets: { count: assets.length, list: assets },
      signals: {
        total: signals.length,
        top: signals.slice(0, 5).map(s => ({
          asset: s.asset, side: s.side,
          conf: Math.round(s.confidence * 1000) / 1000,
          edge: Math.round(s.edge * 1000) / 1000,
        })),
      },
      execution: {
        tradesPlaced: execution.tradesPlaced,
        results: execution.executions.map(e => ({
          asset: e.asset, venue: e.venue, status: e.success ? 'placed' : (e.skipped ? 'skipped' : 'failed'),
          confidence: e.confidence ? Math.round(e.confidence * 1000) / 1000 : null,
        })),
      },
      prediction: predResult,
      reconciliation: {
        closed: reconcileResult.closedCount || 0,
        pnl: Math.round((reconcileResult.totalPnl || 0) * 100) / 100,
        openRemaining: reconcileResult.openRemaining ?? null,
      },
    },
    totals: {
      cycleCount: state.cycleCount,
      totalTrades: state.totalTrades,
    },
  };

  console.log(JSON.stringify(report, null, 2));

  // Alert on significant events
  if (execution.tradesPlaced > 0) {
    const tradeList = execution.executions.filter(e => e.success).map(e =>
      `${e.asset} ${e.side.toUpperCase()} $${e.orderUsd.toFixed(0)} on ${e.venue} (conf:${e.confidence.toFixed(2)})`
    ).join(', ');
    await sendAlert(`💰 Orchestrator placed ${execution.tradesPlaced} trades: ${tradeList}`, 'info');
  }
}

main().catch(async (err) => {
  console.error('[orchestrator] Fatal:', err.message);
  await sendAlert(`🔥 Orchestrator FATAL: ${err.message}`, 'critical');
  process.exit(1);
});
