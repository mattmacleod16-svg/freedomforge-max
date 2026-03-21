'use client';

import React from 'react';
import Link from 'next/link';

type StatusCardProps = {
  title: string;
  endpoint: string;
  icon: string;
  color: string;
};

function StatusCard({ title, endpoint, icon, color }: StatusCardProps) {
  const [data, setData] = React.useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    fetch(endpoint)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [endpoint]);

  return (
    <div className={`rounded-2xl border ${color} bg-zinc-900/60 p-5 backdrop-blur transition hover:scale-[1.01]`}>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-2xl">{icon}</span>
        <h3 className="text-lg font-bold text-white">{title}</h3>
      </div>
      {loading && <p className="text-zinc-500 text-sm animate-pulse">Loading…</p>}
      {error && <p className="text-red-400 text-sm">Error: {error}</p>}
      {data && (
        <pre className="text-xs text-zinc-300 overflow-auto max-h-48 rounded-xl bg-black/40 p-3">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

const MODULES: StatusCardProps[] = [
  { title: 'Risk Monitor', endpoint: '/api/status/risk', icon: '🛡️', color: 'border-red-500/30' },
  { title: 'Autonomy Director', endpoint: '/api/status/autonomy', icon: '🧠', color: 'border-purple-500/30' },
  { title: 'Ensemble Consensus', endpoint: '/api/status/ensemble', icon: '🔮', color: 'border-indigo-500/30' },
  { title: 'Memory Engine', endpoint: '/api/status/memory', icon: '💾', color: 'border-cyan-500/30' },
  { title: 'Skills Matrix', endpoint: '/api/status/skills', icon: '📊', color: 'border-emerald-500/30' },
  { title: 'Vendor Stack', endpoint: '/api/status/vendor-stack', icon: '🏗️', color: 'border-zinc-500/30' },
  { title: 'DeFi Yields', endpoint: '/api/status/defi-yields', icon: '💰', color: 'border-green-500/30' },
  { title: 'Protocols', endpoint: '/api/status/protocols', icon: '🔗', color: 'border-blue-500/30' },
  { title: 'Opportunities', endpoint: '/api/status/opportunities', icon: '🎯', color: 'border-amber-500/30' },
  { title: 'Agent Mesh', endpoint: '/api/status/agents', icon: '🤖', color: 'border-violet-500/30' },
  { title: 'DAO Treasury', endpoint: '/api/status/dao', icon: '🏛️', color: 'border-yellow-500/30' },
  { title: 'NFT Assets', endpoint: '/api/status/nft', icon: '🎨', color: 'border-pink-500/30' },
  { title: 'Growth Engine', endpoint: '/api/status/growth', icon: '🚀', color: 'border-teal-500/30' },
  { title: 'Partners', endpoint: '/api/status/partners', icon: '🤝', color: 'border-orange-500/30' },
  { title: 'Platforms', endpoint: '/api/status/platforms', icon: '📡', color: 'border-sky-500/30' },
  { title: 'Integrity', endpoint: '/api/status/integrity', icon: '🔒', color: 'border-slate-500/30' },
];

export default function IntelligenceDashboard() {
  const [lastRefresh, setLastRefresh] = React.useState(new Date());
  const [refreshKey, setRefreshKey] = React.useState(0);

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
    setLastRefresh(new Date());
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[var(--bg-void)] via-[var(--bg-deep)] to-[var(--bg-void)] p-6 md:p-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="glass-card rounded-3xl p-6 md:p-8 gold-accent-top">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80">Intelligence Overview</p>
              <h1 className="mt-2 text-4xl md:text-5xl font-black tracking-tight phoenix-title">Command Intelligence</h1>
              <p className="mt-2 text-zinc-300 max-w-2xl">
                Unified view of all {MODULES.length} intelligence engines — risk, autonomy, DeFi, DAO, NFT, protocols, and growth systems.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <button
                onClick={handleRefresh}
                className="rounded-full border border-amber-500/30 px-4 py-2 text-amber-300 hover:bg-amber-500/10 transition font-medium"
              >
                ↻ Refresh All
              </button>
              <Link href="/" className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-zinc-800 transition">
                ← Home
              </Link>
            </div>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Last refreshed: {lastRefresh.toLocaleTimeString()}
          </p>
        </header>

        <div key={refreshKey} className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {MODULES.map((mod) => (
            <StatusCard key={mod.endpoint} {...mod} />
          ))}
        </div>

        <footer className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500 backdrop-blur">
          <p>FreedomForge Max — Intelligence Dashboard</p>
          <nav className="flex justify-center gap-6 mt-3">
            <Link href="/" className="hover:text-zinc-300 transition">Home</Link>
            <Link href="/ai-models" className="hover:text-zinc-300 transition">AI Models</Link>
            <Link href="/token" className="hover:text-zinc-300 transition">$FORGE</Link>
            <Link href="/dashboard" className="hover:text-zinc-300 transition">Dashboard</Link>
            <Link href="/cipher-lab" className="hover:text-zinc-300 transition">Cipher Lab</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
