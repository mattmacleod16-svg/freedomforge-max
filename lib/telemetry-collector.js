/**
 * FreedomForge Telemetry Collector
 * ═════════════════════════════════
 *
 * Comprehensive telemetry system for continuous agent self-improvement.
 * Tracks every decision point, measures outcomes, and builds causal graphs
 * connecting signals → decisions → execution → results → learning.
 *
 * Capabilities:
 *   - Counters: monotonically increasing event counts
 *   - Gauges: point-in-time measurements
 *   - Histograms: latency/value distribution tracking (p50/p90/p99)
 *   - Causal traces: link decisions to their outcomes for attribution
 *   - Feedback loops: measure whether learning actually improves performance
 *   - Agent mesh telemetry: track inter-agent communication health
 *
 * Persistence: data/telemetry-state.json (auto-rotated daily snapshots)
 *
 * Usage:
 *   const telemetry = require('../lib/telemetry-collector');
 *   telemetry.counter('trades_executed', { venue: 'coinbase', asset: 'BTC' });
 *   telemetry.gauge('portfolio_value_usd', 1250.50);
 *   telemetry.histogram('signal_latency_ms', 45, { source: 'edge-detector' });
 *   const trace = telemetry.startTrace('trade_decision', { asset: 'BTC' });
 *   // ... do work ...
 *   telemetry.endTrace(trace, { outcome: 'win', pnl: 12.50 });
 */

'use strict';

const fs = require('fs');
const path = require('path');

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

const STATE_FILE = path.resolve(process.cwd(), process.env.TELEMETRY_STATE_FILE || 'data/telemetry-state.json');
const SNAPSHOT_DIR = path.resolve(process.cwd(), 'data/telemetry-snapshots');
const MAX_HISTOGRAM_SAMPLES = Number(process.env.TELEMETRY_HISTOGRAM_SAMPLES || '1000');
const MAX_TRACES = Number(process.env.TELEMETRY_MAX_TRACES || '500');
const MAX_FEEDBACK_ENTRIES = Number(process.env.TELEMETRY_MAX_FEEDBACK || '200');
const SNAPSHOT_INTERVAL_MS = Number(process.env.TELEMETRY_SNAPSHOT_INTERVAL_MS || String(60 * 60 * 1000)); // 1 hour

// ─── In-Memory State ────────────────────────────────────────────────────────────

const _counters = {};       // name → { value, labels: { labelKey → { labelVal → count } } }
const _gauges = {};         // name → { value, labels, updatedAt }
const _histograms = {};     // name → { samples: [], count, sum, min, max }
const _traces = {};         // traceId → { name, startedAt, labels, endedAt, outcome, durationMs }
const _feedbackLoops = [];  // { signalType, decisionId, outcome, improvementDelta, ts }
const _agentHealth = {};    // agentName → { lastSeen, signalCount, errorCount, latencyP50 }

let _lastSnapshotAt = Date.now();
let _sessionStartedAt = Date.now();

// ─── Counters ───────────────────────────────────────────────────────────────────

/**
 * Increment a counter. Counters are monotonically increasing.
 * @param {string} name - Counter name (e.g., 'trades_executed')
 * @param {object} [labels={}] - Dimensional labels (e.g., { venue: 'coinbase' })
 * @param {number} [delta=1] - Amount to increment
 */
function counter(name, labels = {}, delta = 1) {
  if (!_counters[name]) {
    _counters[name] = { value: 0, labels: {} };
  }
  _counters[name].value += delta;

  // Track per-label breakdown
  for (const [key, val] of Object.entries(labels)) {
    if (!_counters[name].labels[key]) _counters[name].labels[key] = {};
    const strVal = String(val);
    _counters[name].labels[key][strVal] = (_counters[name].labels[key][strVal] || 0) + delta;
  }
}

/**
 * Get counter value.
 */
function getCounter(name) {
  return _counters[name]?.value || 0;
}

// ─── Gauges ─────────────────────────────────────────────────────────────────────

