#!/usr/bin/env node
/**
 * FreedomForge Dashboard API Server
 * ===================================
 *
 * Comprehensive REST + SSE API server for the FreedomForge iOS/macOS monitoring app.
 * Exposes all trading system data as structured JSON endpoints with real-time
 * Server-Sent Events (SSE) streaming.
 *
 * Start:
 *   node scripts/dashboard-api.js
 *   DASHBOARD_PORT=9091 node scripts/dashboard-api.js
 *
 * Endpoints:
 *   GET /api/health              — Server health check
 *   GET /api/summary             — High-level system overview
 *   GET /api/portfolio            — Positions, exposure, correlation
 *   GET /api/trades              — Trade journal with stats
 *   GET /api/trades/recent       — Last N trades
 *   GET /api/risk                — Risk metrics (VaR, drawdown, kill switch)
 *   GET /api/capital             — Capital mandate state
 *   GET /api/brain               — Brain evolution state + insights
 *   GET /api/ml                  — ML pipeline state
 *   GET /api/signals             — Signal bus summary + active signals
 *   GET /api/strategies          — Strategy promoter state
 *   GET /api/margin              — Liquidation guardian (all venues)
 *   GET /api/margin/:venue       — Per-venue margin health
 *   GET /api/infrastructure      — CPU, memory, disk, agents, watchdog
 *   GET /api/events/stream       — SSE stream for real-time events
 *   GET /api/events/recent       — Recent log events
 *
 * Authentication:
 *   All endpoints require: Authorization: Bearer <ALERT_SECRET>
 *   Or query param: ?token=<ALERT_SECRET>
 *
 * Env vars:
 *   DASHBOARD_PORT     — default 9091
 *   ALERT_SECRET       — required for auth
 *   DASHBOARD_CORS     — CORS origin (default '*')
 */

'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ── Load env ────────────────────────────────────────────────────────────────

try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
  dotenv.config();
} catch {}

// ── Configuration ────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.DASHBOARD_PORT || '9091', 10);
const ALERT_SECRET = (process.env.ALERT_SECRET || '').trim();
const CORS_ORIGIN = process.env.DASHBOARD_CORS || '*';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const REFRESH_MS = 10000; // Refresh cached data every 10s
const SSE_HEARTBEAT_MS = 15000; // SSE keepalive every 15s
const SSE_PUSH_MS = 5000; // Push data updates every 5s
const MAX_LOG_LINES = 200; // Max recent log lines to serve

// ── Module Loaders (fail-safe) ──────────────────────────────────────────────

const modules = {};

function safeRequire(name) {
  if (modules[name] !== undefined) return modules[name];
  try {
    modules[name] = require(path.join(PROJECT_ROOT, 'lib', name));
  } catch {
    modules[name] = null;
  }
  return modules[name];
}

function safeCall(fn, fallback) {
  try {
    const result = fn();
    return result != null ? result : fallback;
  } catch {
    return fallback;
  }
}

function safeRead(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

// ── Authentication ──────────────────────────────────────────────────────────

function authenticate(req) {
  if (!ALERT_SECRET) return true; // No secret configured = open (dev mode)

  // Check Authorization header
  const auth = req.headers['authorization'] || '';
  if (auth === `Bearer ${ALERT_SECRET}`) return true;

  // Check x-api-secret header
  if (req.headers['x-api-secret'] === ALERT_SECRET) return true;

  // Check query param
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.searchParams.get('token') === ALERT_SECRET) return true;

  return false;
}

// ── CORS Headers ────────────────────────────────────────────────────────────

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-api-secret');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ── Response Helpers ────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function error(res, message, status = 500) {
  json(res, { error: message }, status);
}

// ── CPU Tracking ────────────────────────────────────────────────────────────

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

// ── Data Collection Functions ───────────────────────────────────────────────

