'use client';

import React, { useState, useEffect } from 'react';

/* ── Types ─────────────────────────────────────────── */

interface FlowTech {
  id: string; name: string; principle: string; accuracy: string;
  movingParts: boolean; pressureDrop: string; turndown: string;
  costTier: string; bestFor: string; limitations: string;
  diagnostics: string[]; costRange4in: string; score?: number;
}

interface Regulation {
  id: string; name: string; domain: string; region: string; description: string;
}

interface CalMethod {
  name: string; accuracy: string; type: string; description: string;
}

interface IoTProtocol {
  name: string; speed: string; type: string; description: string;
}

interface TcoBreakdown {
  category: string; amount: number; pct: string;
}

interface TcoResult {
  totalCostOfOwnership: number; annualizedCost: number; lifeYears: number;
  breakdown: TcoBreakdown[];
}

type Tab = 'technologies' | 'selector' | 'tco' | 'iot' | 'regulations' | 'diagnostics';

/* ── Component ─────────────────────────────────────── */

export default function IndustrialPage() {
  const [tab, setTab] = useState<Tab>('technologies');
  const [techs, setTechs] = useState<FlowTech[]>([]);
  const [regs, setRegs] = useState<Regulation[]>([]);
  const [calMethods, setCalMethods] = useState<CalMethod[]>([]);
  const [protocols, setProtocols] = useState<IoTProtocol[]>([]);
  const [expandedTech, setExpandedTech] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Selector state
  const [sFluid, setSFluid] = useState('water');
  const [sPipe, setSPipe] = useState('medium');
  const [sAccuracy, setSAccuracy] = useState('moderate');
  const [sBudget, setSBudget] = useState('medium');
  const [sApp, setSApp] = useState('process-control');
  const [recommendations, setRecommendations] = useState<FlowTech[]>([]);
  const [recommending, setRecommending] = useState(false);

  // TCO state
  const [tPurchase, setTPurchase] = useState('10000');
  const [tInstall, setTInstall] = useState('5000');
  const [tMaint, setTMaint] = useState('1200');
  const [tCal, setTCal] = useState('800');
  const [tEnergy, setTEnergy] = useState('2000');
  const [tError, setTError] = useState('5000');
  const [tLife, setTLife] = useState('15');
  const [tcoResult, setTcoResult] = useState<TcoResult | null>(null);
  const [tcoLoading, setTcoLoading] = useState(false);

  // Regulation filter
  const [regFilter, setRegFilter] = useState('');

  useEffect(() => {
    fetch('/api/industrial')
      .then(r => r.json())
      .then(d => {
        setTechs(d.technologies || []);
        setRegs(d.regulations || []);
        setCalMethods(d.calibration || []);
        setProtocols(d.protocols || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const runRecommendation = async () => {
    setRecommending(true);
    try {
      const res = await fetch('/api/industrial', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recommend', fluidType: sFluid, pipeSize: sPipe, accuracy: sAccuracy, budget: sBudget, application: sApp }),
      });
      if (res.ok) { const d = await res.json(); setRecommendations(d.recommendations || []); }
    } catch { /* silent */ }
    setRecommending(false);
  };

  const runTco = async () => {
    setTcoLoading(true);
    try {
      const res = await fetch('/api/industrial', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'tco', purchasePrice: +tPurchase, installationCost: +tInstall, annualMaintenance: +tMaint, annualCalibration: +tCal, energyLossPerYear: +tEnergy, measurementErrorCostPerYear: +tError, lifeYears: +tLife }),
      });
      if (res.ok) { const d = await res.json(); setTcoResult(d.tco); }
    } catch { /* silent */ }
    setTcoLoading(false);
  };

  const filteredRegs = regs.filter(r => !regFilter || r.domain.toLowerCase().includes(regFilter.toLowerCase()) || r.region.toLowerCase().includes(regFilter.toLowerCase()) || r.name.toLowerCase().includes(regFilter.toLowerCase()));

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#050118] to-[#030108] flex items-center justify-center">
        <div className="text-center"><div className="text-5xl mb-4 animate-pulse">🏭</div><p className="text-zinc-400 animate-pulse">Loading Industrial Intelligence…</p></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#040112] to-[#080120] p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* ── Header ───────────────────────────── */}
        <header className="rounded-3xl border border-zinc-800/50 bg-zinc-900/40 backdrop-blur-xl p-6 md:p-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-4xl">🏭</span>
            <div>
              <h1 className="text-3xl md:text-4xl font-black tracking-tight bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">Industrial Intelligence Hub</h1>
              <p className="text-zinc-500 text-sm mt-1">Flow Metering · Equipment Selection · TCO Analysis · IoT/SCADA · Regulatory Compliance · Diagnostics</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-3 text-center">
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3"><div className="text-xl font-black text-cyan-400">{techs.length}</div><div className="text-[10px] text-zinc-500">Technologies</div></div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3"><div className="text-xl font-black text-amber-400">{regs.length}</div><div className="text-[10px] text-zinc-500">Standards</div></div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3"><div className="text-xl font-black text-emerald-400">{protocols.length}</div><div className="text-[10px] text-zinc-500">IoT Protocols</div></div>
            <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3"><div className="text-xl font-black text-purple-400">{calMethods.length}</div><div className="text-[10px] text-zinc-500">Calibration Methods</div></div>
          </div>
        </header>

        {/* ── Tabs ──────────────────────────────── */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          {([['technologies','⚙️ Technologies'],['selector','🎯 Selector'],['tco','💰 TCO Calculator'],['iot','📡 IoT/SCADA'],['regulations','📋 Regulations'],['diagnostics','🔬 Diagnostics']] as [Tab, string][]).map(([t,label]) => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${tab === t ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/30' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'}`}>{label}</button>
          ))}
        </div>

        {/* ── Technologies ────────────────────────── */}
        {tab === 'technologies' && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/40 p-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-zinc-500 border-b border-zinc-800">
                  <th className="text-left py-2 px-2">Technology</th>
                  <th className="text-left py-2 px-2">Accuracy</th>
                  <th className="text-center py-2 px-2">Moving Parts</th>
                  <th className="text-left py-2 px-2">ΔP</th>
                  <th className="text-left py-2 px-2">Turndown</th>
                  <th className="text-left py-2 px-2">Cost (4&quot;)</th>
                  <th className="text-left py-2 px-2">Best For</th>
                </tr></thead>
                <tbody>
                  {techs.map(t => (
                    <tr key={t.id} onClick={() => setExpandedTech(expandedTech === t.id ? null : t.id)} className="border-b border-zinc-800/30 hover:bg-zinc-800/30 cursor-pointer transition">
                      <td className="py-2 px-2 font-bold text-white">{t.name}</td>
                      <td className="py-2 px-2 text-emerald-400">{t.accuracy}</td>
                      <td className="py-2 px-2 text-center">{t.movingParts ? <span className="text-amber-400">Yes</span> : <span className="text-emerald-400">No</span>}</td>
                      <td className="py-2 px-2">{t.pressureDrop === 'None' ? <span className="text-emerald-400">{t.pressureDrop}</span> : <span className="text-amber-400">{t.pressureDrop}</span>}</td>
                      <td className="py-2 px-2 text-cyan-400">{t.turndown}</td>
                      <td className="py-2 px-2 text-zinc-400">{t.costRange4in}</td>
                      <td className="py-2 px-2 text-zinc-400 max-w-[200px] truncate">{t.bestFor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {expandedTech && (() => {
              const t = techs.find(x => x.id === expandedTech);
              if (!t) return null;
              return (
                <div className="rounded-2xl border border-cyan-500/20 bg-zinc-900/60 p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black text-white">{t.name}</h3>
                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold ${t.costTier === 'High' ? 'bg-red-500/20 text-red-400' : t.costTier === 'Low' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>{t.costTier} Cost</span>
                  </div>
                  <p className="text-sm text-zinc-300">{t.principle}</p>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-3"><div className="text-[10px] text-zinc-500 mb-1">Best Applications</div><div className="text-sm text-white">{t.bestFor}</div></div>
                    <div className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-3"><div className="text-[10px] text-zinc-500 mb-1">Limitations</div><div className="text-sm text-amber-300">{t.limitations}</div></div>
                  </div>
                  <div><div className="text-[10px] text-zinc-500 mb-2">Built-In Diagnostics</div><div className="flex flex-wrap gap-1">{t.diagnostics.map((d,i) => <span key={i} className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 text-[10px]">{d}</span>)}</div></div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Equipment Selector ──────────────────── */}
        {tab === 'selector' && (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/50 p-6 space-y-4">
              <h2 className="text-lg font-bold text-white">🎯 Equipment Selection Wizard</h2>
              <div><label className="text-xs text-zinc-500 block mb-1">Fluid Type</label>
                <select value={sFluid} onChange={e => setSFluid(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
                  {['water','oil','gas','steam','chemical','slurry','pharmaceutical'].map(f => <option key={f} value={f}>{f.charAt(0).toUpperCase()+f.slice(1)}</option>)}
                </select></div>
              <div><label className="text-xs text-zinc-500 block mb-1">Pipe Size</label>
                <select value={sPipe} onChange={e => setSPipe(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
                  {[['small','Small (<2")'],['medium','Medium (2–6")'],['large','Large (>6")']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
              <div><label className="text-xs text-zinc-500 block mb-1">Required Accuracy</label>
                <select value={sAccuracy} onChange={e => setSAccuracy(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
                  {[['high','High (±0.1–0.5%)'],['moderate','Moderate (±0.5–1%)'],['low','Standard (±1–2%)']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
              <div><label className="text-xs text-zinc-500 block mb-1">Budget</label>
                <select value={sBudget} onChange={e => setSBudget(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
                  {[['low','Low (<$5K)'],['medium','Medium ($5K–$15K)'],['high','High ($15K+)']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
              <div><label className="text-xs text-zinc-500 block mb-1">Application</label>
                <select value={sApp} onChange={e => setSApp(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm">
                  {[['process-control','Process Control'],['custody-transfer','Custody Transfer'],['hvac','HVAC'],['environmental','Environmental Monitoring'],['pharmaceutical','Pharmaceutical'],['food','Food & Beverage']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select></div>
              <button onClick={runRecommendation} disabled={recommending} className="w-full py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:opacity-90 transition">
                {recommending ? '⏳ Analyzing…' : '🎯 Get Recommendations'}
              </button>
            </div>
            <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/50 p-6 space-y-3">
              <h2 className="text-lg font-bold text-white">Recommended Technologies</h2>
              {recommendations.length > 0 ? recommendations.map((r, i) => (
                <div key={r.id} className={`rounded-xl border p-4 ${i === 0 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-700/30 bg-zinc-800/20'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-white">{i === 0 ? '🏆 ' : ''}{r.name}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 rounded-full bg-zinc-700 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500" style={{width:`${r.score}%`}} /></div>
                      <span className="text-xs font-bold text-cyan-400">{r.score}%</span>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-400">{r.bestFor}</p>
                  <div className="flex gap-3 mt-2 text-[10px] text-zinc-500">
                    <span>Accuracy: {r.accuracy}</span><span>ΔP: {r.pressureDrop}</span><span>{r.costRange4in}</span>
                  </div>
                </div>
              )) : (
                <div className="text-center py-12 text-zinc-600"><p className="text-sm">Configure parameters and run the selector</p></div>
              )}
            </div>
          </div>
        )}

        {/* ── TCO Calculator ──────────────────────── */}
        {tab === 'tco' && (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/50 p-6 space-y-3">
              <h2 className="text-lg font-bold text-white">💰 Total Cost of Ownership</h2>
              <p className="text-xs text-zinc-500">The real cost of a flow meter goes far beyond purchase price. Energy loss from pressure drop and measurement error costs often dominate.</p>
              {[['Purchase Price ($)', tPurchase, setTPurchase], ['Installation ($)', tInstall, setTInstall], ['Annual Maintenance ($)', tMaint, setTMaint], ['Annual Calibration ($)', tCal, setTCal], ['Annual Energy Loss ($)', tEnergy, setTEnergy], ['Annual Measurement Error Cost ($)', tError, setTError], ['Asset Life (years)', tLife, setTLife]].map(([label, val, set]) => (
                <div key={label as string}><label className="text-[10px] text-zinc-500">{label as string}</label>
                  <input type="number" value={val as string} onChange={e => (set as React.Dispatch<React.SetStateAction<string>>)(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-white text-sm" />
                </div>
              ))}
              <button onClick={runTco} disabled={tcoLoading} className="w-full py-2.5 rounded-xl font-bold text-sm bg-gradient-to-r from-amber-600 to-orange-600 text-white hover:opacity-90 transition">
                {tcoLoading ? '⏳ Calculating…' : '💰 Calculate TCO'}
              </button>
            </div>
            <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/50 p-6 space-y-4">
              {tcoResult ? (
                <>
                  <div className="text-center">
                    <div className="text-xs text-zinc-500">Total Cost of Ownership ({tcoResult.lifeYears} years)</div>
                    <div className="text-3xl font-black text-amber-400">${tcoResult.totalCostOfOwnership.toLocaleString()}</div>
                    <div className="text-sm text-zinc-500">${tcoResult.annualizedCost.toLocaleString()}/year</div>
                  </div>
                  <div className="space-y-2">
                    {tcoResult.breakdown.map(b => (
                      <div key={b.category} className="flex items-center gap-3">
                        <div className="w-20 text-[10px] text-zinc-500 text-right">{b.category}</div>
                        <div className="flex-1 h-5 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500" style={{width:`${b.pct}%`}} /></div>
                        <div className="w-20 text-xs text-white font-mono">${b.amount.toLocaleString()}</div>
                        <div className="w-10 text-[10px] text-zinc-500">{b.pct}%</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">
                    💡 Insight: {tcoResult.breakdown.sort((a,b) => b.amount - a.amount)[0]?.category} is the largest cost driver at {tcoResult.breakdown[0]?.pct}% of TCO. Consider technologies that reduce this component.
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-zinc-600"><p className="text-sm">Enter costs and calculate to see TCO breakdown</p></div>
              )}
            </div>
          </div>
        )}

        {/* ── IoT/SCADA ──────────────────────────── */}
        {tab === 'iot' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/50 p-6">
              <h2 className="text-lg font-bold text-white mb-4">📡 Industrial Communication Protocols</h2>
              <div className="grid md:grid-cols-2 gap-3">
                {protocols.map(p => (
                  <div key={p.name} className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-white text-sm">{p.name}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-500/10 text-cyan-400">{p.type}</span>
                    </div>
                    <p className="text-xs text-zinc-400">{p.description}</p>
                    <div className="text-[10px] text-zinc-600 mt-2">Speed: {p.speed}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/50 p-6">
              <h2 className="text-lg font-bold text-white mb-4">🏗️ Industry 4.0 Architecture</h2>
              <div className="grid md:grid-cols-3 gap-4">
                {[
                  { title: 'Edge Computing', icon: '⚡', desc: 'Local analytics — anomaly detection, data aggregation, alert generation before cloud transmission. Reduces latency to milliseconds.' },
                  { title: 'Digital Twins', icon: '🪞', desc: 'Virtual models running in parallel with physical meters. Compare real-time data against predictions to detect drift and schedule calibration.' },
                  { title: 'Predictive Maintenance', icon: '🔮', desc: 'ML pattern recognition in raw sensor data identifies failure modes earlier than threshold alarms. Calendar-based → condition-based.' },
                  { title: 'OPC-UA Integration', icon: '🔗', desc: 'Universal translator from field devices to enterprise systems. Secure, platform-independent, standardized data access.' },
                  { title: 'NAMUR NOA', icon: '📊', desc: 'Second monitoring-only channel alongside proven control loop. Pull diagnostics without touching safety-certified paths.' },
                  { title: 'Ethernet-APL', icon: '🌐', desc: '10 Mbit/s Ethernet on existing two-wire cabling. Intrinsic safety + power delivery. Full TCP/IP to field devices.' },
                ].map(c => (
                  <div key={c.title} className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-4">
                    <div className="text-2xl mb-2">{c.icon}</div>
                    <h3 className="text-sm font-bold text-white mb-1">{c.title}</h3>
                    <p className="text-[11px] text-zinc-400">{c.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Regulations ─────────────────────────── */}
        {tab === 'regulations' && (
          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/50 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">📋 Regulatory Standards & Compliance</h2>
              <input type="text" value={regFilter} onChange={e => setRegFilter(e.target.value)} placeholder="Filter by domain, region, or standard…" className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white w-64 placeholder-zinc-600" />
            </div>
            <div className="space-y-2">
              {filteredRegs.map(r => (
                <div key={r.id} className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-4 flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-white text-sm">{r.name}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-purple-500/10 text-purple-400">{r.region}</span>
                    </div>
                    <p className="text-xs text-zinc-400">{r.description}</p>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] bg-zinc-700/50 text-zinc-400 whitespace-nowrap">{r.domain}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Diagnostics & Calibration ────────── */}
        {tab === 'diagnostics' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/50 p-6">
              <h2 className="text-lg font-bold text-white mb-4">🔬 Calibration Methods</h2>
              <div className="grid md:grid-cols-2 gap-3">
                {calMethods.map(m => (
                  <div key={m.name} className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-white text-sm">{m.name}</span>
                      <div className="flex gap-2"><span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400">{m.accuracy}</span><span className="px-2 py-0.5 rounded text-[10px] bg-zinc-700/50 text-zinc-400">{m.type}</span></div>
                    </div>
                    <p className="text-xs text-zinc-400">{m.description}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/50 p-6">
              <h2 className="text-lg font-bold text-white mb-4">⚠️ Failure Modes & Advanced Physics</h2>
              <div className="grid md:grid-cols-2 gap-3">
                {[
                  { title: 'Reynolds Number Effects', desc: 'Laminar (Re<2300) vs turbulent (Re>4000) flow profiles. Most meters calibrated for turbulent. Viscous fluids or low velocity → laminar → degraded accuracy.' },
                  { title: 'Swirl & Asymmetric Profiles', desc: 'Dual elbows create swirl persisting 50+ diameters. Flow conditioners (CPA 50E, tube bundles) break swirl. Multipath ultrasonics average distortion.' },
                  { title: 'Pulsating Flow', desc: 'Reciprocating pumps create pulsation. DP meters over-read (√avg ≠ avg of √). Coriolis handles better except at tube resonance frequencies.' },
                  { title: 'Two-Phase Flow', desc: 'Gas bubbles in liquid — hardest measurement problem. Multiphase meters use gamma-ray + venturi + cross-correlation. $300K–$1M subsea systems.' },
                  { title: 'Cavitation', desc: 'Local pressure drops below vapor pressure → bubble collapse → erosion, noise, destroyed accuracy. DP meters most susceptible.' },
                  { title: 'Impulse Line Failures', desc: 'DP meters: blockages, leaks, freezing in impulse lines. Multivariable transmitters flag inconsistencies. Five-valve manifold diagnostics.' },
                ].map(f => (
                  <div key={f.title} className="rounded-xl border border-amber-500/10 bg-zinc-800/20 p-4">
                    <h3 className="text-sm font-bold text-amber-300 mb-1">{f.title}</h3>
                    <p className="text-[11px] text-zinc-400">{f.desc}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/50 p-6">
              <h2 className="text-lg font-bold text-white mb-4">📊 Industry Case Studies</h2>
              <div className="grid md:grid-cols-2 gap-3">
                {[
                  { title: 'Subsea Multiphase (Equinor)', icon: '🛢️', result: 'Continuous MPFM data detected water breakthrough days vs weeks. $800K–$1.2M/meter, payback in months. Hundreds of millions in added recovery.' },
                  { title: 'District Metered Areas (Thames Water)', icon: '💧', result: 'Mag meters at every zone inlet/outlet. Overnight minimum flow analysis detects leaks before surface. Pressure management reduces leak rate.' },
                  { title: 'Pharma Continuous Mfg', icon: '💊', result: 'Coriolis meters on continuous direct compression. Production time: weeks → hours. Reduced waste, improved dose uniformity. FDA data integrity compliance.' },
                  { title: 'Semiconductor Fab', icon: '🔬', result: 'Thousands of thermal MFCs per fab. 3nm/2nm nodes demand tighter tolerance. Single tool runs $50K–$100K wafers. Moving to predictive maintenance on MFC diagnostics.' },
                ].map(c => (
                  <div key={c.title} className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-4">
                    <div className="flex items-center gap-2 mb-2"><span className="text-xl">{c.icon}</span><span className="font-bold text-white text-sm">{c.title}</span></div>
                    <p className="text-[11px] text-zinc-400">{c.result}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <footer className="text-center text-xs text-zinc-600 py-4">
          <p>FreedomForge Industrial Intelligence · Flow Metering · IoT/SCADA · Industry 4.0</p>
        </footer>
      </div>
    </div>
  );
}
