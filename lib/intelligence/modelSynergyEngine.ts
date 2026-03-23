/**
 * Model Synergy Engine
 *
 * Makes AI models play to each other's strengths through:
 *
 * 1. **Specialization Registry** — Each model is tagged with what it's best at
 *    (Perplexity = real-time web research, Claude = deep reasoning & analysis,
 *     Grok = market sentiment, Gemini = fast cheap triage, etc.)
 *
 * 2. **Cooperative Query Chains** — For complex queries, Chain-of-Experts:
 *    Perplexity gathers fresh data → Claude synthesizes deep reasoning →
 *    Cheaper models validate → Consensus formed
 *
 * 3. **Strength-Aware Routing** — Query intent is classified then routed to
 *    the model whose specialization matches, with fallback cascade
 *
 * 4. **Cross-Model Calibration** — One model's output is used to calibrate
 *    another's confidence, improving ensemble accuracy
 *
 * 5. **Cost-Efficient Delegation** — Cheap models handle triage/validation;
 *    expensive models called only when their specialization is needed
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const { createLogger } = require('../logger');
const log = createLogger('model-synergy');

// ── Types ──────────────────────────────────────────────────────────────────

export type ModelSpecialization =
  | 'real_time_research'     // Perplexity: web-augmented, latest data
  | 'deep_reasoning'         // Claude: nuanced analysis, long context
  | 'market_sentiment'       // Grok: X/social sentiment, market pulse
  | 'fast_triage'            // Gemini/Groq: cheap, fast classification
  | 'code_analysis'          // Claude/OpenAI: code review, strategy logic
  | 'quantitative'           // OpenAI/Mistral: math, statistics, modeling
  | 'creative_strategy'      // Claude/Grok: novel strategy ideation
  | 'risk_assessment'        // Claude/OpenAI: risk modeling, scenario analysis
  | 'general';               // Catch-all for unspecialized tasks

export type QueryIntent =
  | 'market_data'            // "What's BTC doing?" → Perplexity
  | 'trade_analysis'         // "Should I buy ETH?" → Claude + Perplexity chain
  | 'risk_evaluation'        // "What's the risk?" → Claude
  | 'strategy_design'        // "Build a DCA strategy" → Claude + validation
  | 'news_research'          // "Latest on ETF?" → Perplexity
  | 'portfolio_review'       // "How's my portfolio?" → Claude + data
  | 'quick_answer'           // "What's RSI?" → Gemini/Groq (cheap)
  | 'sentiment_check'        // "Market mood?" → Grok
  | 'code_or_config'         // Code/config questions → Claude/OpenAI
  | 'prediction_market'      // Polymarket/prediction → Perplexity + Claude
  | 'complex_multi_step';    // Multi-step → full chain-of-experts

interface ModelProfile {
  name: string;
  specializations: ModelSpecialization[];
  strengthScore: Record<ModelSpecialization, number>;  // 0-1, learned from outcomes
  costTier: 'free' | 'cheap' | 'moderate' | 'expensive';
  avgLatencyMs: number;
  contextWindow: number;
  supportsSearch: boolean;   // Perplexity = true
  chainRole: 'researcher' | 'reasoner' | 'validator' | 'generalist';
}

interface SynergyChainStep {
  role: string;
  model: string;
  prompt: string;
  response?: string;
  durationMs?: number;
  confidence?: number;
}

interface SynergyResult {
  intent: QueryIntent;
  chainSteps: SynergyChainStep[];
  finalResponse: string;
  modelsUsed: string[];
  totalCostEstimate: number;
  synergyBonus: number;         // 0-1, how much model cooperation improved quality
  routingRationale: string;
}

interface SynergyState {
  version: 1;
  modelProfiles: Record<string, Partial<ModelProfile>>;
  intentSuccessHistory: Record<QueryIntent, Record<string, { successes: number; total: number; avgReward: number }>>;
  chainPatternScores: Record<string, { uses: number; avgReward: number; avgLatencyMs: number }>;
  updatedAt: number;
}

// ── Model Specialization Registry ──────────────────────────────────────────

const DEFAULT_PROFILES: Record<string, ModelProfile> = {
  perplexity: {
    name: 'perplexity',
    specializations: ['real_time_research', 'market_sentiment'],
    strengthScore: {
      real_time_research: 0.95, deep_reasoning: 0.55, market_sentiment: 0.80,
      fast_triage: 0.60, code_analysis: 0.40, quantitative: 0.55,
      creative_strategy: 0.50, risk_assessment: 0.60, general: 0.65,
    },
    costTier: 'moderate',
    avgLatencyMs: 3500,
    contextWindow: 128000,
    supportsSearch: true,
    chainRole: 'researcher',
  },
  anthropic: {
    name: 'anthropic',
    specializations: ['deep_reasoning', 'code_analysis', 'risk_assessment', 'creative_strategy'],
    strengthScore: {
      real_time_research: 0.30, deep_reasoning: 0.95, market_sentiment: 0.60,
      fast_triage: 0.70, code_analysis: 0.92, quantitative: 0.85,
      creative_strategy: 0.90, risk_assessment: 0.92, general: 0.88,
    },
    costTier: 'expensive',
    avgLatencyMs: 4000,
    contextWindow: 200000,
    supportsSearch: false,
    chainRole: 'reasoner',
  },
  grok: {
    name: 'grok',
    specializations: ['market_sentiment', 'creative_strategy'],
    strengthScore: {
      real_time_research: 0.70, deep_reasoning: 0.72, market_sentiment: 0.90,
      fast_triage: 0.65, code_analysis: 0.60, quantitative: 0.65,
      creative_strategy: 0.78, risk_assessment: 0.65, general: 0.72,
    },
    costTier: 'moderate',
    avgLatencyMs: 2800,
    contextWindow: 131072,
    supportsSearch: false,
    chainRole: 'generalist',
  },
  openai: {
    name: 'openai',
    specializations: ['quantitative', 'code_analysis'],
    strengthScore: {
      real_time_research: 0.35, deep_reasoning: 0.80, market_sentiment: 0.55,
      fast_triage: 0.82, code_analysis: 0.85, quantitative: 0.88,
      creative_strategy: 0.75, risk_assessment: 0.80, general: 0.82,
    },
    costTier: 'cheap',
    avgLatencyMs: 2000,
    contextWindow: 128000,
    supportsSearch: false,
    chainRole: 'generalist',
  },
  gemini: {
    name: 'gemini',
    specializations: ['fast_triage', 'quantitative'],
    strengthScore: {
      real_time_research: 0.40, deep_reasoning: 0.70, market_sentiment: 0.50,
      fast_triage: 0.92, code_analysis: 0.72, quantitative: 0.78,
      creative_strategy: 0.65, risk_assessment: 0.68, general: 0.75,
    },
    costTier: 'cheap',
    avgLatencyMs: 1200,
    contextWindow: 1048576,
    supportsSearch: false,
    chainRole: 'validator',
  },
  groq: {
    name: 'groq',
    specializations: ['fast_triage'],
    strengthScore: {
      real_time_research: 0.25, deep_reasoning: 0.60, market_sentiment: 0.45,
      fast_triage: 0.95, code_analysis: 0.55, quantitative: 0.60,
      creative_strategy: 0.50, risk_assessment: 0.55, general: 0.62,
    },
    costTier: 'cheap',
    avgLatencyMs: 800,
    contextWindow: 131072,
    supportsSearch: false,
    chainRole: 'validator',
  },
  openrouter: {
    name: 'openrouter',
    specializations: ['general'],
    strengthScore: {
      real_time_research: 0.40, deep_reasoning: 0.75, market_sentiment: 0.55,
      fast_triage: 0.78, code_analysis: 0.72, quantitative: 0.72,
      creative_strategy: 0.68, risk_assessment: 0.70, general: 0.75,
    },
    costTier: 'cheap',
    avgLatencyMs: 2200,
    contextWindow: 128000,
    supportsSearch: false,
    chainRole: 'generalist',
  },
  mistral: {
    name: 'mistral',
    specializations: ['quantitative', 'code_analysis'],
    strengthScore: {
      real_time_research: 0.30, deep_reasoning: 0.72, market_sentiment: 0.50,
      fast_triage: 0.80, code_analysis: 0.78, quantitative: 0.82,
      creative_strategy: 0.65, risk_assessment: 0.70, general: 0.72,
    },
    costTier: 'moderate',
    avgLatencyMs: 2500,
    contextWindow: 128000,
    supportsSearch: false,
    chainRole: 'validator',
  },
  cerebras: {
    name: 'cerebras',
    specializations: ['fast_triage'],
    strengthScore: {
      real_time_research: 0.20, deep_reasoning: 0.58, market_sentiment: 0.40,
      fast_triage: 0.90, code_analysis: 0.52, quantitative: 0.58,
      creative_strategy: 0.45, risk_assessment: 0.50, general: 0.58,
    },
    costTier: 'cheap',
    avgLatencyMs: 600,
    contextWindow: 8192,
    supportsSearch: false,
    chainRole: 'validator',
  },
  nvidia: {
    name: 'nvidia',
    specializations: ['quantitative', 'fast_triage'],
    strengthScore: {
      real_time_research: 0.25, deep_reasoning: 0.62, market_sentiment: 0.42,
      fast_triage: 0.85, code_analysis: 0.58, quantitative: 0.72,
      creative_strategy: 0.48, risk_assessment: 0.58, general: 0.62,
    },
    costTier: 'cheap',
    avgLatencyMs: 1500,
    contextWindow: 128000,
    supportsSearch: false,
    chainRole: 'validator',
  },
};

// ── Cooperative Chain Templates ────────────────────────────────────────────
// These define how models hand off to each other for complex queries

interface ChainTemplate {
  id: string;
  intents: QueryIntent[];
  steps: Array<{
    role: string;
    preferredSpecializations: ModelSpecialization[];
    promptTemplate: (query: string, priorContext: string) => string;
    required: boolean;
  }>;
  description: string;
}

const CHAIN_TEMPLATES: ChainTemplate[] = [
  {
    id: 'research_then_reason',
    intents: ['trade_analysis', 'prediction_market', 'portfolio_review'],
    description: 'Perplexity researches → Claude reasons deeply → fast model validates',
    steps: [
      {
        role: 'researcher',
        preferredSpecializations: ['real_time_research'],
        promptTemplate: (query, _) =>
          `You are a financial research assistant. Gather the latest real-time data, news, and market context for this query. Be factual and data-heavy, include numbers, dates, and sources.\n\nQuery: ${query}`,
        required: true,
      },
      {
        role: 'reasoner',
        preferredSpecializations: ['deep_reasoning', 'risk_assessment'],
        promptTemplate: (query, prior) =>
          `You are a senior financial analyst. Using the research data below, provide deep analysis with risk assessment, probability estimates, and actionable recommendations. Consider edge cases and downside scenarios.\n\nOriginal query: ${query}\n\nResearch context:\n${prior}`,
        required: true,
      },
      {
        role: 'validator',
        preferredSpecializations: ['fast_triage'],
        promptTemplate: (query, prior) =>
          `Review the following analysis for logical errors, unsupported claims, or missed risks. Output ONLY issues found or "VALIDATED" if sound.\n\nQuery: ${query}\n\nAnalysis:\n${prior}`,
        required: false,
      },
    ],
  },
  {
    id: 'sentiment_then_analyze',
    intents: ['sentiment_check', 'market_data'],
    description: 'Grok reads sentiment → Perplexity gets data → reasoning model synthesizes',
    steps: [
      {
        role: 'sentiment_scanner',
        preferredSpecializations: ['market_sentiment'],
        promptTemplate: (query, _) =>
          `Analyze current market sentiment, social media mood, and crowd psychology for: ${query}\nInclude fear/greed indicators, trending narratives, and contrarian signals.`,
        required: true,
      },
      {
        role: 'data_gatherer',
        preferredSpecializations: ['real_time_research'],
        promptTemplate: (query, prior) =>
          `Get the latest price data, volume, and key metrics for: ${query}\n\nSentiment context: ${prior}`,
        required: false,
      },
      {
        role: 'synthesizer',
        preferredSpecializations: ['deep_reasoning'],
        promptTemplate: (query, prior) =>
          `Synthesize the sentiment and market data into a concise actionable brief. Include probability-weighted scenarios.\n\nQuery: ${query}\n\nContext:\n${prior}`,
        required: true,
      },
    ],
  },
  {
    id: 'quick_classify_then_route',
    intents: ['quick_answer'],
    description: 'Fast model handles directly, no chain needed',
    steps: [
      {
        role: 'responder',
        preferredSpecializations: ['fast_triage', 'general'],
        promptTemplate: (query, _) => query,
        required: true,
      },
    ],
  },
  {
    id: 'deep_strategy',
    intents: ['strategy_design', 'complex_multi_step'],
    description: 'Full chain: research → Claude strategy → validation → Claude refinement',
    steps: [
      {
        role: 'researcher',
        preferredSpecializations: ['real_time_research'],
        promptTemplate: (query, _) =>
          `Gather comprehensive market data, historical analogues, and current conditions relevant to: ${query}`,
        required: true,
      },
      {
        role: 'strategist',
        preferredSpecializations: ['deep_reasoning', 'creative_strategy'],
        promptTemplate: (query, prior) =>
          `Design a detailed strategy with specific entry/exit criteria, position sizing, risk parameters, and expected outcomes. Use the research data below.\n\nQuery: ${query}\n\nResearch:\n${prior}`,
        required: true,
      },
      {
        role: 'risk_checker',
        preferredSpecializations: ['risk_assessment'],
        promptTemplate: (query, prior) =>
          `Stress-test this strategy: identify failure modes, black swan risks, correlation breakdowns, and worst-case drawdown scenarios.\n\nStrategy:\n${prior}`,
        required: true,
      },
      {
        role: 'refiner',
        preferredSpecializations: ['deep_reasoning'],
        promptTemplate: (query, prior) =>
          `Refine the strategy incorporating the risk assessment. Output the final strategy with built-in safeguards.\n\nOriginal query: ${query}\n\nStrategy + Risk Review:\n${prior}`,
        required: true,
      },
    ],
  },
  {
    id: 'risk_deep_dive',
    intents: ['risk_evaluation'],
    description: 'Claude analyzes risk, Perplexity checks current conditions',
    steps: [
      {
        role: 'condition_checker',
        preferredSpecializations: ['real_time_research'],
        promptTemplate: (query, _) =>
          `What are the current market conditions, volatility levels, and risk events relevant to: ${query}`,
        required: true,
      },
      {
        role: 'risk_analyst',
        preferredSpecializations: ['risk_assessment', 'deep_reasoning'],
        promptTemplate: (query, prior) =>
          `Provide a comprehensive risk analysis including VaR estimates, scenario probabilities, and recommended hedges.\n\nQuery: ${query}\n\nCurrent conditions:\n${prior}`,
        required: true,
      },
    ],
  },
  {
    id: 'news_research',
    intents: ['news_research'],
    description: 'Perplexity leads with real-time news, reasoner adds interpretation',
    steps: [
      {
        role: 'news_gatherer',
        preferredSpecializations: ['real_time_research'],
        promptTemplate: (query, _) =>
          `Find the latest breaking news, analyst opinions, and regulatory developments for: ${query}\nInclude dates, sources, and quotes.`,
        required: true,
      },
      {
        role: 'interpreter',
        preferredSpecializations: ['deep_reasoning'],
        promptTemplate: (query, prior) =>
          `Interpret the market implications of this news. What are the first, second, and third-order effects?\n\nQuery: ${query}\n\nNews:\n${prior}`,
        required: false,
      },
    ],
  },
];

// ── State persistence ──────────────────────────────────────────────────────

const DATA_DIR = process.env.RAILWAY_ENVIRONMENT
  ? (process.env.PERSISTENT_STORAGE_PATH || '/tmp/freedomforge-data')
  : resolve(process.cwd(), 'data');

const STATE_FILE = resolve(DATA_DIR, 'model-synergy-state.json');

let state: SynergyState | null = null;

function loadState(): SynergyState {
  if (state) return state;
  try {
    const raw = readFileSync(STATE_FILE, 'utf-8');
    state = JSON.parse(raw) as SynergyState;
  } catch {
    state = {
      version: 1,
      modelProfiles: {},
      intentSuccessHistory: {} as any,
      chainPatternScores: {},
      updatedAt: Date.now(),
    };
  }
  return state;
}

function saveState(): void {
  if (!state) return;
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    log.error('Failed to save state:', err);
  }
}

// ── Intent Classification ──────────────────────────────────────────────────

const INTENT_PATTERNS: Array<{ intent: QueryIntent; patterns: RegExp[] }> = [
  {
    intent: 'market_data',
    patterns: [
      /\b(price|chart|volume|ticker|btc|eth|sol|market\s*cap|candle|ohlc)\b/i,
      /\b(what('s| is))\s+(trading|doing|at)\b/i,
    ],
  },
  {
    intent: 'trade_analysis',
    patterns: [
      /\b(should\s+i\s+(buy|sell|trade)|entry|exit|position|long|short)\b/i,
      /\b(trade|buy|sell|swap|allocat|dca)\b.*\b(signal|setup|idea|recommendation)\b/i,
    ],
  },
  {
    intent: 'risk_evaluation',
    patterns: [
      /\b(risk|drawdown|var|hedge|exposure|liquidat|stop.?loss|margin)\b/i,
      /\b(how\s+(safe|dangerous|risky))\b/i,
    ],
  },
  {
    intent: 'strategy_design',
    patterns: [
      /\b(strategy|plan|system|backtest|optimi|algorithm|automat)\b/i,
      /\b(build|design|create|develop)\s+.*(strategy|plan|system)\b/i,
    ],
  },
  {
    intent: 'news_research',
    patterns: [
      /\b(news|headlines|announcement|regulation|sec|etf|approval|lawsuit)\b/i,
      /\b(what('s| is)\s+(happening|new|latest))\b/i,
    ],
  },
  {
    intent: 'portfolio_review',
    patterns: [
      /\b(portfolio|holdings|allocation|rebalanc|diversif|performance)\b/i,
      /\b(how('s| is)\s+my)\b/i,
    ],
  },
  {
    intent: 'sentiment_check',
    patterns: [
      /\b(sentiment|mood|fear|greed|crowd|social|vibes|feeling)\b/i,
      /\b(what.*(think|feel|saying))\b/i,
    ],
  },
  {
    intent: 'prediction_market',
    patterns: [
      /\b(polymarket|prediction\s*market|betting|odds|probability)\b/i,
      /\b(predict|forecast|probability|likelihood)\b/i,
    ],
  },
  {
    intent: 'code_or_config',
    patterns: [
      /\b(code|config|script|api|endpoint|deploy|bug|error|function)\b/i,
    ],
  },
  {
    intent: 'quick_answer',
    patterns: [
      /^(what('s| is)|define|explain|how\s+does)\s+\w+(\s+\w+){0,4}\??$/i,
    ],
  },
];

export function classifyQueryIntent(query: string): QueryIntent {
  const q = query.trim();
  const wordCount = q.split(/\s+/).length;

  // Ultra-short queries are quick answers
  if (wordCount <= 4 && !/\b(should|buy|sell|trade|risk|portfolio)\b/i.test(q)) {
    return 'quick_answer';
  }

  // Multi-clause or very long queries are complex
  if (wordCount > 50 || (q.includes(' and ') && q.includes(' then '))) {
    return 'complex_multi_step';
  }

  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((p) => p.test(q))) {
      return intent;
    }
  }

  return 'quick_answer';
}

// ── Model Selection by Specialization ──────────────────────────────────────

function getProfileFor(model: string): ModelProfile {
  const key = model.toLowerCase();
  const s = loadState();
  const learned = s.modelProfiles[key] || {};
  const base = DEFAULT_PROFILES[key] || DEFAULT_PROFILES['openrouter']; // fallback

  // Merge learned strength adjustments over defaults
  const mergedStrengths = { ...base.strengthScore };
  if (learned.strengthScore) {
    for (const [spec, val] of Object.entries(learned.strengthScore)) {
      if (typeof val === 'number') {
        mergedStrengths[spec as ModelSpecialization] = val;
      }
    }
  }

  return {
    ...base,
    ...learned,
    name: key,
    strengthScore: mergedStrengths,
  } as ModelProfile;
}

export function selectBestModelForSpecialization(
  specialization: ModelSpecialization,
  availableModels: string[],
  budgetTier?: 'cheap' | 'moderate' | 'expensive' | 'any'
): string | null {
  const tier = budgetTier || 'any';
  const costOrder = { free: 0, cheap: 1, moderate: 2, expensive: 3 };

  const candidates = availableModels
    .map((m) => ({ name: m, profile: getProfileFor(m) }))
    .filter((c) => {
      if (tier === 'any') return true;
      return costOrder[c.profile.costTier] <= costOrder[tier];
    })
    .sort((a, b) => {
      const aScore = a.profile.strengthScore[specialization] || 0;
      const bScore = b.profile.strengthScore[specialization] || 0;
      return bScore - aScore;
    });

  return candidates[0]?.name || null;
}

// ── Chain of Experts Execution ─────────────────────────────────────────────

function selectChainTemplate(intent: QueryIntent): ChainTemplate {
  const match = CHAIN_TEMPLATES.find((t) => t.intents.includes(intent));
  return match || CHAIN_TEMPLATES.find((t) => t.id === 'quick_classify_then_route')!;
}

/**
 * Build a synergy execution plan — maps chain template steps to actual models.
 * Does NOT execute queries; returns a plan the synthesis orchestrator can execute.
 */
