/**
 * Knowledge Synthesis Pipeline
 * Combines multiple sources (web search, RAG, models) into coherent responses
 */

import { getMultiModelResponse, initializeModels } from '../models/modelOrchestrator';
import { enhancePromptWithWebSearch } from '../search/webSearch';
import { enhancePromptWithKnowledgeBase, initializeRAG } from '../rag/vectorStore';
import { getLatestBlock, getBalance } from '../alchemy/connector';
import { initializeAdaptiveIntelligence, runAdaptiveDecisionLoop } from '@/lib/intelligence/adaptiveCortex';
import { initializeAutonomyDirector, runAutonomyDirector } from '@/lib/intelligence/autonomyDirector';

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
  initializeAdaptiveIntelligence();
  initializeAutonomyDirector();
  console.log('Knowledge synthesis engine initialized');
}

/**
 * Main synthesis function - combines all AI systems
 */
export async function synthesizeAnswer(userQuery: string): Promise<SynthesisResult> {
  const startTime = Date.now();
  const sources: string[] = [];
  let enhancedPrompt = userQuery;
  let searchResultCount = 0;
  let kbHitCount = 0;

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

    // Step 2: Enhance with knowledge base
    console.log('📚 Checking knowledge base...');
    const kbEnhancedPrompt = await enhancePromptWithKnowledgeBase(enhancedPrompt);
    const kbMatches = kbEnhancedPrompt.split('knowledge base context').length - 1;
    kbHitCount = kbMatches;
    enhancedPrompt = kbEnhancedPrompt;

    // Step 3: Get responses from multiple models
    console.log('🤖 Querying multiple AI models...');
    const modelResponses = await getMultiModelResponse(enhancedPrompt, 2);
    const modelsUsed = modelResponses.map((r) => r.model);

    const adaptiveDecision = await runAdaptiveDecisionLoop({
      userQuery,
      modelResponses,
      sources,
    });

    const selectedResponse = adaptiveDecision?.response ||
      (modelResponses.length > 0 ? modelResponses[0].response : 'Unable to generate response');

    const autonomyDecision = await runAutonomyDirector({
      userQuery,
      selectedResponse,
      modelResponses,
      sources,
      riskScore: adaptiveDecision?.riskScore ?? 0.5,
      driftScore: adaptiveDecision?.driftScore ?? 0,
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
