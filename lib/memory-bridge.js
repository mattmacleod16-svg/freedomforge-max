/**
 * Memory Bridge — Automatic Trade Outcome → Episodic Memory Recording
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Bridges the gap between the JS trading loop (exit-manager, trade-journal)
 * and the TS intelligence layer (memoryEngine.ts). Every closed trade gets
 * recorded as an episodic memory so the adaptive cortex and champion policy
 * can learn from actual outcomes.
 *
 * Also feeds back voter accuracy to the consensus engine so voter weights
 * self-calibrate over time.
 *
 * Architecture:
 *   exit-manager → trade-journal → memory-bridge → episodic-memory.json
 *                                                → consensus-engine voter updates
 *                                                → event-mesh 'memory.recorded'
 *
 * Runs as:
 *   1. Periodic scan (every 60s) of trade journal for new outcomes
 *   2. Event-driven via event-mesh subscription to 'trade.closed'
 *
 * Usage:
 *   const memBridge = require('./memory-bridge');
 *   memBridge.start();  // begins periodic scanning
 *   memBridge.processTradeOutcome(trade);  // or direct invocation
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('./logger');
const log = createLogger('memory-bridge');

let tradeJournal, eventMesh, signalBus, consensusEngine;
try { tradeJournal = require('./trade-journal'); } catch { tradeJournal = null; }
try { eventMesh = require('./event-mesh'); } catch { eventMesh = null; }
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }
try { consensusEngine = require('./consensus-engine'); } catch { consensusEngine = null; }

// Resilient I/O
let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

// ─── Configuration ───────────────────────────────────────────────────────────

const MEMORY_FILE = path.resolve(process.cwd(),
  (process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL) ? '/tmp/freedomforge-data/episodic-memory.json' : 'data/episodic-memory.json');
const SCAN_INTERVAL_MS = Math.max(30000, Number(process.env.MEMORY_BRIDGE_INTERVAL_MS || 60000));
const MAX_EPISODES = Math.max(500, Number(process.env.MEMORY_MAX_EPISODES || 6000));
const VECTOR_DIM = 96;

// ─── State ───────────────────────────────────────────────────────────────────

let processedTradeIds = new Set();
let scanTimer = null;
let totalRecorded = 0;

// ─── Memory File I/O ─────────────────────────────────────────────────────────

function loadMemory() {
  try {
    if (rio) {
      const raw = rio.readJsonSafe(MEMORY_FILE, { fallback: { episodes: [], updatedAt: 0 } });
      return raw && Array.isArray(raw.episodes) ? raw : { episodes: [], updatedAt: 0 };
    }
    if (!fs.existsSync(MEMORY_FILE)) return { episodes: [], updatedAt: 0 };
    const raw = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
    return raw && Array.isArray(raw.episodes) ? raw : { episodes: [], updatedAt: 0 };
  } catch {
    return { episodes: [], updatedAt: 0 };
  }
}

function saveMemory(state) {
  try {
    const dir = path.dirname(MEMORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Enforce max episodes (keep most recent)
    if (state.episodes.length > MAX_EPISODES) {
      state.episodes = state.episodes.slice(-MAX_EPISODES);
    }
    state.updatedAt = Date.now();

    if (rio) {
      rio.writeJsonAtomic(MEMORY_FILE, state);
    } else {
      const tmp = MEMORY_FILE + '.tmp.' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, MEMORY_FILE);
    }
  } catch (err) {
    log.error(`saveMemory failed: ${err.message}`);
  }
}

// ─── Embedding Generation ────────────────────────────────────────────────────

function generateEmbedding(text) {
  // Simple hash-based embedding (same algo as memoryEngine.ts)
  const hash = crypto.createHash('sha512').update(text).digest();
  const vec = new Array(VECTOR_DIM);
  for (let i = 0; i < VECTOR_DIM; i++) {
    vec[i] = ((hash[i % hash.length] / 255) * 2 - 1);
  }
  // Normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => Number((v / norm).toFixed(6)));
}

// ─── Trade → Episode Conversion ──────────────────────────────────────────────

/**
 * Convert a closed trade into an episodic memory episode.
 * @param {object} trade - Trade journal entry with outcome
 * @returns {object|null} Episode or null if invalid
 */