export function buildSynergyPlan(
  query: string,
  availableModels: string[],
  options?: {
    budgetCap?: 'cheap' | 'moderate' | 'expensive' | 'any';
    maxSteps?: number;
    forceIntent?: QueryIntent;
  }
): {
  intent: QueryIntent;
  chain: ChainTemplate;
  assignments: Array<{
    stepIndex: number;
    role: string;
    model: string;
    specialization: ModelSpecialization;
    required: boolean;
    promptBuilder: (priorContext: string) => string;
  }>;
  estimatedModels: number;
  estimatedCostTier: string;
  rationale: string;
} {
  const intent = options?.forceIntent || classifyQueryIntent(query);
  const chain = selectChainTemplate(intent);
  const maxSteps = options?.maxSteps || chain.steps.length;
  const budgetCap = options?.budgetCap || 'any';

  const assignments = chain.steps.slice(0, maxSteps).map((step, idx) => {
    // Find best available model for this step's preferred specialization
    let selectedModel: string | null = null;
    let selectedSpec: ModelSpecialization = 'general';

    for (const spec of step.preferredSpecializations) {
      selectedModel = selectBestModelForSpecialization(spec, availableModels, budgetCap);
      if (selectedModel) {
        selectedSpec = spec;
        break;
      }
    }

    // Fallback to any available
    if (!selectedModel) {
      selectedModel = availableModels[0] || 'openrouter';
      selectedSpec = 'general';
    }

    return {
      stepIndex: idx,
      role: step.role,
      model: selectedModel,
      specialization: selectedSpec,
      required: step.required,
      promptBuilder: (priorContext: string) => step.promptTemplate(query, priorContext),
    };
  });

  const uniqueModels = new Set(assignments.map((a) => a.model));

  return {
    intent,
    chain,
    assignments,
    estimatedModels: uniqueModels.size,
    estimatedCostTier: budgetCap,
    rationale: `intent=${intent} chain=${chain.id} steps=${assignments.length} models=[${[...uniqueModels].join(',')}]`,
  };
}

