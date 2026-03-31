'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

export default function SignupPage() {
  const router = useRouter();
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name }) });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(data.error || 'Signup failed'); return; }
      router.replace('/onboarding');
    } catch { setError('Network error — please retry'); }
    finally   { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">⚡</div>
          <h1 className="text-3xl font-bold text-white">FreedomForge</h1>
          <p className="text-zinc-400 mt-2">Your autonomous income engine starts here</p>
        </div>

        <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-8">
          <div className="mb-6 p-4 bg-purple-900/20 border border-purple-500/30 rounded-xl text-sm text-purple-300">
            🎁 <strong>14-day free trial</strong> — full access, no credit card required
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Full Name</label>
              <input value={name} onChange={e => setName(e.target.value)} required placeholder="Your name" className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-purple-500 transition" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@email.com" className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-purple-500 transition" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Min 8 characters" minLength={8} className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-purple-500 transition" />
            </div>

            {error && <div className="text-red-400 text-sm bg-red-900/20 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}

            <button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-purple-600 to-amber-500 text-white font-bold rounded-xl py-3.5 text-sm hover:opacity-90 transition disabled:opacity-50 mt-2">
              {loading ? 'Creating account...' : 'Start Free Trial →'}
            </button>
          </form>

          <p className="text-center text-xs text-zinc-500 mt-5">
            Already have an account?{' '}
            <Link href="/login" className="text-purple-400 hover:text-purple-300">Sign in</Link>
          </p>
          <p className="text-center text-xs text-zinc-600 mt-3">
            By signing up you agree to our{' '}
            <Link href="/legal/terms" className="hover:text-zinc-400">Terms</Link>
            {' '}and{' '}
            <Link href="/legal/privacy" className="hover:text-zinc-400">Privacy Policy</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
