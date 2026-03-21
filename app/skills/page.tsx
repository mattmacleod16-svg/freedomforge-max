'use client';

import React, { useState } from 'react';
import Link from 'next/link';

interface Skill {
  name: string;
  description: string;
  icon: string;
  level: 'active' | 'beta' | 'coming';
  category: string;
}

const SKILL_CATEGORIES = [
  { id: 'all', label: 'All Skills', icon: '⚡' },
  { id: 'financial', label: 'Financial Intelligence', icon: '💰' },
  { id: 'research', label: 'Deep Research', icon: '🔬' },
  { id: 'life', label: 'Life Automation', icon: '🏠' },
  { id: 'shopping', label: 'Smart Shopping', icon: '🛒' },
  { id: 'mining', label: 'Mining Operations', icon: '⛏️' },
  { id: 'security', label: 'Security & Privacy', icon: '🔒' },
  { id: 'social', label: 'Social Intelligence', icon: '📱' },
  { id: 'health', label: 'Health & Wellness', icon: '🏥' },
];

const SKILLS: Skill[] = [
  // Financial Intelligence
  { name: 'Congressional Trade Tracking', description: 'Monitor stock trades by US Congress members under the STOCK Act. Detect clustering patterns and insider-like movements before the market reacts.', icon: '🏛️', level: 'active', category: 'financial' },
  { name: 'Whale Wallet Monitoring', description: 'Track large crypto wallet movements across chains. Get alerts when whales accumulate, dump, or move assets to exchanges.', icon: '🐋', level: 'active', category: 'financial' },
  { name: 'Yield Optimization', description: 'Scan DeFi protocols for the best risk-adjusted yields. Auto-suggest rebalancing strategies across lending, staking, and LP positions.', icon: '📈', level: 'active', category: 'financial' },
  { name: 'Tax Loss Harvesting', description: 'Identify tax-loss harvesting opportunities across your crypto portfolio. Calculate wash sale implications and optimal harvest timing.', icon: '📋', level: 'beta', category: 'financial' },
  { name: 'Real-Time Portfolio Analytics', description: 'Unified view of all assets — crypto, stocks, real estate, mining rigs. Calculate true net worth with unrealized gains tracking.', icon: '💼', level: 'active', category: 'financial' },
  { name: 'Stock Earnings Analysis', description: 'AI-powered earnings analysis with peer comparisons, revenue estimates, and sentiment scoring from earnings calls.', icon: '📊', level: 'beta', category: 'financial' },

  // Deep Research
  { name: 'Patent Intelligence', description: 'Search and analyze patents across quantum computing, AI diagnostics, blockchain, and biotech. Track assignee portfolios and citation networks.', icon: '📜', level: 'active', category: 'research' },
  { name: 'Academic Paper Synthesis', description: 'Search ArXiv, PubMed, and Google Scholar. Synthesize findings across multiple papers into actionable summaries.', icon: '📚', level: 'beta', category: 'research' },
  { name: 'Market Report Generation', description: 'Generate comprehensive market reports on any industry or technology sector. Include TAM/SAM/SOM analysis and competitive landscapes.', icon: '📑', level: 'beta', category: 'research' },
  { name: 'Document Intelligence', description: 'Upload PDFs, spreadsheets, and docs. Ask questions across your entire document library with citation tracking.', icon: '📂', level: 'coming', category: 'research' },
  { name: 'Trend Detection', description: 'Scan social media, news, and on-chain data to detect emerging trends before they go mainstream. AI-scored momentum indicators.', icon: '🔮', level: 'active', category: 'research' },

  // Life Automation
  { name: 'Calendar Intelligence', description: 'Sync calendars and get AI-powered scheduling suggestions. Auto-block focus time, suggest meeting optimizations, and resolve conflicts.', icon: '📅', level: 'coming', category: 'life' },
  { name: 'Email Triage', description: 'AI processes your inbox: summarize unread emails, draft responses, flag urgent items, and auto-archive noise.', icon: '📧', level: 'coming', category: 'life' },
  { name: 'Travel Planning', description: 'Search flights, hotels, and activities with real-time pricing. Build complete itineraries optimized for budget, time, and preferences.', icon: '✈️', level: 'beta', category: 'life' },
  { name: 'Bill Management', description: 'Track recurring bills, detect price increases, and find better deals. Get alerts before due dates and negotiate on your behalf.', icon: '💳', level: 'coming', category: 'life' },
  { name: 'Legal Document Analysis', description: 'Upload contracts, leases, or terms of service. AI highlights important clauses, red flags, and suggests modifications.', icon: '⚖️', level: 'coming', category: 'life' },
  { name: 'Real Estate Scout', description: 'Search properties matching your criteria. Analyze neighborhoods, school ratings, crime data, and predict appreciation potential.', icon: '🏡', level: 'coming', category: 'life' },

  // Smart Shopping
  { name: 'Product Comparison', description: 'AI-powered product search with instant comparison of prices, ratings, and reviews across multiple retailers. Pros/cons analysis included.', icon: '🛍️', level: 'active', category: 'shopping' },
  { name: 'Price Drop Alerts', description: 'Track products and get notified when prices drop. Historical price charts and AI-predicted best time to buy.', icon: '🔔', level: 'beta', category: 'shopping' },
  { name: 'Mining Hardware Scout', description: 'Compare ASIC miners, GPUs, and DePIN hardware. Calculate ROI based on current difficulty, electricity costs, and coin prices.', icon: '🖥️', level: 'active', category: 'shopping' },
  { name: 'Coupon & Deal Finder', description: 'Automatically search for coupons, promo codes, and cashback offers before you purchase anything online.', icon: '🏷️', level: 'coming', category: 'shopping' },

  // Mining Operations
  { name: 'Multi-Algo Hash Monitor', description: 'Track hashrate across SHA-256, Scrypt, Ethash, KawPoW, and RandomX. Unified dashboard for all mining hardware.', icon: '⚙️', level: 'active', category: 'mining' },
  { name: 'Profitability Calculator', description: 'Real-time mining profitability with electricity costs, difficulty adjustments, and block reward changes factored in.', icon: '🧮', level: 'active', category: 'mining' },
  { name: 'Pool Optimization', description: 'Compare mining pools by fees, payout methods, uptime, and luck. Auto-suggest optimal pool switching strategies.', icon: '🏊', level: 'beta', category: 'mining' },
  { name: 'Hardware Health Monitor', description: 'Track temperature, fan speed, power draw, and error rates across all mining rigs. Predictive maintenance alerts.', icon: '🌡️', level: 'active', category: 'mining' },
  { name: 'DePIN Network Validator', description: 'Monitor bandwidth, compute, and storage contributions to DePIN networks (Helium, Render, Filecoin, DAWN). Track rewards and uptime.', icon: '🌐', level: 'beta', category: 'mining' },

  // Security & Privacy
  { name: 'Wallet Security Audit', description: 'Scan connected wallets for approval risks, suspicious contracts, and vulnerable tokens. Revoke dangerous approvals in one click.', icon: '🛡️', level: 'active', category: 'security' },
  { name: 'Privacy Score', description: 'Analyze your on-chain footprint and calculate a privacy score. Suggest mixing, bridging, and privacy-preserving strategies.', icon: '🕵️', level: 'beta', category: 'security' },
  { name: 'Phishing Detection', description: 'Real-time scanning of URLs, smart contracts, and messages for phishing attempts. AI-trained on known scam patterns.', icon: '🎣', level: 'active', category: 'security' },
  { name: 'Sovereign Identity', description: 'Manage your decentralized identity across chains. Proof of Humanity, DID verification, and reputation scoring.', icon: '🆔', level: 'beta', category: 'security' },

  // Social Intelligence
  { name: 'Social Media Analytics', description: 'Track engagement, follower growth, and content performance across X/Twitter, Instagram, and other platforms.', icon: '📊', level: 'beta', category: 'social' },
  { name: 'Content Strategy AI', description: 'Generate content calendars, post suggestions, and optimal timing recommendations based on audience analysis.', icon: '✍️', level: 'coming', category: 'social' },
  { name: 'Community Management', description: 'Monitor community sentiment, flag issues, auto-moderate, and generate engagement reports for Discord/Telegram.', icon: '👥', level: 'coming', category: 'social' },
  { name: 'Influencer Discovery', description: 'Find and analyze influencers in any niche. Track authenticity scores, engagement rates, and audience demographics.', icon: '⭐', level: 'coming', category: 'social' },

  // Health & Wellness
  { name: 'Health Data Integration', description: 'Connect wearables and health apps. Unified dashboard for sleep, exercise, heart rate, and nutrition data.', icon: '❤️', level: 'coming', category: 'health' },
  { name: 'AI Symptom Checker', description: 'Describe symptoms and get AI-powered analysis with possible conditions, severity assessment, and care recommendations.', icon: '🩺', level: 'coming', category: 'health' },
  { name: 'Nutrition Optimizer', description: 'Track meals and get AI suggestions for optimal nutrition. Macro/micro tracking with personalized recommendations.', icon: '🥗', level: 'coming', category: 'health' },
  { name: 'Diagnostic Imaging Intelligence', description: 'AI analysis of medical imaging using CNN-based lesion detection (inspired by patents like US20200085382A1). Track changes over time.', icon: '🔬', level: 'coming', category: 'health' },
];