/**
 * Set a gauge value. Gauges represent point-in-time measurements.
 * @param {string} name - Gauge name (e.g., 'portfolio_value_usd')
 * @param {number} value - Current value
 * @param {object} [labels={}] - Dimensional labels
 */
function gauge(name, value, labels = {}) {
  _gauges[name] = {
    value,
    labels,
    updatedAt: Date.now(),
  };
}

/**
 * Get gauge value.
 */
function getGauge(name) {
  return _gauges[name]?.value ?? null;
}

// ─── Histograms ─────────────────────────────────────────────────────────────────

/**
 * Record a value in a histogram for distribution analysis.
 * Tracks p50, p90, p95, p99 percentiles.
 * @param {string} name - Histogram name (e.g., 'signal_latency_ms')
 * @param {number} value - Observed value
 * @param {object} [labels={}] - Dimensional labels
 */
function histogram(name, value, labels = {}) {
  if (!_histograms[name]) {
    _histograms[name] = { samples: [], count: 0, sum: 0, min: Infinity, max: -Infinity, labels: {} };
  }
  const h = _histograms[name];
  h.samples.push(value);
  h.count++;
  h.sum += value;
  h.min = Math.min(h.min, value);
  h.max = Math.max(h.max, value);

  // Reservoir sampling to cap memory
  if (h.samples.length > MAX_HISTOGRAM_SAMPLES) {
    h.samples = h.samples.slice(-MAX_HISTOGRAM_SAMPLES);
  }

  // Track per-label breakdown
  for (const [key, val] of Object.entries(labels)) {
    if (!h.labels[key]) h.labels[key] = {};
    const strVal = String(val);
    if (!h.labels[key][strVal]) h.labels[key][strVal] = { count: 0, sum: 0 };
    h.labels[key][strVal].count++;
    h.labels[key][strVal].sum += value;
  }
}

/**
 * Get histogram percentiles.
 */
function getHistogramPercentiles(name) {
  const h = _histograms[name];
  if (!h || h.samples.length === 0) return null;

  const sorted = [...h.samples].sort((a, b) => a - b);
  const len = sorted.length;
  return {
    count: h.count,
    sum: h.sum,
    avg: h.sum / h.count,
    min: h.min,
    max: h.max,
    p50: sorted[Math.floor(len * 0.50)],
    p90: sorted[Math.floor(len * 0.90)],
    p95: sorted[Math.floor(len * 0.95)],
    p99: sorted[Math.floor(len * 0.99)],
  };
}

// ─── Causal Traces ──────────────────────────────────────────────────────────────

/**
 * Start a causal trace to link a decision to its outcome.
 * @param {string} name - Trace name (e.g., 'trade_decision', 'signal_generation')
 * @param {object} [labels={}] - Context labels
 * @returns {string} traceId for use with endTrace
 */
