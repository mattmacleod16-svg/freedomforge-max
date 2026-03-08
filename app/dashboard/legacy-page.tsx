'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatUnits } from 'ethers';

interface TokenInfo {
  balance: string | null;
  symbol?: string;
  decimals?: number;
}

interface WalletInfo {
  address: string | null;
  balance: string | null;
  recipients: string[];
  tokenBalances?: Record<string, TokenInfo>;
}

interface MetricsInfo {
  lookbackHours: number;
  walletBalanceWei: string;
  payoutsWei: string;
  withdrawalsWei: string;
  topupsWei: string;
  estimatedRevenueInflowWei: string;
  transferSuccess: number;
  transferFailed: number;
  transferSuccessRate: number;
  topupCount: number;
  topupErrorCount: number;
  skipCount: number;
  distributionRuns: number;
}

interface WalletLog {
  time?: string;
  type?: string;
  event?: string;
}

interface StatusInfo {
  market?: {
    latest?: {
      confidence?: number;
      geopoliticalRisk?: number;
      regime?: string;
    };
  };
  forecast?: {
    unresolved?: number;
  };
}

function weiToEth(value?: string | null) {
  if (!value) return 0;
  try {
    return Number(formatUnits(value, 18));
  } catch {
    return 0;
  }
}

function asPct(value: number) {
  return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
}

function buildHourlySeries(logs: WalletLog[], hours = 24) {
  const now = Date.now();
  const buckets = Array.from({ length: hours }, (_, index) => {
    const start = now - (hours - index) * 60 * 60 * 1000;
    return { label: new Date(start).getHours().toString().padStart(2, '0'), count: 0, ts: start };
  });

  for (const log of logs) {
    const ts = Date.parse(log.time || '');
    if (!Number.isFinite(ts)) continue;
    if (ts < now - hours * 60 * 60 * 1000) continue;
    const slot = Math.floor((ts - (now - hours * 60 * 60 * 1000)) / (60 * 60 * 1000));
    if (slot >= 0 && slot < buckets.length) {
      buckets[slot].count += 1;
    }
  }

  return buckets;
}

function buildDailySeries(logs: WalletLog[], days = 7) {
  const now = new Date();
  const buckets = Array.from({ length: days }, (_, index) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (days - 1 - index));
    const key = d.toISOString().slice(0, 10);
    return { key, label: d.toLocaleDateString(undefined, { weekday: 'short' }), count: 0 };
  });

  const map = new Map(buckets.map((b) => [b.key, b]));
  for (const log of logs) {
    const ts = Date.parse(log.time || '');
    if (!Number.isFinite(ts)) continue;
    const key = new Date(ts).toISOString().slice(0, 10);
    const bucket = map.get(key);
    if (bucket) bucket.count += 1;
  }

  return buckets;
}

