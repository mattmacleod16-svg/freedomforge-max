/**
 * Async Venue Executor — Non-Blocking Parallel Trade Execution
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Replaces the blocking spawnSync calls in master-orchestrator with async
 * child_process.spawn, enabling parallel execution across multiple venues.
 *
 * Key improvements over spawnSync:
 *   - Non-blocking: orchestrator can process signals while trades execute
 *   - Parallel: multiple venue trades fire simultaneously
 *   - Timeout: kills stuck venue scripts after configurable timeout
 *   - Streaming stdout/stderr capture with size limits
 *   - Persistent trailing stop state saved to disk (not in-memory only)
 *   - Execution metrics per venue for performance tuning
 *
 * Usage:
 *   const executor = require('./async-executor');
 *   const results = await executor.executeParallel([
 *     { venue: 'kraken', signal, orderUsd: 15 },
 *     { venue: 'coinbase', signal, orderUsd: 20 },
 *   ]);
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { createLogger } = require('./logger');
const log = createLogger('async-executor');

let eventMesh;
try { eventMesh = require('./event-mesh'); } catch { eventMesh = null; }

// Resilient I/O for persistent trailing stop state
let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

// ─── Configuration ───────────────────────────────────────────────────────────

const EXECUTION_TIMEOUT_MS = Math.max(15000, Math.min(120000, Number(process.env.EXECUTOR_TIMEOUT_MS || 60000)));
const MAX_STDOUT_BYTES = 4096;
const MAX_STDERR_BYTES = 2048;
const TRAILING_STOP_FILE = path.resolve(process.cwd(), 'data/trailing-stop-state.json');

// Venue script mapping
const VENUE_SCRIPTS = {
  kraken: 'scripts/kraken-spot-engine.js',
  coinbase: 'scripts/coinbase-spot-engine.js',
  prediction: 'scripts/prediction-market-engine.js',
  polymarket: 'scripts/polymarket-clob-engine.js',
  alpaca: 'scripts/alpaca-engine.js',
  ibkr: 'scripts/ibkr-engine.js',
};

// Asset pair mapping
const KRAKEN_PAIR_MAP = {
  BTC: 'XXBTZUSD', ETH: 'XETHZUSD', SOL: 'SOLUSD', AVAX: 'AVAXUSD',
  DOGE: 'XDGUSD', ADA: 'ADAUSD', DOT: 'DOTUSD', MATIC: 'MATICUSD',
  LINK: 'LINKUSD', UNI: 'UNIUSD', ATOM: 'ATOMUSD', LTC: 'XLTCZUSD',
};

// ─── Venue Metrics ───────────────────────────────────────────────────────────

/** @type {Map<string, { executions: number, successes: number, failures: number, avgLatencyMs: number, lastError: string|null }>} */
const venueMetrics = new Map();

function getVenueMetrics(venue) {
  if (!venueMetrics.has(venue)) {
    venueMetrics.set(venue, {
      executions: 0, successes: 0, failures: 0, avgLatencyMs: 0, lastError: null,
    });
  }
  return venueMetrics.get(venue);
}

// ─── Persistent Trailing Stop State ──────────────────────────────────────────

/**
 * Save trailing stop state to disk (previously in-memory only, lost on restart).
 */
function saveTrailingStopState(state) {
  try {
    if (rio) {
      rio.writeJsonAtomic(TRAILING_STOP_FILE, { ...state, savedAt: Date.now() });
    } else {
      const dir = path.dirname(TRAILING_STOP_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = TRAILING_STOP_FILE + '.tmp.' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify({ ...state, savedAt: Date.now() }, null, 2));
      fs.renameSync(tmp, TRAILING_STOP_FILE);
    }
  } catch (err) {
    log.error(`Failed to save trailing stop state: ${err.message}`);
  }
}

function loadTrailingStopState() {
  try {
    if (rio) return rio.readJsonSafe(TRAILING_STOP_FILE, { fallback: {} });
    if (!fs.existsSync(TRAILING_STOP_FILE)) return {};
    return JSON.parse(fs.readFileSync(TRAILING_STOP_FILE, 'utf8'));
  } catch { return {}; }
}

// ─── Single Venue Execution ──────────────────────────────────────────────────

/**
 * Execute a trade on a single venue asynchronously.
 * @param {object} opts
 * @param {string} opts.venue - Venue name
 * @param {object} opts.signal - Trade signal { asset, side, confidence, edge }
 * @param {number} opts.orderUsd - Order size in USD
 * @returns {Promise<object>} Execution result
 */
