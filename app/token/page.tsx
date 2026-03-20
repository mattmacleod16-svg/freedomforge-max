'use client';

import React from 'react';
import Link from 'next/link';

const TOTAL_SUPPLY = '1,000,000,000';
const SYMBOL = '$FORGE';

const ALLOCATIONS = [
  { name: 'Community & Ecosystem', pct: 40, tokens: '400M', color: 'bg-amber-500', description: 'Airdrops, rewards, knowledge contributors' },
  { name: 'Treasury & Operations', pct: 20, tokens: '200M', color: 'bg-purple-500', description: 'Trading operations, AI inference, growth' },
  { name: 'Team & Advisors', pct: 15, tokens: '150M', color: 'bg-blue-500', description: '12-month cliff, 24-month vesting' },
  { name: 'Liquidity Provision', pct: 10, tokens: '100M', color: 'bg-emerald-500', description: 'Uniswap V3, Aerodrome DEX pools' },
  { name: 'Staking Rewards', pct: 10, tokens: '100M', color: 'bg-cyan-500', description: '48-month emission for stakers' },
  { name: 'Strategic Partners', pct: 5, tokens: '50M', color: 'bg-rose-500', description: 'Prediction markets, DeFi protocols' },
];

const STAKING_TIERS = [
  { tier: 'Bronze', stake: '1,000', models: '5-model consensus', queue: 'Standard', color: 'border-orange-700/40 text-orange-300' },
  { tier: 'Silver', stake: '10,000', models: '7-model consensus', queue: 'Priority', color: 'border-zinc-400/40 text-zinc-300' },
  { tier: 'Gold', stake: '100,000', models: '13+ model ensemble', queue: 'Dedicated', color: 'border-amber-400/40 text-amber-300' },
  { tier: 'Platinum', stake: '1,000,000', models: 'Max Intelligence', queue: 'Custom routing', color: 'border-purple-400/40 text-purple-300' },
];

const UTILITY_FEATURES = [
  {
    title: 'Premium AI Access',
    desc: 'Unlock frontier reasoning, max intelligence ensembles, and extended multi-model consensus with 13+ providers.',
    icon: 'AI',
  },
  {
    title: 'Revenue Sharing',
    desc: '20% of autonomous trading profits distributed weekly to $FORGE stakers — pro-rata by stake amount and duration.',
    icon: 'R$',
  },
  {
    title: 'Governance Voting',
    desc: 'Vote on model routing priorities, risk parameters, treasury allocation, and new chain integrations. 1 FORGE = 1 vote.',
    icon: 'GV',
  },
  {
    title: 'Knowledge Rewards',
    desc: 'Earn $FORGE by contributing quality documents to the knowledge base. Quality score multipliers from 0.5x to 3x.',
    icon: 'KB',
  },
  {
    title: 'Prediction Staking',
    desc: 'Stake on forecast outcomes. Brier-calibrated accuracy determines rewards — skin in the game for better predictions.',
    icon: 'PS',
  },
  {
    title: 'Deflationary Burns',
    desc: 'Query burns, accuracy burns, and quarterly treasury burns create long-term deflationary pressure on supply.',
    icon: 'DF',
  },
];

const CHAINS = [
  { name: 'Ethereum', status: 'Primary', phase: 'Launch' },
  { name: 'Base', status: 'Active', phase: 'Launch' },
  { name: 'Polygon', status: 'Planned', phase: 'Phase 2' },
  { name: 'Arbitrum', status: 'Planned', phase: 'Phase 2' },
  { name: 'Solana', status: 'Planned', phase: 'Phase 3' },
  { name: 'MultiversX', status: 'Planned', phase: 'Phase 3' },
];

