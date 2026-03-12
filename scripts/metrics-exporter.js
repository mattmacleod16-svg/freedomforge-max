#!/usr/bin/env node
/**
 * FreedomForge Prometheus Metrics Exporter
 * =========================================
 *
 * Exposes trading system metrics on an HTTP endpoint for Prometheus to scrape.
 *
 * Start:
 *   node scripts/metrics-exporter.js
 *   METRICS_PORT=9091 node scripts/metrics-exporter.js
 *
 * Endpoints:
 *   GET /metrics  — Prometheus text format metrics
 *   GET /health   — Simple health check (200 OK)
 *
 * Metrics are refreshed every 30 seconds and cached between scrapes.
 * If any module fails to load or returns errors, those metrics are skipped.
 */

'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

// ── Configuration ────────────────────────────────────────────────────────────

const METRICS_PORT = Math.max(1024, Math.min(65535, parseInt(process.env.METRICS_PORT || '9090', 10) || 9090));
const REFRESH_INTERVAL_MS = 30000; // 30 seconds
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ── Module Loaders (fail-safe) ──────────────────────────────────────────────

function safeRequire(modulePath) {
  try {
    return require(modulePath);
  } catch (err) {
    console.error(`[metrics-exporter] Failed to load ${modulePath}: ${err.message}`);
    return null;
  }
}

function safeCall(fn, fallback) {
  try {
    const result = fn();
    return result != null ? result : fallback;
  } catch (err) {
    console.error(`[metrics-exporter] Error calling function: ${err.message}`);
    return fallback;
  }
}

// Lazy-load modules (resolved relative to project root)
const libPath = (name) => path.join(PROJECT_ROOT, 'lib', name);

let riskManager = null;
let capitalMandate = null;
let tradeJournal = null;
let signalBus = null;
let resilientIo = null;
let varEngine = null;
let correlationMonitor = null;
let brain = null;
let mlPipeline = null;
let edgeCaseMitigations = null;
let heartbeatRegistry = null;
let strategyPromoter = null;

function loadModules() {
  if (!riskManager) riskManager = safeRequire(libPath('risk-manager'));
  if (!capitalMandate) capitalMandate = safeRequire(libPath('capital-mandate'));
  if (!tradeJournal) tradeJournal = safeRequire(libPath('trade-journal'));
  if (!signalBus) signalBus = safeRequire(libPath('agent-signal-bus'));
  if (!resilientIo) resilientIo = safeRequire(libPath('resilient-io'));
  if (!varEngine) varEngine = safeRequire(libPath('var-engine'));
  if (!correlationMonitor) correlationMonitor = safeRequire(libPath('correlation-monitor'));
  if (!brain) brain = safeRequire(libPath('self-evolving-brain'));
  if (!mlPipeline) mlPipeline = safeRequire(libPath('ml-pipeline'));
  if (!edgeCaseMitigations) edgeCaseMitigations = safeRequire(libPath('edge-case-mitigations'));
  if (!heartbeatRegistry) heartbeatRegistry = safeRequire(libPath('heartbeat-registry'));
  if (!strategyPromoter) strategyPromoter = safeRequire(libPath('strategy-promoter'));
}

// ── CPU Usage Tracker ───────────────────────────────────────────────────────
// os.cpus() gives instantaneous counters; we need to diff between snapshots.

let prevCpuInfo = os.cpus();
let cpuUsagePct = 0;

function updateCpuUsage() {
  const cpus = os.cpus();
  let totalIdleDelta = 0;
  let totalTickDelta = 0;

  for (let i = 0; i < cpus.length; i++) {
    const prev = prevCpuInfo[i];
    const curr = cpus[i];
    if (!prev || !curr) continue;

    const prevTotal = Object.values(prev.times).reduce((a, b) => a + b, 0);
    const currTotal = Object.values(curr.times).reduce((a, b) => a + b, 0);

    totalIdleDelta += curr.times.idle - prev.times.idle;
    totalTickDelta += currTotal - prevTotal;
  }

  if (totalTickDelta > 0) {
    cpuUsagePct = Math.round(((totalTickDelta - totalIdleDelta) / totalTickDelta) * 10000) / 100;
  }

  prevCpuInfo = cpus;
}

// ── Disk Usage ──────────────────────────────────────────────────────────────

function getDiskUsagePct() {
  try {
    const { execSync } = require('child_process');
    // Get usage of the root filesystem (or the filesystem where project lives)
    const output = execSync(`df -P "${PROJECT_ROOT}" | tail -1`, {
      encoding: 'utf8',
      timeout: 5000,
    });
    const parts = output.trim().split(/\s+/);
    // df -P columns: Filesystem 1024-blocks Used Available Capacity Mounted-on
    if (parts.length >= 5) {
      const pct = parseInt(parts[4].replace('%', ''), 10);
      return Number.isFinite(pct) ? pct : -1;
    }
  } catch {
    // Disk usage unavailable
  }
  return -1;
}

