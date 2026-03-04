/**
 * Knowledge Synthesis Pipeline
 * Combines multiple sources (web search, RAG, models) into coherent responses
 */

import { getAvailableModels, getMultiModelResponse, initializeModels } from '../models/modelOrchestrator';
import { enhancePromptWithWebSearch } from '../search/webSearch';
import { enhancePromptWithKnowledgeBase, initializeRAG } from '../rag/vectorStore';
import { getLatestBlock, getBalance } from '../alchemy/connector';
import { initializeAdaptiveIntelligence, runAdaptiveDecisionLoop } from '@/lib/intelligence/adaptiveCortex';
import { initializeAutonomyDirector, runAutonomyDirector } from '@/lib/intelligence/autonomyDirector';
import { initializeMarketFeatureStore, maybeRefreshMarketFeatureStore } from '@/lib/intelligence/marketFeatureStore';
import { ensureForecastEnsemble, ensureMarketForecast, getForecastDecisionSignal, initializeForecastEngine, resolveDueForecasts, getForecastSummary } from '@/lib/intelligence/forecastEngine';
import { initializeChampionPolicy, recordChampionOutcome, selectChampionChallengerRouting } from '@/lib/intelligence/championPolicy';
import { initializeMemoryEngine, recallMemories, rememberEpisode } from '@/lib/intelligence/memoryEngine';
import { getAdaptiveOpportunityPlan } from '@/lib/intelligence/opportunityEngine';
import { buildVendorStrategyContext } from '@/lib/intelligence/vendorStack';
import { buildBehavioralContext } from '@/lib/intelligence/behavioralIntel';
import { logEvent } from '@/lib/logger';

function isMaxModeEnabled() {
  return String(process.env.MAX_INTELLIGENCE_MODE || process.env.AUTONOMY_MAX_MODE || 'false').toLowerCase() === 'true';
}

function isUsableResponse(text: string) {
  const value = (text || '').trim().toLowerCase();
  if (!value) return false;
  if (value === 'no response') return false;
  if (value.startsWith('error:')) return false;
  return value.length >= 24;
}

function firstUsableResponse(responses: Array<{ response: string }>) {
  return responses.find((item) => isUsableResponse(item.response))?.response || '';
}

function extractKeyLines(text: string, limit = 2) {
  const lines = (text || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 18)
    .filter((line) => !/^sources?:/i.test(line));
  return lines.slice(0, limit);
}

function classifyResponseIssue(text: string) {
  const value = (text || '').trim().toLowerCase();
  if (!value) return 'empty';
  if (value === 'no response') return 'no_response';
  if (value.startsWith('error:')) return 'provider_error';
  if (value.length < 24) return 'too_short';
  return 'filtered_by_consensus';
}

function tokenSet(text: string) {
  return new Set(
    (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>) {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let intersection = 0;
  a.forEach((token) => {
    if (b.has(token)) intersection += 1;
  });
  return intersection / union.size;
}

function computeAgreementScore(items: Array<{ response: string }>) {
  if (items.length <= 1) return 1;
  const sets = items.map((item) => tokenSet(item.response));
  const pairs: number[] = [];
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      pairs.push(jaccard(sets[i], sets[j]));
    }
  }
  if (pairs.length === 0) return 1;
  const avg = pairs.reduce((sum, value) => sum + value, 0) / pairs.length;
  return Number(avg.toFixed(4));
}

interface ReasoningProfile {
  mode: 'lean' | 'balanced' | 'deep';
  bottomLineProtected: boolean;
  complexityScore: number;
  budgetUsd: number;
  estimatedTokensPerModel: number;
  modelBudgetCap: number;
  initialModelCount: number;
  maxModelCount: number;
  escalationEnabled: boolean;
  escalationAgreementThreshold: number;
  escalationConfidenceThreshold: number;
}

function countWords(text: string) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

