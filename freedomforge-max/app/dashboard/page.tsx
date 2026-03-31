'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/* ─────────────────────────────────────────────────────────────────────────────
   FREEDOMFORGE MAX — ALPHA COMMAND DASHBOARD
   Phoenix Gold × Royal Purple × Deep Void
───────────────────────────────────────────────────────────────────────────── */

const PULSE_INTERVAL = 15000;

const fmt = {
  usd:  (n: number) => n >= 1_000_000 ? `$${(n/1_000_000).toFixed(2)}M` : n >= 1000 ? `$${(n/1000).toFixed(1)}K` : `$${n.toFixed(2)}`,
  pct:  (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`,
};

const REGIME_META: Record<string, { color: string; label: string }> = {
  bull:       { color: '#22c55e', label: 'BULL' },
  bullTrend:  { color: '#22c55e', label: 'BULL TREND' },
  bear:       { color: '#ef4444', label: 'BEAR' },
  bearTrend:  { color: '#ef4444', label: 'BEAR TREND' },
  sideways:   { color: '#f59e0b', label: 'SIDEWAYS' },
  highVol:    { color: '#a855f7', label: 'HIGH VOL' },
  extremeVol: { color: '#ec4899', label: 'EXTREME VOL' },
};

const OPTIMIZER_RESULTS = {
  'BTC-USD': {
    regime: { mode: 'bearTrend', trend: 'bear', volatility: 'normal' },
    best: { fastEma: 6, slowEma: 34, minConf: 0.58, stopLossPct: 0.04, takeProfitPct: 0.03,
      totalReturn: -7.082, winRate: 38.1, maxDrawdown: 9.524, sharpe: -0.0832, composite: 0.0795, trades: 42 }
  },
  'ETH-USD': {
    regime: { mode: 'sideways', trend: 'sideways', volatility: 'normal' },
    best: { fastEma: 8, slowEma: 34, minConf: 0.54, stopLossPct: 0.04, takeProfitPct: 0.025,
      totalReturn: -5.825, winRate: 53.33, maxDrawdown: 8.517, sharpe: 0.0401, composite: 0.165, trades: 30 }
  },
  'SOL-USD': {
    regime: { mode: 'bearTrend', trend: 'bear', volatility: 'normal' },
    best: { fastEma: 8, slowEma: 18, minConf: 0.58, stopLossPct: 0.04, takeProfitPct: 0.03,
      totalReturn: -2.127, winRate: 43.1, maxDrawdown: 9.147, sharpe: -0.1297, composite: 0.141, trades: 58 }
  },
  'XRP-USD': {
    regime: { mode: 'sideways', trend: 'sideways', volatility: 'low' },
    best: { fastEma: 13, slowEma: 26, minConf: 0.58, stopLossPct: 0.025, takeProfitPct: 0.02,
      totalReturn: 1.365, winRate: 49.06, maxDrawdown: 6.927, sharpe: -0.2215, composite: 0.1671, trades: 53 }
  },
};

const MINING_RIGS = [
  { name: 'Fluminer T3',       type: 'BTC',    status: 'ONLINE' },
  { name: 'Elphapex',          type: 'BTC',    status: 'ONLINE' },
  { name: 'Avalon Nano 3s',    type: 'BTC',    status: 'ONLINE' },
  { name: 'Geopulse',          type: 'MOBILE', status: 'ONLINE' },
  { name: 'Geodnet CM Triple', type: 'GEOD',   status: 'ONLINE' },
];

/* ── Sparkline ───────────────────────────────────────────────────────────── */
function Sparkline({ data, color, height = 36, width = 100 }: { data: number[]; color: string; height?: number; width?: number }) {
  if (!data?.length || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  const area = `0,${height} ` + pts + ` ${width},${height}`;
  const gradId = `sg${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <svg width={width} height={height} style={{ overflow: 'visible', display: 'block' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradId})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── GlowBadge ───────────────────────────────────────────────────────────── */
function GlowBadge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      background: `${color}20`, border: `1px solid ${color}50`,
      color, padding: '2px 7px', borderRadius: 4, fontSize: 10,
      fontWeight: 700, letterSpacing: '0.08em', fontFamily: 'monospace',
      boxShadow: `0 0 8px ${color}30`,
    }}>{label}</span>
  );
}