function getSummary() {
  const rm = safeRequire('risk-manager');
  const cm = safeRequire('capital-mandate');
  const tj = safeRequire('trade-journal');
  const sb = safeRequire('agent-signal-bus');
  const brain = safeRequire('self-evolving-brain');
  const lg = safeRequire('liquidation-guardian');

  const riskHealth = rm ? safeCall(() => rm.getRiskHealth(), {}) : {};
  const mandate = cm ? safeCall(() => cm.getMandateSummary(), {}) : {};
  const stats = tj ? safeCall(() => tj.getStats({ sinceDays: 30 }), {}) : {};
  const busSummary = sb ? safeCall(() => sb.summary(), { totalSignals: 0, types: {} }) : { totalSignals: 0, types: {} };
  const brainInsights = brain ? safeCall(() => brain.getInsights(), {}) : {};
  const cbMargin = lg ? safeCall(() => lg.getMarginHealth('coinbase'), {}) : {};
  const krMargin = lg ? safeCall(() => lg.getMarginHealth('kraken'), {}) : {};

  return {
    ts: new Date().toISOString(),
    system: {
      status: riskHealth.killSwitchActive ? 'KILL_SWITCH' : riskHealth.healthy === false ? 'DEGRADED' : 'OPERATIONAL',
      uptime: Math.round(process.uptime()),
      capitalMode: mandate.mode || 'unknown',
    },
    equity: {
      current: riskHealth.currentEquity || 0,
      peak: riskHealth.peakEquity || 0,
      drawdownPct: riskHealth.drawdownPct || 0,
    },
    pnl: {
      daily: riskHealth.dailyPnl || 0,
      total30d: stats.totalPnl || 0,
    },
    trading: {
      openTrades: stats.openTrades || 0,
      winRate: stats.winRate || 0,
      profitFactor: stats.profitFactor || 0,
      sharpe: stats.sharpeRatio || 0,
      totalTrades30d: stats.totalTrades || 0,
    },
    risk: {
      killSwitch: riskHealth.killSwitchActive || false,
      exposure: riskHealth.totalExposure || 0,
      maxExposure: riskHealth.maxExposure || 0,
      utilizationPct: riskHealth.utilizationPct || 0,
      positions: riskHealth.positionCount || 0,
    },
    brain: {
      generation: brainInsights.totalEvolutions || 0,
      calibration: brainInsights.calibrationScore || 0,
      streak: brainInsights.streak || 0,
    },
    signals: {
      total: busSummary.totalSignals || 0,
      types: Object.keys(busSummary.types || {}).length,
    },
    margin: {
      coinbase: { marginPct: cbMargin.marginPct || 0, healthy: cbMargin.healthy !== false },
      kraken: { marginPct: krMargin.marginPct || 0, healthy: krMargin.healthy !== false },
    },
    capital: {
      mode: mandate.mode || 'unknown',
      initial: mandate.initialCapital || 0,
      hwm: mandate.highWaterMark || 0,
      roi: mandate.roiPct || 0,
    },
  };
}

function getPortfolio() {
  const rm = safeRequire('risk-manager');
  const ve = safeRequire('var-engine');
  const cm = safeRequire('correlation-monitor');

  const exposure = rm ? safeCall(() => rm.getPortfolioExposure(), {}) : {};
  const corrMatrix = cm ? safeCall(() => cm.getCorrelationMatrix(), {}) : {};
  const divScore = cm ? safeCall(() => cm.getDiversificationScore(), 0) : 0;

  let varMetrics = null;
  if (ve) {
    varMetrics = safeCall(() => {
      const returns = ve.getHistoricalReturns();
      if (!returns || returns.length < 3) return null;
      return ve.calculateVaR(returns);
    }, null);
  }

  return {
    ts: new Date().toISOString(),
    exposure,
    var: varMetrics ? {
      var95: Math.abs(varMetrics.var95 || 0),
      var99: Math.abs(varMetrics.var99 || 0),
      cvar95: Math.abs(varMetrics.cvar95 || 0),
    } : null,
    correlation: {
      matrix: corrMatrix.matrix || {},
      assets: corrMatrix.assets || [],
      diversificationScore: divScore,
      alerts: corrMatrix.alerts || [],
    },
  };
}

function getTrades(query = {}) {
  const tj = safeRequire('trade-journal');
  if (!tj) return { trades: [], stats: {} };

  const sinceDays = parseInt(query.days || '30', 10);
  const stats = safeCall(() => tj.getStats({ sinceDays }), {});

  // Read raw trades for the list
  const raw = safeRead(tj.JOURNAL_FILE, { trades: [] });
  let trades = Array.isArray(raw.trades) ? raw.trades : [];

  // Apply time filter
  const cutoff = Date.now() - (sinceDays * 24 * 60 * 60 * 1000);
  trades = trades.filter(t => (t.entryTs || 0) > cutoff);

  // Sort newest first
  trades.sort((a, b) => (b.entryTs || 0) - (a.entryTs || 0));

  // Limit
  const limit = parseInt(query.limit || '100', 10);
  trades = trades.slice(0, limit);

  return { ts: new Date().toISOString(), trades, stats };
}

