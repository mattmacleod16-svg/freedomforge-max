'use client';

import React, { useState } from 'react';

const SHARE_URL = 'https://freedomforge.one';
const SHARE_TITLE = 'FreedomForge Max — Autonomous Intelligence Stack';
const SHARE_TEXT =
  '🔥 Just discovered FreedomForge Max — 20+ AI providers, 50+ models, autonomous trading, tax intelligence, all in one free app. This is the future.\n\n';

const HASHTAGS = 'FreedomForge,AI,OpenSource,FinancialFreedom';

const SOCIAL_LINKS = [
  {
    name: 'X (Twitter)',
    icon: '𝕏',
    color: 'hover:bg-zinc-800',
    url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(SHARE_URL)}&hashtags=${HASHTAGS}`,
  },
  {
    name: 'WhatsApp',
    icon: '💬',
    color: 'hover:bg-green-900/30',
    url: `https://wa.me/?text=${encodeURIComponent(SHARE_TEXT + SHARE_URL)}`,
  },
  {
    name: 'Telegram',
    icon: '✈️',
    color: 'hover:bg-blue-900/30',
    url: `https://t.me/share/url?url=${encodeURIComponent(SHARE_URL)}&text=${encodeURIComponent(SHARE_TEXT)}`,
  },
  {
    name: 'LinkedIn',
    icon: 'in',
    color: 'hover:bg-blue-800/30',
    url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SHARE_URL)}`,
  },
  {
    name: 'Reddit',
    icon: '🔴',
    color: 'hover:bg-orange-900/30',
    url: `https://reddit.com/submit?url=${encodeURIComponent(SHARE_URL)}&title=${encodeURIComponent(SHARE_TITLE)}`,
  },
  {
    name: 'Email',
    icon: '✉️',
    color: 'hover:bg-purple-900/30',
    url: `mailto:?subject=${encodeURIComponent(SHARE_TITLE)}&body=${encodeURIComponent(SHARE_TEXT + '\n\n' + SHARE_URL)}`,
  },
];

export default function ShareWidget() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: SHARE_URL });
        return;
      } catch { /* user cancelled */ }
    }
    setOpen(true);
  };

  const copyLink = async () => {
    await navigator.clipboard?.writeText(SHARE_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      {/* Floating share button */}
      <button
        onClick={handleNativeShare}
        className="fixed bottom-20 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-amber-500 shadow-lg shadow-purple-500/20 transition hover:scale-110 active:scale-95"
        aria-label="Share FreedomForge"
        title="Share FreedomForge"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      </button>

      {/* Share modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-zinc-800 bg-zinc-950 p-6 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Share FreedomForge</h3>
              <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-white text-xl">×</button>
            </div>

            <p className="text-xs text-zinc-400 mb-4">Help someone discover the future of AI. Every share plants a seed of financial freedom.</p>

            {/* Social grid */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {SOCIAL_LINKS.map((link) => (
                <a
                  key={link.name}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex flex-col items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 transition ${link.color}`}
                >
                  <span className="text-xl">{link.icon}</span>
                  <span className="text-[10px] text-zinc-400">{link.name}</span>
                </a>
              ))}
            </div>

            {/* Copy link */}
            <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-black/50 p-2">
              <input
                readOnly
                value={SHARE_URL}
                className="flex-1 bg-transparent text-xs text-zinc-300 outline-none px-2"
              />
              <button
                onClick={copyLink}
                className="shrink-0 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-500 transition"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>

            {/* Viral message */}
            <p className="mt-4 text-center text-[10px] text-zinc-600">
              🌍 FreedomForge is free and open-source — sharing is how we grow.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
