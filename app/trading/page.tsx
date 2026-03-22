'use client';

import React, { useState, useEffect, useCallback } from 'react';

type TradingMode = 'paper' | 'live';
type Exchange = 'coinbase' | 'kraken';
type OrderSide = 'buy' | 'sell';

interface TradeRecord {
  id: string; exchange: string; symbol: string; side: string;
  type: string; amount: number; price: number; status: string;
  timestamp: number; mode: string; reason?: string;
}

interface ExchangeInfo { configured: boolean; name: string; }

interface MiningInfo {
  hashrate: number; hashrateUnit: string; workers: number;
  earnings24h: number; earningsTotal: number; currency: string;
}

interface PortfolioBalance {
  exchange: string; currency: string; available: number; usdValue: number;
}

interface TradingStatus {
  mode: TradingMode;
  exchanges: Record<string, ExchangeInfo>;
  riskLimits: {
    maxPositionUSD: number; maxDailyLossUSD: number;
    maxOrderSizeUSD: number; maxOpenOrders: number;
    allowedSymbols: string[];
  };
  portfolio: { balances: PortfolioBalance[]; totalUSD: number; mining: MiningInfo | null; };
  recentTrades: TradeRecord[];
  dailyPnL: number;
  killSwitch: boolean;
}

const SYMBOLS = ['BTC-USD','ETH-USD','SOL-USD','DOGE-USD','XRP-USD','ADA-USD','AVAX-USD','LINK-USD','DOT-USD','MATIC-USD','SHIB-USD','UNI-USD','AAVE-USD','ARB-USD','OP-USD'];

