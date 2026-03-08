'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Filler, Tooltip, Legend);

/* ─── Types ───────────────────────────────────────────────────────────────── */
interface EmpireData {
  ts: string;
  portfolio: {
    totalUsd: number;
    coinbaseUsd: number;
    krakenUsd: number;
    unrealizedPnl: number;
    realizedPnl: number;
    totalFees: number;
    netPnl: number;
  };
  trades: {
    total: number;
    closed: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnl: number;
    avgPnl: number;
    totalVolume: number;
    dryRunCount: number;
    liveCount: number;
  };
  venueStats: Record<string, { trades: number; pnl: number; volume: number; wins: number; losses: number }>;
  assetStats: Record<string, { trades: number; pnl: number; volume: number; avgConfidence: number }>;
  tradeTimeline: Array<{
    ts: number;
    time: string;
    asset: string;
    venue: string;
    side: string;
    usdSize: number;
    confidence: number;
    edge: number;
    pnl: number | null;
    outcome: string | null;
    dryRun: boolean;
  }>;
  pnlHistory: Array<{ ts: number; time: string; cumPnl: number; pnl: number }>;
  volumeByDay: Record<string, number>;
  confidenceDistribution: { labels: string[]; values: number[] };
  guardian: {
    lastCheck: number;
    coinbase: {
      marginPct: number;
      liquidationBuffer: number;
      totalBalance: number;
      initialMargin: number;
      unrealizedPnl: number;
      positions: Array<{ productId: string; side: string; contracts: number; unrealizedPnl: number }>;
      healthy: boolean;
    };
    kraken: {
      marginPct: number;
      equity: number;
      marginUsed: number;
      freeMargin: number;
      unrealizedPnl: number;
      positions: any[];
      healthy: boolean;
    };
    emergencyCloses: number;
    blockedTrades: number;
    actions: any[];
  };
  risk: {
    killSwitchActive: boolean;
    peakEquity: number;
    currentEquity: number;
    drawdownPct: number;
    dailyPnl: { date: string; pnl: number };
    positions: number;
    recentEvents: any[];
  };
  signalBus: {
    totalActive: number;
    types: Record<string, number>;
    sources: Record<string, number>;
  };
  orchestrator: {
    cycleCount: number;
    totalTrades: number;
    lastRun: string | null;
    errors: any[];
  };
  brain: {
    generation: number;
    lastEvolved: string | null;
    topIndicators: Array<{ indicator: string; weight: number }>;
    assetProfiles: number;
    confidenceCalibration: any;
  } | null;
  scaler: {
    activeAssets: string[];
    candidateCount: number;
    promotions: number;
    demotions: number;
    lastScan: string | null;
  } | null;
}

