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
const ALPACA_ENABLED = String(process.env.ALPACA_ENABLED || 'false').toLowerCase() === 'true';
const IBKR_ENABLED = String(process.env.IBKR_ENABLED || 'false').toLowerCase() === 'true';

// Base order sizing
const BASE_ORDER_USD = Math.min(10000, Math.max(5, Number(process.env.ORCH_BASE_ORDER_USD || process.env.KRAKEN_ORDER_USD || 15)));

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
let distributedLock;
try { distributedLock = require('../lib/distributed-lock'); } catch { distributedLock = null; }
let fillVerifier;
try { fillVerifier = require('../lib/fill-verifier'); } catch { fillVerifier = null; }
let heartbeatRegistry;
try { heartbeatRegistry = require('../lib/heartbeat-registry'); } catch { heartbeatRegistry = null; }
let varEngine;
try { varEngine = require('../lib/var-engine'); } catch { varEngine = null; }
let correlationMonitor;
try { correlationMonitor = require('../lib/correlation-monitor'); } catch { correlationMonitor = null; }
let edgeCaseMitigations;
try { edgeCaseMitigations = require('../lib/edge-case-mitigations'); } catch { edgeCaseMitigations = null; }
let strategyPromoter;
try { strategyPromoter = require('../lib/strategy-promoter'); } catch { strategyPromoter = null; }
let mlPipeline;
try { mlPipeline = require('../lib/ml-pipeline'); } catch { mlPipeline = null; }
let exitManager;
try { exitManager = require('../lib/exit-manager'); } catch { exitManager = null; }
let _exitLoopHandle = null; // Handle for exit-manager background loop (used in graceful shutdown)

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
    } catch (alertErr) {
      if (attempt === 2) console.error('[orch] Alert delivery failed after 3 attempts:', alertErr instanceof Error ? alertErr.message : String(alertErr));
    }
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
    exitManager: !!exitManager,
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

  // Publish orchestrator heartbeat
  if (heartbeatRegistry) {
    try {
      heartbeatRegistry.publishHeartbeat('master-orchestrator', {
        cycleCount: loadState().cycleCount || 0,
        signalBusSignals: health.signalBusSignals || 0,
      });
    } catch (err) {
      log('warn', `Heartbeat publish failed: ${err?.message || err}`);
    }

    // Check required agent heartbeats (degrade, don't abort)
    const requiredAgents = String(process.env.ORCH_REQUIRED_AGENTS || '').split(',').map(a => a.trim()).filter(Boolean);
    if (requiredAgents.length > 0) {
      const agentHealth = heartbeatRegistry.checkAgentHealth(requiredAgents);
      health.agentHealth = agentHealth;
      if (!agentHealth.healthy) {
        const dead = Object.entries(agentHealth.agents)
          .filter(([, info]) => !info.alive)
          .map(([name]) => name);
        log('warn', `Agent health check: ${dead.length} agent(s) not reporting: ${dead.join(', ')}`);
        health.degradedAgents = dead;
      } else {
        log('info', `Agent health: all ${requiredAgents.length} required agent(s) alive`);
      }
    }
  }

  // Edge-case mitigations: comprehensive scan (all 10 detectors)
  if (edgeCaseMitigations) {
    try {
      // Build context for comprehensive scan from available health data
      const scanContext = {};

      // Runaway loss: feed daily P&L for velocity tracking
      if (health.dailyPnl !== undefined) {
        scanContext.currentPnl = health.dailyPnl;
      }

      // Correlated drawdown: build per-venue P&L map from reconciliation data
      if (tradeReconciler) {
        try {
          const venuePnl = {};
          // Read journal for recent per-venue P&L
          const jFile = tradeJournal?.JOURNAL_FILE;
          if (jFile && fs.existsSync(jFile)) {
            const j = rio ? rio.readJsonSafe(jFile, { fallback: { trades: [] } })
              : JSON.parse(fs.readFileSync(jFile, 'utf8'));
            const recentCutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h
            for (const t of (j.trades || [])) {
              if (!t.outcome || !t.venue || (t.entryTs || 0) < recentCutoff) continue;
              if (!venuePnl[t.venue]) venuePnl[t.venue] = 0;
              venuePnl[t.venue] += t.pnl || 0;
            }
          }
          if (Object.keys(venuePnl).length >= 2) {
            scanContext.venuePnl = venuePnl;
          }
        } catch { /* best-effort */ }
      }

      // Stale price: feed latest prices from signal bus
      if (signalBus) {
        const priceFeeds = [];
        const assetIntel = signalBus.query({ type: 'asset_intelligence', maxAgeMs: 60 * 60 * 1000 });
        for (const sig of assetIntel) {
          if (sig.payload?.lastPrice > 0) {
            priceFeeds.push({ source: sig.payload.asset || 'unknown', price: sig.payload.lastPrice });
          }
        }
        if (priceFeeds.length > 0) scanContext.priceFeeds = priceFeeds;
      }

      // Overfit: compare live vs backtest performance if strategy promoter has data
      if (strategyPromoter && tradeJournal && typeof tradeJournal.getStats === 'function') {
        try {
          const liveStats = tradeJournal.getStats({ sinceDays: 30 });
          if (liveStats && liveStats.closedTrades >= 20) {
            scanContext.liveSharpe = liveStats.sharpeRatio || 0;
            scanContext.liveWinRate = (liveStats.winRate || 0) / 100;
            scanContext.liveTrades = liveStats.closedTrades;

            // ═══ BACKTEST BASELINE FROM PROMOTED STRATEGY ═══
            // Use actual backtest results from the highest-rank strategy instead of hardcoded defaults
            let btSharpe = 1.0;
            let btWinRate = 0.55;
            try {
              const active = strategyPromoter.getActiveStrategies();
              if (active.length > 0) {
                const top = active[0];
                if (top.performance?.sharpe > 0) btSharpe = top.performance.sharpe;
                if (top.performance?.winRate > 0) btWinRate = top.performance.winRate / 100;
              }
            } catch { /* use defaults */ }
            scanContext.backtestSharpe = btSharpe;
            scanContext.backtestWinRate = btWinRate;
          }
        } catch { /* best-effort */ }
      }

      // Exchange health: track consecutive errors from signal bus
      const exchanges = [];
      for (const venue of ['coinbase', 'kraken']) {
        const venueErrors = signalBus
          ? signalBus.query({ type: 'exchange_error', maxAgeMs: 30 * 60 * 1000 })
            .filter(s => s.payload?.venue === venue).length
          : 0;
        exchanges.push({ venue, consecutiveErrors: venueErrors });
      }
      if (exchanges.length > 0) scanContext.exchanges = exchanges;

      // Run comprehensive scan with all context
      const scan = edgeCaseMitigations.runComprehensiveScan(scanContext);
      health.edgeCaseGrade = scan.grade;
      health.edgeCaseTriggered = scan.triggered;
      health.edgeCaseTotal = scan.total;

      // ═══ PERSIST BACKTEST DRIFT RATIO ═══
      // Write live-vs-backtest drift so metrics-exporter can expose ff_backtest_drift_ratio
      if (scanContext.liveSharpe !== undefined && scanContext.backtestSharpe > 0) {
        try {
          const driftRatio = Math.round((scanContext.liveSharpe / scanContext.backtestSharpe) * 1000) / 1000;
          const driftFile = path.resolve(process.cwd(), 'data', 'backtest-drift.json');
          const driftData = {
            driftRatio,
            liveSharpe: scanContext.liveSharpe,
            backtestSharpe: scanContext.backtestSharpe,
            liveWinRate: scanContext.liveWinRate,
            backtestWinRate: scanContext.backtestWinRate,
            liveTrades: scanContext.liveTrades,
            updatedAt: new Date().toISOString(),
          };
          if (rio) { rio.writeJsonAtomic(driftFile, driftData); }
          else {
            fs.mkdirSync(path.dirname(driftFile), { recursive: true });
            const tmp = driftFile + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(driftData, null, 2));
            fs.renameSync(tmp, driftFile);
          }
        } catch (err) { log('warn', `Drift ratio persist failed: ${err?.message || err}`); }
      }

      if (scan.triggered > 0) {
        log('warn', `Edge-case scan: grade=${scan.grade}, ${scan.triggered}/${scan.total} triggered`);
        for (const r of scan.results.filter(r => r.triggered)) {
          log(r.severity === 'emergency' || r.severity === 'critical' ? 'error' : 'warn',
            `  [${r.check}] ${r.severity}: ${r.message}`);
        }
      }

      // Emergency escalation: abort if scan found emergencies
      if (scan.emergencies > 0) {
        const emergencyMsgs = scan.results.filter(r => r.severity === 'emergency')
          .map(r => r.message).join('; ');
        await sendAlert(`🔥 Edge-case EMERGENCY: ${emergencyMsgs}`, 'critical');
        return { ...health, abort: true, reason: 'edge_case_emergency' };
      }
    } catch (err) {
      log('warn', `Edge-case checks failed: ${err?.message || err}`);
    }
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

      // ═══ STRATEGY PROMOTER — register evolved weights for validation ═══
      if (strategyPromoter && result.weights) {
        try {
          const stratName = `brain-gen-${result.generation?.id || 'latest'}`;
          strategyPromoter.registerStrategy({
            name: stratName,
            description: `Auto-evolved weights gen ${result.generation?.id}, calibration ${result.calibration?.score}`,
            weights: result.weights,
            thresholds: result.thresholds || {},
            author: 'self-evolving-brain',
          });
          log('info', `  Strategy registered: ${stratName}`);
        } catch (err) { log('warn', `Strategy registration failed: ${err?.message || err}`); }
      }
    } else {
      log('info', `Brain skipped evolution: ${result.reason}`);
    }

    // ═══ STRATEGY REVIEW — demote degraded strategies ═══
    if (strategyPromoter) {
      try {
        const review = strategyPromoter.reviewStrategies();
        if (review.actions.length > 0) {
          log('warn', `Strategy review: ${review.actions.length} demotion(s)`);
          for (const a of review.actions) {
            log('warn', `  ${a.name}: ${a.from} → ${a.to} (${a.reason})`);
          }
        }
      } catch (err) { log('warn', `Strategy review failed: ${err?.message || err}`); }

      // ═══ PROMOTED STRATEGY WEIGHTS — publish highest-stage strategy weights to signal bus ═══
      // Edge-detector checks for promoted_weights signals to override brain defaults
      try {
        const active = strategyPromoter.getActiveStrategies();
        if (active.length > 0 && signalBus) {
          // Sort by stage priority (LIVE_FULL > LIVE_SMALL), then by most recent
          const promoted = active.sort((a, b) => {
            const stagePriority = { LIVE_FULL: 2, LIVE_SMALL: 1 };
            return (stagePriority[b.status] || 0) - (stagePriority[a.status] || 0);
          })[0];
          if (promoted.weights && Object.keys(promoted.weights).length > 0) {
            signalBus.publish({
              type: 'promoted_weights',
              source: 'strategy-promoter',
              confidence: 0.9,
              payload: {
                strategyName: promoted.name,
                stage: promoted.status,
                weights: promoted.weights,
                thresholds: promoted.thresholds || {},
              },
              ttlMs: 30 * 60 * 1000,
            });
            log('info', `  Published promoted weights: ${promoted.name} (${promoted.status})`);
          }
        }
      } catch (err) { log('warn', `Promoted weights publish failed: ${err?.message || err}`); }
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
      // FIX M-3: Use rio.readJsonSafe for safe concurrent reads
      const j = rio ? rio.readJsonSafe(tradeJournal.JOURNAL_FILE, { fallback: { trades: [] } })
        : JSON.parse(fs.readFileSync(tradeJournal.JOURNAL_FILE, 'utf8'));
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
    } catch (err) { log('warn', 'asset filter error: ' + (err?.message || err)); }
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

  // ═══ BRAIN TIME-OF-DAY GATE ═══
  // Respect the same time-based filter that individual venue engines use
  if (brain && typeof brain.shouldTradeNow === 'function') {
    try {
      const timeCheck = brain.shouldTradeNow();
      if (!timeCheck.trade) {
        log('info', `Brain time filter: ${timeCheck.reason} — skipping signal generation`);
        return [];
      }
      if (timeCheck.reducedSize) {
        log('info', `Brain time advisory: ${timeCheck.reason} — will use reduced sizing`);
      }
    } catch (err) { log('warn', `Brain time check error: ${err?.message || err}`); }
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
    alpaca: 'scripts/alpaca-equities-engine.js',
    ibkr: 'scripts/ibkr-engine.js',
  };
  return map[venue] || null;
}

