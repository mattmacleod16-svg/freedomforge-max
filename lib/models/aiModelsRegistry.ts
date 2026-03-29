/**
 * Comprehensive AI Models Registry
 * Catalogs every major AI model provider for global adoption potential.
 * Used by the model orchestrator for routing and by marketing pages for showcase.
 */

export type ModelTier = 'frontier' | 'enterprise' | 'open-source' | 'specialized' | 'edge';
export type ModelCapability =
  | 'text-generation'
  | 'code-generation'
  | 'vision'
  | 'audio'
  | 'video'
  | 'image-generation'
  | 'embeddings'
  | 'function-calling'
  | 'reasoning'
  | 'real-time'
  | 'multimodal'
  | 'agents'
  | 'search'
  | 'translation'
  | 'fine-tuning'
  | 'on-device';

export interface AIModelProvider {
  id: string;
  name: string;
  tier: ModelTier;
  description: string;
  website: string;
  apiStyle: 'openai-compatible' | 'anthropic' | 'google' | 'custom' | 'local';
  defaultEndpoint: string;
  envKeys: string[];
  models: AIModelEntry[];
  capabilities: ModelCapability[];
  regions: string[];
  pricing: 'free' | 'freemium' | 'paid' | 'enterprise';
  openSource: boolean;
  integrationStatus: 'active' | 'planned' | 'community';
}

export interface AIModelEntry {
  id: string;
  name: string;
  contextWindow: number;
  maxOutput: number;
  capabilities: ModelCapability[];
  released: string;
  recommended?: boolean;
}

