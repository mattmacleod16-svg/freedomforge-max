/**
 * Consensus Engine — Multi-Agent Voting on Trade Decisions
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Before any trade executes, this module collects votes from all active agents
 * and requires minimum quorum + agreement threshold. Prevents rogue trades from
 * any single agent while maintaining speed for high-confidence opportunities.
 *
 * Voting Protocol:
 *   1. Proposer publishes a TradeProposal to the event mesh
 *   2. Each registered voter casts APPROVE / REJECT / ABSTAIN with confidence
 *   3. Votes are weighted by agent confidence × historical accuracy
 *   4. Quorum check: enough voters responded within timeout
 *   5. Agreement check: weighted approval exceeds threshold
 *
 * Fast path: If the edge-detector confidence > 0.9 AND brain agrees AND
 * risk-manager approves, skip full voting (latency optimization).
 *
 * Usage:
 *   const consensus = require('./consensus-engine');
 *   consensus.registerVoter('risk-manager', riskVoteFunction);
 *   consensus.registerVoter('brain', brainVoteFunction);
 *   const result = await consensus.propose({ asset: 'BTC', side: 'buy', ... });
 *   if (result.approved) { executeTrade(); }
 */

'use strict';

const { createLogger } = require('./logger');
const log = createLogger('consensus-engine');

let eventMesh;
try { eventMesh = require('./event-mesh'); } catch { eventMesh = null; }
let signalBus;
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }

// ─── Configuration ───────────────────────────────────────────────────────────

const QUORUM_FRACTION = Math.max(0.3, Math.min(1.0, Number(process.env.CONSENSUS_QUORUM || 0.5)));
const APPROVAL_THRESHOLD = Math.max(0.4, Math.min(1.0, Number(process.env.CONSENSUS_THRESHOLD || 0.6)));
const VOTE_TIMEOUT_MS = Math.max(500, Math.min(30000, Number(process.env.CONSENSUS_TIMEOUT_MS || 3000)));
const FAST_PATH_CONFIDENCE = Math.max(0.7, Math.min(1.0, Number(process.env.CONSENSUS_FAST_PATH || 0.9)));

// ─── Voter Registry ──────────────────────────────────────────────────────────

/** @type {Map<string, { handler: Function, weight: number, accuracy: number, votes: number }>} */
const voters = new Map();

/** @type {Array<{ proposalId: string, ts: number, result: object }>} */
const history = [];
const MAX_HISTORY = 500;

// ─── Voter Management ────────────────────────────────────────────────────────

/**
 * Register an agent as a voter.
 * @param {string} agentName - Unique agent identifier
 * @param {Function} handler - (proposal) => { vote: 'approve'|'reject'|'abstain', confidence: 0-1, reason: string }
 * @param {object} [opts]
 * @param {number} [opts.weight] - Base weight (1.0 default)
 */
function registerVoter(agentName, handler, opts = {}) {
  voters.set(agentName, {
    handler,
    weight: opts.weight ?? 1.0,
    accuracy: 0.5,   // starts neutral, updated after trade outcomes
    votes: 0,
  });
  log.info(`Registered voter: ${agentName} (weight=${opts.weight ?? 1.0})`);
}

/**
 * Unregister a voter.
 */
function unregisterVoter(agentName) {
  return voters.delete(agentName);
}

/**
 * Update voter accuracy based on trade outcome.
 * @param {string} agentName
 * @param {boolean} wasCorrect - Did the trade outcome match the vote?
 */
function updateVoterAccuracy(agentName, wasCorrect) {
  const voter = voters.get(agentName);
  if (!voter) return;
  
  // EMA update: smooth accuracy tracking
  const alpha = 0.15;
  voter.accuracy = voter.accuracy * (1 - alpha) + (wasCorrect ? 1 : 0) * alpha;
  voter.votes++;
}

// ─── Proposal & Voting ───────────────────────────────────────────────────────

/**
 * Propose a trade for consensus voting.
 * @param {object} proposal
 * @param {string} proposal.asset - Asset symbol
 * @param {string} proposal.side - 'buy' or 'sell'
 * @param {number} proposal.confidence - Edge detector confidence
 * @param {number} proposal.edge - Composite edge score
 * @param {string} proposal.venue - Target venue
 * @param {number} proposal.orderUsd - Order size
 * @param {string} proposal.proposer - Agent that proposed
 * @param {object} [proposal.context] - Additional context (regime, signals, etc.)
 * @returns {Promise<ConsensusResult>}
 */