function isVenueEnabled(venue) {
  if (venue === 'kraken') return KRAKEN_ENABLED;
  if (venue === 'coinbase') return COINBASE_ENABLED;
  if (venue === 'prediction') return PRED_ENABLED;
  if (venue === 'alpaca') return ALPACA_ENABLED;
  if (venue === 'ibkr') return IBKR_ENABLED;
  return false;
}

function executeVenueTrade(venue, signal, orderUsd) {
  const script = getVenueScript(venue);
  if (!script) return { success: false, reason: `no script for venue ${venue}` };

  log('info', `  Executing on ${venue}: ${signal.asset} ${signal.side} $${orderUsd.toFixed(2)}`);

  // ═══ FIX C-5: Route asset to correct product ID / pair ═══
  const asset = (signal.asset || 'BTC').toUpperCase();
  const krakenPairMap = {
    BTC: 'XXBTZUSD', ETH: 'XETHZUSD', SOL: 'SOLUSD', AVAX: 'AVAXUSD',
    DOGE: 'XDGUSD', ADA: 'ADAUSD', DOT: 'DOTUSD', MATIC: 'MATICUSD',
    LINK: 'LINKUSD', UNI: 'UNIUSD', ATOM: 'ATOMUSD', LTC: 'XLTCZUSD',
  };
  const coinbaseProductId = `${asset}-USD`;
  const krakenPair = krakenPairMap[asset] || `${asset}USD`;

  const result = spawnSync('node', [script], {
    env: {
      ...process.env,
      // Override per-trade parameters
      [`${venue.toUpperCase()}_ORDER_USD`]: String(orderUsd),
      KRAKEN_ORDER_USD: venue === 'kraken' ? String(orderUsd) : process.env.KRAKEN_ORDER_USD,
      COINBASE_ORDER_USD: venue === 'coinbase' ? String(orderUsd) : process.env.COINBASE_ORDER_USD,
      PRED_MARKET_ORDER_USD: venue === 'prediction' ? String(orderUsd) : process.env.PRED_MARKET_ORDER_USD,
      // Route to correct asset product / pair
      COINBASE_PRODUCT_ID: venue === 'coinbase' ? coinbaseProductId : (process.env.COINBASE_PRODUCT_ID || 'BTC-USD'),
      KRAKEN_PAIR: venue === 'kraken' ? krakenPair : (process.env.KRAKEN_PAIR || 'XXBTZUSD'),
    },
    encoding: 'utf8',
    timeout: 60000,
  });

  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '').replace(/(key|secret|password|token|authorization)\s*[:=]\s*\S+/gi, '$1=***');
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

      // ═══ VaR CONSTRAINT — Portfolio-level risk budget ═══
      if (varEngine && typeof varEngine.varConstrainedSize === 'function') {
        try {
          const historicalReturns = varEngine.getHistoricalReturns();
          let currentVaR = 0;
          if (historicalReturns.length >= 5) {
            const histVaR = varEngine.calculateVaR(historicalReturns);
            currentVaR = Math.abs(histVaR.var95);
          }
          const varAdjusted = varEngine.varConstrainedSize({
            baseUsd: orderUsd,
            currentVaR,
            assetVol: 3, // default crypto vol estimate
            confidence: signal.confidence,
            edge: signal.edge,
          });
          if (varAdjusted <= 0) {
            log('warn', `  VaR blocked ${signal.asset}: portfolio VaR at limit`);
            executions.push({ asset: signal.asset, side: signal.side, status: 'var_blocked', reasons: ['VaR limit reached'] });
            continue;
          }
          if (varAdjusted < orderUsd) {
            log('info', `  VaR constrained ${signal.asset}: $${orderUsd.toFixed(2)} → $${varAdjusted.toFixed(2)}`);
          }
          orderUsd = varAdjusted;
        } catch (err) {
          log('warn', `VaR constraint error: ${err?.message || err}`);
        }
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

      // ═══ ORDER DEDUP GUARD — prevent duplicate orders within short window ═══
      if (edgeCaseMitigations) {
        try {
          const dedup = edgeCaseMitigations.checkOrderDuplication({
            venue: 'orchestrator',
            asset: signal.asset,
            side: signal.side,
            usdSize: orderUsd,
          });
          if (dedup.triggered) {
            log('info', `  Dedup blocked ${signal.asset}: ${dedup.message}`);
            executions.push({ asset: signal.asset, side: signal.side, status: 'dedup_blocked', reasons: [dedup.message] });
            continue;
          }
        } catch (err) { log('warn', `Order dedup error: ${err?.message || err}`); }
      }

      // ═══ FLASH CRASH GUARD — halt if price collapsed ═══
      if (edgeCaseMitigations && signal.meta?.lastPrice > 0) {
        try {
          const recentPrices = [];
          if (signal.meta.lastPrice) recentPrices.push(signal.meta.lastPrice);
          // Fetch price from signal bus for historical context
          if (signalBus) {
            const priceSignals = signalBus.query({ type: 'asset_intelligence', maxAgeMs: 30 * 60 * 1000 })
              .filter(s => s.payload?.asset === signal.asset);
            for (const ps of priceSignals) {
              if (ps.payload?.lastPrice > 0) recentPrices.push(ps.payload.lastPrice);
            }
          }
          if (recentPrices.length >= 2) {
            const crash = edgeCaseMitigations.checkFlashCrash({
              asset: signal.asset,
              currentPrice: signal.meta.lastPrice,
              recentPrices,
            });
            if (crash.triggered) {
              log('error', `  Flash crash detected for ${signal.asset}: ${crash.message}`);
              await sendAlert(`⚡ Flash crash: ${crash.message}`, 'critical');
              executions.push({ asset: signal.asset, side: signal.side, status: 'flash_crash', reasons: [crash.message] });
              continue;
            }
          }
        } catch (err) { log('warn', `Flash crash check error: ${err?.message || err}`); }
      }

      // ═══ WAL: Write pending entry BEFORE attempting any venue ═══
      let walTradeId = null;
      if (tradeJournal) {
        try {
          walTradeId = tradeJournal.recordTrade({
            venue: 'pending',
            asset: signal.asset,
            side: signal.side,
            entryPrice: signal.meta?.lastPrice || 0,
            usdSize: orderUsd,
            signal: { side: signal.side, confidence: signal.confidence, edge: signal.edge, compositeScore: signal.compositeScore },
            signalComponents: signal.components || {},
            dryRun: DRY_RUN,
            expectedPrice: signal.meta?.lastPrice || 0,
            signalSources: Object.keys(signal.components || {}),
            walStatus: 'pending',
          });
        } catch (err) { log('warn', 'WAL pending write failed: ' + (err?.message || err)); }
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

          // ═══ WAL: Update pending entry → placed ═══
          if (tradeJournal && walTradeId) {
            try {
              tradeJournal.updateTradeById(walTradeId, {
                venue,
                walStatus: 'placed',
                orderId: null, // will be updated by fill verifier below
              });
            } catch (err) { log('warn', 'WAL update failed: ' + (err?.message || err)); }
          }

          // Post-order fill verification
          if (fillVerifier && !DRY_RUN) {
            try {
              const orderId = fillVerifier.extractOrderId(venue, result.stdout);
              if (orderId) {
                const fill = await fillVerifier.verifyFill({
                  venue,
                  orderId,
                  expectedPrice: signal.meta?.lastPrice || 0,
                  side: signal.side,
                  requestedUsd: orderUsd,
                });
                result.fill = {
                  verified: fill.verified,
                  status: fill.status,
                  fillPrice: fill.fillPrice,
                  slippagePct: fill.slippagePct,
                  attempts: fill.attempts,
                };
                if (fill.verified && fill.status === 'filled' && tradeJournal && walTradeId) {
                  try {
                    tradeJournal.updateTradeById(walTradeId, {
                      fillPrice: fill.fillPrice,
                      slippagePct: fill.slippagePct,
                      slippageUsd: Math.round(fill.slippagePct * orderUsd) / 100,
                      orderId,
                      walStatus: 'filled',
                    });
                  } catch { /* best-effort */ }
                }
                log('info', `  Fill verified: ${signal.asset} on ${venue} — ${fill.status} @ $${fill.fillPrice.toFixed(2)} (slip: ${fill.slippagePct}%)`);
              }
            } catch (err) {
              log('warn', `  Fill verification failed for ${signal.asset}: ${err?.message || err}`);
            }
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
          } catch (err) { log('info', `  ${venue} skip-reason parse failed: ${err?.message}`); }
        }
      }

      // ═══ WAL: Mark as failed if no venue accepted the trade ═══
      if (!traded) {
        log('info', `  No venue accepted trade for ${signal.asset}`);
        if (tradeJournal && walTradeId) {
          try {
            tradeJournal.updateTradeById(walTradeId, {
              walStatus: 'failed',
              outcome: 'skipped',
              closedAt: new Date().toISOString(),
              closeReason: 'all_venues_rejected',
            });
          } catch (err) { log('warn', 'WAL failure update failed: ' + (err?.message || err)); }
        }
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

function phasePublishState(health, brainResult, signals, execution, predResult, durationMs, exitResult) {
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
      edgeCaseGrade: health.edgeCaseGrade || 'N/A',
      edgeCaseTriggered: health.edgeCaseTriggered || 0,
      predictionStatus: predResult?.status || 'disabled',
      exitManagerChecked: exitResult?.checked || 0,
      exitManagerExited: exitResult?.exited || 0,
      exitManagerErrors: exitResult?.errors || 0,
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
        exitManager: health.exitManager,
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
    } catch (err) { log('warn', `data file trim error for ${file}: ${err?.message}`); }
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

  // FIX H-1: Enforce cycle timeout — abort if any phase hangs
  let cycleTimer;
  const timeoutPromise = new Promise((_, reject) => {
    cycleTimer = setTimeout(() => reject(new Error(`Cycle timeout: exceeded ${CYCLE_TIMEOUT_MS}ms`)), CYCLE_TIMEOUT_MS);
  });

  try {
    await Promise.race([runCycle(startMs), timeoutPromise]);
  } finally {
    clearTimeout(cycleTimer);
  }
}

