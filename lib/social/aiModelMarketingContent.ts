/**
 * AI Model Marketing Content Library
 * Pre-built content templates for social media growth focused on AI model capabilities.
 * Used by xAutomation and other growth channels to promote FreedomForge Max's
 * multi-model AI infrastructure for maximum global visibility.
 */

import { AI_MODEL_PROVIDERS, getRegistryStats } from '@/lib/models/aiModelsRegistry';

export type ContentCategory =
  | 'model-spotlight'
  | 'capability-highlight'
  | 'comparison'
  | 'milestone'
  | 'educational'
  | 'engagement'
  | 'trending';

export interface MarketingPost {
  id: string;
  category: ContentCategory;
  template: string;
  hashtags: string[];
  targetAudience: string;
}

const CORE_HASHTAGS = ['#FreedomForgeMax', '#AI', '#MultiModelAI', '#AutonomousAI'];

/**
 * Generate dynamic marketing posts based on current registry state.
 */
export function generateModelSpotlightPosts(): MarketingPost[] {
  const stats = getRegistryStats();
  const posts: MarketingPost[] = [];

  // Provider spotlight posts
  for (const provider of AI_MODEL_PROVIDERS) {
    const recommended = provider.models.find((m) => m.recommended);
    const modelName = recommended?.name || provider.models[0]?.name || provider.name;

    posts.push({
      id: `spotlight-${provider.id}`,
      category: 'model-spotlight',
      template: `${provider.name} is now part of FreedomForge Max.\n\n${provider.description}\n\nTop model: ${modelName}\nCapabilities: ${provider.capabilities.slice(0, 4).join(', ')}\n\n${provider.openSource ? 'Open source and available to everyone.' : 'Enterprise-grade performance.'}\n\n${CORE_HASHTAGS.join(' ')} #${provider.name.replace(/\s+/g, '')}`,
      hashtags: [...CORE_HASHTAGS, `#${provider.name.replace(/\s+/g, '')}`],
      targetAudience: provider.tier === 'open-source' ? 'developers' : 'enterprise',
    });
  }

  // Stats milestone posts
  posts.push({
    id: 'milestone-providers',
    category: 'milestone',
    template: `${stats.totalProviders} AI providers. ${stats.totalModels}+ models. One platform.\n\nFreedomForge Max now integrates:\n- ${stats.tiers.frontier} frontier models\n- ${stats.tiers.enterprise} enterprise providers\n- ${stats.tiers.openSource} open-source ecosystems\n- ${stats.tiers.specialized} specialized platforms\n- ${stats.tiers.edge} edge/local runners\n\nEvery AI. Everywhere. All at once.\n\n${CORE_HASHTAGS.join(' ')}`,
    hashtags: CORE_HASHTAGS,
    targetAudience: 'general',
  });

  return posts;
}

/**
 * Capability-focused content for SEO and social.
 */
export function generateCapabilityPosts(): MarketingPost[] {
  const capabilities: { cap: string; headline: string; body: string }[] = [
    {
      cap: 'multi-model-consensus',
      headline: 'Multi-Model Consensus',
      body: 'Why trust one AI when you can query many? FreedomForge Max routes queries to multiple models, scores responses, and synthesizes the best answer. Consensus > single-model guessing.',
    },
    {
      cap: 'automatic-failover',
      headline: 'Zero Downtime AI',
      body: 'If one model goes down, FreedomForge Max automatically routes to the next best option. 20+ providers means you never lose access to AI intelligence.',
    },
    {
      cap: 'cost-optimization',
      headline: 'AI Cost Intelligence',
      body: 'Not every query needs GPT-4. FreedomForge Max routes simple queries to fast, cheap models and complex ones to frontier models. Smart routing saves money.',
    },
    {
      cap: 'global-reach',
      headline: 'AI From Every Region',
      body: 'US, EU, China, or local — FreedomForge Max integrates models from every major region. DeepSeek, Qwen, Mistral, Ollama. Wherever you are, AI is there.',
    },
    {
      cap: 'open-source-first',
      headline: 'Open Source AI at Scale',
      body: 'Llama, Mistral, DeepSeek, Qwen — the best open-source models run natively in FreedomForge Max. No vendor lock-in. Full transparency.',
    },
    {
      cap: 'edge-inference',
      headline: 'Local AI. Zero Cloud.',
      body: 'Run Ollama or LM Studio locally for complete data privacy. FreedomForge Max supports edge inference with zero cloud dependency.',
    },
  ];

  return capabilities.map((c) => ({
    id: `capability-${c.cap}`,
    category: 'capability-highlight' as ContentCategory,
    template: `${c.headline}\n\n${c.body}\n\n${CORE_HASHTAGS.join(' ')}`,
    hashtags: CORE_HASHTAGS,
    targetAudience: 'developers',
  }));
}

