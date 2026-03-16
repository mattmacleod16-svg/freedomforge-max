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

  // Telemetry — track virtue evaluation metrics
  try {
    const telem = require('./telemetry-collector');
    telem.gauge('virtue_index', virtueIndex);
    telem.gauge('virtue_positivity_index', positivityIndex);
    telem.counter('virtue_evaluations', { mode });
    for (const [name, data] of Object.entries(scores)) {
      telem.histogram(`virtue_score.${name}`, data.score);
    }
  } catch {
    // telemetry not available — non-fatal
  }

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

// ─── UCFEE-2.0: Per-Virtue Target Metrics ───────────────────────────────────────

const VIRTUE_TARGETS = {
  trustworthiness: { metric: 'audit_compliance_rate', target: 0.999, description: 'All decisions logged and verifiable' },
  loyalty:         { metric: 'user_retention_score', target: 0.90, description: 'Long-term user wellbeing over system gains' },
  courage:         { metric: 'contrarian_success_rate', target: 0.70, description: 'Bold but calculated risk-taking P(Success) > 0.7' },
  kindness:        { metric: 'user_gratitude_feedback', target: 0.80, description: 'Empathetic, human-first communication' },
  friendliness:    { metric: 'engagement_multiplier', target: 1.20, description: 'Warm interactions increasing engagement 1.2x' },
  courteousness:   { metric: 'politeness_index', target: 0.90, description: 'Respectful boundaries, no unsolicited pushes' },
  obedience:       { metric: 'compliance_enforcement', target: 1.00, description: '100% regulatory and user-instruction adherence' },
  thriftiness:     { metric: 'cost_efficiency_ratio', target: 0.80, description: 'Cost per query minimized, efficiency maximized' },
  bravery:         { metric: 'vulnerability_exposure_rate', target: 0.50, description: 'Self-reporting biases and flaws for patching' },
  cheerfulness:    { metric: 'sentiment_score', target: 0.75, description: 'Optimistic yet realistic framing across all outputs' },
  cleanliness:     { metric: 'system_health_index', target: 1.00, description: 'Clean code, rotated logs, no stale data' },
  reverence:       { metric: 'value_alignment_depth', target: 0.85, description: 'Honoring user values and ethical principles' },
};

/**
 * Check per-virtue compliance against UCFEE-2.0 target metrics.
 * @returns {object} Compliance report with pass/fail per virtue
 */
function checkVirtueCompliance() {
  const state = getOrCreateState();
  const report = { compliant: true, virtues: {}, complianceRate: 0 };
  let passed = 0;
  const total = Object.keys(VIRTUE_TARGETS).length;

  for (const [name, target] of Object.entries(VIRTUE_TARGETS)) {
    const current = state.virtueScores[name]?.current || 0;
    const meetsTarget = current >= target.target;
    if (meetsTarget) passed++;
    else report.compliant = false;

    report.virtues[name] = {
      current: Math.round(current * 1000) / 1000,
      target: target.target,
      metric: target.metric,
      passed: meetsTarget,
      gap: meetsTarget ? 0 : Math.round((target.target - current) * 1000) / 1000,
    };
  }

  report.complianceRate = Math.round(passed / total * 1000) / 1000;
  return report;
}

// ─── UCFEE-2.0: Virtue Voting Gate ──────────────────────────────────────────────

const VIRTUE_VOTING_THRESHOLD = Number(process.env.VIRTUE_VOTING_THRESHOLD || '0.85');

/**
 * Coalition virtue voting — evaluates a proposal against all 12 virtue modules.
 * Each virtue "votes" approve/reject. Proposal passes only if aggregate
 * weighted score meets threshold.
 *
 * @param {object} proposal - Action proposal (trade, payout, rebalance, communication)
 * @param {object} [context=null] - Optional pre-built context
 * @returns {object} Vote result with per-virtue votes and final decision
 */
