/**
 * Multi-Model Synergy Engine — Intelligent AI model orchestration.
 * ═══════════════════════════════════════════════════════════════════
 *
 * Makes all AI models work together by routing tasks to models based
 * on their strengths, cost efficiency, and current performance.
 *
 * Model Strength Map:
 *   - Grok (xAI):      Real-time market sentiment, X/Twitter analysis, current events
 *   - OpenAI GPT-4o:   Complex reasoning, code generation, multi-step analysis
 *   - Anthropic Claude: Safety analysis, risk assessment, nuanced financial analysis
 *   - Gemini:          Multi-modal analysis, large context synthesis, speed
 *   - Groq (Llama):    Ultra-fast inference, high-throughput tasks, pre-screening
 *   - Mistral:         European market analysis, multilingual, efficient reasoning
 *   - Cerebras:        Fast inference, pattern recognition at scale
 *   - NVIDIA NIM:      Structured data analysis, quantitative tasks
 *   - OpenRouter:      Fallback routing, model diversity, A/B testing
 *   - HuggingFace:     Specialized models, embeddings, classification
 *   - Perplexity:      Real-time search-grounded answers, cited research, current data
 *   - Ollama:          Local inference, zero-cost operations, privacy-sensitive tasks
 *   - Clawd:           Custom personality, user-facing interactions
 *
 * Synergy Patterns:
 *   1. Consensus: Query 3+ models, use majority agreement for high-stakes decisions
 *   2. Cascade: Fast/cheap model screens, expensive model refines
 *   3. Specialist: Route directly to best model for task type
 *   4. Ensemble: Combine outputs weighted by model confidence
 *   5. Adversarial: Models challenge each other's conclusions
 */

'use strict';

let costTracker;
try { costTracker = require('./api-cost-tracker'); } catch { costTracker = null; }

// ─── Model Capabilities Matrix ───────────────────────────────────────────────

