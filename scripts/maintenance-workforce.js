#!/usr/bin/env node

/**
 * Maintenance Workforce Orchestrator
 * ====================================
 *
 * The MASTER maintenance-mode loop. When kill switch is active with
 * maintenanceMode=true, this replaces the trade loop and runs an
 * overwhelming army of background agents:
 *
 *   Phase 1: Market Research     — Deep multi-asset trend/vol/correlation analysis
 *   Phase 2: Backtest Scheduler  — Automated parameter sweep & walk-forward validation
 *   Phase 3: Strategy Discovery  — Novel strategy architecture testing
 *   Phase 4: ML Retraining       — Force retrain with accumulated data
 *   Phase 5: Brain Evolution     — Run evolution cycle with latest trade data
 *   Phase 6: Paper Trading       — Virtual trade execution for strategy validation
 *   Phase 7: Portfolio Optimizer — Cross-strategy allocation optimization
 *   Phase 8: Knowledge Ingestion — Deep data ingestion (Wikipedia, ArXiv, etc.)
 *   Phase 9: Forecast Resolution — Resolve past forecasts, compute accuracy
 *   Phase 10: Signal Publishing  — Aggregate findings to signal bus
 *
 * Usage:
 *   node scripts/maintenance-workforce.js
 *   # Or via systemd timer / cron (recommended: every 30-60 minutes)
 *
 * Environment:
 *   MAINTENANCE_CYCLE_INTERVAL_MS  — Min interval between cycles (default: 30 min)
 *   MAINTENANCE_MAX_DURATION_MS    — Max time per cycle (default: 25 min)
 *   MAINTENANCE_ENABLE_BACKTEST    — Enable backtest phase (default: true)
 *   MAINTENANCE_ENABLE_DISCOVERY   — Enable strategy discovery (default: true)
 *   MAINTENANCE_ENABLE_RESEARCH    — Enable market research (default: true)
 *   MAINTENANCE_ENABLE_PAPER       — Enable paper trading (default: true)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Configuration ──────────────────────────────────────────────────────────

const CYCLE_INTERVAL_MS = Math.max(300000, Number(process.env.MAINTENANCE_CYCLE_INTERVAL_MS || 30 * 60000));
const MAX_DURATION_MS = Math.max(60000, Number(process.env.MAINTENANCE_MAX_DURATION_MS || 25 * 60000));
const ENABLE_BACKTEST = String(process.env.MAINTENANCE_ENABLE_BACKTEST || 'true').toLowerCase() !== 'false';
const ENABLE_DISCOVERY = String(process.env.MAINTENANCE_ENABLE_DISCOVERY || 'true').toLowerCase() !== 'false';
const ENABLE_RESEARCH = String(process.env.MAINTENANCE_ENABLE_RESEARCH || 'true').toLowerCase() !== 'false';
const ENABLE_PAPER = String(process.env.MAINTENANCE_ENABLE_PAPER || 'true').toLowerCase() !== 'false';
const ENABLE_INGEST = String(process.env.MAINTENANCE_ENABLE_INGEST || 'true').toLowerCase() !== 'false';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const KILL_SWITCH_FILE = path.join(DATA_DIR, 'kill-switch.json');
const STATE_FILE = path.join(DATA_DIR, 'maintenance-workforce-state.json');

// ─── Logger ─────────────────────────────────────────────────────────────────

let log;
try {
  const { createLogger } = require('../lib/logger');
  log = createLogger('maintenance-workforce');
} catch {
  log = {
    info: (...args) => console.log('[maintenance-workforce]', ...args),
    warn: (...args) => console.warn('[maintenance-workforce]', ...args),
    error: (...args) => console.error('[maintenance-workforce]', ...args),
    debug: () => {},
  };
}

// ─── Lazy Module Loading ────────────────────────────────────────────────────

function safeRequire(modulePath, name) {
  try { return require(modulePath); } catch (e) {
    log.warn(`Module ${name} unavailable: ${e.message}`);
    return null;
  }
}

const researchAgent = safeRequire('../lib/research-agent', 'research-agent');
const backtestScheduler = safeRequire('../lib/backtest-scheduler', 'backtest-scheduler');
const strategyDiscovery = safeRequire('../lib/strategy-discovery', 'strategy-discovery');
const paperTradeEngine = safeRequire('../lib/paper-trade-engine', 'paper-trade-engine');
const portfolioOptimizer = safeRequire('../lib/portfolio-optimizer', 'portfolio-optimizer');
const mlPipeline = safeRequire('../lib/ml-pipeline', 'ml-pipeline');
const brain = safeRequire('../lib/self-evolving-brain', 'self-evolving-brain');
const heartbeat = safeRequire('../lib/heartbeat-registry', 'heartbeat-registry');
const signalBus = safeRequire('../lib/agent-signal-bus', 'agent-signal-bus');

let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

// ─── State Management ───────────────────────────────────────────────────────

function readJson(filePath, fallback) {
  if (rio) return rio.readJsonSafe(filePath, { fallback });
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { /* ignore */ }
  return fallback;
}