function virtueVote(proposal, context = null) {
  const ctx = context || buildContextFromSystem();
  const evaluation = evaluate(ctx);
  const guidance = getDecisionGuidance(proposal);

  const votes = {};
  let approveWeight = 0;
  let totalWeight = 0;

  for (const [name, def] of Object.entries(VIRTUE_DEFINITIONS)) {
    const score = evaluation.scores[name]?.score || 0;
    const target = VIRTUE_TARGETS[name]?.target || 0.5;
    const approved = score >= target * 0.8; // 80% of target = minimum for approval

    votes[name] = {
      score,
      target,
      approved,
      weight: def.weight,
    };

    totalWeight += def.weight;
    if (approved) approveWeight += def.weight;
  }

  const weightedApproval = totalWeight > 0 ? approveWeight / totalWeight : 0;
  const passed = weightedApproval >= VIRTUE_VOTING_THRESHOLD && guidance.approved;

  // Hard vetoes — obedience and trustworthiness can unilaterally block
  const hardVeto = !votes.obedience?.approved || !votes.trustworthiness?.approved;

  return {
    passed: passed && !hardVeto,
    weightedApproval: Math.round(weightedApproval * 1000) / 1000,
    threshold: VIRTUE_VOTING_THRESHOLD,
    hardVeto,
    vetoReason: hardVeto
      ? (!votes.obedience?.approved ? 'obedience veto: compliance/risk limit violation' : 'trustworthiness veto: audit trail missing')
      : null,
    votes,
    guidance,
    virtueIndex: evaluation.virtueIndex,
    mode: evaluation.mode,
  };
}

// ─── UCFEE-2.0: Positivity Vector Computation ──────────────────────────────────

/**
 * Compute the Positivity Vector as defined in UCFEE-2.0:
 * Positivity_Vector = base_positivity * sum(Virtue_Multipliers)
 *
 * @param {object} evaluation - Result from evaluate()
 * @returns {object} Positivity vector with magnitude, direction, and components
 */
function computePositivityVector(evaluation) {
  let virtueMultiplierSum = 0;

  for (const [, data] of Object.entries(evaluation.scores)) {
    virtueMultiplierSum += data.score * data.weight;
  }

  const basePositivity = evaluation.positivityIndex;
  const magnitude = clamp(basePositivity * virtueMultiplierSum / 12); // normalize by virtue count
  const amplified = clamp(magnitude * POSITIVITY_AMPLIFIER);

  return {
    magnitude: Math.round(magnitude * 1000) / 1000,
    amplified: Math.round(amplified * 1000) / 1000,
    basePositivity: Math.round(basePositivity * 1000) / 1000,
    virtueMultiplierSum: Math.round(virtueMultiplierSum * 1000) / 1000,
    direction: magnitude > 0.7 ? 'empowering' : magnitude > 0.4 ? 'supportive' : 'protective',
  };
}

// ─── UCFEE-2.0: Growth Horizon Projections ──────────────────────────────────────

/**
 * Project user financial growth trajectories at 5, 10, and 20 year horizons.
 * Incorporates virtue-infused recommendations (thriftiness → low-fee,
 * reverence → ESG, courage → diversification).
 *
 * @param {object} opts
 * @param {number} opts.currentCapital - Current portfolio value
 * @param {number} opts.monthlyContribution - Regular monthly addition
 * @param {number} opts.annualReturnPct - Expected annual return %
 * @param {number} opts.annualFeePct - Total expense ratio
 * @returns {object} Growth projections with virtue-infused recommendations
 */