const MODEL_STRENGTHS = {
  grok: {
    strengths: ['real_time_sentiment', 'twitter_analysis', 'current_events', 'market_news', 'crypto_analysis'],
    weaknesses: ['code_generation', 'structured_data'],
    costTier: 'medium',
    speedTier: 'fast',
    contextWindow: 131072,
    bestFor: ['What is the current sentiment on $BTC?', 'What are people saying about...', 'Breaking news about...'],
  },
  openai: {
    strengths: ['complex_reasoning', 'code_generation', 'multi_step_analysis', 'tool_use', 'structured_output'],
    weaknesses: ['real_time_data', 'cost_efficiency'],
    costTier: 'high',
    speedTier: 'medium',
    contextWindow: 128000,
    bestFor: ['Write code to...', 'Analyze this complex scenario...', 'Build a strategy that...'],
  },
  anthropic: {
    strengths: ['safety_analysis', 'risk_assessment', 'financial_analysis', 'nuanced_reasoning', 'long_context'],
    weaknesses: ['real_time_data', 'speed'],
    costTier: 'high',
    speedTier: 'medium',
    contextWindow: 200000,
    bestFor: ['Assess the risk of...', 'Review this for safety...', 'Analyze the financial implications...'],
  },
  gemini: {
    strengths: ['multimodal', 'large_context', 'speed', 'data_synthesis', 'chart_analysis'],
    weaknesses: ['deep_reasoning', 'code_generation'],
    costTier: 'low',
    speedTier: 'fast',
    contextWindow: 1048576,
    bestFor: ['Summarize this large dataset...', 'Analyze this chart...', 'Quick overview of...'],
  },
  groq: {
    strengths: ['ultra_fast_inference', 'pre_screening', 'high_throughput', 'classification', 'quick_analysis'],
    weaknesses: ['complex_reasoning', 'long_context'],
    costTier: 'very_low',
    speedTier: 'ultra_fast',
    contextWindow: 131072,
    bestFor: ['Quick classify...', 'Is this signal valid?', 'Fast pre-screen...'],
  },
  mistral: {
    strengths: ['multilingual', 'efficient_reasoning', 'code_analysis', 'european_markets'],
    weaknesses: ['real_time_data', 'multimodal'],
    costTier: 'medium',
    speedTier: 'fast',
    contextWindow: 128000,
    bestFor: ['Analyze in multiple languages...', 'Efficient code review...'],
  },
  cerebras: {
    strengths: ['fast_inference', 'pattern_recognition', 'quantitative', 'batch_processing'],
    weaknesses: ['creative_reasoning', 'multimodal'],
    costTier: 'low',
    speedTier: 'ultra_fast',
    contextWindow: 131072,
    bestFor: ['Pattern in this data...', 'Batch classify these...'],
  },
  nvidia: {
    strengths: ['structured_data', 'quantitative_analysis', 'numerical_reasoning', 'data_extraction'],
    weaknesses: ['creative_writing', 'real_time_data'],
    costTier: 'low',
    speedTier: 'fast',
    contextWindow: 131072,
    bestFor: ['Extract structured data from...', 'Quantitative analysis of...'],
  },
  openrouter: {
    strengths: ['model_diversity', 'fallback_routing', 'ab_testing', 'model_selection'],
    weaknesses: ['latency_overhead'],
    costTier: 'medium',
    speedTier: 'medium',
    contextWindow: 128000,
    bestFor: ['Fallback for any task', 'A/B test different models'],
  },
  huggingface: {
    strengths: ['embeddings', 'classification', 'specialized_models', 'fine_tuned_tasks'],
    weaknesses: ['general_reasoning', 'conversation'],
    costTier: 'very_low',
    speedTier: 'medium',
    contextWindow: 4096,
    bestFor: ['Classify this text...', 'Generate embeddings for...'],
  },
  'ollama-local': {
    strengths: ['zero_cost', 'privacy', 'offline', 'unlimited_calls'],
    weaknesses: ['quality', 'speed', 'complex_reasoning'],
    costTier: 'free',
    speedTier: 'slow',
    contextWindow: 32768,
    bestFor: ['Non-critical analysis', 'Draft generation', 'Privacy-sensitive tasks'],
  },
  clawd: {
    strengths: ['personality', 'user_interaction', 'context_memory', 'custom_behavior'],
    weaknesses: ['raw_speed', 'quantitative'],
    costTier: 'free',
    speedTier: 'medium',
    contextWindow: 100000,
    bestFor: ['User-facing responses', 'Personality-driven interactions'],
  },
  perplexity: {
    strengths: ['real_time_search', 'cited_research', 'current_prices', 'news_synthesis', 'regulatory_updates', 'market_data', 'factual_grounding'],
    weaknesses: ['creative_writing', 'code_generation', 'latency'],
    costTier: 'medium',
    speedTier: 'medium',
    contextWindow: 127072,
    bestFor: ['What is the current price of...', 'Latest news about...', 'Research the impact of...', 'Find recent data on...'],
  },
};

// ─── Task Classification ─────────────────────────────────────────────────────