// ── Strength Learning (Reinforcement) ──────────────────────────────────────

const LEARNING_RATE = 0.12;

/**
 * After a synergy chain completes, record which models performed well
 * so future routing improves.
 */
export function recordSynergyOutcome(input: {
  intent: QueryIntent;
  chainId: string;
  steps: Array<{
    model: string;
    specialization: ModelSpecialization;
    reward: number;       // 0-1, how good was this step's output
    latencyMs: number;
  }>;
  overallReward: number;  // 0-1, final chain quality
}): void {
  const s = loadState();

  // Update per-intent model success history
  if (!s.intentSuccessHistory[input.intent]) {
    s.intentSuccessHistory[input.intent] = {};
  }

  for (const step of input.steps) {
    const key = step.model.toLowerCase();

    // Update intent success history
    const hist = s.intentSuccessHistory[input.intent];
    if (!hist[key]) {
      hist[key] = { successes: 0, total: 0, avgReward: 0.5 };
    }
    hist[key].total += 1;
    if (step.reward >= 0.6) hist[key].successes += 1;
    hist[key].avgReward += LEARNING_RATE * (step.reward - hist[key].avgReward);

    // Update model strength scores
    if (!s.modelProfiles[key]) {
      s.modelProfiles[key] = {};
    }
    if (!s.modelProfiles[key].strengthScore) {
      s.modelProfiles[key].strengthScore = {} as any;
    }
    const current = s.modelProfiles[key].strengthScore![step.specialization] ??
      (DEFAULT_PROFILES[key]?.strengthScore[step.specialization] ?? 0.5);
    s.modelProfiles[key].strengthScore![step.specialization] =
      Number((current + LEARNING_RATE * (step.reward - current)).toFixed(4));

    // Update avg latency
    const baseLatency = DEFAULT_PROFILES[key]?.avgLatencyMs ?? 3000;
    const currentLatency = s.modelProfiles[key].avgLatencyMs ?? baseLatency;
    s.modelProfiles[key].avgLatencyMs = Math.round(
      currentLatency + 0.1 * (step.latencyMs - currentLatency)
    );
  }

  // Update chain pattern scores
  const chainKey = `${input.chainId}:${input.steps.map((s) => s.model).join('+')}`;
  if (!s.chainPatternScores[chainKey]) {
    s.chainPatternScores[chainKey] = { uses: 0, avgReward: 0.5, avgLatencyMs: 3000 };
  }
  const cp = s.chainPatternScores[chainKey];
  cp.uses += 1;
  cp.avgReward += LEARNING_RATE * (input.overallReward - cp.avgReward);
  const totalLatency = input.steps.reduce((sum, step) => sum + step.latencyMs, 0);
  cp.avgLatencyMs = Math.round(cp.avgLatencyMs + 0.1 * (totalLatency - cp.avgLatencyMs));

  s.updatedAt = Date.now();
  saveState();
}

