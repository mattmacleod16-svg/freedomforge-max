/**
 * Multi-Model AI Orchestrator
 * Routes queries to best-suited AI model for optimal responses
 */

interface ModelConfig {
  name: string;
  apiKey: string;
  type: 'grok' | 'openai' | 'anthropic' | 'local' | 'huggingface' | 'openai-compatible' | 'gemini' | 'clawd' | 'perplexity';
  endpoint?: string;
  model?: string;
  extraHeaders?: Record<string, string>;
  priority: number;
}

interface ModelResponse {
  model: string;
  response: string;
  confidence: number;
  timestamp: number;
}

const models: ModelConfig[] = [];
let initialized = false;
let lastInitializedAt = 0;
const MODEL_REFRESH_MS = Math.max(5000, Number(process.env.MODEL_REFRESH_MS || '15000'));

function firstEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return '';
}

function upsertModel(config: ModelConfig) {
  const index = models.findIndex((item) => item.name.toLowerCase() === config.name.toLowerCase());
  if (index >= 0) {
    models[index] = config;
    return;
  }
  models.push(config);
}

function asBool(value: string | undefined) {
  return String(value || 'false').toLowerCase() === 'true';
}

export async function initializeModels() {
  initialized = true;
  lastInitializedAt = Date.now();
  models.length = 0;

  // Grok (primary - Grok API)
  const grokKey = firstEnv('GROK_API_KEY');
  if (grokKey) {
    upsertModel({
      name: 'grok',
      apiKey: grokKey,
      type: 'grok',
      endpoint: firstEnv('GROK_ENDPOINT') || 'https://api.x.ai/v1/chat/completions',
      model: firstEnv('GROK_MODEL') || 'grok-beta',
      priority: 1,
    });
  }

  // OpenAI (fallback)
  const openAiKey = firstEnv('OPENAI_API_KEY');
  if (openAiKey) {
    upsertModel({
      name: 'openai',
      apiKey: openAiKey,
      type: 'openai',
      endpoint: firstEnv('OPENAI_ENDPOINT') || 'https://api.openai.com/v1/chat/completions',
      model: firstEnv('OPENAI_MODEL') || 'gpt-4o-mini',
      priority: 2,
    });
  }

  // Anthropic Claude (fallback)
  const anthropicKey = firstEnv('ANTHROPIC_API_KEY', 'CLAUDE_API_KEY');
  if (anthropicKey) {
    upsertModel({
      name: 'anthropic',
      apiKey: anthropicKey,
      type: 'anthropic',
      endpoint: firstEnv('ANTHROPIC_ENDPOINT') || 'https://api.anthropic.com/v1/messages',
      model: firstEnv('ANTHROPIC_MODEL') || 'claude-3-5-sonnet-latest',
      priority: 3,
    });
  }

  // Perplexity — search-grounded AI with real-time web knowledge
  const perplexityKey = firstEnv('PERPLEXITY_API_KEY', 'PPLX_API_KEY');
  if (perplexityKey) {
    upsertModel({
      name: 'perplexity',
      apiKey: perplexityKey,
      type: 'perplexity',
      endpoint: firstEnv('PERPLEXITY_ENDPOINT') || 'https://api.perplexity.ai/chat/completions',
      model: firstEnv('PERPLEXITY_MODEL') || 'sonar-pro',
      priority: 4,
    });
  }

  const openRouterKey = firstEnv('OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY');
  if (openRouterKey) {
    upsertModel({
      name: 'openrouter',
      apiKey: openRouterKey,
      type: 'openai-compatible',
      endpoint: firstEnv('OPENROUTER_ENDPOINT') || 'https://openrouter.ai/api/v1/chat/completions',
      model: firstEnv('OPENROUTER_MODEL') || 'openai/gpt-4o-mini',
      extraHeaders: {
        'HTTP-Referer': firstEnv('APP_BASE_URL') || 'https://freedomforge-max.vercel.app',
        'X-Title': 'FreedomForge Max',
      },
      priority: 5,
    });
  }

  const groqKey = firstEnv('GROQ_API_KEY', 'GROC_API_KEY');
  if (groqKey) {
    upsertModel({
      name: 'groq',
      apiKey: groqKey,
      type: 'openai-compatible',
      endpoint: firstEnv('GROQ_ENDPOINT', 'GROC_ENDPOINT') || 'https://api.groq.com/openai/v1/chat/completions',
      model: firstEnv('GROQ_MODEL', 'GROC_MODEL') || 'llama-3.3-70b-versatile',
      priority: 6,
    });
  }

  const geminiKey = firstEnv('GEMINI_API_KEY', 'GOOGLE_GEMINI_API_KEY');
  if (geminiKey) {
    upsertModel({
      name: 'gemini',
      apiKey: geminiKey,
      type: 'gemini',
      endpoint: firstEnv('GEMINI_ENDPOINT') || 'https://generativelanguage.googleapis.com/v1beta/models',
      model: firstEnv('GEMINI_MODEL') || 'gemini-2.0-flash',
      priority: 7,
    });
  }

  const mistralKey = firstEnv('MISTRAL_API_KEY', 'MISTRALAI_API_KEY');
  if (mistralKey) {
    upsertModel({
      name: 'mistral',
      apiKey: mistralKey,
      type: 'openai-compatible',
      endpoint: firstEnv('MISTRAL_ENDPOINT') || 'https://api.mistral.ai/v1/chat/completions',
      model: firstEnv('MISTRAL_MODEL', 'MISTRALAI_MODEL') || 'mistral-large-latest',
      priority: 8,
    });
  }

  const cerebrasKey = firstEnv('CEREBRAS_API_KEY');
  if (cerebrasKey) {
    upsertModel({
      name: 'cerebras',
      apiKey: cerebrasKey,
      type: 'openai-compatible',
      endpoint: firstEnv('CEREBRAS_ENDPOINT') || 'https://api.cerebras.ai/v1/chat/completions',
      model: firstEnv('CEREBRAS_MODEL') || 'llama-3.3-70b',
      priority: 9,
    });
  }

  const nvidiaKey = firstEnv('NVIDIA_API_KEY', 'NIM_API_KEY');
  if (nvidiaKey) {
    upsertModel({
      name: 'nvidia',
      apiKey: nvidiaKey,
      type: 'openai-compatible',
      endpoint: firstEnv('NVIDIA_ENDPOINT', 'NIM_ENDPOINT') || 'https://integrate.api.nvidia.com/v1/chat/completions',
      model: firstEnv('NVIDIA_MODEL', 'NIM_MODEL') || 'meta/llama-3.1-70b-instruct',
      priority: 10,
    });
  }

  const llamaKey = firstEnv('LLAMA_API_KEY');
  const llamaEndpoint = firstEnv('LLAMA_ENDPOINT');
  if (llamaKey && llamaEndpoint) {
    upsertModel({
      name: 'llama',
      apiKey: llamaKey,
      type: 'openai-compatible',
      endpoint: llamaEndpoint,
      model: firstEnv('LLAMA_MODEL') || 'llama-3.1-70b-instruct',
      priority: 11,
    });
  }

  // Local Ollama for fallback (no API key needed)
  const ollamaEndpoint = firstEnv('OLLAMA_ENDPOINT', 'OLLAMA_BASE_URL');
  if (ollamaEndpoint) {
    upsertModel({
      name: 'ollama-local',
      apiKey: '',
      type: 'local',
      endpoint: ollamaEndpoint,
      model: firstEnv('OLLAMA_MODEL') || 'mistral',
      priority: 12,
    });
  }

  // Hugging Face for lightweight inference
  const huggingFaceKey = firstEnv('HUGGINGFACE_API_KEY');
  if (huggingFaceKey) {
    upsertModel({
      name: 'huggingface',
      apiKey: huggingFaceKey,
      type: 'huggingface',
      endpoint: firstEnv('HUGGINGFACE_ENDPOINT') || 'https://api-inference.huggingface.co/models/',
      model: firstEnv('HUGGINGFACE_MODEL') || 'mistralai/Mistral-7B-Instruct-v0.2',
      priority: 14,
    });
  }

  if (asBool(process.env.CLAWD_ENABLED)) {
    const endpoint = firstEnv('CLAWD_ENDPOINT') || (firstEnv('APP_BASE_URL') ? `${firstEnv('APP_BASE_URL')}/api/clawd` : '');
    if (endpoint) {
      upsertModel({
        name: 'clawd',
        apiKey: firstEnv('CLAWD_API_SECRET'),
        type: 'clawd',
        endpoint,
        priority: 15,
      });
    }
  }
}

