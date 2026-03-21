'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface WalletBalance {
  chain: string;
  address: string;
  label: string;
  nativeBalance: number;
  nativeSymbol: string;
  nativeUSD: number;
  tokens: { symbol: string; balance: number; usdValue: number }[];
  totalUSD: number;
}

interface MinerDevice {
  id: string;
  name: string;
  type: string;
  model: string;
  hashrate: number;
  hashrateUnit: string;
  temperature: number;
  power: number;
  efficiency: number;
  status: string;
  rejectRate: number;
  uptime: number;
}

interface MiningPool {
  id: string;
  name: string;
  coin: string;
  hashrate24h: number;
  workers: number;
  unpaidBalance: number;
  estimatedDaily: number;
  status: string;
}

interface YieldMarket {
  protocol: string;
  chain: string;
  asset: string;
  apy: number;
  apy7d: number;
  apy30d: number;
  tvl: number;
  change24h: number;
  type: string;
  risk: string;
}

interface FundingRate {
  exchange: string;
  pair: string;
  rate: number;
  annualized: number;
  direction: string;
}

interface YieldSpread {
  asset: string;
  highProtocol: string;
  highChain: string;
  highApy: number;
  lowProtocol: string;
  lowChain: string;
  lowApy: number;
  spread: number;
  opportunity: string;
}

interface YieldData {
  topYields: YieldMarket[];
  stablecoinYields: YieldMarket[];
  fundingRates: FundingRate[];
  spreads: YieldSpread[];
  marketSummary: {
    avgDeFiYield: number;
    avgStablecoinYield: number;
    avgFundingRate: number;
    totalTVL: number;
    yieldTrend: string;
  };
}

interface VaultData {
  netWorth: number;
  wallets: { total: number; totalUSD: number; list: WalletBalance[] };
  exchanges: { total: number; totalUSD: number };
  defi: { total: number; totalUSD: number; totalYieldUSD: number };
  mining: {
    totalHashrate: number;
    totalHashrateUnit: string;
    totalPower: number;
    totalDevices: number;
    onlineDevices: number;
    avgTemperature: number;
    estimatedDailyUSD: number;
    estimatedMonthlyUSD: number;
    electricityCostDaily: number;
    profitDaily: number;
    devices: MinerDevice[];
    pools: MiningPool[];
  };
  treasury: {
    lifetimePnL: number;
    totalTrades: number;
    winRate: number;
    capitalCurrent: number;
  };
  breakdown: { category: string; usd: number; pct: number }[];
  lastUpdated: string;
}

// Chain icon/color mapping
const CHAIN_STYLES: Record<string, { color: string; icon: string }> = {
  bitcoin: { color: 'text-orange-400 border-orange-500/30', icon: '₿' },
  ethereum: { color: 'text-blue-400 border-blue-500/30', icon: 'Ξ' },
  solana: { color: 'text-purple-400 border-purple-500/30', icon: '◎' },
  multiversx: { color: 'text-cyan-400 border-cyan-500/30', icon: '✕' },
  base: { color: 'text-blue-300 border-blue-400/30', icon: 'B' },
  arbitrum: { color: 'text-sky-400 border-sky-500/30', icon: 'A' },
  optimism: { color: 'text-red-400 border-red-500/30', icon: 'O' },
  polygon: { color: 'text-violet-400 border-violet-500/30', icon: 'P' },
};

function fmt(n: number, decimals = 2): string {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(decimals)}`;
}

function shortAddr(addr: string): string {
  return addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}

// ── Setup Guide ────────────────────────────────────────────────────────

function SetupGuide() {
  return (
    <div className="rounded-2xl border border-amber-500/20 bg-amber-950/10 p-6 space-y-4">
      <h3 className="text-lg font-bold text-amber-300">⚡ Connect Your Assets</h3>
      <p className="text-sm text-zinc-400">
        Add your wallet addresses, mining equipment, and exchange accounts to see everything in one place.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-black/30 p-4">
          <p className="text-sm font-semibold text-white mb-2">💰 Wallets</p>
          <p className="text-xs text-zinc-500 leading-relaxed">
            Set environment variables to auto-detect your wallets:
          </p>
          <pre className="mt-2 rounded-lg bg-zinc-900 p-2 text-[10px] text-emerald-300 overflow-x-auto">
{`ETH_WALLET_ADDRESS=0x...
BTC_WALLET_ADDRESS=bc1...
SOLANA_WALLET_ADDRESS=...
MVX_WALLET_ADDRESS=erd1...