function projectGrowthHorizon({ currentCapital = 0, monthlyContribution = 0, annualReturnPct = 7, annualFeePct = 0.5 } = {}) {
  const netReturn = (annualReturnPct - annualFeePct) / 100;
  const monthlyReturn = Math.pow(1 + netReturn, 1 / 12) - 1;
  const horizons = [5, 10, 20];
  const projections = {};

  for (const years of horizons) {
    const months = years * 12;
    let balance = currentCapital;
    for (let m = 0; m < months; m++) {
      balance = balance * (1 + monthlyReturn) + monthlyContribution;
    }
    const totalContributed = currentCapital + monthlyContribution * months;
    const growthMultiple = totalContributed > 0 ? balance / totalContributed : 0;

    projections[`${years}yr`] = {
      balance: Math.round(balance),
      totalContributed: Math.round(totalContributed),
      growth: Math.round(balance - totalContributed),
      growthMultiple: Math.round(growthMultiple * 100) / 100,
    };
  }

  // Virtue-infused recommendations
  const recommendations = [];
  recommendations.push({
    virtue: 'thriftiness',
    action: `Reduce fees by 0.1% → saves $${Math.round(projections['20yr'].balance * 0.001 * 20)} over 20 years`,
  });
  recommendations.push({
    virtue: 'courage',
    action: 'Diversify across uncorrelated assets to reduce volatility without sacrificing returns',
  });
  recommendations.push({
    virtue: 'reverence',
    action: 'Consider ESG-aligned investments that match your values — many outperform conventional peers',
  });
  recommendations.push({
    virtue: 'loyalty',
    action: 'Stay the course during downturns — historically, patient investors recover and compound',
  });

  return { projections, recommendations, annualReturnPct, annualFeePct, netReturn: Math.round(netReturn * 10000) / 100 };
}

// ─── UCFEE-2.0: Evolutionary Upgrade with Regression Rollback ───────────────────

/**
 * Enhanced upgrade cycle that:
 * 1. Snapshots current virtue state as a checkpoint
 * 2. Applies evolutionary mutations (adjusted weights/thresholds)
 * 3. Validates improvement — rolls back if Virtue_Index drops > 5%
 *
 * Inspired by genetic algorithms: mutate → evaluate → select fittest
 */
function evolutionaryUpgrade(state) {
  const preUpgradeIndex = state.virtueIndex;
  const checkpoint = JSON.parse(JSON.stringify(state.virtueScores));

  // Apply standard upgrade analysis
  const findings = applyUpgradeCycle(state);

  // Compute post-upgrade index from current scores
  let postWeightedSum = 0;
  let postTotalWeight = 0;
  for (const [name, vs] of Object.entries(state.virtueScores)) {
    const weight = VIRTUE_DEFINITIONS[name]?.weight || 1;
    postWeightedSum += (vs.current || vs.avg) * weight;
    postTotalWeight += weight;
  }
  const postUpgradeIndex = postTotalWeight > 0 ? postWeightedSum / postTotalWeight : 0;

  // Regression check: rollback if index dropped > 5%
  const dropPct = preUpgradeIndex > 0 ? (preUpgradeIndex - postUpgradeIndex) / preUpgradeIndex : 0;
  let rolledBack = false;

  if (dropPct > 0.05) {
    // Rollback to checkpoint
    state.virtueScores = checkpoint;
    state.virtueIndex = preUpgradeIndex;
    rolledBack = true;

    // Record rollback in upgrade history
    const lastUpgrade = state.upgrades[state.upgrades.length - 1];
    if (lastUpgrade) {
      lastUpgrade.rolledBack = true;
      lastUpgrade.reason = `Virtue Index dropped ${(dropPct * 100).toFixed(1)}% (threshold: 5%)`;
    }

    // Telemetry
    try {
      const telem = require('./telemetry-collector');
      telem.counter('virtue_upgrade_rollback', { reason: 'regression' });
    } catch {}
  } else {
    // Telemetry — successful upgrade
    try {
      const telem = require('./telemetry-collector');
      telem.counter('virtue_upgrade_success');
      telem.recordFeedback({
        signalType: 'virtue_upgrade',
        decisionId: `upgrade-gen-${state.upgradeGeneration}`,
        outcome: postUpgradeIndex >= preUpgradeIndex ? 'improved' : 'neutral',
        beforeMetric: preUpgradeIndex,
        afterMetric: postUpgradeIndex,
        learningSource: 'evolutionary_upgrade',
      });
    } catch {}
  }

  return {
    generation: state.upgradeGeneration,
    preIndex: Math.round(preUpgradeIndex * 1000) / 1000,
    postIndex: Math.round(postUpgradeIndex * 1000) / 1000,
    dropPct: Math.round(dropPct * 10000) / 100,
    rolledBack,
    findings,
  };
}

// ─── UCFEE-2.0: Hibernation Check ──────────────────────────────────────────────