function ensureModelsInitialized() {
  if (!initialized || models.length === 0 || (Date.now() - lastInitializedAt) > MODEL_REFRESH_MS) {
    void initializeModels();
  }
}

function normalizeResponseText(text: string) {
  return (text || '').trim();
}

function isWeakResponse(text: string) {
  const value = normalizeResponseText(text).toLowerCase();
  if (!value) return true;
  if (value === 'no response') return true;
  if (value.startsWith('error:')) return true;
  if (value.includes('invalid api key')) return true;
  if (value.includes('insufficient_quota')) return true;
  if (value.includes('rate limit')) return true;
  if (value.length < 24) return true;
  return false;
}

function scoreResponseConfidence(text: string) {
  const value = normalizeResponseText(text);
  if (isWeakResponse(value)) return 0;

  const lengthScore = Math.min(1, value.length / 900);
  const structureBonus = /\n|\.|;|:/.test(value) ? 0.08 : 0;
  const uncertaintyPenalty = /(not sure|unsure|cannot determine|insufficient data)/i.test(value) ? 0.12 : 0;
  const score = 0.52 + (lengthScore * 0.32) + structureBonus - uncertaintyPenalty;
  return Math.max(0, Math.min(0.98, Number(score.toFixed(4))));
}

async function queryGrok(prompt: string, config: ModelConfig): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(config.endpoint || 'https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || 'grok-beta',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1000,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return 'No response';
    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'No response';
  } finally {
    clearTimeout(timer);
  }
}