function tradeToEpisode(trade) {
  if (!trade || trade.outcome == null) return null;

  const pnl = Number(trade.realizedPnl || trade.pnl || 0);
  const side = String(trade.side || 'buy').toLowerCase();
  const asset = String(trade.asset || trade.pair || 'UNKNOWN').toUpperCase();
  const venue = String(trade.venue || 'unknown');
  const confidence = Number(trade.confidence || trade.entryConfidence || 0.5);

  // Determine regime from signal bus context at time of trade
  let regime = 'unknown';
  if (signalBus) {
    try {
      const regimeSignal = signalBus.consensus('market_regime');
      if (regimeSignal.value) {
        const r = typeof regimeSignal.value === 'object'
          ? (regimeSignal.value.regime || 'unknown')
          : String(regimeSignal.value);
        if (r.includes('risk_on')) regime = 'risk_on';
        else if (r.includes('risk_off')) regime = 'risk_off';
        else if (r.includes('neutral')) regime = 'neutral';
      }
    } catch { /* non-critical */ }
  }

  // Reward: map P&L to [-1, 1] range
  const reward = Math.max(-1, Math.min(1, pnl / Math.max(1, Number(trade.orderUsd || trade.entryValue || 50))));

  const query = `${side} ${asset} on ${venue} at confidence ${confidence.toFixed(3)}`;
  const responseSummary = `${trade.outcome}: PnL=${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} via ${venue}, regime=${regime}`;

  const tags = [
    asset.toLowerCase(),
    side,
    venue,
    regime,
    trade.outcome === 'win' ? 'profitable' : 'loss',
    confidence > 0.8 ? 'high_confidence' : confidence > 0.5 ? 'mid_confidence' : 'low_confidence',
  ];

  const episode = {
    id: `mem_${trade.id || Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: trade.closedAt || trade.exitTimestamp || Date.now(),
    query,
    responseSummary,
    regime,
    reward,
    confidence,
    riskScore: Number(trade.riskScore || 0.5),
    forecastProbability: Number(trade.forecastProb || confidence),
    forecastBrier: 0, // Updated when forecast resolves
    tags,
    sources: [venue, 'exit-manager', 'memory-bridge'],
    embedding: generateEmbedding(`${query} ${responseSummary} ${tags.join(' ')}`),
  };

  return episode;
}

// ─── Processing ──────────────────────────────────────────────────────────────

/**
 * Process a single trade outcome into memory.
 * @param {object} trade
 * @returns {boolean} true if recorded
 */
function processTradeOutcome(trade) {
  const tradeId = trade.id || `${trade.asset}_${trade.entryTimestamp}`;
  if (processedTradeIds.has(tradeId)) return false;

  const episode = tradeToEpisode(trade);
  if (!episode) return false;

  const memory = loadMemory();
  memory.episodes.push(episode);
  saveMemory(memory);

  processedTradeIds.add(tradeId);
  totalRecorded++;

  // Update consensus engine voter accuracy
  if (consensusEngine && trade.consensusVotes) {
    const wasWin = trade.outcome === 'win';
    for (const [voter, voteData] of Object.entries(trade.consensusVotes)) {
      const votedApprove = voteData.vote === 'approve';
      // Correct = approved a win OR rejected a loss
      const wasCorrect = (votedApprove && wasWin) || (!votedApprove && !wasWin);
      consensusEngine.updateVoterAccuracy(voter, wasCorrect);
    }
  }

  // Publish event
  if (eventMesh) {
    eventMesh.publish('memory.recorded', {
      episodeId: episode.id,
      asset: trade.asset,
      outcome: trade.outcome,
      pnl: trade.realizedPnl || trade.pnl,
      regime: episode.regime,
    }, { source: 'memory-bridge' });
  }

  log.info(`Recorded episode: ${episode.id} [${trade.asset} ${trade.outcome}]`);
  return true;
}

/**
 * Scan trade journal for unprocessed closed trades.
 */
function scanJournal() {
  if (!tradeJournal) return { scanned: 0, recorded: 0 };

  try {
    const trades = typeof tradeJournal.loadTrades === 'function'
      ? tradeJournal.loadTrades()
      : [];
    
    let recorded = 0;
    for (const trade of trades) {
      // Only process completed trades with outcomes
      if (trade.outcome == null || trade.outcome === '') continue;
      if (processTradeOutcome(trade)) recorded++;
    }

    return { scanned: trades.length, recorded };
  } catch (err) {
    log.error(`Journal scan failed: ${err.message}`);
    return { scanned: 0, recorded: 0, error: err.message };
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Start periodic journal scanning and event mesh subscription.
 */
function start() {
  // Initial scan
  const initial = scanJournal();
  log.info(`Initial scan: ${initial.scanned} trades, ${initial.recorded} new episodes recorded`);

  // Subscribe to trade.closed events from event mesh
  if (eventMesh) {
    eventMesh.subscribe('trade.closed', (msg) => {
      processTradeOutcome(msg.payload);
    });
    log.info('Subscribed to trade.closed events');
  }

  // Periodic scan
  if (!scanTimer) {
    scanTimer = setInterval(() => {
      const result = scanJournal();
      if (result.recorded > 0) {
        log.info(`Periodic scan: ${result.recorded} new episodes recorded`);
      }
    }, SCAN_INTERVAL_MS);
    // Don't block process exit
    if (scanTimer.unref) scanTimer.unref();
  }

  return initial;
}

/**
 * Stop periodic scanning.
 */
function stop() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}

/**
 * Get memory bridge stats.
 */
function getStats() {
  const memory = loadMemory();
  const recentEpisodes = memory.episodes.slice(-10);

  return {
    totalEpisodes: memory.episodes.length,
    totalRecordedThisSession: totalRecorded,
    processedTradeIds: processedTradeIds.size,
    scanIntervalMs: SCAN_INTERVAL_MS,
    recentEpisodes: recentEpisodes.map(e => ({
      id: e.id,
      ts: e.ts,
      regime: e.regime,
      reward: e.reward,
      tags: e.tags,
    })),
    memoryFileExists: fs.existsSync(MEMORY_FILE),
  };
}

module.exports = {
  processTradeOutcome,
  scanJournal,
  start,
  stop,
  getStats,
  tradeToEpisode,
  SCAN_INTERVAL_MS,
};