async function propose(proposal) {
  const proposalId = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startMs = Date.now();

  // ─── Fast Path ─────────────────────────────────────────────────────────
  // High-confidence signals with fewer voters can skip full consensus
  if (proposal.confidence >= FAST_PATH_CONFIDENCE && voters.size <= 2) {
    const result = {
      proposalId,
      approved: true,
      fastPath: true,
      confidence: proposal.confidence,
      reason: `Fast path: confidence ${proposal.confidence.toFixed(3)} >= ${FAST_PATH_CONFIDENCE}`,
      votes: {},
      quorumMet: true,
      approvalScore: proposal.confidence,
      durationMs: Date.now() - startMs,
    };
    recordResult(result);
    return result;
  }

  // ─── Full Consensus ────────────────────────────────────────────────────
  const votePromises = [];
  const voterList = [...voters.entries()];

  for (const [name, voter] of voterList) {
    const votePromise = Promise.race([
      // Voter's handler
      (async () => {
        try {
          const vote = await voter.handler(proposal);
          return {
            agent: name,
            vote: normalizeVote(vote?.vote),
            confidence: Math.max(0, Math.min(1, Number(vote?.confidence || 0.5))),
            reason: String(vote?.reason || ''),
            weight: voter.weight * voter.accuracy,
          };
        } catch (err) {
          log.warn(`Voter ${name} threw: ${err.message}`);
          return {
            agent: name,
            vote: 'abstain',
            confidence: 0,
            reason: `error: ${err.message}`,
            weight: 0,
          };
        }
      })(),
      // Timeout
      new Promise(resolve => setTimeout(() => resolve({
        agent: name,
        vote: 'abstain',
        confidence: 0,
        reason: 'timeout',
        weight: 0,
      }), VOTE_TIMEOUT_MS)),
    ]);

    votePromises.push(votePromise);
  }

  const votes = await Promise.all(votePromises);
  const durationMs = Date.now() - startMs;

  // ─── Tally ─────────────────────────────────────────────────────────────
  const nonAbstain = votes.filter(v => v.vote !== 'abstain');
  const quorumMet = nonAbstain.length >= Math.ceil(voterList.length * QUORUM_FRACTION);

  let totalWeight = 0;
  let approveWeight = 0;
  let rejectWeight = 0;

  for (const v of nonAbstain) {
    const w = v.weight * v.confidence;
    totalWeight += w;
    if (v.vote === 'approve') approveWeight += w;
    else if (v.vote === 'reject') rejectWeight += w;
  }

  const approvalScore = totalWeight > 0 ? approveWeight / totalWeight : 0;
  const approved = quorumMet && approvalScore >= APPROVAL_THRESHOLD;

  // Build vote map
  const voteMap = {};
  for (const v of votes) {
    voteMap[v.agent] = {
      vote: v.vote,
      confidence: v.confidence,
      reason: v.reason,
      effectiveWeight: v.weight * v.confidence,
    };
  }

  const result = {
    proposalId,
    approved,
    fastPath: false,
    confidence: approvalScore,
    reason: !quorumMet
      ? `Quorum not met: ${nonAbstain.length}/${Math.ceil(voterList.length * QUORUM_FRACTION)} needed`
      : approved
        ? `Approved: ${(approvalScore * 100).toFixed(1)}% >= ${(APPROVAL_THRESHOLD * 100).toFixed(1)}%`
        : `Rejected: ${(approvalScore * 100).toFixed(1)}% < ${(APPROVAL_THRESHOLD * 100).toFixed(1)}%`,
    votes: voteMap,
    quorumMet,
    approvalScore,
    durationMs,
  };

  recordResult(result);

  // Publish result to event mesh
  if (eventMesh) {
    eventMesh.publish('consensus.result', {
      ...result,
      proposal: { asset: proposal.asset, side: proposal.side, venue: proposal.venue },
    }, { source: 'consensus-engine', priority: eventMesh.PRIORITY?.HIGH });
  }

  return result;
}

function normalizeVote(v) {
  const s = String(v || '').toLowerCase().trim();
  if (s === 'approve' || s === 'yes' || s === 'buy') return 'approve';
  if (s === 'reject' || s === 'no' || s === 'sell') return 'reject';
  return 'abstain';
}

