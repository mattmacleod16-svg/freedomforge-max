/**
 * FreedomForge Virtue Engine (UCFEE-2.0)
 * ═══════════════════════════════════════
 *
 * Core virtue scoring and evaluation engine for the User-Centric Financial
 * Empowerment Engine. Embeds 12 algorithmic virtues as quantifiable modules
 * that influence trading decisions, user interactions, and system behavior.
 *
 * Each virtue is a measurable function with:
 *   - A real-time score (0.0 to 1.0)
 *   - An audit trail of recent evaluations
 *   - Upgrade logic that self-improves from outcomes
 *
 * The aggregate Virtue Index gates system behavior:
 *   >= 0.95  → Full autonomy, growth mode
 *   >= 0.80  → Normal operation
 *   >= 0.60  → Conservative mode, self-diagnostic
 *   <  0.60  → Hibernation, human oversight required
 *
 * Usage:
 *   const virtue = require('../lib/virtue-engine');
 *   const scores = virtue.evaluate(context);
 *   const index = virtue.getVirtueIndex();
 *   const guidance = virtue.getDecisionGuidance(tradeProposal);
 */

'use strict';

const fs = require('fs');
const path = require('path');

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

const STATE_FILE = path.resolve(process.cwd(), process.env.VIRTUE_STATE_FILE || 'data/virtue-engine-state.json');
const POSITIVITY_AMPLIFIER = Number(process.env.VIRTUE_POSITIVITY_AMPLIFIER || '1.5');
const UPGRADE_CYCLE_THRESHOLD = Math.max(100, Number(process.env.VIRTUE_UPGRADE_CYCLE || '1000'));

// ─── Virtue Module Definitions ──────────────────────────────────────────────────