const TASK_TYPES = {
  market_sentiment:    { primary: ['grok', 'perplexity'],     fallback: ['gemini', 'groq'] },
  risk_assessment:     { primary: ['anthropic', 'openai'],    fallback: ['perplexity', 'mistral'] },
  trade_signal:        { primary: ['groq', 'cerebras'],       fallback: ['grok', 'nvidia'] },
  code_generation:     { primary: ['openai', 'anthropic'],    fallback: ['mistral', 'gemini'] },
  data_analysis:       { primary: ['nvidia', 'gemini'],       fallback: ['perplexity', 'openai'] },
  portfolio_review:    { primary: ['anthropic', 'openai'],    fallback: ['perplexity', 'gemini'] },
  news_analysis:       { primary: ['perplexity', 'grok'],     fallback: ['gemini', 'groq'] },
  quick_classification:{ primary: ['groq', 'cerebras'],       fallback: ['gemini', 'huggingface'] },
  user_interaction:    { primary: ['clawd', 'anthropic'],     fallback: ['openai', 'grok'] },
  large_context:       { primary: ['gemini', 'anthropic'],    fallback: ['perplexity', 'openai'] },
  cost_sensitive:      { primary: ['groq', 'cerebras', 'gemini'], fallback: ['ollama-local', 'huggingface'] },
  consensus_needed:    { primary: ['openai', 'anthropic', 'grok'], fallback: ['perplexity', 'gemini', 'groq'] },
  adversarial_check:   { primary: ['anthropic', 'openai'],    fallback: ['perplexity', 'grok'] },
  embedding:           { primary: ['huggingface'],             fallback: ['openai'] },
  privacy_sensitive:   { primary: ['ollama-local'],            fallback: ['clawd'] },
  deep_research:       { primary: ['perplexity', 'anthropic'], fallback: ['openai', 'grok'] },
  current_data:        { primary: ['perplexity', 'grok'],     fallback: ['gemini', 'openai'] },
  regulatory_check:    { primary: ['perplexity', 'anthropic'], fallback: ['openai', 'mistral'] },
};

// ─── Task Classification Logic ───────────────────────────────────────────────

function classifyTask(prompt) {
  const lower = prompt.toLowerCase();

  // Deep research — needs real-time cited sources
  if (/research|investigate|deep dive|comprehensive.*analysis|thorough.*review|due diligence|white paper/i.test(lower)) {
    return 'deep_research';
  }

  // Current data — needs live prices, stats, facts
  if (/current.*price|latest.*data|today.*market|right now|live.*price|real.?time|what is .* trading at/i.test(lower)) {
    return 'current_data';
  }

  // Regulatory/compliance checks
  if (/regulation|regulatory|compliance|sec |cftc|legal|law|rule|policy change|government/i.test(lower)) {
    return 'regulatory_check';
  }

  // Sentiment/news detection
  if (/sentiment|what.*people.*say|twitter|x\.com|trending|breaking.*news|market.*mood/i.test(lower)) {
    return 'market_sentiment';
  }

  // Risk/safety
  if (/risk|safe|danger|exposure|drawdown|hedge|protect|guard/i.test(lower)) {
    return 'risk_assessment';
  }

  // Trade signals
  if (/signal|entry|exit|buy|sell|long|short|trade.*now|execute/i.test(lower)) {
    return 'trade_signal';
  }

  // Code
  if (/code|function|implement|debug|fix.*bug|refactor|program/i.test(lower)) {
    return 'code_generation';
  }

  // Data/quantitative
  if (/data|analysis|statistics|correlation|regression|quantitative|number/i.test(lower)) {
    return 'data_analysis';
  }

  // Portfolio
  if (/portfolio|allocation|rebalance|position|holdings|weight/i.test(lower)) {
    return 'portfolio_review';
  }

  // Quick decisions
  if (/quick|fast|yes.*or.*no|classify|categorize|label|filter/i.test(lower)) {
    return 'quick_classification';
  }

  // Large context
  if (prompt.length > 8000) {
    return 'large_context';
  }

  // Default to cost-sensitive general task
  return 'cost_sensitive';
}

// ─── Synergy Routing ─────────────────────────────────────────────────────────

/**
 * Get the optimal model routing for a given task.
 * Returns ordered list of models to try, filtered by availability.
 */