function getRecentTrades(query = {}) {
  const tj = safeRequire('trade-journal');
  if (!tj) return { trades: [] };

  const raw = safeRead(tj.JOURNAL_FILE, { trades: [] });
  let trades = Array.isArray(raw.trades) ? raw.trades : [];
  trades.sort((a, b) => (b.entryTs || 0) - (a.entryTs || 0));

  const limit = parseInt(query.limit || '20', 10);
  return { ts: new Date().toISOString(), trades: trades.slice(0, limit) };
}

function getRisk() {
  const rm = safeRequire('risk-manager');
  const ve = safeRequire('var-engine');
  const lg = safeRequire('liquidation-guardian');

  const health = rm ? safeCall(() => rm.getRiskHealth(), {}) : {};
  const exposure = rm ? safeCall(() => rm.getPortfolioExposure(), {}) : {};

  let varMetrics = null;
  if (ve) {
    varMetrics = safeCall(() => {
      const returns = ve.getHistoricalReturns();
      if (!returns || returns.length < 3) return null;
      return ve.calculateVaR(returns);
    }, null);
  }

  const riskState = safeRead(path.join(DATA_DIR, 'risk-manager-state.json'), {});

  return {
    ts: new Date().toISOString(),
    health,
    exposure,
    var: varMetrics,
    riskEvents: (riskState.riskEvents || []).slice(-50),
    killSwitch: {
      active: health.killSwitchActive || false,
      reason: riskState.killSwitchReason || null,
    },
    margin: {
      coinbase: lg ? safeCall(() => lg.getMarginHealth('coinbase'), {}) : {},
      kraken: lg ? safeCall(() => lg.getMarginHealth('kraken'), {}) : {},
    },
  };
}

function getCapital() {
  const cm = safeRequire('capital-mandate');
  if (!cm) return { mandate: {}, capital: {} };

  const mandate = safeCall(() => cm.getMandateSummary(), {});
  const capital = typeof cm.getCurrentCapital === 'function'
    ? safeCall(() => cm.getCurrentCapital(), {})
    : {};

  const mandateState = safeRead(path.join(DATA_DIR, 'capital-mandate-state.json'), {});

  // Treasury ledger if exists
  const treasury = safeRead(path.join(DATA_DIR, 'treasury-ledger.json'), null);

  return {
    ts: new Date().toISOString(),
    mandate,
    capital,
    state: mandateState,
    treasury,
  };
}

function getBrain() {
  const brain = safeRequire('self-evolving-brain');
  if (!brain) return {};

  const insights = safeCall(() => brain.getInsights(), {});
  const weights = safeCall(() => brain.getEvolvedWeights(), {});
  const thresholds = safeCall(() => brain.getEvolvedThresholds(), {});
  const shouldTrade = safeCall(() => brain.shouldTradeNow(), {});
  const brainState = safeRead(path.join(DATA_DIR, 'brain-state.json'), {});

  return {
    ts: new Date().toISOString(),
    insights,
    weights,
    thresholds,
    shouldTrade,
    state: {
      generation: brainState.generation || 0,
      streaks: brainState.streaks || {},
      regimeProfiles: brainState.regimeProfiles || {},
      assetProfiles: brainState.assetProfiles || {},
      timePatterns: brainState.timePatterns || {},
      calibration: brainState.calibration || {},
      lastEvolution: brainState.lastEvolution || null,
    },
  };
}

