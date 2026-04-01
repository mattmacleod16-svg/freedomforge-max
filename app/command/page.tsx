'use client';

import { useState, useEffect, useCallback } from 'react';

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface IncomeStatus {
  target?: { daily: number; monthly: number; annual: number; label: string };
  capital?: number;
  estimated?: { daily: number; monthly: number };
  onTrack?: boolean;
  aggressionTier?: string;
  streams?: Record<string, { active: boolean; label: string; estimatedUSD?: number; confidence?: number }>;
  progress?: { today: number; week: number; month: number; allTime: number };
  history?: Array<{ date: string; realized: number; target: number; achieved: boolean | null }>;
}

interface PriceData { BTC: number; ETH: number; SOL: number; XRP: number }

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const fmt  = (n: number, d = 0) => n?.toLocaleString('en-US', { maximumFractionDigits: d }) ?? '—';
const fmtD = (n: number) => `$${fmt(n, 2)}`;
const fmtK = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : fmtD(n);

const TIER_COLORS: Record<string, string> = {
  conservative: 'text-blue-400',
  normal:       'text-green-400',
  growth:       'text-amber-400',
  max:          'text-red-400',
};
const TIER_EMOJI: Record<string, string> = {
  conservative: '🛡️', normal: '⚡', growth: '🚀', max: '🔥',
};

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function CommandPage() {
  const [income,    setIncome]    = useState<IncomeStatus>({});
  const [prices,    setPrices]    = useState<PriceData | null>(null);
  const [inputAmt,  setInputAmt]  = useState('');
  const [inputPer,  setInputPer]  = useState<'daily' | 'monthly'>('monthly');
  const [setting,   setSetting]   = useState(false);
  const [lastTick,  setLastTick]  = useState('');
  const [pulse,     setPulse]     = useState(false);

  // ── Fetch income status ──────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/status/target');
      if (r.ok) { const d = await r.json(); setIncome(d); }
    } catch {}
  }, []);

  // ── Fetch prices ──────────────────────────────────────────────────────────
  const fetchPrices = useCallback(async () => {
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,ripple&vs_currencies=usd');
      if (r.ok) {
        const d = await r.json();
        setPrices({ BTC: d.bitcoin?.usd, ETH: d.ethereum?.usd, SOL: d.solana?.usd, XRP: d.ripple?.usd });
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchStatus(); fetchPrices();
    const si = setInterval(fetchStatus, 30_000);
    const pi = setInterval(fetchPrices, 15_000);
    const ti = setInterval(() => {
      const now = new Date();
      setLastTick(now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setPulse(p => !p);
    }, 1000);
    return () => { clearInterval(si); clearInterval(pi); clearInterval(ti); };
  }, [fetchStatus, fetchPrices]);

  // ── Set target ────────────────────────────────────────────────────────────
  const setTarget = async () => {
    const raw = parseFloat(inputAmt.replace(/[$,]/g, ''));
    if (isNaN(raw) || raw <= 0) return;
    setSetting(true);
    try {
      await fetch('/api/status/target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputPer === 'monthly' ? { monthly: raw } : { daily: raw }),
      });
      setInputAmt('');
      await fetchStatus();
    } catch {}
    setSetting(false);
  };

  const daily   = income.target?.daily   ?? 0;
  const monthly = income.target?.monthly ?? 0;
  const todayP  = income.progress?.today ?? 0;
  const pct     = daily > 0 ? Math.min(100, (todayP / daily) * 100) : 0;
  const tier    = income.aggressionTier ?? 'normal';
  const cap     = income.capital ?? 455;

  return (
    <div className="min-h-screen bg-[#07080f] text-white font-mono" style={{ fontFamily: 'monospace' }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="border-b border-[#1a1a2e] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${pulse ? 'bg-amber-400' : 'bg-amber-500'} shadow-lg shadow-amber-500/50`} />
          <span className="text-amber-400 font-bold text-lg tracking-wider">FREEDOMFORGE</span>
          <span className="text-slate-500 text-xs">COMMAND CENTER</span>
        </div>
        <div className="text-slate-500 text-xs">{lastTick} ET</div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* ═══ STEP 1 — SET YOUR TARGET ══════════════════════════════════════ */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-amber-400 text-2xl font-black">1</span>
            <span className="text-amber-300 font-bold text-lg">Set your target</span>
          </div>
          <p className="text-slate-400 text-sm mb-5">Tell FreedomForge how much you want to make. It figures out the rest.</p>

          <div className="flex gap-3 flex-wrap">
            <div className="flex rounded-lg overflow-hidden border border-slate-700">
              <span className="bg-slate-800 px-3 py-2 text-slate-400 text-sm flex items-center">$</span>
              <input
                type="text"
                value={inputAmt}
                onChange={e => setInputAmt(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && setTarget()}
                placeholder="50000"
                className="bg-slate-900 px-3 py-2 text-white text-sm outline-none w-32"
              />
            </div>
            <select
              value={inputPer}
              onChange={e => setInputPer(e.target.value as 'daily' | 'monthly')}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none"
            >
              <option value="monthly">/ month</option>
              <option value="daily">/ day</option>
            </select>
            <button
              onClick={setTarget}
              disabled={setting}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold px-5 py-2 rounded-lg text-sm transition-colors"
            >
              {setting ? 'Setting…' : 'Set Target →'}
            </button>
          </div>

          {/* Quick presets */}
          <div className="flex gap-2 mt-3 flex-wrap">
            {[['$1k/mo', 1000], ['$5k/mo', 5000], ['$10k/mo', 10000], ['$50k/mo', 50000], ['$100k/mo', 100000]].map(([label, val]) => (
              <button
                key={String(val)}
                onClick={() => { setInputAmt(String(val)); setInputPer('monthly'); }}
                className="text-xs text-slate-400 hover:text-amber-400 border border-slate-700 hover:border-amber-500/50 rounded px-2 py-1 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ═══ STEP 2 — WATCH IT WORK ════════════════════════════════════════ */}
        <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-purple-400 text-2xl font-black">2</span>
            <span className="text-purple-300 font-bold text-lg">Watch it work</span>
          </div>

          {/* Current target display */}
          {income.target ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              {[
                { label: 'Daily Target',     val: fmtK(daily),          sub: 'per day'  },
                { label: 'Monthly Target',   val: fmtK(monthly),        sub: 'per month'},
                { label: 'Today So Far',     val: fmtK(todayP),         sub: `${pct.toFixed(0)}% of target` },
                { label: 'Capital Base',     val: fmtK(cap),            sub: 'compounding' },
              ].map(({ label, val, sub }) => (
                <div key={label} className="bg-slate-900/60 rounded-lg p-3 border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</div>
                  <div className="text-white font-bold text-xl">{val}</div>
                  <div className="text-[10px] text-slate-500 mt-1">{sub}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-500 text-sm mb-5 italic">No target set yet — complete Step 1 above ↑</div>
          )}

          {/* Daily progress bar */}
          {income.target && (
            <div className="mb-5">
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>Today&apos;s progress</span>
                <span>{fmtD(todayP)} / {fmtD(daily)}</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    background: pct >= 100 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#6366f1',
                  }}
                />
              </div>
            </div>
          )}

          {/* Aggression tier */}
          <div className="flex items-center gap-3 mb-5 p-3 bg-slate-900/60 rounded-lg border border-slate-800">
            <span className="text-xl">{TIER_EMOJI[tier] ?? '⚡'}</span>
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Mode</div>
              <div className={`font-bold capitalize ${TIER_COLORS[tier] ?? 'text-white'}`}>{tier}</div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-xs text-slate-500">Est. daily</div>
              <div className="font-bold text-green-400">{income.estimated ? fmtK(income.estimated.daily) : '—'}</div>
            </div>
          </div>

          {/* Revenue streams */}
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Revenue Streams</div>
            <div className="space-y-2">
              {income.streams && Object.entries(income.streams).map(([key, s]) => (
                <div key={key} className={`flex items-center justify-between p-2 rounded-lg border ${s.active ? 'border-slate-700 bg-slate-900/40' : 'border-slate-800/50 opacity-40'}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${s.active ? 'bg-green-400' : 'bg-slate-600'}`} />
                    <span className="text-sm text-slate-300">{s.label ?? key}</span>
                  </div>
                  <div className="text-right">
                    {s.active && s.estimatedUSD != null && (
                      <span className="text-xs text-green-400">~{fmtD(s.estimatedUSD)}/day</span>
                    )}
                    {s.active && s.confidence != null && (
                      <span className="text-xs text-slate-500 ml-2">{(s.confidence * 100).toFixed(0)}% conf</span>
                    )}
                    {!s.active && <span className="text-xs text-slate-600">inactive</span>}
                  </div>
                </div>
              ))}
              {/* Static streams that are always running */}
              {!income.streams && (
                <>
                  {[
                    { label: '⛏️ Mining Fleet (5 rigs)',       est: '~$8/day',    conf: '90%' },
                    { label: '📈 Spot Trading (CB + Kraken)',  est: 'regime-dep', conf: '55%' },
                    { label: '🎲 Prediction Markets',          est: 'confidence', conf: '55%' },
                    { label: '🏦 DeFi Yield',                  est: '~$0.5/day',  conf: '85%' },
                    { label: '📊 Futures / Perps',             est: 'trend-only', conf: '50%' },
                  ].map(({ label, est, conf }) => (
                    <div key={label} className="flex items-center justify-between p-2 rounded-lg border border-slate-700 bg-slate-900/40">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                        <span className="text-sm text-slate-300">{label}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-green-400">{est}</span>
                        <span className="text-xs text-slate-500 ml-2">{conf}</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>

        {/* ═══ STEP 3 — COLLECT ══════════════════════════════════════════════ */}
        <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-green-400 text-2xl font-black">3</span>
            <span className="text-green-300 font-bold text-lg">Collect</span>
          </div>
          <p className="text-slate-400 text-sm mb-5">Profits compound automatically. Withdraw to your wallet on Friday payouts.</p>

          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: 'This Week',  val: income.progress?.week  ?? 0 },
              { label: 'This Month', val: income.progress?.month ?? 0 },
              { label: 'All Time',   val: income.progress?.allTime ?? 0 },
            ].map(({ label, val }) => (
              <div key={label} className="bg-slate-900/60 rounded-lg p-3 border border-slate-800 text-center">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</div>
                <div className="text-green-400 font-bold text-lg">{fmtK(val)}</div>
              </div>
            ))}
          </div>

          {/* History */}
          {income.history && income.history.length > 0 && (
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Recent days</div>
              <div className="space-y-1">
                {[...income.history].reverse().slice(0, 5).map((d) => (
                  <div key={d.date} className="flex items-center justify-between text-xs p-2 rounded bg-slate-900/40">
                    <span className="text-slate-400">{d.date}</span>
                    <span className={`font-bold ${d.achieved ? 'text-green-400' : 'text-amber-400'}`}>{fmtD(d.realized)}</span>
                    <span className="text-slate-500">target {fmtD(d.target)}</span>
                    <span>{d.achieved ? '✅' : d.achieved === false ? '⚠️' : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── Live prices strip ────────────────────────────────────────────── */}
        {prices && (
          <div className="flex gap-4 justify-center flex-wrap pt-2">
            {Object.entries(prices).map(([sym, price]) => (
              <div key={sym} className="text-center">
                <div className="text-[10px] text-slate-500">{sym}</div>
                <div className="text-slate-300 text-sm font-bold">${fmt(price as number)}</div>
              </div>
            ))}
            <div className="text-center">
              <div className="text-[10px] text-slate-500">Dashboard</div>
              <a href="/dashboard" className="text-amber-400 text-sm hover:underline">→ Full</a>
            </div>
          </div>
        )}

        {/* ─── System status strip ─────────────────────────────────────────── */}
        <div className="flex gap-2 flex-wrap justify-center pb-4">
          {[
            '🟢 Coinbase LIVE',
            '🟢 Kraken LIVE',
            '🟢 Optimizer 2am ET',
            '🟢 Improver 6hr',
            '🟢 Monitor 15min',
            '🟢 5 Mining Rigs',
          ].map(s => (
            <span key={s} className="text-[10px] text-slate-500 bg-slate-900 border border-slate-800 rounded px-2 py-1">{s}</span>
          ))}
        </div>

      </div>
    </div>
  );
}