function executeVenue(opts) {
  const { venue, signal, orderUsd } = opts;
  const script = VENUE_SCRIPTS[venue];
  if (!script) {
    return Promise.resolve({ success: false, venue, reason: `no script for ${venue}` });
  }

  const scriptPath = path.resolve(process.cwd(), script);
  if (!fs.existsSync(scriptPath)) {
    return Promise.resolve({ success: false, venue, reason: `script not found: ${script}` });
  }

  const startMs = Date.now();
  const metrics = getVenueMetrics(venue);
  metrics.executions++;

  const asset = (signal.asset || 'BTC').toUpperCase();
  const coinbaseProductId = `${asset}-USD`;
  const krakenPair = KRAKEN_PAIR_MAP[asset] || `${asset}USD`;

  const env = {
    ...process.env,
    [`${venue.toUpperCase()}_ORDER_USD`]: String(orderUsd),
    KRAKEN_ORDER_USD: venue === 'kraken' ? String(orderUsd) : process.env.KRAKEN_ORDER_USD,
    COINBASE_ORDER_USD: venue === 'coinbase' ? String(orderUsd) : process.env.COINBASE_ORDER_USD,
    PRED_MARKET_ORDER_USD: venue === 'prediction' ? String(orderUsd) : process.env.PRED_MARKET_ORDER_USD,
    COINBASE_PRODUCT_ID: venue === 'coinbase' ? coinbaseProductId : (process.env.COINBASE_PRODUCT_ID || 'BTC-USD'),
    KRAKEN_PAIR: venue === 'kraken' ? krakenPair : (process.env.KRAKEN_PAIR || 'XXBTZUSD'),
  };

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const child = spawn('node', [scriptPath], { env, timeout: EXECUTION_TIMEOUT_MS });

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already dead */ } }, 5000);
    }, EXECUTION_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_STDOUT_BYTES) stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_STDERR_BYTES) {
        let text = chunk.toString();
        // Redact secrets
        text = text.replace(/(key|secret|password|token|authorization)\s*[:=]\s*\S+/gi, '$1=***');
        stderr += text;
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const latencyMs = Date.now() - startMs;
      metrics.avgLatencyMs = metrics.avgLatencyMs * 0.85 + latencyMs * 0.15;

      const success = code === 0 && /"status"\s*:\s*"placed"/i.test(stdout);
      const skipped = /"status"\s*:\s*"skipped"/i.test(stdout);

      if (success) {
        metrics.successes++;
      } else {
        metrics.failures++;
        metrics.lastError = killed ? 'timeout' : (stderr.slice(0, 100) || `exit code ${code}`);
      }

      const result = {
        success,
        skipped,
        killed,
        exitCode: code,
        venue,
        asset: signal.asset,
        side: signal.side,
        confidence: signal.confidence,
        edge: signal.edge,
        orderUsd,
        latencyMs,
        stdout: stdout.slice(0, MAX_STDOUT_BYTES),
        stderr: stderr.slice(0, MAX_STDERR_BYTES),
      };

      // Publish to event mesh
      if (eventMesh) {
        eventMesh.publish('trade.executed', result, {
          source: `async-executor:${venue}`,
          priority: success ? eventMesh.PRIORITY?.NORMAL : eventMesh.PRIORITY?.HIGH,
        });
      }

      resolve(result);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      metrics.failures++;
      metrics.lastError = err.message;
      resolve({
        success: false,
        venue,
        asset: signal.asset,
        side: signal.side,
        error: err.message,
        latencyMs: Date.now() - startMs,
      });
    });
  });
}

// ─── Parallel Execution ──────────────────────────────────────────────────────

/**
 * Execute trades on multiple venues in parallel.
 * @param {Array<{ venue: string, signal: object, orderUsd: number }>} trades
 * @returns {Promise<Array<object>>} Results for all trades
 */
async function executeParallel(trades) {
  if (!trades || trades.length === 0) return [];

  const startMs = Date.now();
  log.info(`Executing ${trades.length} trades in parallel across: ${trades.map(t => t.venue).join(', ')}`);

  const results = await Promise.allSettled(
    trades.map(t => executeVenue(t))
  );

  const mapped = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      success: false,
      venue: trades[i].venue,
      error: r.reason?.message || 'unknown error',
    };
  });

  const successes = mapped.filter(r => r.success).length;
  const totalMs = Date.now() - startMs;

  log.info(`Parallel execution complete: ${successes}/${trades.length} succeeded in ${totalMs}ms`);

  return mapped;
}

/**
 * Execute on best venue with fallback to next.
 * @param {string[]} venuePriority - Ordered venue list
 * @param {object} signal - Trade signal
 * @param {number} orderUsd
 * @returns {Promise<object>} Best result
 */
async function executeWithFallback(venuePriority, signal, orderUsd) {
  for (const venue of venuePriority) {
    const result = await executeVenue({ venue, signal, orderUsd });
    if (result.success || result.skipped) return result;
    log.warn(`Venue ${venue} failed, trying next...`);
  }
  return { success: false, reason: 'all venues failed', venues: venuePriority };
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

function getStats() {
  const venueStats = {};
  for (const [venue, metrics] of venueMetrics) {
    venueStats[venue] = {
      ...metrics,
      successRate: metrics.executions > 0
        ? Number((metrics.successes / metrics.executions).toFixed(4))
        : 0,
      avgLatencyMs: Math.round(metrics.avgLatencyMs),
    };
  }

  return {
    venues: venueStats,
    trailingStopPersisted: fs.existsSync(TRAILING_STOP_FILE),
    trailingStopState: loadTrailingStopState(),
  };
}

module.exports = {
  executeVenue,
  executeParallel,
  executeWithFallback,
  saveTrailingStopState,
  loadTrailingStopState,
  getStats,
  VENUE_SCRIPTS,
};
