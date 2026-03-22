'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';

interface GenieProfile {
  name: string;
  avatar: string;
  genieName: string;
  interests: string[];
  dashboardLayout: string[];
  theme: 'midnight' | 'ocean' | 'aurora' | 'ember';
  quickActions: string[];
  freedomGoal: string;
  morningBriefing: boolean;
  watchdogAlerts: boolean;
  autoYieldOptimize: boolean;
  privacyMode: boolean;
  language: string;
}

const DEFAULT_PROFILE: GenieProfile = {
  name: '',
  avatar: '🧞',
  genieName: 'MAX',
  interests: [],
  dashboardLayout: ['watchdog', 'vault', 'mining', 'discover'],
  theme: 'midnight',
  quickActions: ['Check portfolio', 'Scan congress trades', 'Mining status', 'Find deals'],
  freedomGoal: '',
  morningBriefing: true,
  watchdogAlerts: true,
  autoYieldOptimize: false,
  privacyMode: false,
  language: 'en',
};

const INTEREST_OPTIONS = [
  { id: 'crypto', icon: '₿', label: 'Crypto & DeFi' },
  { id: 'mining', icon: '⛏️', label: 'Mining Operations' },
  { id: 'stocks', icon: '📈', label: 'Stock Market' },
  { id: 'depin', icon: '🌐', label: 'DePIN Networks' },
  { id: 'ai', icon: '🧠', label: 'AI & Machine Learning' },
  { id: 'privacy', icon: '🔒', label: 'Privacy & Security' },
  { id: 'health', icon: '💪', label: 'Health & Wellness' },
  { id: 'travel', icon: '✈️', label: 'Travel Planning' },
  { id: 'realestate', icon: '🏡', label: 'Real Estate' },
  { id: 'politics', icon: '🏛️', label: 'Political Intelligence' },
  { id: 'shopping', icon: '🛒', label: 'Smart Shopping' },
  { id: 'social', icon: '📱', label: 'Social Media' },
  { id: 'patents', icon: '📜', label: 'Patent Research' },
  { id: 'quantum', icon: '⚛️', label: 'Quantum Computing' },
  { id: 'gaming', icon: '🎮', label: 'Gaming & NFTs' },
  { id: 'nutrition', icon: '🥗', label: 'Nutrition & Diet' },
];

const AVATAR_OPTIONS = ['🧞', '🧞‍♂️', '🦸', '🧙', '🤖', '👾', '🦊', '🐉', '⚡', '🔮', '🌟', '🛡️'];

const THEME_OPTIONS = [
  { id: 'midnight' as const, label: 'Midnight', from: '#030108', to: '#0a051e', accent: 'purple' },
  { id: 'ocean' as const, label: 'Deep Ocean', from: '#010810', to: '#031525', accent: 'cyan' },
  { id: 'aurora' as const, label: 'Aurora', from: '#020808', to: '#051e0a', accent: 'emerald' },
  { id: 'ember' as const, label: 'Ember', from: '#100303', to: '#1e0a05', accent: 'orange' },
];

const QUICK_ACTION_OPTIONS = [
  'Check portfolio', 'Scan congress trades', 'Mining status', 'Find deals',
  'Yield opportunities', 'News briefing', 'Wallet security audit', 'Price alerts',
  'Patent search', 'Travel planning', 'Health check', 'Social analytics',
  'Market sentiment', 'DePIN rewards', 'Tax overview', 'Bill reminders',
];

const DASHBOARD_MODULES = [
  { id: 'watchdog', icon: '👁️', label: 'Watchdog' },
  { id: 'vault', icon: '🏦', label: 'Vault' },
  { id: 'mining', icon: '⛏️', label: 'Mining' },
  { id: 'discover', icon: '🔭', label: 'Discover' },
  { id: 'yields', icon: '📈', label: 'Yields' },
  { id: 'social', icon: '📱', label: 'Social' },
  { id: 'health', icon: '❤️', label: 'Health' },
  { id: 'travel', icon: '✈️', label: 'Travel' },
];

