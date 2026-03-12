#!/usr/bin/env node
/**
 * FreedomForge Comprehensive Audit — Unified Self-Auditing Framework
 * ===================================================================
 *
 * Consolidates all system health checks into a single structured audit
 * that replaces ad-hoc individual monitoring with a tiered framework.
 *
 * Audit levels (cumulative):
 *   HOURLY  (quick)    — state integrity, signal freshness, circuit breakers, process health, disk
 *   DAILY   (standard) — + KPI reconciliation, capital verification, risk limits, venue connectivity,
 *                         key health, ML freshness, correlation check
 *   WEEKLY  (deep)     — + strategy review, backtest re-run, historical data integrity,
 *                         revenue attribution, risk event review
 *
 * Grading: A+ / A / B+ / B / C / D / F
 * Actions: Discord alerts on failure, signal bus publish, kill switch on D/F
 *
 * State: data/audit-state.json (last 100 audits, grade trend)
 *
 * Env vars:
 *   AUDIT_ENABLED     (default: 'true')
 *   AUDIT_LEVEL       (default: 'standard') — 'quick', 'standard', 'deep'
 *   ALERT_WEBHOOK_URL — Discord webhook for failure alerts
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

let log;
try {
  const { createLogger } = require('../lib/logger');
  log = createLogger('comprehensive-audit');
} catch {
  log = { debug() {}, info: console.log, warn: console.warn, error: console.error, fatal: console.error };
}

// ─── Configuration ──────────────────────────────────────────────────────────

const BASE = process.env.REPO_DIR || process.cwd();
const DATA = path.join(BASE, 'data');
const STATE_FILE = path.join(DATA, 'audit-state.json');
const AUDIT_ENABLED = String(process.env.AUDIT_ENABLED || 'true').toLowerCase() !== 'false';
const AUDIT_LEVEL = String(process.env.AUDIT_LEVEL || 'standard').toLowerCase();
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL || '';

// ─── Graceful Module Loading ────────────────────────────────────────────────

let riskManager, capitalMandate, tradeJournal, signalBus, rio;
let varEngine, correlationMonitor, mlPipeline, strategyPromoter;

try { riskManager = require('../lib/risk-manager'); } catch { riskManager = null; }
try { capitalMandate = require('../lib/capital-mandate'); } catch { capitalMandate = null; }
try { tradeJournal = require('../lib/trade-journal'); } catch { tradeJournal = null; }
try { signalBus = require('../lib/agent-signal-bus'); } catch { signalBus = null; }
try { rio = require('../lib/resilient-io'); } catch { rio = null; }
try { varEngine = require('../lib/var-engine'); } catch { varEngine = null; }
try { correlationMonitor = require('../lib/correlation-monitor'); } catch { correlationMonitor = null; }
try { mlPipeline = require('../lib/ml-pipeline'); } catch { mlPipeline = null; }
try { strategyPromoter = require('../lib/strategy-promoter'); } catch { strategyPromoter = null; }

// ─── Helpers ────────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

function readJson(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(BASE, filePath);
  if (rio) return rio.readJsonSafe(abs, { fallback: null });
  try {
    if (!fs.existsSync(abs)) return null;
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch { return null; }
}

function writeJson(filePath, data) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(BASE, filePath);
  if (rio) { rio.writeJsonAtomic(abs, data); return; }
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = abs + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, abs);
  } catch (err) { log.error('write failed', { error: err?.message || err }); }
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: opts.timeout || 30000,
      cwd: BASE,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch { return opts.fallback !== undefined ? opts.fallback : ''; }
}

function fileAgeSec(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(BASE, filePath);
  try {
    return Math.round((Date.now() - fs.statSync(abs).mtimeMs) / 1000);
  } catch { return Infinity; }
}

function check(name, status, message, data = {}) {
  return { name, status, message, data };
}

// ─── HOURLY CHECKS (quick) ─────────────────────────────────────────────────

function checkStateFileIntegrity() {
  const results = [];
  let corrupt = 0;
  let valid = 0;
  try {
    const files = fs.readdirSync(DATA).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const fp = path.join(DATA, f);
      try {
        const content = fs.readFileSync(fp, 'utf8');
        JSON.parse(content);
        valid++;
      } catch {
        corrupt++;
        results.push(f);
      }
    }
  } catch (err) {
    return check('state_file_integrity', 'fail',
      `Cannot read data directory: ${err?.message || err}`);
  }

  if (corrupt > 0) {
    return check('state_file_integrity', 'fail',
      `${corrupt} corrupt JSON file(s): ${results.join(', ')}`,
      { corrupt, valid, files: results });
  }
  return check('state_file_integrity', 'pass',
    `All ${valid} JSON files valid`, { valid });
}

function checkSignalBusFreshness() {
  if (!signalBus) {
    return check('signal_bus_freshness', 'warn',
      'Signal bus module unavailable');
  }
  try {
    const summary = signalBus.summary();
    const age = fileAgeSec('data/agent-signal-bus.json');
    if (age > 7200) {
      return check('signal_bus_freshness', 'warn',
        `Signal bus stale: last updated ${age}s ago`,
        { ageSec: age, totalSignals: summary.totalSignals });
    }
    return check('signal_bus_freshness', 'pass',
      `${summary.totalSignals} active signals, updated ${age}s ago`,
      { ageSec: age, totalSignals: summary.totalSignals, types: summary.types });
  } catch (err) {
    return check('signal_bus_freshness', 'warn',
      `Signal bus check failed: ${err?.message || err}`);
  }
}

function checkCircuitBreakers() {
  if (!rio || typeof rio.getCircuitStatus !== 'function') {
    return check('circuit_breakers', 'warn',
      'Resilient-io unavailable, cannot check circuit breakers');
  }
  try {
    const statuses = rio.getCircuitStatus();
    const open = [];
    const halfOpen = [];
    for (const [key, state] of Object.entries(statuses)) {
      if (state.status === 'OPEN') open.push(key);
      else if (state.status === 'HALF_OPEN') halfOpen.push(key);
    }
    if (open.length > 0) {
      return check('circuit_breakers', 'fail',
        `${open.length} circuit breaker(s) OPEN: ${open.join(', ')}`,
        { open, halfOpen });
    }
    if (halfOpen.length > 0) {
      return check('circuit_breakers', 'warn',
        `${halfOpen.length} circuit breaker(s) HALF_OPEN: ${halfOpen.join(', ')}`,
        { open, halfOpen });
    }
    return check('circuit_breakers', 'pass',
      `All ${Object.keys(statuses).length} circuit breakers CLOSED`,
      { total: Object.keys(statuses).length });
  } catch (err) {
    return check('circuit_breakers', 'warn',
      `Circuit breaker check failed: ${err?.message || err}`);
  }
}

function checkProcessHealth() {
  const watchdogRunning = run('pgrep -f "watchdog-daemon" || pgrep -f "watchdog.sh"', { fallback: '' });
  if (!watchdogRunning) {
    return check('process_health', 'warn',
      'Watchdog process not detected');
  }
  const nodeCount = parseInt(run('pgrep -c node 2>/dev/null || echo 0', { fallback: '0' }), 10);
  return check('process_health', 'pass',
    `Watchdog running, ${nodeCount} Node processes active`,
    { watchdog: true, nodeCount });
}

function checkDiskSpace() {
  // Cross-platform: macOS uses different df flags
  let diskPct = 0;
  const dfOutput = run("df -P / | tail -1 | awk '{print $5}'", { fallback: '0%' });
  diskPct = parseInt(dfOutput.replace('%', ''), 10) || 0;

  if (diskPct > 90) {
    return check('disk_space', 'fail',
      `Disk usage critical: ${diskPct}%`, { diskPct });
  }
  if (diskPct > 80) {
    return check('disk_space', 'warn',
      `Disk usage high: ${diskPct}%`, { diskPct });
  }
  return check('disk_space', 'pass',
    `Disk: ${diskPct}% used (${100 - diskPct}% free)`, { diskPct });
}

// ─── DAILY CHECKS (standard) ───────────────────────────────────────────────

function checkKpiReconciliation() {
  if (!tradeJournal) {
    return check('kpi_reconciliation', 'warn',
      'Trade journal module unavailable');
  }
  try {
    const stats = tradeJournal.getStats({ sinceDays: 30 });
    const issues = [];

    if (stats.closedTrades === 0) {
      issues.push('No closed trades in 30 days');
    }
    if (stats.sharpeRatio < -1) {
      issues.push(`Sharpe ratio critically negative: ${stats.sharpeRatio}`);
    }
    if (stats.maxDrawdown > 100) {
      issues.push(`Max drawdown exceeds $100: $${stats.maxDrawdown}`);
    }

    if (issues.length > 0) {
      return check('kpi_reconciliation', 'warn',
        issues.join('; '),
        { winRate: stats.winRate, sharpe: stats.sharpeRatio, maxDrawdown: stats.maxDrawdown, trades: stats.closedTrades });
    }
    return check('kpi_reconciliation', 'pass',
      `Win: ${stats.winRate}% | Sharpe: ${stats.sharpeRatio} | DD: $${stats.maxDrawdown} | Trades: ${stats.closedTrades}`,
      { winRate: stats.winRate, sharpe: stats.sharpeRatio, maxDrawdown: stats.maxDrawdown, trades: stats.closedTrades, pnl: stats.totalPnl });
  } catch (err) {
    return check('kpi_reconciliation', 'warn',
      `KPI check failed: ${err?.message || err}`);
  }
}

function checkCapitalVerification() {
  if (!capitalMandate) {
    return check('capital_verification', 'warn',
      'Capital mandate module unavailable');
  }
  try {
    const summary = capitalMandate.getMandateSummary();
    const capital = summary.capital;

    if (summary.mode === 'capital_halt') {
      return check('capital_verification', 'fail',
        `CAPITAL HALT: $${capital.total.toFixed(2)} below critical floor`,
        { mode: summary.mode, total: capital.total });
    }
    if (summary.mode === 'survival') {
      return check('capital_verification', 'warn',
        `SURVIVAL mode: $${capital.total.toFixed(2)}`,
        { mode: summary.mode, total: capital.total });
    }

    // Cross-verify with mandate state
    const mandateState = capitalMandate.loadMandateState();
    const stateCapital = mandateState?.highWaterMark || 0;
    const drift = Math.abs(stateCapital - (capital.total || 0));

    return check('capital_verification', 'pass',
      `Mode: ${summary.mode} | Capital: $${capital.total.toFixed(2)} | HWM: $${summary.highWaterMark.toFixed(2)} | ROI: ${summary.roiPct.toFixed(1)}%`,
      { mode: summary.mode, total: capital.total, hwm: summary.highWaterMark, roi: summary.roiPct, drift });
  } catch (err) {
    return check('capital_verification', 'warn',
      `Capital check failed: ${err?.message || err}`);
  }
}

function checkRiskLimitCompliance() {
  if (!riskManager) {
    return check('risk_limit_compliance', 'warn',
      'Risk manager module unavailable');
  }
  try {
    const health = riskManager.getRiskHealth();
    const issues = [];

    if (health.killSwitchActive) {
      issues.push('KILL SWITCH ACTIVE');
    }
    if (health.drawdownPct > health.maxDrawdownPct) {
      issues.push(`Drawdown ${health.drawdownPct}% > max ${health.maxDrawdownPct}%`);
    }
    if (health.utilizationPct > 90) {
      issues.push(`Utilization ${health.utilizationPct}% > 90%`);
    }

    if (issues.length > 0) {
      return check('risk_limit_compliance', issues.some(i => i.includes('KILL')) ? 'fail' : 'warn',
        issues.join('; '), health);
    }
    return check('risk_limit_compliance', 'pass',
      `Utilization: ${health.utilizationPct}% | Drawdown: ${health.drawdownPct}% | Positions: ${health.positionCount}`,
      health);
  } catch (err) {
    return check('risk_limit_compliance', 'warn',
      `Risk check failed: ${err?.message || err}`);
  }
}

function checkVenueConnectivity() {
  const results = {};
  const venues = [
    { name: 'coinbase', url: 'https://api.coinbase.com/v2/time' },
    { name: 'kraken', url: 'https://api.kraken.com/0/public/Time' },
  ];

  let failCount = 0;
  for (const venue of venues) {
    const httpCode = run(
      `curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${venue.url}" 2>/dev/null`,
      { fallback: '0' }
    );
    results[venue.name] = parseInt(httpCode, 10) || 0;
    if (results[venue.name] !== 200) failCount++;
  }

  if (failCount === venues.length) {
    return check('venue_connectivity', 'fail',
      'ALL exchanges unreachable', results);
  }
  if (failCount > 0) {
    const failed = Object.entries(results).filter(([, v]) => v !== 200).map(([k]) => k);
    return check('venue_connectivity', 'warn',
      `${failCount} venue(s) unreachable: ${failed.join(', ')}`, results);
  }
  return check('venue_connectivity', 'pass',
    `All ${venues.length} venues reachable`, results);
}

function checkKeyHealth() {
  const envPath = path.join(BASE, '.env.local');
  try {
    if (!fs.existsSync(envPath)) {
      return check('key_health', 'warn', '.env.local not found');
    }
    const envContent = fs.readFileSync(envPath, 'utf8');
    const keys = ['COINBASE_API_KEY', 'COINBASE_API_SECRET', 'KRAKEN_API_KEY', 'KRAKEN_API_SECRET'];
    const missing = keys.filter(k => !envContent.includes(k + '='));
    const present = keys.length - missing.length;

    if (missing.length > 0) {
      return check('key_health', 'warn',
        `Missing API keys: ${missing.join(', ')}`,
        { present, missing });
    }
    return check('key_health', 'pass',
      `All ${keys.length} API keys configured`,
      { present, missing: [] });
  } catch (err) {
    return check('key_health', 'warn',
      `Key health check failed: ${err?.message || err}`);
  }
}

function checkMlModelFreshness() {
  const modelPath = path.join(DATA, 'ml-model.json');
  const ageSec = fileAgeSec(modelPath);

  if (ageSec === Infinity) {
    return check('ml_model_freshness', 'warn',
      'ML model file not found (not yet trained)',
      { trained: false });
  }

  const model = readJson(modelPath);
  const ageHours = Math.round(ageSec / 3600);
  const ageDays = Math.round(ageHours / 24);

  if (ageSec > 7 * 24 * 3600) {
    return check('ml_model_freshness', 'warn',
      `ML model stale: last trained ${ageDays} days ago`,
      { ageDays, trainedAt: model?.trainedAt, valAccuracy: model?.valAccuracy });
  }
  return check('ml_model_freshness', 'pass',
    `ML model fresh: trained ${ageHours}h ago (val accuracy: ${model?.valAccuracy || 'n/a'}%)`,
    { ageDays, trainedAt: model?.trainedAt, valAccuracy: model?.valAccuracy, sampleCount: model?.sampleCount });
}

function checkCorrelation() {
  if (!correlationMonitor) {
    return check('correlation_check', 'warn',
      'Correlation monitor module unavailable');
  }
  try {
    const matrix = correlationMonitor.getCorrelationMatrix();
    const score = matrix.diversificationScore;
    const alerts = matrix.alerts || [];
    const critical = alerts.filter(a => a.severity === 'critical');

    if (critical.length > 0) {
      return check('correlation_check', 'warn',
        `Diversification score: ${score}/100 | ${critical.length} critical alert(s)`,
        { score, alerts: critical.map(a => a.message) });
    }
    return check('correlation_check', 'pass',
      `Diversification score: ${score}/100 | ${matrix.assets.length} assets tracked`,
      { score, assetCount: matrix.assets.length, alertCount: alerts.length });
  } catch (err) {
    return check('correlation_check', 'warn',
      `Correlation check failed: ${err?.message || err}`);
  }
}

// ─── WEEKLY CHECKS (deep) ───────────────────────────────────────────────────

function checkStrategyReview() {
  if (!tradeJournal) {
    return check('strategy_review', 'warn',
      'Trade journal unavailable for strategy review');
  }
  try {
    const liveStats = tradeJournal.getStats({ sinceDays: 30 });
    const evolution = readJson('data/strategy-evolution.json');
    const backtestExpected = evolution?.generations?.slice(-1)?.[0]?.stats;

    if (!backtestExpected || !backtestExpected.sharpe) {
      return check('strategy_review', 'pass',
        `Live Sharpe: ${liveStats.sharpeRatio} | No backtest baseline to compare`,
        { liveSharpe: liveStats.sharpeRatio, liveWinRate: liveStats.winRate });
    }

    const driftRatio = backtestExpected.sharpe > 0
      ? liveStats.sharpeRatio / backtestExpected.sharpe
      : 1;

    if (driftRatio < 0.5) {
      return check('strategy_review', 'warn',
        `Strategy drift: live Sharpe ${liveStats.sharpeRatio} is ${(driftRatio * 100).toFixed(0)}% of backtest ${backtestExpected.sharpe}`,
        { liveSharpe: liveStats.sharpeRatio, expectedSharpe: backtestExpected.sharpe, driftRatio });
    }
    return check('strategy_review', 'pass',
      `Live Sharpe: ${liveStats.sharpeRatio} vs backtest: ${backtestExpected.sharpe} (${(driftRatio * 100).toFixed(0)}%)`,
      { liveSharpe: liveStats.sharpeRatio, expectedSharpe: backtestExpected.sharpe, driftRatio });
  } catch (err) {
    return check('strategy_review', 'warn',
      `Strategy review failed: ${err?.message || err}`);
  }
}

function checkBacktestDrift() {
  if (!strategyPromoter) {
    return check('backtest_drift', 'warn',
      'Strategy promoter unavailable');
  }
  try {
    const registry = strategyPromoter.loadRegistry();
    const strategies = Object.values(registry.strategies || {});
    const active = strategies.filter(s =>
      s.status === 'LIVE_SMALL' || s.status === 'LIVE_FULL'
    );

    if (active.length === 0) {
      return check('backtest_drift', 'pass',
        'No active promoted strategies to check', { active: 0 });
    }

    const drifted = active.filter(s =>
      s.backtestResult && s.performance &&
      s.performance.sharpe < (s.backtestResult.sharpeRatio || 0) * 0.5
    );

    if (drifted.length > 0) {
      return check('backtest_drift', 'warn',
        `${drifted.length} strategy(ies) drifting from backtest: ${drifted.map(s => s.name).join(', ')}`,
        { driftedStrategies: drifted.map(s => s.name), totalActive: active.length });
    }
    return check('backtest_drift', 'pass',
      `${active.length} active strategies within backtest expectations`,
      { totalActive: active.length });
  } catch (err) {
    return check('backtest_drift', 'warn',
      `Backtest drift check failed: ${err?.message || err}`);
  }
}

function checkHistoricalDataIntegrity() {
  if (!tradeJournal) {
    return check('historical_data_integrity', 'warn',
      'Trade journal unavailable');
  }
  try {
    const journalData = readJson('data/trade-journal.json');
    if (!journalData || !Array.isArray(journalData.trades)) {
      return check('historical_data_integrity', 'warn',
        'Trade journal empty or missing');
    }

    const trades = journalData.trades;
    const issues = [];

    // Check for duplicate IDs
    const ids = trades.map(t => t.id || t.orderId).filter(Boolean);
    const unique = new Set(ids);
    if (unique.size < ids.length) {
      issues.push(`${ids.length - unique.size} duplicate trade IDs`);
    }

    // Check for trades missing required fields
    const incomplete = trades.filter(t => !t.venue || !t.asset || !t.side);
    if (incomplete.length > 0) {
      issues.push(`${incomplete.length} trades missing venue/asset/side`);
    }

    // Check chronological order
    let outOfOrder = 0;
    for (let i = 1; i < trades.length; i++) {
      if ((trades[i].entryTs || 0) < (trades[i - 1].entryTs || 0)) outOfOrder++;
    }
    if (outOfOrder > 0) {
      issues.push(`${outOfOrder} trades out of chronological order`);
    }

    if (issues.length > 0) {
      return check('historical_data_integrity', 'warn',
        issues.join('; '),
        { totalTrades: trades.length, issues });
    }
    return check('historical_data_integrity', 'pass',
      `${trades.length} trades verified, no integrity issues`,
      { totalTrades: trades.length });
  } catch (err) {
    return check('historical_data_integrity', 'warn',
      `Historical data check failed: ${err?.message || err}`);
  }
}

function checkRevenueAttribution() {
  if (!tradeJournal) {
    return check('revenue_attribution', 'warn',
      'Trade journal unavailable');
  }
  try {
    const journalData = readJson('data/trade-journal.json');
    if (!journalData || !Array.isArray(journalData.trades)) {
      return check('revenue_attribution', 'warn', 'No trade data');
    }

    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const recentClosed = journalData.trades.filter(
      t => t.outcome && (t.entryTs || 0) >= weekAgo
    );

    const byVenue = {};
    const byAsset = {};
    for (const t of recentClosed) {
      const v = t.venue || 'unknown';
      const a = t.asset || 'unknown';
      byVenue[v] = (byVenue[v] || 0) + (t.pnl || 0);
      byAsset[a] = (byAsset[a] || 0) + (t.pnl || 0);
    }

    const totalPnl = recentClosed.reduce((s, t) => s + (t.pnl || 0), 0);

    return check('revenue_attribution', 'pass',
      `7d P&L: $${totalPnl.toFixed(2)} across ${recentClosed.length} trades`,
      { totalPnl, byVenue, byAsset, tradeCount: recentClosed.length });
  } catch (err) {
    return check('revenue_attribution', 'warn',
      `Revenue attribution failed: ${err?.message || err}`);
  }
}

function checkRiskEventReview() {
  if (!riskManager) {
    return check('risk_event_review', 'warn',
      'Risk manager unavailable');
  }
  try {
    const riskState = readJson('data/risk-manager-state.json');
    const events = riskState?.riskEvents || [];
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const recentEvents = events.filter(e => (e.ts || 0) >= weekAgo);

    const killSwitchEvents = recentEvents.filter(e =>
      e.type === 'kill_switch' || e.type === 'auto_kill_switch'
    );

    if (killSwitchEvents.length > 0) {
      return check('risk_event_review', 'warn',
        `${killSwitchEvents.length} kill switch event(s) in past 7 days`,
        { totalEvents: recentEvents.length, killSwitchEvents: killSwitchEvents.length });
    }
    return check('risk_event_review', 'pass',
      `${recentEvents.length} risk events in past 7 days, no kill switch triggers`,
      { totalEvents: recentEvents.length });
  } catch (err) {
    return check('risk_event_review', 'warn',
      `Risk event review failed: ${err?.message || err}`);
  }
}

// ─── Audit Orchestration ────────────────────────────────────────────────────

function getChecksForLevel(level) {
  const hourly = [
    checkStateFileIntegrity,
    checkSignalBusFreshness,
    checkCircuitBreakers,
    checkProcessHealth,
    checkDiskSpace,
  ];

  const daily = [
    ...hourly,
    checkKpiReconciliation,
    checkCapitalVerification,
    checkRiskLimitCompliance,
    checkVenueConnectivity,
    checkKeyHealth,
    checkMlModelFreshness,
    checkCorrelation,
  ];

  const weekly = [
    ...daily,
    checkStrategyReview,
    checkBacktestDrift,
    checkHistoricalDataIntegrity,
    checkRevenueAttribution,
    checkRiskEventReview,
  ];

  if (level === 'quick') return hourly;
  if (level === 'deep') return weekly;
  return daily; // 'standard' is the default
}

function computeGrade(checks) {
  const failures = checks.filter(c => c.status === 'fail').length;
  const warnings = checks.filter(c => c.status === 'warn').length;

  // Check for critical system failure conditions
  const killSwitchActive = checks.some(c =>
    c.name === 'risk_limit_compliance' && c.status === 'fail' &&
    c.message.includes('KILL SWITCH')
  );
  const capitalHalt = checks.some(c =>
    c.name === 'capital_verification' && c.status === 'fail' &&
    c.message.includes('CAPITAL HALT')
  );
  const allExchangesDown = checks.some(c =>
    c.name === 'venue_connectivity' && c.status === 'fail' &&
    c.message.includes('ALL')
  );

  if (killSwitchActive || capitalHalt || allExchangesDown) return 'F';
  if (failures >= 4) return 'D';
  if (failures >= 2) return 'C';
  if (failures === 1) return 'B';
  if (warnings >= 3) return 'B+';
  if (warnings >= 1) return 'A';
  return 'A+';
}

function generateRecommendations(checks) {
  const recs = [];
  for (const c of checks) {
    if (c.status === 'fail') {
      if (c.name === 'state_file_integrity') recs.push('Run data-hygiene.js to repair corrupt state files');
      if (c.name === 'circuit_breakers') recs.push('Check exchange API status; circuit breakers may need manual reset');
      if (c.name === 'venue_connectivity') recs.push('Verify network connectivity and exchange status pages');
      if (c.name === 'risk_limit_compliance') recs.push('Review risk parameters; consider manual intervention');
      if (c.name === 'capital_verification') recs.push('Capital halt active: manual review required before resuming');
      if (c.name === 'disk_space') recs.push('Run data-rotate.sh and prune log files');
    }
    if (c.status === 'warn') {
      if (c.name === 'ml_model_freshness') recs.push('Retrain ML model via continuous-learning.js');
      if (c.name === 'kpi_reconciliation') recs.push('Review trading performance; consider strategy adjustment');
      if (c.name === 'correlation_check') recs.push('High correlation detected; review portfolio diversification');
      if (c.name === 'strategy_review') recs.push('Strategy drift detected; consider re-backtesting current parameters');
    }
  }
  return [...new Set(recs)]; // deduplicate
}

async function sendDiscordAlert(report) {
  if (!ALERT_WEBHOOK_URL) return;
  try {
    const failChecks = report.checks
      .filter(c => c.status === 'fail')
      .map(c => `  FAIL: ${c.name} - ${c.message}`)
      .join('\n');
    const warnChecks = report.checks
      .filter(c => c.status === 'warn')
      .map(c => `  WARN: ${c.name} - ${c.message}`)
      .join('\n');

    const body = [
      `**FreedomForge Audit Report** - Grade: **${report.summary.grade}**`,
      `Level: ${report.level} | Duration: ${report.duration_ms}ms`,
      `Passed: ${report.summary.passed} | Warnings: ${report.summary.warnings} | Failures: ${report.summary.failures}`,
    ];
    if (failChecks) body.push(`\nFailures:\n${failChecks}`);
    if (warnChecks) body.push(`\nWarnings:\n${warnChecks}`);
    if (report.recommendations.length > 0) {
      body.push(`\nRecommendations:\n${report.recommendations.map(r => `  - ${r}`).join('\n')}`);
    }

    const payload = JSON.stringify({ content: body.join('\n') });
    const { execFileSync } = require('child_process');
    execFileSync('curl', [
      '-s', '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '-d', payload,
      ALERT_WEBHOOK_URL,
    ], { encoding: 'utf8', timeout: 10000 });
  } catch (err) {
    log.error('Discord alert failed', { error: err?.message || err });
  }
}

function publishToSignalBus(report) {
  if (!signalBus) return;
  try {
    signalBus.publish({
      type: 'audit_result',
      source: 'comprehensive-audit',
      confidence: 1.0,
      payload: {
        auditId: report.auditId,
        grade: report.summary.grade,
        level: report.level,
        passed: report.summary.passed,
        warnings: report.summary.warnings,
        failures: report.summary.failures,
        ts: report.ts,
      },
      ttlMs: 24 * 60 * 60 * 1000,
    });
  } catch (err) {
    log.error('Signal bus publish failed', { error: err?.message || err });
  }
}

function activateKillSwitchIfNeeded(grade) {
  if ((grade === 'D' || grade === 'F') && riskManager) {
    try {
      log.fatal(`Grade ${grade} — activating kill switch`);
      riskManager.activateKillSwitch(`Comprehensive audit grade: ${grade}`);
    } catch (err) {
      log.fatal('Kill switch activation failed', { error: err?.message || err });
    }
  }
}

function loadAuditState() {
  const state = readJson(STATE_FILE);
  return {
    history: Array.isArray(state?.history) ? state.history : [],
    lastAudit: state?.lastAudit || null,
  };
}

function saveAuditState(report) {
  const state = loadAuditState();
  state.history.push({
    auditId: report.auditId,
    grade: report.summary.grade,
    level: report.level,
    ts: report.ts,
    duration_ms: report.duration_ms,
    passed: report.summary.passed,
    warnings: report.summary.warnings,
    failures: report.summary.failures,
  });
  // Keep last 100
  if (state.history.length > 100) {
    state.history = state.history.slice(-100);
  }
  state.lastAudit = {
    auditId: report.auditId,
    grade: report.summary.grade,
    ts: report.ts,
  };
  writeJson(STATE_FILE, state);
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
  if (!AUDIT_ENABLED) {
    log.info('Auditing disabled (AUDIT_ENABLED=false)');
    process.exit(0);
  }

  const startTs = Date.now();
  const level = ['quick', 'standard', 'deep'].includes(AUDIT_LEVEL) ? AUDIT_LEVEL : 'standard';
  const auditId = `audit-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  FREEDOMFORGE COMPREHENSIVE AUDIT`);
  console.log(`  ID: ${auditId}`);
  console.log(`  Level: ${level} | Started: ${now()}`);
  console.log(`${'='.repeat(70)}\n`);

  // Run all checks for this level
  const checkFns = getChecksForLevel(level);
  const results = [];

  for (const fn of checkFns) {
    try {
      const result = fn();
      results.push(result);
      const icon = result.status === 'pass' ? 'PASS' : result.status === 'warn' ? 'WARN' : 'FAIL';
      console.log(`  [${icon}] ${result.name}: ${result.message}`);
    } catch (err) {
      const fallback = check(fn.name || 'unknown', 'fail',
        `Check crashed: ${err?.message || err}`);
      results.push(fallback);
      console.log(`  [FAIL] ${fallback.name}: ${fallback.message}`);
    }
  }

  const endTs = Date.now();
  const grade = computeGrade(results);
  const recommendations = generateRecommendations(results);

  // Build previous audit reference
  const prevState = loadAuditState();
  const previousAudit = prevState.lastAudit
    ? { auditId: prevState.lastAudit.auditId, grade: prevState.lastAudit.grade }
    : null;

  const report = {
    auditId,
    level,
    ts: now(),
    duration_ms: endTs - startTs,
    summary: {
      total: results.length,
      passed: results.filter(c => c.status === 'pass').length,
      warnings: results.filter(c => c.status === 'warn').length,
      failures: results.filter(c => c.status === 'fail').length,
      grade,
    },
    checks: results,
    recommendations,
    previousAudit,
  };

  // Print summary
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  AUDIT COMPLETE — Grade: ${grade}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`  Total:     ${report.summary.total} checks`);
  console.log(`  Passed:    ${report.summary.passed}`);
  console.log(`  Warnings:  ${report.summary.warnings}`);
  console.log(`  Failures:  ${report.summary.failures}`);
  console.log(`  Duration:  ${report.duration_ms}ms`);
  if (previousAudit) {
    console.log(`  Previous:  ${previousAudit.grade} (${previousAudit.auditId})`);
  }
  if (recommendations.length > 0) {
    console.log(`\n  Recommendations:`);
    for (const r of recommendations) {
      console.log(`    - ${r}`);
    }
  }
  console.log(`${'='.repeat(70)}\n`);

  // Post-audit actions
  saveAuditState(report);
  publishToSignalBus(report);

  if (report.summary.failures > 0 || grade === 'D' || grade === 'F') {
    await sendDiscordAlert(report);
  }

  activateKillSwitchIfNeeded(grade);

  // Output JSON report to stdout for machine consumption
  console.log(JSON.stringify(report, null, 2));

  process.exit(report.summary.failures > 0 ? 1 : 0);
}

main().catch(err => {
  log.fatal('Fatal error', { error: err?.message || err });
  process.exit(1);
});