const LEVEL_STYLES = {
  active: { bg: 'bg-emerald-500/10 border-emerald-500/30', text: 'text-emerald-400', label: '● Active' },
  beta: { bg: 'bg-amber-500/10 border-amber-500/30', text: 'text-amber-400', label: '◐ Beta' },
  coming: { bg: 'bg-zinc-500/10 border-zinc-500/30', text: 'text-zinc-500', label: '○ Coming' },
};

export default function SkillsPage() {
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = SKILLS.filter((s) => {
    const matchCat = category === 'all' || s.category === category;
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.description.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const counts = {
    active: SKILLS.filter(s => s.level === 'active').length,
    beta: SKILLS.filter(s => s.level === 'beta').length,
    coming: SKILLS.filter(s => s.level === 'coming').length,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#0a051e] to-[#030108] p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-purple-400/80">Autonomous Intelligence</p>
            <h1 className="mt-1 text-3xl md:text-5xl font-black bg-gradient-to-r from-purple-300 via-cyan-300 to-emerald-300 bg-clip-text text-transparent">
              AI Skills
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {SKILLS.length} autonomous capabilities. FreedomForge handles your past &amp; future so you live in the present.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <Link href="/" className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-400 hover:text-white transition">&larr; Home</Link>
            <Link href="/discover" className="rounded-full border border-blue-500/30 px-3 py-1 text-blue-300 hover:bg-blue-500/10 transition">Discover</Link>
            <Link href="/watchdog" className="rounded-full border border-red-500/30 px-3 py-1 text-red-300 hover:bg-red-500/10 transition">Watchdog</Link>
            <Link href="/life" className="rounded-full border border-emerald-500/30 px-3 py-1 text-emerald-300 hover:bg-emerald-500/10 transition">Life</Link>
          </div>
        </header>

        {/* Stats Bar */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-4 text-center">
            <p className="text-2xl font-black text-emerald-400">{counts.active}</p>
            <p className="text-[10px] uppercase tracking-widest text-emerald-400/60">Active Skills</p>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4 text-center">
            <p className="text-2xl font-black text-amber-400">{counts.beta}</p>
            <p className="text-[10px] uppercase tracking-widest text-amber-400/60">Beta Skills</p>
          </div>
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/30 p-4 text-center">
            <p className="text-2xl font-black text-zinc-400">{counts.coming}</p>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Coming Soon</p>
          </div>
        </div>

        {/* Search */}
        <input
          type="text" value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills (e.g., 'mining', 'wallet', 'travel')..."
          className="w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-purple-500 transition"
        />

        {/* Category Filter */}
        <div className="flex flex-wrap gap-1">
          {SKILL_CATEGORIES.map((cat) => (
            <button key={cat.id} onClick={() => setCategory(cat.id)}
              className={`rounded-full px-3 py-1.5 text-[10px] font-semibold transition ${
                category === cat.id
                  ? 'bg-purple-600 text-white'
                  : 'bg-zinc-800/50 text-zinc-500 hover:text-white hover:bg-zinc-800'
              }`}>
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>

        {/* Skills Grid */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((skill, i) => {
            const style = LEVEL_STYLES[skill.level];
            return (
              <div key={i} className={`rounded-2xl border p-5 transition hover:scale-[1.01] ${style.bg}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-2xl">{skill.icon}</span>
                  <span className={`text-[9px] font-bold uppercase tracking-widest ${style.text}`}>
                    {style.label}
                  </span>
                </div>
                <p className="text-sm font-bold text-white leading-snug">{skill.name}</p>
                <p className="text-xs text-zinc-500 mt-2 leading-relaxed">{skill.description}</p>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <p className="text-zinc-600 text-sm">No skills match your search. Try a different keyword.</p>
          </div>
        )}

        {/* Model Council */}
        <div className="rounded-2xl border border-purple-500/20 bg-purple-950/10 p-6">
          <p className="text-xs uppercase tracking-widest text-purple-400/60 mb-2">Model Council</p>
          <p className="text-lg font-bold text-white mb-2">Multi-Model Intelligence</p>
          <p className="text-sm text-zinc-400 leading-relaxed mb-4">
            FreedomForge doesn&apos;t rely on a single AI. The Model Council compares outputs from multiple
            language models simultaneously — getting you the best answer from GPT, Claude, Gemini, Llama,
            and more. Each skill automatically selects the optimal model for the task.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {['GPT-5', 'Claude 4', 'Gemini 3', 'Llama 4', 'Mistral', 'DeepSeek', 'Sonar', 'Custom'].map((model) => (
              <div key={model} className="rounded-xl border border-zinc-800 bg-black/30 p-3 text-center">
                <p className="text-xs font-bold text-purple-300">{model}</p>
                <p className="text-[9px] text-zinc-600 mt-0.5">Available</p>
              </div>
            ))}
          </div>
        </div>

        {/* Automation Philosophy */}
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-950/10 p-6 text-center">
          <p className="text-3xl mb-3">🧘</p>
          <p className="text-lg font-bold text-white mb-2">
            &ldquo;Handle the past &amp; future. Live in the present.&rdquo;
          </p>
          <p className="text-sm text-zinc-400 max-w-xl mx-auto leading-relaxed">
            Every skill is designed with one purpose: free you from tasks that steal your present moment.
            FreedomForge watches your back — monitoring markets, tracking threats, managing paperwork,
            and optimizing your wealth — so you can focus on being human.
          </p>
        </div>

        <footer className="border-t border-zinc-900 pt-6 pb-4 text-center">
          <p className="text-xs text-zinc-600">
            FreedomForge AI Skills &mdash; {SKILLS.length} autonomous capabilities and growing. 🤖
          </p>
        </footer>
      </div>
    </div>
  );
}
