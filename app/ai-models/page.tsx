'use client';

import React from 'react';
import Link from 'next/link';
import { AI_MODEL_PROVIDERS, getRegistryStats, type AIModelProvider, type ModelTier } from '@/lib/models/aiModelsRegistry';

const TIER_CONFIG: Record<ModelTier, { label: string; color: string; glow: string; description: string }> = {
  frontier: {
    label: 'Frontier',
    color: 'from-amber-400 to-orange-500',
    glow: 'shadow-amber-500/20',
    description: 'State-of-the-art models pushing AI boundaries',
  },
  enterprise: {
    label: 'Enterprise',
    color: 'from-purple-400 to-violet-500',
    glow: 'shadow-purple-500/20',
    description: 'Production-grade models for business-critical workloads',
  },
  'open-source': {
    label: 'Open Source',
    color: 'from-emerald-400 to-green-500',
    glow: 'shadow-emerald-500/20',
    description: 'Community-driven models with full transparency',
  },
  specialized: {
    label: 'Specialized',
    color: 'from-cyan-400 to-blue-500',
    glow: 'shadow-cyan-500/20',
    description: 'Purpose-built platforms for specific AI tasks',
  },
  edge: {
    label: 'Edge / Local',
    color: 'from-rose-400 to-pink-500',
    glow: 'shadow-rose-500/20',
    description: 'Run AI locally with zero cloud dependency',
  },
};

const CAPABILITY_ICONS: Record<string, string> = {
  'text-generation': 'T',
  'code-generation': '</>',
  vision: 'V',
  audio: 'A',
  video: 'V',
  'image-generation': 'I',
  embeddings: 'E',
  'function-calling': 'F',
  reasoning: 'R',
  'real-time': 'RT',
  multimodal: 'M',
  agents: 'AG',
  search: 'S',
  translation: 'TR',
  'fine-tuning': 'FT',
  'on-device': 'D',
};