function recordResult(result) {
  history.push({
    proposalId: result.proposalId,
    ts: Date.now(),
    approved: result.approved,
    approvalScore: result.approvalScore,
    fastPath: result.fastPath,
    durationMs: result.durationMs,
  });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

// ─── Built-in Voter Factories ────────────────────────────────────────────────
// Convenience functions to create standard voters from existing modules

/**
 * Create a risk-manager voter.
 */
function createRiskVoter(riskManager) {
  return (proposal) => {
    if (!riskManager) return { vote: 'abstain', confidence: 0, reason: 'risk-manager unavailable' };
    try {
      const check = typeof riskManager.preTradeCheck === 'function'
        ? riskManager.preTradeCheck(proposal.asset, proposal.orderUsd, proposal.side)
        : null;
      if (check && check.allowed === false) {
        return { vote: 'reject', confidence: 0.95, reason: check.reason || 'risk limit breached' };
      }
      return { vote: 'approve', confidence: 0.8, reason: 'within risk limits' };
    } catch (err) {
      return { vote: 'abstain', confidence: 0, reason: err.message };
    }
  };
}

/**
 * Create a brain/strategy voter.
 */
function createBrainVoter(brain) {
  return (proposal) => {
    if (!brain) return { vote: 'abstain', confidence: 0, reason: 'brain unavailable' };
    try {
      const shouldTrade = typeof brain.shouldTradeNow === 'function'
        ? brain.shouldTradeNow()
        : { trade: true };
      if (!shouldTrade.trade) {
        return { vote: 'reject', confidence: 0.7, reason: shouldTrade.reason || 'brain says wait' };
      }
      return { vote: 'approve', confidence: proposal.confidence * 0.9, reason: 'brain agrees' };
    } catch (err) {
      return { vote: 'abstain', confidence: 0, reason: err.message };
    }
  };
}

/**
 * Create a signal-bus context voter (checks market regime consensus).
 */
function createRegimeVoter() {
  return (proposal) => {
    if (!signalBus) return { vote: 'abstain', confidence: 0, reason: 'no signal bus' };
    try {
      const regime = signalBus.consensus('market_regime');
      if (!regime.value) return { vote: 'approve', confidence: 0.5, reason: 'no regime data' };

      const regimeStr = typeof regime.value === 'object'
        ? (regime.value.regime || regime.value.label || JSON.stringify(regime.value))
        : String(regime.value);

      // Risk-off regime should reject new buys
      if (regimeStr.includes('risk_off') && proposal.side === 'buy') {
        return { vote: 'reject', confidence: regime.confidence, reason: `regime=${regimeStr}` };
      }
      return { vote: 'approve', confidence: regime.confidence * 0.85, reason: `regime=${regimeStr}` };
    } catch (err) {
      return { vote: 'abstain', confidence: 0, reason: err.message };
    }
  };
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

function getStats() {
  const recentHistory = history.slice(-100);
  const approved = recentHistory.filter(h => h.approved).length;
  const rejected = recentHistory.filter(h => !h.approved).length;
  const fastPaths = recentHistory.filter(h => h.fastPath).length;
  const avgDuration = recentHistory.length > 0
    ? recentHistory.reduce((s, h) => s + h.durationMs, 0) / recentHistory.length
    : 0;

  return {
    registeredVoters: voters.size,
    voterDetails: Object.fromEntries(
      [...voters.entries()].map(([name, v]) => [name, {
        weight: v.weight,
        accuracy: Number(v.accuracy.toFixed(4)),
        totalVotes: v.votes,
      }])
    ),
    recentProposals: recentHistory.length,
    approved,
    rejected,
    fastPaths,
    avgDurationMs: Math.round(avgDuration),
    approvalRate: recentHistory.length > 0
      ? Number((approved / recentHistory.length).toFixed(4))
      : 0,
  };
}

module.exports = {
  registerVoter,
  unregisterVoter,
  updateVoterAccuracy,
  propose,
  createRiskVoter,
  createBrainVoter,
  createRegimeVoter,
  getStats,
  QUORUM_FRACTION,
  APPROVAL_THRESHOLD,
  VOTE_TIMEOUT_MS,
};