// ── Watchdog Detection ──────────────────────────────────────────────────────

function isWatchdogRunning() {
  try {
    const { execSync } = require('child_process');
    const output = execSync('pgrep -f watchdog-daemon', {
      encoding: 'utf8',
      timeout: 3000,
    }).trim();
    return output.length > 0 ? 1 : 0;
  } catch {
    return 0;
  }
}

// ── Metrics Cache ───────────────────────────────────────────────────────────

let cachedMetrics = '';
let lastRefresh = 0;

// ── Metric Formatting Helpers ───────────────────────────────────────────────

function gauge(name, help, value, labels) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  const labelStr = labels ? `{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')}}` : '';
  return `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name}${labelStr} ${value}\n\n`;
}

function gaugeMulti(name, help, entries) {
  // entries: [{ labels: {key: val}, value: number }, ...]
  if (!entries || entries.length === 0) return '';
  let out = `# HELP ${name} ${help}\n# TYPE ${name} gauge\n`;
  for (const entry of entries) {
    if (entry.value === null || entry.value === undefined || !Number.isFinite(entry.value)) continue;
    const labelStr = Object.entries(entry.labels).map(([k, v]) => `${k}="${v}"`).join(',');
    out += `${name}{${labelStr}} ${entry.value}\n`;
  }
  return out + '\n';
}

// ── Collect All Metrics ─────────────────────────────────────────────────────

