import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { logEvent } from '@/lib/logger';

let rio: any;
try { rio = require('@/lib/resilient-io'); } catch { /* fallback to raw fs */ }

type AgentRole = 'planner' | 'researcher' | 'critic';

interface ModelResponseLike {
  model: string;
  response: string;
  confidence: number;
}

interface AdaptiveState {
  qValues: Record<string, number>;
  actionCounts: Record<string, number>;
  rewardHistory: number[];
  driftScores: number[];
  metaWeights: Record<AgentRole, number>;
  memory: Array<{
    id: string;
    ts: number;
    queryHash: string;
    action: string;
    reward: number;
    driftScore: number;
    riskScore: number;
  }>;
}

interface AdaptiveDecisionInput {
  userQuery: string;
  modelResponses: ModelResponseLike[];
  sources: string[];
}

interface AdaptiveDecisionResult {
  response: string;
  modelsUsed: string[];
  riskScore: number;
  driftScore: number;
  reward: number;
  xai: {
    decisionId: string;
    selectedAction: string;
    epsilon: number;
    contributions: Record<string, number>;
    agentOutputs: Record<AgentRole, string>;
  };
  reasoning: string;
}

const DATA_DIR = (process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL) ? '/tmp/freedomforge-data' : path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'adaptive-intelligence-state.json');
const MAX_MEMORY = 250;
const SHORT_WINDOW = 25;
const LONG_WINDOW = 100;

function isMaxModeEnabled() {
  return String(process.env.MAX_INTELLIGENCE_MODE || process.env.AUTONOMY_MAX_MODE || 'false').toLowerCase() === 'true';
}

let loaded = false;
let state: AdaptiveState = {
  qValues: {},
  actionCounts: {},
  rewardHistory: [],
  driftScores: [],
  metaWeights: { planner: 0.5, researcher: 0.3, critic: 0.2 },
  memory: [],
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeWeights(weights: Record<AgentRole, number>): Record<AgentRole, number> {
  const sum = weights.planner + weights.researcher + weights.critic;
  if (sum <= 0) return { planner: 0.5, researcher: 0.3, critic: 0.2 };
  return {
    planner: weights.planner / sum,
    researcher: weights.researcher / sum,
    critic: weights.critic / sum,
  };
}

function saveState() {
  try {
    ensureDataDir();
    if (rio) {
      rio.writeJsonAtomic(STATE_FILE, state);
    } else {
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    }
  } catch (err) { console.error('[adaptiveCortex] saveState failed:', err); }
}
export function initializeAdaptiveIntelligence() {
  if (loaded) return;
  loaded = true;
  try {
    ensureDataDir();
    if (!fs.existsSync(STATE_FILE)) {
      saveState();
      return;
    }
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as AdaptiveState;
    state = {
      qValues: parsed.qValues || {},
      actionCounts: parsed.actionCounts || {},
      rewardHistory: Array.isArray(parsed.rewardHistory) ? parsed.rewardHistory.slice(-LONG_WINDOW) : [],
      driftScores: Array.isArray(parsed.driftScores) ? parsed.driftScores.slice(-LONG_WINDOW) : [],
      metaWeights: normalizeWeights(parsed.metaWeights || { planner: 0.5, researcher: 0.3, critic: 0.2 }),
      memory: Array.isArray(parsed.memory) ? parsed.memory.slice(-MAX_MEMORY) : [],
    };
  } catch {
    state = {
      qValues: {},
      actionCounts: {},
      rewardHistory: [],
      driftScores: [],
      metaWeights: { planner: 0.5, researcher: 0.3, critic: 0.2 },
      memory: [],
    };
    saveState();
  }
}

function avg(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2)
  );
}

function jaccardDistance(a: string, b: string) {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  const union = new Set([...sa, ...sb]);
  if (union.size === 0) return 0;
  let inter = 0;
  sa.forEach((token) => {
    if (sb.has(token)) inter += 1;
  });
  return 1 - inter / union.size;
}