async function runCycle(startMs) {

  // ─── WAL Recovery: close orphaned pending trades from crashes ───────────
  if (tradeJournal && typeof tradeJournal.recoverPendingTrades === 'function') {
    try {
      const recovered = tradeJournal.recoverPendingTrades();
      if (recovered.length > 0) {
        log('warn', `WAL recovery: closed ${recovered.length} orphaned pending trade(s): ${recovered.join(', ')}`);
        await sendAlert(`⚠️ WAL recovery: ${recovered.length} orphaned trade(s) found and closed`, 'critical');
      }
    } catch (err) {
      log('error', `WAL recovery failed: ${err?.message || err}`);
    }
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

  // ─── HEALTH GATE: Refuse to trade without critical safety modules ─────────
  const missingCritical = [];
  if (!riskManager) missingCritical.push('risk-manager');
  if (!capitalMandate) missingCritical.push('capital-mandate');
  if (!edgeDetector) missingCritical.push('edge-detector');
  if (!signalBus) missingCritical.push('agent-signal-bus');

  if (missingCritical.length > 0) {
    const msg = `HEALTH GATE FAILED: ${missingCritical.length} critical module(s) missing: ${missingCritical.join(', ')}. Refusing to trade.`;
    log('error', msg);
    await sendAlert(`[ORCHESTRATOR] ${msg}`, 'critical');
    state.errors.push({ ts: Date.now(), phase: 'health_gate', msg });
    saveState(state);
    return;
  }

  // ─── LEADER LOCK: Only one instance should run the orchestrator ──────────
  let leaderLock = null;
  if (distributedLock) {
    leaderLock = await distributedLock.acquireLeaderLock();
    if (!leaderLock.acquired) {
      log('warn', `Leader lock not acquired — another instance is active (${leaderLock.heldBy || 'unknown'}). Skipping cycle.`);
      state.lastRunAt = startMs;
      state.lastCycle = { ts: new Date().toISOString(), skipped: true, reason: 'leader_lock_held' };
      saveState(state);
      return;
    }
    log('info', `Leader lock acquired (${leaderLock.backend})`);
  }

  try {
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

  // Phase 5d: Exit Manager — check open positions for trailing stop / take-profit exits
  let exitResult = { checked: 0, exited: 0, errors: 0, exits: [] };
  if (exitManager) {
    try {
      log('info', '═══ Phase 5d: Exit Manager — Position Exit Check ═══');
      exitResult = await exitManager.checkExits();
      log('info', `  Exit check: ${exitResult.checked} open, ${exitResult.exited} exited, ${exitResult.errors} errors`);
      if (exitResult.exits && exitResult.exits.length > 0) {
        for (const ex of exitResult.exits) {
          log('info', `    Closed ${ex.asset} ${ex.side} on ${ex.venue}: entry=$${ex.entryPrice} exit=$${ex.exitPrice} P&L=$${ex.pnl.toFixed(2)} (${ex.reason})`);
        }
      }
    } catch (e) {
      log('error', `Exit manager check failed: ${e.message}`);
    }
  }

  // Start exit-manager background loop (timer is .unref()'d so it won't block process exit)
  // This ensures exits are continuously monitored if the orchestrator runs as a long-lived process
  if (exitManager && typeof exitManager.runExitLoop === 'function') {
    try {
      _exitLoopHandle = exitManager.runExitLoop();
      log('info', '  Exit manager background loop started');
    } catch (e) {
      log('warn', `Exit manager loop start failed: ${e.message}`);
    }
  }

  // Phase 6: Prediction Markets
  const predResult = phasePredictionMarkets();

  // Phase 7: Publish State
  const durationMs = Date.now() - startMs;
  phasePublishState(health, brainResult, signals, execution, predResult, durationMs, exitResult);

  // Phase 8: Data Maintenance (signal pruning every cycle, heavy trim every 10th)
  phaseDataMaintenance();

  // Phase 8b: Refresh correlation matrix for diversification monitoring
  if (correlationMonitor && typeof correlationMonitor.updateCorrelations === 'function') {
    try {
      correlationMonitor.updateCorrelations();
    } catch (e) {
      log('warn', `Correlation refresh failed: ${e?.message || e}`);
    }
  }

  // Phase 8c: ML Pipeline — periodic retraining trigger
  if (mlPipeline && typeof mlPipeline.trainModel === 'function') {
    try {
      // Retrain every 10 cycles if feature store has enough new samples
      if ((state.cycleCount + 1) % 10 === 0) {
        const mlResult = mlPipeline.trainModel();
        if (mlResult) {
          log('info', `ML pipeline: ${mlResult.trained ? 'retrained' : 'skipped'} — val accuracy: ${mlResult.valAccuracy}%, samples: ${mlResult.samples}`);
          if (mlResult.trained && mlResult.featureImportance) {
            const topFeatures = Object.entries(mlResult.featureImportance)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([name, count]) => `${name}:${count}`)
              .join(', ');
            log('info', `  Top features: ${topFeatures}`);
          }
        }
      }
    } catch (e) {
      log('warn', `ML training trigger failed: ${e?.message || e}`);
    }
  }

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
    exitChecked: exitResult.checked || 0,
    exitExited: exitResult.exited || 0,
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
      exitManager: {
        checked: exitResult.checked || 0,
        exited: exitResult.exited || 0,
        errors: exitResult.errors || 0,
        exits: (exitResult.exits || []).map(ex => ({
          asset: ex.asset, venue: ex.venue, side: ex.side,
          pnl: Math.round((ex.pnl || 0) * 100) / 100,
          reason: ex.reason,
        })),
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

  } finally {
    // Release leader lock
    if (leaderLock?.acquired && distributedLock) {
      await distributedLock.releaseLock(leaderLock.lockKey, leaderLock.lockId);
      log('info', 'Leader lock released');
    }
  }
}

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

let shuttingDown = false;

function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('warn', `Received ${signal} — initiating graceful shutdown...`);

  // Save current state
  try {
    const state = loadState();
    state.lastShutdown = { signal, ts: Date.now(), iso: new Date().toISOString() };
    saveState(state);
    log('info', 'State saved');
  } catch (err) {
    console.error('[orchestrator] State save during shutdown failed:', err?.message || err);
  }

  // Release leader lock if held
  if (distributedLock) {
    // Synchronous file-based release as best-effort since we're shutting down
    try {
      distributedLock.cleanupExpiredLocks();
      log('info', 'Lock cleanup done');
    } catch { /* ignore */ }
  }

  // Stop exit-manager background loop if running
  if (exitManager && _exitLoopHandle && typeof _exitLoopHandle.stop === 'function') {
    try {
      _exitLoopHandle.stop();
      log('info', 'Exit manager loop stopped');
    } catch { /* ignore — best-effort cleanup */ }
  }

  // Publish shutdown signal to bus
  if (signalBus) {
    try {
      signalBus.publish({
        type: 'orchestrator_shutdown',
        source: 'master-orchestrator',
        confidence: 1.0,
        payload: { signal, ts: Date.now() },
        ttlMs: 30 * 60 * 1000,
      });
    } catch { /* ignore */ }
  }

  log('info', 'Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

main().then(() => process.exit(0)).catch(async (err) => {
  console.error('[orchestrator] Fatal:', err.message);
  await sendAlert(`🔥 Orchestrator FATAL: ${err.message}`, 'critical');
  process.exit(1);
});