function getOptimalRoute(prompt, availableModels = [], options = {}) {
  const taskType = options.taskType || classifyTask(prompt);
  const routing = TASK_TYPES[taskType] || TASK_TYPES.cost_sensitive;

  // Filter to available models only
  const available = new Set(availableModels.map(m => m.toLowerCase()));
  const primaryAvailable = routing.primary.filter(m => available.has(m));
  const fallbackAvailable = routing.fallback.filter(m => available.has(m));

  // Check cost throttling
  let route = [...primaryAvailable, ...fallbackAvailable];
  if (costTracker) {
    route = route.filter(m => !costTracker.shouldThrottleProvider(m));
  }

  // If budget is tight, prefer cheaper models
  if (options.budgetMode === 'conservative') {
    const costOrder = { free: 0, very_low: 1, low: 2, medium: 3, high: 4 };
    route.sort((a, b) => {
      const aCost = costOrder[MODEL_STRENGTHS[a]?.costTier || 'medium'] || 3;
      const bCost = costOrder[MODEL_STRENGTHS[b]?.costTier || 'medium'] || 3;
      return aCost - bCost;
    });
  }

  return {
    taskType,
    route: route.length > 0 ? route : [...available], // Fallback to any available
    primary: primaryAvailable,
    fallback: fallbackAvailable,
    strengths: MODEL_STRENGTHS,
  };
}

// ─── Synergy Patterns ────────────────────────────────────────────────────────

/**
 * Cascade pattern: Fast cheap model screens, expensive model refines.
 * Returns the screening model and the refining model.
 */
function getCascadeRoute(prompt, availableModels = []) {
  const available = new Set(availableModels.map(m => m.toLowerCase()));

  // Screener: fastest/cheapest available
  const screeners = ['groq', 'cerebras', 'gemini', 'ollama-local'].filter(m => available.has(m));
  // Refiner: highest quality available
  const refiners = ['anthropic', 'openai', 'grok', 'mistral'].filter(m => available.has(m));

  return {
    pattern: 'cascade',
    screener: screeners[0] || null,
    refiner: refiners[0] || null,
    description: 'Fast model pre-screens, quality model refines promising results',
  };
}

/**
 * Consensus pattern: Query 3+ models and use majority agreement.
 * Best for high-stakes decisions where accuracy > speed.
 */
function getConsensusRoute(availableModels = []) {
  const available = new Set(availableModels.map(m => m.toLowerCase()));
  // Pick 3 diverse models from different providers
  const consensusPool = ['openai', 'anthropic', 'grok', 'perplexity', 'gemini', 'mistral', 'groq']
    .filter(m => available.has(m));

  return {
    pattern: 'consensus',
    models: consensusPool.slice(0, Math.min(3, consensusPool.length)),
    requiredAgreement: 2, // At least 2 must agree
    description: 'Multiple models vote on the decision for high confidence',
  };
}

/**
 * Adversarial pattern: One model proposes, another challenges.
 * Best for risk assessment and finding blind spots.
 */
function getAdversarialRoute(availableModels = []) {
  const available = new Set(availableModels.map(m => m.toLowerCase()));
  const proposers = ['openai', 'grok', 'perplexity', 'gemini'].filter(m => available.has(m));
  const challengers = ['anthropic', 'mistral', 'groq'].filter(m => available.has(m));

  return {
    pattern: 'adversarial',
    proposer: proposers[0] || null,
    challenger: challengers[0] || null,
    description: 'One model proposes action, another stress-tests it for risks',
  };
}

// ─── Performance Tracking ────────────────────────────────────────────────────

const performanceLog = [];
const MAX_PERF_LOG = 500;

function recordModelPerformance(model, taskType, latencyMs, confidence, success) {
  performanceLog.push({
    model,
    taskType,
    latencyMs,
    confidence,
    success,
    ts: Date.now(),
  });
  if (performanceLog.length > MAX_PERF_LOG) {
    performanceLog.splice(0, performanceLog.length - MAX_PERF_LOG);
  }

  // Record cost
  if (costTracker) {
    costTracker.recordApiCall(model, 1);
  }
}

