'use client';

import React, { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPrompt() {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    const wasDismissed = localStorage.getItem('ff_install_dismissed');
    return !!(wasDismissed && Date.now() - Number(wasDismissed) < 7 * 86400000);
  });
  const [installed, setInstalled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  });
  const [showIOSPrompt] = useState(() => {
    if (typeof window === 'undefined') return false;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
    const isSafari = /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|Chrome/.test(navigator.userAgent);
    return isIOS && isSafari;
  });
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (dismissed || installed) return;

    // Android/Desktop Chrome install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [dismissed, installed]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('ff_install_dismissed', String(Date.now()));
  };

  if (dismissed || installed) return null;

  // Android/Desktop Chrome prompt
  if (deferredPrompt) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-lg animate-slide-up">
        <div className="rounded-2xl border border-purple-500/30 bg-black/95 backdrop-blur-xl p-4 shadow-2xl shadow-purple-500/10">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-amber-500">
              <span className="text-lg font-black text-white">FF</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white">Install FreedomForge</p>
              <p className="text-xs text-zinc-400">Add to your home screen for instant access</p>
            </div>
            <button
              onClick={handleInstall}
              className="shrink-0 rounded-xl bg-gradient-to-r from-purple-600 to-amber-500 px-4 py-2 text-xs font-bold text-white"
            >
              Install
            </button>
            <button onClick={handleDismiss} className="shrink-0 text-zinc-500 hover:text-white text-lg">
              ×
            </button>
          </div>
        </div>
      </div>
    );
  }

  // iOS Safari prompt
  if (showIOSPrompt) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-lg animate-slide-up">
        <div className="rounded-2xl border border-purple-500/30 bg-black/95 backdrop-blur-xl p-5 shadow-2xl shadow-purple-500/10">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-amber-500">
              <span className="text-lg font-black text-white">FF</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-white">Install FreedomForge on iPhone</p>
              <div className="mt-2 space-y-1.5 text-xs text-zinc-300">
                <p className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold">1</span>
                  Tap the <span className="inline-flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 font-mono">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                    Share</span> button
                </p>
                <p className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold">2</span>
                  Scroll down and tap <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-semibold">Add to Home Screen</span>
                </p>
                <p className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold">3</span>
                  Tap <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-semibold">Add</span> — done!
                </p>
              </div>
            </div>
            <button onClick={handleDismiss} className="shrink-0 text-zinc-500 hover:text-white text-lg">
              ×
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