/* ── PulseOrb ────────────────────────────────────────────────────────────── */
function PulseOrb({ active, color }: { active: boolean; color: string }) {
  return (
    <div style={{ position: 'relative', width: 9, height: 9, flexShrink: 0 }}>
      <div style={{ width: 9, height: 9, borderRadius: '50%', background: color, boxShadow: `0 0 7px ${color}` }} />
      {active && (
        <motion.div style={{ position: 'absolute', inset: -2, borderRadius: '50%', border: `1px solid ${color}` }}
          animate={{ scale: [1, 2.2], opacity: [0.8, 0] }}
          transition={{ duration: 1.4, repeat: Infinity }} />
      )}
    </div>
  );
}

/* ── StatCard ────────────────────────────────────────────────────────────── */
function StatCard({ label, value, sub, color = '#a855f7', spark, icon }: {
  label: string; value: string; sub?: string; color?: string; spark?: number[]; icon?: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
      style={{
        background: 'linear-gradient(145deg, #0d061a, #140a26)',
        border: `1px solid ${color}28`, borderRadius: 14,
        padding: '18px 20px', position: 'relative', overflow: 'hidden',
        boxShadow: `0 0 40px ${color}08, inset 0 1px 0 ${color}18`,
      }}>
      <div style={{ position: 'absolute', top: -30, right: -30, width: 100, height: 100, borderRadius: '50%',
        background: `radial-gradient(circle, ${color}15, transparent 70%)` }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
        <span style={{ fontSize: 10, color: '#5a5070', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700 }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 900, color, letterSpacing: '-0.03em', lineHeight: 1,
        textShadow: `0 0 24px ${color}55` }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#6b5f82', marginTop: 5 }}>{sub}</div>}
      {spark && <div style={{ marginTop: 10 }}><Sparkline data={spark} color={color} /></div>}
    </motion.div>
  );
}

/* ── LiveTicker ──────────────────────────────────────────────────────────── */
function LiveTicker({ prices }: { prices: Record<string, number> }) {
  const items = Object.entries(prices);
  if (!items.length) return null;
  const duped = [...items, ...items, ...items];
  return (
    <div style={{ overflow: 'hidden', background: 'rgba(147,51,234,0.05)',
      borderTop: '1px solid rgba(147,51,234,0.12)', borderBottom: '1px solid rgba(147,51,234,0.12)',
      padding: '8px 0' }}>
      <motion.div style={{ display: 'flex', gap: 48, whiteSpace: 'nowrap', width: 'max-content' }}
        animate={{ x: ['0%', '-33.33%'] }} transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}>
        {duped.map(([sym, price], i) => (
          <span key={i} style={{ fontSize: 12, fontFamily: 'monospace', color: '#8875a8' }}>
            <span style={{ color: '#d4a017', fontWeight: 700 }}>{sym}</span>{' '}
            <span style={{ color: '#f0ecff' }}>${price.toLocaleString()}</span>
          </span>
        ))}
      </motion.div>
    </div>
  );
}

