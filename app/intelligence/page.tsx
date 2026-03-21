'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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
  const [collapsed, setCollapsed] = React.useState(true);

  React.useEffect(() => {
    fetch(endpoint, { credentials: 'include' })
      .then((r) => {
        if (r.status === 401) throw new Error('auth');
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [endpoint]);

  const statusDot = loading ? '⏳' : error ? (error === 'auth' ? '🔐' : '🛡️') : '🟢';

  function summarize(obj: Record<string, unknown>): string {
    const { status, ...rest } = obj;
    const keys = Object.keys(rest);
    if (keys.length === 0) return String(status || 'ok');
    const topKey = keys[0];
    const val = rest[topKey];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const entries = Object.entries(val as Record<string, unknown>).slice(0, 4);
      return entries.map(([k, v]) => {
        if (typeof v === 'number') return `${k}: ${v}`;
        if (typeof v === 'string') return `${k}: ${v.slice(0, 30)}`;
        if (Array.isArray(v)) return `${k}: ${v.length} items`;
        return `${k}: ✓`;
      }).join(' · ');
    }
    if (Array.isArray(val)) return `${val.length} items`;
    return String(val).slice(0, 60);
  }

  return (
    <div className={`rounded-2xl border ${color} bg-zinc-900/60 p-5 backdrop-blur transition hover:border-opacity-60`}>
      <button onClick={() => !loading && !error && setCollapsed((c) => !c)} className="w-full text-left">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">{icon}</span>
          <h3 className="text-lg font-bold text-white flex-1">{title}</h3>
          <span className="text-sm">{statusDot}</span>
        </div>
        {loading && <p className="text-zinc-500 text-sm animate-pulse">Connecting…</p>}
        {error === 'auth' && <p className="text-amber-400 text-sm">🔐 Login required</p>}
        {error && error !== 'auth' && <p className="text-zinc-500 text-sm">🛡️ Reconnecting…</p>}
        {data && collapsed && (
          <p className="text-xs text-zinc-400 truncate">{summarize(data)}</p>
        )}
      </button>
      {data && !collapsed && (
        <pre className="mt-3 text-xs text-zinc-300 overflow-auto max-h-64 rounded-xl bg-black/40 p-3">
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
  const router = useRouter();
  const [lastRefresh, setLastRefresh] = React.useState(new Date());
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [auth, setAuth] = React.useState<'checking' | 'yes' | 'no'>('checking');

  React.useEffect(() => {
    fetch('/api/auth/session', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setAuth(d?.authenticated ? 'yes' : 'no'))
      .catch(() => setAuth('no'));
  }, []);

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
              {auth === 'yes' && (
                <button
                  onClick={handleRefresh}
                  className="rounded-full border border-amber-500/30 px-4 py-2 text-amber-300 hover:bg-amber-500/10 transition font-medium"
                >
                  ↻ Refresh All
                </button>
              )}
              <Link href="/" className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-300 hover:bg-zinc-800 transition">
                ← Home
              </Link>
            </div>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Last refreshed: {lastRefresh.toLocaleTimeString()}
          </p>
        </header>

        {auth === 'checking' && (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-10 text-center">
            <p className="text-zinc-400 animate-pulse text-lg">Checking authentication…</p>
          </div>
        )}

        {auth === 'no' && (
          <div className="rounded-2xl border border-amber-500/30 bg-zinc-900/50 p-8 text-center space-y-4">
            <p className="text-3xl">🔐</p>
            <h2 className="text-xl font-bold text-white">Authentication Required</h2>
            <p className="text-zinc-400 max-w-md mx-auto">
              The Intelligence Dashboard requires a valid session. Sign in to access all {MODULES.length} engines.
            </p>
            <button
              onClick={() => router.push('/login?next=/intelligence')}
              className="rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 px-8 py-3 text-sm font-bold text-black transition hover:from-amber-400 hover:to-orange-500"
            >
              Sign In →
            </button>
          </div>
        )}

        {auth === 'yes' && (
          <div key={refreshKey} className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {MODULES.map((mod) => (
              <StatusCard key={mod.endpoint} {...mod} />
            ))}
          </div>
        )}

        <footer className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500 backdrop-blur">
          <p>FreedomForge Max — Intelligence Dashboard</p>
          <nav className="flex flex-wrap justify-center gap-4 md:gap-6 mt-3">
            <Link href="/" className="hover:text-zinc-300 transition">Home</Link>
            <Link href="/ai-models" className="hover:text-zinc-300 transition">AI Models</Link>
            <Link href="/intelligence" className="hover:text-zinc-300 transition">Intelligence</Link>
            <Link href="/trading" className="hover:text-zinc-300 transition">Trading</Link>
            <Link href="/token" className="hover:text-zinc-300 transition">$FORGE</Link>
            <Link href="/dashboard" className="hover:text-zinc-300 transition">Dashboard</Link>
            <Link href="/cipher-lab" className="hover:text-zinc-300 transition">Cipher Lab</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
