'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'MAX', icon: '⚡', color: 'text-purple-400' },
  { href: '/genie', label: 'Genie', icon: '🧞', color: 'text-cyan-400' },
  { href: '/vault', label: 'Vault', icon: '🏦', color: 'text-pink-400' },
  { href: '/discover', label: 'Discover', icon: '🔭', color: 'text-blue-400' },
  { href: '/skills', label: 'Skills', icon: '🤖', color: 'text-purple-400' },
];

const MORE_ITEMS = [
  { href: '/watchdog', label: 'Watchdog', icon: '👁️' },
  { href: '/life', label: 'Life', icon: '🌱' },
  { href: '/intelligence', label: 'Intel', icon: '🧠' },
  { href: '/ai-models', label: 'Models', icon: '🔮' },
  { href: '/cipher-lab', label: 'Cipher', icon: '🔬' },
  { href: '/token', label: '$FORGE', icon: '🪙' },
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/marketing', label: 'Marketing', icon: '📣' },
];

export default function GlobalNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [userName, setUserName] = useState('');

  useEffect(() => {
    try {
      const profile = localStorage.getItem('ff_user_profile');
      if (profile) {
        const p = JSON.parse(profile);
        setUserName(p.name || '');
      }
    } catch {}
  }, []);

  useEffect(() => {
    const handleClick = () => setMoreOpen(false);
    if (moreOpen) document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [moreOpen]);

  return (
    <>
      {/* Desktop top bar */}
      <nav className="hidden md:flex fixed top-0 left-0 right-0 z-50 items-center justify-between border-b border-zinc-800/50 bg-black/80 backdrop-blur-xl px-4 py-2">
        <div className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                pathname === item.href
                  ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                  : 'text-zinc-500 hover:text-white hover:bg-zinc-800/50'
              }`}>
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
          <div className="relative">
            <button onClick={(e) => { e.stopPropagation(); setMoreOpen(!moreOpen); }}
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-zinc-500 hover:text-white hover:bg-zinc-800/50 transition">
              <span>⋯</span> More
            </button>
            {moreOpen && (
              <div className="absolute top-full left-0 mt-1 w-48 rounded-xl border border-zinc-800 bg-zinc-900/95 backdrop-blur-xl p-1 shadow-2xl">
                {MORE_ITEMS.map((item) => (
                  <Link key={item.href} href={item.href}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition ${
                      pathname === item.href ? 'bg-purple-600/20 text-purple-300' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                    }`}>
                    <span>{item.icon}</span> {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {userName && <span className="text-zinc-600">Hey, {userName.split(' ')[0]} 👋</span>}
          <Link href="/genie" className="rounded-full bg-gradient-to-r from-purple-600 to-cyan-600 px-3 py-1.5 text-white font-bold hover:opacity-90 transition">
            🧞 Ask Genie
          </Link>
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-800/50 bg-black/90 backdrop-blur-xl safe-area-bottom">
        <div className="flex items-center justify-around px-1 py-1">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href}
              className={`flex flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 min-w-[50px] transition ${
                pathname === item.href
                  ? 'text-purple-400'
                  : 'text-zinc-600 hover:text-zinc-400'
              }`}>
              <span className="text-lg">{item.icon}</span>
              <span className="text-[9px] font-semibold">{item.label}</span>
            </Link>
          ))}
          <button onClick={(e) => { e.stopPropagation(); setMoreOpen(!moreOpen); }}
            className="flex flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 min-w-[50px] text-zinc-600 hover:text-zinc-400 transition">
            <span className="text-lg">⋯</span>
            <span className="text-[9px] font-semibold">More</span>
          </button>
        </div>
        {moreOpen && (
          <div className="absolute bottom-full left-2 right-2 mb-1 rounded-2xl border border-zinc-800 bg-zinc-900/95 backdrop-blur-xl p-2 shadow-2xl">
            <div className="grid grid-cols-4 gap-1">
              {MORE_ITEMS.map((item) => (
                <Link key={item.href} href={item.href}
                  className={`flex flex-col items-center gap-1 rounded-xl p-2 transition ${
                    pathname === item.href ? 'bg-purple-600/20 text-purple-300' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                  }`}>
                  <span className="text-lg">{item.icon}</span>
                  <span className="text-[9px] font-semibold">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Spacers */}
      <div className="hidden md:block h-12" />
      <style jsx global>{`
        @supports (padding-bottom: env(safe-area-inset-bottom)) {
          .safe-area-bottom { padding-bottom: env(safe-area-inset-bottom); }
        }
        @media (max-width: 767px) {
          body { padding-bottom: 72px; }
        }
      `}</style>
    </>
  );
}
