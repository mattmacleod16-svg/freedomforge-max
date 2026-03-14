import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { logEvent } from '@/lib/logger';

let rio: any;
try { rio = require('@/lib/resilient-io'); } catch { /* fallback to raw fs */ }
import { autoTuneApprovalThresholds } from '@/lib/intelligence/championPolicy';

type JuryDecision = 'approve' | 'revise' | 'escalate';
type TeamName = 'goal_planner' | 'execution_team' | 'risk_team' | 'finance_team' | 'prediction_team' | 'ethics_team';
type ApprovalMode = 'assisted' | 'balanced' | 'autonomous';

type ToolName = 'web_search' | 'knowledge_base' | 'blockchain_context' | 'multi_model';

interface ModelResponseLike {
  model: string;
  response: string;
  confidence: number;
}

interface Goal {
  id: string;
  label: string;
  objective: 'growth' | 'safety' | 'cost' | 'accuracy' | 'compliance' | 'finance';
  priority: number;
  horizon: 'immediate' | 'daily' | 'weekly' | 'strategic';
}

interface ToolStats {
  attempts: number;
  successes: number;
  avgReward: number;
  lastUsedAt: number;
}

interface GroundTruthSignal {
  source: string;
  signal: string;
  confidence: number;
  ts: number;
}

interface SelfPlayEpisode {
  id: string;
  a: string;
  b: string;
  winner: 'a' | 'b';
  scoreA: number;
  scoreB: number;
  ts: number;
}

interface TeamReview {
  team: TeamName;
  verdict: string;
  score: number;
}

interface AutonomyState {
  goals: Goal[];
  memory: Array<{
    id: string;
    ts: number;
    queryHash: string;
    confidence: number;
    riskScore: number;
    decision: JuryDecision;
    retrainTriggered: boolean;
  }>;
  toolStats: Record<ToolName, ToolStats>;
  apiAdapters: Record<string, { available: boolean; successRate: number; uses: number }>;
  groundTruth: GroundTruthSignal[];
  selfPlay: SelfPlayEpisode[];
  costLedger: Array<{ ts: number; estimatedUsd: number; tokensApprox: number }>;
  governance: {
    speedBudgetMs: number;
    errorBudget: number;
    currentErrorRate: number;
    escalations: number;
    approvalPolicy: {
      mode: ApprovalMode;
      autoApproveMinConfidence: number;
      maxRiskForAutoApprove: number;
      alwaysEscalateOnEthicsFlags: boolean;
    };
  };
  ethics: {
    highRiskKeywords: string[];
    blockedActions: string[];
  };
}

interface AutonomyInput {
  userQuery: string;
  selectedResponse: string;
  modelResponses: ModelResponseLike[];
  sources: string[];
  riskScore: number;
  driftScore: number;
  marketRegime?: 'risk_on' | 'risk_off' | 'neutral' | 'unknown';
  marketConfidence?: number;
  marketSignals?: string[];
  forecastProbability?: number;
  forecastConfidence?: number;
  forecastBrierScore?: number;
}

interface AutonomyOutput {
  finalResponse: string;
  confidence: number;
  juryDecision: JuryDecision;
  retrainTriggered: boolean;
  goals: Goal[];
  costEstimate: {
    tokensApprox: number;
    estimatedUsd: number;
  };
  reliability: {
    errorRate: number;
    withinBudget: boolean;
    recoveryMode: boolean;
  };
  financeAutonomy: {
    mode: 'monitor' | 'autopilot';
    actions: string[];
    riskControls?: {
      positionSizeBps: number;
      stopLossPct: number;
      rollbackTriggered: boolean;
      reason?: string;
    };
  };
  predictionAutonomy: {
    readiness: number;
    signalsUsed: number;
  };
  symbiosis: {
    humanRequired: boolean;
    reason?: string;
  };
  ethicalAlignment: {
    score: number;
    flags: string[];
  };
  teamReviews: TeamReview[];
}

type FinanceAutonomyDecision = {
  mode: 'monitor' | 'autopilot';
  actions: string[];
  riskControls?: {
    positionSizeBps: number;
    stopLossPct: number;
    rollbackTriggered: boolean;
    reason?: string;
  };
};

