'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface GrantAmount {
  min: number;
  max: number;
  currency: string;
}

interface Grant {
  id: string;
  title: string;
  funder: string;
  amount: GrantAmount;
  deadline: string | null;
  eligibility: string[];
  focus: string[];
  description: string;
  applicationUrl: string | null;
  location: string | null;
  type: string;
  category: string;
  rlScore?: number;
  score?: number;
}

interface RLStats {
  totalEpisodes: number;
  avgReward: number;
  avgAdvantage: number;
  lastUpdatedAt: number;
}

interface SearchResult {
  grants: Grant[];
  query: string;
  total: number;
  rlStats: RLStats | null;
}

const CATEGORIES = [
  { value: '', label: 'All Categories' },
  { value: 'technology', label: '💻 Technology' },
  { value: 'community', label: '🏘️ Community' },
  { value: 'education', label: '📚 Education' },
  { value: 'health', label: '🏥 Health' },
  { value: 'arts', label: '🎨 Arts' },
  { value: 'environment', label: '🌿 Environment' },
];

const TYPE_COLORS: Record<string, string> = {
  federal:   'bg-blue-900/40 text-blue-300 border-blue-700/50',
  state:     'bg-green-900/40 text-green-300 border-green-700/50',
  foundation:'bg-purple-900/40 text-purple-300 border-purple-700/50',
  corporate: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
  nonprofit: 'bg-pink-900/40 text-pink-300 border-pink-700/50',
  other:     'bg-zinc-800/40 text-zinc-300 border-zinc-700/50',
};

function formatAmount(amount: GrantAmount): string {
  const fmt = (v: number) =>
    v >= 1_000_000
      ? `$${(v / 1_000_000).toFixed(1)}M`
      : v >= 1000
      ? `$${(v / 1000).toFixed(0)}K`
      : `$${v.toLocaleString()}`;

  if (amount.min === amount.max) return fmt(amount.min);
  return `${fmt(amount.min)} – ${fmt(amount.max)}`;
}