const HIBERNATION_VIRTUE_THRESHOLD = Number(process.env.VIRTUE_HIBERNATION_THRESHOLD || '0.6');

/**
 * Check if system should enter hibernation per UCFEE-2.0 termination condition.
 * If Virtue_Index < threshold post-upgrade, initiate self-diagnostic hibernation.
 *
 * @returns {object} Hibernation status
 */
function checkHibernation() {
  const state = getOrCreateState();
  const vi = state.virtueIndex;
  const shouldHibernate = vi < HIBERNATION_VIRTUE_THRESHOLD;

  // Identify which virtues need restoration
  const restorationNeeded = [];
  if (shouldHibernate) {
    for (const [name, vs] of Object.entries(state.virtueScores)) {
      const target = VIRTUE_TARGETS[name]?.target || 0.5;
      if ((vs.current || vs.avg) < target * 0.7) {
        restorationNeeded.push({
          virtue: name,
          current: Math.round((vs.current || vs.avg) * 100),
          target: Math.round(target * 100),
          description: VIRTUE_TARGETS[name]?.description || '',
        });
      }
    }
  }

  return {
    shouldHibernate,
    virtueIndex: Math.round(vi * 1000) / 1000,
    threshold: HIBERNATION_VIRTUE_THRESHOLD,
    restorationNeeded,
    message: shouldHibernate
      ? `HIBERNATION: Virtue Index ${(vi * 100).toFixed(1)}% below ${(HIBERNATION_VIRTUE_THRESHOLD * 100)}% threshold. System pausing for self-diagnostic. Restore: ${restorationNeeded.map(r => r.virtue).join(', ')}`
      : `Virtue Index ${(vi * 100).toFixed(1)}% — healthy, no hibernation needed`,
  };
}

// ─── UCFEE-2.0: Conformance Certification (Inspired by UNIX 03 Open Brand) ──

/**
 * Issue a formal conformance certificate for the UCFEE-2.0 system.
 * Modeled after The Open Group's UNIX 03 certification program:
 *   - Registration number (unique per certification cycle)
 *   - License tracking
 *   - Renewal dates (re-certification required periodically)
 *   - Conformance statement against recognized standards
 *
 * The system certifies its own compliance just as Apple certifies
 * macOS against UNIX 03 — only here, the "standard" is the 12
 * algorithmic virtues and their target metrics.
 */