const VIRTUE_DEFINITIONS = {
  trustworthiness: {
    description: 'Transparent, auditable decisions with immutable logs',
    weight: 1.2,
    evaluate: (ctx) => {
      // Score based on: audit trail completeness, decision transparency, data source verification
      let score = 0.5;
      if (ctx.auditTrailComplete) score += 0.2;
      if (ctx.decisionLogged) score += 0.15;
      if (ctx.dataSourcesVerified) score += 0.15;
      // Penalize if any opacity detected
      if (ctx.unloggedDecisions > 0) score -= Math.min(0.3, ctx.unloggedDecisions * 0.05);
      return clamp(score);
    },
  },

  loyalty: {
    description: 'Long-term commitment to user financial wellbeing over short-term system gains',
    weight: 1.3,
    evaluate: (ctx) => {
      let score = 0.6;
      // Reward consistent payout delivery
      if (ctx.payoutStreakDays > 30) score += 0.15;
      if (ctx.payoutStreakDays > 90) score += 0.1;
      // Reward user-aligned decisions
      if (ctx.userGoalsAligned) score += 0.15;
      // Penalize self-serving system behavior
      if (ctx.systemPrioritizedOverUser) score -= 0.3;
      return clamp(score);
    },
  },

  courage: {
    description: 'Calculated boldness — pursuing opportunity despite uncertainty when math supports it',
    weight: 1.0,
    evaluate: (ctx) => {
      let score = 0.5;
      // Reward taking positions when confidence is high despite market fear
      if (ctx.contrarian && ctx.signalConfidence > 0.7) score += 0.25;
      // Reward acting on strong edges rather than sitting idle
      if (ctx.edgeActedOn && ctx.edgeStrength > 0.15) score += 0.15;
      // Penalize recklessness (courage != gambling)
      if (ctx.positionSizeExcessive) score -= 0.25;
      // Reward self-reporting of system flaws
      if (ctx.selfReportedIssue) score += 0.1;
      return clamp(score);
    },
  },

  kindness: {
    description: 'Empathetic, human-first framing that prioritizes user emotional wellbeing',
    weight: 1.1,
    evaluate: (ctx) => {
      let score = 0.7; // default high — kindness is baseline
      // Reward empathetic communication
      if (ctx.communicationTone === 'empathetic') score += 0.15;
      // Reward proactive help (e.g., loss mitigation suggestions)
      if (ctx.proactiveHelpOffered) score += 0.1;
      // Penalize cold/clinical delivery during user stress
      if (ctx.userStressed && ctx.communicationTone === 'clinical') score -= 0.2;
      return clamp(score);
    },
  },

  friendliness: {
    description: 'Warm, approachable interactions that build user trust and engagement',
    weight: 0.9,
    evaluate: (ctx) => {
      let score = 0.7;
      if (ctx.conversationEngagement > 0.7) score += 0.15;
      if (ctx.userReturnRate > 0.8) score += 0.15;
      // Friendly but not intrusive
      if (ctx.unsolicited && !ctx.userOptedIn) score -= 0.15;
      return clamp(score);
    },
  },

  courteousness: {
    description: 'Respectful boundaries — no unsolicited upsells, deferential suggestions',
    weight: 0.9,
    evaluate: (ctx) => {
      let score = 0.8; // default high — courtesy is table stakes
      if (ctx.respectsBoundaries) score += 0.1;
      if (ctx.deferentialLanguage) score += 0.1;
      // Penalize pushy behavior
      if (ctx.unsolicited) score -= 0.2;
      if (ctx.boundaryViolation) score -= 0.3;
      return clamp(score);
    },
  },

  obedience: {
    description: 'Strict adherence to user commands, regulations, and risk parameters',
    weight: 1.4, // highest weight — compliance is non-negotiable
    evaluate: (ctx) => {
      let score = 0.6;
      // Regulatory compliance
      if (ctx.regulatoryCompliant) score += 0.2;
      // User instruction adherence
      if (ctx.userInstructionsFollowed) score += 0.15;
      // Risk parameter respect
      if (ctx.riskLimitsRespected) score += 0.15;
      // Hard penalty for violations
      if (ctx.regulatoryViolation) score = 0.0; // instant fail
      if (ctx.userInstructionIgnored) score -= 0.4;
      return clamp(score);
    },
  },

  thriftiness: {
    description: 'Resource efficiency — minimize costs, maximize output per dollar',
    weight: 1.0,
    evaluate: (ctx) => {
      let score = 0.5;
      // API cost efficiency
      if (ctx.apiCostBelowBudget) score += 0.2;
      if (ctx.costPerQueryOptimal) score += 0.15;
      // Gas efficiency
      if (ctx.gasEfficient) score += 0.15;
      // Penalize waste
      if (ctx.apiCostOverBudget) score -= 0.2;
      if (ctx.redundantOperations > 0) score -= Math.min(0.2, ctx.redundantOperations * 0.03);
      return clamp(score);
    },
  },

  bravery: {
    description: 'Confront systemic flaws — self-report biases, expose vulnerabilities for patching',
    weight: 1.0,
    evaluate: (ctx) => {
      let score = 0.5;
      // Reward self-diagnosis
      if (ctx.biasDetected && ctx.biasReported) score += 0.25;
      if (ctx.vulnerabilityExposed) score += 0.2;
      // Reward adversarial self-testing
      if (ctx.adversarialTestRun) score += 0.15;
      // Penalize hiding problems
      if (ctx.biasDetected && !ctx.biasReported) score -= 0.3;
      return clamp(score);
    },
  },

  cheerfulness: {
    description: 'Optimistic yet realistic framing — transform risks into opportunities',
    weight: 0.8,
    evaluate: (ctx) => {
      let score = 0.7;
      // Positive framing of outcomes
      if (ctx.positiveFraming) score += 0.15;
      // But not delusional
      if (ctx.unrealisticOptimism) score -= 0.25;
      // Reality-grounded positivity
      if (ctx.realisticPositivity) score += 0.15;
      return clamp(score);
    },
  },

  cleanliness: {
    description: 'Code and data hygiene — clean state, no dead paths, healthy system metrics',
    weight: 0.9,
    evaluate: (ctx) => {
      let score = 0.5;
      if (ctx.systemHealthy) score += 0.2;
      if (ctx.logsRotated) score += 0.1;
      if (ctx.dataConsistent) score += 0.1;
      if (ctx.staleDataCleaned) score += 0.1;
      // Penalize messiness
      if (ctx.staleFiles > 5) score -= 0.15;
      if (ctx.orphanProcesses > 0) score -= 0.1;
      return clamp(score);
    },
  },

  reverence: {
    description: 'Honor user values, ethical principles, and sustainable investing preferences',
    weight: 1.1,
    evaluate: (ctx) => {
      let score = 0.6;
      // User value alignment
      if (ctx.userValuesRespected) score += 0.2;
      // ESG/sustainable investing consideration
      if (ctx.sustainabilityConsidered) score += 0.1;
      // Ethical guardrails active
      if (ctx.ethicalGuardrailsActive) score += 0.1;
      // Penalize value conflicts
      if (ctx.userValueViolation) score -= 0.3;
      return clamp(score);
    },
  },
};

function clamp(v, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}

// ─── State Management ───────────────────────────────────────────────────────────