export default function TradingPage() {
  const [status, setStatus] = useState<TradingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'trade' | 'portfolio' | 'mining' | 'history' | 'risk'>('trade');
  const [exchange, setExchange] = useState<Exchange>('coinbase');
  const [symbol, setSymbol] = useState('BTC-USD');
  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');
  const [executing, setExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<TradeRecord | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/trading', { credentials: 'include' });
      if (res.ok) setStatus(await res.json());
    } catch { /* GuardDog handles */ }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh(); const id = setInterval(refresh, 15000); return () => clearInterval(id); }, [refresh]);

  const executeTrade = async () => {
    if (!amount || executing) return;
    setExecuting(true);
    try {
      const res = await fetch('/api/trading/execute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ exchange, symbol, side, type: orderType, amount: parseFloat(amount), price: orderType === 'limit' ? parseFloat(price) : undefined }),
      });
      if (res.ok) { const data = await res.json(); setLastResult(data.trade); setAmount(''); setPrice(''); await refresh(); }
    } catch { /* silent */ }
    setExecuting(false);
  };

  const toggleKillSwitch = async () => {
    try {
      await fetch('/api/trading', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ action: 'killswitch', active: !status?.killSwitch }) });
      await refresh();
    } catch { /* silent */ }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#050115] to-[#030108] flex items-center justify-center">
        <div className="text-center"><div className="text-5xl mb-4 animate-pulse">📈</div><p className="text-zinc-400 animate-pulse">Connecting to exchanges…</p></div>
      </div>
    );
  }

  const mode = status?.mode || 'paper';
  const isPaper = mode === 'paper';
  const exchanges = status?.exchanges || {};
  const portfolio = status?.portfolio || { balances: [], totalUSD: 0, mining: null };
  const trades = status?.recentTrades || [];
  const limits = status?.riskLimits;
  const mining = portfolio.mining;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#050115] to-[#0a0118] p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* ── Header ─────────────────────────────────── */}
        <header className="rounded-3xl border border-zinc-800/50 bg-zinc-900/40 backdrop-blur-xl p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl md:text-4xl font-black tracking-tight bg-gradient-to-r from-emerald-400 via-cyan-400 to-purple-400 bg-clip-text text-transparent">Trading Command Center</h1>
                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${isPaper ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}`}>{mode}</span>
              </div>
              <p className="text-zinc-400 text-sm">Multi-exchange autonomous trading · Coinbase + Kraken + ViaBTC Mining</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={toggleKillSwitch} className={`px-4 py-2 rounded-xl text-sm font-bold transition ${status?.killSwitch ? 'bg-red-600 text-white animate-pulse' : 'bg-zinc-800 text-zinc-400 hover:bg-red-900/50 hover:text-red-400'}`}>
                {status?.killSwitch ? '🚨 KILL SWITCH ON' : '🛑 Kill Switch'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-6">
            {Object.entries(exchanges).map(([key, ex]) => (
              <div key={key} className={`rounded-xl border p-3 text-center ${ex.configured ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-700/50 bg-zinc-800/20'}`}>
                <div className="text-lg mb-1">{key === 'coinbase' ? '🟠' : key === 'kraken' ? '🐙' : '⛏️'}</div>
                <div className="text-xs font-bold text-white">{ex.name}</div>
                <div className={`text-[10px] mt-1 ${ex.configured ? 'text-emerald-400' : 'text-zinc-600'}`}>{ex.configured ? '● Connected' : '○ Not configured'}</div>
              </div>
            ))}
          </div>
        </header>

        {/* ── Tabs ────────────────────────────────────── */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          {(['trade', 'portfolio', 'mining', 'history', 'risk'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${tab === t ? 'bg-purple-600/30 text-purple-300 border border-purple-500/30' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'}`}>
              {t === 'trade' ? '⚡ Trade' : t === 'portfolio' ? '💰 Portfolio' : t === 'mining' ? '⛏️ Mining' : t === 'history' ? '📜 History' : '🛡️ Risk'}
            </button>
          ))}
        </div>

        {/* ── Trade Panel ─────────────────────────────── */}
        {tab === 'trade' && (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/50 backdrop-blur p-6 space-y-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2"><span>⚡</span> Quick Trade {isPaper && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">PAPER</span>}</h2>
              <div className="grid grid-cols-2 gap-2">
                {(['coinbase', 'kraken'] as const).map(ex => (
                  <button key={ex} onClick={() => setExchange(ex)} className={`p-2 rounded-lg text-xs font-bold transition ${exchange === ex ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40' : 'bg-zinc-800/50 text-zinc-500 hover:text-white'}`}>
                    {ex === 'coinbase' ? '🟠 Coinbase' : '🐙 Kraken'}
                  </button>
                ))}
              </div>
              <select value={symbol} onChange={e => setSymbol(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
                {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setSide('buy')} className={`py-2 rounded-lg font-bold text-sm transition ${side === 'buy' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-emerald-400'}`}>BUY</button>
                <button onClick={() => setSide('sell')} className={`py-2 rounded-lg font-bold text-sm transition ${side === 'sell' ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-red-400'}`}>SELL</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setOrderType('market')} className={`py-1.5 rounded-lg text-xs font-semibold transition ${orderType === 'market' ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/40' : 'bg-zinc-800 text-zinc-500'}`}>Market</button>
                <button onClick={() => setOrderType('limit')} className={`py-1.5 rounded-lg text-xs font-semibold transition ${orderType === 'limit' ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/40' : 'bg-zinc-800 text-zinc-500'}`}>Limit</button>
              </div>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder={side === 'buy' ? 'Amount (USD)' : 'Amount (base asset)'} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-600" />
              {orderType === 'limit' && <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="Limit price (USD)" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-600" />}
              <button onClick={executeTrade} disabled={executing || !amount || status?.killSwitch} className={`w-full py-3 rounded-xl font-bold text-sm transition ${status?.killSwitch ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed' : side === 'buy' ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:opacity-90' : 'bg-gradient-to-r from-red-600 to-red-500 text-white hover:opacity-90'}`}>
                {executing ? '⏳ Executing…' : status?.killSwitch ? '🚫 Trading Halted' : `${side.toUpperCase()} ${symbol.split('-')[0]}`}
              </button>
            </div>

            <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/50 backdrop-blur p-6 space-y-4">
              <h2 className="text-lg font-bold text-white">📊 Trade Status</h2>
              {lastResult ? (
                <div className={`rounded-xl p-4 ${lastResult.status === 'rejected' ? 'bg-red-900/20 border border-red-500/20' : lastResult.status === 'paper' ? 'bg-amber-900/20 border border-amber-500/20' : 'bg-emerald-900/20 border border-emerald-500/20'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase text-zinc-400">{lastResult.exchange}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${lastResult.status === 'rejected' ? 'bg-red-500/20 text-red-400' : lastResult.status === 'paper' ? 'bg-amber-500/20 text-amber-400' : lastResult.status === 'pending' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{lastResult.status}</span>
                  </div>
                  <div className="text-white font-bold">{lastResult.side.toUpperCase()} {lastResult.symbol}</div>
                  <div className="text-xs text-zinc-400 mt-1">Amount: {lastResult.amount} · Type: {lastResult.type}</div>
                  {lastResult.reason && <div className="text-xs text-red-400 mt-2">⚠ {lastResult.reason}</div>}
                  <div className="text-[10px] text-zinc-600 mt-2">ID: {lastResult.id}</div>
                </div>
              ) : (
                <div className="text-center py-12 text-zinc-600">
                  <div className="text-4xl mb-3">📈</div>
                  <p className="text-sm">No trades executed yet</p>
                  <p className="text-xs mt-1">Place your first {isPaper ? 'paper ' : ''}trade to see results</p>
                </div>
              )}
              <div className="rounded-xl border border-zinc-700/30 bg-zinc-800/30 p-4">
                <div className="text-xs text-zinc-500 mb-1">Daily P&L</div>
                <div className={`text-2xl font-black ${(status?.dailyPnL || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {(status?.dailyPnL || 0) >= 0 ? '+' : ''}${(status?.dailyPnL || 0).toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Portfolio ───────────────────────────────── */}
        {tab === 'portfolio' && (
          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/50 backdrop-blur p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">💰 Aggregated Portfolio</h2>
              <div className="text-2xl font-black text-emerald-400">${portfolio.totalUSD.toFixed(2)}</div>
            </div>
            {portfolio.balances.length > 0 ? (
              <div className="space-y-2">
                {portfolio.balances.map((b, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-3">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{b.exchange === 'coinbase' ? '🟠' : '🐙'}</span>
                      <div><div className="text-white font-bold text-sm">{b.currency}</div><div className="text-[10px] text-zinc-500">{b.exchange}</div></div>
                    </div>
                    <div className="text-right">
                      <div className="text-white font-mono text-sm">{b.available.toFixed(6)}</div>
                      <div className="text-[10px] text-zinc-500">${b.usdValue.toFixed(2)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-600">
                <p className="text-sm">Configure exchange API keys to view balances</p>
                <p className="text-xs mt-2 text-zinc-700">Set COINBASE_API_KEY / KRAKEN_API_KEY in Railway environment variables</p>
              </div>
            )}
          </div>
        )}

        {/* ── Mining ──────────────────────────────────── */}
        {tab === 'mining' && (
          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/50 backdrop-blur p-6 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2"><span>⛏️</span> ViaBTC Mining Operations</h2>
            {mining ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-center">
                  <div className="text-xs text-zinc-500 mb-1">Hashrate</div>
                  <div className="text-2xl font-black text-cyan-400">{mining.hashrate.toFixed(2)}</div>
                  <div className="text-xs text-zinc-600">{mining.hashrateUnit}</div>
                </div>
                <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4 text-center">
                  <div className="text-xs text-zinc-500 mb-1">Workers</div>
                  <div className="text-2xl font-black text-purple-400">{mining.workers}</div>
                  <div className="text-xs text-zinc-600">active</div>
                </div>
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
                  <div className="text-xs text-zinc-500 mb-1">24h Earnings</div>
                  <div className="text-2xl font-black text-emerald-400">{mining.earnings24h.toFixed(8)}</div>
                  <div className="text-xs text-zinc-600">{mining.currency}</div>
                </div>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-center col-span-2 md:col-span-3">
                  <div className="text-xs text-zinc-500 mb-1">Total Earnings (All Time)</div>
                  <div className="text-2xl font-black text-amber-400">{mining.earningsTotal.toFixed(8)} {mining.currency}</div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-600">
                <div className="text-4xl mb-3">⛏️</div>
                <p className="text-sm">Configure ViaBTC API keys to view mining stats</p>
                <p className="text-xs mt-2 text-zinc-700">Set VIABTC_API_KEY and VIABTC_API_SECRET in Railway environment</p>
              </div>
            )}
          </div>
        )}

        {/* ── History ─────────────────────────────────── */}
        {tab === 'history' && (
          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/50 backdrop-blur p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">📜 Trade Audit Log</h2>
            {trades.length > 0 ? (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {trades.map((t, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-3">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${t.side === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{t.side.toUpperCase()}</span>
                      <div><div className="text-white text-sm font-bold">{t.symbol}</div><div className="text-[10px] text-zinc-500">{t.exchange} · {new Date(t.timestamp).toLocaleString()}</div></div>
                    </div>
                    <div className="text-right">
                      <div className="text-white text-sm font-mono">{t.amount}</div>
                      <span className={`text-[10px] font-bold ${t.status === 'filled' || t.status === 'paper' ? 'text-emerald-400' : t.status === 'rejected' ? 'text-red-400' : 'text-blue-400'}`}>{t.status}{t.reason ? ` — ${t.reason}` : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-600"><p className="text-sm">No trades yet — execute your first trade to begin</p></div>
            )}
          </div>
        )}

        {/* ── Risk Controls ───────────────────────────── */}
        {tab === 'risk' && limits && (
          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/50 backdrop-blur p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">🛡️ Risk Management Framework</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-4"><div className="text-xs text-zinc-500">Max Order Size</div><div className="text-xl font-bold text-white">${limits.maxOrderSizeUSD}</div></div>
              <div className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-4"><div className="text-xs text-zinc-500">Max Daily Loss</div><div className="text-xl font-bold text-red-400">${limits.maxDailyLossUSD}</div></div>
              <div className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-4"><div className="text-xs text-zinc-500">Max Position</div><div className="text-xl font-bold text-white">${limits.maxPositionUSD}</div></div>
              <div className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-4"><div className="text-xs text-zinc-500">Max Open Orders</div><div className="text-xl font-bold text-white">{limits.maxOpenOrders}</div></div>
            </div>
            <div className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-4">
              <div className="text-xs text-zinc-500 mb-2">Allowed Symbols</div>
              <div className="flex flex-wrap gap-1">{limits.allowedSymbols.map(s => <span key={s} className="px-2 py-0.5 rounded bg-zinc-700/50 text-xs text-zinc-300">{s}</span>)}</div>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <h3 className="text-sm font-bold text-amber-400 mb-2">⚙️ Environment Configuration</h3>
              <p className="text-xs text-zinc-400">Set these on Railway to customize risk limits and connect exchanges:</p>
              <div className="mt-2 grid md:grid-cols-2 gap-x-6 gap-y-1 text-[10px] font-mono text-zinc-500">
                <div>TRADING_MODE=paper|live</div>
                <div>MAX_POSITION_USD=1000</div>
                <div>MAX_DAILY_LOSS_USD=200</div>
                <div>MAX_ORDER_SIZE_USD=500</div>
                <div>COINBASE_API_KEY=...</div>
                <div>COINBASE_API_SECRET=...</div>
                <div>KRAKEN_API_KEY=...</div>
                <div>KRAKEN_API_SECRET=...</div>
                <div>VIABTC_API_KEY=...</div>
                <div>VIABTC_API_SECRET=...</div>
              </div>
            </div>
          </div>
        )}

        <footer className="text-center text-xs text-zinc-600 py-4">
          <p>FreedomForge Trading Engine · {isPaper ? 'Paper Mode (no real funds at risk)' : 'Live Mode — real trades'} · All operations logged</p>
        </footer>
      </div>
    </div>
  );
}