/* ─── Utility ─────────────────────────────────────────────────────────────── */
function fmt$(v: number) { return v >= 0 ? `$${v.toFixed(2)}` : `-$${Math.abs(v).toFixed(2)}`; }
function fmtPct(v: number) { return `${v.toFixed(1)}%`; }
function timeAgo(ts: number) {
  if (!ts) return 'never';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

/* ─── Rocket SVG Component ────────────────────────────────────────────────── */
function RocketShip({ portfolioUsd, roi }: { portfolioUsd: number; roi: number }) {
  // Rocket altitude based on portfolio value (0-500 range maps to position)
  const altitude = Math.min(100, Math.max(5, (portfolioUsd / 500) * 100));
  const flameIntensity = Math.min(1, Math.max(0.2, Math.abs(roi) / 20));
  const isRising = roi >= 0;

  return (
    <div className="relative w-full h-80 rounded-2xl overflow-hidden bg-gradient-to-b from-[#0a0118] via-[#110b2e] to-[#1a0a3e] border border-purple-500/20">
      {/* Stars */}
      <div className="absolute inset-0">
        {Array.from({ length: 50 }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              width: `${Math.random() * 2 + 1}px`,
              height: `${Math.random() * 2 + 1}px`,
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              opacity: Math.random() * 0.8 + 0.2,
              animation: `twinkle ${Math.random() * 3 + 2}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 2}s`,
            }}
          />
        ))}
      </div>

      {/* Rocket */}
      <div
        className="absolute left-1/2 -translate-x-1/2 transition-all duration-[2000ms] ease-out"
        style={{ bottom: `${altitude}%` }}
      >
        <svg width="60" height="120" viewBox="0 0 60 120" className="drop-shadow-[0_0_20px_rgba(249,115,22,0.6)]">
          {/* Rocket body */}
          <defs>
            <linearGradient id="rocketBody" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#e2e8f0" />
              <stop offset="50%" stopColor="#f8fafc" />
              <stop offset="100%" stopColor="#cbd5e1" />
            </linearGradient>
            <linearGradient id="rocketNose" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#f97316" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
            <linearGradient id="flame" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#f97316" />
              <stop offset="40%" stopColor="#ef4444" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>
          {/* Nose cone */}
          <path d="M30 5 L40 35 L20 35 Z" fill="url(#rocketNose)" />
          {/* Body */}
          <rect x="20" y="35" width="20" height="45" rx="2" fill="url(#rocketBody)" />
          {/* Window */}
          <circle cx="30" cy="52" r="6" fill="#0ea5e9" stroke="#1e293b" strokeWidth="1.5" />
          <circle cx="30" cy="52" r="3" fill="#38bdf8" opacity="0.6" />
          {/* FF Logo */}
          <text x="30" y="70" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#f97316">FF</text>
          {/* Fins */}
          <path d="M20 65 L10 85 L20 80 Z" fill="#f97316" />
          <path d="M40 65 L50 85 L40 80 Z" fill="#f97316" />
          {/* Flame */}
          <ellipse
            cx="30"
            cy="92"
            rx={6 * flameIntensity + 3}
            ry={15 * flameIntensity + 5}
            fill="url(#flame)"
            opacity={isRising ? 0.9 : 0.3}
          >
            <animate attributeName="ry" values={`${15 * flameIntensity + 3};${15 * flameIntensity + 8};${15 * flameIntensity + 3}`} dur="0.3s" repeatCount="indefinite" />
            <animate attributeName="rx" values={`${6 * flameIntensity + 2};${6 * flameIntensity + 5};${6 * flameIntensity + 2}`} dur="0.4s" repeatCount="indefinite" />
          </ellipse>
          {/* Inner flame */}
          <ellipse cx="30" cy="90" rx={3 * flameIntensity + 1} ry={8 * flameIntensity + 2} fill="#fbbf24" opacity={isRising ? 0.8 : 0.2}>
            <animate attributeName="ry" values={`${8 * flameIntensity + 1};${8 * flameIntensity + 4};${8 * flameIntensity + 1}`} dur="0.25s" repeatCount="indefinite" />
          </ellipse>
        </svg>
      </div>

      {/* Ground level indicator */}
      <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-purple-900/30 to-transparent" />

      {/* Value labels */}
      <div className="absolute top-4 left-4 text-left">
        <div className="text-xs text-purple-300/60 uppercase tracking-widest">FreedomForge Value</div>
        <div className="text-3xl font-black text-white mt-1">{fmt$(portfolioUsd)}</div>
        <div className={`text-lg font-bold mt-1 ${roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {roi >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(roi))} ROI
        </div>
      </div>
      <div className="absolute top-4 right-4 text-right">
        <div className="text-xs text-purple-300/40 uppercase">Altitude</div>
        <div className="text-lg font-mono text-purple-200">{altitude.toFixed(0)}%</div>
      </div>

      {/* Twinkle animation */}
      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.2; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/* ─── Stat Card ───────────────────────────────────────────────────────────── */
function StatCard({ label, value, sub, color = 'text-white', icon }: {
  label: string; value: string; sub?: string; color?: string; icon?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 backdrop-blur p-4 hover:border-zinc-600 transition-colors">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-400">
        {icon && <span>{icon}</span>}
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}

/* ─── Gauge Component ─────────────────────────────────────────────────────── */
function Gauge({ value, max, label, color, warn, danger }: {
  value: number; max: number; label: string; color: string; warn?: number; danger?: number;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  let barColor = color;
  if (danger && pct >= danger) barColor = 'bg-red-500';
  else if (warn && pct >= warn) barColor = 'bg-yellow-500';

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="text-zinc-300 font-mono">{fmtPct(pct)}</span>
      </div>
      <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ─── Venue Badge ─────────────────────────────────────────────────────────── */
function VenueBadge({ name, healthy }: { name: string; healthy: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
      healthy ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
    }`}>
      <span className={`w-2 h-2 rounded-full ${healthy ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
      {name}
    </span>
  );
}

/* ─── Chart Options ───────────────────────────────────────────────────────── */
const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#18181b',
      borderColor: '#3f3f46',
      borderWidth: 1,
      titleColor: '#e4e4e7',
      bodyColor: '#a1a1aa',
      padding: 10,
      cornerRadius: 8,
    },
  },
  scales: {
    x: { grid: { color: 'rgba(63,63,70,0.3)' }, ticks: { color: '#71717a', font: { size: 10 } } },
    y: { grid: { color: 'rgba(63,63,70,0.3)' }, ticks: { color: '#71717a', font: { size: 10 } } },
  },
};

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  MAIN DASHBOARD                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

export default function CommandCenter() {
  const router = useRouter();
  const [data, setData] = useState<EmpireData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<number>(0);
  const [tab, setTab] = useState<'overview' | 'trades' | 'risk' | 'intelligence'>('overview');

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/status/empire', { cache: 'no-store' });
      const json = await res.json();
      setData(json);
      setLastRefresh(Date.now());
    } catch (e) {
      console.error('Empire fetch failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 12000);
    return () => clearInterval(id);
  }, [fetchData]);

  // Auth check
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/auth/session', { cache: 'no-store' });
        const d = await res.json();
        if (!d?.authenticated) router.replace('/login?next=/dashboard');
      } catch {}
    };
    check();
    const id = setInterval(check, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [router]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  };

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-4 text-zinc-400 text-lg">Loading Command Center...</p>
        </div>
      </div>
    );
  }

  const roi = data.portfolio.totalUsd > 0 ? (data.portfolio.netPnl / data.portfolio.totalUsd) * 100 : 0;

  // Chart data
  const pnlChartData = {
    labels: data.tradeTimeline.map((t, i) => `#${i + 1}`),
    datasets: [{
      label: 'Cumulative P&L',
      data: data.pnlHistory.map(p => p.cumPnl),
      borderColor: '#10b981',
      backgroundColor: 'rgba(16, 185, 129, 0.1)',
      fill: true,
      tension: 0.4,
      pointRadius: 3,
      pointBackgroundColor: data.pnlHistory.map(p => p.pnl >= 0 ? '#10b981' : '#ef4444'),
    }],
  };

  const volDays = Object.entries(data.volumeByDay).sort((a, b) => a[0].localeCompare(b[0]));
  const volumeChartData = {
    labels: volDays.map(([d]) => d.slice(5)),
    datasets: [{
      label: 'Volume ($)',
      data: volDays.map(([, v]) => v),
      backgroundColor: 'rgba(99, 102, 241, 0.6)',
      borderColor: '#6366f1',
      borderWidth: 1,
      borderRadius: 6,
    }],
  };

  const confChartData = {
    labels: data.confidenceDistribution.labels,
    datasets: [{
      data: data.confidenceDistribution.values,
      backgroundColor: ['#6b7280', '#3b82f6', '#8b5cf6', '#f59e0b', '#10b981'],
      borderWidth: 0,
    }],
  };

  const venueNames = Object.keys(data.venueStats);
  const venueChartData = {
    labels: venueNames,
    datasets: [{
      data: venueNames.map(v => data.venueStats[v].volume),
      backgroundColor: ['#f97316', '#3b82f6', '#8b5cf6', '#10b981', '#ef4444'],
      borderWidth: 0,
    }],
  };

  const signalSourceNames = Object.keys(data.signalBus.sources);
  const signalChartData = {
    labels: signalSourceNames.map(s => s.replace(/-/g, ' ').slice(0, 15)),
    datasets: [{
      label: 'Signals',
      data: signalSourceNames.map(s => data.signalBus.sources[s]),
      backgroundColor: 'rgba(236, 72, 153, 0.6)',
      borderColor: '#ec4899',
      borderWidth: 1,
      borderRadius: 4,
    }],
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-zinc-950 to-black">
      {/* ─── Header ───────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-black/70 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🚀</span>
            <h1 className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-pink-500 to-purple-500">
              FreedomForge Command Center
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <VenueBadge name="Coinbase" healthy={data.guardian.coinbase.healthy} />
              <VenueBadge name="Kraken" healthy={data.guardian.kraken.healthy} />
              {data.risk.killSwitchActive && (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-red-600 text-white animate-pulse">
                  KILL SWITCH
                </span>
              )}
            </div>
            <span className="text-xs text-zinc-500">Updated {timeAgo(lastRefresh)}</span>
            <button onClick={fetchData} className="text-zinc-400 hover:text-white transition-colors text-sm">⟳</button>
            <button onClick={handleLogout} className="text-xs text-zinc-500 hover:text-orange-400 transition-colors">Logout</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* ─── Rocket Ship ──────────────────────────────────────────────── */}
        <RocketShip portfolioUsd={data.portfolio.totalUsd} roi={roi} />

        {/* ─── Top KPI Row ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard icon="💰" label="Portfolio" value={fmt$(data.portfolio.totalUsd)} color="text-white" sub={`CB: ${fmt$(data.portfolio.coinbaseUsd)} · KR: ${fmt$(data.portfolio.krakenUsd)}`} />
          <StatCard icon="📈" label="Net P&L" value={fmt$(data.portfolio.netPnl)} color={data.portfolio.netPnl >= 0 ? 'text-emerald-400' : 'text-red-400'} sub={`Unrealized: ${fmt$(data.portfolio.unrealizedPnl)}`} />
          <StatCard icon="🎯" label="Win Rate" value={fmtPct(data.trades.winRate * 100)} color="text-blue-400" sub={`${data.trades.wins}W / ${data.trades.losses}L`} />
          <StatCard icon="📊" label="Total Trades" value={String(data.trades.total)} color="text-purple-400" sub={`Live: ${data.trades.liveCount} · Dry: ${data.trades.dryRunCount}`} />
          <StatCard icon="💎" label="Volume" value={fmt$(data.trades.totalVolume)} color="text-cyan-400" sub={`Avg: ${fmt$(data.trades.totalVolume / Math.max(1, data.trades.total))}/trade`} />
          <StatCard icon="🧠" label="Signals Active" value={String(data.signalBus.totalActive)} color="text-pink-400" sub={`${Object.keys(data.signalBus.types).length} types`} />
        </div>

        {/* ─── Tab Navigation ───────────────────────────────────────────── */}
        <div className="flex gap-1 bg-zinc-900/50 backdrop-blur rounded-xl p-1 border border-zinc-800">
          {(['overview', 'trades', 'risk', 'intelligence'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                tab === t ? 'bg-gradient-to-r from-orange-600 to-pink-600 text-white shadow-lg' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {t === 'overview' && '📊 '}
              {t === 'trades' && '💹 '}
              {t === 'risk' && '🛡️ '}
              {t === 'intelligence' && '🧠 '}
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* ═══ OVERVIEW TAB ═══════════════════════════════════════════════ */}
        {tab === 'overview' && (
          <div className="space-y-6">
            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* P&L Chart */}
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3">📈 Cumulative P&L</h3>
                <div className="h-56">
                  <Line data={pnlChartData} options={{ ...chartDefaults, plugins: { ...chartDefaults.plugins, legend: { display: false } } } as any} />
                </div>
              </div>
              {/* Volume Chart */}
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3">📊 Daily Volume</h3>
                <div className="h-56">
                  <Bar data={volumeChartData} options={chartDefaults as any} />
                </div>
              </div>
            </div>

            {/* Donut Charts Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Confidence Dist */}
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3">🎯 Confidence Distribution</h3>
                <div className="h-48 flex items-center justify-center">
                  <Doughnut data={confChartData} options={{ ...chartDefaults, scales: undefined, cutout: '60%' } as any} />
                </div>
              </div>
              {/* Venue Split */}
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3">🏦 Venue Volume Split</h3>
                <div className="h-48 flex items-center justify-center">
                  <Doughnut data={venueChartData} options={{ ...chartDefaults, scales: undefined, cutout: '60%' } as any} />
                </div>
                <div className="flex flex-wrap gap-2 mt-2 justify-center">
                  {venueNames.map((v, i) => (
                    <span key={v} className="text-[10px] text-zinc-400 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ['#f97316', '#3b82f6', '#8b5cf6', '#10b981', '#ef4444'][i] }} />
                      {v}
                    </span>
                  ))}
                </div>
              </div>
              {/* Asset Performance */}
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3">🪙 Asset Performance</h3>
                <div className="space-y-2.5 max-h-56 overflow-y-auto">
                  {Object.entries(data.assetStats)
                    .sort((a, b) => b[1].volume - a[1].volume)
                    .map(([asset, stats]) => (
                      <div key={asset} className="flex items-center justify-between text-sm">
                        <span className="text-zinc-300 font-medium">{asset}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-zinc-500">{stats.trades} trades</span>
                          <span className="text-xs font-mono text-zinc-400">{fmt$(stats.volume)}</span>
                          <span className={`text-xs font-mono ${stats.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {fmt$(stats.pnl)}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* Venue Breakdown Table */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
              <h3 className="text-sm font-semibold text-zinc-300 mb-3">🏦 Venue Breakdown</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-zinc-500 text-xs uppercase border-b border-zinc-800">
                      <th className="text-left pb-2">Venue</th>
                      <th className="text-right pb-2">Trades</th>
                      <th className="text-right pb-2">Volume</th>
                      <th className="text-right pb-2">P&L</th>
                      <th className="text-right pb-2">Win Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.venueStats).map(([venue, stats]) => (
                      <tr key={venue} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="py-2 text-zinc-300 font-medium">{venue}</td>
                        <td className="py-2 text-right text-zinc-400">{stats.trades}</td>
                        <td className="py-2 text-right font-mono text-zinc-300">{fmt$(stats.volume)}</td>
                        <td className={`py-2 text-right font-mono ${stats.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt$(stats.pnl)}</td>
                        <td className="py-2 text-right text-zinc-400">{stats.wins + stats.losses > 0 ? fmtPct((stats.wins / (stats.wins + stats.losses)) * 100) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══ TRADES TAB ═════════════════════════════════════════════════ */}
        {tab === 'trades' && (
          <div className="space-y-5">
            {/* Trade History Table */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
              <h3 className="text-sm font-semibold text-zinc-300 mb-3">📋 Trade History</h3>
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-zinc-900">
                    <tr className="text-zinc-500 uppercase border-b border-zinc-800">
                      <th className="text-left pb-2 pl-2">Time</th>
                      <th className="text-left pb-2">Asset</th>
                      <th className="text-left pb-2">Venue</th>
                      <th className="text-center pb-2">Side</th>
                      <th className="text-right pb-2">Size</th>
                      <th className="text-right pb-2">Confidence</th>
                      <th className="text-right pb-2">Edge</th>
                      <th className="text-right pb-2">P&L</th>
                      <th className="text-center pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.tradeTimeline].reverse().map((t, i) => (
                      <tr key={i} className="border-b border-zinc-800/40 hover:bg-zinc-800/20">
                        <td className="py-2 pl-2 text-zinc-500 font-mono">{t.time ? new Date(t.time).toLocaleString() : '—'}</td>
                        <td className="py-2 text-zinc-300 font-semibold">{t.asset}</td>
                        <td className="py-2 text-zinc-400">{t.venue}</td>
                        <td className="py-2 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${t.side === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                            {t.side?.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-2 text-right font-mono text-zinc-300">{fmt$(t.usdSize || 0)}</td>
                        <td className="py-2 text-right font-mono text-blue-400">{((t.confidence || 0) * 100).toFixed(1)}%</td>
                        <td className="py-2 text-right font-mono text-purple-400">{((t.edge || 0) * 100).toFixed(1)}%</td>
                        <td className={`py-2 text-right font-mono ${(t.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {t.pnl != null ? fmt$(t.pnl) : '—'}
                        </td>
                        <td className="py-2 text-center">
                          {t.dryRun ? (
                            <span className="px-2 py-0.5 rounded text-[10px] bg-zinc-700 text-zinc-300">DRY</span>
                          ) : t.outcome ? (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${t.outcome === 'win' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                              {t.outcome.toUpperCase()}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-400">LIVE</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══ RISK TAB ═══════════════════════════════════════════════════ */}
        {tab === 'risk' && (
          <div className="space-y-5">
            {/* Guardian Status */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Coinbase Margin */}
              <div className={`rounded-2xl border p-5 ${data.guardian.coinbase.healthy ? 'border-emerald-500/20 bg-zinc-900/60' : 'border-red-500/40 bg-red-950/20'}`}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-zinc-300">🏦 Coinbase Futures Margin</h3>
                  <VenueBadge name={data.guardian.coinbase.healthy ? 'Healthy' : 'At Risk'} healthy={data.guardian.coinbase.healthy} />
                </div>
                <div className="space-y-3">
                  <Gauge value={data.guardian.coinbase.marginPct} max={100} label="Margin Utilization" color="bg-blue-500" warn={70} danger={85} />
                  <Gauge value={data.guardian.coinbase.liquidationBuffer} max={200} label={`Liquidation Buffer (${fmt$(data.guardian.coinbase.liquidationBuffer)})`} color="bg-emerald-500" />
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div className="text-xs"><span className="text-zinc-500">Balance:</span> <span className="text-zinc-200 font-mono">{fmt$(data.guardian.coinbase.totalBalance)}</span></div>
                    <div className="text-xs"><span className="text-zinc-500">Margin Used:</span> <span className="text-zinc-200 font-mono">{fmt$(data.guardian.coinbase.initialMargin)}</span></div>
                    <div className="text-xs"><span className="text-zinc-500">Unrealized:</span> <span className={`font-mono ${data.guardian.coinbase.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt$(data.guardian.coinbase.unrealizedPnl)}</span></div>
                    <div className="text-xs"><span className="text-zinc-500">Positions:</span> <span className="text-zinc-200">{data.guardian.coinbase.positions.length}</span></div>
                  </div>
                  {data.guardian.coinbase.positions.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      <div className="text-xs text-zinc-500 uppercase">Open Positions</div>
                      {data.guardian.coinbase.positions.map((p: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-xs bg-zinc-800/40 rounded-lg px-3 py-1.5">
                          <span className="text-zinc-300 font-mono">{p.productId}</span>
                          <span className={`font-semibold ${p.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>{p.side}</span>
                          <span className="text-zinc-400">{p.contracts}x</span>
                          <span className={`font-mono ${p.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt$(p.unrealizedPnl)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Kraken Margin */}
              <div className={`rounded-2xl border p-5 ${data.guardian.kraken.healthy ? 'border-emerald-500/20 bg-zinc-900/60' : 'border-red-500/40 bg-red-950/20'}`}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-zinc-300">🦑 Kraken Margin</h3>
                  <VenueBadge name={data.guardian.kraken.healthy ? 'Healthy' : 'At Risk'} healthy={data.guardian.kraken.healthy} />
                </div>
                <div className="space-y-3">
                  <Gauge value={data.guardian.kraken.marginPct} max={100} label="Margin Utilization" color="bg-blue-500" warn={70} danger={85} />
                  <Gauge value={data.guardian.kraken.freeMargin} max={data.guardian.kraken.equity || 200} label={`Free Margin (${fmt$(data.guardian.kraken.freeMargin)})`} color="bg-emerald-500" />
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div className="text-xs"><span className="text-zinc-500">Equity:</span> <span className="text-zinc-200 font-mono">{fmt$(data.guardian.kraken.equity)}</span></div>
                    <div className="text-xs"><span className="text-zinc-500">Margin Used:</span> <span className="text-zinc-200 font-mono">{fmt$(data.guardian.kraken.marginUsed)}</span></div>
                    <div className="text-xs"><span className="text-zinc-500">Unrealized:</span> <span className={`font-mono ${data.guardian.kraken.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt$(data.guardian.kraken.unrealizedPnl)}</span></div>
                    <div className="text-xs"><span className="text-zinc-500">Positions:</span> <span className="text-zinc-200">{data.guardian.kraken.positions.length}</span></div>
                  </div>
                  {data.guardian.kraken.positions.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      <div className="text-xs text-zinc-500 uppercase">Open Positions</div>
                      {data.guardian.kraken.positions.map((p: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-xs bg-zinc-800/40 rounded-lg px-3 py-1.5">
                          <span className="text-zinc-300 font-mono">{p.pair}</span>
                          <span className={`font-semibold ${p.type === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>{p.type?.toUpperCase()}</span>
                          <span className={`font-mono ${p.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt$(p.pnl)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Risk Overview Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon="🛡️" label="Drawdown" value={fmtPct(data.risk.drawdownPct)} color={data.risk.drawdownPct > 10 ? 'text-red-400' : 'text-emerald-400'} />
              <StatCard icon="📉" label="Daily P&L" value={fmt$(data.risk.dailyPnl?.pnl || 0)} color={(data.risk.dailyPnl?.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'} sub={data.risk.dailyPnl?.date || '—'} />
              <StatCard icon="🚨" label="Emergency Closes" value={String(data.guardian.emergencyCloses)} color={data.guardian.emergencyCloses > 0 ? 'text-yellow-400' : 'text-zinc-400'} />
              <StatCard icon="🔒" label="Kill Switch" value={data.risk.killSwitchActive ? 'ACTIVE' : 'OFF'} color={data.risk.killSwitchActive ? 'text-red-500' : 'text-emerald-400'} />
            </div>

            {/* Guardian Actions Log */}
            {data.guardian.actions.length > 0 && (
              <div className="rounded-2xl border border-yellow-500/20 bg-zinc-900/60 p-5">
                <h3 className="text-sm font-semibold text-yellow-400 mb-3">⚡ Recent Guardian Actions</h3>
                <div className="space-y-2">
                  {data.guardian.actions.map((a: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 text-xs bg-zinc-800/40 rounded-lg px-3 py-2">
                      <span className="text-yellow-400 font-semibold">{a.action}</span>
                      <span className="text-zinc-400">{a.venue}</span>
                      {a.position && <span className="text-zinc-300 font-mono">{a.position.productId || a.position.pair}</span>}
                      <span className="ml-auto text-zinc-500">{a.ts ? timeAgo(a.ts) : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ INTELLIGENCE TAB ═══════════════════════════════════════════ */}
        {tab === 'intelligence' && (
          <div className="space-y-5">
            {/* Signal Bus */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3">📡 Signal Bus — Sources</h3>
                <div className="h-56">
                  <Bar data={signalChartData} options={chartDefaults as any} />
                </div>
                <div className="text-xs text-zinc-500 mt-2">
                  {data.signalBus.totalActive} active signals across {Object.keys(data.signalBus.sources).length} sources
                </div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                <h3 className="text-sm font-semibold text-zinc-300 mb-3">📡 Signal Types</h3>
                <div className="space-y-2">
                  {Object.entries(data.signalBus.types)
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, count]) => (
                      <div key={type} className="flex items-center justify-between">
                        <span className="text-xs text-zinc-400">{type.replace(/_/g, ' ')}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-pink-500 rounded-full" style={{ width: `${(count / data.signalBus.totalActive) * 100}%` }} />
                          </div>
                          <span className="text-xs font-mono text-zinc-300 w-6 text-right">{count}</span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* Brain + Orchestrator + Scaler */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Brain */}
              <div className="rounded-2xl border border-purple-500/20 bg-zinc-900/60 p-5">
                <h3 className="text-sm font-semibold text-purple-400 mb-3">🧠 Self-Evolving Brain</h3>
                {data.brain ? (
                  <div className="space-y-3">
                    <div className="text-xs"><span className="text-zinc-500">Generation:</span> <span className="text-purple-300 font-mono">{data.brain.generation}</span></div>
                    <div className="text-xs"><span className="text-zinc-500">Asset Profiles:</span> <span className="text-zinc-300">{data.brain.assetProfiles}</span></div>
                    <div className="text-xs"><span className="text-zinc-500">Last Evolved:</span> <span className="text-zinc-400">{data.brain.lastEvolved ? timeAgo(new Date(data.brain.lastEvolved).getTime()) : 'never'}</span></div>
                    {data.brain.topIndicators.length > 0 && (
                      <div className="mt-2">
                        <div className="text-xs text-zinc-500 uppercase mb-1">Top Indicators</div>
                        {data.brain.topIndicators.map(ind => (
                          <div key={ind.indicator} className="flex items-center justify-between text-xs mt-1">
                            <span className="text-zinc-300">{ind.indicator}</span>
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                <div className="h-full bg-purple-500 rounded-full" style={{ width: `${Math.min(100, ind.weight * 100)}%` }} />
                              </div>
                              <span className="text-zinc-400 font-mono w-8 text-right">{(ind.weight * 100).toFixed(0)}%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">Brain not yet initialized (needs 8+ trades)</p>
                )}
              </div>

              {/* Orchestrator */}
              <div className="rounded-2xl border border-orange-500/20 bg-zinc-900/60 p-5">
                <h3 className="text-sm font-semibold text-orange-400 mb-3">🎯 Orchestrator</h3>
                <div className="space-y-3">
                  <div className="text-xs"><span className="text-zinc-500">Cycles:</span> <span className="text-orange-300 font-mono text-lg">{data.orchestrator.cycleCount}</span></div>
                  <div className="text-xs"><span className="text-zinc-500">Total Trades:</span> <span className="text-zinc-300">{data.orchestrator.totalTrades}</span></div>
                  <div className="text-xs"><span className="text-zinc-500">Last Run:</span> <span className="text-zinc-400">{data.orchestrator.lastRun ? timeAgo(new Date(data.orchestrator.lastRun).getTime()) : 'never'}</span></div>
                  {data.orchestrator.errors.length > 0 && (
                    <div className="mt-2">
                      <div className="text-xs text-red-400 uppercase mb-1">Recent Errors</div>
                      {data.orchestrator.errors.map((e: any, i: number) => (
                        <div key={i} className="text-[10px] text-red-300/60 truncate">{typeof e === 'string' ? e : JSON.stringify(e).slice(0, 80)}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Scaler */}
              <div className="rounded-2xl border border-cyan-500/20 bg-zinc-900/60 p-5">
                <h3 className="text-sm font-semibold text-cyan-400 mb-3">📐 Horizontal Scaler</h3>
                {data.scaler ? (
                  <div className="space-y-3">
                    <div className="text-xs"><span className="text-zinc-500">Active Assets:</span> <span className="text-cyan-300 font-mono">{data.scaler.activeAssets.length}</span></div>
                    <div className="text-xs"><span className="text-zinc-500">Candidates:</span> <span className="text-zinc-300">{data.scaler.candidateCount}</span></div>
                    <div className="text-xs"><span className="text-zinc-500">Promotions:</span> <span className="text-emerald-400">{data.scaler.promotions}</span></div>
                    <div className="text-xs"><span className="text-zinc-500">Demotions:</span> <span className="text-red-400">{data.scaler.demotions}</span></div>
                    <div className="text-xs"><span className="text-zinc-500">Last Scan:</span> <span className="text-zinc-400">{data.scaler.lastScan ? timeAgo(new Date(data.scaler.lastScan).getTime()) : 'never'}</span></div>
                    {data.scaler.activeAssets.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {data.scaler.activeAssets.map((a: string) => (
                          <span key={a} className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 text-[10px] font-mono border border-cyan-500/20">{a}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">Scaler not yet initialized</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── Footer ──────────────────────────────────────────────────── */}
        <div className="text-center text-xs text-zinc-600 py-4">
          FreedomForge Max Command Center · Autonomous Trading Empire · All systems monitored 24/7
        </div>
      </main>
    </div>
  );
}