function collectMetrics() {
  loadModules();
  updateCpuUsage();

  let output = '';

  // ── Risk Manager Metrics ──────────────────────────────────────────────────

  if (riskManager && typeof riskManager.getRiskHealth === 'function') {
    const health = safeCall(() => riskManager.getRiskHealth(), null);
    if (health) {
      output += gauge('ff_equity_usd', 'Current portfolio equity in USD', health.currentEquity);
      output += gauge('ff_peak_equity_usd', 'Peak portfolio equity in USD', health.peakEquity);
      output += gauge('ff_drawdown_pct', 'Current drawdown percentage', health.drawdownPct);
      output += gauge('ff_max_drawdown_pct', 'Configured max drawdown percentage', health.maxDrawdownPct);
      output += gauge('ff_daily_pnl_usd', 'Daily P&L in USD', health.dailyPnl);
      output += gauge('ff_max_daily_loss_usd', 'Configured max daily loss in USD', health.maxDailyLoss);
      output += gauge('ff_kill_switch_active', 'Kill switch status (1=active, 0=inactive)', health.killSwitchActive ? 1 : 0);
      output += gauge('ff_portfolio_exposure_usd', 'Total portfolio exposure in USD', health.totalExposure);
      output += gauge('ff_max_exposure_usd', 'Maximum allowed portfolio exposure in USD', health.maxExposure);
      output += gauge('ff_utilization_pct', 'Portfolio exposure utilization percentage', health.utilizationPct);
      output += gauge('ff_position_count', 'Number of open positions', health.positionCount);
      output += gauge('ff_risk_healthy', 'Overall risk health (1=healthy, 0=unhealthy)', health.healthy ? 1 : 0);

      // Daily loss as percentage of limit
      if (health.maxDailyLoss > 0 && health.dailyPnl < 0) {
        const dailyLossPct = Math.round((Math.abs(health.dailyPnl) / health.maxDailyLoss) * 10000) / 100;
        output += gauge('ff_daily_loss_pct', 'Daily loss as percentage of daily loss limit', dailyLossPct);
      } else {
        output += gauge('ff_daily_loss_pct', 'Daily loss as percentage of daily loss limit', 0);
      }
    }
  }

  // ── Capital Mandate Metrics ───────────────────────────────────────────────

  if (capitalMandate) {
    if (typeof capitalMandate.getMandateSummary === 'function') {
      const mandate = safeCall(() => capitalMandate.getMandateSummary(), null);
      if (mandate) {
        // Encode mode as numeric: 0=halt, 1=survival, 2=normal, 3=growth
        const modeMap = { capital_halt: 0, survival: 1, normal: 2, growth: 3 };
        const modeNum = modeMap[mandate.mode] !== undefined ? modeMap[mandate.mode] : -1;
        output += gauge('ff_capital_mode', 'Current capital mode (0=halt, 1=survival, 2=normal, 3=growth)', modeNum);
        output += gauge('ff_initial_capital_usd', 'Initial capital at system start in USD', mandate.initialCapital);
        output += gauge('ff_high_water_mark_usd', 'High water mark capital in USD', mandate.highWaterMark);
        output += gauge('ff_low_water_mark_usd', 'Low water mark capital in USD', mandate.lowWaterMark);
        output += gauge('ff_roi_pct', 'Return on investment percentage since inception', Math.round((mandate.roiPct || 0) * 100) / 100);
        output += gauge('ff_total_days_active', 'Total days the system has been active', mandate.totalDaysActive);
        output += gauge('ff_consecutive_win_days', 'Consecutive winning days', mandate.consecutiveWinDays);
        output += gauge('ff_consecutive_loss_days', 'Consecutive losing days', mandate.consecutiveLossDays);
        output += gauge('ff_trade_denials_total', 'Total trades denied by mandate', mandate.tradeDenials);
        output += gauge('ff_capital_halt_events_total', 'Total capital halt events', mandate.capitalHaltEvents);
        output += gauge('ff_survival_mode_entries_total', 'Total survival mode entries', mandate.survivalModeEntries);
        output += gauge('ff_milestones_reached', 'Number of capital milestones reached', (mandate.milestonesReached || []).length);
      }
    }

    if (typeof capitalMandate.getCurrentCapital === 'function') {
      const capital = safeCall(() => capitalMandate.getCurrentCapital(), null);
      if (capital) {
        output += gauge('ff_capital_total_usd', 'Total capital across all exchanges in USD', capital.total);
        output += gauge('ff_capital_coinbase_usd', 'Capital on Coinbase in USD', capital.coinbase);
        output += gauge('ff_capital_kraken_usd', 'Capital on Kraken in USD', capital.kraken);
      }
    }
  }

  // ── Trade Journal Metrics ─────────────────────────────────────────────────

  if (tradeJournal && typeof tradeJournal.getStats === 'function') {
    const stats = safeCall(() => tradeJournal.getStats({ sinceDays: 30 }), null);
    if (stats) {
      output += gauge('ff_total_trades_30d', 'Total trades in last 30 days', stats.totalTrades);
      output += gauge('ff_closed_trades_30d', 'Closed trades in last 30 days', stats.closedTrades);
      output += gauge('ff_open_trades', 'Currently open trades', stats.openTrades);
      output += gauge('ff_win_rate_pct', 'Win rate percentage (30d)', stats.winRate);
      output += gauge('ff_profit_factor', 'Profit factor (30d)', stats.profitFactor === Infinity ? 999 : stats.profitFactor);
      output += gauge('ff_total_pnl_30d_usd', 'Total P&L in last 30 days in USD', stats.totalPnl);
      output += gauge('ff_total_fees_30d_usd', 'Total fees in last 30 days in USD', stats.totalFees);
      output += gauge('ff_total_volume_30d_usd', 'Total volume in last 30 days in USD', stats.totalVolume);
      output += gauge('ff_avg_win_usd', 'Average winning trade in USD (30d)', stats.avgWin);
      output += gauge('ff_avg_loss_usd', 'Average losing trade in USD (30d)', stats.avgLoss);
      output += gauge('ff_sharpe_ratio', 'Annualized Sharpe ratio (30d)', stats.sharpeRatio);
      output += gauge('ff_max_drawdown_usd', 'Maximum drawdown in USD (30d)', stats.maxDrawdown);

      // Compute trades per hour (rough estimate from 30d data)
      if (stats.totalTrades > 0) {
        const tradesPerHour = Math.round((stats.totalTrades / (30 * 24)) * 100) / 100;
        output += gauge('ff_trades_per_hour', 'Average trades per hour (30d)', tradesPerHour);
      } else {
        output += gauge('ff_trades_per_hour', 'Average trades per hour (30d)', 0);
      }
    }

    // Compute last trade age
    const lastTradeAge = safeCall(() => {
      const recentStats = tradeJournal.getStats({ sinceDays: 365 });
      if (!recentStats || recentStats.totalTrades === 0) return -1;
      // Read journal to find the most recent trade timestamp
      const journalFile = tradeJournal.JOURNAL_FILE;
      if (!journalFile || !fs.existsSync(journalFile)) return -1;
      const raw = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
      if (!raw || !Array.isArray(raw.trades) || raw.trades.length === 0) return -1;
      const lastTrade = raw.trades[raw.trades.length - 1];
      const lastTs = lastTrade.closedAt
        ? new Date(lastTrade.closedAt).getTime()
        : (lastTrade.entryTs || 0);
      if (lastTs <= 0) return -1;
      return Math.round((Date.now() - lastTs) / 1000);
    }, -1);

    if (lastTradeAge >= 0) {
      output += gauge('ff_last_trade_age_seconds', 'Seconds since last completed trade', lastTradeAge);
      output += gauge('ff_last_trade_attempt_age_seconds', 'Seconds since last trade attempt', lastTradeAge);
    }
  }

  // ── Signal Bus Metrics ────────────────────────────────────────────────────

  if (signalBus && typeof signalBus.summary === 'function') {
    const busSummary = safeCall(() => signalBus.summary(), null);
    if (busSummary) {
      output += gauge('ff_signal_bus_total', 'Total active signals on bus', busSummary.totalSignals);

      // Per-type signal counts
      if (busSummary.types && typeof busSummary.types === 'object') {
        const typeEntries = Object.entries(busSummary.types).map(([type, info]) => ({
          labels: { signal_type: type },
          value: info.count || 0,
        }));
        if (typeEntries.length > 0) {
          output += gaugeMulti('ff_signal_bus_by_type', 'Active signals on bus by type', typeEntries);
        }
      }

      // Signal bus freshness — age of newest signal
      const freshness = safeCall(() => {
        const signals = signalBus.query({});
        if (!signals || signals.length === 0) return -1;
        // signals are sorted newest-first by query()
        const newestTs = signals[0].publishedAt || 0;
        return newestTs > 0 ? Math.round((Date.now() - newestTs) / 1000) : -1;
      }, -1);

      if (freshness >= 0) {
        output += gauge('ff_signal_bus_freshness_seconds', 'Seconds since newest signal on bus', freshness);
      }
    }
  }

  // ── Circuit Breaker Metrics ───────────────────────────────────────────────

  if (resilientIo && typeof resilientIo.getCircuitStatus === 'function') {
    const circuits = safeCall(() => resilientIo.getCircuitStatus(), null);
    if (circuits && typeof circuits === 'object') {
      const entries = Object.entries(circuits);
      if (entries.length > 0) {
        const statusMap = { CLOSED: 0, HALF_OPEN: 1, OPEN: 2 };
        const cbEntries = entries.map(([name, state]) => ({
          labels: { exchange: name },
          value: statusMap[state.status] !== undefined ? statusMap[state.status] : -1,
        }));
        output += gaugeMulti('ff_circuit_breaker_status', 'Circuit breaker status per exchange (0=closed, 1=half_open, 2=open)', cbEntries);

        const failureEntries = entries.map(([name, state]) => ({
          labels: { exchange: name },
          value: state.failures || 0,
        }));
        output += gaugeMulti('ff_circuit_breaker_failures', 'Circuit breaker consecutive failure count per exchange', failureEntries);
      } else {
        // No circuit breakers tracked yet — export defaults for known exchanges
        const defaultExchanges = ['coinbase', 'kraken'];
        const defaults = defaultExchanges.map((ex) => ({
          labels: { exchange: ex },
          value: 0,
        }));
        output += gaugeMulti('ff_circuit_breaker_status', 'Circuit breaker status per exchange (0=closed, 1=half_open, 2=open)', defaults);
      }
    }
  }

  // ── VaR Engine Metrics ────────────────────────────────────────────────────

  if (varEngine) {
    if (typeof varEngine.getHistoricalReturns === 'function' && typeof varEngine.calculateVaR === 'function') {
      const varMetrics = safeCall(() => {
        const returns = varEngine.getHistoricalReturns();
        if (!returns || returns.length < 3) return null;
        const result = varEngine.calculateVaR(returns);
        return result;
      }, null);

      if (varMetrics) {
        output += gauge('ff_portfolio_var_pct', 'Portfolio VaR 95% as percentage', Math.abs(varMetrics.var95 || 0));
        output += gauge('ff_portfolio_var99_pct', 'Portfolio VaR 99% as percentage', Math.abs(varMetrics.var99 || 0));
        output += gauge('ff_portfolio_cvar_pct', 'Portfolio CVaR (Expected Shortfall) 95% as percentage', Math.abs(varMetrics.cvar95 || 0));
      }
    }

    output += gauge('ff_var_limit_pct', 'Configured VaR portfolio limit percentage', varEngine.VAR_PORTFOLIO_LIMIT_PCT || 5);
  }

  // ── Correlation Monitor Metrics ───────────────────────────────────────────

  if (correlationMonitor) {
    if (typeof correlationMonitor.getDiversificationScore === 'function') {
      const divScore = safeCall(() => correlationMonitor.getDiversificationScore(), null);
      if (divScore !== null) {
        output += gauge('ff_diversification_score', 'Portfolio diversification score (0-100)', divScore);
      }
    }

    if (typeof correlationMonitor.getCorrelationMatrix === 'function') {
      const corrState = safeCall(() => correlationMonitor.getCorrelationMatrix(), null);
      if (corrState) {
        // Find max pairwise correlation
        const corrValues = Object.values(corrState.matrix || {}).filter((v) => Number.isFinite(v));
        if (corrValues.length > 0) {
          const maxCorr = Math.max(...corrValues.map(Math.abs));
          output += gauge('ff_max_correlation', 'Maximum pairwise asset correlation (absolute)', Math.round(maxCorr * 10000) / 10000);
        }

        output += gauge('ff_correlation_alert_count', 'Number of active correlation alerts', (corrState.alerts || []).length);
      }
    }
  }

  // ── Brain / Self-Evolving Brain Metrics ──────────────────────────────────

  if (brain) {
    if (typeof brain.getCalibrationScore === 'function') {
      const cal = safeCall(() => brain.getCalibrationScore(), null);
      if (cal !== null && Number.isFinite(cal)) {
        output += gauge('ff_brain_calibration_score', 'Brain calibration score (0-1)', Math.round(cal * 10000) / 10000);
      }
    }

    if (typeof brain.runEvolutionCycle === 'function') {
      // Read brain state file directly to avoid triggering an evolution cycle
      const brainState = safeCall(() => {
        const brainFile = path.join(PROJECT_ROOT, 'data', 'brain-state.json');
        if (!fs.existsSync(brainFile)) return null;
        return JSON.parse(fs.readFileSync(brainFile, 'utf8'));
      }, null);

      if (brainState) {
        output += gauge('ff_brain_generations_total', 'Total brain evolution generations', brainState.generation || 0);

        // Current streak
        const streak = brainState.streaks?.current || 0;
        output += gauge('ff_brain_streak_current', 'Current win/loss streak (positive=wins, negative=losses)', streak);

        // Evolved min confidence
        const minConf = safeCall(() => brain.getEvolvedMinConfidence(0.56), 0.56);
        output += gauge('ff_brain_min_confidence', 'Brain evolved minimum confidence threshold', Math.round(minConf * 10000) / 10000);

        // Per-indicator weights
        if (brainState.weights && typeof brainState.weights === 'object') {
          const weightEntries = Object.entries(brainState.weights)
            .filter(([, v]) => Number.isFinite(v))
            .map(([indicator, value]) => ({
              labels: { indicator },
              value: Math.round(value * 10000) / 10000,
            }));
          if (weightEntries.length > 0) {
            output += gaugeMulti('ff_brain_weight', 'Brain indicator weight', weightEntries);
          }
        }

        // Per-regime win rates
        if (brainState.regimeProfiles && typeof brainState.regimeProfiles === 'object') {
          const regimeEntries = Object.entries(brainState.regimeProfiles)
            .filter(([, p]) => p && (p.wins + p.losses) > 0)
            .map(([regime, profile]) => ({
              labels: { regime },
              value: Math.round((profile.wins / (profile.wins + profile.losses)) * 10000) / 100,
            }));
          if (regimeEntries.length > 0) {
            output += gaugeMulti('ff_brain_regime_win_rate_pct', 'Brain win rate by market regime', regimeEntries);
          }
        }
      }
    }
  }

  // ── ML Pipeline Metrics ────────────────────────────────────────────────────

  if (mlPipeline) {
    // Read ML model state for accuracy and training info
    const mlState = safeCall(() => {
      const mlModelFile = path.join(PROJECT_ROOT, 'data', 'ml-model.json');
      if (!fs.existsSync(mlModelFile)) return null;
      return JSON.parse(fs.readFileSync(mlModelFile, 'utf8'));
    }, null);

    if (mlState) {
      output += gauge('ff_ml_train_accuracy_pct', 'ML model training accuracy percentage', mlState.trainAccuracy || 0);
      output += gauge('ff_ml_val_accuracy_pct', 'ML model validation accuracy percentage', mlState.valAccuracy || 0);
      output += gauge('ff_ml_sample_count', 'ML model training sample count', mlState.sampleCount || 0);
      output += gauge('ff_ml_stump_count', 'ML model decision stump count', (mlState.stumps || []).length);

      // Feature importance as labeled metrics
      if (mlState.stumps && mlState.featureNames) {
        const importance = {};
        for (const s of mlState.stumps) {
          const name = mlState.featureNames[s.featureIdx] || ('feature_' + s.featureIdx);
          importance[name] = (importance[name] || 0) + 1;
        }
        const impEntries = Object.entries(importance).map(([name, count]) => ({
          labels: { feature: name },
          value: count,
        }));
        if (impEntries.length > 0) {
          output += gaugeMulti('ff_ml_feature_importance', 'ML model feature split count', impEntries);
        }
      }
    }

    // Feature store sample count
    const featureStoreSize = safeCall(() => {
      const storeFile = path.join(PROJECT_ROOT, 'data', 'ml-feature-store.json');
      if (!fs.existsSync(storeFile)) return -1;
      const raw = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
      return Array.isArray(raw.samples) ? raw.samples.length : -1;
    }, -1);

    if (featureStoreSize >= 0) {
      output += gauge('ff_ml_feature_store_samples', 'ML feature store total samples', featureStoreSize);
    }
  }

  // ── Edge-Case Mitigations Metrics ─────────────────────────────────────────

  if (edgeCaseMitigations) {
    // Recent triggered alerts
    if (typeof edgeCaseMitigations.getRecentAlerts === 'function') {
      const recentAlerts = safeCall(() => edgeCaseMitigations.getRecentAlerts({ maxAgeMs: 24 * 60 * 60 * 1000 }), []);
      output += gauge('ff_edge_case_alerts_24h', 'Edge-case alerts triggered in last 24h', recentAlerts.length);
      const critical24h = recentAlerts.filter(a => a.severity === 'critical' || a.severity === 'emergency').length;
      output += gauge('ff_edge_case_critical_alerts_24h', 'Critical edge-case alerts in last 24h', critical24h);
    }

    // Edge-case state: flash crash event count
    const ecState = safeCall(() => {
      const ecFile = path.join(PROJECT_ROOT, 'data', 'edge-case-state.json');
      if (!fs.existsSync(ecFile)) return null;
      return JSON.parse(fs.readFileSync(ecFile, 'utf8'));
    }, null);

    if (ecState) {
      output += gauge('ff_flash_crash_events_total', 'Total flash crash events detected', (ecState.flashCrashEvents || []).length);
      output += gauge('ff_runaway_loss_datapoints', 'Runaway loss history datapoints', (ecState.runawayLossHistory || []).length);
      output += gauge('ff_stale_price_sources', 'Number of tracked price sources', Object.keys(ecState.stalePriceCounters || {}).length);
    }
  }

  // ── Heartbeat Registry Metrics ────────────────────────────────────────────

  if (heartbeatRegistry && typeof heartbeatRegistry.checkAgentHealth === 'function') {
    const knownAgents = ['master-orchestrator', 'coinbase-spot-engine', 'kraken-spot-engine'];
    const agentHealth = safeCall(() => heartbeatRegistry.checkAgentHealth(knownAgents), null);
    if (agentHealth && agentHealth.agents) {
      const agentEntries = Object.entries(agentHealth.agents).map(([name, info]) => ({
        labels: { agent: name },
        value: info.alive ? 1 : 0,
      }));
      output += gaugeMulti('ff_agent_alive', 'Agent heartbeat alive status (1=alive, 0=dead)', agentEntries);

      const ageEntries = Object.entries(agentHealth.agents)
        .filter(([, info]) => info.lastSeen > 0)
        .map(([name, info]) => ({
          labels: { agent: name },
          value: Math.round((Date.now() - info.lastSeen) / 1000),
        }));
      if (ageEntries.length > 0) {
        output += gaugeMulti('ff_agent_heartbeat_age_seconds', 'Seconds since last agent heartbeat', ageEntries);
      }
    }
  }

  // ── Strategy Promoter Metrics ─────────────────────────────────────────────

  if (strategyPromoter && typeof strategyPromoter.getActiveStrategies === 'function') {
    const strategies = safeCall(() => strategyPromoter.getActiveStrategies(), []);
    output += gauge('ff_strategy_count', 'Total active strategies (LIVE_SMALL + LIVE_FULL)', strategies.length);

    // Count by stage
    const stageCounts = {};
    for (const s of strategies) {
      const stage = s.status || s.stage || 'unknown';
      stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    }
    const stageEntries = Object.entries(stageCounts).map(([stage, count]) => ({
      labels: { stage },
      value: count,
    }));
    if (stageEntries.length > 0) {
      output += gaugeMulti('ff_strategy_by_stage', 'Strategies by promotion stage', stageEntries);
    }

    // Per-strategy performance metrics (win rate, Sharpe, trades)
    for (const s of strategies) {
      const name = s.name || 'unnamed';
      const perf = s.performance || {};
      if (perf.winRate != null) {
        output += gauge('ff_strategy_win_rate_pct', 'Promoted strategy win rate', perf.winRate, { strategy: name });
      }
      if (perf.sharpe != null) {
        output += gauge('ff_strategy_sharpe', 'Promoted strategy Sharpe ratio', perf.sharpe, { strategy: name });
      }
      if (perf.trades != null) {
        output += gauge('ff_strategy_trades', 'Promoted strategy trade count', perf.trades, { strategy: name });
      }
      // Stage as numeric: LIVE_SMALL=1, LIVE_FULL=2
      const stageNum = s.status === 'LIVE_FULL' ? 2 : s.status === 'LIVE_SMALL' ? 1 : 0;
      output += gauge('ff_strategy_stage_numeric', 'Promoted strategy stage (1=LIVE_SMALL, 2=LIVE_FULL)', stageNum, { strategy: name });
    }
  }

  // ── Backtest Drift Metrics ──────────────────────────────────────────────

  const driftData = safeCall(() => {
    const driftFile = path.join(PROJECT_ROOT, 'data', 'backtest-drift.json');
    if (!fs.existsSync(driftFile)) return null;
    return JSON.parse(fs.readFileSync(driftFile, 'utf8'));
  }, null);

  if (driftData) {
    if (Number.isFinite(driftData.driftRatio)) {
      output += gauge('ff_backtest_drift_ratio', 'Live vs backtest performance deviation ratio', driftData.driftRatio);
    }
    if (Number.isFinite(driftData.liveSharpe)) {
      output += gauge('ff_live_sharpe_ratio', 'Current live Sharpe ratio (30d)', driftData.liveSharpe);
    }
    if (Number.isFinite(driftData.backtestSharpe)) {
      output += gauge('ff_backtest_sharpe_ratio', 'Backtest baseline Sharpe ratio', driftData.backtestSharpe);
    }
  }

  // ── Per-Signal-Type Age Metrics ─────────────────────────────────────────

  if (signalBus && typeof signalBus.summary === 'function') {
    const busSummary2 = safeCall(() => signalBus.summary(), null);
    if (busSummary2 && busSummary2.types && typeof busSummary2.types === 'object') {
      const ageEntries = [];
      for (const [type, info] of Object.entries(busSummary2.types)) {
        // Find newest signal of this type
        const signals = safeCall(() => signalBus.query({ type, maxAgeMs: 24 * 60 * 60 * 1000 }), []);
        if (signals.length > 0) {
          const newestTs = signals[0].publishedAt || 0;
          if (newestTs > 0) {
            ageEntries.push({
              labels: { signal_type: type },
              value: Math.round((Date.now() - newestTs) / 1000),
            });
          }
        }
      }
      if (ageEntries.length > 0) {
        output += gaugeMulti('ff_signal_age_seconds', 'Age of newest signal by type in seconds', ageEntries);
      }
    }
  }

  // ── ML Model Staleness ────────────────────────────────────────────────────

  const mlModelAge = safeCall(() => {
    const mlStateFile = path.join(PROJECT_ROOT, 'data', 'ml-pipeline-state.json');
    if (!fs.existsSync(mlStateFile)) return -1;
    const raw = JSON.parse(fs.readFileSync(mlStateFile, 'utf8'));
    const lastTrained = raw.lastTrainedAt || raw.updatedAt || 0;
    const ts = typeof lastTrained === 'string' ? new Date(lastTrained).getTime() : lastTrained;
    if (ts <= 0) return -1;
    return Math.round((Date.now() - ts) / 1000);
  }, -1);

  if (mlModelAge >= 0) {
    output += gauge('ff_ml_model_age_seconds', 'Seconds since ML model was last retrained', mlModelAge);
  }

  // ── State File Integrity ──────────────────────────────────────────────────

  const stateFileCorrupted = safeCall(() => {
    const criticalFiles = [
      'data/risk-manager-state.json',
      'data/capital-mandate-state.json',
      'data/trade-journal.json',
    ];
    for (const relPath of criticalFiles) {
      const absPath = path.join(PROJECT_ROOT, relPath);
      if (!fs.existsSync(absPath)) continue; // Missing is OK (may not be created yet)
      try {
        JSON.parse(fs.readFileSync(absPath, 'utf8'));
      } catch {
        return 1; // Corrupted
      }
    }
    return 0;
  }, 0);

  output += gauge('ff_state_file_corrupted', 'State file corruption detected (1=corrupted, 0=ok)', stateFileCorrupted);

  // ── DeFi Health Factor ────────────────────────────────────────────────────

  const defiHealth = safeCall(() => {
    const defiStateFile = path.join(PROJECT_ROOT, 'data', 'defi-yield-state.json');
    if (!fs.existsSync(defiStateFile)) return -1;
    const raw = JSON.parse(fs.readFileSync(defiStateFile, 'utf8'));
    return raw.healthFactor || raw.health_factor || -1;
  }, -1);

  if (defiHealth >= 0) {
    output += gauge('ff_defi_health_factor', 'DeFi yield position health factor', defiHealth);
  }

  // ── Market Open (crypto is always open) ───────────────────────────────────

  output += gauge('ff_market_open', 'Whether the market is open (1=open, 0=closed; crypto is always 1)', 1);

  // ── Infrastructure Metrics ────────────────────────────────────────────────

  // CPU
  output += gauge('ff_cpu_usage_pct', 'VM CPU usage percentage', cpuUsagePct);

  // Memory
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPct = totalMem > 0 ? Math.round((usedMem / totalMem) * 10000) / 100 : 0;

  output += gauge('ff_memory_usage_pct', 'VM memory usage percentage', memPct);
  output += gauge('ff_memory_total_bytes', 'VM total memory in bytes', totalMem);
  output += gauge('ff_memory_used_bytes', 'VM used memory in bytes', usedMem);
  output += gauge('ff_memory_free_bytes', 'VM free memory in bytes', freeMem);

  // Disk
  const diskPct = getDiskUsagePct();
  if (diskPct >= 0) {
    output += gauge('ff_disk_usage_pct', 'Disk usage percentage', diskPct);
  }

  // Watchdog
  const watchdog = isWatchdogRunning();
  output += gauge('ff_watchdog_running', 'Watchdog daemon running (1=yes, 0=no)', watchdog);

  // Process restarts (read from watchdog state if available)
  const processRestarts = safeCall(() => {
    const watchdogStateFile = path.join(PROJECT_ROOT, 'data', 'watchdog-state.json');
    if (!fs.existsSync(watchdogStateFile)) return -1;
    const raw = JSON.parse(fs.readFileSync(watchdogStateFile, 'utf8'));
    return raw.restartsLastHour || raw.restarts_1h || -1;
  }, -1);

  if (processRestarts >= 0) {
    output += gauge('ff_process_restarts_1h', 'Process restarts in the last hour', processRestarts);
  }

  // ── Node.js Process Metrics ───────────────────────────────────────────────

  output += gauge('ff_process_uptime_seconds', 'Process uptime in seconds', Math.round(process.uptime()));

  const mem = process.memoryUsage();
  output += gaugeMulti('ff_node_memory_bytes', 'Node.js memory usage in bytes', [
    { labels: { type: 'rss' }, value: mem.rss },
    { labels: { type: 'heap_total' }, value: mem.heapTotal },
    { labels: { type: 'heap_used' }, value: mem.heapUsed },
    { labels: { type: 'external' }, value: mem.external },
    { labels: { type: 'array_buffers' }, value: mem.arrayBuffers || 0 },
  ]);

  output += gauge('ff_nodejs_version', 'Node.js major version number', parseInt(process.versions.node, 10));

  // ── Exporter Meta ─────────────────────────────────────────────────────────

  output += gauge('ff_exporter_last_refresh_epoch', 'Epoch timestamp of last metrics refresh', Math.round(Date.now() / 1000));
  output += gauge('ff_exporter_refresh_duration_ms', 'Duration of last metrics collection in ms', 0); // Will be filled below

  return output;
}