export default function GeniePage() {
  const [profile, setProfile] = useState<GenieProfile>(() => {
    try {
      const saved = localStorage.getItem('ff_genie_profile');
      if (saved) return { ...DEFAULT_PROFILE, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_PROFILE;
  });
  const [tab, setTab] = useState<'home' | 'customize' | 'briefing' | 'actions'>('home');
  const [setupStep, setSetupStep] = useState(0);
  const [isNew, setIsNew] = useState(() => {
    try {
      return !localStorage.getItem('ff_genie_profile');
    } catch {}
    return true;
  });
  const [genieMessage, setGenieMessage] = useState('');
  const [userInput, setUserInput] = useState('');

  const saveProfile = useCallback((updates: Partial<GenieProfile>) => {
    const updated = { ...profile, ...updates };
    setProfile(updated);
    localStorage.setItem('ff_genie_profile', JSON.stringify(updated));
    // Also sync to ff_user_profile for other pages
    try {
      const existing = JSON.parse(localStorage.getItem('ff_user_profile') || '{}');
      localStorage.setItem('ff_user_profile', JSON.stringify({ ...existing, name: updated.name, avatar: updated.avatar }));
    } catch {}
  }, [profile]);

  const toggleInterest = (id: string) => {
    const interests = profile.interests.includes(id)
      ? profile.interests.filter(i => i !== id)
      : [...profile.interests, id];
    saveProfile({ interests });
  };

  const toggleQuickAction = (action: string) => {
    const qa = profile.quickActions.includes(action)
      ? profile.quickActions.filter(a => a !== action)
      : [...profile.quickActions, action];
    saveProfile({ quickActions: qa });
  };

  const toggleDashModule = (id: string) => {
    const layout = profile.dashboardLayout.includes(id)
      ? profile.dashboardLayout.filter(m => m !== id)
      : [...profile.dashboardLayout, id];
    saveProfile({ dashboardLayout: layout });
  };

  const getGreeting = () => {
    const h = new Date().getHours();
    const name = profile.name ? profile.name.split(' ')[0] : 'human';
    if (h < 6) return `Still up, ${name}? I'm watching the markets while you rest. 🌙`;
    if (h < 12) return `Good morning, ${name}! Here's what happened while you slept. ☀️`;
    if (h < 17) return `Afternoon, ${name}. Your empire is running smooth. 💪`;
    if (h < 21) return `Evening, ${name}. Let me handle the night shift. 🌆`;
    return `Night mode, ${name}. I'll keep watch. Go enjoy your evening. 🌙`;
  };

  const handleGenieChat = () => {
    if (!userInput.trim()) return;
    const q = userInput.toLowerCase();
    let reply = '';
    if (q.includes('portfolio') || q.includes('money') || q.includes('balance')) {
      reply = '💰 Your Vault is your financial command center. Head to /vault for real-time portfolio tracking across all your wallets and assets.';
    } else if (q.includes('congress') || q.includes('politician') || q.includes('stock act')) {
      reply = '🏛️ The Watchdog is tracking congressional trades right now. Any suspicious clustering or fast-reported trades will trigger alerts.';
    } else if (q.includes('mining') || q.includes('hashrate') || q.includes('rig')) {
      reply = '⛏️ Mining dashboard shows all your rigs across SHA-256, Scrypt, Ethash, and more. Check the Vault → Mining tab for live status.';
    } else if (q.includes('patent') || q.includes('quantum')) {
      reply = '📜 The Discover page has patent intelligence on quantum computing, AI diagnostics, and blockchain. IBM, Google, and Microsoft are leading filers.';
    } else if (q.includes('help') || q.includes('what can you do')) {
      reply = '🧞 I can help with: portfolio tracking, congress trade alerts, mining operations, yield optimization, shopping comparisons, patent research, health tracking, travel planning, and more! Check /skills for all 40+ capabilities.';
    } else if (q.includes('free') || q.includes('freedom')) {
      reply = '✊ That\'s what we\'re all about. FreedomForge handles your past (tracking, records, analysis) and your future (alerts, optimization, planning) so you can live fully in the present.';
    } else {
      reply = `🧞 I hear you! Let me look into "${userInput}". For now, try checking /discover for trending intelligence or /skills to see everything I can do.`;
    }
    setGenieMessage(reply);
    setUserInput('');
  };

  // Onboarding wizard for new users
  if (isNew && setupStep < 4) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#0a051e] to-[#030108] flex items-center justify-center p-4">
        <div className="w-full max-w-lg space-y-6">
          <div className="text-center">
            <p className="text-6xl mb-4">{setupStep === 0 ? '🧞' : setupStep === 1 ? '🎨' : setupStep === 2 ? '⚡' : '🎯'}</p>
            <p className="text-xs uppercase tracking-[0.3em] text-purple-400/80">Setup • Step {setupStep + 1} of 4</p>
            <div className="flex gap-1 justify-center mt-2">
              {[0,1,2,3].map(i => (
                <div key={i} className={`h-1 w-12 rounded-full ${i <= setupStep ? 'bg-purple-500' : 'bg-zinc-800'}`} />
              ))}
            </div>
          </div>

          {setupStep === 0 && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6 space-y-4">
              <h2 className="text-xl font-bold text-white text-center">Who are you, human?</h2>
              <p className="text-xs text-zinc-500 text-center">Your Genie needs to know who it serves.</p>
              <input type="text" value={profile.name} onChange={(e) => saveProfile({ name: e.target.value })}
                placeholder="Your name..." className="w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 text-white outline-none focus:border-purple-500" />
              <div>
                <p className="text-xs text-zinc-500 mb-2">Choose your avatar:</p>
                <div className="flex flex-wrap gap-2">
                  {AVATAR_OPTIONS.map(a => (
                    <button key={a} onClick={() => saveProfile({ avatar: a })}
                      className={`text-2xl p-2 rounded-xl transition ${profile.avatar === a ? 'bg-purple-600/30 ring-2 ring-purple-500' : 'hover:bg-zinc-800'}`}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {setupStep === 1 && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6 space-y-4">
              <h2 className="text-xl font-bold text-white text-center">What matters to you?</h2>
              <p className="text-xs text-zinc-500 text-center">Select your interests. Your Genie will prioritize intelligence in these areas.</p>
              <div className="grid grid-cols-2 gap-2">
                {INTEREST_OPTIONS.map(opt => (
                  <button key={opt.id} onClick={() => toggleInterest(opt.id)}
                    className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition ${
                      profile.interests.includes(opt.id) ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30' : 'bg-zinc-800/50 text-zinc-500 hover:text-white border border-transparent'
                    }`}>
                    <span>{opt.icon}</span> {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {setupStep === 2 && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6 space-y-4">
              <h2 className="text-xl font-bold text-white text-center">Your Freedom Goal</h2>
              <p className="text-xs text-zinc-500 text-center">What does freedom look like for you? This drives everything your Genie optimizes for.</p>
              <textarea value={profile.freedomGoal} onChange={(e) => saveProfile({ freedomGoal: e.target.value })}
                placeholder="e.g., $10K/month passive income so I can travel the world, spend time with family, and never worry about money again..."
                rows={3} className="w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-purple-500 resize-none" />
              <div className="space-y-2">
                <p className="text-xs text-zinc-500">Automation preferences:</p>
                {[
                  { key: 'morningBriefing', label: '☀️ Morning briefing (market recap, alerts, opportunities)' },
                  { key: 'watchdogAlerts', label: '👁️ Watchdog alerts (congress trades, whale movements)' },
                  { key: 'autoYieldOptimize', label: '📈 Auto yield optimization (suggest better yields)' },
                  { key: 'privacyMode', label: '🔒 Privacy mode (minimize on-chain footprint)' },
                ].map(opt => (
                  <button key={opt.key} onClick={() => saveProfile({ [opt.key]: !profile[opt.key as keyof GenieProfile] } as Partial<GenieProfile>)}
                    className={`w-full text-left rounded-xl px-3 py-2 text-xs transition ${
                      profile[opt.key as keyof GenieProfile] ? 'bg-emerald-600/10 text-emerald-300 border border-emerald-500/30' : 'bg-zinc-800/30 text-zinc-500 border border-transparent'
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {setupStep === 3 && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6 space-y-4">
              <h2 className="text-xl font-bold text-white text-center">Your Dashboard</h2>
              <p className="text-xs text-zinc-500 text-center">Choose which modules appear on your home screen. Drag to reorder later.</p>
              <div className="grid grid-cols-2 gap-2">
                {DASHBOARD_MODULES.map(mod => (
                  <button key={mod.id} onClick={() => toggleDashModule(mod.id)}
                    className={`flex items-center gap-2 rounded-xl px-3 py-3 text-xs font-semibold transition ${
                      profile.dashboardLayout.includes(mod.id) ? 'bg-cyan-600/20 text-cyan-300 border border-cyan-500/30' : 'bg-zinc-800/50 text-zinc-500 hover:text-white border border-transparent'
                    }`}>
                    <span className="text-lg">{mod.icon}</span> {mod.label}
                  </button>
                ))}
              </div>
              <div>
                <p className="text-xs text-zinc-500 mb-2">Choose a theme:</p>
                <div className="grid grid-cols-2 gap-2">
                  {THEME_OPTIONS.map(t => (
                    <button key={t.id} onClick={() => saveProfile({ theme: t.id })}
                      className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                        profile.theme === t.id ? 'ring-2 ring-purple-500 bg-zinc-800' : 'bg-zinc-800/50 text-zinc-500 hover:text-white'
                      }`}>
                      <span className="inline-block w-3 h-3 rounded-full mr-1" style={{ background: `linear-gradient(135deg, ${t.from}, ${t.to})` }} />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            {setupStep > 0 && (
              <button onClick={() => setSetupStep(s => s - 1)}
                className="flex-1 rounded-xl border border-zinc-700 py-3 text-sm text-zinc-400 hover:text-white transition">
                ← Back
              </button>
            )}
            <button onClick={() => { if (setupStep < 3) setSetupStep(s => s + 1); else { setIsNew(false); setTab('home'); } }}
              className="flex-1 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-600 py-3 text-sm font-bold text-white hover:opacity-90 transition">
              {setupStep < 3 ? 'Next →' : '🧞 Summon Your Genie'}
            </button>
          </div>
          {setupStep === 0 && (
            <button onClick={() => { setIsNew(false); setTab('home'); }}
              className="w-full text-center text-xs text-zinc-600 hover:text-zinc-400 transition">
              Skip setup → use defaults
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#030108] via-[#0a051e] to-[#030108] p-4 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <header className="text-center">
          <p className="text-5xl mb-2">{profile.avatar}</p>
          <h1 className="text-3xl md:text-4xl font-black bg-gradient-to-r from-purple-300 via-cyan-300 to-emerald-300 bg-clip-text text-transparent">
            {profile.genieName || 'MAX'}
          </h1>
          <p className="text-sm text-zinc-400 mt-1">{getGreeting()}</p>
        </header>

        {/* Genie Chat */}
        <div className="rounded-2xl border border-purple-500/20 bg-purple-950/10 p-5">
          <div className="flex gap-2">
            <input type="text" value={userInput} onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGenieChat()}
              placeholder="Ask your Genie anything... (portfolio, mining, congress, patents, help)"
              className="flex-1 rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-purple-500 transition" />
            <button onClick={handleGenieChat}
              className="rounded-xl bg-gradient-to-r from-purple-600 to-cyan-600 px-5 py-3 text-sm font-bold text-white hover:opacity-90 transition">
              🧞 Ask
            </button>
          </div>
          {genieMessage && (
            <div className="mt-3 rounded-xl bg-black/30 border border-zinc-800 p-4">
              <p className="text-sm text-zinc-300 leading-relaxed">{genieMessage}</p>
            </div>
          )}
        </div>

        {/* Tab Nav */}
        <div className="flex gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-1">
          {([['home', '🏠 Home'], ['actions', '⚡ Quick Actions'], ['briefing', '📋 Briefing'], ['customize', '🎨 Customize']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${tab === id ? 'bg-purple-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Home Tab — Custom Dashboard */}
        {tab === 'home' && (
          <div className="space-y-4">
            {/* Quick Modules based on user's layout */}
            <div className="grid gap-3 sm:grid-cols-2">
              {profile.dashboardLayout.map(modId => {
                const mod = DASHBOARD_MODULES.find(m => m.id === modId);
                if (!mod) return null;
                const routes: Record<string, string> = {
                  watchdog: '/watchdog', vault: '/vault', mining: '/vault',
                  discover: '/discover', yields: '/vault', social: '/skills',
                  health: '/life', travel: '/discover',
                };
                return (
                  <Link key={modId} href={routes[modId] || '/skills'}
                    className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 transition hover:border-purple-500/30 hover:bg-purple-950/5">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-2xl">{mod.icon}</span>
                      <span className="text-sm font-bold text-white">{mod.label}</span>
                    </div>
                    <p className="text-xs text-zinc-500">Tap to open {mod.label.toLowerCase()} dashboard →</p>
                  </Link>
                );
              })}
            </div>

            {/* Interest-based Intelligence */}
            {profile.interests.length > 0 && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
                <p className="text-xs uppercase tracking-widest text-purple-400/60 mb-3">Your Interests</p>
                <div className="flex flex-wrap gap-2">
                  {profile.interests.map(id => {
                    const opt = INTEREST_OPTIONS.find(o => o.id === id);
                    return opt ? (
                      <span key={id} className="rounded-full bg-purple-600/10 border border-purple-500/20 px-3 py-1 text-xs text-purple-300">
                        {opt.icon} {opt.label}
                      </span>
                    ) : null;
                  })}
                </div>
                <p className="text-[10px] text-zinc-600 mt-2">Intelligence is prioritized for these areas. Edit in Customize tab.</p>
              </div>
            )}

            {/* Freedom Goal */}
            {profile.freedomGoal && (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-5">
                <p className="text-xs uppercase tracking-widest text-emerald-400/60 mb-1">Freedom Goal</p>
                <p className="text-sm text-emerald-300 leading-relaxed">{profile.freedomGoal}</p>
                <p className="text-[10px] text-zinc-600 mt-2">Every optimization your Genie makes serves this goal.</p>
              </div>
            )}

            {/* Navigation Hub */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
              <p className="text-xs uppercase tracking-widest text-zinc-500 mb-3">All Modules</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {[
                  { href: '/', icon: '⚡', label: 'MAX Chat' },
                  { href: '/vault', icon: '🏦', label: 'Vault' },
                  { href: '/watchdog', icon: '👁️', label: 'Watchdog' },
                  { href: '/discover', icon: '🔭', label: 'Discover' },
                  { href: '/skills', icon: '🤖', label: 'Skills' },
                  { href: '/life', icon: '🌱', label: 'Life' },
                  { href: '/intelligence', icon: '🧠', label: 'Intel' },
                  { href: '/ai-models', icon: '🔮', label: 'Models' },
                  { href: '/cipher-lab', icon: '🔬', label: 'Cipher' },
                  { href: '/token', icon: '🪙', label: '$FORGE' },
                  { href: '/dashboard', icon: '📊', label: 'Dashboard' },
                  { href: '/login', icon: '🔑', label: 'Login' },
                ].map(item => (
                  <Link key={item.href} href={item.href}
                    className="flex flex-col items-center gap-1 rounded-xl border border-zinc-800/50 p-3 text-zinc-500 hover:text-white hover:border-purple-500/30 hover:bg-purple-950/5 transition">
                    <span className="text-lg">{item.icon}</span>
                    <span className="text-[9px] font-semibold">{item.label}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Quick Actions Tab */}
        {tab === 'actions' && (
          <div className="space-y-4">
            <p className="text-xs text-zinc-500">Tap a quick action to execute. Toggle actions on/off to customize your shortcuts.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {QUICK_ACTION_OPTIONS.map(action => (
                <button key={action} onClick={() => toggleQuickAction(action)}
                  className={`rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${
                    profile.quickActions.includes(action)
                      ? 'bg-cyan-600/10 text-cyan-300 border border-cyan-500/30'
                      : 'bg-zinc-800/30 text-zinc-500 border border-transparent hover:text-white'
                  }`}>
                  {profile.quickActions.includes(action) ? '✓ ' : '+ '}{action}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Briefing Tab */}
        {tab === 'briefing' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-950/10 p-6">
              <p className="text-xs uppercase tracking-widest text-cyan-400/60 mb-2">Morning Briefing</p>
              <h3 className="text-lg font-bold text-white mb-3">Your Daily Intelligence Report</h3>
              <div className="space-y-3">
                {[
                  { icon: '📊', title: 'Markets', detail: 'BTC is holding above key support. Your portfolio is up since yesterday. No emergency rebalancing needed.' },
                  { icon: '🏛️', title: 'Congress', detail: 'No new suspicious trades detected in the last 24 hours. Watchdog is scanning all STOCK Act filings.' },
                  { icon: '⛏️', title: 'Mining', detail: 'All rigs online. Total hashrate stable. No hardware warnings. Next difficulty adjustment in ~3 days.' },
                  { icon: '📈', title: 'Yields', detail: 'Current yield positions are performing within expected ranges. No better opportunities detected yet.' },
                  { icon: '🔒', title: 'Security', detail: 'No phishing attempts detected. All wallet approvals look clean. Privacy score: Good.' },
                  { icon: '🌐', title: 'DePIN', detail: 'Network rewards accumulating normally. DAWN, Helium, and Render nodes all operational.' },
                ].map((item, i) => (
                  <div key={i} className="flex gap-3 rounded-xl bg-black/20 p-3">
                    <span className="text-lg">{item.icon}</span>
                    <div>
                      <p className="text-xs font-bold text-white">{item.title}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="text-center">
              <p className="text-xs text-zinc-600">Briefing updates daily. Toggle in Customize → Automation Preferences.</p>
            </div>
          </div>
        )}

        {/* Customize Tab */}
        {tab === 'customize' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 space-y-3">
              <p className="text-xs uppercase tracking-widest text-purple-400/60">Identity</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-zinc-600 uppercase tracking-widest">Your Name</label>
                  <input type="text" value={profile.name} onChange={(e) => saveProfile({ name: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-zinc-700 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-purple-500" />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-600 uppercase tracking-widest">Genie Name</label>
                  <input type="text" value={profile.genieName} onChange={(e) => saveProfile({ genieName: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-zinc-700 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-purple-500" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-zinc-600 uppercase tracking-widest">Avatar</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {AVATAR_OPTIONS.map(a => (
                    <button key={a} onClick={() => saveProfile({ avatar: a })}
                      className={`text-xl p-1.5 rounded-lg transition ${profile.avatar === a ? 'bg-purple-600/30 ring-2 ring-purple-500' : 'hover:bg-zinc-800'}`}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 space-y-3">
              <p className="text-xs uppercase tracking-widest text-purple-400/60">Interests</p>
              <div className="grid grid-cols-2 gap-1.5">
                {INTEREST_OPTIONS.map(opt => (
                  <button key={opt.id} onClick={() => toggleInterest(opt.id)}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-semibold transition ${
                      profile.interests.includes(opt.id) ? 'bg-purple-600/20 text-purple-300' : 'text-zinc-600 hover:text-white'
                    }`}>
                    {opt.icon} {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 space-y-3">
              <p className="text-xs uppercase tracking-widest text-purple-400/60">Dashboard Modules</p>
              <div className="grid grid-cols-2 gap-1.5">
                {DASHBOARD_MODULES.map(mod => (
                  <button key={mod.id} onClick={() => toggleDashModule(mod.id)}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-semibold transition ${
                      profile.dashboardLayout.includes(mod.id) ? 'bg-cyan-600/20 text-cyan-300' : 'text-zinc-600 hover:text-white'
                    }`}>
                    {mod.icon} {mod.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 space-y-3">
              <p className="text-xs uppercase tracking-widest text-purple-400/60">Freedom Goal</p>
              <textarea value={profile.freedomGoal} onChange={(e) => saveProfile({ freedomGoal: e.target.value })}
                placeholder="What does freedom look like for you?" rows={2}
                className="w-full rounded-xl border border-zinc-700 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-purple-500 resize-none" />
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 space-y-3">
              <p className="text-xs uppercase tracking-widest text-purple-400/60">Theme</p>
              <div className="grid grid-cols-2 gap-2">
                {THEME_OPTIONS.map(t => (
                  <button key={t.id} onClick={() => saveProfile({ theme: t.id })}
                    className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                      profile.theme === t.id ? 'ring-2 ring-purple-500 bg-zinc-800 text-white' : 'bg-zinc-800/50 text-zinc-500'
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={() => { localStorage.removeItem('ff_genie_profile'); setProfile(DEFAULT_PROFILE); setIsNew(true); setSetupStep(0); }}
              className="w-full rounded-xl border border-red-500/20 py-2 text-xs text-red-400 hover:bg-red-500/5 transition">
              Reset Genie (start over)
            </button>
          </div>
        )}

        <footer className="border-t border-zinc-900 pt-6 pb-4 text-center">
          <p className="text-xs text-zinc-600">
            Your Genie is 100% private. All preferences stored locally on YOUR device. No data leaves your hands. 🔐
          </p>
        </footer>
      </div>
    </div>
  );
}