function startTrace(name, labels = {}) {
  const traceId = `tr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  _traces[traceId] = {
    name,
    startedAt: Date.now(),
    labels,
    endedAt: null,
    outcome: null,
    durationMs: null,
  };

  // Trim old traces
  const traceIds = Object.keys(_traces);
  if (traceIds.length > MAX_TRACES) {
    const oldest = traceIds.slice(0, traceIds.length - MAX_TRACES);
    for (const id of oldest) delete _traces[id];
  }

  return traceId;
}

/**
 * End a causal trace with outcome data.
 * @param {string} traceId - From startTrace
 * @param {object} outcome - Outcome data (e.g., { result: 'win', pnl: 12.50 })
 */
function endTrace(traceId, outcome = {}) {
  const trace = _traces[traceId];
  if (!trace) return;

  trace.endedAt = Date.now();
  trace.durationMs = trace.endedAt - trace.startedAt;
  trace.outcome = outcome;

  // Record duration in histogram
  histogram(`trace_duration_ms.${trace.name}`, trace.durationMs);

  // Record outcome counter
  if (outcome.result) {
    counter(`trace_outcome.${trace.name}`, { result: outcome.result });
  }
}

/**
 * Get completed traces for analysis.
 */
function getCompletedTraces(name, maxAgeMs = 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  return Object.values(_traces).filter(
    t => t.endedAt && t.endedAt > cutoff && (!name || t.name === name)
  );
}

// ─── Feedback Loop Tracking ─────────────────────────────────────────────────────

/**
 * Record a feedback loop entry — did a learning cycle actually improve outcomes?
 * This is the meta-metric: measuring whether self-improvement works.
 *
 * @param {object} entry
 * @param {string} entry.signalType - What type of signal triggered the decision
 * @param {string} entry.decisionId - Trade/action ID
 * @param {string} entry.outcome - 'improved' | 'degraded' | 'neutral'
 * @param {number} entry.beforeMetric - Performance metric before learning
 * @param {number} entry.afterMetric - Performance metric after learning
 * @param {string} [entry.learningSource] - What triggered the adaptation
 */
function recordFeedback(entry) {
  const record = {
    ...entry,
    improvementDelta: (entry.afterMetric || 0) - (entry.beforeMetric || 0),
    ts: Date.now(),
  };
  _feedbackLoops.push(record);
  if (_feedbackLoops.length > MAX_FEEDBACK_ENTRIES) {
    _feedbackLoops.splice(0, _feedbackLoops.length - MAX_FEEDBACK_ENTRIES);
  }

  // Track improvement rate
  counter('feedback_loop_total', { outcome: entry.outcome });
}

/**
 * Get feedback loop improvement rate.
 */
function getFeedbackStats() {
  if (_feedbackLoops.length === 0) return { total: 0, improvementRate: 0, avgDelta: 0 };

  const improved = _feedbackLoops.filter(f => f.outcome === 'improved').length;
  const avgDelta = _feedbackLoops.reduce((s, f) => s + (f.improvementDelta || 0), 0) / _feedbackLoops.length;

  return {
    total: _feedbackLoops.length,
    improved,
    degraded: _feedbackLoops.filter(f => f.outcome === 'degraded').length,
    neutral: _feedbackLoops.filter(f => f.outcome === 'neutral').length,
    improvementRate: improved / _feedbackLoops.length,
    avgDelta: Math.round(avgDelta * 10000) / 10000,
    recent: _feedbackLoops.slice(-10),
  };
}

// ─── Agent Mesh Telemetry ───────────────────────────────────────────────────────

/**
 * Record an agent heartbeat/signal for mesh health tracking.
 */
function agentPing(agentName, metadata = {}) {
  if (!_agentHealth[agentName]) {
    _agentHealth[agentName] = {
      firstSeen: Date.now(),
      lastSeen: 0,
      signalCount: 0,
      errorCount: 0,
      latencies: [],
    };
  }
  const agent = _agentHealth[agentName];
  agent.lastSeen = Date.now();
  agent.signalCount++;
  if (metadata.error) agent.errorCount++;
  if (metadata.latencyMs) {
    agent.latencies.push(metadata.latencyMs);
    if (agent.latencies.length > 100) agent.latencies = agent.latencies.slice(-100);
  }
}

/**
 * Get agent mesh health summary.
 */
function getAgentMeshHealth() {
  const now = Date.now();
  const agents = {};
  for (const [name, data] of Object.entries(_agentHealth)) {
    const latencies = data.latencies.length > 0 ? [...data.latencies].sort((a, b) => a - b) : [];
    agents[name] = {
      alive: (now - data.lastSeen) < 10 * 60 * 1000, // alive if seen in last 10min
      lastSeenAgo: Math.round((now - data.lastSeen) / 1000),
      signalCount: data.signalCount,
      errorCount: data.errorCount,
      errorRate: data.signalCount > 0 ? Math.round(data.errorCount / data.signalCount * 10000) / 100 : 0,
      latencyP50: latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : null,
      latencyP99: latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.99)] : null,
    };
  }
  return agents;
}

// ─── Decision Quality Metrics ───────────────────────────────────────────────────

/**
 * Record a decision quality measurement — how good was the signal vs the outcome?
 * @param {object} decision
 * @param {number} decision.predictedConfidence - What the system thought (0-1)
 * @param {string} decision.predictedSide - 'buy' | 'sell'
 * @param {number} decision.actualReturn - Actual percentage return
 * @param {string} decision.venue - Trading venue
 * @param {string} decision.strategy - Strategy used
 */
function recordDecisionQuality(decision) {
  const correct = (decision.predictedSide === 'buy' && decision.actualReturn > 0) ||
                  (decision.predictedSide === 'sell' && decision.actualReturn < 0);

  counter('decision_quality_total', {
    venue: decision.venue,
    strategy: decision.strategy,
    correct: String(correct),
  });

  // Track calibration: stated confidence vs actual accuracy
  histogram('decision_confidence', decision.predictedConfidence, {
    correct: String(correct),
    venue: decision.venue,
  });

  // Track return distribution
  histogram('decision_return_pct', decision.actualReturn, {
    side: decision.predictedSide,
    venue: decision.venue,
  });

  // Brier-style scoring (lower = better calibrated)
  const brierScore = Math.pow(decision.predictedConfidence - (correct ? 1 : 0), 2);
  histogram('decision_brier_score', brierScore, { strategy: decision.strategy });
}

// ─── Snapshot & Persistence ─────────────────────────────────────────────────────

/**
 * Get a full telemetry snapshot for analysis.
 */
function getSnapshot() {
  const histPercentiles = {};
  for (const [name, h] of Object.entries(_histograms)) {
    histPercentiles[name] = getHistogramPercentiles(name);
    if (histPercentiles[name]) {
      histPercentiles[name].labels = h.labels;
    }
  }

  return {
    ts: Date.now(),
    sessionUptime: Date.now() - _sessionStartedAt,
    counters: JSON.parse(JSON.stringify(_counters)),
    gauges: JSON.parse(JSON.stringify(_gauges)),
    histograms: histPercentiles,
    feedbackStats: getFeedbackStats(),
    agentMesh: getAgentMeshHealth(),
    tracesSummary: {
      total: Object.keys(_traces).length,
      completed: Object.values(_traces).filter(t => t.endedAt).length,
      pending: Object.values(_traces).filter(t => !t.endedAt).length,
    },
  };
}

/**
 * Persist current telemetry state to disk.
 */
function saveSnapshot() {
  const snapshot = getSnapshot();

  // Save current state
  try {
    if (rio) {
      rio.writeJsonAtomic(STATE_FILE, snapshot);
    } else {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      const tmp = STATE_FILE + '.tmp.' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
      fs.renameSync(tmp, STATE_FILE);
    }
  } catch (err) {
    // Non-fatal
  }

  // Daily snapshot rotation
  try {
    const dateStr = new Date().toISOString().split('T')[0];
    const snapshotFile = path.join(SNAPSHOT_DIR, `telemetry-${dateStr}.json`);
    if (!fs.existsSync(snapshotFile)) {
      fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
      fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));

      // Trim old snapshots (keep last 30 days)
      try {
        const files = fs.readdirSync(SNAPSHOT_DIR).sort();
        if (files.length > 30) {
          for (const old of files.slice(0, files.length - 30)) {
            fs.unlinkSync(path.join(SNAPSHOT_DIR, old));
          }
        }
      } catch {}
    }
  } catch {}

  _lastSnapshotAt = Date.now();
}

/**
 * Load previous telemetry state (for continuity across restarts).
 */
function loadPreviousState() {
  try {
    let raw;
    if (rio) {
      raw = rio.readJsonSafe(STATE_FILE, { fallback: null });
    } else if (fs.existsSync(STATE_FILE)) {
      raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    if (!raw) return;

    // Restore counters (additive — don't lose current session)
    if (raw.counters) {
      for (const [name, data] of Object.entries(raw.counters)) {
        if (!_counters[name]) _counters[name] = { value: 0, labels: {} };
        _counters[name].value += data.value || 0;
      }
    }
  } catch {}
}

// ─── Auto-snapshot on interval ──────────────────────────────────────────────────

function maybeSnapshot() {
  if (Date.now() - _lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
    saveSnapshot();
  }
}

// ─── Convenience: Cycle Timer ───────────────────────────────────────────────────

/**
 * Create a cycle timer for measuring phase-by-phase execution.
 * @param {string} cycleName - Name of the cycle (e.g., 'orchestrator_cycle')
 * @returns {object} Timer with phase() and finish() methods
 */
function createCycleTimer(cycleName) {
  const cycleStart = Date.now();
  const phases = [];
  let currentPhase = null;

  return {
    /**
     * Start/end a named phase within the cycle.
     * @param {string} phaseName
     */
    phase(phaseName) {
      const now = Date.now();
      if (currentPhase) {
        currentPhase.durationMs = now - currentPhase.startedAt;
        phases.push(currentPhase);
        histogram(`cycle_phase_ms.${cycleName}.${currentPhase.name}`, currentPhase.durationMs);
      }
      currentPhase = { name: phaseName, startedAt: now, durationMs: null };
    },

    /**
     * Finish the cycle and record total duration.
     * @param {object} [metadata={}] - Cycle outcome metadata
     */
    finish(metadata = {}) {
      const now = Date.now();
      if (currentPhase) {
        currentPhase.durationMs = now - currentPhase.startedAt;
        phases.push(currentPhase);
        histogram(`cycle_phase_ms.${cycleName}.${currentPhase.name}`, currentPhase.durationMs);
      }

      const totalMs = now - cycleStart;
      histogram(`cycle_total_ms.${cycleName}`, totalMs);
      counter(`cycle_completed.${cycleName}`, metadata);

      maybeSnapshot();

      return {
        cycleName,
        totalMs,
        phases: phases.map(p => ({ name: p.name, durationMs: p.durationMs })),
        metadata,
      };
    },
  };
}

// ─── Prometheus Export ──────────────────────────────────────────────────────────

/**
 * Export all telemetry in Prometheus text format.
 */
function toPrometheus() {
  const lines = [];

  // Counters
  for (const [name, data] of Object.entries(_counters)) {
    const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_');
    lines.push(`# TYPE ff_${safeName}_total counter`);
    lines.push(`ff_${safeName}_total ${data.value}`);
  }

  // Gauges
  for (const [name, data] of Object.entries(_gauges)) {
    const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_');
    lines.push(`# TYPE ff_${safeName} gauge`);
    lines.push(`ff_${safeName} ${data.value}`);
  }

  // Histograms (as summary percentiles)
  for (const [name] of Object.entries(_histograms)) {
    const p = getHistogramPercentiles(name);
    if (!p) continue;
    const safeName = name.replace(/[^a-zA-Z0-9_]/g, '_');
    lines.push(`# TYPE ff_${safeName} summary`);
    lines.push(`ff_${safeName}{quantile="0.5"} ${p.p50}`);
    lines.push(`ff_${safeName}{quantile="0.9"} ${p.p90}`);
    lines.push(`ff_${safeName}{quantile="0.95"} ${p.p95}`);
    lines.push(`ff_${safeName}{quantile="0.99"} ${p.p99}`);
    lines.push(`ff_${safeName}_count ${p.count}`);
    lines.push(`ff_${safeName}_sum ${p.sum}`);
  }

  // Feedback loop
  const fb = getFeedbackStats();
  lines.push('# TYPE ff_feedback_improvement_rate gauge');
  lines.push(`ff_feedback_improvement_rate ${fb.improvementRate}`);
  lines.push('# TYPE ff_feedback_avg_delta gauge');
  lines.push(`ff_feedback_avg_delta ${fb.avgDelta}`);

  return lines.join('\n');
}

// ─── Initialize ─────────────────────────────────────────────────────────────────

loadPreviousState();

// ─── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  // Core metrics
  counter,
  getCounter,
  gauge,
  getGauge,
  histogram,
  getHistogramPercentiles,

  // Causal tracing
  startTrace,
  endTrace,
  getCompletedTraces,

  // Feedback loops
  recordFeedback,
  getFeedbackStats,

  // Decision quality
  recordDecisionQuality,

  // Agent mesh
  agentPing,
  getAgentMeshHealth,

  // Cycle timing
  createCycleTimer,

  // Snapshot & export
  getSnapshot,
  saveSnapshot,
  toPrometheus,
};