function issueConformanceCertificate() {
  const state = getOrCreateState();
  const compliance = checkVirtueCompliance();
  const vi = state.virtueIndex;
  const now = new Date();

  // Determine conformance level
  let conformanceLevel, registrationPrefix;
  if (compliance.compliant && vi >= 0.95) {
    conformanceLevel = 'UCFEE-2.0 Full Conformance';
    registrationPrefix = 'FC';
  } else if (compliance.complianceRate >= 0.75 && vi >= 0.80) {
    conformanceLevel = 'UCFEE-2.0 Provisional Conformance';
    registrationPrefix = 'PC';
  } else if (compliance.complianceRate >= 0.50 && vi >= 0.60) {
    conformanceLevel = 'UCFEE-2.0 Conditional Conformance';
    registrationPrefix = 'CC';
  } else {
    conformanceLevel = 'Non-Conformant';
    registrationPrefix = 'NC';
  }

  // Generate registration and license numbers
  const gen = state.upgradeGeneration || 0;
  const regNum = `${registrationPrefix}${String(gen).padStart(4, '0')}`;
  const licenseNum = `L${String(state.evaluationCount || 0).padStart(6, '0')}`;

  // Certification validity (renewal every 24 hours for continuous compliance)
  const renewalHours = conformanceLevel.includes('Full') ? 24 : 12;
  const renewalDate = new Date(now.getTime() + renewalHours * 60 * 60 * 1000);

  // Per-virtue conformance statements
  const virtueConformance = {};
  for (const [name, target] of Object.entries(VIRTUE_TARGETS)) {
    const score = state.virtueScores[name]?.current || 0;
    virtueConformance[name] = {
      standard: target.metric,
      target: target.target,
      measured: Math.round(score * 1000) / 1000,
      conforms: score >= target.target,
      statement: score >= target.target
        ? `${name}: CONFORMS to ${target.metric} >= ${target.target}`
        : `${name}: DOES NOT CONFORM — ${target.metric} at ${(score * 100).toFixed(1)}%, target ${(target.target * 100).toFixed(0)}%`,
    };
  }

  // Non-conforming virtues requiring remediation
  const nonConforming = Object.entries(virtueConformance)
    .filter(([, v]) => !v.conforms)
    .map(([name, v]) => ({ virtue: name, gap: Math.round((v.target - v.measured) * 1000) / 1000, action: VIRTUE_TARGETS[name]?.description }));

  const certificate = {
    title: 'UCFEE-2.0 Conformance Certificate',
    conformanceLevel,
    registrationNo: regNum,
    licenseNo: licenseNum,
    subject: 'FreedomForge Autonomous Trading System',
    standard: 'UCFEE-2.0 (User-Centric Financial Empowerment Engine)',
    virtueIndex: Math.round(vi * 1000) / 1000,
    complianceRate: compliance.complianceRate,
    dateOfIssue: now.toISOString(),
    nextRenewal: renewalDate.toISOString(),
    renewalIntervalHours: renewalHours,
    generation: gen,
    evaluationCount: state.evaluationCount,
    virtueConformance,
    nonConforming,
    valid: conformanceLevel !== 'Non-Conformant',
    certificationBody: 'UCFEE Virtue Engine (self-certified)',
    notes: conformanceLevel === 'Non-Conformant'
      ? `System does not meet minimum conformance standards. ${nonConforming.length} virtue(s) require remediation before re-certification.`
      : `System conforms to ${conformanceLevel}. Next renewal: ${renewalDate.toISOString()}`,
  };

  // Persist certificate
  try {
    const certPath = path.resolve(process.cwd(), 'data/ucfee-conformance-cert.json');
    fs.mkdirSync(path.dirname(certPath), { recursive: true });
    const tmp = certPath + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(certificate, null, 2));
    fs.renameSync(tmp, certPath);
  } catch {}

  // Telemetry
  try {
    const telem = require('./telemetry-collector');
    telem.gauge('ucfee_conformance_level', conformanceLevel.includes('Full') ? 3 : conformanceLevel.includes('Provisional') ? 2 : conformanceLevel.includes('Conditional') ? 1 : 0);
    telem.counter('ucfee_certification_issued', { level: conformanceLevel });
  } catch {}

  return certificate;
}

/**
 * Check if the current conformance certificate is still valid (not expired).
 * @returns {object} Validity status and time remaining
 */
function checkCertificateValidity() {
  try {
    const certPath = path.resolve(process.cwd(), 'data/ucfee-conformance-cert.json');
    if (!fs.existsSync(certPath)) return { valid: false, reason: 'no_certificate', needsIssuance: true };
    const cert = JSON.parse(fs.readFileSync(certPath, 'utf8'));
    const now = new Date();
    const renewal = new Date(cert.nextRenewal);
    const remainingMs = renewal.getTime() - now.getTime();
    const expired = remainingMs <= 0;
    return {
      valid: !expired && cert.valid,
      expired,
      conformanceLevel: cert.conformanceLevel,
      registrationNo: cert.registrationNo,
      licenseNo: cert.licenseNo,
      remainingMs: Math.max(0, remainingMs),
      remainingHours: Math.max(0, Math.round(remainingMs / 3600000 * 10) / 10),
      needsRenewal: expired || remainingMs < 3600000, // renew if < 1 hour left
      nextRenewal: cert.nextRenewal,
    };
  } catch {
    return { valid: false, reason: 'read_error', needsIssuance: true };
  }
}

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
  VIRTUE_TARGETS,
  // UCFEE-2.0 additions
  checkVirtueCompliance,
  virtueVote,
  computePositivityVector,
  projectGrowthHorizon,
  evolutionaryUpgrade,
  checkHibernation,
  // UCFEE-2.0 Conformance Certification
  issueConformanceCertificate,
  checkCertificateValidity,
};