export default function TokenPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[var(--bg-void)] via-[var(--bg-deep)] to-[var(--bg-void)] cyber-grid-bg">

      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-amber-900/10 via-transparent to-transparent" />
        <div className="mx-auto max-w-7xl px-6 pt-12 pb-16 relative">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition mb-8">
            &larr; Back to FreedomForge Max
          </Link>

          <div className="text-center mb-12">
            <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80 mb-3">Utility & Governance Token</p>
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tight phoenix-title">
              {SYMBOL}
            </h1>
            <p className="mt-2 text-2xl md:text-3xl font-bold text-zinc-300">FreedomForge</p>
            <p className="mt-6 text-lg md:text-xl text-zinc-400 max-w-3xl mx-auto leading-relaxed">
              The token powering the world&apos;s most comprehensive autonomous AI intelligence stack.
              Stake for premium access. Earn from trading profits. Govern the future of decentralized AI.
            </p>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
            {[
              { value: '1B', label: 'Max Supply', sub: 'Fixed, no mint' },
              { value: '40%', label: 'Community', sub: 'Largest allocation' },
              { value: '20%', label: 'Revenue Share', sub: 'Weekly to stakers' },
              { value: '6', label: 'Chains', sub: 'Multi-chain rollout' },
            ].map((m) => (
              <div key={m.label} className="glass-card rounded-xl p-4 text-center">
                <p className="text-3xl md:text-4xl font-black neon-text-gold">{m.value}</p>
                <p className="text-xs font-semibold text-zinc-300 mt-1">{m.label}</p>
                <p className="text-[10px] text-zinc-500">{m.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Token Allocation */}
      <section className="mx-auto max-w-7xl px-6 pb-12">
        <div className="glass-card rounded-3xl p-6 md:p-8 gold-accent-top">
          <div className="text-center mb-8">
            <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80 mb-2">Token Distribution</p>
            <h2 className="text-3xl md:text-4xl font-black phoenix-title">
              {TOTAL_SUPPLY} FORGE
            </h2>
            <p className="mt-2 text-zinc-400">Fixed supply. No inflation. Deflationary burns.</p>
          </div>

          {/* Allocation Bar */}
          <div className="flex rounded-xl overflow-hidden h-8 mb-6">
            {ALLOCATIONS.map((a) => (
              <div
                key={a.name}
                className={`${a.color} relative group`}
                style={{ width: `${a.pct}%` }}
                title={`${a.name}: ${a.pct}%`}
              >
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-black opacity-0 group-hover:opacity-100 transition">
                  {a.pct}%
                </span>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ALLOCATIONS.map((a) => (
              <div key={a.name} className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-black/30 p-4">
                <span className={`mt-1 h-3 w-3 rounded-full ${a.color} shrink-0`} />
                <div>
                  <p className="text-sm font-bold text-zinc-200">{a.name} — {a.pct}%</p>
                  <p className="text-xs text-zinc-500">{a.tokens} tokens</p>
                  <p className="text-xs text-zinc-400 mt-1">{a.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Utility */}
      <section className="mx-auto max-w-7xl px-6 pb-12">
        <div className="text-center mb-8">
          <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80 mb-2">Token Utility</p>
          <h2 className="text-3xl md:text-4xl font-black phoenix-title">
            Why Hold {SYMBOL}?
          </h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {UTILITY_FEATURES.map((feat) => (
            <div key={feat.title} className="glass-card rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-600 to-orange-600 text-xs font-black text-white">
                  {feat.icon}
                </span>
                <h3 className="text-base font-bold text-white">{feat.title}</h3>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">{feat.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Staking Tiers */}
      <section className="mx-auto max-w-7xl px-6 pb-12">
        <div className="glass-card rounded-3xl p-6 md:p-8">
          <div className="text-center mb-8">
            <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80 mb-2">Stake & Earn</p>
            <h2 className="text-3xl md:text-4xl font-black phoenix-title">
              Priority Routing Tiers
            </h2>
            <p className="mt-2 text-zinc-400">Stake $FORGE for premium AI access and weekly revenue share.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STAKING_TIERS.map((t) => (
              <div key={t.tier} className={`rounded-2xl border ${t.color} bg-black/30 p-5 text-center`}>
                <p className="text-lg font-black">{t.tier}</p>
                <p className="text-2xl font-black neon-text-gold mt-2">{t.stake}</p>
                <p className="text-[10px] uppercase tracking-wider text-zinc-500 mt-1">FORGE required</p>
                <div className="mt-4 space-y-2 text-xs text-zinc-400">
                  <p>{t.models}</p>
                  <p>{t.queue} queue</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Multi-Chain */}
      <section className="mx-auto max-w-7xl px-6 pb-12">
        <div className="glass-card rounded-3xl p-6 md:p-8">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80 mb-2">Multi-Chain Deployment</p>
              <h2 className="text-2xl md:text-3xl font-black phoenix-title mb-4">
                One Token. Every Chain.
              </h2>
              <p className="text-zinc-400 leading-relaxed mb-4">
                {SYMBOL} launches on Ethereum and Base, then expands to Polygon, Arbitrum, Solana, and MultiversX — matching FreedomForge&apos;s existing multi-chain trading infrastructure.
              </p>
              <ul className="space-y-2 text-sm text-zinc-300">
                <li className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  DEX liquidity on Uniswap V3 + Aerodrome
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Cross-chain bridges for seamless movement
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Native integration with existing distribution system
                </li>
              </ul>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {CHAINS.map((c) => (
                <div key={c.name} className={`rounded-xl border ${c.status === 'Primary' || c.status === 'Active' ? 'border-emerald-500/30 text-emerald-300' : 'border-zinc-700 text-zinc-400'} bg-black/30 p-3 text-center`}>
                  <p className="text-sm font-bold">{c.name}</p>
                  <p className="text-[10px] text-zinc-500">{c.status} — {c.phase}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Revenue Model */}
      <section className="mx-auto max-w-7xl px-6 pb-12">
        <div className="glass-card rounded-3xl p-6 md:p-8 gold-accent-top">
          <div className="text-center mb-8">
            <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80 mb-2">Sustainable Economics</p>
            <h2 className="text-3xl md:text-4xl font-black phoenix-title">Revenue Distribution</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { pct: '20%', label: 'Staker Rewards', sub: 'Weekly payouts', color: 'text-amber-300' },
              { pct: '30%', label: 'Treasury', sub: 'Operations & gas', color: 'text-purple-300' },
              { pct: '20%', label: 'Development', sub: 'Team & infra', color: 'text-blue-300' },
              { pct: '15%', label: 'Buyback & Burn', sub: 'Deflationary', color: 'text-rose-300' },
              { pct: '15%', label: 'Community', sub: 'Rewards pool', color: 'text-emerald-300' },
            ].map((r) => (
              <div key={r.label} className="rounded-xl border border-zinc-800 bg-black/30 p-4 text-center">
                <p className={`text-2xl font-black ${r.color}`}>{r.pct}</p>
                <p className="text-xs font-semibold text-zinc-300 mt-1">{r.label}</p>
                <p className="text-[10px] text-zinc-500">{r.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Smart Contract */}
      <section className="mx-auto max-w-7xl px-6 pb-12">
        <div className="glass-card rounded-3xl p-6 md:p-8">
          <div className="text-center mb-6">
            <p className="text-xs uppercase tracking-[0.3em] text-emerald-400/80 mb-2">Verified & Secure</p>
            <h2 className="text-2xl md:text-3xl font-black phoenix-title mb-4">
              Smart Contract Security
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { feature: 'Anti-Whale', detail: 'Max 1% supply per transfer' },
              { feature: 'Pausable', detail: 'Emergency freeze capability' },
              { feature: 'Reentrancy Guard', detail: 'Protected staking & vesting' },
              { feature: 'Fixed Supply', detail: 'No mint function post-deploy' },
              { feature: 'Vesting Cliffs', detail: 'Team locked 12 months' },
              { feature: 'Burn Function', detail: 'Permanent supply reduction' },
              { feature: 'Owner Controls', detail: 'Transparent admin functions' },
              { feature: 'Open Source', detail: 'Fully auditable Solidity' },
            ].map((s) => (
              <div key={s.feature} className="rounded-xl border border-zinc-800 bg-black/30 p-3">
                <p className="text-sm font-bold text-zinc-200">{s.feature}</p>
                <p className="text-[10px] text-zinc-500 mt-1">{s.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Ecosystem Partners */}
      <section className="mx-auto max-w-7xl px-6 pb-12">
        <div className="glass-card rounded-3xl p-6 md:p-8">
          <div className="text-center mb-8">
            <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80 mb-2">Growing Ecosystem</p>
            <h2 className="text-3xl md:text-4xl font-black phoenix-title">
              Partners & Integrations
            </h2>
            <p className="mt-2 text-zinc-400">$FORGE connects to the most powerful infrastructure in DeFi, AI, and DePIN.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[
              { name: 'Alchemy', status: 'Live', desc: 'Multi-chain RPC' },
              { name: 'Polymarket', status: 'Live', desc: 'Prediction markets' },
              { name: 'NVIDIA NIM', status: 'Live', desc: 'GPU inference' },
              { name: 'MultiversX', status: 'Live', desc: 'ESDT tokens' },
              { name: 'Helius', status: 'Building', desc: 'Solana RPC' },
              { name: 'World Liberty Fi', status: 'Research', desc: 'AgentPay SDK' },
              { name: 'Based.one', status: 'Research', desc: 'Prediction + Card' },
              { name: 'Aethir', status: 'Planned', desc: 'DePIN GPU compute' },
              { name: 'Akash Network', status: 'Planned', desc: 'Decentralized cloud' },
              { name: 'GEODNET', status: 'Research', desc: 'Geospatial DePIN' },
              { name: 'Render', status: 'Research', desc: 'Distributed GPU' },
              { name: 'ERC-8004', status: 'Research', desc: 'Agent identity' },
            ].map((p) => (
              <div key={p.name} className={`rounded-xl border ${p.status === 'Live' ? 'border-emerald-500/30' : p.status === 'Building' ? 'border-blue-500/30' : 'border-zinc-700'} bg-black/30 p-3 text-center`}>
                <p className="text-sm font-bold text-zinc-200">{p.name}</p>
                <p className="text-[10px] text-zinc-500">{p.desc}</p>
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[9px] font-bold ${p.status === 'Live' ? 'bg-emerald-500/20 text-emerald-400' : p.status === 'Building' ? 'bg-blue-500/20 text-blue-400' : p.status === 'Planned' ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-500/20 text-zinc-400'}`}>
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DeFAI Market Context */}
      <section className="mx-auto max-w-7xl px-6 pb-12">
        <div className="glass-card rounded-3xl p-6 md:p-8 gold-accent-top">
          <div className="text-center mb-6">
            <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80 mb-2">The DeFAI Revolution</p>
            <h2 className="text-2xl md:text-3xl font-black phoenix-title">$FORGE in the AI Agent Economy</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { value: '$15B+', label: 'AI Agent Market', sub: '2026 valuation' },
              { value: '46.3%', label: 'CAGR', sub: 'To $52B by 2030' },
              { value: '$650B', label: 'AI Infra Spend', sub: 'US tech in 2026' },
              { value: '$1T', label: 'AI Chip Market', sub: 'Projected (NVIDIA)' },
            ].map((m) => (
              <div key={m.label} className="rounded-2xl border border-zinc-800 bg-black/30 p-4 text-center">
                <p className="text-2xl font-black neon-text-gold">{m.value}</p>
                <p className="text-xs font-semibold text-zinc-300 mt-1">{m.label}</p>
                <p className="text-[10px] text-zinc-500">{m.sub}</p>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-zinc-500">
            Sources: MarketsandMarkets, Bridgewater Associates, NVIDIA GTC 2026, CoinMarketCap
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-6 pb-16">
        <div className="glass-card rounded-3xl p-8 md:p-12 text-center gold-accent-top">
          <h2 className="text-3xl md:text-4xl font-black phoenix-title mb-4">
            Join the FreedomForge Revolution
          </h2>
          <p className="text-zinc-300 max-w-2xl mx-auto mb-8 leading-relaxed">
            {SYMBOL} isn&apos;t just a token — it&apos;s your key to the most intelligent autonomous AI platform ever built.
            Stake, govern, earn, and shape the future of decentralized intelligence.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/"
              className="btn-empire inline-block rounded-xl px-8 py-4 text-center"
            >
              Launch FreedomForge Max
            </Link>
            <Link
              href="/ai-models"
              className="inline-block rounded-xl border border-zinc-700 px-8 py-4 text-center text-sm font-bold text-zinc-300 hover:border-amber-500 hover:text-white transition"
            >
              Explore AI Models
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-900 py-8">
        <div className="mx-auto max-w-7xl px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-zinc-600">
          <p>FreedomForge Max — Autonomous Intelligence Stack</p>
          <div className="flex gap-6">
            <Link href="/" className="hover:text-zinc-400 transition">Home</Link>
            <Link href="/ai-models" className="hover:text-zinc-400 transition">AI Models</Link>
            <Link href="/token" className="hover:text-zinc-400 transition">$FORGE Token</Link>
            <Link href="/dashboard" className="hover:text-zinc-400 transition">Dashboard</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