async function queryOpenAICompatible(prompt: string, config: ModelConfig): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(config.endpoint || '', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        ...(config.extraHeaders || {}),
      },
      body: JSON.stringify({
        model: config.model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.6,
        max_tokens: 1000,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return 'No response';
    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'No response';
  } finally {
    clearTimeout(timer);
  }
}

async function queryOpenAI(prompt: string, config: ModelConfig): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(config.endpoint || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1000,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return 'No response';
    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'No response';
  } finally {
    clearTimeout(timer);
  }
}

async function queryGemini(prompt: string, config: ModelConfig): Promise<string> {
  const model = config.model || 'gemini-2.0-flash';
  const endpointBase = config.endpoint || 'https://generativelanguage.googleapis.com/v1beta/models';
  // C1 FIX: Use header auth instead of query string to prevent key leaking in logs
  const endpoint = `${endpointBase}/${model}:generateContent`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey || '',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 1000,
        },
      }),
      signal: controller.signal,
    });

    // H5 FIX: Check response status before parsing
    if (!response.ok) return 'No response';
    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.map((item: { text?: string }) => item?.text || '').join('\n').trim();
    return text || 'No response';
  } finally {
    clearTimeout(timer);
  }
}

async function queryOllamaWithConfig(prompt: string, config: ModelConfig): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(config.endpoint || 'http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model || 'mistral',
        prompt,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return 'No response';
    const data = await response.json();
    return data.response || 'No response';
  } finally {
    clearTimeout(timer);
  }
}