function getML() {
  const mlModel = safeRead(path.join(DATA_DIR, 'ml-model.json'), null);
  const featureStore = safeRead(path.join(DATA_DIR, 'ml-feature-store.json'), null);
  const pipelineState = safeRead(path.join(DATA_DIR, 'ml-pipeline-state.json'), null);

  let featureImportance = {};
  if (mlModel && mlModel.stumps && mlModel.featureNames) {
    for (const s of mlModel.stumps) {
      const name = mlModel.featureNames[s.featureIdx] || `feature_${s.featureIdx}`;
      featureImportance[name] = (featureImportance[name] || 0) + 1;
    }
  }

  return {
    ts: new Date().toISOString(),
    model: mlModel ? {
      trainAccuracy: mlModel.trainAccuracy || 0,
      valAccuracy: mlModel.valAccuracy || 0,
      sampleCount: mlModel.sampleCount || 0,
      stumpCount: (mlModel.stumps || []).length,
      featureNames: mlModel.featureNames || [],
      lastTrainedAt: mlModel.lastTrainedAt || null,
    } : null,
    featureImportance,
    featureStoreSamples: featureStore ? (featureStore.samples || []).length : 0,
    pipelineState,
  };
}

function getSignals() {
  const sb = safeRequire('agent-signal-bus');
  if (!sb) return { summary: { totalSignals: 0, types: {} }, signals: [] };

  const summary = safeCall(() => sb.summary(), { totalSignals: 0, types: {} });
  const allSignals = safeCall(() => sb.query({}), []);

  // Group by type with metadata
  const byType = {};
  for (const s of allSignals) {
    if (!byType[s.type]) byType[s.type] = [];
    byType[s.type].push({
      id: s.id,
      source: s.source,
      confidence: s.confidence,
      payload: s.payload,
      publishedAt: s.publishedAt,
      ageMs: Date.now() - s.publishedAt,
    });
  }

  return { ts: new Date().toISOString(), summary, signals: allSignals.slice(0, 100), byType };
}

function getStrategies() {
  const sp = safeRequire('strategy-promoter');
  if (!sp) return { strategies: [] };

  const active = safeCall(() => sp.getActiveStrategies(), []);
  const registry = safeCall(() => sp.loadRegistry(), { strategies: {} });

  return {
    ts: new Date().toISOString(),
    activeStrategies: active,
    allStrategies: Object.entries(registry.strategies || {}).map(([name, s]) => ({
      name,
      status: s.status,
      author: s.author,
      createdAt: s.createdAt,
      performance: s.performance || {},
      promotion: s.promotionHistory || [],
    })),
    gates: sp.GATES || {},
  };
}

function getMargin(venue) {
  const lg = safeRequire('liquidation-guardian');
  const guardianState = safeRead(path.join(DATA_DIR, 'liquidation-guardian-state.json'), {});

  if (venue) {
    const health = lg ? safeCall(() => lg.getMarginHealth(venue), {}) : {};
    const venueState = venue === 'kraken' ? guardianState.kraken : guardianState.coinbase;
    return { ts: new Date().toISOString(), venue, health, state: venueState || {} };
  }

  return {
    ts: new Date().toISOString(),
    coinbase: {
      health: lg ? safeCall(() => lg.getMarginHealth('coinbase'), {}) : {},
      state: guardianState.coinbase || {},
    },
    kraken: {
      health: lg ? safeCall(() => lg.getMarginHealth('kraken'), {}) : {},
      state: guardianState.kraken || {},
    },
    emergencyCloses: guardianState.emergencyCloses || 0,
    blockedTrades: guardianState.blockedTrades || 0,
    lastCheck: guardianState.lastCheck || 0,
    recentActions: (guardianState.actions || []).slice(-20),
  };
}