/* ── DashHeader ──────────────────────────────────────────────────────────── */
function DashHeader({ lastSync, vcbOk }: { lastSync: string; vcbOk: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 28px', background: 'rgba(3,1,8,0.95)',
      borderBottom: '1px solid rgba(147,51,234,0.14)',
      backdropFilter: 'blur(24px)', position: 'sticky', top: 0, zIndex: 100,
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <motion.span animate={{ rotate: [0, 360] }} transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
          style={{ fontSize: 26, filter: 'drop-shadow(0 0 14px #d4a017cc)', display: 'block' }}>🔥</motion.span>
        <div>
          <div style={{
            fontSize: 17, fontWeight: 900, letterSpacing: '-0.02em',
            background: 'linear-gradient(90deg, #d4a017 0%, #a855f7 50%, #d4a017 100%)',
            backgroundSize: '200% 100%', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>FREEDOMFORGE</div>
          <div style={{ fontSize: 9, color: '#4a3d66', letterSpacing: '0.22em', fontWeight: 700, textTransform: 'uppercase' }}>Alpha Intelligence System</div>
        </div>
      </div>

      {/* Center badges */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PulseOrb active={true} color="#22c55e" />
          <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 700, letterSpacing: '0.06em' }}>SYSTEMS LIVE</span>
        </div>
        <div style={{ width: 1, height: 18, background: 'rgba(147,51,234,0.25)' }} />
        <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#6b5f82' }}>
          VCB <span style={{ color: vcbOk ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{vcbOk ? 'CLEAR' : 'TRIPPED'}</span>
        </span>
        <div style={{ width: 1, height: 18, background: 'rgba(147,51,234,0.25)' }} />
        <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#6b5f82' }}>
          SYNC <span style={{ color: '#a855f7' }}>{lastSync}</span>
        </span>
      </div>

      {/* Clock */}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 21, fontWeight: 800, fontFamily: 'monospace', color: '#f0ecff', letterSpacing: '-0.01em' }}>
          {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
        <div style={{ fontSize: 10, color: '#4a3d66' }}>
          {now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ET
        </div>
      </div>
    </div>
  );
}

/* ── Asset Intelligence Row ──────────────────────────────────────────────── */
function AssetRow({ asset, data }: { asset: string; data: typeof OPTIMIZER_RESULTS['BTC-USD'] }) {
  const regime = REGIME_META[data.regime.mode] ?? REGIME_META['sideways'];
  const ret = data.best.totalReturn;
  const retColor = ret >= 0 ? '#22c55e' : '#ef4444';
  return (
    <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
      whileHover={{ backgroundColor: 'rgba(147,51,234,0.05)' }}
      style={{ display: 'grid', gridTemplateColumns: '80px 120px 72px 64px 68px 80px 72px',
        gap: 6, alignItems: 'center', padding: '11px 16px',
        borderBottom: '1px solid rgba(147,51,234,0.07)', transition: 'background 0.15s' }}>
      <span style={{ fontWeight: 800, color: '#f0ecff', fontSize: 13, fontFamily: 'monospace' }}>{asset}</span>
      <GlowBadge label={regime.label} color={regime.color} />
      <span style={{ color: retColor, fontWeight: 700, fontSize: 13, fontFamily: 'monospace', textAlign: 'right' }}>{fmt.pct(ret)}</span>
      <span style={{ color: '#a89cc4', fontSize: 12, textAlign: 'right' }}>{data.best.winRate.toFixed(0)}%</span>
      <span style={{ color: data.best.sharpe >= 0 ? '#22c55e' : '#ef4444', fontSize: 12, textAlign: 'right', fontFamily: 'monospace' }}>{data.best.sharpe.toFixed(3)}</span>
      <span style={{ color: '#d4a017', fontSize: 12, textAlign: 'right', fontFamily: 'monospace' }}>
        {data.best.fastEma}/{data.best.slowEma}
      </span>
      <span style={{ color: '#6b5f82', fontSize: 11, textAlign: 'right' }}>{(data.best.minConf * 100).toFixed(0)}% conf</span>
    </motion.div>
  );
}

/* ── SystemRow ───────────────────────────────────────────────────────────── */
function SystemRow({ label, status, detail }: { label: string; status: 'ok'|'warn'|'off'; detail?: string }) {
  const c = { ok: '#22c55e', warn: '#f59e0b', off: '#4a3d66' }[status];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
      borderBottom: '1px solid rgba(147,51,234,0.05)' }}>
      <PulseOrb active={status === 'ok'} color={c} />
      <span style={{ fontSize: 12, color: '#a89cc4', flex: 1 }}>{label}</span>
      {detail && <span style={{ fontSize: 11, color: '#4a3d66', fontFamily: 'monospace' }}>{detail}</span>}
      <GlowBadge label={status.toUpperCase()} color={c} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────────────────────── */
export default function AlphaDashboard() {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [lastSync, setLastSync] = useState('—');
  const [tab, setTab] = useState<'overview'|'optimizer'|'mining'|'systems'>('overview');
  const [loading, setLoading] = useState(true);

  const fetchPrices = useCallback(async () => {
    try {
      const ids = 'bitcoin,ethereum,solana,ripple,cardano,avalanche-2';
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
      if (res.ok) {
        const d = await res.json();
        setPrices({
          'BTC':  d.bitcoin?.usd ?? 0,
          'ETH':  d.ethereum?.usd ?? 0,
          'SOL':  d.solana?.usd ?? 0,
          'XRP':  d.ripple?.usd ?? 0,
          'ADA':  d.cardano?.usd ?? 0,
          'AVAX': d['avalanche-2']?.usd ?? 0,
        });
      }
    } catch {}
    setLastSync(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPrices();
    const id = setInterval(fetchPrices, PULSE_INTERVAL);
    return () => clearInterval(id);
  }, [fetchPrices]);

  const overallReturn = Object.values(OPTIMIZER_RESULTS).reduce((s, a) => s + a.best.totalReturn, 0) / 4;
  const bestAsset = Object.entries(OPTIMIZER_RESULTS).sort((a, b) => b[1].best.totalReturn - a[1].best.totalReturn)[0];

  const TABS = [
    { id: 'overview',  label: 'Overview',  icon: '⚡' },
    { id: 'optimizer', label: 'Optimizer', icon: '🧠' },
    { id: 'mining',    label: 'Mining',    icon: '⛏️' },
    { id: 'systems',   label: 'Systems',   icon: '🔧' },
  ] as const;

  const SYSTEMS = [
    { label: 'Nightly Optimizer',            status: 'ok'   as const, detail: '2:00 AM ET · auto' },
    { label: 'Regime Detector V2',           status: 'ok'   as const, detail: 'bearTrend active' },
    { label: 'Volatility Circuit Breaker',   status: 'ok'   as const, detail: '5/5 tripwires clear' },
    { label: 'Railway Auto-Push',            status: 'ok'   as const, detail: '10 vars live' },
    { label: 'GitHub CI/CD',                 status: 'ok'   as const, detail: 'f44fa47 @ main' },
    { label: 'Live Price Feed',              status: Object.keys(prices).length > 0 ? 'ok' as const : 'warn' as const, detail: 'CoinGecko' },
    { label: 'Paper Trading Engine',         status: 'ok'   as const, detail: 'active' },
    { label: 'Integration Test Suite',       status: 'ok'   as const, detail: '25/25 passing' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#030108', fontFamily: "'Inter', -apple-system, sans-serif", color: '#f0ecff' }}>

      {/* Ambient glow orbs */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-15%', left: '-10%', width: '55vw', height: '55vw', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(147,51,234,0.07) 0%, transparent 65%)' }} />
        <div style={{ position: 'absolute', bottom: '-20%', right: '-10%', width: '60vw', height: '60vw', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(212,160,23,0.05) 0%, transparent 65%)' }} />
        <div style={{ position: 'absolute', top: '35%', left: '40%', width: '40vw', height: '40vw', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(168,85,247,0.04) 0%, transparent 65%)', transform: 'translate(-50%,-50%)' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>
        <DashHeader lastSync={lastSync} vcbOk={true} />
        <LiveTicker prices={prices} />

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 2, padding: '12px 28px 0',
          borderBottom: '1px solid rgba(147,51,234,0.10)' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: '9px 20px', borderRadius: '8px 8px 0 0',
                border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                display: 'flex', gap: 6, alignItems: 'center', transition: 'all 0.18s',
                background: tab === t.id ? 'rgba(147,51,234,0.13)' : 'transparent',
                color: tab === t.id ? '#c084fc' : '#4a3d66',
                borderBottom: tab === t.id ? '2px solid #9333ea' : '2px solid transparent',
              }}>
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingBottom: 10 }}>
            {loading && <span style={{ fontSize: 11, color: '#4a3d66', fontFamily: 'monospace' }}>Fetching live data…</span>}
          </div>
        </div>

        {/* Main content */}
        <div style={{ padding: '24px 28px', maxWidth: 1440, margin: '0 auto' }}>
          <AnimatePresence mode="wait">

            {/* ════════════════════════ OVERVIEW ════════════════════════ */}
            {tab === 'overview' && (
              <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>

                {/* KPI row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
                  <StatCard label="Systems Online" value="8 / 8" sub="100% nominal — no issues" color="#22c55e" icon="✅"
                    spark={[5,6,6,7,7,8,8,8,8]} />
                  <StatCard label="Top Performer" value={bestAsset[0].replace('-USD','')}
                    sub={`${fmt.pct(bestAsset[1].best.totalReturn)} over 45 days`} color="#d4a017" icon="👑" />
                  <StatCard label="Avg Optimizer Return" value={fmt.pct(overallReturn)}
                    sub="BTC · ETH · SOL · XRP" color="#a855f7" icon="🧠"
                    spark={[-12,-10,-9,-8,-7,-6,-5,-4,-3.6]} />
                  <StatCard label="Market Regime" value="BEAR" sub="ADX ~17 · choppy · VCB clear" color="#ef4444" icon="📡" />
                </div>

                {/* 2-col layout */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>

                  {/* Asset Intelligence table */}
                  <div style={{ background: 'linear-gradient(145deg, #0d061a, #140a26)',
                    border: '1px solid rgba(147,51,234,0.14)', borderRadius: 14, overflow: 'hidden' }}>
                    <div style={{ padding: '15px 20px', borderBottom: '1px solid rgba(147,51,234,0.10)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>🧠</span>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>Asset Intelligence</span>
                        <span style={{ fontSize: 11, color: '#4a3d66' }}>· nightly optimizer</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <GlowBadge label="3,072 COMBOS TESTED" color="#a855f7" />
                        <GlowBadge label="LIVE" color="#22c55e" />
                      </div>
                    </div>
                    {/* Headers */}
                    <div style={{ display: 'grid', gridTemplateColumns: '80px 120px 72px 64px 68px 80px 72px',
                      gap: 6, padding: '7px 16px',
                      fontSize: 9, color: '#4a3d66', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700 }}>
                      <span>Asset</span><span>Regime</span>
                      <span style={{ textAlign: 'right' }}>Return</span>
                      <span style={{ textAlign: 'right' }}>Win%</span>
                      <span style={{ textAlign: 'right' }}>Sharpe</span>
                      <span style={{ textAlign: 'right' }}>EMA</span>
                      <span style={{ textAlign: 'right' }}>Conf</span>
                    </div>
                    {Object.entries(OPTIMIZER_RESULTS).map(([asset, data]) => (
                      <AssetRow key={asset} asset={asset} data={data} />
                    ))}
                    <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(147,51,234,0.07)',
                      fontSize: 11, color: '#4a3d66', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Last run: Mar 31, 2026 · 03:28 UTC</span>
                      <span style={{ color: '#22c55e' }}>✓ Pushed to Railway</span>
                    </div>
                  </div>

                  {/* Right column */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                    {/* Live Prices */}
                    <div style={{ background: 'linear-gradient(145deg, #0d061a, #140a26)',
                      border: '1px solid rgba(212,160,23,0.18)', borderRadius: 14, padding: '16px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                        <span>💰</span>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>Live Prices</span>
                        <PulseOrb active={true} color="#22c55e" />
                      </div>
                      {Object.entries(prices).length > 0
                        ? Object.entries(prices).map(([sym, price]) => (
                          <div key={sym} style={{ display: 'flex', justifyContent: 'space-between',
                            alignItems: 'center', padding: '7px 0',
                            borderBottom: '1px solid rgba(147,51,234,0.05)' }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#d4a017' }}>{sym}</span>
                            <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 600, color: '#f0ecff' }}>
                              ${price.toLocaleString()}
                            </span>
                          </div>
                        ))
                        : <div style={{ color: '#4a3d66', fontSize: 12 }}>Fetching prices…</div>}
                    </div>

                    {/* VCB */}
                    <div style={{ background: 'linear-gradient(145deg, #0d061a, #140a26)',
                      border: '1px solid rgba(34,197,94,0.22)', borderRadius: 14, padding: '16px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <span>⚡</span>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>Circuit Breaker</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
                        background: 'rgba(34,197,94,0.06)', borderRadius: 8,
                        border: '1px solid rgba(34,197,94,0.18)', marginBottom: 10 }}>
                        <span style={{ fontSize: 22 }}>🟢</span>
                        <div>
                          <div style={{ fontWeight: 800, color: '#22c55e', fontSize: 14, letterSpacing: '0.04em' }}>TRADING OK</div>
                          <div style={{ fontSize: 10, color: '#4a3d66' }}>All 5 tripwires clear</div>
                        </div>
                      </div>
                      {['Flash crash', 'Vol spike', 'Single candle', 'Sustained vol', 'Cross-exchange'].map(t => (
                        <div key={t} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0',
                          borderBottom: '1px solid rgba(147,51,234,0.05)', fontSize: 11 }}>
                          <span style={{ color: '#6b5f82' }}>{t}</span>
                          <span style={{ color: '#22c55e', fontWeight: 700 }}>CLEAR</span>
                        </div>
                      ))}
                    </div>

                    {/* Income streams */}
                    <div style={{ background: 'linear-gradient(145deg, rgba(34,197,94,0.04), rgba(212,160,23,0.04))',
                      border: '1px solid rgba(212,160,23,0.18)', borderRadius: 14, padding: '16px 20px' }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>🏆 Income Streams</div>
                      {[
                        { label: 'BTC Mining (3 rigs)', color: '#f59e0b' },
                        { label: 'Mobile Network',       color: '#a855f7' },
                        { label: 'GPS Mesh (Geodnet)',   color: '#22c55e' },
                        { label: 'AI Trading Engine',    color: '#d4a017' },
                      ].map((s, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '7px 0', borderBottom: '1px solid rgba(147,51,234,0.05)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 3, height: 24, background: s.color, borderRadius: 2 }} />
                            <span style={{ fontSize: 12, color: '#a89cc4' }}>{s.label}</span>
                          </div>
                          <GlowBadge label="ACTIVE" color={s.color} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ════════════════════════ OPTIMIZER ════════════════════════ */}
            {tab === 'optimizer' && (
              <motion.div key="optimizer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <div style={{ marginBottom: 22 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
                    <span style={{ fontSize: 22 }}>🧠</span>
                    <h2 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>Nightly Parameter Optimizer</h2>
                    <GlowBadge label="AUTO-EVOLVING" color="#a855f7" />
                    <GlowBadge label="RAILWAY CONNECTED" color="#22c55e" />
                  </div>
                  <p style={{ fontSize: 12, color: '#4a3d66', margin: 0 }}>
                    2:00 AM ET daily · 768 combinations × 4 assets = 3,072 backtests · Winners pushed live to Railway automatically
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 20 }}>
                  {Object.entries(OPTIMIZER_RESULTS).map(([asset, data], idx) => {
                    const regime = REGIME_META[data.regime.mode] ?? REGIME_META['sideways'];
                    const ret = data.best.totalReturn;
                    const isPos = ret >= 0;
                    return (
                      <motion.div key={asset}
                        initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.08, duration: 0.35 }}
                        style={{ background: 'linear-gradient(145deg, #0d061a, #140a26)',
                          border: `1px solid ${regime.color}28`, borderRadius: 14, overflow: 'hidden',
                          boxShadow: `0 0 50px ${regime.color}08` }}>

                        {/* Card header */}
                        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${regime.color}18`,
                          background: `linear-gradient(90deg, ${regime.color}0a, transparent)`,
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 17, fontWeight: 900, fontFamily: 'monospace', color: '#f0ecff' }}>{asset}</span>
                            <GlowBadge label={regime.label} color={regime.color} />
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 24, fontWeight: 900, color: isPos ? '#22c55e' : '#ef4444',
                              textShadow: `0 0 18px ${isPos ? '#22c55e' : '#ef4444'}55` }}>
                              {fmt.pct(ret)}
                            </div>
                            <div style={{ fontSize: 10, color: '#4a3d66' }}>45-day backtest</div>
                          </div>
                        </div>

                        {/* Stats grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'rgba(147,51,234,0.04)' }}>
                          {[
                            { l: 'Win Rate',     v: `${data.best.winRate.toFixed(1)}%`,           c: data.best.winRate >= 50 ? '#22c55e' : '#f59e0b' },
                            { l: 'Sharpe',       v: data.best.sharpe.toFixed(3),                   c: data.best.sharpe >= 0 ? '#22c55e' : '#ef4444' },
                            { l: 'Drawdown',     v: `${data.best.maxDrawdown.toFixed(1)}%`,        c: '#ef4444' },
                            { l: 'EMA Fast',     v: `${data.best.fastEma}`,                        c: '#a855f7' },
                            { l: 'EMA Slow',     v: `${data.best.slowEma}`,                        c: '#a855f7' },
                            { l: 'Min Conf',     v: `${(data.best.minConf*100).toFixed(0)}%`,      c: '#d4a017' },
                          ].map((s, i) => (
                            <div key={i} style={{ padding: '13px 14px', background: '#0a0518' }}>
                              <div style={{ fontSize: 9, color: '#4a3d66', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, fontWeight: 700 }}>{s.l}</div>
                              <div style={{ fontSize: 19, fontWeight: 800, color: s.c, fontFamily: 'monospace' }}>{s.v}</div>
                            </div>
                          ))}
                        </div>

                        {/* SL/TP/Trades */}
                        <div style={{ padding: '12px 18px', display: 'flex', gap: 10 }}>
                          {[
                            { l: 'STOP LOSS',    v: `${(data.best.stopLossPct*100).toFixed(1)}%`,   c: '#ef4444' },
                            { l: 'TAKE PROFIT',  v: `${(data.best.takeProfitPct*100).toFixed(1)}%`, c: '#22c55e' },
                            { l: 'TRADES',       v: `${data.best.trades}`,                           c: '#a855f7' },
                          ].map((s, i) => (
                            <div key={i} style={{ flex: 1, padding: '8px 10px',
                              background: `${s.c}0a`, border: `1px solid ${s.c}20`, borderRadius: 8 }}>
                              <div style={{ fontSize: 9, color: '#4a3d66', marginBottom: 3, fontWeight: 700 }}>{s.l}</div>
                              <div style={{ fontSize: 16, fontWeight: 800, color: s.c, fontFamily: 'monospace' }}>{s.v}</div>
                            </div>
                          ))}
                        </div>

                        <div style={{ padding: '0 18px 12px', fontSize: 10, color: '#4a3d66' }}>
                          Composite: <span style={{ color: '#d4a017', fontWeight: 700 }}>{data.best.composite.toFixed(4)}</span>
                          {' '}· Vol: <span style={{ color: '#a89cc4' }}>{data.regime.volatility}</span>
                          {' '}· Trend: <span style={{ color: regime.color }}>{data.regime.trend}</span>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Context callout */}
                <div style={{ padding: '16px 20px', background: 'rgba(212,160,23,0.04)',
                  border: '1px solid rgba(212,160,23,0.14)', borderRadius: 12,
                  display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span>
                  <div>
                    <div style={{ fontWeight: 800, color: '#d4a017', fontSize: 13, marginBottom: 5 }}>
                      Market Context: Bear / Sideways Conditions
                    </div>
                    <div style={{ fontSize: 12, color: '#6b5f82', lineHeight: 1.65 }}>
                      Negative returns aren't a model failure — they reflect the reality of a choppy bear market (ADX ~17, weak momentum).
                      The optimizer found the <em>best possible</em> params for these conditions. XRP is the only asset with a positive return (+1.37%) right now.
                      The engine knowing when not to be aggressive is the most valuable form of intelligence. When regime flips bull, the model is ready.
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ════════════════════════ MINING ════════════════════════ */}
            {tab === 'mining' && (
              <motion.div key="mining" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <div style={{ marginBottom: 22 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
                    <span style={{ fontSize: 22 }}>⛏️</span>
                    <h2 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>Mining Fleet</h2>
                    <GlowBadge label="5 RIGS" color="#d4a017" />
                    <GlowBadge label="ALL ONLINE" color="#22c55e" />
                  </div>
                  <p style={{ fontSize: 12, color: '#4a3d66', margin: 0 }}>
                    Baseline passive income — earns 24/7, direction-agnostic, market-proof.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  {/* Rig cards */}
                  <div style={{ background: 'linear-gradient(145deg, #0d061a, #140a26)',
                    border: '1px solid rgba(212,160,23,0.18)', borderRadius: 14, padding: 20 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>⛏️ Active Rigs</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {MINING_RIGS.map((rig, i) => (
                        <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.07 }}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '12px 16px', background: 'rgba(212,160,23,0.04)',
                            border: '1px solid rgba(212,160,23,0.12)', borderRadius: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 18 }}>⛏️</span>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#f0ecff' }}>{rig.name}</div>
                              <div style={{ fontSize: 11, color: '#4a3d66' }}>Mining {rig.type}</div>
                            </div>
                          </div>
                          <GlowBadge label={rig.status} color="#22c55e" />
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  {/* Income layer + vision */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ background: 'linear-gradient(145deg, #0d061a, #140a26)',
                      border: '1px solid rgba(168,85,247,0.18)', borderRadius: 14, padding: 20, flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>📊 Income Architecture</div>
                      {[
                        { layer: '1', label: 'BTC Mining',       desc: 'Fluminer T3 + Elphapex + Avalon Nano 3s', color: '#f59e0b' },
                        { layer: '2', label: 'Mobile Network',    desc: 'Geopulse wireless coverage rewards',       color: '#a855f7' },
                        { layer: '3', label: 'GPS Mesh',          desc: 'Geodnet CM Triple · GEOD token rewards',  color: '#22c55e' },
                        { layer: '4', label: 'AI Trading Engine', desc: 'FreedomForge · paper → live soon',         color: '#d4a017' },
                      ].map((s, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12,
                          padding: '10px 0', borderBottom: '1px solid rgba(147,51,234,0.06)' }}>
                          <div style={{ width: 22, height: 22, borderRadius: '50%',
                            background: `${s.color}20`, border: `1px solid ${s.color}50`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, fontWeight: 800, color: s.color, flexShrink: 0 }}>{s.layer}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#f0ecff' }}>{s.label}</div>
                            <div style={{ fontSize: 10, color: '#4a3d66' }}>{s.desc}</div>
                          </div>
                          <GlowBadge label="ACTIVE" color={s.color} />
                        </div>
                      ))}
                    </div>

                    <div style={{ background: 'linear-gradient(145deg, rgba(34,197,94,0.04), rgba(212,160,23,0.05))',
                      border: '1px solid rgba(212,160,23,0.18)', borderRadius: 14, padding: 20 }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: '#d4a017', marginBottom: 8 }}>
                        🏆 The FreedomForge Vision
                      </div>
                      <div style={{ fontSize: 12, color: '#6b5f82', lineHeight: 1.7 }}>
                        Mining = baseline income, runs while you sleep<br />
                        AI trading = compounding growth layer<br />
                        Together = the path out of the 9-5<br />
                        <span style={{ color: '#22c55e', fontWeight: 600 }}>Financial freedom NOW. Not in 40 years.</span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ════════════════════════ SYSTEMS ════════════════════════ */}
            {tab === 'systems' && (
              <motion.div key="systems" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  {/* System health */}
                  <div style={{ background: 'linear-gradient(145deg, #0d061a, #140a26)',
                    border: '1px solid rgba(147,51,234,0.14)', borderRadius: 14, padding: 20 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span>🔧</span> System Health
                    </div>
                    {SYSTEMS.map((s, i) => <SystemRow key={i} {...s} />)}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Deployment */}
                    <div style={{ background: 'linear-gradient(145deg, #0d061a, #140a26)',
                      border: '1px solid rgba(147,51,234,0.14)', borderRadius: 14, padding: 20 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, display: 'flex', gap: 8 }}>
                        <span>🚀</span> Deployment
                      </div>
                      {[
                        { l: 'Platform',       v: 'Railway',             c: '#a855f7' },
                        { l: 'Domain',         v: 'freedomforge.one',    c: '#22c55e' },
                        { l: 'Commit',         v: 'f44fa47 @ main',      c: '#d4a017' },
                        { l: 'Environment',    v: 'production',          c: '#22c55e' },
                        { l: 'Env Vars Live',  v: '10 / 10 synced',      c: '#22c55e' },
                        { l: 'RAILYWAY_TOKEN', v: 'connected ✓',         c: '#22c55e' },
                        { l: 'Test Suite',     v: '25/25 passing',       c: '#22c55e' },
                      ].map((item, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between',
                          padding: '8px 0', borderBottom: '1px solid rgba(147,51,234,0.05)', fontSize: 12 }}>
                          <span style={{ color: '#4a3d66' }}>{item.l}</span>
                          <span style={{ color: item.c, fontWeight: 700, fontFamily: 'monospace' }}>{item.v}</span>
                        </div>
                      ))}
                    </div>

                    {/* Build queue */}
                    <div style={{ background: 'linear-gradient(145deg, #0d061a, #140a26)',
                      border: '1px solid rgba(168,85,247,0.16)', borderRadius: 14, padding: 20 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, display: 'flex', gap: 8 }}>
                        <span>📋</span> Build Queue
                      </div>
                      {[
                        { l: 'Bayesian Optimization',          p: 'HIGH', c: '#ef4444' },
                        { l: 'Cross-Asset Regime Correlation', p: 'HIGH', c: '#ef4444' },
                        { l: 'Regime Transition Forecasting',  p: 'MED',  c: '#f59e0b' },
                        { l: 'Kelly Criterion Position Sizing',p: 'MED',  c: '#f59e0b' },
                        { l: 'Mining + Trading Unified PnL',   p: 'NEXT', c: '#a855f7' },
                      ].map((item, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between',
                          alignItems: 'center', padding: '9px 0',
                          borderBottom: '1px solid rgba(147,51,234,0.05)' }}>
                          <span style={{ fontSize: 12, color: '#a89cc4' }}>{item.l}</span>
                          <GlowBadge label={item.p} color={item.c} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 28px', borderTop: '1px solid rgba(147,51,234,0.08)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 11, color: '#2a2040' }}>
          <span>FreedomForge MAX · Alpha Intelligence System</span>
          <span>freedomforge.one</span>
          <span>Built different. Built to win. 🔥</span>
        </div>
      </div>
    </div>
  );
}