function getModelPerformanceStats() {
  const stats = {};
  const recent = performanceLog.slice(-200);

  for (const entry of recent) {
    if (!stats[entry.model]) {
      stats[entry.model] = {
        calls: 0,
        successes: 0,
        totalLatencyMs: 0,
        totalConfidence: 0,
        taskTypes: {},
      };
    }
    const s = stats[entry.model];
    s.calls += 1;
    s.successes += entry.success ? 1 : 0;
    s.totalLatencyMs += entry.latencyMs;
    s.totalConfidence += entry.confidence;

    if (!s.taskTypes[entry.taskType]) s.taskTypes[entry.taskType] = 0;
    s.taskTypes[entry.taskType] += 1;
  }

  // Calculate averages
  const result = {};
  for (const [model, s] of Object.entries(stats)) {
    result[model] = {
      calls: s.calls,
      successRate: s.calls > 0 ? Number((s.successes / s.calls).toFixed(3)) : 0,
      avgLatencyMs: s.calls > 0 ? Math.round(s.totalLatencyMs / s.calls) : 0,
      avgConfidence: s.calls > 0 ? Number((s.totalConfidence / s.calls).toFixed(3)) : 0,
      topTaskTypes: Object.entries(s.taskTypes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([type, count]) => ({ type, count })),
      strengths: MODEL_STRENGTHS[model]?.strengths || [],
      costTier: MODEL_STRENGTHS[model]?.costTier || 'unknown',
    };
  }

  return result;
}

// ─── Synergy Status ──────────────────────────────────────────────────────────

function getSynergyStatus(availableModels = []) {
  const perfStats = getModelPerformanceStats();
  const available = new Set(availableModels.map(m => m.toLowerCase()));

  // Determine which synergy patterns are available
  const consensusRoute = getConsensusRoute(availableModels);
  const adversarialRoute = getAdversarialRoute(availableModels);
  const cascadeRoute = getCascadeRoute('test', availableModels);

  // Calculate overall synergy health
  const modelCount = available.size;
  const categoryCount = new Set(
    [...available].map(m => MODEL_STRENGTHS[m]?.costTier || 'unknown')
  ).size;

  const synergyScore = Math.min(1, (modelCount / 5) * 0.4 + (categoryCount / 4) * 0.3 +
    (consensusRoute.models.length >= 3 ? 0.3 : consensusRoute.models.length >= 2 ? 0.15 : 0));

  return {
    availableModels: [...available],
    modelCount,
    synergyScore: Number(synergyScore.toFixed(3)),
    patterns: {
      consensus: {
        available: consensusRoute.models.length >= 2,
        models: consensusRoute.models,
      },
      adversarial: {
        available: !!adversarialRoute.proposer && !!adversarialRoute.challenger,
        proposer: adversarialRoute.proposer,
        challenger: adversarialRoute.challenger,
      },
      cascade: {
        available: !!cascadeRoute.screener && !!cascadeRoute.refiner,
        screener: cascadeRoute.screener,
        refiner: cascadeRoute.refiner,
      },
    },
    modelCapabilities: Object.fromEntries(
      [...available].map(m => [m, {
        strengths: MODEL_STRENGTHS[m]?.strengths || [],
        costTier: MODEL_STRENGTHS[m]?.costTier || 'unknown',
        speedTier: MODEL_STRENGTHS[m]?.speedTier || 'unknown',
      }])
    ),
    performanceStats: perfStats,
    taskRouting: Object.fromEntries(
      Object.entries(TASK_TYPES).map(([type, routing]) => [
        type,
        {
          primary: routing.primary.filter(m => available.has(m)),
          fallback: routing.fallback.filter(m => available.has(m)),
        },
      ])
    ),
  };
}

module.exports = {
  classifyTask,
  getOptimalRoute,
  getCascadeRoute,
  getConsensusRoute,
  getAdversarialRoute,
  recordModelPerformance,
  getModelPerformanceStats,
  getSynergyStatus,
  MODEL_STRENGTHS,
  TASK_TYPES,
};
