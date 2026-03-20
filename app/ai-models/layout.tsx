import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI Models — Every Provider, Every Model, One Platform',
  description:
    'Explore 20+ AI providers and 50+ models integrated into FreedomForge Max. From OpenAI GPT-4 and Anthropic Claude to Llama, DeepSeek, Gemini, Grok, and local inference with Ollama.',
  keywords: [
    'AI models comparison',
    'GPT-4',
    'Claude AI',
    'Gemini AI',
    'Grok AI',
    'Llama AI',
    'DeepSeek',
    'Mistral AI',
    'multi-model AI platform',
    'AI provider comparison',
    'open source AI models',
    'AI inference',
    'best AI models 2026',
    'AI model benchmark',
    'on-device AI inference',
    'Apple Foundation Models',
    'AI app store featured',
    'generative AI models',
    'AI trading models',
    'frontier AI models',
    'local AI inference',
    'privacy-first AI',
  ],
  openGraph: {
    title: 'FreedomForge Max — Every AI Model. One Platform.',
    description:
      '20+ AI providers, 50+ models, multi-model consensus, automatic failover. The most comprehensive AI integration stack.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Every AI Model. One Platform. | FreedomForge Max',
    description:
      'Explore 20+ AI providers and 50+ models in one autonomous intelligence stack.',
  },
};

export default function AIModelsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