# Multiple addresses:
VAULT_ETH_ADDRESSES=0x...,0x...
VAULT_SOL_ADDRESSES=...,...
VAULT_BTC_ADDRESSES=bc1...,bc1...`}
          </pre>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-black/30 p-4">
          <p className="text-sm font-semibold text-white mb-2">⛏️ Mining Equipment</p>
          <p className="text-xs text-zinc-500 leading-relaxed">
            Connect ASIC miners and pool accounts:
          </p>
          <pre className="mt-2 rounded-lg bg-zinc-900 p-2 text-[10px] text-emerald-300 overflow-x-auto">
{`# Mining devices (JSON array):
MINING_DEVICES='[{
  "id":"s19-1","name":"S19 Pro",
  "type":"asic","model":"S19 Pro",
  "ip":"192.168.1.100","port":4028,
  "algorithm":"SHA-256"
}]'

# Pool accounts (JSON array):
MINING_POOLS='[{
  "id":"f2pool-btc",
  "name":"F2Pool BTC",
  "provider":"f2pool",
  "coin":"BTC",
  "account":"your_f2pool_user",
  "apiKey":"your_api_key"
}]'

ELECTRICITY_RATE_KWH=0.10`}
          </pre>
        </div>
      </div>
      <p className="text-[10px] text-zinc-600 text-center">
        Add these to your <code className="text-zinc-400">.env.local</code> file and redeploy. The Vault auto-detects everything.
      </p>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

export default function VaultPage() {
  const [data, setData] = useState<VaultData | null>(null);
  const [yieldData, setYieldData] = useState<YieldData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'overview' | 'wallets' | 'mining' | 'yields' | 'setup'>('overview');

  const fetchData = useCallback(async () => {
    try {
      const [vaultRes, yieldRes] = await Promise.all([
        fetch('/api/vault', { credentials: 'include' }),
        fetch('/api/vault/yields', { credentials: 'include' }).catch(() => null),
      ]);
      if (vaultRes.status === 401) {
        window.location.href = '/login?redirectTo=/vault';
        return;
      }
      if (!vaultRes.ok) throw new Error('Failed to load');
      setData(await vaultRes.json());
      if (yieldRes?.ok) setYieldData(await yieldRes.json());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: '📊' },
    { id: 'wallets' as const, label: 'Wallets', icon: '💰' },
    { id: 'mining' as const, label: 'Mining', icon: '⛏️' },
    { id: 'yields' as const, label: 'Yields', icon: '📈' },
    { id: 'setup' as const, label: 'Setup', icon: '⚙️' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#0a051e] to-[#030108] p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80">Financial Command Center</p>
            <h1 className="mt-1 text-3xl md:text-5xl font-black bg-gradient-to-r from-amber-300 via-purple-400 to-cyan-300 bg-clip-text text-transparent">
              The Vault
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Every wallet, every miner, every position — one unified view.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <Link href="/" className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-400 hover:text-white transition">
              ← Home
            </Link>
            <Link href="/dashboard" className="rounded-full border border-purple-500/30 px-3 py-1 text-purple-300 hover:bg-purple-500/10 transition">
              Dashboard
            </Link>
            <button onClick={fetchData} className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-400 hover:text-white transition">
              ↻ Refresh
            </button>
          </div>
        </header>

        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                tab === t.id ? 'bg-purple-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {data && !loading && (
          <>
            {/* ── Overview Tab ── */}
            {tab === 'overview' && (
              <div className="space-y-6">
                {/* Net Worth Banner */}
                <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-950/20 to-purple-950/20 p-6 text-center">
                  <p className="text-xs uppercase tracking-widest text-amber-400/60">Total Net Worth</p>
                  <p className="mt-2 text-4xl md:text-6xl font-black text-white">
                    {fmt(data.netWorth)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Last updated {new Date(data.lastUpdated).toLocaleTimeString()}
                  </p>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Wallets', value: `${data.wallets.total}`, sub: fmt(data.wallets.totalUSD), color: 'border-blue-500/30' },
                    { label: 'Mining Rigs', value: `${data.mining.onlineDevices}/${data.mining.totalDevices}`, sub: `${data.mining.totalHashrate.toFixed(1)} ${data.mining.totalHashrateUnit}`, color: 'border-orange-500/30' },
                    { label: 'Trading P&L', value: fmt(data.treasury.lifetimePnL), sub: `${data.treasury.winRate.toFixed(1)}% win rate`, color: 'border-emerald-500/30' },
                    { label: 'Mining Profit', value: fmt(data.mining.profitDaily) + '/day', sub: `${data.mining.totalPower}W total`, color: 'border-amber-500/30' },
                  ].map((s) => (
                    <div key={s.label} className={`rounded-xl border ${s.color} bg-black/30 p-4`}>
                      <p className="text-[10px] uppercase tracking-widest text-zinc-500">{s.label}</p>
                      <p className="mt-1 text-xl font-bold text-white">{s.value}</p>
                      <p className="text-xs text-zinc-500">{s.sub}</p>
                    </div>
                  ))}
                </div>

                {/* Breakdown */}
                {data.breakdown.length > 0 && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
                    <h3 className="text-sm font-bold text-white mb-4">Portfolio Breakdown</h3>
                    <div className="space-y-3">
                      {data.breakdown.map((b) => (
                        <div key={b.category}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-zinc-300">{b.category}</span>
                            <span className="text-zinc-500">{fmt(b.usd)} ({b.pct.toFixed(1)}%)</span>
                          </div>
                          <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-purple-500 to-amber-500 transition-all duration-500"
                              style={{ width: `${Math.min(b.pct, 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Wallet List (compact) */}
                {data.wallets.list.length > 0 && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
                    <h3 className="text-sm font-bold text-white mb-3">Connected Wallets</h3>
                    <div className="space-y-2">
                      {data.wallets.list.map((w, i) => {
                        const style = CHAIN_STYLES[w.chain] || { color: 'text-zinc-400 border-zinc-600/30', icon: '?' };
                        return (
                          <div key={i} className={`flex items-center justify-between rounded-xl border ${style.color} bg-black/20 px-4 py-3`}>
                            <div className="flex items-center gap-3">
                              <span className="text-lg">{style.icon}</span>
                              <div>
                                <p className="text-sm font-semibold text-white">{w.label}</p>
                                <p className="text-[10px] text-zinc-600 font-mono">{shortAddr(w.address)}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-bold text-white">{w.nativeBalance.toFixed(4)} {w.nativeSymbol}</p>
                              <p className="text-[10px] text-zinc-500">{fmt(w.nativeUSD)}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {data.wallets.total === 0 && data.mining.totalDevices === 0 && (
                  <SetupGuide />
                )}
              </div>
            )}

            {/* ── Wallets Tab ── */}
            {tab === 'wallets' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-blue-500/20 bg-blue-950/10 p-5 text-center">
                  <p className="text-xs uppercase tracking-widest text-blue-400/60">Total Wallet Value</p>
                  <p className="mt-2 text-3xl font-black text-white">{fmt(data.wallets.totalUSD)}</p>
                  <p className="text-xs text-zinc-500">{data.wallets.total} wallets across {new Set(data.wallets.list.map(w => w.chain)).size} chains</p>
                </div>

                {data.wallets.list.length === 0 ? (
                  <SetupGuide />
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {data.wallets.list.map((w, i) => {
                      const style = CHAIN_STYLES[w.chain] || { color: 'text-zinc-400 border-zinc-600/30', icon: '?' };
                      return (
                        <div key={i} className={`rounded-2xl border ${style.color} bg-black/20 p-5`}>
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                              <span className="text-2xl">{style.icon}</span>
                              <div>
                                <p className="text-sm font-bold text-white">{w.label}</p>
                                <p className="text-[10px] text-zinc-600 capitalize">{w.chain}</p>
                              </div>
                            </div>
                            <p className="text-lg font-black text-white">{fmt(w.totalUSD)}</p>
                          </div>
                          <div className="rounded-xl bg-zinc-900/50 p-3">
                            <div className="flex justify-between text-xs">
                              <span className="text-zinc-500">Balance</span>
                              <span className="text-white font-mono">{w.nativeBalance.toFixed(6)} {w.nativeSymbol}</span>
                            </div>
                            <div className="flex justify-between text-xs mt-1">
                              <span className="text-zinc-500">Address</span>
                              <span className="text-zinc-400 font-mono">{shortAddr(w.address)}</span>
                            </div>
                          </div>
                          {w.tokens.length > 0 && (
                            <div className="mt-3 space-y-1">
                              {w.tokens.map((t, j) => (
                                <div key={j} className="flex justify-between text-xs px-1">
                                  <span className="text-zinc-400">{t.symbol}</span>
                                  <span className="text-zinc-300">{t.balance.toFixed(4)} ({fmt(t.usdValue)})</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Mining Tab ── */}
            {tab === 'mining' && (
              <div className="space-y-4">
                {/* Mining Summary */}
                <div className="rounded-2xl border border-orange-500/20 bg-orange-950/10 p-5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                    {[
                      { label: 'Total Hashrate', value: `${data.mining.totalHashrate.toFixed(1)} ${data.mining.totalHashrateUnit}` },
                      { label: 'Power Draw', value: `${data.mining.totalPower}W` },
                      { label: 'Daily Profit', value: fmt(data.mining.profitDaily) },
                      { label: 'Avg Temperature', value: `${data.mining.avgTemperature}°C` },
                    ].map((s) => (
                      <div key={s.label}>
                        <p className="text-[10px] uppercase tracking-widest text-orange-400/60">{s.label}</p>
                        <p className="mt-1 text-xl font-bold text-white">{s.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs">
                    <div className="rounded-lg bg-black/30 p-2">
                      <p className="text-zinc-500">Revenue/day</p>
                      <p className="text-emerald-300 font-bold">{fmt(data.mining.estimatedDailyUSD)}</p>
                    </div>
                    <div className="rounded-lg bg-black/30 p-2">
                      <p className="text-zinc-500">Electric/day</p>
                      <p className="text-red-300 font-bold">-{fmt(data.mining.electricityCostDaily)}</p>
                    </div>
                    <div className="rounded-lg bg-black/30 p-2">
                      <p className="text-zinc-500">Monthly est.</p>
                      <p className="text-amber-300 font-bold">{fmt(data.mining.estimatedMonthlyUSD)}</p>
                    </div>
                  </div>
                </div>

                {/* Device List */}
                {data.mining.devices.length > 0 ? (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
                    <h3 className="text-sm font-bold text-white mb-3">Mining Devices</h3>
                    <div className="space-y-3">
                      {data.mining.devices.map((d) => (
                        <div key={d.id} className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                          d.status === 'online' ? 'border-emerald-500/30 bg-emerald-950/10' :
                          d.status === 'warning' ? 'border-amber-500/30 bg-amber-950/10' :
                          'border-red-500/30 bg-red-950/10'
                        }`}>
                          <div className="flex items-center gap-3">
                            <span className={`h-2.5 w-2.5 rounded-full ${
                              d.status === 'online' ? 'bg-emerald-400' :
                              d.status === 'warning' ? 'bg-amber-400' : 'bg-red-400'
                            }`} />
                            <div>
                              <p className="text-sm font-semibold text-white">{d.name}</p>
                              <p className="text-[10px] text-zinc-500">{d.model} • {d.type.toUpperCase()}</p>
                            </div>
                          </div>
                          <div className="flex gap-4 text-xs text-zinc-400">
                            <span>{d.hashrate.toFixed(1)} {d.hashrateUnit}</span>
                            <span>{d.temperature}°C</span>
                            <span>{d.power}W</span>
                            <span className={d.status === 'online' ? 'text-emerald-400' : 'text-red-400'}>
                              {d.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6 text-center">
                    <p className="text-3xl mb-3">⛏️</p>
                    <p className="text-sm font-bold text-white mb-1">No Mining Devices Connected</p>
                    <p className="text-xs text-zinc-500 mb-4">
                      Connect your ASIC miners and GPU rigs to monitor hashrate, power, temperature, and profitability in real-time.
                    </p>
                    <button
                      onClick={() => setTab('setup')}
                      className="rounded-xl bg-orange-600 px-4 py-2 text-xs font-bold text-white hover:bg-orange-500 transition"
                    >
                      Setup Mining Monitor
                    </button>
                  </div>
                )}

                {/* Pool List */}
                {data.mining.pools.length > 0 && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
                    <h3 className="text-sm font-bold text-white mb-3">Mining Pools</h3>
                    <div className="grid gap-3 md:grid-cols-2">
                      {data.mining.pools.map((p) => (
                        <div key={p.id} className="rounded-xl border border-zinc-800 bg-black/20 p-4">
                          <div className="flex justify-between items-center mb-2">
                            <p className="text-sm font-semibold text-white">{p.name}</p>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              p.status === 'connected' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                            }`}>
                              {p.status}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div><span className="text-zinc-500">Coin:</span> <span className="text-white">{p.coin}</span></div>
                            <div><span className="text-zinc-500">Workers:</span> <span className="text-white">{p.workers}</span></div>
                            <div><span className="text-zinc-500">Unpaid:</span> <span className="text-amber-300">{p.unpaidBalance.toFixed(6)}</span></div>
                            <div><span className="text-zinc-500">Est. Daily:</span> <span className="text-emerald-300">{fmt(p.estimatedDaily)}</span></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Yields Tab ── */}
            {tab === 'yields' && (
              <div className="space-y-4">
                {/* Yield Market Summary */}
                {yieldData?.marketSummary && (
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-5">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
                      {[
                        { label: 'Avg DeFi Yield', value: `${yieldData.marketSummary.avgDeFiYield.toFixed(1)}%` },
                        { label: 'Avg Stablecoin', value: `${yieldData.marketSummary.avgStablecoinYield.toFixed(1)}%` },
                        { label: 'Avg Funding Rate', value: `${yieldData.marketSummary.avgFundingRate.toFixed(2)}%` },
                        { label: 'Total TVL', value: yieldData.marketSummary.totalTVL > 1e9 ? `$${(yieldData.marketSummary.totalTVL / 1e9).toFixed(1)}B` : `$${(yieldData.marketSummary.totalTVL / 1e6).toFixed(0)}M` },
                        { label: 'Yield Trend', value: yieldData.marketSummary.yieldTrend === 'rising' ? '📈 Rising' : yieldData.marketSummary.yieldTrend === 'falling' ? '📉 Falling' : '➡️ Stable' },
                      ].map((s) => (
                        <div key={s.label}>
                          <p className="text-[10px] uppercase tracking-widest text-emerald-400/60">{s.label}</p>
                          <p className="mt-1 text-xl font-bold text-white">{s.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Yield Arbitrage Opportunities */}
                {yieldData && yieldData.spreads.length > 0 && (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-950/10 p-5">
                    <h3 className="text-sm font-bold text-amber-300 mb-3">⚡ Yield Spread Opportunities</h3>
                    <div className="space-y-2">
                      {yieldData.spreads.slice(0, 5).map((s, i) => (
                        <div key={i} className="rounded-xl border border-zinc-800 bg-black/20 p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold text-white">{s.asset}</span>
                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                              +{(s.spread / 100).toFixed(1)}% spread
                            </span>
                          </div>
                          <p className="text-[10px] text-zinc-400">{s.opportunity}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top Yields Table */}
                {yieldData && yieldData.topYields.length > 0 && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
                    <h3 className="text-sm font-bold text-white mb-3">Top DeFi Yields (Live from DeFi Llama)</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-zinc-500 border-b border-zinc-800">
                            <th className="pb-2 pr-3">Protocol</th>
                            <th className="pb-2 pr-3">Chain</th>
                            <th className="pb-2 pr-3">Asset</th>
                            <th className="pb-2 pr-3 text-right">APY</th>
                            <th className="pb-2 pr-3 text-right">7d Avg</th>
                            <th className="pb-2 pr-3 text-right">TVL</th>
                            <th className="pb-2 text-right">Risk</th>
                          </tr>
                        </thead>
                        <tbody>
                          {yieldData.topYields.map((y, i) => (
                            <tr key={i} className="border-b border-zinc-800/50">
                              <td className="py-2 pr-3 font-semibold text-white">{y.protocol}</td>
                              <td className="py-2 pr-3 text-zinc-400">{y.chain}</td>
                              <td className="py-2 pr-3 text-zinc-300">{y.asset}</td>
                              <td className="py-2 pr-3 text-right font-bold text-emerald-400">{y.apy.toFixed(1)}%</td>
                              <td className="py-2 pr-3 text-right text-zinc-400">{y.apy7d.toFixed(1)}%</td>
                              <td className="py-2 pr-3 text-right text-zinc-400">
                                {y.tvl > 1e9 ? `$${(y.tvl / 1e9).toFixed(1)}B` : y.tvl > 1e6 ? `$${(y.tvl / 1e6).toFixed(0)}M` : `$${(y.tvl / 1e3).toFixed(0)}K`}
                              </td>
                              <td className="py-2 text-right">
                                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                                  y.risk === 'low' ? 'bg-emerald-500/15 text-emerald-400' :
                                  y.risk === 'medium' ? 'bg-amber-500/15 text-amber-400' :
                                  'bg-red-500/15 text-red-400'
                                }`}>{y.risk}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Stablecoin Yields */}
                {yieldData && yieldData.stablecoinYields.length > 0 && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
                    <h3 className="text-sm font-bold text-white mb-3">💵 Stablecoin Yields</h3>
                    <div className="grid gap-2 md:grid-cols-2">
                      {yieldData.stablecoinYields.map((y, i) => (
                        <div key={i} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-black/20 px-4 py-2.5">
                          <div>
                            <p className="text-xs font-semibold text-white">{y.protocol} <span className="text-zinc-500">({y.chain})</span></p>
                            <p className="text-[10px] text-zinc-600">{y.asset}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-emerald-400">{y.apy.toFixed(2)}%</p>
                            <p className="text-[10px] text-zinc-600">TVL {y.tvl > 1e6 ? `$${(y.tvl / 1e6).toFixed(0)}M` : `$${(y.tvl / 1e3).toFixed(0)}K`}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(!yieldData || yieldData.topYields.length === 0) && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6 text-center">
                    <p className="text-3xl mb-3">📈</p>
                    <p className="text-sm font-bold text-white mb-1">Loading Yield Data...</p>
                    <p className="text-xs text-zinc-500">Fetching live yields from DeFi Llama across all protocols and chains.</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Setup Tab ── */}
            {tab === 'setup' && (
              <div className="space-y-6">
                <SetupGuide />

                {/* Supported integrations */}
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
                  <h3 className="text-sm font-bold text-white mb-4">Supported Integrations</h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                      { name: 'Bitcoin (BTC)', type: 'Wallet', status: 'Ready', icon: '₿' },
                      { name: 'Ethereum + L2s', type: 'Wallet', status: 'Ready', icon: 'Ξ' },
                      { name: 'Solana (SOL)', type: 'Wallet', status: 'Ready', icon: '◎' },
                      { name: 'MultiversX (EGLD)', type: 'Wallet', status: 'Ready', icon: '✕' },
                      { name: 'Coinbase', type: 'Exchange', status: 'Ready', icon: '📈' },
                      { name: 'Kraken', type: 'Exchange', status: 'Ready', icon: '🐙' },
                      { name: 'Antminer (S19/S21)', type: 'ASIC Miner', status: 'Ready', icon: '⛏️' },
                      { name: 'Whatsminer (M50/M60)', type: 'ASIC Miner', status: 'Ready', icon: '⛏️' },
                      { name: 'GPU Rigs', type: 'GPU Mining', status: 'Ready', icon: '🖥️' },
                      { name: 'F2Pool', type: 'Mining Pool', status: 'Ready', icon: '🏊' },
                      { name: 'Braiins / Slush', type: 'Mining Pool', status: 'Ready', icon: '🏊' },
                      { name: 'NiceHash', type: 'Mining Pool', status: 'Ready', icon: '🏊' },
                      { name: 'Antpool', type: 'Mining Pool', status: 'Ready', icon: '🏊' },
                      { name: 'ViaBTC', type: 'Mining Pool', status: 'Ready', icon: '🏊' },
                      { name: 'Aave V3', type: 'DeFi', status: 'Ready', icon: '🏦' },
                      { name: 'Compound V3', type: 'DeFi', status: 'Ready', icon: '🏦' },
                      { name: 'Alpaca Markets', type: 'Stocks', status: 'Ready', icon: '📊' },
                      { name: 'Interactive Brokers', type: 'Stocks', status: 'Ready', icon: '📊' },
                    ].map((item) => (
                      <div key={item.name} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-black/20 p-3">
                        <span className="text-xl">{item.icon}</span>
                        <div className="flex-1">
                          <p className="text-xs font-semibold text-white">{item.name}</p>
                          <p className="text-[10px] text-zinc-600">{item.type}</p>
                        </div>
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                          {item.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