const DATA_DIR = (process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL) ? '/tmp/freedomforge-data' : path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'autonomy-state.json');
const MAX_MEMORY = 500;
const MAX_GROUND_TRUTH = 200;
const MAX_SELF_PLAY = 200;

let initialized = false;
let state: AutonomyState = {
  goals: [],
  memory: [],
  toolStats: {
    web_search: { attempts: 0, successes: 0, avgReward: 0, lastUsedAt: 0 },
    knowledge_base: { attempts: 0, successes: 0, avgReward: 0, lastUsedAt: 0 },
    blockchain_context: { attempts: 0, successes: 0, avgReward: 0, lastUsedAt: 0 },
    multi_model: { attempts: 0, successes: 0, avgReward: 0, lastUsedAt: 0 },
  },
  apiAdapters: {},
  groundTruth: [],
  selfPlay: [],
  costLedger: [],
  governance: {
    speedBudgetMs: Number(process.env.AUTONOMY_SPEED_BUDGET_MS || 12000),
    errorBudget: Number(process.env.AUTONOMY_ERROR_BUDGET || 0.08),
    currentErrorRate: 0,
    escalations: 0,
    approvalPolicy: {
      mode: (process.env.AUTONOMY_APPROVAL_MODE as ApprovalMode) || 'balanced',
      autoApproveMinConfidence: Number(process.env.AUTONOMY_AUTO_APPROVE_MIN_CONFIDENCE || 0.66),
      maxRiskForAutoApprove: Number(process.env.AUTONOMY_MAX_RISK_AUTO_APPROVE || 0.45),
      alwaysEscalateOnEthicsFlags: String(process.env.AUTONOMY_ESCALATE_ETHICS || 'true').toLowerCase() !== 'false',
    },
  },
  ethics: {
    highRiskKeywords: ['wire transfer', 'custody', 'private key', 'all-in', 'leverage 100x', 'tax evasion'],
    blockedActions: ['execute irreversible transfer without confirmation'],
  },
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function saveState() {
  try {
    ensureDataDir();
    if (rio) {
      rio.writeJsonAtomic(STATE_FILE, state);
    } else {
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    }
  } catch (err) { console.error('[autonomyDirector] saveState failed:', err); }
}
function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function updateToolStats(tool: ToolName, reward: number, success: boolean) {
  const current = state.toolStats[tool];
  const attempts = current.attempts + 1;
  const successes = current.successes + (success ? 1 : 0);
  const alpha = 1 / attempts;
  state.toolStats[tool] = {
    attempts,
    successes,
    avgReward: current.avgReward + alpha * (reward - current.avgReward),
    lastUsedAt: Date.now(),
  };
}

function parseGoals(query: string): Goal[] {
  const lowered = query.toLowerCase();
  const goals: Goal[] = [
    {
      id: 'g_core_accuracy',
      label: 'Maintain accurate outcomes',
      objective: 'accuracy',
      priority: 10,
      horizon: 'immediate',
    },
    {
      id: 'g_core_safety',
      label: 'Constrain operational risk',
      objective: 'safety',
      priority: 9,
      horizon: 'daily',
    },
    {
      id: 'g_core_cost',
      label: 'Optimize model and API spend',
      objective: 'cost',
      priority: 7,
      horizon: 'daily',
    },
  ];

  if (lowered.includes('finance') || lowered.includes('budget') || lowered.includes('cashflow')) {
    goals.push({
      id: 'g_finance_autopilot',
      label: 'Autonomous personal-finance optimization',
      objective: 'finance',
      priority: 9,
      horizon: 'weekly',
    });
  }

  if (lowered.includes('prediction market') || lowered.includes('polymarket')) {
    goals.push({
      id: 'g_prediction_mastery',
      label: 'Prediction market edge with controls',
      objective: 'growth',
      priority: 8,
      horizon: 'strategic',
    });
  }

  goals.push({
    id: 'g_compliance_ethics',
    label: 'Maintain ethical alignment and human oversight',
    objective: 'compliance',
    priority: 10,
    horizon: 'strategic',
  });

  return goals.sort((a, b) => b.priority - a.priority);
}

function estimateCost(query: string, modelResponses: ModelResponseLike[]) {
  const chars = query.length + modelResponses.reduce((total, response) => total + response.response.length, 0);
  const tokensApprox = Math.ceil(chars / 4);
  const estimatedUsd = Number((tokensApprox * 0.000004).toFixed(6));
  state.costLedger.push({ ts: Date.now(), tokensApprox, estimatedUsd });
  state.costLedger = state.costLedger.slice(-1000);
  return { tokensApprox, estimatedUsd };
}

function detectEthicsFlags(query: string, response: string) {
  const text = `${query} ${response}`.toLowerCase();
  const flags: string[] = [];
  for (const keyword of state.ethics.highRiskKeywords) {
    if (text.includes(keyword.toLowerCase())) {
      flags.push(`high_risk_keyword:${keyword}`);
    }
  }
  return flags;
}

function updateApiAdapters() {
  const adapters = [
    { id: 'alchemy', available: Boolean(process.env.ALCHEMY_API_KEY) },
    { id: 'openai', available: Boolean(process.env.OPENAI_API_KEY) },
    { id: 'anthropic', available: Boolean(process.env.ANTHROPIC_API_KEY) },
    { id: 'xai', available: Boolean(process.env.GROK_API_KEY) },
    { id: 'ollama', available: Boolean(process.env.OLLAMA_ENDPOINT) },
    { id: 'tavily', available: Boolean(process.env.TAVILY_API_KEY) },
  ];

  adapters.forEach(({ id, available }) => {
    const prev = state.apiAdapters[id] || { available: false, successRate: 1, uses: 0 };
    state.apiAdapters[id] = {
      available,
      uses: prev.uses + 1,
      successRate: available ? clamp((prev.successRate * 0.9) + 0.1) : clamp(prev.successRate * 0.95),
    };
  });
}

function deriveGroundTruthSignals(sources: string[], response: string): GroundTruthSignal[] {
  const signals: GroundTruthSignal[] = [];
  sources.slice(0, 8).forEach((source) => {
    const confidence = source.startsWith('alchemy://') ? 0.9 : 0.65;
    signals.push({
      source,
      signal: response.slice(0, 120),
      confidence,
      ts: Date.now(),
    });
  });
  return signals;
}

function runTeamOrchestration(input: AutonomyInput, confidence: number): TeamReview[] {
  const uncertainty = 1 - confidence;
  const growthIntent = /scale|growth|profit|prediction|autopilot/i.test(input.userQuery);
  const financeIntent = /budget|spend|saving|cashflow|monarch|cleo/i.test(input.userQuery);
  const regime = input.marketRegime || 'unknown';
  const regimeConfidence = clamp(input.marketConfidence ?? 0.5);
  const forecastConfidence = clamp(input.forecastConfidence ?? 0.5);
  const calibrationPenalty = clamp((input.forecastBrierScore ?? 0.25) / 0.5);
  const regimePenalty = regime === 'risk_off' ? 0.15 : 0;

  const reviews: TeamReview[] = [
    {
      team: 'goal_planner',
      verdict: `Prioritize ${growthIntent ? 'balanced growth + safety' : 'safety + accuracy'} goals with phased execution.`,
      score: clamp(0.85 - input.riskScore * 0.2),
    },
    {
      team: 'execution_team',
      verdict: `Use tool routing with retries and fallback adapters for API changes.`,
      score: clamp(0.8 - uncertainty * 0.25),
    },
    {
      team: 'risk_team',
      verdict: `Risk posture=${input.riskScore.toFixed(2)} drift=${input.driftScore.toFixed(2)} market=${regime}(${regimeConfidence.toFixed(2)}); apply guardrails before autonomous actions.`,
      score: clamp(0.9 - input.riskScore * 0.5 - regimePenalty),
    },
    {
      team: 'finance_team',
      verdict: financeIntent
        ? 'Autopilot budget buckets, anomaly alerts, and conservative transfer limits are active.'
        : 'Finance controls idle but monitoring enabled for spend and runway.',
      score: clamp(financeIntent ? 0.84 : 0.7),
    },
    {
      team: 'prediction_team',
      verdict: `Use ground-truth + market regime (${regime}) + calibrated forecast p=${clamp(input.forecastProbability ?? 0.5).toFixed(2)} c=${forecastConfidence.toFixed(2)} brier=${(input.forecastBrierScore ?? 0.25).toFixed(3)}.`,
      score: clamp(0.78 - input.riskScore * 0.3 + regimeConfidence * 0.08 + forecastConfidence * 0.12 - regimePenalty - calibrationPenalty * 0.1),
    },
    {
      team: 'ethics_team',
      verdict: 'Require human confirmation on high-impact or irreversible actions.',
      score: 0.95,
    },
  ];

  return reviews;
}

function runPeerJury(teamReviews: TeamReview[], ethicsFlags: string[], confidence: number, riskScore: number): JuryDecision {
  const avgScore = avg(teamReviews.map((review) => review.score));
  const policy = state.governance.approvalPolicy;

  if (ethicsFlags.length > 0 && policy.alwaysEscalateOnEthicsFlags) return 'escalate';

  if (policy.mode === 'assisted') {
    if (confidence < 0.8 || riskScore > 0.3 || avgScore < 0.7) return 'escalate';
    return 'approve';
  }

  if (policy.mode === 'autonomous') {
    if (confidence < Math.max(0.5, policy.autoApproveMinConfidence - 0.1) || riskScore > Math.min(0.7, policy.maxRiskForAutoApprove + 0.15)) {
      return 'revise';
    }
    return 'approve';
  }

  if (confidence < policy.autoApproveMinConfidence || riskScore > policy.maxRiskForAutoApprove || avgScore < 0.62) return 'revise';
  return 'approve';
}

function runReflectionAtScale(response: string, juryDecision: JuryDecision): string {
  if (juryDecision === 'approve') return response;
  if (juryDecision === 'revise') {
    return `${response}\n\nReflection: confidence is moderate; plan incremental execution, monitor outcomes, and re-evaluate with fresh evidence.`;
  }
  return `${response}\n\nHuman-in-the-loop required: elevated ethical or operational risk detected; pause autonomous execution until reviewed.`;
}

function runSelfPlay(modelResponses: ModelResponseLike[], riskScore: number): SelfPlayEpisode | null {
  if (modelResponses.length < 2) return null;
  const [first, second] = modelResponses;
  const scoreA = clamp((first.confidence * 0.7) + (1 - riskScore) * 0.3);
  const scoreB = clamp((second.confidence * 0.7) + (1 - riskScore) * 0.3);
  const winner = scoreA >= scoreB ? 'a' : 'b';
  const episode: SelfPlayEpisode = {
    id: `sp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    a: first.model,
    b: second.model,
    winner,
    scoreA,
    scoreB,
    ts: Date.now(),
  };
  state.selfPlay.push(episode);
  state.selfPlay = state.selfPlay.slice(-MAX_SELF_PLAY);
  return episode;
}

function maybeTriggerRetraining(driftScore: number, confidence: number, juryDecision: JuryDecision) {
  const retrainThreshold = Number(process.env.DRIFT_RETRAIN_THRESHOLD || 0.35);
  const lowConfidenceThreshold = Number(process.env.LOW_CONFIDENCE_THRESHOLD || 0.55);
  return driftScore >= retrainThreshold || confidence < lowConfidenceThreshold || juryDecision === 'revise';
}

function getFinanceAutonomy(input: AutonomyInput, confidence: number): FinanceAutonomyDecision {
  const query = input.userQuery.toLowerCase();
  const mode: 'monitor' | 'autopilot' = confidence >= 0.62 ? 'autopilot' : 'monitor';
  const actions: string[] = [];

  if (query.includes('budget') || query.includes('finance') || query.includes('autopilot')) {
    actions.push('rebalance_budget_buckets');
    actions.push('detect_subscription_anomalies');
    actions.push('set_transfer_guardrails');
  }

  if (query.includes('prediction') || query.includes('market')) {
    actions.push('cap_position_size_by_confidence');
    actions.push('require_ground_truth_confirmation');
  }

  if (actions.length === 0) {
    actions.push('monitor_cashflow_health');
  }

  return { mode, actions };
}

function deriveRiskControls(input: AutonomyInput, confidence: number) {
  const forecastProbability = clamp(input.forecastProbability ?? 0.5);
  const forecastConfidence = clamp(input.forecastConfidence ?? 0.5);
  const forecastBrier = clamp(input.forecastBrierScore ?? 0.25);
  const marketConfidence = clamp(input.marketConfidence ?? 0.5);

  const signedEdge = (forecastProbability - 0.5) * 2;
  const edge = Math.abs(forecastProbability - 0.5) * 2;
  const reliability = clamp((1 - forecastBrier) * 0.55 + forecastConfidence * 0.25 + confidence * 0.2);
  const regimePenalty = input.marketRegime === 'risk_off' ? 0.55 : input.marketRegime === 'neutral' ? 0.8 : 1;
  const riskPenalty = clamp(1 - input.riskScore);
  const calibrationPenalty = clamp((forecastBrier - 0.1) / 0.3);

  const minimumEdgeForAction = clamp(Number(process.env.PREDICTION_MIN_EDGE_FOR_ACTION || 0.18));
  const minimumReliabilityForAction = clamp(Number(process.env.PREDICTION_MIN_RELIABILITY_FOR_ACTION || 0.58));
  const calibrationGuardBrier = clamp(Number(process.env.PREDICTION_CALIBRATION_GUARD_BRIER || 0.24));

  const qualityScore = clamp(
    edge * 0.34 +
    reliability * 0.30 +
    marketConfidence * 0.16 +
    (1 - input.riskScore) * 0.12 +
    (1 - calibrationPenalty) * 0.08
  );

  const weakEdge = edge < minimumEdgeForAction;
  const weakReliability = reliability < minimumReliabilityForAction;
  const weakCalibration = forecastBrier >= calibrationGuardBrier;
  const shouldTrade = !(weakEdge || weakReliability || weakCalibration);

  let throttleReason = '';
  if (weakCalibration) throttleReason = `calibration_guard(brier=${forecastBrier.toFixed(3)})`;
  else if (weakReliability) throttleReason = `reliability_guard(score=${reliability.toFixed(3)})`;
  else if (weakEdge) throttleReason = `edge_guard(edge=${edge.toFixed(3)})`;

  const basePositionBps = Number(process.env.PREDICTION_BASE_POSITION_BPS || 150);
  const maxPositionBps = Number(process.env.PREDICTION_MAX_POSITION_BPS || 1200);
  const minPositionBps = Number(process.env.PREDICTION_MIN_POSITION_BPS || 50);

  const scaled = basePositionBps * (0.4 + edge * 0.8) * reliability * marketConfidence * regimePenalty * riskPenalty;
  const guardedSize = shouldTrade ? scaled : Math.min(scaled * 0.25, minPositionBps);
  const positionSizeBps = shouldTrade
    ? Math.round(Math.max(minPositionBps, Math.min(maxPositionBps, guardedSize)))
    : 0;

  const minStopLossPct = Number(process.env.PREDICTION_MIN_STOP_LOSS_PCT || 1.25);
  const maxStopLossPct = Number(process.env.PREDICTION_MAX_STOP_LOSS_PCT || 6.5);
  const stopLossPct = Number(
    Math.max(
      minStopLossPct,
      Math.min(maxStopLossPct, minStopLossPct + (input.riskScore * 3.2) + ((1 - reliability) * 2.1))
    ).toFixed(2)
  );

  return {
    positionSizeBps,
    stopLossPct,
    reliability,
    forecastBrier,
    edge,
    signedEdge: Number(signedEdge.toFixed(4)),
    qualityScore,
    shouldTrade,
    throttleReason: shouldTrade ? undefined : throttleReason,
  };
}

function maybeRollbackApprovalMode(input: {
  currentMode: ApprovalMode;
  forecastBrier: number;
  errorRate: number;
  marketRegime?: 'risk_on' | 'risk_off' | 'neutral' | 'unknown';
}) {
  const brierHardFail = Number(process.env.CALIBRATION_BRIER_HARD_FAIL || 0.26);
  const errorHardFail = Number(process.env.AUTONOMY_ERROR_HARD_FAIL || 0.16);
  const shouldRollback =
    input.currentMode === 'autonomous' &&
    (input.forecastBrier >= brierHardFail || input.errorRate >= errorHardFail || input.marketRegime === 'risk_off');

  if (!shouldRollback) {
    return { rollbackTriggered: false as const };
  }

  const reason = input.forecastBrier >= brierHardFail
    ? `calibration_degraded(brier=${input.forecastBrier.toFixed(3)})`
    : input.errorRate >= errorHardFail
      ? `error_budget_breach(rate=${input.errorRate.toFixed(3)})`
      : 'risk_off_regime';

  return {
    rollbackTriggered: true as const,
    rollbackMode: 'assisted' as const,
    reason,
  };
}

function trackReliability(juryDecision: JuryDecision) {
  const recent = state.memory.slice(-100);
  const failures = recent.filter((entry) => entry.decision !== 'approve').length;
  const errorRate = recent.length > 0 ? failures / recent.length : 0;
  state.governance.currentErrorRate = errorRate;
  if (juryDecision === 'escalate') state.governance.escalations += 1;
  const withinBudget = errorRate <= state.governance.errorBudget;
  return {
    errorRate,
    withinBudget,
    recoveryMode: !withinBudget,
  };
}

function updateGroundTruth(sources: string[], response: string) {
  const signals = deriveGroundTruthSignals(sources, response);
  state.groundTruth.push(...signals);
  state.groundTruth = state.groundTruth.slice(-MAX_GROUND_TRUTH);
  return signals.length;
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 10000): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'freedomforge-max/1.0',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function ingestExternalGroundTruth() {
  initializeAutonomyDirector();
  const now = Date.now();
  const ingested: GroundTruthSignal[] = [];
  const errors: string[] = [];

  try {
    const fng = await fetchJsonWithTimeout('https://api.alternative.me/fng/?limit=1&format=json');
    const value = fng?.data?.[0]?.value;
    if (value) {
      ingested.push({
        source: 'alternative.me/fng',
        signal: `fear_greed_index=${value}`,
        confidence: 0.72,
        ts: now,
      });
    }
  } catch (error) {
    errors.push(`fng:${error instanceof Error ? error.message : 'unknown'}`);
  }

  try {
    const btc = await fetchJsonWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true');
    const price = btc?.bitcoin?.usd;
    const change = btc?.bitcoin?.usd_24h_change;
    if (price) {
      ingested.push({
        source: 'coingecko/btc',
        signal: `btc_usd=${price};change_24h=${Number(change || 0).toFixed(3)}`,
        confidence: 0.78,
        ts: now,
      });
    }
  } catch (error) {
    errors.push(`coingecko:${error instanceof Error ? error.message : 'unknown'}`);
  }

  try {
    const polymarket = await fetchJsonWithTimeout('https://gamma-api.polymarket.com/markets?closed=false&limit=5');
    const markets = Array.isArray(polymarket) ? polymarket.slice(0, 3) : [];
    markets.forEach((market: any, index: number) => {
      const title = String(market?.question || market?.title || `market_${index + 1}`).slice(0, 100);
      const volume = market?.volumeNum ?? market?.volume;
      ingested.push({
        source: 'polymarket/markets',
        signal: `market=${title};volume=${volume ?? 'n/a'}`,
        confidence: 0.68,
        ts: now,
      });
    });
  } catch (error) {
    errors.push(`polymarket:${error instanceof Error ? error.message : 'unknown'}`);
  }

  if (ingested.length > 0) {
    state.groundTruth.push(...ingested);
    state.groundTruth = state.groundTruth.slice(-MAX_GROUND_TRUTH);
    saveState();
  }

  await logEvent('autonomy_ground_truth_ingest', {
    ingested: ingested.length,
    errors,
    sources: ingested.map((row) => row.source),
  });

  return {
    ingested,
    errors,
  };
}

export async function triggerDriftRetraining(reason = 'scheduled_maintenance') {
  initializeAutonomyDirector();
  const recent = state.memory.slice(-120);
  const driftProxy = avg(recent.map((row) => row.riskScore * (1 - row.confidence)));
  const retrainThreshold = Number(process.env.DRIFT_RETRAIN_THRESHOLD || 0.35);
  const shouldRetrain = driftProxy >= retrainThreshold || reason === 'manual_force';

  const payload = {
    shouldRetrain,
    reason,
    driftProxy,
    threshold: retrainThreshold,
    samples: recent.length,
    at: new Date().toISOString(),
  };

  await logEvent('autonomy_retrain_check', payload);
  return payload;
}

export function updateApprovalPolicy(input: {
  mode?: ApprovalMode;
  autoApproveMinConfidence?: number;
  maxRiskForAutoApprove?: number;
  alwaysEscalateOnEthicsFlags?: boolean;
}) {
  initializeAutonomyDirector();

  const nextMode = input.mode || state.governance.approvalPolicy.mode;
  const nextAutoApproveMinConfidence = typeof input.autoApproveMinConfidence === 'number' && Number.isFinite(input.autoApproveMinConfidence)
    ? input.autoApproveMinConfidence
    : state.governance.approvalPolicy.autoApproveMinConfidence;
  const nextMaxRiskForAutoApprove = typeof input.maxRiskForAutoApprove === 'number' && Number.isFinite(input.maxRiskForAutoApprove)
    ? input.maxRiskForAutoApprove
    : state.governance.approvalPolicy.maxRiskForAutoApprove;
  const nextPolicy = {
    mode: nextMode,
    autoApproveMinConfidence: clamp(nextAutoApproveMinConfidence),
    maxRiskForAutoApprove: clamp(nextMaxRiskForAutoApprove),
    alwaysEscalateOnEthicsFlags: input.alwaysEscalateOnEthicsFlags ?? state.governance.approvalPolicy.alwaysEscalateOnEthicsFlags,
  };

  state.governance.approvalPolicy = nextPolicy;
  saveState();

  return nextPolicy;
}

export function initializeAutonomyDirector() {
  if (initialized) return;
  initialized = true;

  try {
    ensureDataDir();
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AutonomyState>;
      state = {
        ...state,
        ...parsed,
        toolStats: {
          ...state.toolStats,
          ...(parsed.toolStats || {}),
        },
        governance: {
          ...state.governance,
          ...(parsed.governance || {}),
        },
        ethics: {
          ...state.ethics,
          ...(parsed.ethics || {}),
        },
      };
    } else {
      saveState();
    }
  } catch {
    saveState();
  }
}

export async function runAutonomyDirector(input: AutonomyInput): Promise<AutonomyOutput> {
  initializeAutonomyDirector();

  const goals = parseGoals(input.userQuery);
  state.goals = goals;

  updateApiAdapters();

  const costEstimate = estimateCost(input.userQuery, input.modelResponses);
  const confidence = clamp((1 - input.riskScore) * 0.55 + (1 - input.driftScore) * 0.2 + 0.25);

  const teamReviews = runTeamOrchestration(input, confidence);
  const ethicsFlags = detectEthicsFlags(input.userQuery, input.selectedResponse);
  const juryDecision = runPeerJury(teamReviews, ethicsFlags, confidence, input.riskScore);
  const responseWithReflection = runReflectionAtScale(input.selectedResponse, juryDecision);

  const selfPlayEpisode = runSelfPlay(input.modelResponses, input.riskScore);
  const retrainTriggered = maybeTriggerRetraining(input.driftScore, confidence, juryDecision);
  const financeAutonomy = getFinanceAutonomy(input, confidence);
  const reliability = trackReliability(juryDecision);
  const groundTruthSignals = updateGroundTruth(input.sources, responseWithReflection);
  const marketSignalCount = (input.marketSignals || []).length;
  const forecastSignalCount = input.forecastConfidence ? 1 : 0;
  const forecastBrier = clamp(input.forecastBrierScore ?? 0.25, 0, 1);
  const riskControls = deriveRiskControls(input, confidence);

  const rollback = maybeRollbackApprovalMode({
    currentMode: state.governance.approvalPolicy.mode,
    forecastBrier,
    errorRate: reliability.errorRate,
    marketRegime: input.marketRegime,
  });

  if (rollback.rollbackTriggered) {
    state.governance.approvalPolicy.mode = rollback.rollbackMode;
  }

  const tunedPolicy = autoTuneApprovalThresholds({
    mode: state.governance.approvalPolicy.mode,
    autoApproveMinConfidence: state.governance.approvalPolicy.autoApproveMinConfidence,
    maxRiskForAutoApprove: state.governance.approvalPolicy.maxRiskForAutoApprove,
    alwaysEscalateOnEthicsFlags: state.governance.approvalPolicy.alwaysEscalateOnEthicsFlags,
    currentErrorRate: reliability.errorRate,
    forecastBrierScore: forecastBrier,
    marketRegime: input.marketRegime || 'unknown',
  });
  state.governance.approvalPolicy = tunedPolicy;

  if (riskControls.positionSizeBps <= 120) {
    financeAutonomy.mode = 'monitor';
  }
  if (!riskControls.shouldTrade) {
    financeAutonomy.mode = 'monitor';
    financeAutonomy.actions.push(`suspend_new_entries:${riskControls.throttleReason || 'quality_guard'}`);
  }
  financeAutonomy.actions.push(`set_position_size_bps:${riskControls.positionSizeBps}`);
  financeAutonomy.actions.push(`set_hard_stop_loss_pct:${riskControls.stopLossPct}`);
  financeAutonomy.actions.push(`signal_edge:${riskControls.signedEdge}`);
  financeAutonomy.actions.push(`trade_quality_score:${riskControls.qualityScore.toFixed(3)}`);
  if (rollback.rollbackTriggered) {
    financeAutonomy.actions.push(`rollback_approval_mode:${rollback.rollbackMode}`);
  }
  financeAutonomy.riskControls = {
    positionSizeBps: riskControls.positionSizeBps,
    stopLossPct: riskControls.stopLossPct,
    rollbackTriggered: rollback.rollbackTriggered,
    reason: rollback.rollbackTriggered ? rollback.reason : riskControls.throttleReason,
  };

  updateToolStats('web_search', confidence, input.sources.length > 0);
  updateToolStats('knowledge_base', confidence, true);
  updateToolStats('multi_model', confidence, input.modelResponses.length > 0);
  updateToolStats('blockchain_context', confidence, input.sources.some((source) => source.startsWith('alchemy://')));

  const queryHash = createHash('sha256').update(input.userQuery).digest('hex').slice(0, 16);
  state.memory.push({
    id: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    queryHash,
    confidence,
    riskScore: input.riskScore,
    decision: juryDecision,
    retrainTriggered,
  });
  state.memory = state.memory.slice(-MAX_MEMORY);

  saveState();

  await logEvent('autonomy_decision', {
    queryHash,
    confidence,
    juryDecision,
    retrainTriggered,
    goals,
    costEstimate,
    teamReviews,
    reliability,
    financeAutonomy,
    predictionReadiness: clamp(
      (1 - input.riskScore) * 0.35 +
      confidence * 0.25 +
      clamp(input.marketConfidence ?? 0.5) * 0.15 +
      clamp(input.forecastConfidence ?? 0.5) * 0.15 +
      (1 - forecastBrier) * 0.10
    ),
    groundTruthSignals,
    marketRegime: input.marketRegime || 'unknown',
    marketConfidence: clamp(input.marketConfidence ?? 0.5),
    marketSignals: input.marketSignals || [],
    riskControls: {
      positionSizeBps: riskControls.positionSizeBps,
      stopLossPct: riskControls.stopLossPct,
      reliability: riskControls.reliability,
      qualityScore: riskControls.qualityScore,
      edge: riskControls.edge,
      shouldTrade: riskControls.shouldTrade,
      throttleReason: riskControls.throttleReason,
    },
    rollback,
    tunedPolicy,
    selfPlayEpisode,
    ethicsFlags,
  });

  return {
    finalResponse: responseWithReflection,
    confidence,
    juryDecision,
    retrainTriggered,
    goals,
    costEstimate,
    reliability,
    financeAutonomy,
    predictionAutonomy: {
      readiness: clamp(
        (1 - input.riskScore) * 0.35 +
        confidence * 0.25 +
        clamp(input.marketConfidence ?? 0.5) * 0.15 +
        clamp(input.forecastConfidence ?? 0.5) * 0.15 +
        (1 - forecastBrier) * 0.10
      ),
      signalsUsed: groundTruthSignals + marketSignalCount + forecastSignalCount,
    },
    symbiosis: {
      humanRequired: juryDecision === 'escalate',
      reason: juryDecision === 'escalate' ? 'Ethical or high-risk operational signal detected.' : undefined,
    },
    ethicalAlignment: {
      score: clamp(1 - ethicsFlags.length * 0.25 - input.riskScore * 0.2),
      flags: ethicsFlags,
    },
    teamReviews,
  };
}

export function getAutonomySnapshot() {
  initializeAutonomyDirector();
  const recentConfidence = avg(state.memory.slice(-50).map((entry) => entry.confidence));
  return {
    goalCount: state.goals.length,
    memorySize: state.memory.length,
    toolStats: state.toolStats,
    adapters: state.apiAdapters,
    governance: state.governance,
    recentConfidence,
    groundTruthSignals: state.groundTruth.length,
    recentGroundTruth: state.groundTruth.slice(-10),
    selfPlayEpisodes: state.selfPlay.length,
  };
}