// ── Cross-Model Calibration ────────────────────────────────────────────────

/**
 * Use one model's response to calibrate another's confidence.
 * E.g., if Perplexity's factual data contradicts Claude's analysis,
 * lower the confidence of the analysis.
 */
export function crossCalibrate(responses: Array<{
  model: string;
  response: string;
  confidence: number;
  specialization: ModelSpecialization;
}>): Array<{
  model: string;
  response: string;
  originalConfidence: number;
  calibratedConfidence: number;
  calibrationDelta: number;
}> {
  if (responses.length <= 1) {
    return responses.map((r) => ({
      ...r,
      originalConfidence: r.confidence,
      calibratedConfidence: r.confidence,
      calibrationDelta: 0,
    }));
  }

  // Build token sets for similarity comparison
  const tokenSets = responses.map((r) => {
    const tokens = new Set(
      r.response.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 2)
    );
    return tokens;
  });

  return responses.map((r, idx) => {
    let agreementBoost = 0;
    let contradictionPenalty = 0;
    let comparisons = 0;

    for (let j = 0; j < responses.length; j++) {
      if (j === idx) continue;
      const other = responses[j];

      // Jaccard similarity
      const union = new Set([...tokenSets[idx], ...tokenSets[j]]);
      let intersection = 0;
      tokenSets[idx].forEach((t) => { if (tokenSets[j].has(t)) intersection++; });
      const similarity = union.size > 0 ? intersection / union.size : 0;

      // Weight by the other model's specialization strength
      const otherProfile = getProfileFor(other.model);
      const otherStrength = otherProfile.strengthScore[other.specialization] || 0.5;

      if (similarity > 0.3) {
        agreementBoost += similarity * otherStrength * 0.15;
      } else if (similarity < 0.1) {
        contradictionPenalty += (1 - similarity) * otherStrength * 0.08;
      }
      comparisons++;
    }

    if (comparisons > 0) {
      agreementBoost /= comparisons;
      contradictionPenalty /= comparisons;
    }

    const delta = agreementBoost - contradictionPenalty;
    const calibrated = Math.max(0.05, Math.min(0.98, r.confidence + delta));

    return {
      model: r.model,
      response: r.response,
      originalConfidence: r.confidence,
      calibratedConfidence: Number(calibrated.toFixed(4)),
      calibrationDelta: Number(delta.toFixed(4)),
    };
  });
}

