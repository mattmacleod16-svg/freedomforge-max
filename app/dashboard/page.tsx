'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useMemo } from 'react';
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
  mandate: {
    initialCapital: number;
    highWaterMark: number;
    lowWaterMark: number;
    currentMode: string;
    milestonesReached: number[];
    totalDaysActive: number;
    consecutiveWinDays: number;
    consecutiveLossDays: number;
    tradeDenials: number;
    capitalHaltEvents: number;
    survivalModeEntries: number;
    growthModeEntries: number;
    dailySnapshots: Array<{ date: string; total: number; dailyPnl: number; roiPct: number; mode: string }>;
    modeTransitions: Array<{ from: string; to: string; capital: number; ts: number }>;
    roiPct: number;
    message: string;
  } | null;
  treasury: {
    lifetimePnl: number;
    lifetimeTrades: number;
    winRate: number;
    profitFactor: number;
    roi: number;
    currentCapital: number;
    peakCapital: number;
    maxDrawdownPct: number;
    lifetimePayouts: number;
    nextMilestone: number | null;
    milestonesReached: number;
    dailySnapshots: Array<{ date: string; pnl: number; trades: number; wins: number; capital: number; cumulativePnl: number }>;
    weeklySummaries: Array<{ weekStart: string; pnl: number; trades: number; winRate: number; avgPnl: number; capital: number }>;
    updatedAt: number;
  } | null;
  agents: {
    total: number;
    active: number;
    roles: Array<{
      role: string;
      icon: string;
      agents: Array<{ name: string; status: string; detail: string }>;
    }>;
  } | null;
}

/* ─── Utility ─────────────────────────────────────────────────────────────── */
function fmt$(v: number) { return v >= 0 ? `$${v.toFixed(2)}` : `-$${Math.abs(v).toFixed(2)}`; }
function fmtPct(v: number) { return `${v.toFixed(1)}%`; }
function fmtCompact(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return fmt$(v);
}
function timeAgo(ts: number) {
  if (!ts) return 'never';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

/* ─── Live Clock ──────────────────────────────────────────────────────────── */
function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-mono text-xs tracking-widest text-cyan-400/70">
      {now.toISOString().replace('T', ' ').slice(0, 19)} UTC
    </span>
  );
}

/* ─── Animated Counter ────────────────────────────────────────────────────── */
function AnimatedNumber({ value, prefix = '$', decimals = 2 }: { value: number; prefix?: string; decimals?: number }) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    const start = display;
    const diff = value - start;
    if (Math.abs(diff) < 0.01) { setDisplay(value); return; }
    const duration = 800;
    const startTime = Date.now();
    let raf: number;
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + diff * eased);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const abs = Math.abs(display);
  const sign = display < 0 ? '-' : '';
  return <>{sign}{prefix}{abs.toFixed(decimals)}</>;
}

/* ─── Hexagonal Status Indicator ──────────────────────────────────────────── */
function HexStatus({ active, label, pulse }: { active: boolean; label: string; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <div className={`w-3 h-3 rotate-45 ${active ? 'bg-cyan-400' : 'bg-red-500'}`} />
        {pulse && active && (
          <div className="absolute inset-0 w-3 h-3 rotate-45 bg-cyan-400 animate-ping opacity-30" />
        )}
      </div>
      <span className={`text-xs uppercase tracking-wider font-mono ${active ? 'text-cyan-300' : 'text-red-400'}`}>{label}</span>
    </div>
  );
}