function clip(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function detectConceptDrift() {
  const recent = state.rewardHistory.slice(-SHORT_WINDOW);
  const baseline = state.rewardHistory.slice(-LONG_WINDOW, -SHORT_WINDOW);
  if (recent.length < 10 || baseline.length < 10) return 0;
  const recentAvg = avg(recent);
  const baseAvg = avg(baseline);
  const shift = Math.abs(recentAvg - baseAvg);
  return clip(shift);
}

function computeRisk(modelResponses: ModelResponseLike[], driftScore: number) {
  if (modelResponses.length === 0) return 1;
  const confidences = modelResponses.map((r) => clip(r.confidence));
  const avgConfidence = avg(confidences);
  const uncertaintyRisk = 1 - avgConfidence;

  let disagreement = 0;
  if (modelResponses.length > 1) {
    const pairs: number[] = [];
    for (let i = 0; i < modelResponses.length; i += 1) {
      for (let j = i + 1; j < modelResponses.length; j += 1) {
        pairs.push(jaccardDistance(modelResponses[i].response, modelResponses[j].response));
      }
    }
    disagreement = avg(pairs);
  }

  const risk = clip(0.45 * uncertaintyRisk + 0.35 * disagreement + 0.2 * driftScore);
  return risk;
}

function epsilonForDrift(driftScore: number) {
  const maxMode = isMaxModeEnabled();
  const baseEpsilon = maxMode ? 0.04 : 0.1;
  const scaled = baseEpsilon + driftScore * (maxMode ? 0.22 : 0.5);
  return clip(scaled, maxMode ? 0.02 : 0.05, maxMode ? 0.28 : 0.6);
}

function getActionKey(response: ModelResponseLike, idx: number) {
  return `${response.model}#${idx}`;
}

function chooseAction(modelResponses: ModelResponseLike[], epsilon: number) {
  const maxMode = isMaxModeEnabled();
  const actions = modelResponses.map((response, idx) => ({
    key: getActionKey(response, idx),
    response,
    idx,
  }));

  if (actions.length === 0) {
    return null;
  }

  if (Math.random() < epsilon) {
    return actions[Math.floor(Math.random() * actions.length)];
  }

  let best = actions[0];
  let bestScore = -Infinity;
  const meanConfidence = avg(actions.map((action) => clip(action.response.confidence)));
  for (const action of actions) {
    const q = state.qValues[action.key] ?? 0.5;
    const confidence = clip(action.response.confidence);
    const confidenceDelta = Math.max(0, confidence - meanConfidence);
    const exploitationBonus = maxMode ? (0.24 * confidence + 0.09 * confidenceDelta) : (0.2 * confidence);
    const score = q + exploitationBonus;
    if (score > bestScore) {
      best = action;
      bestScore = score;
    }
  }
  return best;
}

function reflectionLoop(
  userQuery: string,
  selectedResponse: string,
  riskScore: number,
  sources: string[]
): Record<AgentRole, string> {
  const planner = `Plan: answer query directly, keep evidence-linked content, avoid unsupported claims.`;
  const researcher = `Evidence: ${sources.length} source signals available; prioritize consistent claims and operational details.`;
  const critic =
    riskScore >= 0.6
      ? `Critique: high uncertainty detected; include caveats and propose verification steps.`
      : `Critique: uncertainty acceptable; keep concise but precise.`;
  const committee = isMaxModeEnabled()
    ? `Investment committee mode: cross-check for downside protection, margin of safety, and regime sensitivity before any autonomous action.`
    : '';

  const revised =
    riskScore >= 0.7
      ? `${selectedResponse}\n\nConfidence note: model disagreement/drift is elevated; validate critical actions before execution.`
      : selectedResponse;

  return {
    planner,
    researcher,
    critic: `${critic} Finalized response length=${revised.length}. Query hash seed=${
      createHash('sha256').update(userQuery).digest('hex').slice(0, 8)
    }${committee ? ` ${committee}` : ''}`,
  };
}

function computeReward(selected: ModelResponseLike, riskScore: number, sourcesCount: number) {
  const maxMode = isMaxModeEnabled();
  const confidenceComponent = clip(selected.confidence);
  const evidenceTarget = maxMode ? 8 : 5;
  const evidenceComponent = clip(Math.min(1, sourcesCount / evidenceTarget));
  const riskPenalty = clip(riskScore);
  return maxMode
    ? clip(0.45 * confidenceComponent + 0.35 * evidenceComponent + 0.2 * (1 - riskPenalty))
    : clip(0.55 * confidenceComponent + 0.25 * evidenceComponent + 0.2 * (1 - riskPenalty));
}

function updateBandit(actionKey: string, reward: number) {
  const count = (state.actionCounts[actionKey] ?? 0) + 1;
  state.actionCounts[actionKey] = count;
  const oldQ = state.qValues[actionKey] ?? 0.5;
  const alpha = 1 / count;
  state.qValues[actionKey] = oldQ + alpha * (reward - oldQ);
}

function updateMetaWeights(reward: number, riskScore: number, driftScore: number) {
  const deltaPlanner = (reward - 0.5) * 0.06;
  const deltaResearcher = (0.5 - riskScore) * 0.05;
  const deltaCritic = driftScore * 0.05;
  state.metaWeights = normalizeWeights({
    planner: clip(state.metaWeights.planner + deltaPlanner, 0.1, 1),
    researcher: clip(state.metaWeights.researcher + deltaResearcher, 0.1, 1),
    critic: clip(state.metaWeights.critic + deltaCritic, 0.1, 1),
  });
}

export async function runAdaptiveDecisionLoop(
  input: AdaptiveDecisionInput
): Promise<AdaptiveDecisionResult | null> {
  initializeAdaptiveIntelligence();

  if (!input.modelResponses.length) return null;

  const driftScore = detectConceptDrift();
  const epsilon = epsilonForDrift(driftScore);
  const riskScore = computeRisk(input.modelResponses, driftScore);

  const action = chooseAction(input.modelResponses, epsilon);
  if (!action) return null;

  const selected = action.response;
  const agentOutputs = reflectionLoop(input.userQuery, selected.response, riskScore, input.sources);

  const reward = computeReward(selected, riskScore, input.sources.length);
  updateBandit(action.key, reward);
  updateMetaWeights(reward, riskScore, driftScore);

  state.rewardHistory.push(reward);
  state.rewardHistory = state.rewardHistory.slice(-LONG_WINDOW);
  state.driftScores.push(driftScore);
  state.driftScores = state.driftScores.slice(-LONG_WINDOW);

  const decisionId = `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const queryHash = createHash('sha256').update(input.userQuery).digest('hex').slice(0, 16);

  state.memory.push({
    id: decisionId,
    ts: Date.now(),
    queryHash,
    action: action.key,
    reward,
    driftScore,
    riskScore,
  });
  state.memory = state.memory.slice(-MAX_MEMORY);
  saveState();

  const contributions = {
    confidence: clip(selected.confidence),
    riskPenalty: 1 - riskScore,
    driftPenalty: 1 - driftScore,
    evidenceCoverage: clip(Math.min(1, input.sources.length / 5)),
    plannerWeight: state.metaWeights.planner,
    researcherWeight: state.metaWeights.researcher,
    criticWeight: state.metaWeights.critic,
  };

  await logEvent('xai_decision', {
    decisionId,
    selectedAction: action.key,
    queryHash,
    reward,
    riskScore,
    driftScore,
    epsilon,
    qValue: state.qValues[action.key],
    contributions,
    metaWeights: state.metaWeights,
    memorySize: state.memory.length,
    agentOutputs,
  });

  return {
    response: selected.response,
    modelsUsed: [selected.model],
    riskScore,
    driftScore,
    reward,
    xai: {
      decisionId,
      selectedAction: action.key,
      epsilon,
      contributions,
      agentOutputs,
    },
    reasoning: `Adaptive policy selected ${selected.model}. reward=${reward.toFixed(3)}, risk=${riskScore.toFixed(3)}, drift=${driftScore.toFixed(3)}, epsilon=${epsilon.toFixed(3)}.`,
  };
}

export function getAdaptiveSnapshot() {
  initializeAdaptiveIntelligence();
  return {
    metaWeights: state.metaWeights,
    averageReward: avg(state.rewardHistory),
    averageDrift: avg(state.driftScores),
    memorySize: state.memory.length,
    knownPolicies: Object.keys(state.qValues).length,
  };
}
