'use client';

import React, { useState } from 'react';
import Link from 'next/link';

interface DiscoverItem {
  category: string;
  icon: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  timestamp: string;
}

interface ShoppingResult {
  name: string;
  price: string;
  rating: number;
  reviews: number;
  source: string;
  pros: string[];
  cons: string[];
}

const DISCOVER_FEEDS: DiscoverItem[] = [
  {
    category: 'Crypto', icon: '💰',
    title: 'Bitcoin ETF Inflows Hit Record $2.4B in Single Day',
    summary: 'Institutional adoption accelerates as spot Bitcoin ETFs see unprecedented inflows, signaling mainstream validation of crypto as an asset class.',
    source: 'CoinDesk', url: 'https://coindesk.com', timestamp: 'Today',
  },
  {
    category: 'AI', icon: '🧠',
    title: 'Open-Source AI Models Now Match GPT-4 on Most Benchmarks',
    summary: 'The gap between proprietary and open-source AI continues to narrow. Llama, Mistral, and DeepSeek models now compete head-to-head with closed models.',
    source: 'ArXiv', url: 'https://arxiv.org', timestamp: 'Today',
  },
  {
    category: 'DePIN', icon: '🌐',
    title: 'Decentralized Infrastructure Networks Reach $3B Total Value',
    summary: 'DePIN projects like Helium, Render, and Filecoin collectively surpass $3B in network value as real-world utility drives adoption.',
    source: 'Messari', url: 'https://messari.io', timestamp: 'Yesterday',
  },
  {
    category: 'Patents', icon: '📜',
    title: 'Quantum Computing Patents Surge 340% Since 2020',
    summary: 'IBM, Google, and Microsoft lead quantum patent filings. Key areas: error correction (US11574305B2), quantum-safe cryptography, and hybrid classical-quantum systems.',
    source: 'USPTO', url: 'https://patents.google.com', timestamp: 'This Week',
  },
  {
    category: 'Mining', icon: '⛏️',
    title: 'Next-Gen ASIC Miners Achieve 300 TH/s at 15 J/TH',
    summary: 'Bitmain and MicroBT race to ship sub-15 J/TH miners, making home mining profitable again even at $0.08/kWh electricity rates.',
    source: 'Mining News', url: 'https://bitcoinmagazine.com', timestamp: 'This Week',
  },
  {
    category: 'Congress', icon: '🏛️',
    title: 'Senators Push Bipartisan Stablecoin Regulation Framework',
    summary: 'New legislation would create federal framework for stablecoin issuers, requiring 1:1 reserves and regular audits. Industry reacts cautiously optimistic.',
    source: 'Reuters', url: 'https://reuters.com', timestamp: 'Yesterday',
  },
  {
    category: 'Health', icon: '🩺',
    title: 'AI Diagnostic Imaging Now FDA-Cleared for 15 Conditions',
    summary: 'Machine learning models can now detect lung nodules, retinal disease, cardiac anomalies, and bone fractures with radiologist-level accuracy. Key patents: US20200085382A1 (Arterys lesion detection).',
    source: 'FDA', url: 'https://fda.gov', timestamp: 'This Week',
  },
  {
    category: 'Quantum', icon: '⚛️',
    title: 'Qualifying Quantum Patents: The IP Landscape',
    summary: 'Key quantum patents to watch: IBM\'s error mitigation (US11574305B2), Google\'s quantum supremacy methods (US10552755B2), Microsoft\'s topological qubits (US20190164959A1), D-Wave\'s quantum annealing (US7135701B2).',
    source: 'Patent Analysis', url: 'https://patents.google.com', timestamp: 'Research',
  },
];

const CATEGORIES = ['All', 'Crypto', 'AI', 'DePIN', 'Patents', 'Mining', 'Congress', 'Health', 'Quantum'];