function ProviderCard({ provider }: { provider: AIModelProvider }) {
  const tier = TIER_CONFIG[provider.tier];
  const recommendedModel = provider.models.find((m) => m.recommended) || provider.models[0];

  return (
    <div className="group glass-card rounded-2xl p-6 transition-all duration-300 hover:scale-[1.02]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-block rounded-full bg-gradient-to-r ${tier.color} px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black`}>
              {tier.label}
            </span>
            {provider.integrationStatus === 'active' && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            )}
            {provider.integrationStatus === 'planned' && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
                Coming Soon
              </span>
            )}
            {provider.openSource && (
              <span className="inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] text-green-400">
                OSS
              </span>
            )}
          </div>
          <h3 className="text-lg font-bold text-white group-hover:text-amber-300 transition-colors">
            {provider.name}
          </h3>
          <p className="mt-1 text-sm text-zinc-400 leading-relaxed">{provider.description}</p>
        </div>
      </div>

      {recommendedModel && (
        <div className="mt-4 rounded-xl border border-zinc-800 bg-black/30 p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">Top Model</p>
              <p className="text-sm font-semibold text-zinc-200">{recommendedModel.name}</p>
            </div>
            {recommendedModel.contextWindow > 0 && (
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500">Context</p>
                <p className="text-sm font-semibold neon-text-gold">
                  {recommendedModel.contextWindow >= 1000000
                    ? `${(recommendedModel.contextWindow / 1000000).toFixed(1)}M`
                    : `${(recommendedModel.contextWindow / 1000).toFixed(0)}K`}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {provider.capabilities.slice(0, 6).map((cap) => (
          <span
            key={cap}
            className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-[10px] text-zinc-400"
            title={cap}
          >
            {CAPABILITY_ICONS[cap] || cap.slice(0, 2).toUpperCase()} {cap.replace(/-/g, ' ')}
          </span>
        ))}
        {provider.capabilities.length > 6 && (
          <span className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-[10px] text-zinc-500">
            +{provider.capabilities.length - 6} more
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
        <span>{provider.models.length} model{provider.models.length !== 1 ? 's' : ''}</span>
        <span>{provider.regions.join(', ')}</span>
      </div>
    </div>
  );
}

export default function AIModelsPage() {
  const stats = getRegistryStats();
  const [filter, setFilter] = React.useState<ModelTier | 'all'>('all');
  const [search, setSearch] = React.useState('');

  const filtered = AI_MODEL_PROVIDERS.filter((p) => {
    if (filter !== 'all' && p.tier !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.capabilities.some((c) => c.includes(q)) ||
        p.models.some((m) => m.name.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const tiers: (ModelTier | 'all')[] = ['all', 'frontier', 'enterprise', 'open-source', 'specialized', 'edge'];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[var(--bg-void)] via-[var(--bg-deep)] to-[var(--bg-void)] cyber-grid-bg">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-purple-900/10 via-transparent to-transparent" />
        <div className="mx-auto max-w-7xl px-6 pt-12 pb-16 relative">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition mb-8">
            &larr; Back to FreedomForge Max
          </Link>

          <div className="text-center mb-12">
            <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80 mb-3">Global AI Infrastructure</p>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-black tracking-tight phoenix-title">
              Every AI Model.
              <br />
              One Platform.
            </h1>
            <p className="mt-6 text-lg md:text-xl text-zinc-300 max-w-3xl mx-auto leading-relaxed">
              FreedomForge Max integrates <span className="text-amber-300 font-semibold">{stats.totalProviders} AI providers</span> and{' '}
              <span className="text-amber-300 font-semibold">{stats.totalModels}+ models</span> into a single autonomous intelligence stack.
              From frontier reasoning to edge inference — every capability, everywhere.
            </p>
          </div>

          {/* Stats Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 max-w-5xl mx-auto">
            {[
              { label: 'Providers', value: stats.totalProviders, color: 'text-amber-300' },
              { label: 'Models', value: `${stats.totalModels}+`, color: 'text-purple-300' },
              { label: 'Active', value: stats.activeIntegrations, color: 'text-emerald-300' },
              { label: 'Capabilities', value: stats.capabilities, color: 'text-cyan-300' },
              { label: 'Open Source', value: stats.openSourceProviders, color: 'text-green-300' },
              { label: 'Regions', value: stats.regions.length, color: 'text-rose-300' },
            ].map((stat) => (
              <div key={stat.label} className="glass-card rounded-xl p-4 text-center">
                <p className={`text-2xl md:text-3xl font-black ${stat.color}`}>{stat.value}</p>
                <p className="text-[10px] uppercase tracking-wider text-zinc-500 mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mx-auto max-w-7xl px-6 mb-8">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="flex flex-wrap gap-2">
            {tiers.map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={`rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
                  filter === t
                    ? 'bg-gradient-to-r from-purple-600 to-amber-600 text-white shadow-lg shadow-purple-500/20'
                    : 'border border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                }`}
              >
                {t === 'all' ? 'All' : TIER_CONFIG[t].label}
                {t !== 'all' && (
                  <span className="ml-1.5 text-[10px] opacity-70">
                    ({AI_MODEL_PROVIDERS.filter((p) => p.tier === t).length})
                  </span>
                )}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search models, providers, capabilities..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-72 rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500 transition"
          />
        </div>
      </div>

      {/* Provider Grid */}
      <div className="mx-auto max-w-7xl px-6 pb-12">
        {filter !== 'all' && (
          <div className="mb-6">
            <p className="text-sm text-zinc-400">{TIER_CONFIG[filter].description}</p>
          </div>
        )}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-16">
            <p className="text-zinc-500 text-lg">No providers match your search.</p>
          </div>
        )}
      </div>

      {/* On-Device AI & Privacy Section */}
      <div className="mx-auto max-w-7xl px-6 pb-8">
        <div className="glass-card rounded-3xl p-8 md:p-12">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-emerald-400/80 mb-2">Privacy-First Intelligence</p>
              <h2 className="text-2xl md:text-3xl font-black phoenix-title mb-4">
                Cloud, Edge, or On-Device
              </h2>
              <p className="text-zinc-400 leading-relaxed mb-4">
                Apple&apos;s Foundation Models framework brings free, on-device AI to iOS 26 — and FreedomForge is ready. With Ollama for local inference
                and edge-optimized models, your sensitive financial data never has to leave your device.
              </p>
              <ul className="space-y-3 text-sm text-zinc-300">
                {[
                  'Ollama local inference — zero cloud dependency for sensitive queries',
                  'Apple Foundation Models compatible for on-device iOS intelligence',
                  'Edge models via NVIDIA NIM and Cerebras for ultra-low latency',
                  'Automatic routing: cloud for power, local for privacy',
                  'Cost-aware budgeting — $0.012 to $0.028 per query at cloud tier',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-0.5 h-2 w-2 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { mode: 'Cloud AI', desc: '13+ providers, frontier reasoning', icon: 'C', color: 'border-purple-500/30' },
                { mode: 'Local AI', desc: 'Ollama, zero data egress', icon: 'L', color: 'border-emerald-500/30' },
                { mode: 'Edge AI', desc: 'NVIDIA NIM, Cerebras, Groq', icon: 'E', color: 'border-cyan-500/30' },
                { mode: 'On-Device', desc: 'Apple Foundation Models ready', icon: 'D', color: 'border-amber-500/30' },
              ].map((m) => (
                <div key={m.mode} className={`rounded-xl border ${m.color} bg-black/30 p-4 text-center`}>
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600/50 to-amber-600/50 text-sm font-black text-white mx-auto mb-2">
                    {m.icon}
                  </span>
                  <p className="text-sm font-bold text-zinc-200">{m.mode}</p>
                  <p className="text-[10px] text-zinc-500 mt-1">{m.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="mx-auto max-w-7xl px-6 pb-16">
        <div className="glass-card rounded-3xl p-8 md:p-12 text-center gold-accent-top">
          <h2 className="text-3xl md:text-4xl font-black phoenix-title mb-4">
            Ready to Harness Every AI?
          </h2>
          <p className="text-zinc-300 max-w-2xl mx-auto mb-8 leading-relaxed">
            FreedomForge Max automatically routes your queries to the best model for the job.
            Multi-model consensus, automatic failover, and cost optimization — all built in.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/"
              className="btn-empire inline-block rounded-xl px-8 py-4 text-center"
            >
              Launch Command Interface
            </Link>
            <Link
              href="/dashboard"
              className="inline-block rounded-xl border border-zinc-700 px-8 py-4 text-center text-sm font-bold text-zinc-300 hover:border-purple-500 hover:text-white transition"
            >
              View Dashboard
            </Link>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-zinc-900 py-8">
        <div className="mx-auto max-w-7xl px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-zinc-600">
          <p>FreedomForge Max — Autonomous Intelligence Stack</p>
          <div className="flex gap-6">
            <Link href="/" className="hover:text-zinc-400 transition">Home</Link>
            <Link href="/ai-models" className="hover:text-zinc-400 transition">AI Models</Link>
            <Link href="/dashboard" className="hover:text-zinc-400 transition">Dashboard</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