export const AI_MODEL_PROVIDERS: AIModelProvider[] = [
  // ═══════════════════════════════════════════════════════
  // FRONTIER MODELS
  // ═══════════════════════════════════════════════════════
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    tier: 'frontier',
    description: 'Industry-leading AI with constitutional alignment, deep reasoning, and extended context windows.',
    website: 'https://anthropic.com',
    apiStyle: 'anthropic',
    defaultEndpoint: 'https://api.anthropic.com/v1/messages',
    envKeys: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
    capabilities: ['text-generation', 'code-generation', 'vision', 'reasoning', 'function-calling', 'agents', 'multimodal'],
    regions: ['US', 'EU', 'Global'],
    pricing: 'paid',
    openSource: false,
    integrationStatus: 'active',
    models: [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextWindow: 200000, maxOutput: 32000, capabilities: ['text-generation', 'code-generation', 'vision', 'reasoning', 'agents'], released: '2025', recommended: true },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 200000, maxOutput: 16000, capabilities: ['text-generation', 'code-generation', 'vision', 'reasoning'], released: '2025' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200000, maxOutput: 8192, capabilities: ['text-generation', 'code-generation', 'vision'], released: '2025' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tier: 'frontier',
    description: 'Pioneering large language models with GPT-4 series, o-series reasoning, and DALL-E image generation.',
    website: 'https://openai.com',
    apiStyle: 'openai-compatible',
    defaultEndpoint: 'https://api.openai.com/v1/chat/completions',
    envKeys: ['OPENAI_API_KEY'],
    capabilities: ['text-generation', 'code-generation', 'vision', 'image-generation', 'audio', 'embeddings', 'function-calling', 'reasoning', 'multimodal', 'agents', 'real-time'],
    regions: ['US', 'EU', 'Global'],
    pricing: 'paid',
    openSource: false,
    integrationStatus: 'active',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxOutput: 16384, capabilities: ['text-generation', 'code-generation', 'vision', 'multimodal'], released: '2024', recommended: true },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, maxOutput: 16384, capabilities: ['text-generation', 'code-generation', 'vision'], released: '2024' },
      { id: 'o3', name: 'o3', contextWindow: 200000, maxOutput: 100000, capabilities: ['text-generation', 'code-generation', 'reasoning'], released: '2025' },
      { id: 'o4-mini', name: 'o4-mini', contextWindow: 200000, maxOutput: 100000, capabilities: ['text-generation', 'reasoning'], released: '2025' },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    tier: 'frontier',
    description: 'Google DeepMind\'s multimodal AI family with massive context windows and native search integration.',
    website: 'https://ai.google.dev',
    apiStyle: 'google',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    envKeys: ['GEMINI_API_KEY', 'GOOGLE_GEMINI_API_KEY'],
    capabilities: ['text-generation', 'code-generation', 'vision', 'video', 'audio', 'multimodal', 'search', 'function-calling', 'reasoning', 'embeddings'],
    regions: ['US', 'EU', 'Asia', 'Global'],
    pricing: 'freemium',
    openSource: false,
    integrationStatus: 'active',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1000000, maxOutput: 65536, capabilities: ['text-generation', 'code-generation', 'vision', 'reasoning', 'multimodal'], released: '2025', recommended: true },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1000000, maxOutput: 65536, capabilities: ['text-generation', 'code-generation', 'vision', 'multimodal'], released: '2025' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextWindow: 1000000, maxOutput: 8192, capabilities: ['text-generation', 'code-generation', 'vision'], released: '2025' },
    ],
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    tier: 'frontier',
    description: 'Elon Musk\'s xAI with real-time X/Twitter data access and unfiltered reasoning capabilities.',
    website: 'https://x.ai',
    apiStyle: 'openai-compatible',
    defaultEndpoint: 'https://api.x.ai/v1/chat/completions',
    envKeys: ['GROK_API_KEY', 'XAI_API_KEY'],
    capabilities: ['text-generation', 'code-generation', 'vision', 'real-time', 'search', 'reasoning', 'function-calling'],
    regions: ['US', 'Global'],
    pricing: 'paid',
    openSource: false,
    integrationStatus: 'active',
    models: [
      { id: 'grok-3', name: 'Grok 3', contextWindow: 131072, maxOutput: 16384, capabilities: ['text-generation', 'code-generation', 'reasoning', 'real-time'], released: '2025', recommended: true },
      { id: 'grok-3-mini', name: 'Grok 3 Mini', contextWindow: 131072, maxOutput: 16384, capabilities: ['text-generation', 'code-generation', 'reasoning'], released: '2025' },
      { id: 'grok-beta', name: 'Grok Beta', contextWindow: 131072, maxOutput: 4096, capabilities: ['text-generation', 'code-generation'], released: '2024' },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // ENTERPRISE / HIGH-PERFORMANCE
  // ═══════════════════════════════════════════════════════
  {
    id: 'mistral',
    name: 'Mistral AI',
    tier: 'enterprise',
    description: 'European AI leader with efficient, multilingual models and strong enterprise compliance (GDPR-native).',
    website: 'https://mistral.ai',
    apiStyle: 'openai-compatible',
    defaultEndpoint: 'https://api.mistral.ai/v1/chat/completions',
    envKeys: ['MISTRAL_API_KEY', 'MISTRALAI_API_KEY'],
    capabilities: ['text-generation', 'code-generation', 'function-calling', 'embeddings', 'translation', 'fine-tuning', 'vision'],
    regions: ['EU', 'US', 'Global'],
    pricing: 'freemium',
    openSource: true,
    integrationStatus: 'active',
    models: [
      { id: 'mistral-large-latest', name: 'Mistral Large', contextWindow: 128000, maxOutput: 8192, capabilities: ['text-generation', 'code-generation', 'function-calling', 'vision'], released: '2025', recommended: true },
      { id: 'mistral-medium-latest', name: 'Mistral Medium', contextWindow: 128000, maxOutput: 8192, capabilities: ['text-generation', 'code-generation'], released: '2025' },
      { id: 'codestral-latest', name: 'Codestral', contextWindow: 256000, maxOutput: 8192, capabilities: ['code-generation'], released: '2025' },
      { id: 'mistral-small-latest', name: 'Mistral Small', contextWindow: 128000, maxOutput: 8192, capabilities: ['text-generation', 'code-generation'], released: '2025' },
    ],
  },
  {
    id: 'cohere',
    name: 'Cohere',
    tier: 'enterprise',
    description: 'Enterprise-focused NLP with RAG-optimized models, multilingual support, and production-grade embeddings.',
    website: 'https://cohere.com',
    apiStyle: 'custom',
    defaultEndpoint: 'https://api.cohere.ai/v2/chat',
    envKeys: ['COHERE_API_KEY'],
    capabilities: ['text-generation', 'embeddings', 'search', 'translation', 'function-calling', 'fine-tuning'],
    regions: ['US', 'EU', 'Global'],
    pricing: 'freemium',
    openSource: false,
    integrationStatus: 'planned',
    models: [
      { id: 'command-r-plus', name: 'Command R+', contextWindow: 128000, maxOutput: 4096, capabilities: ['text-generation', 'search', 'function-calling'], released: '2024', recommended: true },
      { id: 'command-r', name: 'Command R', contextWindow: 128000, maxOutput: 4096, capabilities: ['text-generation', 'search'], released: '2024' },
      { id: 'embed-v4', name: 'Embed v4', contextWindow: 512, maxOutput: 0, capabilities: ['embeddings'], released: '2025' },
    ],
  },
  {
    id: 'ai21',
    name: 'AI21 Labs',
    tier: 'enterprise',
    description: 'Israeli AI lab specializing in reliable, enterprise-grade language models with Jamba architecture.',
    website: 'https://ai21.com',
    apiStyle: 'custom',
    defaultEndpoint: 'https://api.ai21.com/studio/v1/chat/completions',
    envKeys: ['AI21_API_KEY'],
    capabilities: ['text-generation', 'code-generation', 'fine-tuning'],
    regions: ['US', 'EU', 'Global'],
    pricing: 'paid',
    openSource: false,
    integrationStatus: 'planned',
    models: [
      { id: 'jamba-1.5-large', name: 'Jamba 1.5 Large', contextWindow: 256000, maxOutput: 4096, capabilities: ['text-generation', 'code-generation'], released: '2024', recommended: true },
      { id: 'jamba-1.5-mini', name: 'Jamba 1.5 Mini', contextWindow: 256000, maxOutput: 4096, capabilities: ['text-generation'], released: '2024' },
    ],
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    tier: 'enterprise',
    description: 'GPU-accelerated AI inference with optimized model serving via NVIDIA Inference Microservices.',
    website: 'https://build.nvidia.com',
    apiStyle: 'openai-compatible',
    defaultEndpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
    envKeys: ['NVIDIA_API_KEY', 'NIM_API_KEY'],
    capabilities: ['text-generation', 'code-generation', 'vision', 'embeddings'],
    regions: ['US', 'EU', 'Asia', 'Global'],
    pricing: 'freemium',
    openSource: false,
    integrationStatus: 'active',
    models: [
      { id: 'meta/llama-3.1-405b-instruct', name: 'Llama 3.1 405B (NIM)', contextWindow: 128000, maxOutput: 4096, capabilities: ['text-generation', 'code-generation'], released: '2024', recommended: true },
      { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B (NIM)', contextWindow: 128000, maxOutput: 4096, capabilities: ['text-generation', 'code-generation'], released: '2024' },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // OPEN-SOURCE ECOSYSTEM
  // ═══════════════════════════════════════════════════════
  {
    id: 'meta',
    name: 'Meta Llama',
    tier: 'open-source',
    description: 'Meta\'s open-weight LLM family - the backbone of the open-source AI ecosystem.',
    website: 'https://llama.meta.com',
    apiStyle: 'openai-compatible',
    defaultEndpoint: '',
    envKeys: ['LLAMA_API_KEY'],
    capabilities: ['text-generation', 'code-generation', 'vision', 'multimodal', 'fine-tuning', 'on-device'],
    regions: ['Global'],
    pricing: 'free',
    openSource: true,
    integrationStatus: 'active',
    models: [
      { id: 'llama-4-maverick', name: 'Llama 4 Maverick', contextWindow: 1048576, maxOutput: 16384, capabilities: ['text-generation', 'code-generation', 'vision', 'multimodal'], released: '2025', recommended: true },
      { id: 'llama-4-scout', name: 'Llama 4 Scout', contextWindow: 10485760, maxOutput: 16384, capabilities: ['text-generation', 'code-generation', 'vision'], released: '2025' },
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', contextWindow: 128000, maxOutput: 4096, capabilities: ['text-generation', 'code-generation'], released: '2024' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    tier: 'open-source',
    description: 'Chinese AI lab with breakthrough efficiency via Mixture-of-Experts architecture. Strong in code and math.',
    website: 'https://deepseek.com',
    apiStyle: 'openai-compatible',
    defaultEndpoint: 'https://api.deepseek.com/v1/chat/completions',
    envKeys: ['DEEPSEEK_API_KEY'],
    capabilities: ['text-generation', 'code-generation', 'reasoning', 'function-calling'],
    regions: ['China', 'Global'],
    pricing: 'freemium',
    openSource: true,
    integrationStatus: 'planned',
    models: [
      { id: 'deepseek-r1', name: 'DeepSeek R1', contextWindow: 128000, maxOutput: 8192, capabilities: ['text-generation', 'code-generation', 'reasoning'], released: '2025', recommended: true },
      { id: 'deepseek-v3', name: 'DeepSeek V3', contextWindow: 128000, maxOutput: 8192, capabilities: ['text-generation', 'code-generation'], released: '2025' },
      { id: 'deepseek-coder-v2', name: 'DeepSeek Coder V2', contextWindow: 128000, maxOutput: 4096, capabilities: ['code-generation'], released: '2024' },
    ],
  },
  {
    id: 'qwen',
    name: 'Alibaba Qwen',
    tier: 'open-source',
    description: 'Alibaba Cloud\'s multilingual AI models with strong Chinese/Asian language support and coding abilities.',
    website: 'https://qwenlm.github.io',
    apiStyle: 'openai-compatible',
    defaultEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    envKeys: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
    capabilities: ['text-generation', 'code-generation', 'vision', 'multimodal', 'translation', 'fine-tuning'],
    regions: ['China', 'Asia', 'Global'],
    pricing: 'freemium',
    openSource: true,
    integrationStatus: 'planned',
    models: [
      { id: 'qwen-max', name: 'Qwen Max', contextWindow: 128000, maxOutput: 8192, capabilities: ['text-generation', 'code-generation', 'vision'], released: '2025', recommended: true },
      { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 128000, maxOutput: 8192, capabilities: ['text-generation', 'code-generation'], released: '2025' },
      { id: 'qwen2.5-coder-32b', name: 'Qwen 2.5 Coder 32B', contextWindow: 32768, maxOutput: 4096, capabilities: ['code-generation'], released: '2024' },
    ],
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    tier: 'open-source',
    description: 'The world\'s largest open-source AI hub - access thousands of models through a unified inference API.',
    website: 'https://huggingface.co',
    apiStyle: 'custom',
    defaultEndpoint: 'https://api-inference.huggingface.co/models/',
    envKeys: ['HUGGINGFACE_API_KEY', 'HF_TOKEN'],
    capabilities: ['text-generation', 'code-generation', 'vision', 'image-generation', 'audio', 'embeddings', 'translation', 'fine-tuning'],
    regions: ['US', 'EU', 'Global'],
    pricing: 'freemium',
    openSource: true,
    integrationStatus: 'active',
    models: [
      { id: 'mistralai/Mistral-7B-Instruct-v0.2', name: 'Mistral 7B Instruct', contextWindow: 32768, maxOutput: 4096, capabilities: ['text-generation'], released: '2024' },
      { id: 'meta-llama/Llama-3-8B-Instruct', name: 'Llama 3 8B', contextWindow: 8192, maxOutput: 4096, capabilities: ['text-generation', 'code-generation'], released: '2024' },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // INFERENCE PLATFORMS / AGGREGATORS
  // ═══════════════════════════════════════════════════════
  {
    id: 'groq',
    name: 'Groq',
    tier: 'specialized',
    description: 'Ultra-fast LPU-powered inference - the fastest AI inference engine on the planet.',
    website: 'https://groq.com',
    apiStyle: 'openai-compatible',
    defaultEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
    envKeys: ['GROQ_API_KEY'],
    capabilities: ['text-generation', 'code-generation', 'vision', 'audio', 'real-time'],
    regions: ['US', 'Global'],
    pricing: 'freemium',
    openSource: false,
    integrationStatus: 'active',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Groq)', contextWindow: 128000, maxOutput: 32768, capabilities: ['text-generation', 'code-generation'], released: '2024', recommended: true },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B (Groq)', contextWindow: 32768, maxOutput: 4096, capabilities: ['text-generation', 'code-generation'], released: '2024' },
    ],
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    tier: 'specialized',
    description: 'Wafer-scale AI chips delivering near-instant inference speeds for open-source models.',
    website: 'https://cerebras.ai',
    apiStyle: 'openai-compatible',
    defaultEndpoint: 'https://api.cerebras.ai/v1/chat/completions',
    envKeys: ['CEREBRAS_API_KEY'],
    capabilities: ['text-generation', 'code-generation', 'real-time'],
    regions: ['US', 'Global'],
    pricing: 'freemium',
    openSource: false,
    integrationStatus: 'active',
    models: [
      { id: 'llama-3.3-70b', name: 'Llama 3.3 70B (Cerebras)', contextWindow: 128000, maxOutput: 8192, capabilities: ['text-generation', 'code-generation'], released: '2024', recommended: true },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    tier: 'specialized',
    description: 'Universal AI gateway - access 200+ models from every provider through a single API.',
    website: 'https://openrouter.ai',
    apiStyle: 'openai-compatible',
    defaultEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
    envKeys: ['OPENROUTER_API_KEY'],
    capabilities: ['text-generation', 'code-generation', 'vision', 'multimodal', 'function-calling'],
    regions: ['Global'],
    pricing: 'paid',
    openSource: false,
    integrationStatus: 'active',
    models: [
      { id: 'openai/gpt-4o', name: 'GPT-4o (via OpenRouter)', contextWindow: 128000, maxOutput: 16384, capabilities: ['text-generation', 'vision'], released: '2024' },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (via OpenRouter)', contextWindow: 200000, maxOutput: 8192, capabilities: ['text-generation', 'reasoning'], released: '2024' },
    ],
  },
  {
    id: 'together',
    name: 'Together AI',
    tier: 'specialized',
    description: 'Fast, affordable inference and fine-tuning for open-source models with enterprise features.',
    website: 'https://together.ai',
    apiStyle: 'openai-compatible',
    defaultEndpoint: 'https://api.together.xyz/v1/chat/completions',
    envKeys: ['TOGETHER_API_KEY', 'TOGETHERAI_API_KEY'],
    capabilities: ['text-generation', 'code-generation', 'vision', 'image-generation', 'embeddings', 'fine-tuning'],
    regions: ['US', 'Global'],
    pricing: 'paid',
    openSource: false,
    integrationStatus: 'planned',
    models: [
      { id: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', name: 'Llama 3.1 405B Turbo', contextWindow: 128000, maxOutput: 4096, capabilities: ['text-generation', 'code-generation'], released: '2024', recommended: true },
      { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1 (Together)', contextWindow: 128000, maxOutput: 8192, capabilities: ['text-generation', 'reasoning'], released: '2025' },
    ],
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    tier: 'specialized',
    description: 'Lightning-fast serverless inference optimized for production workloads and compound AI systems.',
    website: 'https://fireworks.ai',
    apiStyle: 'openai-compatible',
    defaultEndpoint: 'https://api.fireworks.ai/inference/v1/chat/completions',
    envKeys: ['FIREWORKS_API_KEY'],
    capabilities: ['text-generation', 'code-generation', 'vision', 'function-calling', 'fine-tuning', 'embeddings'],
    regions: ['US', 'Global'],
    pricing: 'paid',
    openSource: false,
    integrationStatus: 'planned',
    models: [
      { id: 'accounts/fireworks/models/llama-v3p1-405b-instruct', name: 'Llama 3.1 405B (Fireworks)', contextWindow: 128000, maxOutput: 4096, capabilities: ['text-generation', 'code-generation'], released: '2024', recommended: true },
    ],
  },
  {
    id: 'replicate',
    name: 'Replicate',
    tier: 'specialized',
    description: 'Run any open-source model in the cloud with simple API calls. Strong image/video model ecosystem.',
    website: 'https://replicate.com',
    apiStyle: 'custom',
    defaultEndpoint: 'https://api.replicate.com/v1/predictions',
    envKeys: ['REPLICATE_API_KEY', 'REPLICATE_API_TOKEN'],
    capabilities: ['text-generation', 'image-generation', 'video', 'audio', 'vision'],
    regions: ['US', 'Global'],
    pricing: 'paid',
    openSource: false,
    integrationStatus: 'planned',
    models: [
      { id: 'meta/meta-llama-3-70b-instruct', name: 'Llama 3 70B (Replicate)', contextWindow: 8192, maxOutput: 4096, capabilities: ['text-generation'], released: '2024' },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // SPECIALIZED & EMERGING
  // ═══════════════════════════════════════════════════════
  {
    id: 'perplexity',
    name: 'Perplexity',
    tier: 'specialized',
    description: 'AI-powered search engine with real-time web access and citation-backed responses.',
    website: 'https://perplexity.ai',
    apiStyle: 'openai-compatible',
    defaultEndpoint: 'https://api.perplexity.ai/chat/completions',
    envKeys: ['PERPLEXITY_API_KEY', 'PPLX_API_KEY'],
    capabilities: ['text-generation', 'search', 'real-time'],
    regions: ['US', 'Global'],
    pricing: 'paid',
    openSource: false,
    integrationStatus: 'planned',
    models: [
      { id: 'sonar-pro', name: 'Sonar Pro', contextWindow: 200000, maxOutput: 8192, capabilities: ['text-generation', 'search', 'real-time'], released: '2025', recommended: true },
      { id: 'sonar', name: 'Sonar', contextWindow: 128000, maxOutput: 8192, capabilities: ['text-generation', 'search'], released: '2025' },
    ],
  },
  {
    id: 'stability',
    name: 'Stability AI',
    tier: 'specialized',
    description: 'Open-source generative AI for images, video, audio, and 3D with Stable Diffusion.',
    website: 'https://stability.ai',
    apiStyle: 'custom',
    defaultEndpoint: 'https://api.stability.ai/v2beta',
    envKeys: ['STABILITY_API_KEY'],
    capabilities: ['image-generation', 'video', 'audio'],
    regions: ['US', 'EU', 'Global'],
    pricing: 'freemium',
    openSource: true,
    integrationStatus: 'planned',
    models: [
      { id: 'stable-diffusion-3.5', name: 'Stable Diffusion 3.5', contextWindow: 0, maxOutput: 0, capabilities: ['image-generation'], released: '2024', recommended: true },
      { id: 'stable-video-diffusion', name: 'Stable Video Diffusion', contextWindow: 0, maxOutput: 0, capabilities: ['video'], released: '2024' },
    ],
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    tier: 'specialized',
    description: 'Industry-leading AI voice synthesis and cloning for natural, expressive speech generation.',
    website: 'https://elevenlabs.io',
    apiStyle: 'custom',
    defaultEndpoint: 'https://api.elevenlabs.io/v1',
    envKeys: ['ELEVENLABS_API_KEY'],
    capabilities: ['audio', 'real-time'],
    regions: ['US', 'EU', 'Global'],
    pricing: 'freemium',
    openSource: false,
    integrationStatus: 'active',
    models: [
      { id: 'eleven_multilingual_v2', name: 'Multilingual v2', contextWindow: 0, maxOutput: 0, capabilities: ['audio'], released: '2024', recommended: true },
    ],
  },

  // ═══════════════════════════════════════════════════════
  // EDGE / LOCAL / ON-DEVICE
  // ═══════════════════════════════════════════════════════
  {
    id: 'ollama',
    name: 'Ollama',
    tier: 'edge',
    description: 'Run large language models locally with zero cloud dependency. Full data privacy and offline capability.',
    website: 'https://ollama.com',
    apiStyle: 'local',
    defaultEndpoint: 'http://localhost:11434/api/generate',
    envKeys: ['OLLAMA_ENDPOINT', 'OLLAMA_BASE_URL'],
    capabilities: ['text-generation', 'code-generation', 'vision', 'on-device'],
    regions: ['Local'],
    pricing: 'free',
    openSource: true,
    integrationStatus: 'active',
    models: [
      { id: 'llama3.3', name: 'Llama 3.3 (Local)', contextWindow: 128000, maxOutput: 4096, capabilities: ['text-generation', 'code-generation'], released: '2024', recommended: true },
      { id: 'mistral', name: 'Mistral (Local)', contextWindow: 32768, maxOutput: 4096, capabilities: ['text-generation'], released: '2024' },
      { id: 'codellama', name: 'Code Llama (Local)', contextWindow: 16384, maxOutput: 4096, capabilities: ['code-generation'], released: '2024' },
    ],
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    tier: 'edge',
    description: 'Desktop application for running LLMs locally with an intuitive GUI and OpenAI-compatible server.',
    website: 'https://lmstudio.ai',
    apiStyle: 'openai-compatible',
    defaultEndpoint: 'http://localhost:1234/v1/chat/completions',
    envKeys: ['LMSTUDIO_ENDPOINT'],
    capabilities: ['text-generation', 'code-generation', 'on-device'],
    regions: ['Local'],
    pricing: 'free',
    openSource: false,
    integrationStatus: 'planned',
    models: [
      { id: 'local-model', name: 'User-selected Model', contextWindow: 32768, maxOutput: 4096, capabilities: ['text-generation', 'code-generation'], released: '2024' },
    ],
  },

  // ── Decentralized AI Networks ───────────────────────────────────────────────
  {
    id: 'akash',
    name: 'Akash Network (AkashML)',
    tier: 'open-source',
    description: 'Decentralized GPU cloud marketplace — OpenAI-compatible serverless inference at 70% below centralised cloud costs.',
    website: 'https://akash.network',
    apiStyle: 'openai-compatible',
    defaultEndpoint: 'https://chatapi.akash.network/api/v1/chat/completions',
    envKeys: ['AKASH_API_KEY'],
    capabilities: ['text-generation', 'reasoning', 'agents'],
    regions: ['Global'],
    pricing: 'freemium',
    openSource: true,
    integrationStatus: 'active',
    models: [
      { id: 'Meta-Llama-3-1-405B-Instruct-FP8', name: 'Llama 3.1 405B (Akash)', contextWindow: 128000, maxOutput: 4096, capabilities: ['text-generation', 'reasoning', 'agents'], released: '2025', recommended: true },
    ],
  },
  {
    id: 'corcel',
    name: 'Corcel (Bittensor)',
    tier: 'open-source',
    description: 'OpenAI-compatible gateway into the Bittensor decentralised intelligence network — collective subnet reasoning.',
    website: 'https://corcel.io',
    apiStyle: 'openai-compatible',
    defaultEndpoint: 'https://api.corcel.io/v1/text/cortext/chat',
    envKeys: ['CORCEL_API_KEY'],
    capabilities: ['text-generation', 'reasoning', 'agents'],
    regions: ['Global'],
    pricing: 'freemium',
    openSource: true,
    integrationStatus: 'active',
    models: [
      { id: 'cortext-ultra', name: 'Cortext Ultra (TAO)', contextWindow: 32000, maxOutput: 4096, capabilities: ['text-generation', 'reasoning'], released: '2025' },
    ],
  },
  {
    id: 'ionet',
    name: 'io.net',
    tier: 'open-source',
    description: 'Solana-based DePIN GPU network across 130+ countries — Ray-distributed clusters with sub-90s spin-up.',
    website: 'https://io.net',
    apiStyle: 'openai-compatible',
    defaultEndpoint: 'https://api.io.net/v1/chat/completions',
    envKeys: ['IONET_API_KEY'],
    capabilities: ['text-generation', 'reasoning', 'agents'],
    regions: ['Global'],
    pricing: 'freemium',
    openSource: true,
    integrationStatus: 'active',
    models: [
      { id: 'llama-3.1-70b', name: 'Llama 3.1 70B (io.net)', contextWindow: 128000, maxOutput: 4096, capabilities: ['text-generation', 'reasoning'], released: '2025' },
    ],
  },
  {
    id: 'zerog',
    name: '0G (Zero Gravity)',
    tier: 'open-source',
    description: 'TEE-verified sealed inference with on-chain settlement — private, verifiable compute for sensitive queries.',
    website: 'https://0g.ai',
    apiStyle: 'openai-compatible',
    defaultEndpoint: 'https://rpc.0g.ai/v1/chat/completions',
    envKeys: ['ZEROG_API_KEY'],
    capabilities: ['text-generation', 'reasoning', 'agents'],
    regions: ['Global'],
    pricing: 'freemium',
    openSource: true,
    integrationStatus: 'active',
    models: [
      { id: '0g-serving-model', name: '0G Sealed Inference', contextWindow: 32000, maxOutput: 4096, capabilities: ['text-generation', 'reasoning'], released: '2026' },
    ],
  },
];

// ═══════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════

export function getProviderById(id: string): AIModelProvider | undefined {
  return AI_MODEL_PROVIDERS.find((p) => p.id === id);
}

export function getProvidersByTier(tier: ModelTier): AIModelProvider[] {
  return AI_MODEL_PROVIDERS.filter((p) => p.tier === tier);
}

export function getActiveProviders(): AIModelProvider[] {
  return AI_MODEL_PROVIDERS.filter((p) => p.integrationStatus === 'active');
}

export function getAllCapabilities(): ModelCapability[] {
  const caps = new Set<ModelCapability>();
  for (const provider of AI_MODEL_PROVIDERS) {
    for (const cap of provider.capabilities) {
      caps.add(cap);
    }
  }
  return Array.from(caps);
}

export function getProvidersByCapability(capability: ModelCapability): AIModelProvider[] {
  return AI_MODEL_PROVIDERS.filter((p) => p.capabilities.includes(capability));
}

export function getTotalModelCount(): number {
  return AI_MODEL_PROVIDERS.reduce((sum, p) => sum + p.models.length, 0);
}

export function getRegistryStats() {
  return {
    totalProviders: AI_MODEL_PROVIDERS.length,
    totalModels: getTotalModelCount(),
    activeIntegrations: AI_MODEL_PROVIDERS.filter((p) => p.integrationStatus === 'active').length,
    plannedIntegrations: AI_MODEL_PROVIDERS.filter((p) => p.integrationStatus === 'planned').length,
    openSourceProviders: AI_MODEL_PROVIDERS.filter((p) => p.openSource).length,
    tiers: {
      frontier: getProvidersByTier('frontier').length,
      enterprise: getProvidersByTier('enterprise').length,
      openSource: getProvidersByTier('open-source').length,
      specialized: getProvidersByTier('specialized').length,
      edge: getProvidersByTier('edge').length,
    },
    capabilities: getAllCapabilities().length,
    regions: Array.from(new Set(AI_MODEL_PROVIDERS.flatMap((p) => p.regions))),
  };
}
