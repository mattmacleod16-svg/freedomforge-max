'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  rot13,
  caesar,
  caesarDecode,
  vigenere,
  vigenereDecode,
  atbash,
  bruteForce,
  analyzeFrequency,
  CIPHER_ENCYCLOPEDIA,
  getAllCipherAlgorithms,
  type CipherAlgorithm,
  type CipherResult,
  type CipherAnalysis,
} from '@/lib/cipher';
import { DataMask, MaskFieldGroup, ShieldStatus } from '@/app/components/DataMask';

/* ─── Page ────────────────────────────────────────────────────────────────── */

export default function CipherLabPage() {
  const [activeTab, setActiveTab] = useState<'encode' | 'crack' | 'learn' | 'shield'>('encode');

  return (
    <div className="min-h-screen bg-gradient-to-br from-[var(--bg-void)] via-[var(--bg-deep)] to-[var(--bg-void)] cyber-grid-bg p-6 md:p-10">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Header */}
        <header className="glass-card rounded-3xl p-6 md:p-8 gold-accent-top">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-amber-400/80">Cryptographic Education Engine</p>
              <h1 className="mt-2 text-4xl font-black tracking-tight phoenix-title md:text-5xl">Cipher Lab</h1>
              <p className="mt-2 text-sm text-zinc-400">
                Explore classical ciphers, crack codes, and understand the foundations of modern encryption.
              </p>
            </div>
            <Link
              href="/"
              className="rounded-xl border border-zinc-700 bg-zinc-900/50 px-4 py-2 text-sm text-zinc-300 transition-all hover:border-purple-500/40 hover:text-white"
            >
              Back to MAX
            </Link>
          </div>
        </header>

        {/* Tab Navigation */}
        <nav className="flex gap-2 overflow-x-auto">
          {(['encode', 'crack', 'learn', 'shield'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                activeTab === tab
                  ? 'border border-purple-500/50 bg-purple-500/15 text-purple-300 shadow-lg shadow-purple-500/10'
                  : 'border border-zinc-800 bg-black/30 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
              }`}
            >
              {tab === 'encode' && 'Encode / Decode'}
              {tab === 'crack' && 'Crack & Analyze'}
              {tab === 'learn' && 'Cipher Academy'}
              {tab === 'shield' && 'Data Shield'}
            </button>
          ))}
        </nav>

        {/* Tab Content */}
        {activeTab === 'encode' && <EncodeDecodeTab />}
        {activeTab === 'crack' && <CrackTab />}
        {activeTab === 'learn' && <LearnTab />}
        {activeTab === 'shield' && <ShieldTab />}

        {/* Security Notice */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-xs text-amber-400/80">
            <span className="font-bold">SECURITY NOTICE:</span> Classical ciphers provide zero cryptographic security.
            FreedomForge uses HMAC-SHA256 for session authentication and industry-standard encryption for all sensitive data.
            This lab is for education and entertainment only.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Encode / Decode Tab ─────────────────────────────────────────────────── */

function EncodeDecodeTab() {
  const [input, setInput] = useState('');
  const [algorithm, setAlgorithm] = useState<CipherAlgorithm>('rot13');
  const [shift, setShift] = useState(13);
  const [vigenereKey, setVigenereKey] = useState('FORGE');
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');

  const result: CipherResult | null = useMemo(() => {
    if (!input) return null;
    try {
      if (mode === 'encode') {
        switch (algorithm) {
          case 'rot13': return rot13(input);
          case 'caesar': return caesar(input, shift);
          case 'vigenere': return vigenere(input, vigenereKey);
          case 'atbash': return atbash(input);
        }
      } else {
        switch (algorithm) {
          case 'rot13': return rot13(input); // self-inverse
          case 'caesar': return caesarDecode(input, shift);
          case 'vigenere': return vigenereDecode(input, vigenereKey);
          case 'atbash': return atbash(input); // self-inverse
        }
      }
    } catch {
      return null;
    }
  }, [input, algorithm, shift, vigenereKey, mode]);

  return (
    <div className="space-y-6">
      {/* Input Section */}
      <div className="glass-card rounded-2xl p-6">
        <h2 className="mb-4 text-lg font-bold text-white">Input</h2>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter text to encode or decode..."
          className="w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 font-mono text-sm text-white outline-none focus:border-purple-500 placeholder:text-zinc-600"
          rows={3}
        />

        {/* Controls */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {/* Algorithm */}
          <select
            value={algorithm}
            onChange={(e) => setAlgorithm(e.target.value as CipherAlgorithm)}
            className="rounded-lg border border-zinc-700 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
          >
            <option value="rot13">ROT13</option>
            <option value="caesar">Caesar (ROT-N)</option>
            <option value="vigenere">Vigenère</option>
            <option value="atbash">Atbash</option>
          </select>

          {/* Mode Toggle */}
          <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
            <button
              onClick={() => setMode('encode')}
              className={`px-3 py-2 text-xs font-medium transition-all ${
                mode === 'encode' ? 'bg-purple-500/20 text-purple-300' : 'bg-black/30 text-zinc-500'
              }`}
            >
              ENCODE
            </button>
            <button
              onClick={() => setMode('decode')}
              className={`px-3 py-2 text-xs font-medium transition-all ${
                mode === 'decode' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-black/30 text-zinc-500'
              }`}
            >
              DECODE
            </button>
          </div>

          {/* Shift (Caesar only) */}
          {algorithm === 'caesar' && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500">Shift:</label>
              <input
                type="number"
                min={1}
                max={25}
                value={shift}
                onChange={(e) => setShift(parseInt(e.target.value) || 1)}
                className="w-16 rounded-lg border border-zinc-700 bg-black/50 px-2 py-2 text-center text-sm text-white outline-none focus:border-purple-500"
              />
            </div>
          )}

          {/* Key (Vigenère only) */}
          {algorithm === 'vigenere' && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500">Key:</label>
              <input
                type="text"
                value={vigenereKey}
                onChange={(e) => setVigenereKey(e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase())}
                placeholder="KEYWORD"
                className="w-28 rounded-lg border border-zinc-700 bg-black/50 px-2 py-2 text-center font-mono text-sm text-white outline-none focus:border-purple-500"
              />
            </div>
          )}
        </div>
      </div>

      {/* Output Section */}
      {result && (
        <div className="glass-card rounded-2xl p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">Result</h2>
            <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-xs text-purple-300">
              {result.algorithm.toUpperCase()} {typeof result.key === 'number' ? `+${result.key}` : ''}
            </span>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 font-mono text-sm text-emerald-400 break-all">
            {result.output}
          </div>

          {/* Step-by-step breakdown */}
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
              Step-by-step breakdown ({result.steps.length} characters)
            </summary>
            <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-zinc-800 bg-black/40">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500">
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Input</th>
                    <th className="px-3 py-2 text-center">Shift</th>
                    <th className="px-3 py-2 text-left">Output</th>
                  </tr>
                </thead>
                <tbody>
                  {result.steps.map((step, i) => (
                    <tr key={i} className="border-b border-zinc-800/50">
                      <td className="px-3 py-1.5 text-zinc-600">{step.position}</td>
                      <td className="px-3 py-1.5 font-mono text-amber-400">{step.inputChar === ' ' ? '␣' : step.inputChar}</td>
                      <td className="px-3 py-1.5 text-center text-zinc-500">{step.shift > 0 ? `+${step.shift}` : '—'}</td>
                      <td className="px-3 py-1.5 font-mono text-emerald-400">{step.outputChar === ' ' ? '␣' : step.outputChar}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

/* ─── Crack & Analyze Tab ─────────────────────────────────────────────────── */

function CrackTab() {
  const [input, setInput] = useState('');
  const [showBrute, setShowBrute] = useState(false);

  const analysis: CipherAnalysis | null = useMemo(() => {
    if (!input || input.length < 2) return null;
    return analyzeFrequency(input);
  }, [input]);

  const bruteResults: CipherResult[] = useMemo(() => {
    if (!showBrute || !input) return [];
    return bruteForce(input);
  }, [input, showBrute]);

  // English letter frequency for comparison
  const englishFreq: Record<string, number> = {
    E: 12.7, T: 9.1, A: 8.2, O: 7.5, I: 7.0, N: 6.7, S: 6.3,
    H: 6.1, R: 6.0, D: 4.3, L: 4.0, C: 2.8, U: 2.8, M: 2.4,
  };

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-6">
        <h2 className="mb-4 text-lg font-bold text-white">Ciphertext Input</h2>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste encrypted text here to analyze..."
          className="w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 font-mono text-sm text-white outline-none focus:border-purple-500 placeholder:text-zinc-600"
          rows={3}
        />
      </div>

      {/* Frequency Analysis */}
      {analysis && (
        <div className="glass-card rounded-2xl p-6">
          <h2 className="mb-4 text-lg font-bold text-white">Frequency Analysis</h2>

          <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatBox label="Entropy" value={analysis.entropy.toFixed(3)} unit="bits" />
            <StatBox label="Most Common" value={analysis.mostCommon} />
            <StatBox label="Least Common" value={analysis.leastCommon} />
            <StatBox
              label="Assessment"
              value={analysis.isLikelyEncrypted ? 'Encrypted' : 'Plaintext'}
              color={analysis.isLikelyEncrypted ? 'text-amber-400' : 'text-emerald-400'}
            />
          </div>

          {/* Frequency Bars */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-zinc-500 mb-2">
              <div className="h-2 w-4 rounded bg-purple-500/60" /> Input
              <div className="ml-3 h-2 w-4 rounded bg-amber-500/40" /> English
            </div>
            {Object.entries(analysis.letterFrequency)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 15)
              .map(([letter, freq]) => (
                <div key={letter} className="flex items-center gap-2">
                  <span className="w-4 font-mono text-xs text-zinc-400">{letter}</span>
                  <div className="flex-1 space-y-0.5">
                    <div
                      className="h-2 rounded bg-purple-500/60 transition-all"
                      style={{ width: `${Math.min(freq * 5, 100)}%` }}
                    />
                    {englishFreq[letter] !== undefined && (
                      <div
                        className="h-1 rounded bg-amber-500/40"
                        style={{ width: `${Math.min(englishFreq[letter] * 5, 100)}%` }}
                      />
                    )}
                  </div>
                  <span className="w-14 text-right font-mono text-xs text-zinc-500">{freq.toFixed(1)}%</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Brute Force */}
      {input && (
        <div className="glass-card rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white">Brute Force (All 25 Shifts)</h2>
            <button
              onClick={() => setShowBrute((prev) => !prev)}
              className="rounded-xl border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-sm text-purple-300 transition-all hover:bg-purple-500/20"
            >
              {showBrute ? 'Hide Results' : 'Run Brute Force'}
            </button>
          </div>
          {showBrute && bruteResults.length > 0 && (
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {bruteResults.map((r, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg border border-zinc-800/60 bg-black/30 px-3 py-2"
                >
                  <span className="w-12 shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-center font-mono text-xs text-zinc-400">
                    +{(i + 1).toString().padStart(2, '0')}
                  </span>
                  <span className="flex-1 font-mono text-sm text-zinc-300 break-all">{r.output}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Cipher Academy Tab ──────────────────────────────────────────────────── */

function LearnTab() {
  const [selectedCipher, setSelectedCipher] = useState<CipherAlgorithm | null>(null);
  const selected = CIPHER_ENCYCLOPEDIA.find((c) => c.algorithm === selectedCipher);

  return (
    <div className="space-y-6">
      {/* Cipher Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {CIPHER_ENCYCLOPEDIA.map((cipher) => (
          <button
            key={cipher.algorithm}
            onClick={() => setSelectedCipher(selectedCipher === cipher.algorithm ? null : cipher.algorithm)}
            className={`rounded-2xl border p-5 text-left transition-all ${
              selectedCipher === cipher.algorithm
                ? 'border-purple-500/50 bg-purple-500/10 shadow-lg shadow-purple-500/10'
                : 'border-zinc-800 bg-black/30 hover:border-zinc-700'
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">{cipher.name}</h3>
                <p className="mt-1 text-xs text-zinc-500">{cipher.yearInvented} — {cipher.inventor}</p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  cipher.strength === 'none'
                    ? 'border border-red-500/30 bg-red-500/10 text-red-400'
                    : cipher.strength === 'trivial'
                    ? 'border border-amber-500/30 bg-amber-500/10 text-amber-400'
                    : cipher.strength === 'weak'
                    ? 'border border-yellow-500/30 bg-yellow-500/10 text-yellow-400'
                    : 'border border-blue-500/30 bg-blue-500/10 text-blue-400'
                }`}
              >
                {cipher.strength.toUpperCase()}
              </span>
            </div>
            <p className="mt-3 text-sm text-zinc-400">{cipher.description}</p>
          </button>
        ))}
      </div>

      {/* Selected Cipher Detail */}
      {selected && (
        <div className="glass-card rounded-2xl p-6 space-y-6">
          <h2 className="text-xl font-bold phoenix-title">{selected.name} — Deep Dive</h2>

          {/* How It Works */}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-purple-400">How It Works</h3>
            <ol className="space-y-2">
              {selected.howItWorks.map((step, i) => (
                <li key={i} className="flex gap-3 text-sm text-zinc-300">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-500/20 text-xs font-bold text-purple-300">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          {/* Key Space */}
          <div className="flex gap-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-zinc-500">Key Space</p>
              <p className="mt-1 font-mono text-sm text-amber-400">{selected.keySpace}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-zinc-500">Modern Equivalent</p>
              <p className="mt-1 text-sm text-emerald-400">{selected.modernEquivalent}</p>
            </div>
          </div>

          {/* Fun Fact */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-500">Fun Fact</p>
            <p className="mt-1 text-sm text-amber-200/80">{selected.funFact}</p>
          </div>

          {/* Timeline Bridge */}
          <div className="rounded-xl border border-zinc-800 bg-black/40 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-purple-400 mb-3">From Ancient to Modern</p>
            <div className="flex items-center gap-2 text-xs">
              <span className="rounded bg-red-500/20 px-2 py-1 text-red-300">{selected.name}</span>
              <span className="text-zinc-600">→</span>
              <span className="text-zinc-500">{selected.strength} security</span>
              <span className="text-zinc-600">→</span>
              <span className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-300">{selected.modernEquivalent}</span>
              <span className="text-zinc-600">→</span>
              <span className="text-emerald-400">production-grade</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Data Shield Tab ─────────────────────────────────────────────────────── */

function ShieldTab() {
  const [shieldActive, setShieldActive] = useState(true);

  const demoFields = [
    { label: 'Wallet', value: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18', mode: 'middle' as const, sensitive: true },
    { label: 'API Key', value: 'sk-proj-Wn8kP2mX9vL4qR7j', mode: 'tail' as const, sensitive: true },
    { label: 'Session', value: 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoibWF0dCJ9', mode: 'full' as const, sensitive: true },
    { label: 'Email', value: 'matt@freedomforge.one', mode: 'middle' as const },
    { label: 'Account', value: 'ACCT-2847593', mode: 'tail' as const },
    { label: 'TX Hash', value: '0xabc123def456789abcdef0123456789abcdef012', mode: 'middle' as const },
  ];

  return (
    <div className="space-y-6">
      {/* Shield Controls */}
      <div className="glass-card rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-white">Data Shield</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Protect sensitive data with display-level obfuscation. Tap to reveal individual fields.
            </p>
          </div>
          <ShieldStatus active={shieldActive} />
        </div>

        {/* Individual Masked Fields */}
        <div className="space-y-3 mb-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Individual Fields</h3>
          <DataMask label="Wallet" value="0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18" mode="middle" sensitive />
          <DataMask label="Balance" value="$12,847.93" mode="full" />
          <DataMask label="API Key" value="sk-live-Wn8kP2mX9vL4qR7j" mode="tail" sensitive />
        </div>
      </div>

      {/* Grouped Fields */}
      <div className="glass-card rounded-2xl p-6">
        <h2 className="mb-4 text-lg font-bold text-white">Grouped Data Shield</h2>
        <p className="mb-4 text-sm text-zinc-400">
          Reveal or mask all fields at once for quick dashboard access.
        </p>
        <MaskFieldGroup fields={demoFields} />
      </div>

      {/* Masking Modes Explained */}
      <div className="glass-card rounded-2xl p-6">
        <h2 className="mb-4 text-lg font-bold text-white">Masking Modes</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {[
            { mode: 'tail', name: 'Tail Reveal', desc: 'Shows only the last N characters', example: '••••••••bD18' },
            { mode: 'middle', name: 'Bookend Reveal', desc: 'Shows first and last N characters', example: '0x74••••••••f012' },
            { mode: 'rot13', name: 'ROT13 Scramble', desc: 'Applies ROT13 cipher to the value', example: 'Uryyb Jbeyq' },
            { mode: 'full', name: 'Full Mask', desc: 'Completely hides the value', example: '••••••••••••' },
          ].map(({ mode, name, desc, example }) => (
            <div key={mode} className="rounded-xl border border-zinc-800 bg-black/30 p-4">
              <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-mono text-purple-300">{mode}</span>
              <h3 className="mt-2 text-sm font-semibold text-white">{name}</h3>
              <p className="mt-1 text-xs text-zinc-500">{desc}</p>
              <p className="mt-2 font-mono text-xs text-zinc-400">{example}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Utility Components ──────────────────────────────────────────────────── */

function StatBox({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-black/30 p-3 text-center">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${color || 'text-white'}`}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-zinc-500">{unit}</span>}
      </p>
    </div>
  );
}