async function queryHuggingFace(prompt: string, config: ModelConfig): Promise<string> {
  const model = config.model || 'mistralai/Mistral-7B-Instruct-v0.2';
  const endpointBase = config.endpoint || 'https://api-inference.huggingface.co/models/';
  const endpoint = endpointBase.endsWith('/') ? `${endpointBase}${model}` : endpointBase;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: 700,
          temperature: 0.6,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) return 'No response';
    const data = await response.json();
    if (Array.isArray(data) && typeof data[0]?.generated_text === 'string') {
      return data[0].generated_text;
    }
    return 'No response';
  } finally {
    clearTimeout(timer);
  }
}

async function queryClawd(prompt: string, config: ModelConfig): Promise<string> {
  if (!config.endpoint) {
    return 'No response';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { 'x-clawd-secret': config.apiKey } : {}),
      },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });

    if (!response.ok) return 'No response';
    const data = await response.json();
    return data.response || 'No response';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Perplexity model variants and their optimal configurations:
 *   sonar              — Lightweight search, fast, cheap ($1/$1 per M tokens)
 *   sonar-pro          — Advanced search, complex queries, 2x citations ($3/$15 per M)
 *   sonar-reasoning-pro — Chain-of-thought reasoning with search ($3/$15 per M)
 *   sonar-deep-research — Multi-step autonomous research ($2/$8 per M + search fees)
 */
const PERPLEXITY_MODEL_CONFIGS: Record<string, { timeout: number; maxTokens: number; temperature: number; costKey: string }> = {
  'sonar':                { timeout: 30_000, maxTokens: 1000, temperature: 0.2, costKey: 'perplexity' },
  'sonar-pro':            { timeout: 45_000, maxTokens: 1500, temperature: 0.2, costKey: 'perplexity_sonar_pro' },
  'sonar-reasoning-pro':  { timeout: 60_000, maxTokens: 2000, temperature: 0.1, costKey: 'perplexity_reasoning' },
  'sonar-deep-research':  { timeout: 120_000, maxTokens: 4000, temperature: 0.1, costKey: 'perplexity_deep_research' },
};

async function queryPerplexity(prompt: string, config: ModelConfig): Promise<string> {
  const modelId = config.model || 'sonar-pro';
  const modelCfg = PERPLEXITY_MODEL_CONFIGS[modelId] || PERPLEXITY_MODEL_CONFIGS['sonar-pro'];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), modelCfg.timeout);
  try {
    const body: Record<string, any> = {
      model: modelId,
      messages: [
        {
          role: 'system',
          content: 'You are a financial research assistant for FreedomForge Max, an autonomous trading system. Provide precise, data-rich answers with current market data, prices, and actionable intelligence. Always cite sources.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: modelCfg.temperature,
      max_tokens: modelCfg.maxTokens,
      return_citations: true,
    };

    // Only add search_recency_filter for search models (not deep-research)
    if (!modelId.includes('deep-research')) {
      body.search_recency_filter = 'day';
    }

    const response = await fetch(config.endpoint || 'https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) return 'No response';
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    // Track cost with model-specific pricing
    try {
      const costTracker = require('../funding/api-cost-tracker');
      const tokensApprox = Math.ceil((prompt.length + (text?.length || 0)) / 4);
      costTracker.recordApiCall(modelCfg.costKey, tokensApprox / 1000, { model: modelId });
    } catch { /* funding not available */ }

    // Append citation sources if available
    const citations = data.citations || [];
    if (citations.length > 0 && text) {
      const sourceList = citations.slice(0, 5).map((c: string, i: number) => `[${i + 1}] ${c}`).join('\n');
      return `${text}\n\nSources:\n${sourceList}`;
    }

    return text || 'No response';
  } finally {
    clearTimeout(timer);
  }
}

async function queryAnthropic(prompt: string, config: ModelConfig): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(config.endpoint || 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model || 'claude-3-5-sonnet-latest',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) return 'No response';
    const data = await response.json();
    return data.content?.[0]?.text || 'No response';
  } finally {
    clearTimeout(timer);
  }
}