/* ─── Rocket Ship (Enhanced Cyber Version) ────────────────────────────────── */
function RocketShip({ portfolioUsd, roi }: { portfolioUsd: number; roi: number }) {
  const altitude = Math.min(100, Math.max(5, (portfolioUsd / 600) * 100));
  const flameIntensity = Math.min(1, Math.max(0.2, Math.abs(roi) / 20));
  const isRising = roi >= 0;

  const stars = useMemo(() =>
    Array.from({ length: 80 }).map((_, i) => ({
      id: i,
      w: Math.random() * 2 + 0.5,
      top: Math.random() * 100,
      left: Math.random() * 100,
      opacity: Math.random() * 0.7 + 0.3,
      dur: Math.random() * 4 + 2,
      delay: Math.random() * 3,
    })),
  []);

  return (
    <div className="relative w-full h-80 rounded-2xl overflow-hidden border border-cyan-500/10 scanline-overlay">
      {/* Deep space gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#000814] via-[#001233] to-[#0a0a2e]" />

      {/* Grid overlay */}
      <div className="absolute inset-0 cyber-grid-bg opacity-30" />

      {/* Nebula glow */}
      <div className="absolute top-10 right-10 w-40 h-40 rounded-full bg-purple-500/5 blur-3xl" />
      <div className="absolute bottom-20 left-20 w-32 h-32 rounded-full bg-cyan-500/5 blur-3xl" />

      {/* Stars */}
      <div className="absolute inset-0">
        {stars.map(s => (
          <div
            key={s.id}
            className="absolute rounded-full bg-white"
            style={{
              width: `${s.w}px`, height: `${s.w}px`,
              top: `${s.top}%`, left: `${s.left}%`,
              opacity: s.opacity,
              animation: `twinkle ${s.dur}s ease-in-out infinite`,
              animationDelay: `${s.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Rocket */}
      <div
        className="absolute left-1/2 -translate-x-1/2 transition-all duration-[2500ms] ease-out"
        style={{ bottom: `${altitude}%`, filter: 'drop-shadow(0 0 25px rgba(0,255,255,0.4))' }}
      >
        <svg width="60" height="120" viewBox="0 0 60 120">
          <defs>
            <linearGradient id="rocketBody" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#94a3b8" />
              <stop offset="50%" stopColor="#e2e8f0" />
              <stop offset="100%" stopColor="#94a3b8" />
            </linearGradient>
            <linearGradient id="rocketNose" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#00ffff" />
              <stop offset="100%" stopColor="#0ea5e9" />
            </linearGradient>
            <linearGradient id="flame" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#00ffff" />
              <stop offset="40%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
            <filter id="rocketGlow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>
          {/* Nose cone */}
          <path d="M30 5 L40 35 L20 35 Z" fill="url(#rocketNose)" filter="url(#rocketGlow)" />
          {/* Body */}
          <rect x="20" y="35" width="20" height="45" rx="2" fill="url(#rocketBody)" />
          {/* Window */}
          <circle cx="30" cy="52" r="6" fill="#0c4a6e" stroke="#00ffff" strokeWidth="1.5" />
          <circle cx="30" cy="52" r="3" fill="#00ffff" opacity="0.5" />
          {/* Logo */}
          <text x="30" y="70" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#00ffff">FF</text>
          {/* Fins */}
          <path d="M20 65 L10 85 L20 80 Z" fill="#00ffff" opacity="0.8" />
          <path d="M40 65 L50 85 L40 80 Z" fill="#00ffff" opacity="0.8" />
          {/* Flame */}
          <ellipse cx="30" cy="92" rx={6 * flameIntensity + 3} ry={15 * flameIntensity + 5} fill="url(#flame)" opacity={isRising ? 0.9 : 0.3}>
            <animate attributeName="ry" values={`${15 * flameIntensity + 3};${15 * flameIntensity + 8};${15 * flameIntensity + 3}`} dur="0.3s" repeatCount="indefinite" />
            <animate attributeName="rx" values={`${6 * flameIntensity + 2};${6 * flameIntensity + 5};${6 * flameIntensity + 2}`} dur="0.4s" repeatCount="indefinite" />
          </ellipse>
          <ellipse cx="30" cy="90" rx={3 * flameIntensity + 1} ry={8 * flameIntensity + 2} fill="#67e8f9" opacity={isRising ? 0.8 : 0.2}>
            <animate attributeName="ry" values={`${8 * flameIntensity + 1};${8 * flameIntensity + 4};${8 * flameIntensity + 1}`} dur="0.25s" repeatCount="indefinite" />
          </ellipse>
        </svg>
      </div>

      {/* Altitude trail */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 bg-gradient-to-t from-cyan-500/20 to-transparent" style={{ height: `${altitude}%` }} />

      {/* HUD overlay - top left */}
      <div className="absolute top-4 left-4 text-left">
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-cyan-500/50">FREEDOMFORGE NET WORTH</div>
        <div className="text-4xl font-black text-white mt-1" style={{ textShadow: '0 0 20px rgba(0,255,255,0.3)' }}>
          <AnimatedNumber value={portfolioUsd} />
        </div>
        <div className={`text-lg font-bold mt-1 flex items-center gap-2 ${roi >= 0 ? 'neon-text-green' : 'neon-text-red'}`}>
          <span className="text-sm">{roi >= 0 ? '▲' : '▼'}</span>
          {fmtPct(Math.abs(roi))} ROI
        </div>
      </div>

      {/* HUD overlay - top right */}
      <div className="absolute top-4 right-4 text-right">
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-cyan-500/50">ALTITUDE</div>
        <div className="text-2xl font-mono neon-text-cyan mt-1">{altitude.toFixed(0)}%</div>
        <div className="text-[10px] font-mono text-purple-400/60 mt-1">PHASE: {altitude < 30 ? 'LAUNCH' : altitude < 60 ? 'ASCENT' : altitude < 85 ? 'ORBIT' : 'STRATOSPHERE'}</div>
      </div>

      {/* Bottom HUD bar */}
      <div className="absolute bottom-2 left-4 right-4 flex items-center justify-between text-[9px] font-mono text-cyan-500/40 uppercase tracking-widest">
        <span>SYS:NOMINAL</span>
        <span>ENGINES:{isRising ? 'FULL-BURN' : 'STANDBY'}</span>
        <span>FUEL:{(flameIntensity * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

/* ─── HUD Stat Card ───────────────────────────────────────────────────────── */
function StatCard({ label, value, sub, color = 'text-white', icon, trend }: {
  label: string; value: string; sub?: string; color?: string; icon?: string; trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <div className="holo-card relative rounded-xl p-4 hud-corner overflow-hidden group">
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />
      </div>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-cyan-400/50 font-mono">
        {icon && <span className="text-sm">{icon}</span>}
        {label}
      </div>
      <div className={`mt-2 text-2xl font-black tracking-tight ${color}`} style={{ animation: 'counter-glow 3s ease-in-out infinite' }}>
        {value}
        {trend && (
          <span className={`ml-1 text-xs ${trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-zinc-500'}`}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
          </span>
        )}
      </div>
      {sub && <div className="text-[10px] text-zinc-500 mt-1 font-mono">{sub}</div>}
    </div>
  );
}

/* ─── Cyber Gauge ─────────────────────────────────────────────────────────── */
function CyberGauge({ value, max, label, warn, danger }: {
  value: number; max: number; label: string; warn?: number; danger?: number;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  let barClass = 'from-cyan-500 to-cyan-400';
  let glowColor = 'rgba(0,255,255,0.3)';
  if (danger && pct >= danger) { barClass = 'from-red-600 to-red-400'; glowColor = 'rgba(255,50,50,0.4)'; }
  else if (warn && pct >= warn) { barClass = 'from-yellow-500 to-amber-400'; glowColor = 'rgba(255,200,0,0.3)'; }

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[10px] font-mono">
        <span className="text-zinc-500 uppercase tracking-wider">{label}</span>
        <span className="text-cyan-300">{fmtPct(pct)}</span>
      </div>
      <div className="h-2 bg-zinc-900/80 rounded-full overflow-hidden gauge-glow border border-zinc-800/50">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${barClass} transition-all duration-1000`}
          style={{ width: `${pct}%`, boxShadow: `0 0 8px ${glowColor}` }}
        />
      </div>
    </div>
  );
}

/* ─── Venue Status Chip ───────────────────────────────────────────────────── */
function VenueChip({ name, healthy }: { name: string; healthy: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase tracking-wider border ${
      healthy
        ? 'bg-cyan-500/5 text-cyan-400 border-cyan-500/20'
        : 'bg-red-500/10 text-red-400 border-red-500/30 animate-pulse'
    }`}>
      <span className="relative flex h-2 w-2">
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${healthy ? 'bg-cyan-400' : 'bg-red-400'}`} />
        <span className={`relative inline-flex rounded-full h-2 w-2 ${healthy ? 'bg-cyan-400' : 'bg-red-500'}`} />
      </span>
      {name}
    </span>
  );
}

/* ─── Chart Theming ───────────────────────────────────────────────────────── */
const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(0, 10, 30, 0.95)',
      borderColor: 'rgba(0, 255, 255, 0.2)',
      borderWidth: 1,
      titleColor: '#00ffff',
      bodyColor: '#94a3b8',
      padding: 12,
      cornerRadius: 8,
      titleFont: { family: 'monospace', size: 11 },
      bodyFont: { family: 'monospace', size: 10 },
    },
  },
  scales: {
    x: { grid: { color: 'rgba(0,255,255,0.04)' }, ticks: { color: '#475569', font: { size: 9, family: 'monospace' } } },
    y: { grid: { color: 'rgba(0,255,255,0.04)' }, ticks: { color: '#475569', font: { size: 9, family: 'monospace' } } },
  },
};

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  COMMAND CENTER                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

export default function CommandCenter() {
  const router = useRouter();
  const [data, setData] = useState<EmpireData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<number>(0);
  const [tab, setTab] = useState<'overview' | 'trades' | 'risk' | 'intelligence' | 'treasury'>('overview');
  const [pulseHeader, setPulseHeader] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/status/empire', { cache: 'no-store' });
      const json = await res.json();
      setData(json);
      setLastRefresh(Date.now());
      setPulseHeader(true);
      setTimeout(() => setPulseHeader(false), 600);
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

  /* ─── Loading State ─────────────────────────────────────────────────── */
  if (loading || !data) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center cyber-grid-bg">
        <div className="text-center">
          <div className="relative w-20 h-20 mx-auto">
            <div className="absolute inset-0 border-2 border-cyan-500/30 rounded-full animate-spin" style={{ animationDuration: '3s' }} />
            <div className="absolute inset-2 border-2 border-purple-500/30 rounded-full animate-spin" style={{ animationDuration: '2s', animationDirection: 'reverse' }} />
            <div className="absolute inset-4 border-2 border-cyan-400/50 rounded-full animate-spin" style={{ animationDuration: '1.5s' }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-3 h-3 bg-cyan-400 rounded-full animate-pulse" />
            </div>
          </div>
          <p className="mt-6 text-cyan-400/60 text-sm font-mono uppercase tracking-[0.3em]">Initializing Command Center</p>
          <div className="mt-2 w-48 h-0.5 bg-zinc-900 rounded-full mx-auto overflow-hidden">
            <div className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full" style={{ animation: 'shimmer 1.5s linear infinite', width: '40%' }} />
          </div>
        </div>
      </div>
    );
  }

  /* ─── Computed Metrics ──────────────────────────────────────────────── */
  const roi = data.mandate
    ? data.mandate.roiPct
    : (data.portfolio.totalUsd > 0 ? (data.portfolio.netPnl / data.portfolio.totalUsd) * 100 : 0);

  const mandateMode = data.mandate?.currentMode || 'normal';
  const modeConfig: Record<string, { gradient: string; borderColor: string; icon: string; label: string }> = {
    capital_halt: { gradient: 'from-red-950/80 to-red-900/40', borderColor: 'border-red-500/40', icon: '🚨', label: 'CAPITAL HALT' },
    survival: { gradient: 'from-amber-950/60 to-orange-900/30', borderColor: 'border-amber-500/30', icon: '⚠️', label: 'SURVIVAL' },
    normal: { gradient: 'from-cyan-950/40 to-blue-900/20', borderColor: 'border-cyan-500/20', icon: '🔷', label: 'NORMAL OPS' },
    growth: { gradient: 'from-emerald-950/40 to-green-900/20', borderColor: 'border-emerald-500/20', icon: '⚡', label: 'GROWTH' },
  };
  const modeStyle = modeConfig[mandateMode] || modeConfig.normal;

  /* ─── Chart Data ────────────────────────────────────────────────────── */
  const pnlChartData = {
    labels: data.tradeTimeline.map((_, i) => `#${i + 1}`),
    datasets: [{
      label: 'Cumulative P&L',
      data: data.pnlHistory.map(p => p.cumPnl),
      borderColor: '#00ffff',
      backgroundColor: 'rgba(0, 255, 255, 0.05)',
      fill: true,
      tension: 0.4,
      pointRadius: 2,
      pointBackgroundColor: data.pnlHistory.map(p => p.pnl >= 0 ? '#00ff88' : '#ff3366'),
      borderWidth: 2,
    }],
  };

  const volDays = Object.entries(data.volumeByDay).sort((a, b) => a[0].localeCompare(b[0]));
  const volumeChartData = {
    labels: volDays.map(([d]) => d.slice(5)),
    datasets: [{
      label: 'Volume ($)',
      data: volDays.map(([, v]) => v),
      backgroundColor: 'rgba(139, 92, 246, 0.4)',
      borderColor: '#8b5cf6',
      borderWidth: 1,
      borderRadius: 4,
    }],
  };

  const confChartData = {
    labels: data.confidenceDistribution.labels,
    datasets: [{
      data: data.confidenceDistribution.values,
      backgroundColor: ['#1e293b', '#3b82f6', '#8b5cf6', '#f59e0b', '#00ffcc'],
      borderWidth: 1,
      borderColor: ['#334155', '#2563eb', '#7c3aed', '#d97706', '#00cc99'],
    }],
  };

  const venueNames = Object.keys(data.venueStats);
  const venueChartData = {
    labels: venueNames,
    datasets: [{
      data: venueNames.map(v => data.venueStats[v].volume),
      backgroundColor: ['rgba(0,255,255,0.2)', 'rgba(139,92,246,0.2)', 'rgba(255,51,102,0.2)', 'rgba(0,255,136,0.2)', 'rgba(255,170,0,0.2)'],
      borderWidth: 1,
      borderColor: ['#00ffff', '#8b5cf6', '#ff3366', '#00ff88', '#ffaa00'],
    }],
  };

  const signalSourceNames = Object.keys(data.signalBus.sources);
  const signalChartData = {
    labels: signalSourceNames.map(s => s.replace(/-/g, ' ').slice(0, 15)),
    datasets: [{
      label: 'Signals',
      data: signalSourceNames.map(s => data.signalBus.sources[s]),
      backgroundColor: 'rgba(255, 0, 255, 0.3)',
      borderColor: '#ff00ff',
      borderWidth: 1,
      borderRadius: 3,
    }],
  };

  const tabItems = [
    { key: 'overview' as const, icon: '◈', label: 'OVERVIEW' },
    { key: 'trades' as const, icon: '◉', label: 'TRADES' },
    { key: 'risk' as const, icon: '◆', label: 'RISK' },
    { key: 'intelligence' as const, icon: '◎', label: 'INTEL' },
    { key: 'treasury' as const, icon: '◇', label: 'TREASURY' },
  ];

  /* ─── Render ────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-black cyber-grid-bg relative">
      {/* Ambient glow effects */}
      <div className="fixed top-0 left-1/4 w-96 h-96 bg-cyan-500/[0.02] rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-0 right-1/4 w-96 h-96 bg-purple-500/[0.02] rounded-full blur-3xl pointer-events-none" />

      {/* ─── Header ───────────────────────────────────────────────────── */}
      <header className={`sticky top-0 z-50 backdrop-blur-2xl bg-black/80 border-b transition-all duration-300 ${pulseHeader ? 'border-cyan-400/40' : 'border-cyan-500/10'}`}>
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative w-10 h-10 flex items-center justify-center">
              <div className="absolute inset-0 border border-cyan-500/30 rotate-45 animate-pulse" />
              <span className="text-lg font-black cyber-text">FF</span>
            </div>
            <div>
              <h1 className="text-lg font-black cyber-text tracking-wide">FREEDOMFORGE</h1>
              <div className="text-[9px] font-mono text-cyan-500/40 uppercase tracking-[0.3em] -mt-0.5">Autonomous Command Center</div>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <div className="flex items-center gap-3">
              <VenueChip name="COINBASE" healthy={data.guardian.coinbase.healthy} />
              <VenueChip name="KRAKEN" healthy={data.guardian.kraken.healthy} />
              {data.risk.killSwitchActive && (
                <span className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse tracking-wider">
                  ■ KILL SWITCH
                </span>
              )}
            </div>
            <div className="hidden md:flex flex-col items-end">
              <LiveClock />
              <span className="text-[9px] font-mono text-zinc-600 mt-0.5">Refreshed {timeAgo(lastRefresh)}</span>
            </div>
            <button onClick={fetchData} className="w-8 h-8 rounded-lg border border-cyan-500/20 flex items-center justify-center text-cyan-400/50 hover:text-cyan-400 hover:border-cyan-400/50 transition-all text-sm">⟳</button>
            <button onClick={handleLogout} className="text-[10px] font-mono text-zinc-600 hover:text-red-400 transition-colors uppercase tracking-wider">Logout</button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-5">
        {/* ─── Rocket Ship ──────────────────────────────────────────────── */}
        <RocketShip portfolioUsd={data.portfolio.totalUsd} roi={roi} />

        {/* ─── Capital Mandate Banner ───────────────────────────────────── */}
        {data.mandate && (
          <div className={`relative rounded-xl overflow-hidden border ${modeStyle.borderColor}`}>
            <div className={`absolute inset-0 bg-gradient-to-r ${modeStyle.gradient}`} />
            <div className="relative p-4 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xl">{modeStyle.icon}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-300/70">Zero Injection Protocol</span>
                    <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider ${
                      mandateMode === 'capital_halt' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                      mandateMode === 'survival' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                      mandateMode === 'growth' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                      'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    }`}>
                      {modeStyle.label}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-zinc-500 mt-1">
                    SEED: {fmt$(data.mandate.initialCapital)} → NOW: {fmt$(data.portfolio.totalUsd)} | HWM: {fmt$(data.mandate.highWaterMark)} | DAY {data.mandate.totalDaysActive}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 text-[10px] font-mono text-zinc-400">
                <span>ROI: <strong className={roi >= 0 ? 'neon-text-green' : 'neon-text-red'}>{roi >= 0 ? '+' : ''}{fmtPct(roi)}</strong></span>
                {data.mandate.consecutiveWinDays > 0 && <span className="text-emerald-400">🔥 {data.mandate.consecutiveWinDays} WIN STREAK</span>}
                {data.mandate.consecutiveLossDays > 0 && <span className="text-red-400">❄️ {data.mandate.consecutiveLossDays} LOSS STREAK</span>}
                {data.mandate.milestonesReached.length > 0 && <span className="text-purple-400">◆ {data.mandate.milestonesReached.length} MILESTONES</span>}
                <span>DENIALS: {data.mandate.tradeDenials}</span>
              </div>
            </div>
          </div>
        )}

        {/* ─── Top KPI Row ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard icon="◈" label="Net Worth" color="neon-text-cyan" value={fmt$(data.portfolio.totalUsd)}
            sub={`CB:${fmt$(data.portfolio.coinbaseUsd)} · KR:${fmt$(data.portfolio.krakenUsd)}`}
            trend={data.portfolio.netPnl > 0 ? 'up' : data.portfolio.netPnl < 0 ? 'down' : 'neutral'} />
          <StatCard icon="◉" label="Net P&L" value={fmt$(data.portfolio.netPnl)}
            color={data.portfolio.netPnl >= 0 ? 'neon-text-green' : 'neon-text-red'}
            sub={`Unrealized: ${fmt$(data.portfolio.unrealizedPnl)}`}
            trend={data.portfolio.netPnl >= 0 ? 'up' : 'down'} />
          <StatCard icon="◎" label="Win Rate" color="neon-text-purple" value={fmtPct(data.trades.winRate * 100)}
            sub={`${data.trades.wins}W / ${data.trades.losses}L`} />
          <StatCard icon="◆" label="Total Ops" color="text-cyan-300" value={String(data.trades.total)}
            sub={`Live:${data.trades.liveCount} · Sim:${data.trades.dryRunCount}`} />
          <StatCard icon="⬡" label="Volume" color="neon-text-gold" value={fmtCompact(data.trades.totalVolume)}
            sub={`Avg: ${fmtCompact(data.trades.totalVolume / Math.max(1, data.trades.total))}/op`} />
          <StatCard icon="◇" label="Signals" color="text-purple-400" value={String(data.signalBus.totalActive)}
            sub={`${Object.keys(data.signalBus.types).length} classes active`} />
        </div>

        {/* ─── Tab Navigation ───────────────────────────────────────────── */}
        <div className="flex gap-1 bg-black/50 backdrop-blur rounded-xl p-1 border border-cyan-500/10">
          {tabItems.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 rounded-lg text-xs font-mono uppercase tracking-wider transition-all duration-300 ${
                tab === t.key
                  ? 'bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-cyan-300 border border-cyan-500/20 shadow-[0_0_15px_rgba(0,255,255,0.1)]'
                  : 'text-zinc-600 hover:text-zinc-400 hover:bg-white/[0.02]'
              }`}
            >
              <span className="mr-1.5">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {/* ═══ OVERVIEW TAB ═══════════════════════════════════════════════ */}
        {tab === 'overview' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="holo-card rounded-2xl p-5 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
                <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-400/50 mb-4">◈ Cumulative P&L Trajectory</h3>
                <div className="h-56"><Line data={pnlChartData} options={{ ...chartDefaults, plugins: { ...chartDefaults.plugins, legend: { display: false } } } as any} /></div>
              </div>
              <div className="holo-card rounded-2xl p-5 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/30 to-transparent" />
                <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-purple-400/50 mb-4">◉ Daily Volume Distribution</h3>
                <div className="h-56"><Bar data={volumeChartData} options={chartDefaults as any} /></div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="holo-card rounded-2xl p-5">
                <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-400/50 mb-4">◎ Confidence Spectrum</h3>
                <div className="h-48 flex items-center justify-center">
                  <Doughnut data={confChartData} options={{ ...chartDefaults, scales: undefined, cutout: '65%' } as any} />
                </div>
              </div>
              <div className="holo-card rounded-2xl p-5">
                <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-400/50 mb-4">◆ Venue Allocation</h3>
                <div className="h-48 flex items-center justify-center">
                  <Doughnut data={venueChartData} options={{ ...chartDefaults, scales: undefined, cutout: '65%' } as any} />
                </div>
                <div className="flex flex-wrap gap-2 mt-3 justify-center">
                  {venueNames.map((v, i) => (
                    <span key={v} className="text-[9px] font-mono text-zinc-500 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ['#00ffff', '#8b5cf6', '#ff3366', '#00ff88', '#ffaa00'][i], boxShadow: `0 0 4px ${['#00ffff', '#8b5cf6', '#ff3366', '#00ff88', '#ffaa00'][i]}` }} />
                      {v}
                    </span>
                  ))}
                </div>
              </div>
              <div className="holo-card rounded-2xl p-5">
                <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-400/50 mb-4">⬡ Asset Performance Matrix</h3>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {Object.entries(data.assetStats).sort((a, b) => b[1].volume - a[1].volume).map(([asset, stats]) => (
                    <div key={asset} className="flex items-center justify-between text-xs group">
                      <span className="text-zinc-400 font-mono group-hover:text-cyan-300 transition-colors">{asset}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-[9px] text-zinc-600 font-mono">{stats.trades}ops</span>
                        <span className="text-[10px] font-mono text-zinc-500">{fmtCompact(stats.volume)}</span>
                        <span className={`text-[10px] font-mono font-bold ${stats.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt$(stats.pnl)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="holo-card rounded-2xl p-5">
              <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-400/50 mb-4">◈ Venue Performance Matrix</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-cyan-500/40 text-[9px] uppercase tracking-wider border-b border-cyan-500/10">
                      <th className="text-left pb-3">Venue</th>
                      <th className="text-right pb-3">Ops</th>
                      <th className="text-right pb-3">Volume</th>
                      <th className="text-right pb-3">P&L</th>
                      <th className="text-right pb-3">Win Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.venueStats).map(([venue, stats]) => (
                      <tr key={venue} className="border-b border-white/[0.02] hover:bg-cyan-500/[0.03] transition-colors">
                        <td className="py-2.5 text-zinc-300">{venue}</td>
                        <td className="py-2.5 text-right text-zinc-500">{stats.trades}</td>
                        <td className="py-2.5 text-right text-zinc-300">{fmtCompact(stats.volume)}</td>
                        <td className={`py-2.5 text-right font-bold ${stats.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt$(stats.pnl)}</td>
                        <td className="py-2.5 text-right text-zinc-400">{stats.wins + stats.losses > 0 ? fmtPct((stats.wins / (stats.wins + stats.losses)) * 100) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ─── Agent Roster ───────────────────────────────────────── */}
            {data.agents && (
              <div className="holo-card rounded-2xl p-5 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="relative w-8 h-8 flex items-center justify-center">
                      <div className="absolute inset-0 border border-emerald-500/30 rotate-45" />
                      <span className="text-sm">🤖</span>
                    </div>
                    <div>
                      <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400/70">Agent Workforce</h3>
                      <div className="text-[9px] font-mono text-zinc-600 mt-0.5">Autonomous agents deployed across the empire</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-3xl font-black neon-text-green">{data.agents.total}</div>
                      <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">Total Agents</div>
                    </div>
                    <div className="w-px h-10 bg-zinc-800" />
                    <div className="text-right">
                      <div className="text-2xl font-black text-emerald-400">{data.agents.active}</div>
                      <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">Active</div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                  {data.agents.roles.map(role => {
                    const roleActive = role.agents.filter(a => a.status === 'active').length;
                    return (
                      <div key={role.role} className="bg-white/[0.02] rounded-xl p-4 border border-cyan-500/5 hover:border-cyan-500/15 transition-all group">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-base">{role.icon}</span>
                          <div>
                            <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-300/70">{role.role}</div>
                            <div className="text-[9px] font-mono text-zinc-600">{roleActive}/{role.agents.length} active</div>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          {role.agents.map(agent => (
                            <div key={agent.name} className="flex items-center gap-2 text-[10px] font-mono">
                              <span className="relative flex h-1.5 w-1.5 shrink-0">
                                {agent.status === 'active' && (
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                )}
                                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
                                  agent.status === 'active' ? 'bg-emerald-400' :
                                  agent.status === 'error' ? 'bg-red-500 animate-pulse' :
                                  'bg-zinc-600'
                                }`} />
                              </span>
                              <span className="text-zinc-400 group-hover:text-zinc-300 transition-colors truncate">{agent.name}</span>
                              <span className="ml-auto text-zinc-600 text-[8px] truncate max-w-[60px]">{agent.detail}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ TRADES TAB ═════════════════════════════════════════════════ */}
        {tab === 'trades' && (
          <div className="space-y-5">
            <div className="holo-card rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-400/50">◉ Operation Log</h3>
                <span className="text-[9px] font-mono text-zinc-600">{data.trades.total} total operations</span>
              </div>
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead className="sticky top-0 bg-[#0a0a1e]/95 backdrop-blur">
                    <tr className="text-cyan-500/40 text-[9px] uppercase tracking-wider border-b border-cyan-500/10">
                      <th className="text-left pb-2 pl-2">Time</th>
                      <th className="text-left pb-2">Asset</th>
                      <th className="text-left pb-2">Venue</th>
                      <th className="text-center pb-2">Side</th>
                      <th className="text-right pb-2">Size</th>
                      <th className="text-right pb-2">Conf</th>
                      <th className="text-right pb-2">Edge</th>
                      <th className="text-right pb-2">P&L</th>
                      <th className="text-center pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.tradeTimeline].reverse().map((t, i) => (
                      <tr key={i} className="border-b border-white/[0.02] hover:bg-cyan-500/[0.03] transition-colors">
                        <td className="py-2 pl-2 text-zinc-600">{t.time ? new Date(t.time).toLocaleString() : '—'}</td>
                        <td className="py-2 text-cyan-300 font-semibold">{t.asset}</td>
                        <td className="py-2 text-zinc-500">{t.venue}</td>
                        <td className="py-2 text-center">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                            t.side === 'buy' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'
                          }`}>{t.side?.toUpperCase()}</span>
                        </td>
                        <td className="py-2 text-right text-zinc-300">{fmt$(t.usdSize || 0)}</td>
                        <td className="py-2 text-right text-purple-400">{((t.confidence || 0) * 100).toFixed(0)}%</td>
                        <td className="py-2 text-right text-cyan-400">{((t.edge || 0) * 100).toFixed(1)}%</td>
                        <td className={`py-2 text-right font-bold ${(t.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {t.pnl != null ? fmt$(t.pnl) : '—'}
                        </td>
                        <td className="py-2 text-center">
                          {t.dryRun ? (
                            <span className="px-2 py-0.5 rounded text-[8px] bg-zinc-500/10 text-zinc-500 border border-zinc-500/20">SIM</span>
                          ) : t.outcome ? (
                            <span className={`px-2 py-0.5 rounded text-[8px] font-bold border ${
                              t.outcome === 'win' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'
                            }`}>{t.outcome.toUpperCase()}</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[8px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 animate-pulse">LIVE</span>
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Coinbase */}
              <div className={`holo-card rounded-2xl p-5 relative overflow-hidden ${!data.guardian.coinbase.healthy ? 'border-red-500/30' : ''}`}>
                {!data.guardian.coinbase.healthy && <div className="absolute inset-0 bg-red-500/[0.03]" />}
                <div className="relative">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-400/50">◈ Coinbase Margin Status</h3>
                    <HexStatus active={data.guardian.coinbase.healthy} label={data.guardian.coinbase.healthy ? 'NOMINAL' : 'AT RISK'} pulse />
                  </div>
                  <div className="space-y-3">
                    <CyberGauge value={data.guardian.coinbase.marginPct} max={100} label="Margin Utilization" warn={70} danger={85} />
                    <CyberGauge value={data.guardian.coinbase.liquidationBuffer} max={200} label={`Liquidation Buffer (${fmt$(data.guardian.coinbase.liquidationBuffer)})`} />
                    <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-cyan-500/5">
                      <div className="text-[10px] font-mono"><span className="text-zinc-600">BALANCE:</span> <span className="text-cyan-300">{fmt$(data.guardian.coinbase.totalBalance)}</span></div>
                      <div className="text-[10px] font-mono"><span className="text-zinc-600">MARGIN:</span> <span className="text-cyan-300">{fmt$(data.guardian.coinbase.initialMargin)}</span></div>
                      <div className="text-[10px] font-mono"><span className="text-zinc-600">UNREAL:</span> <span className={data.guardian.coinbase.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmt$(data.guardian.coinbase.unrealizedPnl)}</span></div>
                      <div className="text-[10px] font-mono"><span className="text-zinc-600">POSITIONS:</span> <span className="text-cyan-300">{data.guardian.coinbase.positions.length}</span></div>
                    </div>
                    {data.guardian.coinbase.positions.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        <div className="text-[9px] font-mono text-cyan-500/40 uppercase tracking-wider">Open Positions</div>
                        {data.guardian.coinbase.positions.map((p: any, i: number) => (
                          <div key={i} className="flex items-center justify-between text-[10px] font-mono bg-white/[0.02] rounded-lg px-3 py-2 border border-cyan-500/5">
                            <span className="text-cyan-300">{p.productId}</span>
                            <span className={`font-bold ${p.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>{p.side}</span>
                            <span className="text-zinc-500">{p.contracts}x</span>
                            <span className={p.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmt$(p.unrealizedPnl)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Kraken */}
              <div className={`holo-card rounded-2xl p-5 relative overflow-hidden ${!data.guardian.kraken.healthy ? 'border-red-500/30' : ''}`}>
                {!data.guardian.kraken.healthy && <div className="absolute inset-0 bg-red-500/[0.03]" />}
                <div className="relative">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-purple-400/50">◉ Kraken Margin Status</h3>
                    <HexStatus active={data.guardian.kraken.healthy} label={data.guardian.kraken.healthy ? 'NOMINAL' : 'AT RISK'} pulse />
                  </div>
                  <div className="space-y-3">
                    <CyberGauge value={data.guardian.kraken.marginPct} max={100} label="Margin Utilization" warn={70} danger={85} />
                    <CyberGauge value={data.guardian.kraken.freeMargin} max={data.guardian.kraken.equity || 200} label={`Free Margin (${fmt$(data.guardian.kraken.freeMargin)})`} />
                    <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-purple-500/5">
                      <div className="text-[10px] font-mono"><span className="text-zinc-600">EQUITY:</span> <span className="text-purple-300">{fmt$(data.guardian.kraken.equity)}</span></div>
                      <div className="text-[10px] font-mono"><span className="text-zinc-600">MARGIN:</span> <span className="text-purple-300">{fmt$(data.guardian.kraken.marginUsed)}</span></div>
                      <div className="text-[10px] font-mono"><span className="text-zinc-600">UNREAL:</span> <span className={data.guardian.kraken.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmt$(data.guardian.kraken.unrealizedPnl)}</span></div>
                      <div className="text-[10px] font-mono"><span className="text-zinc-600">POSITIONS:</span> <span className="text-purple-300">{data.guardian.kraken.positions.length}</span></div>
                    </div>
                    {data.guardian.kraken.positions.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        <div className="text-[9px] font-mono text-purple-500/40 uppercase tracking-wider">Open Positions</div>
                        {data.guardian.kraken.positions.map((p: any, i: number) => (
                          <div key={i} className="flex items-center justify-between text-[10px] font-mono bg-white/[0.02] rounded-lg px-3 py-2 border border-purple-500/5">
                            <span className="text-purple-300">{p.pair}</span>
                            <span className={`font-bold ${p.type === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>{p.type?.toUpperCase()}</span>
                            <span className={p.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmt$(p.pnl)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon="◆" label="Drawdown" value={fmtPct(data.risk.drawdownPct)} color={data.risk.drawdownPct > 10 ? 'neon-text-red' : 'neon-text-green'} />
              <StatCard icon="◇" label="Daily P&L" value={fmt$(data.risk.dailyPnl?.pnl || 0)} color={(data.risk.dailyPnl?.pnl || 0) >= 0 ? 'neon-text-green' : 'neon-text-red'} sub={data.risk.dailyPnl?.date || '—'} />
              <StatCard icon="⬡" label="Emergency Ops" value={String(data.guardian.emergencyCloses)} color={data.guardian.emergencyCloses > 0 ? 'neon-text-gold' : 'text-zinc-500'} />
              <StatCard icon="■" label="Kill Switch" value={data.risk.killSwitchActive ? 'ENGAGED' : 'DISARMED'} color={data.risk.killSwitchActive ? 'neon-text-red' : 'neon-text-green'} />
            </div>

            {data.guardian.actions.length > 0 && (
              <div className="holo-card rounded-2xl p-5 border-amber-500/20">
                <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-amber-400/50 mb-4">⚡ Guardian Action Log</h3>
                <div className="space-y-2">
                  {data.guardian.actions.map((a: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 text-[10px] font-mono bg-amber-500/[0.03] rounded-lg px-3 py-2 border border-amber-500/10">
                      <span className="text-amber-400 font-bold">{a.action}</span>
                      <span className="text-zinc-500">{a.venue}</span>
                      {a.position && <span className="text-zinc-400">{a.position.productId || a.position.pair}</span>}
                      <span className="ml-auto text-zinc-600">{a.ts ? timeAgo(a.ts) : ''}</span>
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="holo-card rounded-2xl p-5">
                <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-pink-400/50 mb-4">◎ Signal Source Distribution</h3>
                <div className="h-56"><Bar data={signalChartData} options={chartDefaults as any} /></div>
                <div className="text-[9px] font-mono text-zinc-600 mt-2">{data.signalBus.totalActive} active signals · {Object.keys(data.signalBus.sources).length} sources</div>
              </div>
              <div className="holo-card rounded-2xl p-5">
                <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-pink-400/50 mb-4">◎ Signal Classification</h3>
                <div className="space-y-2.5">
                  {Object.entries(data.signalBus.types).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between group">
                      <span className="text-[10px] font-mono text-zinc-500 group-hover:text-purple-300 transition-colors">{type.replace(/_/g, ' ')}</span>
                      <div className="flex items-center gap-3">
                        <div className="w-28 h-1.5 bg-zinc-900 rounded-full overflow-hidden gauge-glow">
                          <div className="h-full bg-gradient-to-r from-purple-600 to-pink-500 rounded-full transition-all duration-700"
                            style={{ width: `${(count / data.signalBus.totalActive) * 100}%`, boxShadow: '0 0 6px rgba(168,85,247,0.4)' }} />
                        </div>
                        <span className="text-[10px] font-mono text-zinc-400 w-6 text-right">{count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Brain */}
              <div className="holo-card rounded-2xl p-5 border-purple-500/20">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-full border border-purple-500/30 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                  </div>
                  <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-purple-400/70">Neural Core</h3>
                </div>
                {data.brain ? (
                  <div className="space-y-3 text-[10px] font-mono">
                    <div><span className="text-zinc-600">GENERATION:</span> <span className="neon-text-purple">{data.brain.generation}</span></div>
                    <div><span className="text-zinc-600">PROFILES:</span> <span className="text-purple-300">{data.brain.assetProfiles}</span></div>
                    <div><span className="text-zinc-600">EVOLVED:</span> <span className="text-zinc-500">{data.brain.lastEvolved ? timeAgo(new Date(data.brain.lastEvolved).getTime()) : 'never'}</span></div>
                    {data.brain.topIndicators.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-purple-500/10">
                        <div className="text-[9px] text-purple-500/40 uppercase tracking-wider mb-2">Weight Matrix</div>
                        {data.brain.topIndicators.map(ind => (
                          <div key={ind.indicator} className="flex items-center justify-between mt-1.5">
                            <span className="text-zinc-400 truncate max-w-[100px]">{ind.indicator}</span>
                            <div className="flex items-center gap-2">
                              <div className="w-14 h-1 bg-zinc-900 rounded-full overflow-hidden">
                                <div className="h-full bg-purple-500 rounded-full" style={{ width: `${Math.min(100, ind.weight * 100)}%` }} />
                              </div>
                              <span className="text-purple-400 w-8 text-right">{(ind.weight * 100).toFixed(0)}%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] font-mono text-zinc-600">Awaiting 8+ operations to initialize</p>
                )}
              </div>

              {/* Orchestrator */}
              <div className="holo-card rounded-2xl p-5 border-cyan-500/20">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-full border border-cyan-500/30 flex items-center justify-center">
                    <div className="w-2 h-2 bg-cyan-400 rotate-45" />
                  </div>
                  <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-400/70">Orchestrator</h3>
                </div>
                <div className="space-y-3 text-[10px] font-mono">
                  <div><span className="text-zinc-600">CYCLES:</span> <span className="text-2xl neon-text-cyan">{data.orchestrator.cycleCount}</span></div>
                  <div><span className="text-zinc-600">OPS EXECUTED:</span> <span className="text-cyan-300">{data.orchestrator.totalTrades}</span></div>
                  <div><span className="text-zinc-600">LAST CYCLE:</span> <span className="text-zinc-500">{data.orchestrator.lastRun ? timeAgo(new Date(data.orchestrator.lastRun).getTime()) : 'never'}</span></div>
                  {data.orchestrator.errors.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-red-500/10">
                      <div className="text-[9px] text-red-500/40 uppercase tracking-wider mb-1">Error Buffer</div>
                      {data.orchestrator.errors.map((e: any, i: number) => (
                        <div key={i} className="text-[9px] text-red-400/50 truncate mt-1">{typeof e === 'string' ? e : JSON.stringify(e).slice(0, 80)}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Scaler */}
              <div className="holo-card rounded-2xl p-5 border-emerald-500/20">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-full border border-emerald-500/30 flex items-center justify-center">
                    <div className="w-2 h-2 bg-emerald-400 rounded-sm animate-pulse" />
                  </div>
                  <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-400/70">Horizontal Scaler</h3>
                </div>
                {data.scaler ? (
                  <div className="space-y-3 text-[10px] font-mono">
                    <div><span className="text-zinc-600">ACTIVE:</span> <span className="text-emerald-300">{data.scaler.activeAssets.length} assets</span></div>
                    <div><span className="text-zinc-600">CANDIDATES:</span> <span className="text-zinc-400">{data.scaler.candidateCount}</span></div>
                    <div><span className="text-zinc-600">PROMOTED:</span> <span className="text-emerald-400">{data.scaler.promotions}</span></div>
                    <div><span className="text-zinc-600">DEMOTED:</span> <span className="text-red-400">{data.scaler.demotions}</span></div>
                    <div><span className="text-zinc-600">LAST SCAN:</span> <span className="text-zinc-500">{data.scaler.lastScan ? timeAgo(new Date(data.scaler.lastScan).getTime()) : 'never'}</span></div>
                    {data.scaler.activeAssets.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-emerald-500/10">
                        {data.scaler.activeAssets.map((a: string) => (
                          <span key={a} className="px-2 py-0.5 rounded text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/15 font-mono">{a}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] font-mono text-zinc-600">Scaler not yet initialized</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── TREASURY TAB ────────────────────────────────────────── */}
        {tab === 'treasury' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Treasury Header */}
            <div className="holo-card rounded-2xl p-6 border-amber-500/20">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-full border border-amber-500/30 flex items-center justify-center">
                  <div className="w-3 h-3 bg-amber-400 rounded-sm animate-pulse" />
                </div>
                <h3 className="text-xs font-mono uppercase tracking-[0.3em] text-amber-400/80">Treasury Ledger · Wealth Empire</h3>
              </div>

              {data.treasury ? (
                <div className="space-y-6">
                  {/* Core Metrics Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
                      <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Lifetime P&L</div>
                      <div className={`text-lg font-mono font-bold ${data.treasury.lifetimePnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {data.treasury.lifetimePnl >= 0 ? '+' : ''}{fmt$(data.treasury.lifetimePnl)}
                      </div>
                    </div>
                    <div className="text-center p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
                      <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Win Rate</div>
                      <div className="text-lg font-mono font-bold text-cyan-400">{data.treasury.winRate}%</div>
                    </div>
                    <div className="text-center p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
                      <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Profit Factor</div>
                      <div className="text-lg font-mono font-bold text-purple-400">{data.treasury.profitFactor}x</div>
                    </div>
                    <div className="text-center p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
                      <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Lifetime Trades</div>
                      <div className="text-lg font-mono font-bold text-zinc-300">{data.treasury.lifetimeTrades}</div>
                    </div>
                  </div>

                  {/* Capital Tracking */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
                      <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Peak Capital</div>
                      <div className="text-sm font-mono text-amber-400">{fmt$(data.treasury.peakCapital)}</div>
                    </div>
                    <div className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
                      <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Max Drawdown</div>
                      <div className="text-sm font-mono text-red-400">{data.treasury.maxDrawdownPct}%</div>
                    </div>
                    <div className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
                      <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Next Milestone</div>
                      <div className="text-sm font-mono text-emerald-400">{data.treasury.nextMilestone ? fmt$(data.treasury.nextMilestone) : 'ALL REACHED'}</div>
                    </div>
                  </div>

                  {/* Milestones Progress */}
                  {data.treasury.nextMilestone && (
                    <div className="p-4 rounded-xl bg-zinc-900/50 border border-amber-500/10">
                      <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-2">Milestone Progress</div>
                      <div className="w-full bg-zinc-800 rounded-full h-2">
                        <div
                          className="bg-gradient-to-r from-amber-500 to-emerald-400 h-2 rounded-full transition-all"
                          style={{ width: `${Math.min(100, (data.treasury.currentCapital / data.treasury.nextMilestone) * 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-[9px] font-mono text-zinc-600">{fmt$(data.treasury.currentCapital)}</span>
                        <span className="text-[9px] font-mono text-amber-400/60">{fmt$(data.treasury.nextMilestone)}</span>
                      </div>
                    </div>
                  )}

                  {/* Daily P&L Chart */}
                  {data.treasury.dailySnapshots?.length > 0 && (
                    <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
                      <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-3">Daily P&L (Last 30d)</div>
                      <div className="flex items-end gap-1 h-24">
                        {data.treasury.dailySnapshots.map((d: any, i: number) => {
                          const maxAbs = Math.max(...(data.treasury?.dailySnapshots || []).map((s: any) => Math.abs(s.pnl)), 1);
                          const h = Math.max(2, Math.abs(d.pnl) / maxAbs * 80);
                          return (
                            <div key={i} className="flex-1 flex flex-col items-center justify-end" title={`${d.date}: $${d.pnl}`}>
                              <div
                                className={`w-full rounded-sm ${d.pnl >= 0 ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
                                style={{ height: `${h}%` }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Weekly Summaries */}
                  {data.treasury.weeklySummaries?.length > 0 && (
                    <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
                      <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-3">Weekly Performance</div>
                      <div className="space-y-2">
                        {data.treasury.weeklySummaries.slice(-4).reverse().map((w: any, i: number) => (
                          <div key={i} className="flex justify-between items-center text-[10px] font-mono">
                            <span className="text-zinc-500">{w.weekStart}</span>
                            <span className={w.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{w.pnl >= 0 ? '+' : ''}{fmt$(w.pnl)}</span>
                            <span className="text-zinc-600">{w.trades} trades</span>
                            <span className="text-cyan-400/60">{w.winRate}% WR</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="text-[9px] font-mono text-zinc-700 text-center">
                    Updated {data.treasury.updatedAt ? timeAgo(data.treasury.updatedAt) : 'never'}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="text-[10px] font-mono text-zinc-600">Treasury Ledger initializing...</div>
                  <div className="text-[9px] font-mono text-zinc-700 mt-1">Data will populate after the next orchestrator cycle</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Footer ──────────────────────────────────────────────────── */}
        <div className="text-center py-6 space-y-1">
          <div className="text-[10px] font-mono tracking-[0.3em] text-cyan-500/20 uppercase">FreedomForge Max · Autonomous Trading Empire</div>
          <div className="text-[9px] font-mono text-zinc-700">All systems monitored 24/7 · Zero human intervention required</div>
        </div>
      </main>
    </div>
  );
}