function getInfrastructure() {
  updateCpuUsage();

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPct = totalMem > 0 ? Math.round((usedMem / totalMem) * 10000) / 100 : 0;

  // Disk
  let diskPct = -1;
  try {
    const { execSync } = require('child_process');
    const output = execSync(`df -P "${PROJECT_ROOT}" | tail -1`, { encoding: 'utf8', timeout: 5000 });
    const parts = output.trim().split(/\s+/);
    if (parts.length >= 5) diskPct = parseInt(parts[4].replace('%', ''), 10);
  } catch {}

  // Watchdog
  let watchdogRunning = false;
  try {
    const { execSync } = require('child_process');
    const output = execSync('pgrep -f watchdog-daemon', { encoding: 'utf8', timeout: 3000 }).trim();
    watchdogRunning = output.length > 0;
  } catch {}

  // Agent heartbeats
  const hb = safeRequire('heartbeat-registry');
  const knownAgents = ['master-orchestrator', 'coinbase-spot-engine', 'kraken-spot-engine',
    'prediction-market-engine', 'sentiment-agent', 'arb-scanner'];
  const agentHealth = hb ? safeCall(() => hb.checkAgentHealth(knownAgents), null) : null;

  // Circuit breakers
  const rio = safeRequire('resilient-io');
  const circuits = rio ? safeCall(() => rio.getCircuitStatus(), {}) : {};

  // Venue performance
  const venuePerf = safeRead(path.join(DATA_DIR, 'venue-performance-state.json'), null);

  // Watchdog state
  const watchdogState = safeRead(path.join(DATA_DIR, 'watchdog-state.json'), null);

  const nodeMem = process.memoryUsage();

  return {
    ts: new Date().toISOString(),
    system: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.versions.node,
      uptime: Math.round(process.uptime()),
      osUptime: Math.round(os.uptime()),
    },
    cpu: { usagePct: cpuUsagePct, cores: os.cpus().length },
    memory: {
      usagePct: memPct,
      totalMB: Math.round(totalMem / 1024 / 1024),
      usedMB: Math.round(usedMem / 1024 / 1024),
      freeMB: Math.round(freeMem / 1024 / 1024),
    },
    disk: { usagePct: diskPct >= 0 ? diskPct : null },
    node: {
      rss: Math.round(nodeMem.rss / 1024 / 1024),
      heapTotal: Math.round(nodeMem.heapTotal / 1024 / 1024),
      heapUsed: Math.round(nodeMem.heapUsed / 1024 / 1024),
    },
    watchdog: {
      running: watchdogRunning,
      state: watchdogState,
    },
    agents: agentHealth?.agents || {},
    circuits: Object.entries(circuits).map(([key, state]) => ({
      name: key,
      status: state.status || 'CLOSED',
      failures: state.failures || 0,
      lastFailure: state.lastFailure || 0,
      lastSuccess: state.lastSuccess || 0,
    })),
    venuePerformance: venuePerf?.venues || {},
  };
}

function getRecentEvents(query = {}) {
  const logFile = path.join(DATA_DIR, 'events.log');
  const limit = parseInt(query.limit || '100', 10);
  const level = query.level || null; // filter by level
  const agent = query.agent || null; // filter by agent

  try {
    if (!fs.existsSync(logFile)) return { ts: new Date().toISOString(), events: [] };

    // Read last N lines efficiently
    const stat = fs.statSync(logFile);
    const readSize = Math.min(stat.size, 512 * 1024); // Read last 512KB max
    const fd = fs.openSync(logFile, 'r');
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, Math.max(0, stat.size - readSize));
    fs.closeSync(fd);

    const lines = buffer.toString('utf8').split('\n').filter(l => l.trim());
    let events = [];

    for (let i = lines.length - 1; i >= 0 && events.length < MAX_LOG_LINES; i--) {
      try {
        const evt = JSON.parse(lines[i]);
        if (level && evt.level !== level) continue;
        if (agent && evt.agent !== agent) continue;
        events.push(evt);
      } catch {
        // Skip non-JSON lines
      }
    }

    return { ts: new Date().toISOString(), events: events.slice(0, limit) };
  } catch {
    return { ts: new Date().toISOString(), events: [] };
  }
}

// ── SSE Stream ──────────────────────────────────────────────────────────────

const sseClients = new Set();
let sseId = 0;

function setupSSE(req, res) {
  setCors(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const clientId = ++sseId;
  const client = { id: clientId, res, connectedAt: Date.now() };
  sseClients.add(client);

  // Send initial connection event
  res.write(`id: ${clientId}\nevent: connected\ndata: ${JSON.stringify({ clientId, ts: new Date().toISOString() })}\n\n`);

  // Send immediate summary
  try {
    const summary = getSummary();
    res.write(`id: ${Date.now()}\nevent: summary\ndata: ${JSON.stringify(summary)}\n\n`);
  } catch {}

  // Cleanup on disconnect
  req.on('close', () => {
    sseClients.delete(client);
  });

  req.on('error', () => {
    sseClients.delete(client);
  });
}

function broadcastSSE(event, data) {
  const payload = `id: ${Date.now()}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// SSE heartbeat
setInterval(() => {
  const payload = `:heartbeat ${new Date().toISOString()}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}, SSE_HEARTBEAT_MS).unref();

