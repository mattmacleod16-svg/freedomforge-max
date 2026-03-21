'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface CongressTrade {
  politician: string;
  party: string;
  chamber: string;
  ticker: string;
  company: string;
  type: string;
  amount: string;
  date: string;
  reportedDate: string;
  daysToReport: number;
}

interface MarketSignal {
  type: string;
  severity: string;
  title: string;
  description: string;
  timestamp: number;
  relatedTickers?: string[];
}

interface WatchdogData {
  congressTrades: CongressTrade[];
  signals: MarketSignal[];
  summary: string;
  lastUpdated: number;
}

export default function WatchdogPage() {
  const [data, setData] = useState<WatchdogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'signals' | 'congress' | 'services'>('signals');

  useEffect(() => {
    fetch('/api/watchdog')
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const tabs = [
    { id: 'signals' as const, label: 'Intelligence Signals', icon: '🚨' },
    { id: 'congress' as const, label: 'Congress Trades', icon: '🏛️' },
    { id: 'services' as const, label: 'Life Services', icon: '✈️' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#0a051e] to-[#030108] p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-red-400/80">Always Watching Your Back</p>
            <h1 className="mt-1 text-3xl md:text-5xl font-black bg-gradient-to-r from-red-300 via-amber-300 to-emerald-300 bg-clip-text text-transparent">
              Watchdog Intelligence
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Congressional trades, whale movements, and market signals — so you never miss what matters.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <Link href="/" className="rounded-full border border-zinc-700 px-3 py-1 text-zinc-400 hover:text-white transition">&larr; Home</Link>
            <Link href="/life" className="rounded-full border border-emerald-500/30 px-3 py-1 text-emerald-300 hover:bg-emerald-500/10 transition">Life</Link>
            <Link href="/vault" className="rounded-full border border-pink-500/30 px-3 py-1 text-pink-300 hover:bg-pink-500/10 transition">Vault</Link>
          </div>
        </header>

        {/* Summary */}
        {data && (
          <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-950/20 to-red-950/20 p-5">
            <p className="text-sm text-zinc-300 leading-relaxed">{data.summary}</p>
            <p className="mt-2 text-[10px] text-zinc-600">
              Last updated: {new Date(data.lastUpdated).toLocaleString()}
            </p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                tab === t.id ? 'bg-red-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="text-center py-20">
            <p className="text-2xl animate-pulse">🔍</p>
            <p className="text-sm text-zinc-500 mt-2">Scanning intelligence feeds...</p>
          </div>
        )}

        {/* Signals Tab */}
        {tab === 'signals' && data && (
          <div className="space-y-3">
            {data.signals.length === 0 && (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-6 text-center">
                <p className="text-2xl mb-2">✅</p>
                <p className="text-white font-bold">All Clear</p>
                <p className="text-xs text-zinc-500 mt-1">No unusual signals detected. Markets are behaving normally.</p>
              </div>
            )}
            {data.signals.map((signal, i) => (
              <div
                key={i}
                className={`rounded-2xl border p-5 ${
                  signal.severity === 'alert' ? 'border-red-500/30 bg-red-950/10' :
                  signal.severity === 'warning' ? 'border-amber-500/30 bg-amber-950/10' :
                  'border-blue-500/20 bg-blue-950/10'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl mt-0.5">
                    {signal.severity === 'alert' ? '🚨' : signal.severity === 'warning' ? '⚠️' : 'ℹ️'}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-white">{signal.title}</p>
                    <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{signal.description}</p>
                    {signal.relatedTickers && signal.relatedTickers.length > 0 && (
                      <div className="flex gap-1 mt-2">
                        {signal.relatedTickers.map((t) => (
                          <span key={t} className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-mono text-amber-400">${t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                    signal.severity === 'alert' ? 'bg-red-500/20 text-red-400' :
                    signal.severity === 'warning' ? 'bg-amber-500/20 text-amber-400' :
                    'bg-blue-500/20 text-blue-400'
                  }`}>
                    {signal.severity}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Congress Trades Tab */}
        {tab === 'congress' && data && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white">Recent Congressional Stock Trades</h3>
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">
                  STOCK Act Public Disclosures
                </span>
              </div>
              <p className="text-xs text-zinc-500 mb-4">
                Under the STOCK Act, all members of Congress must disclose stock trades within 45 days.
                FreedomForge monitors these filings so you see what insiders are buying before the crowd.
              </p>
              <div className="space-y-2">
                {data.congressTrades.map((trade, i) => (
                  <div
                    key={i}
                    className={`rounded-xl border px-4 py-3 ${
                      trade.type === 'Purchase'
                        ? 'border-emerald-500/20 bg-emerald-950/5'
                        : 'border-red-500/20 bg-red-950/5'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold ${
                          trade.party === 'D' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {trade.party}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-white">{trade.politician}</p>
                          <p className="text-[10px] text-zinc-600">{trade.chamber}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-mono font-bold text-white">${trade.ticker}</p>
                        <p className="text-[10px] text-zinc-500">{trade.company}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-800/50">
                      <div className="flex items-center gap-3 text-[10px]">
                        <span className={trade.type === 'Purchase' ? 'text-emerald-400' : 'text-red-400'}>
                          {trade.type === 'Purchase' ? '▲ BUY' : '▼ SELL'}
                        </span>
                        <span className="text-zinc-500">{trade.amount}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                        <span>Traded: {trade.date}</span>
                        <span>&bull;</span>
                        <span>Reported: {trade.daysToReport}d later</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Life Services Tab */}
        {tab === 'services' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-950/10 p-6">
              <p className="text-xs uppercase tracking-widest text-cyan-400/60 mb-2">Coming Soon</p>
              <p className="text-lg font-bold text-white mb-2">AI Life Services</p>
              <p className="text-sm text-zinc-400 leading-relaxed">
                FreedomForge is becoming the everything app. These services are being built so your AI
                handles the mundane while you enjoy the present moment.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  icon: '✈️', name: 'Travel Intelligence',
                  desc: 'AI-powered travel planning. Find flights, hotels, and experiences optimized for your preferences and budget. Your AI travel agent.',
                  status: 'Coming Soon',
                },
                {
                  icon: '🏛️', name: 'Politician Tracker',
                  desc: 'Track every congressional stock trade in real-time. Know what insiders are buying before the crowd. STOCK Act transparency.',
                  status: 'Live',
                },
                {
                  icon: '🩺', name: 'Health Intelligence',
                  desc: 'AI diagnostic imaging analysis, health trend tracking, and preventive care recommendations powered by medical AI models.',
                  status: 'Coming Soon',
                },
                {
                  icon: '📋', name: 'Tax Optimization',
                  desc: 'Automated tax-loss harvesting alerts, crypto tax calculations, and deduction optimization. Your AI accountant.',
                  status: 'Coming Soon',
                },
                {
                  icon: '🏠', name: 'Real Estate Scout',
                  desc: 'AI monitors property listings, analyzes deals, and alerts you to opportunities matching your investment criteria.',
                  status: 'Coming Soon',
                },
                {
                  icon: '⚖️', name: 'Legal Document Analysis',
                  desc: 'Upload contracts, leases, or legal documents. AI highlights red flags, unfair terms, and suggests improvements.',
                  status: 'Coming Soon',
                },
              ].map((svc) => (
                <div key={svc.name} className="rounded-xl border border-zinc-800 bg-black/20 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xl">{svc.icon}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                      svc.status === 'Live' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
                    }`}>
                      {svc.status}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-white">{svc.name}</p>
                  <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{svc.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <footer className="border-t border-zinc-900 pt-6 pb-4 text-center">
          <p className="text-xs text-zinc-600">
            FreedomForge Watchdog &mdash; Your eyes on the market while you live your life. 👁️
          </p>
        </footer>
      </div>
    </div>
  );
}
