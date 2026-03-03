/**
 * Multi-Model AI Orchestrator
 * Routes queries to best-suited AI model for optimal responses
 */

interface ModelConfig {
  name: string;
  apiKey: string;
  type: 'grok' | 'openai' | 'anthropic' | 'local' | 'huggingface';
  endpoint?: string;
  priority: number;
}

interface ModelResponse {
  model: string;
  response: string;
  confidence: number;
  timestamp: number;
}

const models: ModelConfig[] = [];

export async function initializeModels() {
  // Grok (primary - Grok API)
  if (process.env.GROK_API_KEY) {
    models.push({
      name: 'grok',
      apiKey: process.env.GROK_API_KEY,
      type: 'grok',
      endpoint: process.env.GROK_ENDPOINT || 'https://api.x.ai/v1/chat/completions',
      priority: 1,
    });
  }

  // OpenAI (fallback)
  if (process.env.OPENAI_API_KEY) {
    models.push({
      name: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      type: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      priority: 2,
    });
  }

  // Anthropic Claude (fallback)
  if (process.env.ANTHROPIC_API_KEY) {
    models.push({
      name: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      type: 'anthropic',
      endpoint: 'https://api.anthropic.com/v1/messages',
      priority: 3,
    });
  }

  // Local Ollama for fallback (no API key needed)
  if (process.env.OLLAMA_ENDPOINT) {
    models.push({
      name: 'ollama-local',
      apiKey: '',
      type: 'local',
      endpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434/api/generate',
      priority: 4,
    });
  }

  // Hugging Face for lightweight inference
  if (process.env.HUGGINGFACE_API_KEY) {
    models.push({
      name: 'huggingface',
      apiKey: process.env.HUGGINGFACE_API_KEY,
      type: 'huggingface',
      endpoint: 'https://api-inference.huggingface.co/models/',
      priority: 5,
    });
  }
}

async function queryGrok(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'grok-beta',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1000,
    }),
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'No response';
}

async function queryOpenAI(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1000,
    }),
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'No response';
}

async function queryOllama(prompt: string, endpoint: string): Promise<string> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mistral',
      prompt: prompt,
      stream: false,
    }),
  });

  const data = await response.json();
  return data.response || 'No response';
}

async function queryAnthropic(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  return data.content?.[0]?.text || 'No response';
}

export async function getMultiModelResponse(
  prompt: string,
  count: number = 2,
  options?: {
    preferredModels?: string[];
  }
): Promise<ModelResponse[]> {
  if (models.length === 0) {
    throw new Error('No AI models configured');
  }

  const preferred = (options?.preferredModels || []).map((item) => item.toLowerCase());
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
          response = await queryGrok(prompt, model.apiKey);
        } else if (model.type === 'openai') {
          response = await queryOpenAI(prompt, model.apiKey);
        } else if (model.type === 'anthropic') {
          response = await queryAnthropic(prompt, model.apiKey);
        } else if (model.type === 'local') {
          response = await queryOllama(prompt, model.endpoint || '');
        }

        return {
          model: model.name,
          response,
          confidence: 0.85,
          timestamp: Date.now(),
        };
      } catch (error) {
        console.error(`Error querying ${model.name}:`, error);
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
  const responses = await getMultiModelResponse(prompt, 1);
  return responses[0]?.response || 'Unable to get response from any model';
}

export function getAvailableModels(): string[] {
  return models.map((m) => m.name);
}
