'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redirectTo, setRedirectTo] = useState('/dashboard');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next') || '/dashboard';
    setRedirectTo(next.startsWith('/') ? next : '/dashboard');
  }, []);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch('/api/auth/session', { cache: 'no-store' });
        const data = await res.json();
        if (data?.authenticated) {
          router.replace(redirectTo);
        }
      } catch {
        // no-op
      }
    };

    checkSession();
  }, [redirectTo, router]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || 'Login failed');
        return;
      }
      router.replace(redirectTo);
      router.refresh();
    } catch {
      setError('Unable to sign in. Please retry.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-zinc-950 to-black flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/70 backdrop-blur-sm p-7 shadow-2xl shadow-orange-500/10">
          <p className="text-xs uppercase tracking-[0.2em] text-orange-400/90">FreedomForge Max</p>
          <h1 className="mt-3 text-3xl font-black text-white">Dashboard Login</h1>
          <p className="mt-2 text-sm text-zinc-300">Secure session sign-in for operations controls and live revenue telemetry.</p>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-zinc-200">Username</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                required
                className="w-full rounded-xl border border-zinc-700 bg-black/40 px-4 py-3 text-white outline-none focus:border-orange-500"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-zinc-200">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                className="w-full rounded-xl border border-zinc-700 bg-black/40 px-4 py-3 text-white outline-none focus:border-orange-500"
              />
            </label>

            {error && <p className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-orange-600 px-4 py-3 font-bold text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 flex items-center justify-between text-xs text-zinc-400">
            <span>Session lasts up to 7 days and renews while active.</span>
            <Link href="/" className="text-orange-400 hover:text-orange-300">
              Back home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