export default function DiscoverPage() {
  const [category, setCategory] = useState('All');
  const [shopQuery, setShopQuery] = useState('');
  const [shopResults, setShopResults] = useState<ShoppingResult[]>([]);
  const [tab, setTab] = useState<'discover' | 'shopping' | 'patents'>('discover');

  const filtered = category === 'All'
    ? DISCOVER_FEEDS
    : DISCOVER_FEEDS.filter(d => d.category === category);

  const handleShopSearch = () => {
    if (!shopQuery.trim()) return;
    const q = shopQuery.toLowerCase();
    const results: ShoppingResult[] = [];

    if (q.includes('miner') || q.includes('asic') || q.includes('mining')) {
      results.push(
        { name: 'Bitmain Antminer S21 Pro', price: '$5,499', rating: 4.7, reviews: 234, source: 'Bitmain Direct',
          pros: ['234 TH/s SHA-256', '15 J/TH efficiency', 'Latest gen chip'], cons: ['High upfront cost', 'Loud operation'] },
        { name: 'MicroBT Whatsminer M60S', price: '$4,899', rating: 4.5, reviews: 178, source: 'Coin Mining Central',
          pros: ['186 TH/s', 'Good efficiency', 'Reliable'], cons: ['Lower hashrate than S21', 'Heavy'] },
        { name: 'Bitmain Antminer L9', price: '$12,999', rating: 4.8, reviews: 89, source: 'Bitmain Direct',
          pros: ['16 GH/s Scrypt', 'Mine LTC+DOGE', 'Top efficiency'], cons: ['Premium price', 'Limited availability'] },
      );
    } else if (q.includes('gpu') || q.includes('nvidia') || q.includes('graphics')) {
      results.push(
        { name: 'NVIDIA RTX 5090', price: '$1,999', rating: 4.9, reviews: 1203, source: 'Best Buy',
          pros: ['32GB GDDR7', 'Best for AI/mining', '2x 4090 performance'], cons: ['Very expensive', 'Power hungry'] },
        { name: 'NVIDIA RTX 4090', price: '$1,599', rating: 4.8, reviews: 3456, source: 'Newegg',
          pros: ['24GB GDDR6X', 'Proven performer', 'Great for Render'], cons: ['Previous gen', 'High TDP'] },
      );
    } else if (q.includes('depin') || q.includes('black box') || q.includes('dawn')) {
      results.push(
        { name: 'DAWN Black Box (Founders Edition)', price: '$1,499', rating: 4.6, reviews: 67, source: 'shop.dawninternet.com',
          pros: ['13+ DePIN projects', 'Passive income', 'Plug and play'], cons: ['New product', 'ROI depends on rewards'] },
        { name: 'Helium Hotspot Miner', price: '$249', rating: 4.2, reviews: 890, source: 'Amazon',
          pros: ['Easy setup', 'IoT coverage mining', 'Low power'], cons: ['Rewards vary by location', 'Saturated areas'] },
      );
    } else if (q.includes('wallet') || q.includes('hardware') || q.includes('ledger') || q.includes('trezor')) {
      results.push(
        { name: 'Ledger Nano X', price: '$149', rating: 4.5, reviews: 5670, source: 'Ledger.com',
          pros: ['Bluetooth', '100+ chains', 'Trusted brand'], cons: ['Closed source firmware', 'Past data breach'] },
        { name: 'Trezor Safe 5', price: '$169', rating: 4.7, reviews: 2345, source: 'Trezor.io',
          pros: ['Open source', 'Touch screen', 'Color display'], cons: ['No Bluetooth', 'Fewer supported coins'] },
      );
    } else {
      results.push(
        { name: `Best ${shopQuery} - AI Analyzing...`, price: 'Searching', rating: 0, reviews: 0, source: 'FreedomForge AI',
          pros: ['Ask MAX for personalized recommendations', 'Real-time price comparison'], cons: ['Connect to chat for full analysis'] },
      );
    }
    setShopResults(results);
  };

  const QUANTUM_PATENTS = [
    { id: 'US11574305B2', title: 'Quantum Error Mitigation', assignee: 'IBM', year: 2023,
      desc: 'Methods for mitigating errors in quantum computations using probabilistic error cancellation and zero-noise extrapolation.' },
    { id: 'US10552755B2', title: 'Quantum Supremacy Verification', assignee: 'Google', year: 2020,
      desc: 'Techniques for verifying quantum computational advantage over classical systems using random circuit sampling.' },
    { id: 'US20190164959A1', title: 'Topological Qubit Architecture', assignee: 'Microsoft', year: 2019,
      desc: 'Topological quantum computing using Majorana zero modes for inherently error-protected qubits.' },
    { id: 'US7135701B2', title: 'Quantum Annealing Processor', assignee: 'D-Wave', year: 2006,
      desc: 'Adiabatic quantum computation using superconducting flux qubits for optimization problems.' },
    { id: 'US20200085382A1', title: 'AI Lesion Detection & Segmentation', assignee: 'Arterys', year: 2020,
      desc: 'Automated lesion detection using CNNs on MRI/CT scans with longitudinal tracking. Applicable to lung, liver, and brain imaging.' },
    { id: 'US11443206B2', title: 'Quantum-Safe Cryptographic Methods', assignee: 'IBM', year: 2022,
      desc: 'Post-quantum cryptography using lattice-based algorithms resistant to Shor\'s algorithm attacks.' },
    { id: 'US20230186133A1', title: 'Quantum Machine Learning Pipeline', assignee: 'Google', year: 2023,
      desc: 'Hybrid classical-quantum ML training using variational quantum circuits for feature extraction.' },
    { id: 'US11580434B2', title: 'Quantum Key Distribution Network', assignee: 'Toshiba', year: 2023,
      desc: 'Practical QKD implementation for secure communication over existing fiber optic infrastructure.' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#0a051e] to-[#030108] p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-400/80">Intelligence Feed</p>
            <h1 className="mt-1 text-3xl md:text-5xl font-black bg-gradient-to-r from-cyan-300 via-purple-300 to-pink-300 bg-clip-text text-transparent">
              Discover
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Curated intelligence, smart shopping, and patent research — all in one place.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <Link href="/" className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-400 hover:text-white transition">&larr; Home</Link>
            <Link href="/watchdog" className="rounded-full border border-red-500/30 px-3 py-1 text-red-300 hover:bg-red-500/10 transition">Watchdog</Link>
            <Link href="/life" className="rounded-full border border-emerald-500/30 px-3 py-1 text-emerald-300 hover:bg-emerald-500/10 transition">Life</Link>
          </div>
        </header>

        <div className="flex gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
          {([['discover', '🔭 Discover'], ['shopping', '🛍️ Smart Shopping'], ['patents', '📜 Patent Research']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${tab === id ? 'bg-cyan-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Discover Feed */}
        {tab === 'discover' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1">
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => setCategory(c)}
                  className={`rounded-full px-3 py-1 text-[10px] font-semibold transition ${
                    category === c ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-white'
                  }`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.map((item, i) => (
                <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 transition hover:border-cyan-500/30 hover:bg-cyan-950/5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xl">{item.icon}</span>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[9px] text-zinc-500">{item.category}</span>
                      <span className="text-[9px] text-zinc-600">{item.timestamp}</span>
                    </div>
                  </div>
                  <p className="text-sm font-bold text-white leading-snug">{item.title}</p>
                  <p className="text-xs text-zinc-500 mt-2 leading-relaxed">{item.summary}</p>
                  <p className="text-[10px] text-cyan-400/60 mt-2">Source: {item.source}</p>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Shopping */}
        {tab === 'shopping' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
              <h3 className="text-sm font-bold text-white mb-3">🛍️ AI-Powered Product Search</h3>
              <p className="text-xs text-zinc-500 mb-3">
                Search for mining hardware, DePIN devices, hardware wallets, GPUs, and more.
                FreedomForge compares prices, ratings, and gives you AI-powered pros/cons.
              </p>
              <div className="flex gap-2">
                <input
                  type="text" value={shopQuery}
                  onChange={(e) => setShopQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleShopSearch()}
                  placeholder="Search products (e.g., 'ASIC miner', 'hardware wallet', 'DAWN Black Box')..."
                  className="flex-1 rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-cyan-500"
                />
                <button onClick={handleShopSearch}
                  className="rounded-xl bg-cyan-600 px-6 py-3 text-sm font-bold text-white hover:bg-cyan-500 transition">
                  Search
                </button>
              </div>
            </div>

            {/* Quick Categories */}
            <div className="flex flex-wrap gap-2">
              {['ASIC Miners', 'GPU Mining', 'DePIN Hardware', 'Hardware Wallets'].map((q) => (
                <button key={q} onClick={() => { setShopQuery(q); setTimeout(handleShopSearch, 100); }}
                  className="rounded-full border border-zinc-700 px-3 py-1 text-[10px] text-zinc-400 hover:text-white hover:border-cyan-500/30 transition">
                  {q}
                </button>
              ))}
            </div>

            {shopResults.length > 0 && (
              <div className="space-y-3">
                {shopResults.map((r, i) => (
                  <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-bold text-white">{r.name}</p>
                        <p className="text-[10px] text-zinc-600 mt-0.5">via {r.source}</p>
                      </div>
                      <p className="text-lg font-black text-emerald-400">{r.price}</p>
                    </div>
                    {r.rating > 0 && (
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-amber-400">{'\u2605'.repeat(Math.round(r.rating))}</span>
                        <span className="text-[10px] text-zinc-500">{r.rating}/5 ({r.reviews.toLocaleString()} reviews)</span>
                      </div>
                    )}
                    <div className="grid sm:grid-cols-2 gap-3 mt-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-emerald-400/60 mb-1">Pros</p>
                        {r.pros.map((p, j) => (
                          <p key={j} className="text-xs text-zinc-400">\u2713 {p}</p>
                        ))}
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-red-400/60 mb-1">Cons</p>
                        {r.cons.map((c, j) => (
                          <p key={j} className="text-xs text-zinc-500">\u2717 {c}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Patents */}
        {tab === 'patents' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-purple-500/20 bg-purple-950/10 p-6">
              <p className="text-xs uppercase tracking-widest text-purple-400/60 mb-2">Patent Intelligence</p>
              <p className="text-lg font-bold text-white mb-2">Quantum-Qualifying Patents &amp; AI Diagnostics</p>
              <p className="text-sm text-zinc-400 leading-relaxed">
                FreedomForge tracks patents across quantum computing, AI diagnostics, and blockchain technology.
                These patents represent the cutting edge of technology that will shape the next decade.
              </p>
            </div>

            <div className="space-y-3">
              {QUANTUM_PATENTS.map((p) => (
                <a key={p.id} href={`https://patents.google.com/patent/${p.id}/en`}
                  target="_blank" rel="noopener noreferrer"
                  className="block rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 transition hover:border-purple-500/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-xs text-purple-400">{p.id}</span>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[9px] text-zinc-500">{p.assignee}</span>
                      <span className="text-[9px] text-zinc-600">{p.year}</span>
                    </div>
                  </div>
                  <p className="text-sm font-bold text-white">{p.title}</p>
                  <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{p.desc}</p>
                </a>
              ))}
            </div>
          </div>
        )}

        <footer className="border-t border-zinc-900 pt-6 pb-4 text-center">
          <p className="text-xs text-zinc-600">
            FreedomForge Discover &mdash; Intelligence, shopping, and research at your fingertips. 🔭
          </p>
        </footer>
      </div>
    </div>
  );
}
