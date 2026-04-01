'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';

const STEPS = ['welcome', 'keys', 'target', 'telegram', 'done'] as const;
type Step = typeof STEPS[number];

function OnboardingInner() {
  const router     = useRouter();
  const search     = useSearchParams();
  const [step, setStep]     = useState<Step>((search.get('step') as Step) || 'welcome');
  const [user, setUser]     = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  // Keys form state
  const [cbKey,    setCbKey]    = useState('');
  const [cbSecret, setCbSecret] = useState('');
  const [krKey,    setKrKey]    = useState('');
  const [krSecret, setKrSecret] = useState('');

  // Target
  const [monthly, setMonthly] = useState('5000');

  // Telegram
  const [tgChatId, setTgChatId] = useState('');

  useEffect(() => {
    fetch('/api/user/profile').then(r => r.json()).then(d => {
      if (!d.authenticated) { router.replace('/signup'); return; }
      setUser(d);
    });
  }, []);

  const saveKeys = async () => {
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/user/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coinbaseApiKey: cbKey || undefined, coinbaseApiSecret: cbSecret || undefined, krakenApiKey: krKey || undefined, krakenApiSecret: krSecret || undefined }) });
      if (!res.ok) throw new Error('Failed to save keys');
      setStep('target');
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const saveTarget = async () => {
    setSaving(true); setError('');
    try {
      const m = parseFloat(monthly) || 5000;
      await fetch('/api/user/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetMonthly: m, targetDaily: m / 30 }) });
      setStep('telegram');
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const saveTelegram = async () => {
    setSaving(true); setError('');
    try {
      if (tgChatId) await fetch('/api/user/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telegramChatId: tgChatId }) });
      setStep('done');
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const stepIdx = STEPS.indexOf(step);
  const pct     = Math.round((stepIdx / (STEPS.length - 1)) * 100);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4 py-12">
      {/* Progress bar */}
      <div className="w-full max-w-lg mb-8">
        <div className="flex justify-between text-xs text-zinc-500 mb-2">
          <span>Setup Progress</span><span>{pct}%</span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-purple-600 to-amber-500 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="w-full max-w-lg bg-zinc-900/80 border border-zinc-800 rounded-2xl p-8">
        {error && <div className="mb-4 text-red-400 text-sm bg-red-900/20 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}

        {step === 'welcome' && (
          <div className="text-center">
            <div className="text-6xl mb-4">⚡</div>
            <h1 className="text-2xl font-bold mb-2">Welcome{user?.name ? `, ${user.name.split(' ')[0]}` : ''}!</h1>
            <p className="text-zinc-400 mb-6">Let&apos;s set up your autonomous income engine. Takes about 3 minutes.</p>
            <div className="space-y-3 text-left mb-8">
              {[['🏦', 'Connect your exchanges', 'Coinbase + Kraken API keys for live trading'],['🎯','Set your income target','Tell the system what you want to earn'],['📱','Link Telegram','Get real-time alerts and control via chat']].map(([icon,title,desc]) => (
                <div key={title as string} className="flex gap-3 items-start p-3 bg-zinc-800/50 rounded-xl">
                  <span className="text-2xl">{icon}</span>
                  <div><div className="font-semibold text-sm">{title as string}</div><div className="text-xs text-zinc-400">{desc as string}</div></div>
                </div>
              ))}
            </div>
            <button onClick={() => setStep('keys')} className="w-full bg-gradient-to-r from-purple-600 to-amber-500 text-white font-bold rounded-xl py-3.5">Get Started →</button>
          </div>
        )}

        {step === 'keys' && (
          <div>
            <div className="text-3xl mb-3">🏦</div>
            <h2 className="text-xl font-bold mb-1">Connect Exchanges</h2>
            <p className="text-zinc-400 text-sm mb-6">Your keys are encrypted with AES-256 and never leave our servers in plaintext.</p>
            <div className="space-y-4">
              <div className="p-4 bg-zinc-800/50 rounded-xl">
                <div className="font-semibold text-sm mb-3 flex items-center gap-2">🟡 Coinbase Advanced Trade</div>
                <input value={cbKey} onChange={e => setCbKey(e.target.value)} placeholder="API Key (organizations/...)" className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500 mb-2" />
                <textarea value={cbSecret} onChange={e => setCbSecret(e.target.value)} placeholder="EC Private Key (-----BEGIN EC PRIVATE KEY-----...)" rows={3} className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500 font-mono text-xs" />
              </div>
              <div className="p-4 bg-zinc-800/50 rounded-xl">
                <div className="font-semibold text-sm mb-3 flex items-center gap-2">🔵 Kraken</div>
                <input value={krKey} onChange={e => setKrKey(e.target.value)} placeholder="API Key" className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500 mb-2" />
                <input value={krSecret} onChange={e => setKrSecret(e.target.value)} placeholder="API Secret" type="password" className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep('target')} className="flex-1 border border-zinc-600 text-zinc-400 font-semibold rounded-xl py-3 text-sm hover:border-zinc-400 transition">Skip for now</button>
              <button onClick={saveKeys} disabled={saving} className="flex-1 bg-gradient-to-r from-purple-600 to-amber-500 text-white font-bold rounded-xl py-3 text-sm disabled:opacity-50">{saving ? 'Saving...' : 'Save & Continue →'}</button>
            </div>
          </div>
        )}

        {step === 'target' && (
          <div>
            <div className="text-3xl mb-3">🎯</div>
            <h2 className="text-xl font-bold mb-1">Set Your Income Target</h2>
            <p className="text-zinc-400 text-sm mb-6">FreedomForge will auto-tune its strategy to chase this goal every day.</p>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {['1000','5000','10000','25000','50000','100000'].map(v => (
                <button key={v} onClick={() => setMonthly(v)} className={`py-3 rounded-xl text-sm font-bold border transition ${monthly === v ? 'bg-purple-600/30 border-purple-500 text-purple-300' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'}`}>
                  ${parseInt(v) >= 1000 ? (parseInt(v)/1000)+'k' : v}/mo
                </button>
              ))}
            </div>
            <div className="relative mb-4">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">$</span>
              <input type="number" value={monthly} onChange={e => setMonthly(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-8 py-3 text-white text-sm focus:outline-none focus:border-purple-500" placeholder="Custom amount" />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">/month</span>
            </div>
            <div className="p-3 bg-amber-900/20 border border-amber-500/20 rounded-xl text-xs text-amber-300 mb-6">
              ⚡ That&apos;s <strong>${(parseFloat(monthly || '0') / 30).toFixed(0)}/day</strong> — the system will tune itself to hit this automatically.
            </div>
            <button onClick={saveTarget} disabled={saving} className="w-full bg-gradient-to-r from-purple-600 to-amber-500 text-white font-bold rounded-xl py-3.5 text-sm disabled:opacity-50">{saving ? 'Setting target...' : 'Set Target & Continue →'}</button>
          </div>
        )}

        {step === 'telegram' && (
          <div>
            <div className="text-3xl mb-3">📱</div>
            <h2 className="text-xl font-bold mb-1">Link Telegram</h2>
            <p className="text-zinc-400 text-sm mb-6">Get real-time trade alerts and control your engine from Telegram.</p>
            <div className="p-4 bg-zinc-800/50 rounded-xl mb-4 text-sm space-y-2">
              <div className="font-semibold text-zinc-300 mb-3">How to get your Chat ID:</div>
              {['Open Telegram and search for @userinfobot','Send it any message','Copy the "Id" number it replies with','Paste it below'].map((step, i) => (
                <div key={i} className="flex gap-2 text-zinc-400"><span className="text-purple-400 font-bold">{i+1}.</span> {step}</div>
              ))}
            </div>
            <input value={tgChatId} onChange={e => setTgChatId(e.target.value)} placeholder="Your Telegram Chat ID (e.g. 123456789)" className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-purple-500 mb-4" />
            <div className="flex gap-3">
              <button onClick={() => setStep('done')} className="flex-1 border border-zinc-600 text-zinc-400 font-semibold rounded-xl py-3 text-sm hover:border-zinc-400 transition">Skip</button>
              <button onClick={saveTelegram} disabled={saving} className="flex-1 bg-gradient-to-r from-purple-600 to-amber-500 text-white font-bold rounded-xl py-3 text-sm disabled:opacity-50">{saving ? 'Saving...' : 'Save & Finish →'}</button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="text-center">
            <div className="text-6xl mb-4">🚀</div>
            <h2 className="text-2xl font-bold mb-2">You&apos;re live!</h2>
            <p className="text-zinc-400 mb-8">FreedomForge is active and working toward your income target 24/7.</p>
            <div className="space-y-2 mb-8">
              {[['📊', 'Dashboard', '/dashboard', 'Monitor performance'],['🎯', 'Income Command', '/command', 'Set targets & track progress'],['💱', 'Trading', '/trading', 'Live positions & history']].map(([icon,label,href,desc]) => (
                <a key={href as string} href={href as string} className="flex items-center gap-3 p-3 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl transition">
                  <span className="text-2xl">{icon}</span>
                  <div className="text-left"><div className="font-semibold text-sm">{label as string}</div><div className="text-xs text-zinc-400">{desc as string}</div></div>
                  <span className="ml-auto text-zinc-500">→</span>
                </a>
              ))}
            </div>
            <a href="/dashboard" className="block w-full bg-gradient-to-r from-purple-600 to-amber-500 text-white font-bold rounded-xl py-3.5">Go to Dashboard →</a>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return <Suspense fallback={<div className="min-h-screen bg-black flex items-center justify-center text-white">Loading...</div>}><OnboardingInner /></Suspense>;
}