function isBottomLineCriticalQuery(query: string) {
  return /(portfolio|allocation|position size|rebalance|drawdown|risk|autopilot|prediction market|trade|entry|exit|capital|cashflow|budget|revenue|payout|transfer|wire|execute|bottom line|profit|loss)/i.test(
    query
  );
}

function isLowStakesQuery(query: string) {
  const text = (query || '').trim();
  if (!text) return true;
  const words = countWords(text);
  if (words <= 3) return true;
  if (/^(hi|hello|hey|yo|ping|status\??|gm|gn)$/i.test(text)) return true;
  return false;
}

function estimateComplexityScore(input: {
  userQuery: string;
  maxMode: boolean;
  marketRegime?: 'risk_on' | 'risk_off' | 'neutral' | 'unknown';
  marketConfidence?: number;
  forecastConfidence?: number;
  forecastBrier?: number;
}) {
  const words = countWords(input.userQuery);
  const query = input.userQuery.toLowerCase();
  const strategyIntent = /(strategy|plan|roadmap|allocation|portfolio|risk|trade|forecast|reason|optimi|architecture|compare|autonomy)/i.test(query);
  const highImpactIntent = /(transfer|wire|execute|autopilot|all-in|leverage|rebalance|deploy|live)/i.test(query) || isBottomLineCriticalQuery(query);
  const uncertainMarket = (input.marketConfidence ?? 0.5) < 0.5 || (input.forecastConfidence ?? 0.5) < 0.52 || (input.forecastBrier ?? 0.2) > 0.22;
  const riskOff = input.marketRegime === 'risk_off';

  let score = 0.2;
  score += Math.min(0.25, words / 140);
  if (strategyIntent) score += 0.2;
  if (highImpactIntent) score += 0.2;
  if (uncertainMarket) score += 0.15;
  if (riskOff) score += 0.1;
  if (input.maxMode) score += 0.15;

  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

function buildReasoningProfile(input: {
  userQuery: string;
  maxMode: boolean;
  availableModelCount: number;
  baselineModelCount: number;
  marketRegime?: 'risk_on' | 'risk_off' | 'neutral' | 'unknown';
  marketConfidence?: number;
  forecastConfidence?: number;
  forecastBrier?: number;
}): ReasoningProfile {
  const bottomLineProtected = isBottomLineCriticalQuery(input.userQuery);

  const complexityScore = estimateComplexityScore({
    userQuery: input.userQuery,
    maxMode: input.maxMode,
    marketRegime: input.marketRegime,
    marketConfidence: input.marketConfidence,
    forecastConfidence: input.forecastConfidence,
    forecastBrier: input.forecastBrier,
  });

  const budgetUsdDefault = input.maxMode ? 0.028 : 0.012;
  const criticalBudgetDefault = input.maxMode ? 0.04 : 0.025;
  const baseBudget = Math.max(0.002, Number(process.env.AI_QUERY_BUDGET_USD || budgetUsdDefault));
  const criticalBudget = Math.max(baseBudget, Number(process.env.AI_CRITICAL_QUERY_BUDGET_USD || criticalBudgetDefault));
  const budgetUsd = bottomLineProtected ? criticalBudget : baseBudget;
  const costPer1kTokens = Math.max(0.0001, Number(process.env.AI_MODEL_COST_PER_1K_TOKENS || 0.0022));

  const estimatedTokensPerModel =
    complexityScore >= 0.75 ? 1300
      : complexityScore >= 0.45 ? 950
        : 650;

  const estimatedCostPerModel = (estimatedTokensPerModel / 1000) * costPer1kTokens;
  const computedBudgetCap = Math.floor(budgetUsd / Math.max(0.000001, estimatedCostPerModel));
  const modelBudgetCap = Math.max(1, Math.min(input.availableModelCount, computedBudgetCap));

  const minModelsBase = Math.max(1, Number(process.env.AI_MIN_MODEL_COUNT || 1));
  const criticalMinModels = Math.max(minModelsBase, Number(process.env.AI_CRITICAL_MIN_MODEL_COUNT || 3));
  const minModels = bottomLineProtected ? criticalMinModels : minModelsBase;
  const maxModelsEnv = Math.max(1, Number(process.env.AI_MAX_MODEL_COUNT || (input.maxMode ? 5 : 4)));
  const criticalMaxFloor = Math.max(minModels, Number(process.env.AI_CRITICAL_MAX_MODEL_COUNT || 4));

  const mode: ReasoningProfile['mode'] =
    complexityScore >= 0.75 ? 'deep'
      : complexityScore >= 0.4 ? 'balanced'
        : 'lean';

  const initialFromComplexity =
    mode === 'deep' ? 3
      : mode === 'balanced' ? 2
        : 1;

  const initialModelCount = Math.max(
    minModels,
    Math.min(input.availableModelCount, input.baselineModelCount, initialFromComplexity, modelBudgetCap)
  );

  const targetMaxFromMode =
    mode === 'deep' ? Math.max(input.baselineModelCount, input.maxMode ? 5 : 4)
      : mode === 'balanced' ? Math.max(initialModelCount + 1, input.baselineModelCount)
        : initialModelCount;

  let maxModelCount = Math.max(
    initialModelCount,
    Math.min(input.availableModelCount, maxModelsEnv, modelBudgetCap, targetMaxFromMode)
  );

  if (bottomLineProtected) {
    maxModelCount = Math.max(
      maxModelCount,
      Math.min(input.availableModelCount, maxModelsEnv, criticalMaxFloor, modelBudgetCap)
    );
  }

  const escalationEnabled = maxModelCount > initialModelCount;
  const escalationAgreementThreshold = Math.max(0.08, Math.min(0.7, Number(process.env.AI_ESCALATION_AGREEMENT_THRESHOLD || 0.23)));
  const escalationConfidenceThreshold = Math.max(0.3, Math.min(0.9, Number(process.env.AI_ESCALATION_CONFIDENCE_THRESHOLD || 0.56)));

  return {
    mode,
    bottomLineProtected,
    complexityScore,
    budgetUsd,
    estimatedTokensPerModel,
    modelBudgetCap,
    initialModelCount,
    maxModelCount,
    escalationEnabled,
    escalationAgreementThreshold,
    escalationConfidenceThreshold,
  };
}

function shouldEscalateModelPass(input: {
  profile: ReasoningProfile;
  consensusAgreement: number;
  maxConfidence: number;
  userQuery: string;
}): { escalate: boolean; reasons: string[] } {
  if (!input.profile.escalationEnabled) {
    return { escalate: false, reasons: [] };
  }

  const reasons: string[] = [];
  const lowStakes = isLowStakesQuery(input.userQuery);
  const highImpact = /(autopilot|transfer|wire|execute|allocation|portfolio|prediction market|leverage|all-in)/i.test(input.userQuery);

  if (lowStakes && !input.profile.bottomLineProtected && !highImpact) {
    return { escalate: false, reasons: [] };
  }

  if (input.consensusAgreement < input.profile.escalationAgreementThreshold) {
    reasons.push(`low_agreement(${input.consensusAgreement.toFixed(3)})`);
  }
  if (input.maxConfidence < input.profile.escalationConfidenceThreshold) {
    reasons.push(`low_confidence(${input.maxConfidence.toFixed(3)})`);
  }

  if (highImpact) {
    reasons.push('high_impact_query');
  }

  if (input.profile.bottomLineProtected) {
    reasons.push('bottom_line_protection');
  }

  if (input.profile.mode === 'deep' && reasons.length === 0) {
    reasons.push('deep_mode_committee');
  }

  return {
    escalate: reasons.length > 0,
    reasons,
  };
}

function buildEnsembleConsensus(input: {
  responses: Array<{ model: string; response: string; confidence: number }>;
  maxMode: boolean;
}) {
  const usable = input.responses
    .filter((row) => isUsableResponse(row.response))
    .sort((a, b) => b.confidence - a.confidence);

  if (usable.length === 0) {
    return {
      response: '',
      participatingModels: [] as string[],
      droppedModels: input.responses.map((row) => row.model),
      droppedDetails: input.responses.map((row) => ({
        model: row.model,
        reason: classifyResponseIssue(row.response),
      })),
      agreementScore: 0,
    };
  }

  if (usable.length === 1) {
    return {
      response: usable[0].response,
      participatingModels: [usable[0].model],
      droppedModels: input.responses.filter((row) => row.model !== usable[0].model).map((row) => row.model),
      droppedDetails: input.responses
        .filter((row) => row.model !== usable[0].model)
        .map((row) => ({
          model: row.model,
          reason: classifyResponseIssue(row.response),
        })),
      agreementScore: 1,
    };
  }

  const topN = input.maxMode ? Math.min(4, usable.length) : Math.min(3, usable.length);
  const picked = usable.slice(0, topN);
  const lines = picked.flatMap((row) => extractKeyLines(row.response, 2));

  const seen = new Set<string>();
  const dedupedLines = lines.filter((line) => {
    const key = line.toLowerCase().slice(0, 120);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, input.maxMode ? 6 : 4);

  const response = [
    'Ensemble consensus:',
    ...dedupedLines.map((line) => `- ${line}`),
    `Committee coverage: ${picked.map((row) => row.model).join(', ')}`,
  ].join('\n');

  return {
    response,
    participatingModels: picked.map((row) => row.model),
    droppedModels: input.responses
      .map((row) => row.model)
      .filter((name) => !picked.some((row) => row.model === name)),
    droppedDetails: input.responses
      .filter((row) => !picked.some((candidate) => candidate.model === row.model))
      .map((row) => ({
        model: row.model,
        reason: classifyResponseIssue(row.response),
      })),
    agreementScore: computeAgreementScore(picked),
  };
}

interface SynthesisResult {
  response: string;
  sources: string[];
  models_used: string[];
  search_results: number;
  knowledge_base_hits: number;
  reasoning: string;
  risk_score?: number;
  drift_score?: number;
  xai?: {
    decision_id: string;
    selected_action: string;
    epsilon: number;
    contributions: Record<string, number>;
    agent_outputs: Record<string, string>;
  };
  autonomy?: {
    confidence: number;
    jury_decision: 'approve' | 'revise' | 'escalate';
    retrain_triggered: boolean;
    goals: Array<{
      id: string;
      label: string;
      objective: string;
      priority: number;
      horizon: string;
    }>;
    cost_estimate: {
      tokens_approx: number;
      estimated_usd: number;
    };
    reliability: {
      error_rate: number;
      within_budget: boolean;
      recovery_mode: boolean;
    };
    finance_autonomy: {
      mode: 'monitor' | 'autopilot';
      actions: string[];
    };
    prediction_autonomy: {
      readiness: number;
      signals_used: number;
    };
    symbiosis: {
      human_required: boolean;
      reason?: string;
    };
    ethical_alignment: {
      score: number;
      flags: string[];
    };
    team_reviews: Array<{
      team: string;
      verdict: string;
      score: number;
    }>;
  };
  routing_profile?: {
    mode: 'lean' | 'balanced' | 'deep';
    bottom_line_protected: boolean;
    complexity_score: number;
    budget_usd: number;
    estimated_tokens_per_model: number;
    model_budget_cap: number;
    initial_models: number;
    final_models: number;
    escalated: boolean;
    escalation_reasons: string[];
    agreement_score: number;
  };
  timestamp: number;
}

/**
 * Initialize all systems
 */
export async function initializeSynthesis() {
  await initializeModels();
  await initializeRAG();
  initializeMarketFeatureStore();
  initializeForecastEngine();
  initializeChampionPolicy();
  initializeMemoryEngine();
  initializeAdaptiveIntelligence();
  initializeAutonomyDirector();
  console.log('Knowledge synthesis engine initialized');
}

/**
 * Main synthesis function - combines all AI systems
 */
export async function synthesizeAnswer(userQuery: string): Promise<SynthesisResult> {
  const startTime = Date.now();
  const maxMode = isMaxModeEnabled();
  const sources: string[] = [];
  let enhancedPrompt = userQuery;
  let searchResultCount = 0;
  let kbHitCount = 0;
  let marketContext: Awaited<ReturnType<typeof maybeRefreshMarketFeatureStore>> = null;
  let recalledMemories: ReturnType<typeof recallMemories> = [];
  const forecastContext = {
    probability: 0.5,
    confidence: 0.5,
    brier: 0.25,
  };
  const vendorContext = buildVendorStrategyContext();

  try {
    // Step 0: Optionally fetch alchemy data if relevant
    if (process.env.ALCHEMY_API_KEY) {
      console.log('🔗 Fetching blockchain context from Alchemy...');
      const block = await getLatestBlock();
      if (block !== null) {
        enhancedPrompt += `\n\n[current blockchain block number: ${block}]`;
        sources.push('alchemy://latestBlock');
      }
      // you could also fetch additional info based on keywords
      if (userQuery.toLowerCase().includes('balance')) {
        const match = userQuery.match(/0x[a-fA-F0-9]{40}/);
        if (match) {
          const bal = await getBalance(match[0]);
          if (bal) {
            enhancedPrompt += `\n\n[balance of ${match[0]}: ${bal}]`;
            sources.push('alchemy://balance');
          }
        }
      }
    }

    // Step 1: Enhance with web search
    console.log('🔍 Searching web for current information...');
    const webContext = await enhancePromptWithWebSearch(userQuery);
    enhancedPrompt = webContext.withContext;
    searchResultCount = webContext.sources.length;
    sources.push(...webContext.sources.map((s) => s.url));

    // Step 1.5: Add market regime context
    marketContext = await maybeRefreshMarketFeatureStore();
    if (marketContext) {
      enhancedPrompt += `\n\n[market regime: ${marketContext.regime}; confidence: ${marketContext.confidence.toFixed(2)}; signals: ${(marketContext.signals || []).join(', ') || 'none'}; btc_24h_change: ${marketContext.btcChange24h.toFixed(3)}]`;
      sources.push(`market://regime/${marketContext.regime}`);
    }

    recalledMemories = recallMemories(userQuery, {
      topK: 5,
      regime: marketContext?.regime || 'unknown',
    });

    const behavioralContext = buildBehavioralContext({
      userQuery,
      market: marketContext,
      recalledMemories,
    });

    enhancedPrompt += `\n\n${behavioralContext.promptBlock}`;
    sources.push('behavioral://context');

    if (recalledMemories.length > 0) {
      enhancedPrompt += `\n\n[memory recall]\n${recalledMemories
        .map((item, index) => `${index + 1}. q="${item.query.slice(0, 120)}" reward=${item.reward.toFixed(2)} risk=${item.riskScore.toFixed(2)} note="${item.responseSummary.slice(0, 140)}"`)
        .join('\n')}`;
      sources.push(...recalledMemories.map((item) => `memory://${item.id}`));
    }

    await resolveDueForecasts();
    await ensureForecastEnsemble();
    const forecast = await ensureMarketForecast();
    const forecastSummary = getForecastSummary();
    const forecastDecision = getForecastDecisionSignal();
    if (forecast) {
      forecastContext.probability = forecastDecision.weightedProbability;
      forecastContext.confidence = forecastDecision.weightedConfidence;
      enhancedPrompt += `\n\n[forecast: ${forecast.question}; probability=${forecast.probability.toFixed(3)}; confidence=${forecast.confidence.toFixed(3)}]`;
      sources.push(`forecast://${forecast.id}`);
    }
    if (typeof forecastSummary.averageBrierScore === 'number') {
      forecastContext.brier = forecastDecision.weightedBrier;
      enhancedPrompt += `\n\n[forecast calibration brier=${forecastDecision.weightedBrier.toFixed(4)}; confidence_adj=${forecastDecision.weightedConfidence.toFixed(3)}; horizons=${forecastDecision.horizons.join(',') || 'n/a'}; shock_risk=${forecastDecision.shockRisk.toFixed(3)}]`;
    }

    const opportunityPlan = getAdaptiveOpportunityPlan(userQuery);
    if (opportunityPlan.opportunities.length > 0) {
      const primary = opportunityPlan.opportunities[0];
      enhancedPrompt += `\n\n[opportunity signal]\nprimary=${primary.title}; direction=${primary.direction}; score=${primary.score.toFixed(3)}; conviction=${primary.conviction.toFixed(3)}; rationale=${primary.rationale}`;
      sources.push(`opportunity://${primary.id}`);
    }

    enhancedPrompt += `\n\n[text interaction policy]\nmode=${vendorContext.textFirst.mode}; rules=${vendorContext.textFirst.policy.join(' | ')}`;
    enhancedPrompt += `\n\n[external strategy capabilities]\nbenefits=${vendorContext.topBenefits.slice(0, 10).join('; ')}\nhooks=${vendorContext.topHooks.slice(0, 12).join('; ')}`;
    if (maxMode) {
      enhancedPrompt += `\n\n[investment committee policy]\nprioritize capital preservation, asymmetric upside, calibration discipline, and explicit downside scenarios. Require a margin-of-safety framing before autonomous actions.`;
      enhancedPrompt += `\n\n[max intelligence mode]\nuse deeper ensemble comparison, emphasize conflicting signals, and degrade autonomy when signal quality is weak.`;
      sources.push('policy://max-intelligence-mode');
    }
    sources.push('vendor://strategy-stack');

    // Step 2: Enhance with knowledge base
    console.log('📚 Checking knowledge base...');
    const kbEnhancedPrompt = await enhancePromptWithKnowledgeBase(enhancedPrompt);
    const kbMatches = kbEnhancedPrompt.split('knowledge base context').length - 1;
    kbHitCount = kbMatches;
    enhancedPrompt = kbEnhancedPrompt;

    // Step 3: Get responses from multiple models
    console.log('🤖 Querying multiple AI models...');
    const routing = selectChampionChallengerRouting({
      availableModels: getAvailableModels(),
      regime: marketContext?.regime || 'unknown',
      forecastBrierScore: forecastContext.brier,
      forecastConfidence: forecastContext.confidence,
      marketConfidence: marketContext?.confidence ?? 0.5,
    });

    if (maxMode) {
      routing.modelCount = Math.max(routing.modelCount, Math.min(5, Math.max(3, getAvailableModels().length)));
    }

    const reasoningProfile = buildReasoningProfile({
      userQuery,
      maxMode,
      availableModelCount: getAvailableModels().length,
      baselineModelCount: routing.modelCount,
      marketRegime: marketContext?.regime || 'unknown',
      marketConfidence: marketContext?.confidence ?? 0.5,
      forecastConfidence: forecastContext.confidence,
      forecastBrier: forecastContext.brier,
    });

    let modelResponses = await getMultiModelResponse(enhancedPrompt, reasoningProfile.initialModelCount, {
      preferredModels: routing.preferredModels,
    });

    let consensus = buildEnsembleConsensus({
      responses: modelResponses,
      maxMode,
    });

    const passOneModelsUsed = modelResponses.map((row) => row.model);
    const passOneMaxConfidence = modelResponses.length
      ? Math.max(...modelResponses.map((row) => row.confidence))
      : 0;

    const escalationDecision = shouldEscalateModelPass({
      profile: reasoningProfile,
      consensusAgreement: consensus.agreementScore,
      maxConfidence: passOneMaxConfidence,
      userQuery,
    });

    if (escalationDecision.escalate && reasoningProfile.maxModelCount > reasoningProfile.initialModelCount) {
      const escalatedResponses = await getMultiModelResponse(enhancedPrompt, reasoningProfile.maxModelCount, {
        preferredModels: routing.preferredModels,
      });

      if (escalatedResponses.length > modelResponses.length) {
        modelResponses = escalatedResponses;
        consensus = buildEnsembleConsensus({
          responses: modelResponses,
          maxMode,
        });
      }
    }

    const modelsUsed = modelResponses.map((r) => r.model);
    await logEvent('ensemble_decision', {
      queriedModels: modelsUsed,
      passOneModels: passOneModelsUsed,
      participatingModels: consensus.participatingModels,
      droppedModels: consensus.droppedModels,
      droppedDetails: consensus.droppedDetails,
      agreementScore: consensus.agreementScore,
      maxMode,
      routingRationale: routing.rationale,
      reasoningProfile,
      escalated: escalationDecision.escalate,
      escalationReasons: escalationDecision.reasons,
    });
    if (consensus.participatingModels.length > 1) {
      sources.push('model://ensemble-consensus');
    }

    const adaptiveDecision = await runAdaptiveDecisionLoop({
      userQuery,
      modelResponses,
      sources,
    });

    const selectedResponse =
      (adaptiveDecision?.response && isUsableResponse(adaptiveDecision.response) ? adaptiveDecision.response : '') ||
      (consensus.response && isUsableResponse(consensus.response) ? consensus.response : '') ||
      firstUsableResponse(modelResponses) ||
      'Unable to generate response';

    const selectedModel = adaptiveDecision?.modelsUsed?.[0] || modelResponses[0]?.model;

    const autonomyDecision = await runAutonomyDirector({
      userQuery,
      selectedResponse,
      modelResponses,
      sources,
      riskScore: adaptiveDecision?.riskScore ?? 0.5,
      driftScore: adaptiveDecision?.driftScore ?? 0,
      marketRegime: marketContext?.regime || 'unknown',
      marketConfidence: marketContext?.confidence ?? 0.5,
      marketSignals: marketContext?.signals || [],
      forecastProbability: forecastContext.probability,
      forecastConfidence: forecastContext.confidence,
      forecastBrierScore: forecastContext.brier,
    });

    if (selectedModel) {
      recordChampionOutcome({
        regime: marketContext?.regime || 'unknown',
        queriedModels: modelsUsed,
        selectedModel,
        reward: adaptiveDecision?.reward ?? autonomyDecision.confidence,
        riskScore: adaptiveDecision?.riskScore ?? 0.5,
        forecastBrierScore: forecastContext.brier,
      });
    }

    rememberEpisode({
      query: userQuery,
      responseSummary: autonomyDecision.finalResponse,
      regime: marketContext?.regime || 'unknown',
      reward: adaptiveDecision?.reward ?? autonomyDecision.confidence,
      confidence: autonomyDecision.confidence,
      riskScore: adaptiveDecision?.riskScore ?? 0.5,
      forecastProbability: forecastContext.probability,
      forecastBrier: forecastContext.brier,
      sources,
      tags: ['synthesis', 'adaptive'],
    });

    // Step 4: Synthesize best response
    const bestResponse = autonomyDecision.finalResponse;

    // Step 5: Add sources to response
    const finalResponse = formatFinalResponse(bestResponse, sources);

    const synthesisTime = Date.now() - startTime;

    return {
      response: finalResponse,
      sources: [...new Set(sources)],
      models_used: modelsUsed,
      search_results: searchResultCount,
      knowledge_base_hits: kbHitCount,
      reasoning: adaptiveDecision
        ? `${adaptiveDecision.reasoning} Synthesis completed in ${synthesisTime}ms. Used ${modelsUsed.length} models, ${searchResultCount} web results, ${kbHitCount} KB hits. Routing=${reasoningProfile.mode}; escalated=${escalationDecision.escalate}; agreement=${consensus.agreementScore.toFixed(3)}.`
        : `Synthesis completed in ${synthesisTime}ms. Used ${modelsUsed.length} models, ${searchResultCount} web results, ${kbHitCount} KB hits. Routing=${reasoningProfile.mode}; escalated=${escalationDecision.escalate}; agreement=${consensus.agreementScore.toFixed(3)}.`,
      risk_score: adaptiveDecision?.riskScore,
      drift_score: adaptiveDecision?.driftScore,
      xai: adaptiveDecision
        ? {
            decision_id: adaptiveDecision.xai.decisionId,
            selected_action: adaptiveDecision.xai.selectedAction,
            epsilon: adaptiveDecision.xai.epsilon,
            contributions: adaptiveDecision.xai.contributions,
            agent_outputs: adaptiveDecision.xai.agentOutputs,
          }
        : undefined,
      autonomy: {
        confidence: autonomyDecision.confidence,
        jury_decision: autonomyDecision.juryDecision,
        retrain_triggered: autonomyDecision.retrainTriggered,
        goals: autonomyDecision.goals,
        cost_estimate: {
          tokens_approx: autonomyDecision.costEstimate.tokensApprox,
          estimated_usd: autonomyDecision.costEstimate.estimatedUsd,
        },
        reliability: {
          error_rate: autonomyDecision.reliability.errorRate,
          within_budget: autonomyDecision.reliability.withinBudget,
          recovery_mode: autonomyDecision.reliability.recoveryMode,
        },
        finance_autonomy: autonomyDecision.financeAutonomy,
        prediction_autonomy: {
          readiness: autonomyDecision.predictionAutonomy.readiness,
          signals_used: autonomyDecision.predictionAutonomy.signalsUsed,
        },
        symbiosis: {
          human_required: autonomyDecision.symbiosis.humanRequired,
          reason: autonomyDecision.symbiosis.reason,
        },
        ethical_alignment: autonomyDecision.ethicalAlignment,
        team_reviews: autonomyDecision.teamReviews,
      },
      routing_profile: {
        mode: reasoningProfile.mode,
        bottom_line_protected: reasoningProfile.bottomLineProtected,
        complexity_score: reasoningProfile.complexityScore,
        budget_usd: Number(reasoningProfile.budgetUsd.toFixed(4)),
        estimated_tokens_per_model: reasoningProfile.estimatedTokensPerModel,
        model_budget_cap: reasoningProfile.modelBudgetCap,
        initial_models: reasoningProfile.initialModelCount,
        final_models: modelsUsed.length,
        escalated: escalationDecision.escalate,
        escalation_reasons: escalationDecision.reasons,
        agreement_score: consensus.agreementScore,
      },
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error('Synthesis error:', error);
    throw error;
  }
}

/**
 * Format final response with citations
 */
function formatFinalResponse(response: string, sources: string[]): string {
  let formatted = response;

  // Add source citations
  if (sources.length > 0) {
    const uniqueSources = [...new Set(sources)];
    const citations = uniqueSources
      .slice(0, 5)
      .map((s, i) => `[${i + 1}] ${s}`)
      .join('\n');

    formatted += `\n\n📚 Sources:\n${citations}`;
  }

  return formatted;
}

/**
 * Streaming synthesis for real-time responses
 */
export async function* synthesizeAnswerStreaming(userQuery: string) {
  yield {
    status: 'initializing',
    message: 'Starting knowledge synthesis...',
  };

  try {
    // Parallel initialization
    yield { status: 'searching', message: '🔍 Searching web...' };
    const webContext = await enhancePromptWithWebSearch(userQuery);

    yield { status: 'knowledge_base', message: '📚 Querying knowledge base...' };
    await enhancePromptWithKnowledgeBase(webContext.withContext);

    yield { status: 'model_query', message: '🤖 Querying AI models...' };
    const result = await synthesizeAnswer(userQuery);

    yield {
      status: 'complete',
      result: result,
    };
  } catch (error) {
    yield {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Compare responses from different models
 */
export async function compareModelResponses(query: string) {
  const responses = await getMultiModelResponse(query, 3);

  return responses.map((r) => ({
    model: r.model,
    response: r.response.substring(0, 300) + '...',
    confidence: r.confidence,
    timestamp: new Date(r.timestamp).toISOString(),
  }));
}