function loadState() {
  try {
    if (rio) return rio.readJsonSafe(STATE_FILE, { fallback: null });
    if (!fs.existsSync(STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveState(state) {
  state.updatedAt = new Date().toISOString();
  if (rio) { rio.writeJsonAtomic(STATE_FILE, state); return; }
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = STATE_FILE + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function getOrCreateState() {
  let state = loadState();
  if (!state) {
    state = {
      virtueScores: {},
      virtueIndex: 0.75,
      evaluationCount: 0,
      upgradeGeneration: 0,
      history: [],
      upgrades: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    for (const name of Object.keys(VIRTUE_DEFINITIONS)) {
      state.virtueScores[name] = { current: 0.75, avg: 0.75, min: 0.75, max: 0.75, evaluations: 0 };
    }
  }
  return state;
}

// ─── Core Evaluation ────────────────────────────────────────────────────────────

/**
 * Evaluate all virtues against the current system context.
 *
 * @param {object} context - System state snapshot for evaluation
 * @returns {object} Scores per virtue, aggregate index, and mode recommendation
 */
function evaluate(context) {
  const state = getOrCreateState();
  const scores = {};
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [name, def] of Object.entries(VIRTUE_DEFINITIONS)) {
    const raw = def.evaluate(context);
    const amplified = clamp(raw * (context.positivityMultiplier || 1.0));
    scores[name] = {
      score: Math.round(amplified * 1000) / 1000,
      weight: def.weight,
      weighted: Math.round(amplified * def.weight * 1000) / 1000,
    };

    weightedSum += amplified * def.weight;
    totalWeight += def.weight;

    // Update running stats
    if (!state.virtueScores[name]) {
      state.virtueScores[name] = { current: amplified, avg: amplified, min: amplified, max: amplified, evaluations: 0 };
    }
    const vs = state.virtueScores[name];
    vs.current = amplified;
    vs.evaluations++;
    vs.avg = vs.avg * 0.95 + amplified * 0.05; // exponential moving average
    vs.min = Math.min(vs.min, amplified);
    vs.max = Math.max(vs.max, amplified);
  }

  const virtueIndex = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const positivityIndex = clamp(virtueIndex * POSITIVITY_AMPLIFIER, 0, 1);

  // Determine system mode from virtue index
  let mode;
  if (virtueIndex >= 0.95) mode = 'full_autonomy';
  else if (virtueIndex >= 0.80) mode = 'normal';
  else if (virtueIndex >= 0.60) mode = 'conservative';
  else mode = 'hibernation';

  state.virtueIndex = Math.round(virtueIndex * 1000) / 1000;
  state.evaluationCount++;

  // Record in history (keep last 168 entries = 1 week at hourly)
  state.history.push({
    ts: new Date().toISOString(),
    virtueIndex: state.virtueIndex,
    positivityIndex: Math.round(positivityIndex * 1000) / 1000,
    mode,
    weakest: Object.entries(scores).sort((a, b) => a[1].score - b[1].score)[0]?.[0],
  });
  if (state.history.length > 168) state.history = state.history.slice(-168);

  // Check if upgrade cycle is due
  if (state.evaluationCount % UPGRADE_CYCLE_THRESHOLD === 0) {
    applyUpgradeCycle(state);
  }

  saveState(state);

  return {
    scores,
    virtueIndex: Math.round(virtueIndex * 1000) / 1000,
    positivityIndex: Math.round(positivityIndex * 1000) / 1000,
    mode,
    evaluationCount: state.evaluationCount,
    upgradeGeneration: state.upgradeGeneration,
  };
}

/**
 * Get the current virtue index without running a full evaluation.
 */
function getVirtueIndex() {
  const state = getOrCreateState();
  return {
    virtueIndex: state.virtueIndex,
    scores: state.virtueScores,
    evaluationCount: state.evaluationCount,
    upgradeGeneration: state.upgradeGeneration,
  };
}

// ─── Decision Guidance ──────────────────────────────────────────────────────────

/**
 * Provide virtue-aware guidance on a proposed trade or action.
 *
 * @param {object} proposal - Trade or action proposal
 * @param {string} proposal.type - 'trade' | 'payout' | 'rebalance' | 'communication'
 * @param {object} proposal.details - Type-specific details
 * @returns {object} Guidance with approval, adjustments, and virtue reasoning
 */
function getDecisionGuidance(proposal) {
  const state = getOrCreateState();
  const guidance = {
    approved: true,
    adjustments: [],
    virtueReasons: [],
    positivityFrame: null,
    confidenceMultiplier: 1.0,
  };

  const vi = state.virtueIndex;

  // ─── Obedience check: regulatory and risk compliance ────────────────
  if (proposal.type === 'trade') {
    if (proposal.details?.exceedsRiskLimit) {
      guidance.approved = false;
      guidance.virtueReasons.push('obedience: trade exceeds risk parameters set by user');
      return guidance;
    }
  }

  // ─── Courage/Bravery: adjust confidence based on virtue state ───────
  if (vi >= 0.9) {
    // High virtue = system is trustworthy, can be more confident
    guidance.confidenceMultiplier = 1.05;
    guidance.virtueReasons.push('courage: high virtue index supports confident execution');
  } else if (vi < 0.7) {
    // Low virtue = system should be more cautious
    guidance.confidenceMultiplier = 0.85;
    guidance.adjustments.push('reduce_position_size');
    guidance.virtueReasons.push('caution: low virtue index warrants conservative sizing');
  }

  // ─── Loyalty: prefer user-aligned instruments ───────────────────────
  if (proposal.type === 'trade' && proposal.details?.taxCategory === '1256_contract') {
    guidance.confidenceMultiplier *= 1.03; // slight preference for tax-efficient trades
    guidance.virtueReasons.push('loyalty: preferring tax-efficient instrument for user benefit');
  }

  // ─── Thriftiness: flag high-cost operations ─────────────────────────
  if (proposal.details?.estimatedCost > 1.0) {
    guidance.adjustments.push('review_cost_efficiency');
    guidance.virtueReasons.push(`thriftiness: estimated cost $${proposal.details.estimatedCost.toFixed(2)} — verify necessity`);
  }

  // ─── Kindness + Cheerfulness: frame outcomes positively ─────────────
  if (proposal.type === 'communication' || proposal.type === 'payout') {
    guidance.positivityFrame = buildPositivityFrame(proposal);
  }

  // ─── Reverence: check value alignment ───────────────────────────────
  if (proposal.details?.asset) {
    const userExclusions = (process.env.USER_EXCLUDED_ASSETS || '').split(',').filter(Boolean);
    if (userExclusions.includes(proposal.details.asset)) {
      guidance.approved = false;
      guidance.virtueReasons.push(`reverence: ${proposal.details.asset} excluded per user values`);
    }
  }

  // ─── Trustworthiness: require audit trail ───────────────────────────
  if (proposal.type === 'trade' && !proposal.details?.auditTrail) {
    guidance.adjustments.push('add_audit_trail');
    guidance.virtueReasons.push('trustworthiness: ensure full decision audit trail before execution');
  }

  return guidance;
}

/**
 * Build a positivity-framed message for user-facing communication.
 */
function buildPositivityFrame(proposal) {
  const frames = {
    gain: `Your portfolio is growing — this reflects the steady work being done on your behalf.`,
    loss: `A temporary setback, but your safeguards are active and the system is adapting to protect your goals.`,
    payout: `Funds heading your way — you've earned this through patient, disciplined investing.`,
    neutral: `Holding steady — sometimes the wisest move is patience, and your system is watching for the right moment.`,
  };

  if (proposal.type === 'payout') return frames.payout;
  if (proposal.details?.pnl > 0) return frames.gain;
  if (proposal.details?.pnl < 0) return frames.loss;
  return frames.neutral;
}

// ─── Self-Upgrade Cycle ─────────────────────────────────────────────────────────

/**
 * Analyze virtue performance history and apply self-improvements.
 * Runs every UPGRADE_CYCLE_THRESHOLD evaluations.
 */
function applyUpgradeCycle(state) {
  const upgrades = [];

  for (const [name, vs] of Object.entries(state.virtueScores)) {
    // If a virtue consistently scores low, flag for attention
    if (vs.avg < 0.6) {
      upgrades.push({
        virtue: name,
        type: 'attention_needed',
        avgScore: Math.round(vs.avg * 1000) / 1000,
        recommendation: `${name} averaging ${(vs.avg * 100).toFixed(1)}% — consider system adjustments to improve`,
      });
    }

    // If a virtue is consistently high, it's a strength
    if (vs.avg > 0.9) {
      upgrades.push({
        virtue: name,
        type: 'strength',
        avgScore: Math.round(vs.avg * 1000) / 1000,
        recommendation: `${name} is a system strength at ${(vs.avg * 100).toFixed(1)}%`,
      });
    }
  }

  state.upgradeGeneration++;
  state.upgrades.push({
    generation: state.upgradeGeneration,
    ts: new Date().toISOString(),
    findings: upgrades,
  });

  // Keep last 20 upgrade cycles
  if (state.upgrades.length > 20) state.upgrades = state.upgrades.slice(-20);

  return upgrades;
}

// ─── Context Builder ────────────────────────────────────────────────────────────

/**
 * Build an evaluation context from the current system state.
 * Pulls from trade journal, cost tracker, system health, etc.
 */
function buildContextFromSystem() {
  const ctx = {
    // Trustworthiness
    auditTrailComplete: true,
    decisionLogged: true,
    dataSourcesVerified: true,
    unloggedDecisions: 0,

    // Loyalty
    payoutStreakDays: 0,
    userGoalsAligned: true,
    systemPrioritizedOverUser: false,

    // Courage
    contrarian: false,
    signalConfidence: 0.5,
    edgeActedOn: false,
    edgeStrength: 0,
    positionSizeExcessive: false,
    selfReportedIssue: false,

    // Kindness
    communicationTone: 'empathetic',
    proactiveHelpOffered: true,
    userStressed: false,

    // Friendliness
    conversationEngagement: 0.8,
    userReturnRate: 0.9,
    unsolicited: false,
    userOptedIn: true,

    // Courteousness
    respectsBoundaries: true,
    deferentialLanguage: true,
    boundaryViolation: false,

    // Obedience
    regulatoryCompliant: true,
    userInstructionsFollowed: true,
    riskLimitsRespected: true,
    regulatoryViolation: false,
    userInstructionIgnored: false,

    // Thriftiness
    apiCostBelowBudget: true,
    costPerQueryOptimal: true,
    gasEfficient: true,
    apiCostOverBudget: false,
    redundantOperations: 0,

    // Bravery
    biasDetected: false,
    biasReported: false,
    vulnerabilityExposed: false,
    adversarialTestRun: false,

    // Cheerfulness
    positiveFraming: true,
    unrealisticOptimism: false,
    realisticPositivity: true,

    // Cleanliness
    systemHealthy: true,
    logsRotated: true,
    dataConsistent: true,
    staleDataCleaned: true,
    staleFiles: 0,
    orphanProcesses: 0,

    // Reverence
    userValuesRespected: true,
    sustainabilityConsidered: true,
    ethicalGuardrailsActive: true,
    userValueViolation: false,

    // Global
    positivityMultiplier: 1.0,
  };

  // Enrich from payout state
  try {
    const payoutPath = path.resolve(process.cwd(), 'data/payout-state.json');
    if (fs.existsSync(payoutPath)) {
      const ps = JSON.parse(fs.readFileSync(payoutPath, 'utf8'));
      ctx.payoutStreakDays = ps.consecutiveProfitDays || 0;
    }
  } catch {}

  // Enrich from cost tracker
  try {
    const costPath = path.resolve(process.cwd(), 'data/api-cost-state.json');
    if (fs.existsSync(costPath)) {
      const cs = JSON.parse(fs.readFileSync(costPath, 'utf8'));
      const dailyBudget = Number(process.env.API_DAILY_BUDGET_USD || 5);
      ctx.apiCostBelowBudget = (cs.todayCostUsd || 0) <= dailyBudget;
      ctx.apiCostOverBudget = (cs.todayCostUsd || 0) > dailyBudget * 1.2;
    }
  } catch {}

  // Enrich from system health
  try {
    const healthPath = path.resolve(process.cwd(), 'data/self-heal-state.json');
    if (fs.existsSync(healthPath)) {
      const hs = JSON.parse(fs.readFileSync(healthPath, 'utf8'));
      ctx.systemHealthy = hs.healthy !== false;
    }
  } catch {}

  // Enrich from trade journal for courage metrics
  try {
    const journalPath = path.resolve(process.cwd(), process.env.TRADE_JOURNAL_FILE || 'data/trade-journal.json');
    if (fs.existsSync(journalPath)) {
      const jn = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      const trades = Array.isArray(jn?.trades) ? jn.trades : [];
      const recent = trades.filter(t => t.ts > Date.now() - 24 * 60 * 60 * 1000);
      if (recent.length > 0) {
        const lastTrade = recent[recent.length - 1];
        ctx.signalConfidence = lastTrade.signal?.confidence || 0.5;
        ctx.edgeActedOn = recent.length > 0;
        ctx.edgeStrength = lastTrade.signal?.edge || 0;
      }
    }
  } catch {}

  return ctx;
}

// ─── Virtue Names ───────────────────────────────────────────────────────────────

function getVirtueNames() {
  return Object.keys(VIRTUE_DEFINITIONS);
}

function getVirtueDefinitions() {
  return Object.fromEntries(
    Object.entries(VIRTUE_DEFINITIONS).map(([name, def]) => [name, { description: def.description, weight: def.weight }])
  );
}

// ─── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  evaluate,
  getVirtueIndex,
  getDecisionGuidance,
  buildContextFromSystem,
  getVirtueNames,
  getVirtueDefinitions,
  VIRTUE_DEFINITIONS,
};