function writeJson(filePath, data) {
  if (rio) { rio.writeJsonAtomic(filePath, data); return; }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  } catch { /* ignore */ }
}

function loadState() {
  return readJson(STATE_FILE, {
    cycleCount: 0,
    lastCycleAt: 0,
    phaseResults: {},
    errors: [],
    totalResearchCycles: 0,
    totalBacktests: 0,
    totalDiscoveries: 0,
    totalPaperTrades: 0,
    startedAt: Date.now(),
  });
}

function saveState(state) { writeJson(STATE_FILE, state); }

// ─── Kill Switch Check ──────────────────────────────────────────────────────

function isMaintenanceMode() {
  try {
    const ks = readJson(KILL_SWITCH_FILE, { active: false });
    return ks.active === true && ks.maintenanceMode === true;
  } catch {
    return false;
  }
}

// ─── Phase Runners ──────────────────────────────────────────────────────────

async function runPhase(name, fn, timeout = 300000) {
  const start = Date.now();
  try {
    log.info(`Phase starting: ${name}`);
    if (heartbeat) heartbeat.publishHeartbeat('maintenance-workforce', { phase: name });

    const result = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Phase ${name} timed out after ${timeout}ms`)), timeout)),
    ]);

    const elapsed = Date.now() - start;
    log.info(`Phase complete: ${name}`, { elapsedMs: elapsed });
    return { success: true, result, elapsedMs: elapsed };
  } catch (e) {
    const elapsed = Date.now() - start;
    log.error(`Phase failed: ${name}`, { error: e.message, elapsedMs: elapsed });
    return { success: false, error: e.message, elapsedMs: elapsed };
  }
}

// ─── Phase Implementations ──────────────────────────────────────────────────

async function phaseResearch() {
  if (!ENABLE_RESEARCH || !researchAgent) return { skipped: true, reason: 'disabled_or_unavailable' };
  return await researchAgent.runResearchCycle();
}

async function phaseBacktest() {
  if (!ENABLE_BACKTEST || !backtestScheduler) return { skipped: true, reason: 'disabled_or_unavailable' };
  return await backtestScheduler.runScheduledBacktests();
}

async function phaseDiscovery() {
  if (!ENABLE_DISCOVERY || !strategyDiscovery) return { skipped: true, reason: 'disabled_or_unavailable' };
  return await strategyDiscovery.runDiscoveryCycle();
}

async function phaseMLRetrain() {
  if (!mlPipeline) return { skipped: true, reason: 'ml_pipeline_unavailable' };
  try {
    const status = mlPipeline.getMLStatus?.();
    if (status?.sampleCount >= 50) {
      mlPipeline.forceRetrain?.();
      return { retrained: true, samples: status.sampleCount };
    }
    return { retrained: false, reason: 'insufficient_samples', samples: status?.sampleCount || 0 };
  } catch (e) {
    return { retrained: false, error: e.message };
  }
}

async function phaseBrainEvolution() {
  if (!brain) return { skipped: true, reason: 'brain_unavailable' };
  try {
    brain.runEvolutionCycle?.();
    const insights = brain.getInsights?.() || {};
    return { evolved: true, generation: insights.generation || 0 };
  } catch (e) {
    return { evolved: false, error: e.message };
  }
}

async function phasePaperTrading() {
  if (!ENABLE_PAPER || !paperTradeEngine) return { skipped: true, reason: 'disabled_or_unavailable' };
  try {
    // Get edge signals from signal bus and paper-trade them
    if (signalBus) {
      const edgeSignals = signalBus.query({ type: 'edge_opportunity', maxAgeMs: 300000 });
      const assetIntel = signalBus.query({ type: 'asset_intelligence', maxAgeMs: 3600000 });

      // Build price map from intel
      const prices = {};
      for (const sig of assetIntel) {
        if (sig.payload?.asset && sig.payload?.lastPrice) {
          prices[sig.payload.asset] = sig.payload.lastPrice;
        }
      }

      let paperTrades = 0;
      for (const edge of edgeSignals) {
        if (edge.payload?.asset && edge.payload?.side && edge.confidence > 0.5) {
          const result = paperTradeEngine.evaluateSignal({
            asset: edge.payload.asset,
            side: edge.payload.side,
            confidence: edge.confidence,
            edge: edge.payload?.edge || 0,
            price: prices[edge.payload.asset] || edge.payload?.price,
          }, prices);
          if (result?.success) paperTrades++;
        }
      }

      // Mark to market
      const markResult = paperTradeEngine.markToMarket(prices);

      return {
        paperTrades,
        markResult,
        metrics: paperTradeEngine.getMetrics(),
      };
    }
    return { skipped: true, reason: 'no_signal_bus' };
  } catch (e) {
    return { error: e.message };
  }
}

async function phasePortfolioOptimize() {
  if (!portfolioOptimizer) return { skipped: true, reason: 'optimizer_unavailable' };
  try {
    return portfolioOptimizer.runOptimizationCycle();
  } catch (e) {
    return { error: e.message };
  }
}

async function phaseKnowledgeIngest() {
  if (!ENABLE_INGEST) return { skipped: true, reason: 'disabled' };
  try {
    // Try direct import first (for local execution)
    try {
      const { runMaintenanceIngestion } = await import('../lib/ingestion/dataLoader.js');
      if (typeof runMaintenanceIngestion === 'function') {
        const result = await runMaintenanceIngestion();
        return { ingested: true, mode: 'direct', ...result };
      }
    } catch {
      // Direct import not available — fall back to API
    }

    // Fallback: Call ingestion API
    const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.up.railway.app').replace(/\/$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.ALERT_SECRET) headers['x-api-secret'] = process.env.ALERT_SECRET;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(`${APP_BASE_URL}/api/ingest`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sources: ['all'] }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      return { ingested: true, mode: 'api', ...data };
    } catch (e) {
      return { ingested: false, error: e.message };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { error: e.message };
  }
}

async function phaseForecastResolution() {
  try {
    const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.up.railway.app').replace(/\/$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.ALERT_SECRET) headers['x-api-secret'] = process.env.ALERT_SECRET;
    if (process.env.AUTONOMY_ADMIN_KEY) headers['x-autonomy-key'] = process.env.AUTONOMY_ADMIN_KEY;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${APP_BASE_URL}/api/autonomy/status`, {
        headers,
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      return { resolved: true, forecasts: data?.forecasts?.length || 0 };
    } catch (e) {
      return { resolved: false, error: e.message };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { error: e.message };
  }
}

async function phasePublishSummary(phaseResults) {
  if (!signalBus) return { published: false, reason: 'no_signal_bus' };

  try {
    const summary = {
      cycleComplete: true,
      phases: {},
    };

    for (const [name, result] of Object.entries(phaseResults)) {
      summary.phases[name] = result?.success ? 'ok' : 'failed';
    }

    signalBus.publish({
      type: 'maintenance_summary',
      source: 'maintenance-workforce',
      confidence: 1.0,
      payload: summary,
      ttlMs: 2 * 3600000,
    });

    return { published: true };
  } catch (e) {
    return { published: false, error: e.message };
  }
}

// ─── Main Cycle ─────────────────────────────────────────────────────────────

/**
 * Run a single maintenance workforce cycle.
 */
async function runMaintenanceCycle() {
  if (!isMaintenanceMode()) {
    log.info('Kill switch not in maintenance mode — exiting');
    return { aborted: true, reason: 'not_in_maintenance_mode' };
  }

  const cycleStart = Date.now();
  const state = loadState();

  // Rate limit
  if (cycleStart - state.lastCycleAt < CYCLE_INTERVAL_MS) {
    log.info('Cycle interval not elapsed — skipping', {
      nextIn: Math.round((CYCLE_INTERVAL_MS - (cycleStart - state.lastCycleAt)) / 1000) + 's',
    });
    return { aborted: true, reason: 'rate_limited' };
  }

  log.info('═══════════════════════════════════════════════════════════════');
  log.info(`  MAINTENANCE WORKFORCE CYCLE #${state.cycleCount + 1}`);
  log.info('═══════════════════════════════════════════════════════════════');

  if (heartbeat) heartbeat.publishHeartbeat('maintenance-workforce', { phase: 'cycle_start', cycle: state.cycleCount + 1 });

  const phaseResults = {};
  const deadline = cycleStart + MAX_DURATION_MS;

  // Phase 1: Market Research (5 min timeout)
  if (Date.now() < deadline) {
    phaseResults.research = await runPhase('research', phaseResearch, 300000);
    if (phaseResults.research.success) state.totalResearchCycles++;
  }

  // Phase 2: Brain Evolution (1 min timeout)
  if (Date.now() < deadline) {
    phaseResults.brainEvolution = await runPhase('brain_evolution', phaseBrainEvolution, 60000);
  }

  // Phase 3: ML Retraining (2 min timeout)
  if (Date.now() < deadline) {
    phaseResults.mlRetrain = await runPhase('ml_retrain', phaseMLRetrain, 120000);
  }

  // Phase 4: Backtest Scheduler (10 min timeout)
  if (Date.now() < deadline) {
    phaseResults.backtest = await runPhase('backtest', phaseBacktest, 600000);
    if (phaseResults.backtest.success) state.totalBacktests += phaseResults.backtest.result?.tested || 0;
  }

  // Phase 5: Strategy Discovery (10 min timeout)
  if (Date.now() < deadline) {
    phaseResults.discovery = await runPhase('discovery', phaseDiscovery, 600000);
    if (phaseResults.discovery.success) state.totalDiscoveries += phaseResults.discovery.result?.tested || 0;
  }

  // Phase 6: Paper Trading (2 min timeout)
  if (Date.now() < deadline) {
    phaseResults.paperTrading = await runPhase('paper_trading', phasePaperTrading, 120000);
    if (phaseResults.paperTrading.success) state.totalPaperTrades += phaseResults.paperTrading.result?.paperTrades || 0;
  }

  // Phase 7: Portfolio Optimization (1 min timeout)
  if (Date.now() < deadline) {
    phaseResults.portfolio = await runPhase('portfolio_optimize', phasePortfolioOptimize, 60000);
  }

  // Phase 8: Knowledge Ingestion (2 min timeout)
  if (Date.now() < deadline) {
    phaseResults.ingest = await runPhase('knowledge_ingest', phaseKnowledgeIngest, 300000);
  }

  // Phase 9: Forecast Resolution (30s timeout)
  if (Date.now() < deadline) {
    phaseResults.forecast = await runPhase('forecast_resolution', phaseForecastResolution, 30000);
  }

  // Phase 10: Publish Summary
  phaseResults.summary = await runPhase('publish_summary', () => phasePublishSummary(phaseResults), 10000);

  // Update state
  state.cycleCount++;
  state.lastCycleAt = Date.now();
  state.phaseResults = {};
  for (const [name, result] of Object.entries(phaseResults)) {
    state.phaseResults[name] = {
      success: result.success,
      elapsedMs: result.elapsedMs,
      error: result.error || null,
    };
  }

  // Track errors
  const errors = Object.entries(phaseResults)
    .filter(([, r]) => !r.success && r.error)
    .map(([name, r]) => ({ phase: name, error: r.error, at: Date.now() }));
  state.errors = [...(state.errors || []).slice(-50), ...errors];

  saveState(state);

  const totalElapsed = Date.now() - cycleStart;
  const successCount = Object.values(phaseResults).filter(r => r.success).length;
  const failCount = Object.values(phaseResults).filter(r => !r.success).length;

  log.info('═══════════════════════════════════════════════════════════════');
  log.info(`  CYCLE #${state.cycleCount} COMPLETE — ${successCount} OK, ${failCount} failed`);
  log.info(`  Total elapsed: ${(totalElapsed / 1000).toFixed(1)}s`);
  log.info(`  Lifetime: ${state.totalResearchCycles} research, ${state.totalBacktests} backtests, ${state.totalDiscoveries} discoveries, ${state.totalPaperTrades} paper trades`);
  log.info('═══════════════════════════════════════════════════════════════');

  if (heartbeat) heartbeat.publishHeartbeat('maintenance-workforce', {
    phase: 'cycle_complete',
    cycle: state.cycleCount,
    successCount,
    failCount,
    elapsedMs: totalElapsed,
  });

  return {
    cycle: state.cycleCount,
    successCount,
    failCount,
    phaseResults: Object.fromEntries(
      Object.entries(phaseResults).map(([k, v]) => [k, { success: v.success, elapsedMs: v.elapsedMs }])
    ),
    totalElapsedMs: totalElapsed,
  };
}

// ─── CLI Entry Point ────────────────────────────────────────────────────────

async function main() {
  log.info('Maintenance Workforce Orchestrator starting...');
  log.info(`Config: cycleInterval=${CYCLE_INTERVAL_MS}ms, maxDuration=${MAX_DURATION_MS}ms`);
  log.info(`Enabled: research=${ENABLE_RESEARCH}, backtest=${ENABLE_BACKTEST}, discovery=${ENABLE_DISCOVERY}, paper=${ENABLE_PAPER}, ingest=${ENABLE_INGEST}`);

  // Single cycle mode (for cron/systemd timer)
  if (process.argv.includes('--once')) {
    const result = await runMaintenanceCycle();
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.aborted ? 1 : 0);
  }

  // Continuous mode (daemon)
  log.info('Running in continuous daemon mode');
  while (true) {
    try {
      const result = await runMaintenanceCycle();
      if (result.aborted && result.reason === 'not_in_maintenance_mode') {
        log.info('Maintenance mode deactivated — daemon exiting');
        break;
      }
    } catch (e) {
      log.error('Unexpected cycle error', { error: e.message });
    }

    // Wait for next cycle
    await new Promise(resolve => setTimeout(resolve, CYCLE_INTERVAL_MS));
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(e => {
    log.error('Fatal error', { error: e.message });
    process.exit(1);
  });
}

module.exports = { runMaintenanceCycle, isMaintenanceMode };