export async function getMultiModelResponse(
  prompt: string,
  count: number = 2,
  options?: {
    preferredModels?: string[];
    taskType?: string;
    budgetMode?: 'aggressive' | 'balanced' | 'conservative';
  }
): Promise<ModelResponse[]> {
  if (!initialized || models.length === 0 || (Date.now() - lastInitializedAt) > MODEL_REFRESH_MS) {
    await initializeModels();
  }
  ensureModelsInitialized();
  if (models.length === 0) {
    throw new Error('No AI models configured');
  }

  // Synergy-aware routing: use model-synergy-engine if available
  let synergyRoute: string[] | null = null;
  try {
    const synergyEngine = require('../funding/model-synergy-engine');
    const availableNames = models.map((m) => m.name);
    const routing = synergyEngine.getOptimalRoute(prompt, availableNames, {
      taskType: options?.taskType,
      budgetMode: options?.budgetMode,
    });
    if (routing.route.length > 0) {
      synergyRoute = routing.route;
    }
  } catch { /* synergy engine not available, use default routing */ }

  const preferred = synergyRoute || (options?.preferredModels || []).map((item) => item.toLowerCase());
  const sortedModels = [...models].sort((a, b) => {
    const aPref = preferred.indexOf(a.name.toLowerCase());
    const bPref = preferred.indexOf(b.name.toLowerCase());

    if (aPref !== -1 && bPref !== -1) return aPref - bPref;
    if (aPref !== -1) return -1;
    if (bPref !== -1) return 1;
    return a.priority - b.priority;
  });
  const selectedModels = sortedModels.slice(0, Math.min(count, models.length));

  const responses: ModelResponse[] = await Promise.all(
    selectedModels.map(async (model) => {
      try {
        let response = '';

        if (model.type === 'grok') {
          response = await queryGrok(prompt, model);
        } else if (model.type === 'openai') {
          response = await queryOpenAI(prompt, model);
        } else if (model.type === 'anthropic') {
          response = await queryAnthropic(prompt, model);
        } else if (model.type === 'perplexity') {
          response = await queryPerplexity(prompt, model);
        } else if (model.type === 'openai-compatible') {
          response = await queryOpenAICompatible(prompt, model);
        } else if (model.type === 'gemini') {
          response = await queryGemini(prompt, model);
        } else if (model.type === 'local') {
          response = await queryOllamaWithConfig(prompt, model);
        } else if (model.type === 'huggingface') {
          response = await queryHuggingFace(prompt, model);
        } else if (model.type === 'clawd') {
          response = await queryClawd(prompt, model);
        }

        const normalizedResponse = normalizeResponseText(response);
        const confidence = scoreResponseConfidence(response);

        // Track cost and performance via funding system
        try {
          const costTracker = require('../funding/api-cost-tracker');
          const synergyEngine = require('../funding/model-synergy-engine');
          const tokensApprox = Math.ceil((prompt.length + normalizedResponse.length) / 4);
          costTracker.recordApiCall(model.name, tokensApprox / 1000, { endpoint: model.endpoint });
          synergyEngine.recordModelPerformance(model.name, 'query', Date.now() - (model as any)._startMs || 0, confidence, confidence > 0);
        } catch { /* funding system not available */ }

        return {
          model: model.name,
          response: normalizedResponse,
          confidence,
          timestamp: Date.now(),
        };
      } catch (error) {
        console.error(`Error querying ${model.name}:`, error);

        // Track failure in funding system
        try {
          const synergyEngine = require('../funding/model-synergy-engine');
          synergyEngine.recordModelPerformance(model.name, 'query', 0, 0, false);
        } catch { /* funding system not available */ }

        return {
          model: model.name,
          response: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          confidence: 0,
          timestamp: Date.now(),
        };
      }
    })
  );

  return responses.filter((r) => r.confidence > 0);
}

export async function getBestResponse(prompt: string): Promise<string> {
  ensureModelsInitialized();
  const responses = await getMultiModelResponse(prompt, 1);
  return responses[0]?.response || 'Unable to get response from any model';
}

export function getAvailableModels(): string[] {
  ensureModelsInitialized();
  return models.map((m) => m.name);
}