function daysUntil(deadline: string | null): number | null {
  if (!deadline) return null;
  const diff = new Date(deadline).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function GrantsPage() {
  const [query, setQuery]         = useState('community economic development South Carolina');
  const [location, setLocation]   = useState('South Carolina');
  const [category, setCategory]   = useState('');
  const [budget, setBudget]       = useState('');
  const [results, setResults]     = useState<SearchResult | null>(null);
  const [loading, setLoading]     = useState(false);
  const [selectedGrant, setSelectedGrant] = useState<Grant | null>(null);
  const [guidance, setGuidance]   = useState('');
  const [guidanceLoading, setGuidanceLoading] = useState(false);
  const [applicantContext, setApplicantContext] = useState(
    'A social enterprise in Forest Acres, SC focused on economic mobility and community development.'
  );
  const [feedback, setFeedback]   = useState<Record<string, number>>({});
  const [feedbackSent, setFeedbackSent] = useState(false);

  const search = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoading(true);
    setSelectedGrant(null);
    setGuidance('');
    setFeedback({});
    setFeedbackSent(false);

    try {
      const params = new URLSearchParams({ q: query });
      if (location) params.set('location', location);
      if (category) params.set('category', category);
      if (budget)   params.set('budget', budget);
      params.set('limit', '8');

      const res = await fetch(`/api/grants?${params.toString()}`);
      if (res.ok) {
        const data = await res.json() as SearchResult;
        setResults(data);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [query, location, category, budget]);

  // Initial load — intentionally runs once on mount only; subsequent searches are user-triggered
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { search(); }, []);

  const getGuidance = async (grant: Grant) => {
    setSelectedGrant(grant);
    setGuidance('');
    setGuidanceLoading(true);
    try {
      const res = await fetch('/api/grants/guidance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant, applicantContext }),
      });
      if (res.ok) {
        const data = await res.json() as { guidance: string };
        setGuidance(data.guidance || '');
      }
    } catch { /* silent */ } finally {
      setGuidanceLoading(false);
    }
  };

  const markFeedback = (grantId: string, signal: number) => {
    setFeedback((prev) => ({ ...prev, [grantId]: signal }));
  };

  const submitFeedback = async () => {
    if (!results || Object.keys(feedback).length === 0) return;
    try {
      await fetch('/api/grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grants:   results.grants,
          feedback,
          query:    results.query,
          budget:   budget ? parseInt(budget, 10) : undefined,
        }),
      });
      setFeedbackSent(true);
    } catch { /* silent */ }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#050115] to-[#030108] text-white">
      {/* Header */}
      <div className="border-b border-zinc-800/50 bg-black/40 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏆</span>
            <div>
              <h1 className="text-lg font-bold text-white">Grant Navigator</h1>
              <p className="text-xs text-zinc-500">PPO+GAE RL Agent · Grok AI · 501(c)(3) Impact</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/admin" className="text-xs text-zinc-500 hover:text-white px-3 py-1.5 rounded-lg border border-zinc-700/50 hover:border-zinc-500 transition">
              Admin
            </Link>
            <Link href="/" className="text-xs text-zinc-500 hover:text-white px-3 py-1.5 rounded-lg border border-zinc-700/50 hover:border-zinc-500 transition">
              ← Home
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Hero */}
        <div className="rounded-2xl border border-purple-500/20 bg-purple-900/10 p-6">
          <div className="flex items-start gap-4">
            <div className="text-4xl">🤖</div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-purple-300">Autonomous AI Grant Navigator</h2>
              <p className="text-sm text-zinc-400 mt-1">
                Powered by Grok AI + PPO reinforcement learning. Discovers and ranks grants for
                Forest Acres / Columbia SC. 10% of revenue flows to the Solana on-chain impact fund.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <span className="text-xs bg-blue-900/40 text-blue-300 px-2 py-1 rounded-full border border-blue-700/40">Grok API</span>
                <span className="text-xs bg-purple-900/40 text-purple-300 px-2 py-1 rounded-full border border-purple-700/40">PPO+GAE RL</span>
                <span className="text-xs bg-green-900/40 text-green-300 px-2 py-1 rounded-full border border-green-700/40">IBC v2</span>
                <span className="text-xs bg-amber-900/40 text-amber-300 px-2 py-1 rounded-full border border-amber-700/40">Solana Impact Fund</span>
                <span className="text-xs bg-pink-900/40 text-pink-300 px-2 py-1 rounded-full border border-pink-700/40">501(c)(3) 10%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Search */}
        <form onSubmit={search} className="rounded-2xl border border-zinc-700/50 bg-zinc-900/50 p-4 space-y-3">
          <div className="flex gap-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search grants (e.g. economic mobility technology small business)…"
              className="flex-1 bg-zinc-800/70 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500/60"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-xl text-sm font-semibold transition"
            >
              {loading ? '…' : '🔍 Search'}
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Location (e.g. South Carolina)"
              className="flex-1 min-w-[140px] bg-zinc-800/70 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500/50"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="bg-zinc-800/70 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <input
              type="number"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="Target $ amount"
              className="w-36 bg-zinc-800/70 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500/50"
            />
          </div>
        </form>

        {/* RL Stats */}
        {results?.rlStats && (
          <div className="flex items-center gap-4 text-xs text-zinc-500">
            <span>🧠 RL Episodes: <span className="text-zinc-300">{results.rlStats.totalEpisodes}</span></span>
            <span>Avg Reward: <span className="text-zinc-300">{results.rlStats.avgReward.toFixed(3)}</span></span>
            <span>Results: <span className="text-zinc-300">{results.total}</span></span>
          </div>
        )}

        {/* Results */}
        {loading ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3 animate-pulse">🔎</div>
            <p className="text-zinc-400">Searching grants with Grok AI…</p>
          </div>
        ) : (
          results && (
            <div className="space-y-3">
              {results.grants.map((grant) => {
                const days   = daysUntil(grant.deadline);
                const fb     = feedback[grant.id];
                const typeClr = TYPE_COLORS[grant.type] || TYPE_COLORS.other;
                return (
                  <div
                    key={grant.id}
                    className={`rounded-2xl border p-4 transition cursor-pointer ${
                      selectedGrant?.id === grant.id
                        ? 'border-purple-500/50 bg-purple-900/10'
                        : 'border-zinc-700/50 bg-zinc-900/50 hover:border-zinc-600'
                    }`}
                    onClick={() => setSelectedGrant(selectedGrant?.id === grant.id ? null : grant)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${typeClr}`}>
                            {grant.type}
                          </span>
                          {grant.rlScore !== undefined && (
                            <span className="text-xs text-zinc-500">
                              RL: <span className="text-purple-400">{(grant.rlScore * 100).toFixed(0)}%</span>
                            </span>
                          )}
                          {days !== null && days >= 0 && days <= 30 && (
                            <span className={`text-xs px-2 py-0.5 rounded-full ${days <= 7 ? 'bg-red-900/40 text-red-300 border border-red-700/40' : 'bg-amber-900/40 text-amber-300 border border-amber-700/40'}`}>
                              {days === 0 ? 'Due today!' : `${days}d left`}
                            </span>
                          )}
                          {grant.deadline === null && (
                            <span className="text-xs text-zinc-500">Rolling deadline</span>
                          )}
                        </div>
                        <h3 className="font-semibold text-white text-sm leading-tight">{grant.title}</h3>
                        <p className="text-xs text-zinc-400 mt-0.5">{grant.funder}</p>
                        {selectedGrant?.id === grant.id && (
                          <p className="text-xs text-zinc-300 mt-2 leading-relaxed">{grant.description}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold text-green-400">{formatAmount(grant.amount)}</div>
                        {grant.location && (
                          <div className="text-xs text-zinc-500 mt-0.5">{grant.location}</div>
                        )}
                      </div>
                    </div>

                    {selectedGrant?.id === grant.id && (
                      <div className="mt-3 pt-3 border-t border-zinc-700/50 space-y-3">
                        {/* Focus tags */}
                        <div className="flex flex-wrap gap-1">
                          {grant.focus.map((f) => (
                            <span key={f} className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">{f}</span>
                          ))}
                        </div>

                        {/* Eligibility */}
                        {grant.eligibility.length > 0 && (
                          <div>
                            <p className="text-xs text-zinc-500 mb-1">Eligibility:</p>
                            <ul className="text-xs text-zinc-300 space-y-0.5">
                              {grant.eligibility.map((e) => <li key={e} className="flex gap-1"><span>•</span>{e}</li>)}
                            </ul>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex flex-wrap gap-2">
                          {grant.applicationUrl && (
                            <a
                              href={grant.applicationUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(ev) => { ev.stopPropagation(); markFeedback(grant.id, 1); }}
                              className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-xs font-semibold transition"
                            >
                              Apply Now ↗
                            </a>
                          )}
                          <button
                            onClick={(ev) => { ev.stopPropagation(); getGuidance(grant); }}
                            disabled={guidanceLoading}
                            className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 rounded-lg text-xs font-semibold transition"
                          >
                            {guidanceLoading && selectedGrant?.id === grant.id ? '…' : '🤖 AI Guidance'}
                          </button>

                          {/* RL feedback */}
                          <div className="flex gap-1 ml-auto">
                            <button
                              onClick={(ev) => { ev.stopPropagation(); markFeedback(grant.id, 1); }}
                              className={`px-2 py-1 rounded-lg text-xs transition ${fb === 1 ? 'bg-green-700 text-green-200' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'}`}
                              title="Relevant"
                            >👍</button>
                            <button
                              onClick={(ev) => { ev.stopPropagation(); markFeedback(grant.id, -0.5); }}
                              className={`px-2 py-1 rounded-lg text-xs transition ${fb === -0.5 ? 'bg-red-900 text-red-200' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'}`}
                              title="Not relevant"
                            >👎</button>
                          </div>
                        </div>

                        {/* AI Guidance */}
                        {guidance && selectedGrant?.id === grant.id && (
                          <div className="rounded-xl border border-purple-700/30 bg-purple-900/10 p-3">
                            <p className="text-xs text-purple-300 font-semibold mb-1">🤖 AI Application Guidance</p>
                            <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed">{guidance}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Feedback submission */}
              {Object.keys(feedback).length > 0 && !feedbackSent && (
                <div className="flex items-center gap-3 rounded-xl border border-zinc-700/50 bg-zinc-900/50 p-3">
                  <p className="text-xs text-zinc-400 flex-1">
                    Submit feedback to train the RL agent ({Object.keys(feedback).length} rating{Object.keys(feedback).length !== 1 ? 's' : ''})
                  </p>
                  <button
                    onClick={submitFeedback}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-xs font-semibold transition"
                  >
                    Train Agent 🧠
                  </button>
                </div>
              )}
              {feedbackSent && (
                <p className="text-xs text-green-400 text-center">✅ RL agent updated with your feedback</p>
              )}
            </div>
          )
        )}

        {/* Impact Fund Banner */}
        <div className="rounded-2xl border border-amber-500/20 bg-amber-900/10 p-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⛓️</span>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-amber-300">On-Chain Impact Fund</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                10% of all revenue is automatically allocated to the Solana impact fund for
                Forest Acres / Columbia SC economic mobility. Transparent, on-chain, 501(c)(3).
              </p>
            </div>
            <Link
              href="/admin"
              className="shrink-0 text-xs bg-amber-800/50 hover:bg-amber-700/50 text-amber-300 px-3 py-1.5 rounded-lg border border-amber-700/40 transition"
            >
              View Fund →
            </Link>
          </div>
        </div>

        {/* Applicant context (for AI guidance) */}
        <details className="rounded-xl border border-zinc-700/50 bg-zinc-900/50">
          <summary className="px-4 py-3 text-sm text-zinc-400 cursor-pointer hover:text-white">
            ⚙️ Applicant Profile (for AI guidance)
          </summary>
          <div className="px-4 pb-4">
            <textarea
              value={applicantContext}
              onChange={(e) => setApplicantContext(e.target.value)}
              rows={3}
              className="w-full bg-zinc-800/70 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50 resize-none"
              placeholder="Describe your organization, mission, and goals…"
            />
          </div>
        </details>
      </div>
    </div>
  );
}
