'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface SystemStats {
  uptime: number;
  memoryMb: number;
  nodeVersion: string;
  env: string;
}

interface GrantNavigatorStats {
  rlAgent: {
    totalEpisodes: number;
    avgReward: number;
    avgAdvantage: number;
    lastUpdatedAt: number;
  };
  grokModelActive: boolean;
}

interface ImpactFundStats {
  totalAllocatedUsd: number;
  totalConfirmedUsd: number;
  totalPendingUsd: number;
  allocationCount: number;
  walletAddress: string | null;
  walletUrl: string | null;
  impactBps: number;
}

interface IBCSummary {
  supportedChains: string[];
  openChannels: number;
  pendingTransfers: number;
  completedTransfers: number;
}

interface BillingConfig {
  stripeConfigured: boolean;
  revenueCatConfigured: boolean;
  webhookConfigured: boolean;
}

interface AdminStats {
  system: SystemStats;
  grantNavigator: GrantNavigatorStats;
  impactFund: ImpactFundStats;
  ibc: IBCSummary;
  billing: BillingConfig;
  config: {
    siteUrl: string;
    cause: string;
    fundTarget: string;
  };
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(seconds % 60)}s`;
}

function StatCard({ label, value, sub, color = 'zinc' }: {
  label: string; value: React.ReactNode; sub?: string; color?: string;
}) {
  const colorMap: Record<string, string> = {
    zinc:   'border-zinc-700/50 bg-zinc-900/50',
    green:  'border-green-700/30 bg-green-900/10',
    purple: 'border-purple-700/30 bg-purple-900/10',
    amber:  'border-amber-700/30 bg-amber-900/10',
    blue:   'border-blue-700/30 bg-blue-900/10',
    red:    'border-red-700/30 bg-red-900/10',
  };
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color] || colorMap.zinc}`}>
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <div className="text-xl font-bold text-white">{value}</div>
      {sub && <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [stats, setStats]       = useState<AdminStats | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin', { credentials: 'include' });
      if (res.status === 401) {
        router.replace('/login?next=/admin');
        return;
      }
      if (!res.ok) throw new Error('Failed to load admin data');
      const data = await res.json() as AdminStats;
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id); }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#050115] to-[#030108] flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-pulse">⚙️</div>
          <p className="text-zinc-400">Loading admin panel…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#050115] to-[#030108] flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <p className="text-red-400 mb-4">{error}</p>
          <Link href="/login?next=/admin" className="text-purple-400 hover:text-purple-300">Sign in →</Link>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const { system, grantNavigator, impactFund, ibc, billing, config } = stats;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#050115] to-[#030108] text-white">
      {/* Header */}
      <div className="border-b border-zinc-800/50 bg-black/40 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚙️</span>
            <div>
              <h1 className="text-lg font-bold">Admin Dashboard</h1>
              <p className="text-xs text-zinc-500">FreedomForge.one · {system.env}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/grants" className="text-xs text-zinc-500 hover:text-white px-3 py-1.5 rounded-lg border border-zinc-700/50 hover:border-zinc-500 transition">
              🏆 Grants
            </Link>
            <Link href="/dashboard" className="text-xs text-zinc-500 hover:text-white px-3 py-1.5 rounded-lg border border-zinc-700/50 hover:border-zinc-500 transition">
              📊 Dashboard
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* System */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">System</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Uptime" value={formatUptime(system.uptime)} color="green" />
            <StatCard label="Memory" value={`${system.memoryMb} MB`} />
            <StatCard label="Node.js" value={system.nodeVersion} />
            <StatCard label="Environment" value={system.env} color={system.env === 'production' ? 'green' : 'amber'} />
          </div>
        </section>

        {/* Impact Fund */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            ⛓️ On-Chain Impact Fund (Solana · 10%)
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <StatCard
              label="Total Allocated"
              value={`$${impactFund.totalAllocatedUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              color="amber"
            />
            <StatCard
              label="Confirmed On-Chain"
              value={`$${impactFund.totalConfirmedUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              color="green"
            />
            <StatCard
              label="Pending"
              value={`$${impactFund.totalPendingUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              color="amber"
            />
            <StatCard
              label="Total Allocations"
              value={impactFund.allocationCount}
              sub={`${impactFund.impactBps / 100}% of revenue`}
            />
          </div>
          <div className="rounded-xl border border-amber-700/30 bg-amber-900/10 p-4">
            <p className="text-xs text-zinc-400 mb-1">Mission</p>
            <p className="text-sm text-amber-300 font-medium">{config.cause}</p>
            <p className="text-xs text-zinc-500 mt-1">{config.fundTarget}</p>
            {impactFund.walletAddress && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-zinc-500">Wallet:</span>
                <code className="text-xs text-zinc-300 bg-zinc-800 px-2 py-0.5 rounded font-mono">
                  {impactFund.walletAddress}
                </code>
                {impactFund.walletUrl && (
                  <a href={impactFund.walletUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300">
                    Solscan ↗
                  </a>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Grant Navigator */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            🏆 Grant Navigator · PPO+GAE RL Agent
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="RL Episodes"
              value={grantNavigator.rlAgent.totalEpisodes}
              color="purple"
            />
            <StatCard
              label="Avg Reward"
              value={grantNavigator.rlAgent.avgReward.toFixed(4)}
              color="purple"
            />
            <StatCard
              label="Avg Advantage (GAE)"
              value={grantNavigator.rlAgent.avgAdvantage.toFixed(4)}
            />
            <StatCard
              label="Grok AI"
              value={grantNavigator.grokModelActive ? '✅ Active' : '⚠️ No Key'}
              color={grantNavigator.grokModelActive ? 'green' : 'amber'}
            />
          </div>
          <div className="mt-3">
            <Link
              href="/grants"
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-700 hover:bg-purple-600 rounded-xl text-sm font-semibold transition"
            >
              Open Grant Navigator →
            </Link>
          </div>
        </section>

        {/* IBC v2 */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            🌐 IBC v2 Cross-Chain Routing
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <StatCard label="Supported Chains" value={ibc.supportedChains.length} color="blue" />
            <StatCard label="Open Channels" value={ibc.openChannels} color="green" />
            <StatCard label="Pending Transfers" value={ibc.pendingTransfers} />
            <StatCard label="Completed" value={ibc.completedTransfers} color="green" />
          </div>
          <div className="flex flex-wrap gap-2">
            {ibc.supportedChains.map((chain) => (
              <span key={chain} className="text-xs bg-blue-900/30 text-blue-300 border border-blue-700/40 px-2 py-1 rounded-full">
                {chain}
              </span>
            ))}
          </div>
        </section>

        {/* Billing */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            💳 Billing — Stripe + RevenueCat
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StatCard
              label="Stripe"
              value={billing.stripeConfigured ? '✅ Configured' : '⚠️ Not configured'}
              color={billing.stripeConfigured ? 'green' : 'red'}
            />
            <StatCard
              label="RevenueCat"
              value={billing.revenueCatConfigured ? '✅ Configured' : '⚠️ Not configured'}
              color={billing.revenueCatConfigured ? 'green' : 'amber'}
            />
            <StatCard
              label="Webhook"
              value={billing.webhookConfigured ? '✅ Active' : '⚠️ Not configured'}
              color={billing.webhookConfigured ? 'green' : 'amber'}
            />
          </div>
          <div className="mt-3">
            <Link href="/pricing" className="text-xs text-zinc-400 hover:text-white transition">
              View pricing page →
            </Link>
          </div>
        </section>

        {/* Quick Links */}
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">Quick Links</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { href: '/grants',     label: '🏆 Grant Navigator' },
              { href: '/dashboard',  label: '📊 Main Dashboard' },
              { href: '/trading',    label: '📈 Trading' },
              { href: '/pricing',    label: '💳 Pricing' },
              { href: '/vault',      label: '🏦 Vault' },
              { href: '/intelligence', label: '🧠 Intelligence' },
              { href: '/watchdog',   label: '👁️ Watchdog' },
              { href: '/ai-models',  label: '🔮 AI Models' },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-xl border border-zinc-700/50 bg-zinc-900/50 hover:border-zinc-500 px-4 py-3 text-sm text-zinc-300 hover:text-white transition text-center"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