// ── Refresh Loop ────────────────────────────────────────────────────────────

function refreshMetrics() {
  try {
    const start = Date.now();
    let output = collectMetrics();
    const duration = Date.now() - start;

    // Patch the refresh duration into the output
    output = output.replace(
      'ff_exporter_refresh_duration_ms 0',
      `ff_exporter_refresh_duration_ms ${duration}`
    );

    cachedMetrics = output;
    lastRefresh = Date.now();
  } catch (err) {
    console.error(`[metrics-exporter] Error collecting metrics: ${err.message}`);
    // Keep serving the last known good metrics if available
  }
}

// Initial collection
refreshMetrics();

// Periodic refresh
const refreshTimer = setInterval(refreshMetrics, REFRESH_INTERVAL_MS);
refreshTimer.unref(); // Don't prevent process exit

// ── HTTP Server ─────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/metrics') {
    res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(cachedMetrics);
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    const age = Date.now() - lastRefresh;
    const healthy = age < REFRESH_INTERVAL_MS * 3; // Allow up to 3 missed refreshes
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: healthy ? 'ok' : 'stale',
      lastRefresh: new Date(lastRefresh).toISOString(),
      ageMs: age,
      uptime: Math.round(process.uptime()),
    }));
    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found. Endpoints: GET /metrics, GET /health\n');
});

server.listen(METRICS_PORT, '0.0.0.0', () => {
  console.log(`[metrics-exporter] Prometheus metrics server listening on http://0.0.0.0:${METRICS_PORT}/metrics`);
  console.log(`[metrics-exporter] Refresh interval: ${REFRESH_INTERVAL_MS / 1000}s`);
});

// ── Graceful Shutdown ───────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`[metrics-exporter] Received ${signal}, shutting down...`);
  clearInterval(refreshTimer);
  server.close(() => {
    console.log('[metrics-exporter] Server closed.');
    process.exit(0);
  });
  // Force exit after 5 seconds if server doesn't close gracefully
  setTimeout(() => {
    console.error('[metrics-exporter] Forced exit after timeout.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
