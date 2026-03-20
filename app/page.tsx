'use client';

import React from 'react';
import Link from 'next/link';

export default function Home() {
  const [transcript, setTranscript] = React.useState('');
  const [response, setResponse] = React.useState('');
  const [textInput, setTextInput] = React.useState('');

  // Shared function that processes any input (voice or text)
  const processInput = async (text: string) => {
    setTranscript(text);
    setResponse('…loading');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      const reply = data.reply || 'No answer';
      setResponse(reply);
    } catch (err) {
      setResponse('Error contacting Max');
    }

    setTextInput('');
  };

  // Alchemy helpers
  const [alchemyAddress, setAlchemyAddress] = React.useState('');
  const [alchemyInfo, setAlchemyInfo] = React.useState('');
  const [withAddress, setWithAddress] = React.useState('');
  const [withAmount, setWithAmount] = React.useState('');

  const fetchBalance = async () => {
    if (!alchemyAddress) return;
    const res = await fetch(`/api/alchemy/balance?address=${alchemyAddress}`);
    const data = await res.json();
    setAlchemyInfo(`Balance of ${alchemyAddress}: ${data.balance}`);
  };

  // Text mode - send on Enter or button click
  const handleTextSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (textInput.trim()) {
      processInput(textInput.trim());
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[var(--bg-void)] via-[var(--bg-deep)] to-[var(--bg-void)] cyber-grid-bg p-6 md:p-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="glass-card rounded-3xl p-6 md:p-8 gold-accent-top">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80">Autonomous Intelligence Stack</p>
              <h1 className="mt-2 text-4xl md:text-6xl font-black tracking-tight phoenix-title">FreedomForge Max</h1>
              <p className="mt-2 text-zinc-300 max-w-2xl">
                High-intelligence, risk-aware command interface for prediction, orchestration, and on-chain operations.
                Powered by <span className="text-amber-300 font-semibold">20+ AI providers</span> and <span className="text-purple-300 font-semibold">50+ models</span>.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-300">
              <Link href="/ai-models" className="rounded-full border border-purple-500/30 px-3 py-1 text-purple-300 hover:bg-purple-500/10 transition">
                AI Models
              </Link>
              <span className="rounded-full border border-zinc-700 px-3 py-1">Mode: Text</span>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2 rounded-3xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur">
            <h2 className="text-xl font-bold text-white">Agent Command</h2>
            <p className="mt-1 text-sm text-zinc-400">Send prompts and review live reasoning output.</p>

            <form onSubmit={handleTextSubmit} className="mt-5 flex flex-col gap-3 md:flex-row">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Ask for strategy, prediction, or execution guidance..."
                className="flex-1 rounded-2xl border border-zinc-700 bg-black/50 px-5 py-4 text-base text-white outline-none transition focus:border-orange-500"
              />
              <button
                type="submit"
                className="rounded-2xl bg-gradient-to-r from-orange-500 to-red-600 px-6 py-4 text-sm font-bold text-white transition hover:from-orange-600 hover:to-red-700"
              >
                SEND
              </button>
            </form>

            <div className="mt-6 space-y-4 rounded-2xl border border-zinc-800 bg-black/30 p-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-400">Transcript</p>
                <p className="mt-1 min-h-8 text-sm text-orange-300">{transcript ? `You: ${transcript}` : 'Waiting for command...'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-400">Agent Response</p>
                <p className="mt-1 min-h-20 whitespace-pre-wrap text-sm leading-relaxed text-zinc-100">
                  {response || 'No response yet.'}
                </p>
              </div>
            </div>
          </section>

          <aside className="rounded-3xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white">Blockchain Tools</h3>
              <p className="text-xs text-zinc-400">Quick wallet reads and controlled withdrawals.</p>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                placeholder="Ethereum address (0x...)"
                className="w-full rounded-xl border border-zinc-700 bg-black/50 p-3 text-sm text-white outline-none focus:border-sky-500"
                value={alchemyAddress}
                onChange={(e) => setAlchemyAddress(e.target.value)}
              />
              <button
                onClick={fetchBalance}
                className="w-full rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700"
              >
                Get Balance
              </button>
            </div>

            <div className="space-y-3 rounded-2xl border border-zinc-800 bg-black/30 p-4">
              <p className="text-sm font-semibold text-zinc-200">Revenue Wallet</p>
              <button
                onClick={async () => {
                  const res = await fetch('/api/alchemy/wallet');
                  const data = await res.json();
                  setAlchemyInfo(`Revenue wallet ${data.address} balance ${data.balance}`);
                }}
                className="w-full rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
              >
                Refresh Wallet Info
              </button>

              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Withdraw to address"
                  className="w-full rounded-xl border border-zinc-700 bg-black/50 p-3 text-sm text-white outline-none focus:border-orange-500"
                  value={withAddress}
                  onChange={(e) => setWithAddress(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="Amount ETH"
                  className="w-full rounded-xl border border-zinc-700 bg-black/50 p-3 text-sm text-white outline-none focus:border-orange-500"
                  value={withAmount}
                  onChange={(e) => setWithAmount(e.target.value)}
                />
              </div>

              <button
                onClick={async () => {
                  if (!withAddress || !withAmount) return;
                  const res = await fetch('/api/alchemy/wallet/withdraw', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ to: withAddress, amount: withAmount }),
                  });
                  const data = await res.json();
                  setAlchemyInfo(`Withdraw tx: ${data.txHash}`);
                }}
                className="w-full rounded-xl bg-orange-600 px-4 py-2 text-sm font-bold text-white hover:bg-orange-700"
              >
                Withdraw
              </button>
            </div>

            <div className="space-y-3">
              <Link
                href="/dashboard"
                className="block w-full rounded-xl bg-purple-600 px-4 py-3 text-center text-sm font-bold text-white hover:bg-purple-700"
              >
                Open Revenue Dashboard
              </Link>
              <a
                href="/api/alchemy/wallet/logs?limit=50"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-xl border border-zinc-700 px-4 py-3 text-center text-sm font-semibold text-zinc-200 hover:border-zinc-500"
              >
                View Recent Logs
              </a>
            </div>
          </aside>
        </div>

        {alchemyInfo && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-900/10 p-4 text-sm text-emerald-300">
            {alchemyInfo}
          </div>
        )}

        {/* AI Models Marketing Section */}
        <section className="glass-card rounded-3xl p-6 md:p-8 gold-accent-top">
          <div className="text-center mb-8">
            <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80 mb-2">Multi-Model Intelligence</p>
            <h2 className="text-3xl md:text-4xl font-black phoenix-title">
              20+ AI Providers. 50+ Models. One Stack.
            </h2>
            <p className="mt-3 text-zinc-400 max-w-2xl mx-auto">
              FreedomForge Max routes every query through the world&apos;s best AI models with automatic consensus, failover, and cost optimization.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
            {[
              { name: 'Claude', tier: 'Frontier', color: 'border-amber-500/30 text-amber-300' },
              { name: 'GPT-4o', tier: 'Frontier', color: 'border-green-500/30 text-green-300' },
              { name: 'Gemini', tier: 'Frontier', color: 'border-blue-500/30 text-blue-300' },
              { name: 'Grok', tier: 'Frontier', color: 'border-purple-500/30 text-purple-300' },
              { name: 'Llama', tier: 'Open Source', color: 'border-emerald-500/30 text-emerald-300' },
              { name: 'DeepSeek', tier: 'Open Source', color: 'border-cyan-500/30 text-cyan-300' },
              { name: 'Mistral', tier: 'Enterprise', color: 'border-violet-500/30 text-violet-300' },
              { name: 'Groq', tier: 'Ultra-Fast', color: 'border-orange-500/30 text-orange-300' },
              { name: 'Cohere', tier: 'Enterprise', color: 'border-rose-500/30 text-rose-300' },
              { name: 'Perplexity', tier: 'Search AI', color: 'border-sky-500/30 text-sky-300' },
              { name: 'NVIDIA NIM', tier: 'GPU', color: 'border-lime-500/30 text-lime-300' },
              { name: 'Ollama', tier: 'Local', color: 'border-pink-500/30 text-pink-300' },
            ].map((model) => (
              <div
                key={model.name}
                className={`rounded-xl border ${model.color} bg-black/30 p-3 text-center transition hover:scale-105`}
              >
                <p className="text-sm font-bold">{model.name}</p>
                <p className="text-[10px] text-zinc-500">{model.tier}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/ai-models"
              className="btn-empire inline-block rounded-xl px-8 py-4 text-center"
            >
              Explore All AI Models
            </Link>
            <Link
              href="/dashboard"
              className="inline-block rounded-xl border border-zinc-700 px-8 py-4 text-center text-sm font-bold text-zinc-300 hover:border-purple-500 hover:text-white transition"
            >
              View Live Dashboard
            </Link>
          </div>
        </section>

        {/* Feature Highlights for SEO / Marketing */}
        <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: 'Multi-Model Consensus',
              desc: 'Queries routed to multiple AI models simultaneously. Responses scored and synthesized for maximum accuracy.',
              icon: 'R',
            },
            {
              title: 'Autonomous Trading',
              desc: 'AI-driven prediction markets, spot trading, DeFi yield optimization, and arbitrage scanning — 24/7.',
              icon: 'T',
            },
            {
              title: 'On-Chain Operations',
              desc: 'Native blockchain integration with Ethereum, Polygon, and MultiversX for real-time wallet and smart contract operations.',
              icon: 'B',
            },
            {
              title: 'Risk-Aware Intelligence',
              desc: 'Circuit breakers, drawdown guards, position sizing, and anomaly detection protect every decision.',
              icon: 'S',
            },
            {
              title: 'Self-Healing Infrastructure',
              desc: 'Automatic failover, health monitoring, and self-repair keep the system running without human intervention.',
              icon: 'H',
            },
            {
              title: 'Global Reach',
              desc: 'Support for models from US, EU, China, and local inference — accessible from every region on Earth.',
              icon: 'G',
            },
          ].map((feat) => (
            <div key={feat.title} className="glass-card rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-amber-600 text-sm font-black text-white">
                  {feat.icon}
                </span>
                <h3 className="text-base font-bold text-white">{feat.title}</h3>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">{feat.desc}</p>
            </div>
          ))}
        </section>

        {/* Social Proof / Metrics Banner */}
        <section className="glass-card rounded-3xl p-6 md:p-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { value: '20+', label: 'AI Providers', sub: 'Integrated' },
              { value: '50+', label: 'Models', sub: 'Available' },
              { value: '24/7', label: 'Autonomous', sub: 'Operation' },
              { value: '< 2s', label: 'Response', sub: 'Latency' },
            ].map((m) => (
              <div key={m.label}>
                <p className="text-3xl md:text-4xl font-black neon-text-gold">{m.value}</p>
                <p className="text-sm font-semibold text-zinc-300 mt-1">{m.label}</p>
                <p className="text-xs text-zinc-500">{m.sub}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-zinc-900 pt-6 pb-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-zinc-600">
            <p>FreedomForge Max — Autonomous Intelligence Stack</p>
            <nav className="flex gap-6">
              <Link href="/" className="hover:text-zinc-400 transition">Home</Link>
              <Link href="/ai-models" className="hover:text-zinc-400 transition">AI Models</Link>
              <Link href="/dashboard" className="hover:text-zinc-400 transition">Dashboard</Link>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
}