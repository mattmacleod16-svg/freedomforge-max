'use client';

import React from 'react';
import Link from 'next/link';
import InstallPrompt from './components/InstallPrompt';
import ShareWidget from './components/ShareWidget';

export default function Home() {
  const [transcript, setTranscript] = React.useState('');
  const [response, setResponse] = React.useState('');
  const [textInput, setTextInput] = React.useState('');
  const [history, setHistory] = React.useState<Array<{role: string; text: string; ts: number}>>([]);

  // Load conversation history from localStorage on mount
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('ff_chat_history');
      if (saved) setHistory(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  // Save history to localStorage whenever it changes
  React.useEffect(() => {
    if (history.length > 0) {
      try { localStorage.setItem('ff_chat_history', JSON.stringify(history.slice(-50))); } catch { /* ignore */ }
    }
  }, [history]);

  // Shared function that processes any input (voice or text)
  const processInput = async (text: string) => {
    setTranscript(text);
    setResponse('…loading');
    setHistory((h) => [...h, { role: 'user', text, ts: Date.now() }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      const reply = data.reply || 'No answer';
      setResponse(reply);
      setHistory((h) => [...h, { role: 'assistant', text: reply, ts: Date.now() }]);
    } catch (err) {
      setResponse('Error contacting Max');
      setHistory((h) => [...h, { role: 'assistant', text: 'Error contacting Max', ts: Date.now() }]);
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
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
              <Link href="/ai-models" className="rounded-full border border-purple-500/30 px-3 py-1 text-purple-300 hover:bg-purple-500/10 transition">
                AI Models
              </Link>
              <Link href="/intelligence" className="rounded-full border border-cyan-500/30 px-3 py-1 text-cyan-300 hover:bg-cyan-500/10 transition">
                Intelligence
              </Link>
              <Link href="/token" className="rounded-full border border-amber-500/30 px-3 py-1 text-amber-300 hover:bg-amber-500/10 transition">
                $FORGE Token
              </Link>
              <Link href="/cipher-lab" className="rounded-full border border-emerald-500/30 px-3 py-1 text-emerald-300 hover:bg-emerald-500/10 transition">
                Cipher Lab
              </Link>
              <Link href="/vault" className="rounded-full border border-pink-500/30 px-3 py-1 text-pink-300 hover:bg-pink-500/10 transition">
                Vault
              </Link>
              <Link href="/life" className="rounded-full border border-emerald-500/30 px-3 py-1 text-emerald-300 hover:bg-emerald-500/10 transition">
                Life
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

            <div className="mt-6 space-y-3 rounded-2xl border border-zinc-800 bg-black/30 p-4 max-h-96 overflow-y-auto">
              {history.length === 0 && !transcript && (
                <p className="text-center text-xs text-zinc-600 py-8">Your conversation will appear here. Ask MAX anything.</p>
              )}
              {history.slice(-20).map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                    msg.role === 'user'
                      ? 'bg-orange-500/15 border border-orange-500/20 text-orange-200'
                      : 'bg-zinc-800/50 border border-zinc-700/50 text-zinc-100'
                  }`}>
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                    <p className="mt-1 text-[10px] text-zinc-600">{new Date(msg.ts).toLocaleTimeString()}</p>
                  </div>
                </div>
              ))}
              {response === '…loading' && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-zinc-800/50 border border-zinc-700/50 px-4 py-2.5 text-sm text-zinc-400">
                    <span className="animate-pulse">Thinking...</span>
                  </div>
                </div>
              )}
            </div>
            {history.length > 0 && (
              <div className="mt-2 flex justify-between items-center">
                <p className="text-[10px] text-zinc-600">{history.length} messages</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const md = history.map((m) => `**${m.role === 'user' ? 'You' : 'MAX'}:** ${m.text}`).join('\n\n');
                      navigator.clipboard?.writeText(md);
                    }}
                    className="text-[10px] text-zinc-500 hover:text-white transition"
                  >
                    📋 Copy
                  </button>
                  <button
                    onClick={() => { setHistory([]); setTranscript(''); setResponse(''); localStorage.removeItem('ff_chat_history'); }}
                    className="text-[10px] text-zinc-500 hover:text-red-400 transition"
                  >
                    🗑 Clear
                  </button>
                </div>
              </div>
            )}
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

        {/* Use Cases — Inspired by App Store "Make AI Your Study Buddy" & "26 Apps for 2026" */}
        <section className="glass-card rounded-3xl p-6 md:p-8">
          <div className="text-center mb-8">
            <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80 mb-2">Built for Everyone</p>
            <h2 className="text-3xl md:text-4xl font-black phoenix-title">
              Your AI Command Center
            </h2>
            <p className="mt-3 text-zinc-400 max-w-2xl mx-auto">
              From casual investors to power traders — FreedomForge adapts to you. Like the top-rated AI apps on the App Store, we make complex intelligence accessible.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: 'Smart Portfolio Planning',
                desc: 'Ask FreedomForge to build a personalized investment plan — like Tiimo turns chaos into a calming timeline, we turn market noise into actionable strategy.',
                icon: 'P',
                prompt: '"Build me a diversified crypto portfolio for Q2 2026"',
              },
              {
                title: 'AI-Powered Research',
                desc: 'Multi-model consensus means answers verified across Claude, GPT-4, Gemini, and Grok simultaneously — no single point of AI failure.',
                icon: 'R',
                prompt: '"Compare ETH vs SOL yield opportunities right now"',
              },
              {
                title: 'Real-Time Alerts',
                desc: 'Geopolitical risk monitoring, market anomaly detection, and prediction market signals — delivered before you need to ask.',
                icon: 'A',
                prompt: '"Alert me when BTC drops below its 200-day moving average"',
              },
              {
                title: 'On-Chain Execution',
                desc: 'From balance checks to automated distributions — blockchain operations without touching a command line or block explorer.',
                icon: 'B',
                prompt: '"Check my wallet balance and suggest gas-optimal timing"',
              },
              {
                title: 'Learning & Forecasting',
                desc: 'Continuous learning loops update models every 30 minutes. Multi-horizon forecasts at 6h, 24h, and 72h with Brier-calibrated accuracy.',
                icon: 'L',
                prompt: '"What\'s the 72-hour forecast for prediction market outcomes?"',
              },
              {
                title: 'Privacy-First Design',
                desc: 'Local inference via Ollama, on-device processing options, and zero cloud dependency when you need it. Your data stays yours.',
                icon: 'D',
                prompt: '"Run this analysis locally without sending data to the cloud"',
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
                <p className="mt-3 text-xs text-purple-300/80 italic border-l-2 border-purple-500/30 pl-3">{feat.prompt}</p>
              </div>
            ))}
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

        {/* AI Market Wave — Mass Adoption Context */}
        <section className="glass-card rounded-3xl p-6 md:p-8 gold-accent-top">
          <div className="text-center mb-8">
            <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80 mb-2">The AI App Revolution</p>
            <h2 className="text-3xl md:text-4xl font-black phoenix-title">
              Ride the $10B+ Wave
            </h2>
            <p className="mt-3 text-zinc-400 max-w-2xl mx-auto">
              Gen AI apps generated $5B in consumer spending in 2025 — tripling year-over-year. In 2026, that number is projected to exceed $10B. FreedomForge Max puts you at the center of this revolution.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { value: '$5B+', label: '2025 AI App Revenue', sub: '3x YoY growth' },
              { value: '3.8B', label: 'AI App Downloads', sub: '2x over 2024' },
              { value: '48B hrs', label: 'Time in AI Apps', sub: '3.6x vs 2024' },
              { value: '$10B+', label: '2026 Forecast', sub: 'Consumer spending' },
            ].map((m) => (
              <div key={m.label} className="rounded-2xl border border-zinc-800 bg-black/30 p-4 text-center">
                <p className="text-2xl md:text-3xl font-black neon-text-gold">{m.value}</p>
                <p className="text-xs font-semibold text-zinc-300 mt-1">{m.label}</p>
                <p className="text-[10px] text-zinc-500">{m.sub}</p>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-zinc-500">
            Source: Sensor Tower State of AI Apps 2025, Appfigures, Wall Street Journal
          </p>
        </section>

        {/* iOS & Cross-Platform Availability */}
        <section className="glass-card rounded-3xl p-6 md:p-8">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80 mb-2">Available Everywhere</p>
              <h2 className="text-2xl md:text-3xl font-black phoenix-title mb-4">
                Web. iOS. Desktop.
              </h2>
              <p className="text-zinc-400 leading-relaxed mb-4">
                Like the best apps featured in Apple&apos;s &ldquo;26 Apps for 2026&rdquo; collection, FreedomForge Max is built for the platforms you already use. Native iOS app via Capacitor, responsive web, and full API access.
              </p>
              <ul className="space-y-3 text-sm text-zinc-300">
                {[
                  'iOS native app with push notifications and Apple Watch readiness',
                  'Progressive web app — works offline with local AI inference',
                  'Apple Foundation Models compatible for on-device privacy',
                  'API-first architecture for custom integrations',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-0.5 h-2 w-2 rounded-full bg-gradient-to-r from-purple-500 to-amber-500 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { platform: 'iPhone', status: 'Available', color: 'border-emerald-500/30 text-emerald-300' },
                { platform: 'Web App', status: 'Live', color: 'border-emerald-500/30 text-emerald-300' },
                { platform: 'iPad', status: 'Compatible', color: 'border-blue-500/30 text-blue-300' },
                { platform: 'Apple Watch', status: 'Planned', color: 'border-amber-500/30 text-amber-300' },
              ].map((p) => (
                <div key={p.platform} className={`rounded-xl border ${p.color} bg-black/30 p-4 text-center`}>
                  <p className="text-lg font-bold">{p.platform}</p>
                  <p className="text-[10px] text-zinc-500 mt-1">{p.status}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-zinc-900 pt-6 pb-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-zinc-600">
            <p>FreedomForge Max — Autonomous Intelligence Stack</p>
            <nav className="flex flex-wrap gap-4 md:gap-6">
              <Link href="/" className="hover:text-zinc-400 transition">Home</Link>
              <Link href="/ai-models" className="hover:text-zinc-400 transition">AI Models</Link>
              <Link href="/intelligence" className="hover:text-zinc-400 transition">Intelligence</Link>
              <Link href="/token" className="hover:text-zinc-400 transition">$FORGE</Link>
              <Link href="/dashboard" className="hover:text-zinc-400 transition">Dashboard</Link>
              <Link href="/cipher-lab" className="hover:text-zinc-400 transition">Cipher Lab</Link>
              <Link href="/vault" className="hover:text-zinc-400 transition">Vault</Link>
              <Link href="/life" className="hover:text-zinc-400 transition">Life</Link>
            </nav>
          </div>
        </footer>
      </div>

      <InstallPrompt />
      <ShareWidget />
    </div>
  );
}