// SSE data push interval — streams summary + risk updates to all connected clients
setInterval(() => {
  if (sseClients.size === 0) return;
  try {
    const summary = getSummary();
    broadcastSSE('summary', summary);
  } catch {}
}, SSE_PUSH_MS).unref();

// Watch events.log for new entries and stream them
let lastLogSize = 0;
let logWatchTimer = null;

function watchLogFile() {
  const logFile = path.join(DATA_DIR, 'events.log');
  try {
    if (!fs.existsSync(logFile)) return;
    const stat = fs.statSync(logFile);
    if (stat.size <= lastLogSize) {
      if (stat.size < lastLogSize) lastLogSize = 0; // Log rotated
      return;
    }

    // Read new bytes
    const fd = fs.openSync(logFile, 'r');
    const newSize = stat.size - lastLogSize;
    const buffer = Buffer.alloc(Math.min(newSize, 64 * 1024));
    fs.readSync(fd, buffer, 0, buffer.length, lastLogSize);
    fs.closeSync(fd);
    lastLogSize = stat.size;

    if (sseClients.size === 0) return;

    // Parse new lines and broadcast
    const lines = buffer.toString('utf8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        broadcastSSE('event', evt);
      } catch {}
    }
  } catch {}
}

logWatchTimer = setInterval(watchLogFile, 2000);
logWatchTimer.unref();

// ── URL Router ──────────────────────────────────────────────────────────────

function parseUrl(rawUrl) {
  const url = new URL(rawUrl, 'http://localhost');
  return {
    pathname: url.pathname.replace(/\/+$/, '') || '/',
    query: Object.fromEntries(url.searchParams),
  };
}

function route(req, res) {
  const { pathname, query } = parseUrl(req.url);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check (no auth required)
  if (pathname === '/api/health') {
    return json(res, {
      status: 'ok',
      ts: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
      sseClients: sseClients.size,
      version: '1.0.0',
    });
  }

  // Auth check for all other endpoints
  if (!authenticate(req)) {
    return error(res, 'Unauthorized', 401);
  }

  // Route dispatch
  switch (pathname) {
    case '/api/summary':
      return json(res, getSummary());

    case '/api/portfolio':
      return json(res, getPortfolio());

    case '/api/trades':
      return json(res, getTrades(query));

    case '/api/trades/recent':
      return json(res, getRecentTrades(query));

    case '/api/risk':
      return json(res, getRisk());

    case '/api/capital':
      return json(res, getCapital());

    case '/api/brain':
      return json(res, getBrain());

    case '/api/ml':
      return json(res, getML());

    case '/api/signals':
      return json(res, getSignals());

    case '/api/strategies':
      return json(res, getStrategies());

    case '/api/margin':
      return json(res, getMargin());

    case '/api/margin/coinbase':
      return json(res, getMargin('coinbase'));

    case '/api/margin/kraken':
      return json(res, getMargin('kraken'));

    case '/api/infrastructure':
      return json(res, getInfrastructure());

    case '/api/events/recent':
      return json(res, getRecentEvents(query));

    case '/api/events/stream':
      return setupSSE(req, res);

    default:
      return error(res, `Not Found. Use GET /api/health to verify. Endpoints: summary, portfolio, trades, risk, capital, brain, ml, signals, strategies, margin, infrastructure, events/recent, events/stream`, 404);
  }
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  try {
    route(req, res);
  } catch (err) {
    error(res, `Internal error: ${err.message}`, 500);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[dashboard-api] FreedomForge Dashboard API listening on http://0.0.0.0:${PORT}`);
  console.log(`[dashboard-api] Endpoints: /api/{health,summary,portfolio,trades,risk,capital,brain,ml,signals,strategies,margin,infrastructure,events/*}`);
  console.log(`[dashboard-api] SSE stream: /api/events/stream`);
  console.log(`[dashboard-api] Auth: ${ALERT_SECRET ? 'Bearer token required' : 'OPEN (no ALERT_SECRET set)'}`);
});

// ── Graceful Shutdown ───────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`[dashboard-api] Received ${signal}, shutting down...`);
  if (logWatchTimer) clearInterval(logWatchTimer);

  // Close all SSE connections
  for (const client of sseClients) {
    try { client.res.end(); } catch {}
  }
  sseClients.clear();

  server.close(() => {
    console.log('[dashboard-api] Server closed.');
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
