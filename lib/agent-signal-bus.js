/**
 * Cross-agent shared signal bus.
 *
 * Enables any agent (venue-engine, continuous-learning, public-alpha, geo-watch,
 * data scouts, helper bots) to publish typed signals into a shared memory file
 * that other agents consume for better decision-making.
 *
 * Signals auto-expire after their TTL. Each signal has a source, confidence,
 * and payload. Consumers can query by type and minimum confidence.
 *
 * Usage:
 *   const bus = require('../lib/agent-signal-bus');
 *   bus.publish({ type: 'market_regime', source: 'continuous-learning', confidence: 0.85, payload: { regime: 'risk_off' } });
 *   const signals = bus.query({ type: 'market_regime', minConfidence: 0.6 });
 */

const fs = require('fs');
const path = require('path');

// Resilient I/O — atomic writes, backup recovery, file locking
let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

const SIGNAL_FILE = path.resolve(process.cwd(), process.env.AGENT_SIGNAL_BUS_FILE || 'data/agent-signal-bus.json');
const DEFAULT_TTL_MS = Math.max(60000, parseInt(process.env.AGENT_SIGNAL_TTL_MS || String(2 * 60 * 60 * 1000), 10));
const MAX_SIGNALS = Math.max(20, parseInt(process.env.AGENT_SIGNAL_MAX || '200', 10));

function load() {
  if (rio) {
    const raw = rio.readJsonSafe(SIGNAL_FILE, { fallback: [] });
    return Array.isArray(raw) ? raw : [];
  }
  try {
    if (!fs.existsSync(SIGNAL_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(SIGNAL_FILE, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function save(signals) {
  if (rio) { rio.writeJsonAtomic(SIGNAL_FILE, signals); return; }
  fs.mkdirSync(path.dirname(SIGNAL_FILE), { recursive: true });
  fs.writeFileSync(SIGNAL_FILE, JSON.stringify(signals, null, 2));
}

function prune(signals) {
  const now = Date.now();
  return signals.filter((s) => {
    const expiresAt = Number(s.publishedAt || 0) + Number(s.ttlMs || DEFAULT_TTL_MS);
    return expiresAt > now;
  });
}

/**
 * Publish a signal to the bus.
 * @param {object} signal
 * @param {string} signal.type - Signal category (e.g. 'market_regime', 'geo_risk', 'venue_health', 'alpha_signal')
 * @param {string} signal.source - Agent name that produced the signal
 * @param {number} signal.confidence - 0-1 confidence score
 * @param {object} signal.payload - Arbitrary data
 * @param {number} [signal.ttlMs] - Custom TTL in ms (default: AGENT_SIGNAL_TTL_MS)
 */
function publish(signal) {
  const entry = {
    id: `${signal.source || 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: String(signal.type || 'unknown'),
    source: String(signal.source || 'unknown'),
    confidence: Number(signal.confidence || 0),
    payload: signal.payload || {},
    ttlMs: Number(signal.ttlMs || DEFAULT_TTL_MS),
    publishedAt: Date.now(),
  };

  if (rio) {
    // Atomic read-modify-write with locking
    rio.lockedUpdate(SIGNAL_FILE, (raw) => {
      const signals = prune(Array.isArray(raw) ? raw : []);
      signals.push(entry);
      return signals.length > MAX_SIGNALS ? signals.slice(-MAX_SIGNALS) : signals;
    }, []);
  } else {
    const signals = prune(load());
    signals.push(entry);
    const trimmed = signals.length > MAX_SIGNALS ? signals.slice(-MAX_SIGNALS) : signals;
    save(trimmed);
  }

  return entry;
}

/**
 * Query live (non-expired) signals.
 * @param {object} [filter]
 * @param {string} [filter.type] - Filter by signal type
 * @param {string} [filter.source] - Filter by source agent
 * @param {number} [filter.minConfidence] - Minimum confidence threshold
 * @param {number} [filter.maxAgeMs] - Maximum age in ms
 * @returns {Array} Matching signals sorted newest-first
 */
function query(filter = {}) {
  const signals = prune(load());
  const now = Date.now();
  return signals
    .filter((s) => {
      if (filter.type && s.type !== filter.type) return false;
      if (filter.source && s.source !== filter.source) return false;
      if (filter.minConfidence != null && s.confidence < filter.minConfidence) return false;
      if (filter.maxAgeMs != null && now - s.publishedAt > filter.maxAgeMs) return false;
      return true;
    })
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

/**
 * Get consensus signal: the most common payload value for a type, weighted by confidence.
 * @param {string} type
 * @returns {{ value: string|null, confidence: number, count: number }}
 */
function consensus(type) {
  const signals = query({ type });
  if (!signals.length) return { value: null, confidence: 0, count: 0 };

  const buckets = {};
  for (const s of signals) {
    const key = JSON.stringify(s.payload);
    if (!buckets[key]) buckets[key] = { weight: 0, count: 0, payload: s.payload };
    buckets[key].weight += s.confidence;
    buckets[key].count += 1;
  }

  const best = Object.values(buckets).sort((a, b) => b.weight - a.weight)[0];
  return {
    value: best.payload,
    confidence: Number((best.weight / signals.length).toFixed(4)),
    count: best.count,
  };
}

/**
 * Return a compact summary of all active signal types and counts.
 */
function summary() {
  const signals = prune(load());
  const types = {};
  for (const s of signals) {
    if (!types[s.type]) types[s.type] = { count: 0, avgConfidence: 0, sources: new Set() };
    types[s.type].count += 1;
    types[s.type].avgConfidence += s.confidence;
    types[s.type].sources.add(s.source);
  }
  for (const t of Object.values(types)) {
    t.avgConfidence = Number((t.avgConfidence / t.count).toFixed(4));
    t.sources = [...t.sources];
  }
  return { totalSignals: signals.length, types };
}

module.exports = { publish, query, consensus, summary, SIGNAL_FILE };
