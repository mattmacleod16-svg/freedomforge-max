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
import { ensureMarketForecast, initializeForecastEngine, resolveDueForecasts, getForecastSummary } from '@/lib/intelligence/forecastEngine';
import { initializeChampionPolicy, recordChampionOutcome, selectChampionChallengerRouting } from '@/lib/intelligence/championPolicy';
import { initializeMemoryEngine, recallMemories, rememberEpisode } from '@/lib/intelligence/memoryEngine';
import { getAdaptiveOpportunityPlan } from '@/lib/intelligence/opportunityEngine';
import { buildVendorStrategyContext } from '@/lib/intelligence/vendorStack';
import { buildBehavioralContext } from '@/lib/intelligence/behavioralIntel';

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
    };
  }

  if (usable.length === 1) {
    return {
      response: usable[0].response,
      participatingModels: [usable[0].model],
      droppedModels: input.responses.filter((row) => row.model !== usable[0].model).map((row) => row.model),
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
    const forecast = await ensureMarketForecast();
    const forecastSummary = getForecastSummary();
    if (forecast) {
      forecastContext.probability = forecast.probability;
      forecastContext.confidence = forecast.confidence;
      enhancedPrompt += `\n\n[forecast: ${forecast.question}; probability=${forecast.probability.toFixed(3)}; confidence=${forecast.confidence.toFixed(3)}]`;
      sources.push(`forecast://${forecast.id}`);
    }
    if (typeof forecastSummary.averageBrierScore === 'number') {
      forecastContext.brier = forecastSummary.averageBrierScore;
      enhancedPrompt += `\n\n[forecast calibration brier=${forecastSummary.averageBrierScore.toFixed(4)}]`;
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

    const modelResponses = await getMultiModelResponse(enhancedPrompt, routing.modelCount, {
      preferredModels: routing.preferredModels,
    });
    const modelsUsed = modelResponses.map((r) => r.model);
    const consensus = buildEnsembleConsensus({
      responses: modelResponses,
      maxMode,
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
        ? `${adaptiveDecision.reasoning} Synthesis completed in ${synthesisTime}ms. Used ${modelsUsed.length} models, ${searchResultCount} web results, ${kbHitCount} KB hits.`
        : `Synthesis completed in ${synthesisTime}ms. Used ${modelsUsed.length} models, ${searchResultCount} web results, ${kbHitCount} KB hits.`,
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