// ── Dashboard / Diagnostics ────────────────────────────────────────────────

export function getSynergyDashboard(): {
  modelStrengths: Array<{ model: string; topSpecializations: Array<{ spec: ModelSpecialization; score: number }>; chainRole: string }>;
  bestChainPatterns: Array<{ pattern: string; uses: number; avgReward: number }>;
  intentRouting: Record<string, string>;
  updatedAt: number;
} {
  const s = loadState();

  const allModels = Object.keys(DEFAULT_PROFILES);
  const modelStrengths = allModels.map((m) => {
    const profile = getProfileFor(m);
    const sorted = Object.entries(profile.strengthScore)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([spec, score]) => ({ spec: spec as ModelSpecialization, score: Number(score.toFixed(3)) }));
    return {
      model: m,
      topSpecializations: sorted,
      chainRole: profile.chainRole,
    };
  });

  const bestChainPatterns = Object.entries(s.chainPatternScores)
    .sort(([, a], [, b]) => b.avgReward - a.avgReward)
    .slice(0, 10)
    .map(([pattern, data]) => ({ pattern, ...data, avgReward: Number(data.avgReward.toFixed(4)) }));

  // Show which model would be selected for each intent
  const intentRouting: Record<string, string> = {};
  for (const { intent } of INTENT_PATTERNS) {
    const template = selectChainTemplate(intent);
    if (template.steps.length > 0) {
      const primary = template.steps[0].preferredSpecializations[0];
      const best = selectBestModelForSpecialization(primary, allModels);
      intentRouting[intent] = `${template.id} → ${best || 'none'} (${primary})`;
    }
  }

  return {
    modelStrengths,
    bestChainPatterns,
    intentRouting,
    updatedAt: s.updatedAt,
  };
}

export function initializeModelSynergy(): void {
  loadState();
  log.info('Initialized with', Object.keys(DEFAULT_PROFILES).length, 'model profiles');
}