/**
 * Engagement-driving content for viral growth.
 */
export function generateEngagementPosts(): MarketingPost[] {
  return [
    {
      id: 'engage-poll-model',
      category: 'engagement',
      template: 'Which AI model do you trust most for critical decisions?\n\nA) Claude (Anthropic)\nB) GPT-4o (OpenAI)\nC) Gemini (Google)\nD) Grok (xAI)\n\nFreedomForge Max uses ALL of them simultaneously. Multi-model consensus > single model.\n\n#AI #FreedomForgeMax',
      hashtags: ['#AI', '#FreedomForgeMax', '#Claude', '#GPT4', '#Gemini', '#Grok'],
      targetAudience: 'general',
    },
    {
      id: 'engage-poll-opensource',
      category: 'engagement',
      template: 'Best open-source AI model in 2025?\n\nA) Llama 4 (Meta)\nB) DeepSeek R1\nC) Mistral Large\nD) Qwen Max\n\nAll integrated in FreedomForge Max. The real answer: use them all.\n\n#OpenSourceAI #FreedomForgeMax',
      hashtags: ['#OpenSourceAI', '#FreedomForgeMax', '#Llama', '#DeepSeek', '#Mistral'],
      targetAudience: 'developers',
    },
    {
      id: 'engage-challenge',
      category: 'engagement',
      template: 'Challenge: Name an AI model NOT in FreedomForge Max.\n\nWe integrate 20+ providers and 50+ models.\n\nClaude, GPT-4, Gemini, Grok, Llama, DeepSeek, Mistral, Groq, Cerebras, NVIDIA NIM, Cohere, Perplexity, Together, Fireworks, HuggingFace, Ollama...\n\nGood luck.\n\n#AI #FreedomForgeMax',
      hashtags: ['#AI', '#FreedomForgeMax'],
      targetAudience: 'general',
    },
    {
      id: 'engage-thread-why',
      category: 'educational',
      template: 'Why multi-model AI beats single-model:\n\n1. Redundancy — no single point of failure\n2. Consensus — multiple perspectives on every query\n3. Cost optimization — right model for the right task\n4. Global coverage — models from US, EU, China, local\n5. Speed — fastest available model wins\n\nThis is what FreedomForge Max does. Automatically.\n\n#AI #FreedomForgeMax #MultiModelAI',
      hashtags: ['#AI', '#FreedomForgeMax', '#MultiModelAI'],
      targetAudience: 'developers',
    },
  ];
}

/**
 * Trending topic templates — inject current AI news angles.
 */
export function generateTrendingTemplates(): MarketingPost[] {
  return [
    {
      id: 'trend-new-model',
      category: 'trending',
      template: 'Everyone talking about [NEW_MODEL]?\n\nFreedomForge Max already integrates it. Along with 50+ other models.\n\nWe don\'t chase models — we integrate everything.\n\n#AI #FreedomForgeMax',
      hashtags: ['#AI', '#FreedomForgeMax'],
      targetAudience: 'general',
    },
    {
      id: 'trend-benchmark',
      category: 'trending',
      template: 'New AI benchmarks dropped.\n\nDoesn\'t matter which model is #1 today — FreedomForge Max routes to the best model for YOUR specific query. Every time.\n\nMulti-model consensus > benchmark chasing.\n\n#AI #FreedomForgeMax #AIBenchmarks',
      hashtags: ['#AI', '#FreedomForgeMax', '#AIBenchmarks'],
      targetAudience: 'developers',
    },
  ];
}

/**
 * Get all available marketing content.
 */
export function getAllMarketingContent(): MarketingPost[] {
  return [
    ...generateModelSpotlightPosts(),
    ...generateCapabilityPosts(),
    ...generateEngagementPosts(),
    ...generateTrendingTemplates(),
  ];
}

/**
 * Pick a random post from a category, or from all if no category specified.
 */
export function pickRandomPost(category?: ContentCategory): MarketingPost {
  const posts = category
    ? getAllMarketingContent().filter((p) => p.category === category)
    : getAllMarketingContent();
  return posts[Math.floor(Math.random() * posts.length)];
}
