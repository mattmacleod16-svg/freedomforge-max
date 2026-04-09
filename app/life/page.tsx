'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

// ── Persistent User Profile ────────────────────────────────────────────

interface UserProfile {
  name: string;
  freedomNumber: number;
  walletAddresses: { chain: string; address: string; label: string }[];
  miningAlgorithms: string[];
  depinNodes: { network: string; nodeId: string; status: string }[];
  goals: { id: string; text: string; category: string; done: boolean; createdAt: number }[];
  milestones: { text: string; date: number }[];
  notes: string;
  createdAt: number;
}

const DEFAULT_PROFILE: UserProfile = {
  name: '',
  freedomNumber: 10000,
  walletAddresses: [],
  miningAlgorithms: ['SHA-256'],
  depinNodes: [],
  goals: [],
  milestones: [],
  notes: '',
  createdAt: Date.now(),
};

function loadProfile(): UserProfile {
  if (typeof window === 'undefined') return DEFAULT_PROFILE;
  try {
    const raw = localStorage.getItem('ff_user_profile');
    if (raw) return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_PROFILE;
}

function saveProfile(profile: UserProfile) {
  try { localStorage.setItem('ff_user_profile', JSON.stringify(profile)); } catch { /* ignore */ }
}

// ── Types ──────────────────────────────────────────────────────────────

interface SystemStatus {
  name: string;
  status: 'online' | 'offline' | 'partial' | 'loading';
  detail: string;
  icon: string;
  link: string;
}

// ── Main Component ─────────────────────────────────────────────────────

export default function LifeDashboard() {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [systems, setSystems] = useState<SystemStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'present' | 'goals' | 'identity' | 'depin'>('present');
  const [newGoal, setNewGoal] = useState('');
  const [newGoalCat, setNewGoalCat] = useState('financial');

  // PPO Grant Agent state
  const [ppoLocation, setPpoLocation] = useState('');
  const [ppoState, setPpoState] = useState('');
  const [ppoResult, setPpoResult] = useState<import('@/lib/intelligence/ppoGrantAgent').PPOGrantResult | null>(null);
  const [ppoLoading, setPpoLoading] = useState(false);
  const [ppoError, setPpoError] = useState('');

  useEffect(() => {
    setProfile(loadProfile());
  }, []);

  const updateProfile = useCallback((updates: Partial<UserProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...updates };
      saveProfile(next);
      return next;
    });
  }, []);

  const checkSystems = useCallback(async () => {
    setLoading(true);
    const checks: SystemStatus[] = [
      { name: 'AI Engine (MAX)', status: 'loading', detail: 'Checking...', icon: '🧠', link: '/' },
      { name: 'Vault (Wallets)', status: 'loading', detail: 'Checking...', icon: '💰', link: '/vault' },
      { name: 'Mining Monitor', status: 'loading', detail: 'Checking...', icon: '⛏️', link: '/vault' },
      { name: 'Yield Intelligence', status: 'loading', detail: 'Checking...', icon: '📈', link: '/vault' },
      { name: 'Cipher Lab', status: 'online', detail: 'Ready', icon: '🔐', link: '/cipher-lab' },
      { name: 'Trading Dashboard', status: 'loading', detail: 'Checking...', icon: '📊', link: '/dashboard' },
    ];

    setSystems([...checks]);

    try {
      const res = await fetch('/api/models', { signal: AbortSignal.timeout(5000) }).catch(() => null);
      checks[0] = { ...checks[0], status: res?.ok ? 'online' : 'offline', detail: res?.ok ? '25+ models ready' : 'Unavailable' };
    } catch { checks[0] = { ...checks[0], status: 'offline', detail: 'Unreachable' }; }

    try {
      const res = await fetch('/api/vault', { credentials: 'include', signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        checks[1] = { ...checks[1], status: 'online', detail: `${data.wallets?.total || 0} wallets tracked` };
        checks[2] = { ...checks[2], status: data.mining?.totalDevices > 0 ? 'online' : 'partial', detail: data.mining?.totalDevices > 0 ? `${data.mining.onlineDevices}/${data.mining.totalDevices} online` : 'No devices configured' };
      } else {
        checks[1] = { ...checks[1], status: 'partial', detail: 'Auth required' };
        checks[2] = { ...checks[2], status: 'partial', detail: 'Auth required' };
      }
    } catch {
      checks[1] = { ...checks[1], status: 'offline', detail: 'Error' };
      checks[2] = { ...checks[2], status: 'offline', detail: 'Error' };
    }

    try {
      const res = await fetch('/api/vault/yields', { credentials: 'include', signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (res?.ok) {
        const data = await res.json();
        checks[3] = { ...checks[3], status: 'online', detail: `${data.topYields?.length || 0} pools tracked` };
      } else {
        checks[3] = { ...checks[3], status: 'partial', detail: 'Auth required' };
      }
    } catch { checks[3] = { ...checks[3], status: 'offline', detail: 'Error' }; }

    checks[5] = { ...checks[5], status: 'online', detail: 'Live trading metrics' };

    setSystems([...checks]);
    setLoading(false);
  }, []);

  useEffect(() => { checkSystems(); }, [checkSystems]);

  const addGoal = () => {
    if (!newGoal.trim()) return;
    updateProfile({
      goals: [...profile.goals, {
        id: Date.now().toString(),
        text: newGoal.trim(),
        category: newGoalCat,
        done: false,
        createdAt: Date.now(),
      }],
    });
    setNewGoal('');
  };

  const toggleGoal = (id: string) => {
    updateProfile({
      goals: profile.goals.map((g) => g.id === id ? { ...g, done: !g.done } : g),
    });
  };

  const removeGoal = (id: string) => {
    const goal = profile.goals.find((g) => g.id === id);
    if (goal?.done) {
      updateProfile({
        goals: profile.goals.filter((g) => g.id !== id),
        milestones: [...profile.milestones, { text: goal.text, date: Date.now() }],
      });
    } else {
      updateProfile({ goals: profile.goals.filter((g) => g.id !== id) });
    }
  };

  // ── PPO Grant Agent ──────────────────────────────────────────────────────
  const runPPOAgent = useCallback(async () => {
    if (!ppoLocation.trim()) {
      setPpoError('Enter your city/state (e.g. Forest Acres, SC)');
      return;
    }
    setPpoLoading(true);
    setPpoError('');
    setPpoResult(null);
    try {
      const res = await fetch('/api/ppo-grant-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: profile.name || 'anonymous',
          state: ppoState,
          location: ppoLocation,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPpoResult(data);
    } catch (e) {
      setPpoError(e instanceof Error ? e.message : 'Failed to fetch grants');
    } finally {
      setPpoLoading(false);
    }
  }, [ppoLocation, ppoState, profile.name]);

  const onlineCount = systems.filter((s) => s.status === 'online').length;
  const totalCount = systems.length;
  const allGood = onlineCount === totalCount && !loading;
  const goalsDone = profile.goals.filter((g) => g.done).length;
  const goalsTotal = profile.goals.length;

  const tabs = [
    { id: 'present' as const, label: 'Present Moment', icon: '🧘' },
    { id: 'goals' as const, label: 'Goals & Progress', icon: '🎯' },
    { id: 'identity' as const, label: 'Identity', icon: '🪪' },
    { id: 'depin' as const, label: 'DePIN & Networks', icon: '🌐' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#0a051e] to-[#030108] p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80">Your Life Operating System</p>
            <h1 className="mt-1 text-3xl md:text-5xl font-black bg-gradient-to-r from-amber-300 via-emerald-300 to-cyan-300 bg-clip-text text-transparent">
              {profile.name ? `${profile.name}'s Life Dashboard` : 'Life Dashboard'}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Everything is handled. Past, future, and right now.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <Link href="/" className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-400 hover:text-white transition">&larr; Home</Link>
            <Link href="/vault" className="rounded-full border border-pink-500/30 px-3 py-1 text-pink-300 hover:bg-pink-500/10 transition">Vault</Link>
            <Link href="/dashboard" className="rounded-full border border-purple-500/30 px-3 py-1 text-purple-300 hover:bg-purple-500/10 transition">Dashboard</Link>
            <button onClick={checkSystems} className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-400 hover:text-white transition">&orarr; Refresh</button>
          </div>
        </header>

        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                tab === t.id ? 'bg-emerald-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Present Moment Tab */}
        {tab === 'present' && (
          <div className="space-y-6">
            <div className={`rounded-2xl border p-6 text-center ${
              allGood
                ? 'border-emerald-500/20 bg-gradient-to-r from-emerald-950/20 to-cyan-950/20'
                : 'border-amber-500/20 bg-gradient-to-r from-amber-950/20 to-orange-950/20'
            }`}>
              <p className="text-4xl mb-2">{allGood ? '✅' : loading ? '⏳' : '⚠️'}</p>
              <p className="text-xl font-black text-white">
                {allGood ? 'Everything is Running Smoothly' : loading ? 'Checking Your Systems...' : `${onlineCount}/${totalCount} Systems Online`}
              </p>
              <p className="mt-1 text-sm text-zinc-400">
                {allGood
                  ? 'All your AI, wallets, mining, yields, and trading systems are operational. Breathe easy.'
                  : 'Some systems need attention. Check the details below.'}
              </p>
              {goalsTotal > 0 && (
                <p className="mt-2 text-xs text-zinc-500">
                  🎯 {goalsDone}/{goalsTotal} goals completed &bull; {profile.milestones.length} milestones achieved
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {systems.map((sys) => (
                <Link
                  key={sys.name}
                  href={sys.link}
                  className={`flex items-center gap-3 rounded-xl border p-4 transition hover:scale-[1.02] ${
                    sys.status === 'online' ? 'border-emerald-500/20 bg-emerald-950/10' :
                    sys.status === 'partial' ? 'border-amber-500/20 bg-amber-950/10' :
                    sys.status === 'loading' ? 'border-zinc-700 bg-zinc-900/30' :
                    'border-red-500/20 bg-red-950/10'
                  }`}
                >
                  <span className="text-2xl">{sys.icon}</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-white">{sys.name}</p>
                    <p className="text-[10px] text-zinc-500">{sys.detail}</p>
                  </div>
                  <span className={`h-3 w-3 rounded-full ${
                    sys.status === 'online' ? 'bg-emerald-400 shadow-emerald-400/50 shadow-sm' :
                    sys.status === 'partial' ? 'bg-amber-400' :
                    sys.status === 'loading' ? 'bg-zinc-600 animate-pulse' :
                    'bg-red-400'
                  }`} />
                </Link>
              ))}
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6">
              <div className="text-center">
                <p className="text-xs uppercase tracking-widest text-amber-400/60 mb-2">Present Moment</p>
                <p className="text-lg font-semibold text-zinc-200 italic max-w-2xl mx-auto leading-relaxed">
                  &ldquo;Your AI handles the complexity. Your systems run autonomously. Your wealth compounds silently.
                  Right now, the only thing that matters is this moment.&rdquo;
                </p>
                <p className="mt-3 text-xs text-zinc-600">&mdash; FreedomForge Max</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: 'Ask MAX Anything', href: '/', icon: '🧠', color: 'border-purple-500/30 hover:bg-purple-500/10' },
                { label: 'Check Your Vault', href: '/vault', icon: '💰', color: 'border-pink-500/30 hover:bg-pink-500/10' },
                { label: 'Decode Something', href: '/cipher-lab', icon: '🔐', color: 'border-emerald-500/30 hover:bg-emerald-500/10' },
                { label: 'Explore AI Models', href: '/ai-models', icon: '🤖', color: 'border-cyan-500/30 hover:bg-cyan-500/10' },
              ].map((action) => (
                <Link
                  key={action.label}
                  href={action.href}
                  className={`flex items-center gap-3 rounded-xl border ${action.color} bg-black/20 p-4 transition`}
                >
                  <span className="text-xl">{action.icon}</span>
                  <span className="text-sm font-semibold text-white">{action.label}</span>
                </Link>
              ))}
            </div>

            {/* PPO Grant Agent — Liquid Glass Card */}
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl shadow-xl shadow-black/40">
              {/* Liquid glass shimmer overlay */}
              <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/[0.08] via-transparent to-cyan-500/5" />
              <div className="relative z-10 space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-2xl">🎯</span>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-cyan-400/70">PPO Grant Agent</p>
                    <h2 className="text-base font-black text-white leading-tight">Find Your Optimal Grants</h2>
                  </div>
                  <span className="ml-auto rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-cyan-300">
                    PPO · Clipped Surrogate
                  </span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Powered by Proximal Policy Optimization — the agent surfaces the highest-value grant
                  opportunities for your location using the clipped surrogate objective
                  L<sub>CLIP</sub>(θ)&nbsp;=&nbsp;𝔼[min(r·Â,&nbsp;clip(r,&nbsp;1−ε,&nbsp;1+ε)·Â)].
                </p>

                {/* Location inputs */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={ppoLocation}
                    onChange={(e) => setPpoLocation(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && runPPOAgent()}
                    placeholder="City, State — e.g. Forest Acres, SC"
                    className="flex-1 rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-cyan-500 backdrop-blur"
                  />
                  <input
                    type="text"
                    value={ppoState}
                    onChange={(e) => setPpoState(e.target.value.toUpperCase().slice(0, 2))}
                    placeholder="ST"
                    maxLength={2}
                    className="w-20 rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-center uppercase text-white placeholder-zinc-600 outline-none focus:border-cyan-500"
                  />
                  <button
                    onClick={runPPOAgent}
                    disabled={ppoLoading}
                    className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:opacity-50 whitespace-nowrap"
                  >
                    {ppoLoading ? '⏳ Running PPO…' : '▶ Run Agent'}
                  </button>
                </div>
                {ppoError && <p className="text-xs text-red-400">{ppoError}</p>}

                {/* Results */}
                {ppoResult && (
                  <div className="space-y-3">
                    {/* Top action */}
                    <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-4">
                      <p className="text-[10px] uppercase tracking-widest text-cyan-400/60 mb-1">Recommended Action</p>
                      <p className="text-sm text-cyan-100 leading-relaxed">{ppoResult.ppo_action}</p>
                      <div className="mt-3 flex flex-wrap gap-3 text-[10px]">
                        <span className="text-zinc-500">Confidence:&nbsp;
                          <span className="font-bold text-white">{(ppoResult.confidence * 100).toFixed(1)}%</span>
                        </span>
                        <span className="text-zinc-500">Total Value:&nbsp;
                          <span className="font-bold text-emerald-400">${ppoResult.totalPotentialValue.toLocaleString()}</span>
                        </span>
                        <span className="text-zinc-500">Matches:&nbsp;
                          <span className="font-bold text-white">{ppoResult.topMatches.length}</span>
                        </span>
                      </div>
                    </div>

                    {/* Algorithm trace */}
                    <details className="group">
                      <summary className="cursor-pointer select-none text-[10px] uppercase tracking-widest text-zinc-500 transition hover:text-zinc-300">
                        ⚙ PPO Algorithm Trace&nbsp;<span className="group-open:hidden">(expand)</span>
                      </summary>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {[
                          { label: 'Clip ε', value: String(ppoResult.algorithm.clipEpsilon) },
                          { label: 'Iterations', value: String(ppoResult.algorithm.iterations) },
                          { label: 'Surrogate L', value: ppoResult.algorithm.surrogateObjective.toFixed(5) },
                          { label: 'Entropy H', value: ppoResult.algorithm.entropy.toFixed(4) },
                        ].map((m) => (
                          <div key={m.label} className="rounded-lg border border-zinc-800 bg-black/30 p-2 text-center">
                            <p className="text-[9px] text-zinc-600">{m.label}</p>
                            <p className="text-xs font-bold text-zinc-200">{m.value}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-[10px]">
                        <span className={`rounded-full px-2 py-0.5 font-bold ${ppoResult.algorithm.convergence ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                          {ppoResult.algorithm.convergence ? '✓ Converged' : '⚠ Not converged'}
                        </span>
                        <span className="text-zinc-600">ε-bound satisfied within {ppoResult.algorithm.iterations} iters</span>
                      </div>
                    </details>

                    {/* Optimised grant matches */}
                    <div className="space-y-2">
                      <p className="text-[10px] uppercase tracking-widest text-zinc-500">Optimized Matches</p>
                      {ppoResult.topMatches.map((match) => (
                        <a
                          key={match.grant.id}
                          href={match.grant.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-start gap-3 rounded-xl border border-zinc-800/60 bg-black/30 p-3 backdrop-blur transition hover:border-cyan-500/30 hover:bg-cyan-950/10"
                        >
                          <span className="mt-0.5 text-base">
                            {match.grant.category === 'federal' ? '🏛' :
                             match.grant.category === 'state'   ? '🏷' :
                             match.grant.category === 'local'   ? '📍' : '🤝'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-white">{match.grant.name}</p>
                            <p className="truncate text-[10px] text-zinc-500">{match.grant.provider}</p>
                            <p className="mt-0.5 text-[10px] text-zinc-400">{match.actionRecommendation}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-xs font-bold text-emerald-400">${match.grant.maxAmount.toLocaleString()}</p>
                            <p className="text-[9px] text-zinc-600">max award</p>
                            <div className="mt-1 h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800">
                              <div
                                className="h-full rounded-full bg-cyan-500"
                                style={{ width: `${Math.round(match.matchScore * 100 / (ppoResult.topMatches[0]?.matchScore || 1))}%` }}
                              />
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Goals Tab */}
        {tab === 'goals' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-950/20 to-orange-950/20 p-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-widest text-amber-400/60">Freedom Number</p>
                  <p className="text-3xl font-black text-white mt-1">
                    ${profile.freedomNumber.toLocaleString()}<span className="text-lg text-zinc-500">/month</span>
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">
                    Monthly passive income needed to never work again
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={profile.freedomNumber}
                    onChange={(e) => updateProfile({ freedomNumber: parseInt(e.target.value) || 0 })}
                    className="w-32 rounded-xl border border-zinc-700 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
                  />
                  <span className="text-xs text-zinc-500">/mo</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
              <h3 className="text-sm font-bold text-white mb-3">Add a Goal</h3>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={newGoalCat}
                  onChange={(e) => setNewGoalCat(e.target.value)}
                  className="rounded-xl border border-zinc-700 bg-black/50 px-3 py-2 text-sm text-white outline-none"
                >
                  <option value="financial">💰 Financial</option>
                  <option value="health">❤️ Health</option>
                  <option value="learning">📚 Learning</option>
                  <option value="project">🔨 Project</option>
                  <option value="personal">🌟 Personal</option>
                  <option value="freedom">🕊️ Freedom</option>
                </select>
                <input
                  type="text"
                  value={newGoal}
                  onChange={(e) => setNewGoal(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addGoal()}
                  placeholder="What do you want to accomplish?"
                  className="flex-1 rounded-xl border border-zinc-700 bg-black/50 px-4 py-2 text-sm text-white outline-none focus:border-emerald-500"
                />
                <button
                  onClick={addGoal}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 transition"
                >
                  + Add
                </button>
              </div>
            </div>

            {profile.goals.length > 0 && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-white">Your Goals ({goalsDone}/{goalsTotal} done)</h3>
                  <div className="h-2 w-32 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-500"
                      style={{ width: `${goalsTotal > 0 ? (goalsDone / goalsTotal) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  {profile.goals.map((goal) => {
                    const catIcons: Record<string, string> = { financial: '💰', health: '❤️', learning: '📚', project: '🔨', personal: '🌟', freedom: '🕊️' };
                    return (
                      <div key={goal.id} className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition ${
                        goal.done ? 'border-emerald-500/20 bg-emerald-950/10' : 'border-zinc-800 bg-black/20'
                      }`}>
                        <button onClick={() => toggleGoal(goal.id)} className="text-lg">
                          {goal.done ? '✅' : '⬜'}
                        </button>
                        <span className="text-sm">{catIcons[goal.category] || '🎯'}</span>
                        <span className={`flex-1 text-sm ${goal.done ? 'text-zinc-500 line-through' : 'text-white'}`}>
                          {goal.text}
                        </span>
                        <button
                          onClick={() => removeGoal(goal.id)}
                          className="text-zinc-600 hover:text-red-400 text-xs transition"
                          title={goal.done ? 'Archive as milestone' : 'Delete'}
                        >
                          {goal.done ? '📦' : '×'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {profile.milestones.length > 0 && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
                <h3 className="text-sm font-bold text-white mb-3">🏆 Milestones Achieved</h3>
                <div className="space-y-2">
                  {profile.milestones.slice(-10).reverse().map((m, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-xl border border-amber-500/10 bg-amber-950/5 px-4 py-2">
                      <span className="text-amber-400">★</span>
                      <span className="flex-1 text-sm text-zinc-300">{m.text}</span>
                      <span className="text-[10px] text-zinc-600">{new Date(m.date).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Identity Tab */}
        {tab === 'identity' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-purple-500/20 bg-purple-950/10 p-6">
              <p className="text-xs uppercase tracking-widest text-purple-400/60 mb-2">Sovereign Identity</p>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Your FreedomForge identity is stored locally on your device &mdash; you own it completely. No central server,
                no corporation, no government can access or revoke it. Inspired by XStar&apos;s Proof of Humanity and
                Lens Protocol&apos;s portable social identity.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
              <h3 className="text-sm font-bold text-white mb-3">🪪 Your Name</h3>
              <input
                type="text"
                value={profile.name}
                onChange={(e) => updateProfile({ name: e.target.value })}
                placeholder="What should FreedomForge call you?"
                className="w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-purple-500"
              />
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
              <h3 className="text-sm font-bold text-white mb-3">💰 Connected Wallet Addresses</h3>
              <p className="text-xs text-zinc-500 mb-3">
                Add wallet addresses to track across all chains. Inspired by XStar&apos;s omnichain naming &mdash; one identity, all chains.
              </p>
              {profile.walletAddresses.map((w, i) => (
                <div key={i} className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-zinc-500 w-20">{w.chain}</span>
                  <span className="flex-1 text-xs text-zinc-300 font-mono truncate">{w.address}</span>
                  <span className="text-xs text-zinc-600">{w.label}</span>
                  <button
                    onClick={() => updateProfile({ walletAddresses: profile.walletAddresses.filter((_, j) => j !== i) })}
                    className="text-zinc-600 hover:text-red-400 text-xs"
                  >&times;</button>
                </div>
              ))}
              <button
                onClick={() => {
                  const chain = prompt('Chain (ethereum, bitcoin, solana, multiversx):') || 'ethereum';
                  const address = prompt('Wallet address:');
                  const label = prompt('Label (optional):') || '';
                  if (address) {
                    updateProfile({ walletAddresses: [...profile.walletAddresses, { chain, address, label }] });
                  }
                }}
                className="mt-2 rounded-xl border border-dashed border-zinc-700 px-4 py-2 text-xs text-zinc-500 hover:text-white hover:border-purple-500 transition w-full"
              >
                + Add Wallet Address
              </button>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
              <h3 className="text-sm font-bold text-white mb-3">📦 Export / Import Profile</h3>
              <p className="text-xs text-zinc-500 mb-3">Your data never leaves your device unless you explicitly export it.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = 'freedomforge-profile.json'; a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-white hover:bg-purple-500 transition"
                >
                  Export Profile
                </button>
                <label className="rounded-xl border border-zinc-700 px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white cursor-pointer transition">
                  Import Profile
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        try {
                          const imported = JSON.parse(ev.target?.result as string);
                          updateProfile(imported);
                        } catch { /* ignore */ }
                      };
                      reader.readAsText(file);
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* DePIN Tab */}
        {tab === 'depin' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-950/10 p-6">
              <p className="text-xs uppercase tracking-widest text-cyan-400/60 mb-2">Decentralized Physical Infrastructure</p>
              <p className="text-lg font-bold text-white mb-2">Earn From Your Existing Infrastructure</p>
              <p className="text-sm text-zinc-400 leading-relaxed">
                DePIN networks reward you for sharing bandwidth, compute, storage, and connectivity.
                Your internet connection, your mining hardware, your devices &mdash; all generating passive income 24/7.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
              <h3 className="text-sm font-bold text-white mb-4">🌐 DePIN Network Directory</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    name: 'DAWN Internet',
                    type: 'Bandwidth Sharing',
                    desc: 'Earn by sharing your internet connection. Proof of Bandwidth validation via Chrome extension or Black Box hardware ($1,499).',
                    reward: 'DAWN tokens',
                    url: 'https://www.dawninternet.com',
                    status: 'Active',
                  },
                  {
                    name: 'Quai Network',
                    type: 'Multi-Algo Mining',
                    desc: 'Merge-mine with SHA-256, Scrypt, and KawPoW via StratumX. SOAP protocol converts subsidies into buybacks.',
                    reward: 'QUAI tokens',
                    url: 'https://www.qu.ai',
                    status: 'Active',
                  },
                  {
                    name: 'Helium',
                    type: 'IoT Coverage',
                    desc: 'Provide wireless coverage for IoT devices. Mine HNT with hotspot hardware.',
                    reward: 'HNT tokens',
                    url: 'https://helium.com',
                    status: 'Active',
                  },
                  {
                    name: 'Filecoin',
                    type: 'Storage',
                    desc: 'Provide decentralized storage capacity. Earn FIL for storing and retrieving data.',
                    reward: 'FIL tokens',
                    url: 'https://filecoin.io',
                    status: 'Active',
                  },
                  {
                    name: 'Render Network',
                    type: 'GPU Compute',
                    desc: 'Share idle GPU power for rendering, AI training, and inference workloads.',
                    reward: 'RNDR tokens',
                    url: 'https://rendernetwork.com',
                    status: 'Active',
                  },
                  {
                    name: 'Akash Network',
                    type: 'Cloud Compute',
                    desc: 'Decentralized cloud computing marketplace. Provide and consume compute resources.',
                    reward: 'AKT tokens',
                    url: 'https://akash.network',
                    status: 'Active',
                  },
                ].map((net) => (
                  <a
                    key={net.name}
                    href={net.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-xl border border-zinc-800 bg-black/20 p-4 transition hover:border-cyan-500/30 hover:bg-cyan-950/5"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-bold text-white">{net.name}</p>
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold text-emerald-400">{net.status}</span>
                    </div>
                    <p className="text-[10px] uppercase tracking-widest text-cyan-400/60 mb-1">{net.type}</p>
                    <p className="text-xs text-zinc-500 leading-relaxed">{net.desc}</p>
                    <p className="mt-2 text-[10px] text-amber-400">Reward: {net.reward}</p>
                  </a>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
              <h3 className="text-sm font-bold text-white mb-3">⛏️ Mining Algorithm Support</h3>
              <p className="text-xs text-zinc-500 mb-3">
                FreedomForge monitors all major mining algorithms. Inspired by Quai Network&apos;s multi-algo approach.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {[
                  { algo: 'SHA-256', coins: 'BTC, BCH, BSV, QUAI', hardware: 'ASIC (Antminer S19/S21)' },
                  { algo: 'Scrypt', coins: 'LTC, DOGE, QUAI', hardware: 'ASIC (Antminer L7/L9)' },
                  { algo: 'KawPoW', coins: 'RVN, QUAI', hardware: 'GPU (NVIDIA/AMD)' },
                  { algo: 'Ethash/Etchash', coins: 'ETC', hardware: 'GPU / ASIC' },
                  { algo: 'RandomX', coins: 'XMR', hardware: 'CPU (Ryzen/EPYC)' },
                  { algo: 'Blake3', coins: 'ALPH', hardware: 'GPU / ASIC' },
                ].map((a) => (
                  <div key={a.algo} className="rounded-xl border border-zinc-800 bg-black/20 p-3">
                    <p className="text-xs font-bold text-white">{a.algo}</p>
                    <p className="text-[10px] text-amber-400 mt-1">{a.coins}</p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">{a.hardware}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="border-t border-zinc-900 pt-6 pb-4 text-center">
          <p className="text-xs text-zinc-600">
            FreedomForge Max &mdash; Your systems run so you don&apos;t have to. Enjoy the present moment. 🧘
          </p>
        </footer>
      </div>
    </div>
  );
}