export default function DashboardPage() {
  const router = useRouter();
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [metrics, setMetrics] = useState<MetricsInfo | null>(null);
  const [logs, setLogs] = useState<WalletLog[]>([]);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [latestAlert, setLatestAlert] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchWallet = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/alchemy/wallet');
      const data = await res.json();
      setWallet(data);
    } catch (e) {
      console.error('fetch wallet failed', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchMetrics = async () => {
    try {
      const res = await fetch('/api/status/metrics?format=json', { cache: 'no-store' });
      const data = await res.json();
      setMetrics(data);
    } catch (e) {
      console.error('fetch metrics failed', e);
    }
  };

  const fetchAlert = async () => {
    try {
      const res = await fetch('/api/alchemy/wallet/alerts');
      const { alert } = await res.json();
      if (alert && alert.message) {
        setLatestAlert(`${new Date(alert.time).toLocaleString()}: ${alert.message}`);
      }
    } catch (e) {
      console.error('fetch alert failed', e);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/alchemy/wallet/logs?limit=500', { cache: 'no-store' });
      const data = await res.json();
      setLogs(Array.isArray(data?.logs) ? data.logs : []);
    } catch (e) {
      console.error('fetch logs failed', e);
    }
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.error('fetch status failed', e);
    }
  };

  useEffect(() => {
    fetchWallet();
    fetchAlert();
    fetchMetrics();
    fetchLogs();
    fetchStatus();
    const id = setInterval(() => {
      fetchWallet();
      fetchAlert();
      fetchMetrics();
      fetchLogs();
      fetchStatus();
    }, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const keepAlive = async () => {
      try {
        const res = await fetch('/api/auth/session', { cache: 'no-store' });
        const data = await res.json();
        if (!data?.authenticated) {
          router.replace('/login?next=/dashboard');
        }
      } catch {
        // no-op
      }
    };

    keepAlive();
    const id = setInterval(keepAlive, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [router]);

  const walletEth = weiToEth(metrics?.walletBalanceWei);
  const inflowEth = weiToEth(metrics?.estimatedRevenueInflowWei);
  const payoutsEth = weiToEth(metrics?.payoutsWei);
  const withdrawalsEth = weiToEth(metrics?.withdrawalsWei);
  const topupsEth = weiToEth(metrics?.topupsWei);

  const deployedEth = payoutsEth + withdrawalsEth;
  const totalTrackedEth = Math.max(0.0000001, walletEth + payoutsEth + withdrawalsEth + topupsEth);
  const retainedPct = (walletEth / totalTrackedEth) * 100;
  const deployedPct = (deployedEth / totalTrackedEth) * 100;
  const topupPct = (topupsEth / totalTrackedEth) * 100;
  const successPct = (metrics?.transferSuccessRate || 0) * 100;

  const hourlySeries = buildHourlySeries(logs, 24);
  const hourlyMax = Math.max(1, ...hourlySeries.map((point) => point.count));
  const polylinePoints = hourlySeries
    .map((point, index) => {
      const x = (index / Math.max(1, hourlySeries.length - 1)) * 100;
      const y = 100 - (point.count / hourlyMax) * 100;
      return `${x},${y}`;
    })
    .join(' ');

  const dailySeries = buildDailySeries(logs, 7);
  const dailyMax = Math.max(1, ...dailySeries.map((point) => point.count));

  const marketConfidencePct = Math.max(0, Math.min(100, (status?.market?.latest?.confidence || 0) * 100));
  const geoRiskPct = Math.max(0, Math.min(100, (status?.market?.latest?.geopoliticalRisk || 0) * 100));
  const unresolvedForecasts = status?.forecast?.unresolved || 0;

  const eventTotals = logs.reduce(
    (acc, log) => {
      const t = log.type || log.event || 'other';
      if (t.includes('forecast')) acc.forecast += 1;
      else if (t.includes('distribution') || t.includes('transfer') || t.includes('withdraw')) acc.execution += 1;
      else if (t.includes('autonomy') || t.includes('xai') || t.includes('ensemble')) acc.decision += 1;
      else acc.other += 1;
      return acc;
    },
    { forecast: 0, execution: 0, decision: 0, other: 0 }
  );
  const totalEvents = Math.max(1, eventTotals.forecast + eventTotals.execution + eventTotals.decision + eventTotals.other);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-zinc-950 to-black p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8 flex items-center justify-between gap-4">
          <h1 className="text-4xl font-black text-orange-400">🚀 FreedomForge Max Revenue Monitor</h1>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:border-orange-500 hover:text-orange-300"
          >
            Logout
          </button>
        </div>

        <div className="grid gap-6">
          {/* KPI + Charts */}
          {metrics && (
            <div className="bg-zinc-900 border border-emerald-500/30 rounded-2xl p-6 space-y-5">
              <h2 className="text-2xl font-bold text-emerald-300">📊 Investment & Performance Metrics</h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-zinc-700 bg-black/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Estimated Total Managed ({metrics.lookbackHours}h)</p>
                  <p className="mt-1 text-2xl font-bold text-white">{inflowEth.toFixed(6)} ETH</p>
                </div>
                <div className="rounded-xl border border-zinc-700 bg-black/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Capital Deployed (Payouts + Withdrawals)</p>
                  <p className="mt-1 text-2xl font-bold text-white">{deployedEth.toFixed(6)} ETH</p>
                </div>
                <div className="rounded-xl border border-zinc-700 bg-black/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Current Wallet Retained</p>
                  <p className="mt-1 text-2xl font-bold text-green-400">{walletEth.toFixed(6)} ETH</p>
                  <p className="text-sm text-zinc-400">{asPct(retainedPct)} of tracked total</p>
                </div>
                <div className="rounded-xl border border-zinc-700 bg-black/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-400">Transfer Success Rate</p>
                  <p className="mt-1 text-2xl font-bold text-blue-300">{asPct(successPct)}</p>
                  <p className="text-sm text-zinc-400">{metrics.transferSuccess} success / {metrics.transferFailed} failed</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="rounded-xl border border-zinc-700 bg-black/30 p-4 space-y-3">
                  <h3 className="font-semibold text-white">Allocation Mix</h3>
                  <div>
                    <div className="flex justify-between text-xs text-zinc-300"><span>Retained</span><span>{asPct(retainedPct)}</span></div>
                    <div className="mt-1 h-2 bg-zinc-800 rounded"><div className="h-2 bg-green-500 rounded" style={{ width: asPct(retainedPct) }} /></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-zinc-300"><span>Deployed</span><span>{asPct(deployedPct)}</span></div>
                    <div className="mt-1 h-2 bg-zinc-800 rounded"><div className="h-2 bg-orange-500 rounded" style={{ width: asPct(deployedPct) }} /></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-zinc-300"><span>Topups</span><span>{asPct(topupPct)}</span></div>
                    <div className="mt-1 h-2 bg-zinc-800 rounded"><div className="h-2 bg-purple-500 rounded" style={{ width: asPct(topupPct) }} /></div>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-700 bg-black/30 p-4 space-y-3">
                  <h3 className="font-semibold text-white">Operations Health</h3>
                  <div className="text-sm text-zinc-300 flex items-center justify-between">
                    <span>Distribution Runs</span>
                    <span className="font-mono text-white">{metrics.distributionRuns}</span>
                  </div>
                  <div className="text-sm text-zinc-300 flex items-center justify-between">
                    <span>Skipped Runs</span>
                    <span className="font-mono text-white">{metrics.skipCount}</span>
                  </div>
                  <div className="text-sm text-zinc-300 flex items-center justify-between">
                    <span>Topups / Errors</span>
                    <span className="font-mono text-white">{metrics.topupCount} / {metrics.topupErrorCount}</span>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-zinc-300"><span>Transfer Success</span><span>{asPct(successPct)}</span></div>
                    <div className="mt-1 h-2 bg-zinc-800 rounded"><div className="h-2 bg-sky-500 rounded" style={{ width: asPct(successPct) }} /></div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="rounded-xl border border-zinc-700 bg-black/30 p-4 space-y-3">
                  <h3 className="font-semibold text-white">24h Activity Trend</h3>
                  <div className="h-40 w-full rounded bg-zinc-950/60 p-2">
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
                      <polyline
                        fill="none"
                        stroke="rgb(56 189 248)"
                        strokeWidth="2"
                        points={polylinePoints}
                      />
                    </svg>
                  </div>
                  <div className="flex justify-between text-xs text-zinc-400">
                    <span>{hourlySeries[0]?.label || '00'}h</span>
                    <span>Peak {hourlyMax} evt/hr</span>
                    <span>{hourlySeries[hourlySeries.length - 1]?.label || '23'}h</span>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-700 bg-black/30 p-4 space-y-3">
                  <h3 className="font-semibold text-white">7d Activity Volume</h3>
                  <div className="h-40 flex items-end gap-2">
                    {dailySeries.map((point) => {
                      const heightPct = Math.max(6, (point.count / dailyMax) * 100);
                      return (
                        <div key={point.key} className="flex-1 flex flex-col items-center justify-end gap-1">
                          <div className="w-full bg-indigo-500/80 rounded-t" style={{ height: `${heightPct}%` }} />
                          <span className="text-[10px] text-zinc-400">{point.label}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-xs text-zinc-400">Total events (7d): {dailySeries.reduce((sum, p) => sum + p.count, 0)}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="rounded-xl border border-zinc-700 bg-black/30 p-4 space-y-3">
                  <h3 className="font-semibold text-white">Signal Gauges</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-center">
                      <div
                        className="mx-auto h-20 w-20 rounded-full"
                        style={{
                          background: `conic-gradient(rgb(16 185 129) ${marketConfidencePct}%, rgb(39 39 42) ${marketConfidencePct}% 100%)`,
                        }}
                      >
                        <div className="m-[6px] flex h-[calc(100%-12px)] w-[calc(100%-12px)] items-center justify-center rounded-full bg-black text-xs font-bold text-white">
                          {asPct(marketConfidencePct)}
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-zinc-300">Market Confidence</p>
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-center">
                      <div
                        className="mx-auto h-20 w-20 rounded-full"
                        style={{
                          background: `conic-gradient(rgb(244 63 94) ${geoRiskPct}%, rgb(39 39 42) ${geoRiskPct}% 100%)`,
                        }}
                      >
                        <div className="m-[6px] flex h-[calc(100%-12px)] w-[calc(100%-12px)] items-center justify-center rounded-full bg-black text-xs font-bold text-white">
                          {asPct(geoRiskPct)}
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-zinc-300">Geopolitical Risk</p>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-400">Regime: {(status?.market?.latest?.regime || 'unknown').toUpperCase()} · Unresolved forecasts: {unresolvedForecasts}</p>
                </div>

                <div className="rounded-xl border border-zinc-700 bg-black/30 p-4 space-y-3">
                  <h3 className="font-semibold text-white">Event Composition</h3>
                  <div>
                    <div className="flex justify-between text-xs text-zinc-300"><span>Forecast</span><span>{eventTotals.forecast}</span></div>
                    <div className="mt-1 h-2 bg-zinc-800 rounded"><div className="h-2 bg-cyan-500 rounded" style={{ width: `${(eventTotals.forecast / totalEvents) * 100}%` }} /></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-zinc-300"><span>Decision</span><span>{eventTotals.decision}</span></div>
                    <div className="mt-1 h-2 bg-zinc-800 rounded"><div className="h-2 bg-fuchsia-500 rounded" style={{ width: `${(eventTotals.decision / totalEvents) * 100}%` }} /></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-zinc-300"><span>Execution</span><span>{eventTotals.execution}</span></div>
                    <div className="mt-1 h-2 bg-zinc-800 rounded"><div className="h-2 bg-amber-500 rounded" style={{ width: `${(eventTotals.execution / totalEvents) * 100}%` }} /></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-zinc-300"><span>Other</span><span>{eventTotals.other}</span></div>
                    <div className="mt-1 h-2 bg-zinc-800 rounded"><div className="h-2 bg-zinc-500 rounded" style={{ width: `${(eventTotals.other / totalEvents) * 100}%` }} /></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Wallet Info */}
          <div className="bg-zinc-900 border border-orange-500/30 rounded-2xl p-6">
            <h2 className="text-2xl font-bold text-white mb-4">💰 Revenue Wallet</h2>
            {loading ? (
              <p className="text-gray-400">Loading...</p>
            ) : wallet ? (
              <div className="space-y-3">
                <p className="text-gray-300">
                  <strong>Address:</strong> <code className="text-orange-400 break-all">{wallet.address}</code>
                </p>
                <p className="text-gray-300">
                  <strong>Balance:</strong>{' '}
                  <span className="text-green-400 font-mono">
                    {wallet.balance
                      ? `${(parseFloat(wallet.balance) / 1e18).toFixed(6)} ETH`
                      : '—'}
                  </span>
                </p>
                <p className="text-gray-300">
                  <strong>Recipients:</strong> {wallet.recipients.length > 0 ? wallet.recipients.join(', ') : 'None configured'}
                </p>
                {wallet.tokenBalances && Object.keys(wallet.tokenBalances).length > 0 && (
                  <div className="pt-2">
                    <strong className="text-gray-300">Token Balances:</strong>
                    <ul className="list-disc list-inside text-gray-300 ml-4">
                      {Object.entries(wallet.tokenBalances).map(([addr, info]) => {
                        let display = '—';
                        if (info.balance) {
                          if (info.decimals !== undefined) {
                            try {
                              display = formatUnits(info.balance, info.decimals);
                            } catch {
                              display = info.balance;
                            }
                          } else {
                            display = info.balance;
                          }
                          if (info.symbol) display += ` ${info.symbol}`;
                        }
                        return (
                          <li key={addr}>
                            <code className="text-orange-400 break-all">{info.symbol || addr}</code>: {display}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-red-400">Failed to load wallet data</p>
            )}
          </div>

          {/* Latest Alert */}
          {latestAlert && (
            <div className="bg-red-900/30 border border-red-500/50 rounded-2xl p-6">
              <h2 className="text-2xl font-bold text-red-400 mb-2">⚠️ Latest Alert</h2>
              <p className="text-gray-200">{latestAlert}</p>
            </div>
          )}

          {/* Logs Link */}
          <div className="bg-zinc-900 border border-blue-500/30 rounded-2xl p-6">
            <h2 className="text-2xl font-bold text-blue-400 mb-4">📝 Logs</h2>
            <p className="text-gray-300 mb-4">View detailed transaction logs:</p>
            <a
              href="/api/alchemy/wallet/logs?limit=50"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded font-bold text-white"
            >
              View Recent Logs
            </a>
          </div>

          {/* Instructions */}
          <div className="bg-zinc-900 border border-gray-500/30 rounded-2xl p-6">
            <h2 className="text-2xl font-bold text-white mb-4">📌 Setup Instructions</h2>
            <ol className="space-y-2 text-gray-300 list-decimal list-inside">
              <li>Fund the wallet address above with Base ETH</li>
              <li>Revenue will begin flowing to your recipient address automatically</li>
              <li>Check logs or alerts for transaction details</li>
              <li>System runs 24/7 with automatic gas top-ups (if configured)</li>              <li>If you set `TRACKED_TOKENS`, their balances show above</li>            </ol>
          </div>

          {/* Refresh Button */}
          <button
            onClick={() => {
              fetchWallet();
              fetchAlert();
              fetchMetrics();
              fetchLogs();
              fetchStatus();
            }}
            className="px-6 py-3 bg-orange-600 hover:bg-orange-700 rounded-xl text-white font-bold"
          >
            🔄 Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
