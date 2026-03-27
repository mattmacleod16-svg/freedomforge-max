'use client';

/**
 * /bci-test — BCI Decode API Test Page
 *
 * Browser UI to simulate BCI signals and test the /api/bci/decode endpoint.
 * Sliders let you adjust per-band power values; the decoded intent and
 * confidence are shown after each request.
 */

import { useState } from 'react';
import type { BCIDecodeResult } from '@/lib/types';

const BANDS = ['delta', 'theta', 'alpha', 'beta', 'gamma'] as const;
type Band = typeof BANDS[number];

interface SliderValues {
  delta: number;
  theta: number;
  alpha: number;
  beta:  number;
  gamma: number;
}

const DEFAULT_SLIDERS: SliderValues = {
  delta: 0.2,
  theta: 0.3,
  alpha: 0.5,
  beta:  0.4,
  gamma: 0.2,
};

export default function BCITestPage() {
  const [sliders, setSliders]   = useState<SliderValues>(DEFAULT_SLIDERS);
  const [result, setResult]     = useState<BCIDecodeResult | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  function setSlider(band: Band, value: number) {
    setSliders((prev: SliderValues) => ({ ...prev, [band]: value }));
  }

  async function runDecode() {
    setLoading(true);
    setError(null);
    setResult(null);

    // Build a synthetic EEG signal from the slider values
    const signal = {
      deviceType:    'eeg',
      channels:      Object.values(sliders),
      frequencyBands: { ...sliders },
      confidence:    0.75,
      timestampMs:   Date.now(),
    };

    try {
      const res = await fetch('/api/bci/decode', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ signals: [signal] }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as BCIDecodeResult;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const intentColor: Record<string, string> = {
    focus:   'text-blue-400',
    relax:   'text-green-400',
    command: 'text-yellow-400',
    idle:    'text-gray-400',
    unknown: 'text-red-400',
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8 font-mono">
      <h1 className="text-2xl font-bold mb-1">BCI Decode Test</h1>
      <p className="text-gray-400 text-sm mb-8">
        Adjust EEG frequency band powers and decode intent via{' '}
        <code className="text-blue-300">/api/bci/decode</code>
      </p>

      {/* Sliders */}
      <section className="bg-gray-900 rounded-xl p-6 mb-6 max-w-lg">
        <h2 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-wider">
          Frequency Bands
        </h2>
        {BANDS.map(band => (
          <div key={band} className="flex items-center gap-4 mb-3">
            <label className="w-12 text-xs text-gray-400 capitalize">{band}</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={sliders[band]}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSlider(band, parseFloat(e.target.value))}
              className="flex-1 accent-blue-500"
            />
            <span className="w-10 text-right text-xs text-gray-300">
              {sliders[band].toFixed(2)}
            </span>
          </div>
        ))}
      </section>

      {/* Run button */}
      <button
        onClick={runDecode}
        disabled={loading}
        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-6 py-2 rounded-lg transition mb-8"
      >
        {loading ? 'Decoding…' : 'Decode Intent'}
      </button>

      {/* Error */}
      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg p-4 mb-6 max-w-lg">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Result */}
      {result && (
        <section className="bg-gray-900 rounded-xl p-6 max-w-lg">
          <h2 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-wider">
            Decode Result
          </h2>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-gray-400 text-sm">Intent:</span>
            <span className={`text-2xl font-bold capitalize ${intentColor[result.intent] ?? 'text-white'}`}>
              {result.intent}
            </span>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-gray-400 text-sm">Confidence:</span>
            <span className="text-white font-semibold">
              {(result.confidence * 100).toFixed(1)}%
            </span>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-gray-400 text-sm">Signals fused:</span>
            <span className="text-white">{result.signals.length}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-gray-400 text-sm">Processed at:</span>
            <span className="text-gray-300 text-xs">
              {new Date(result.processedAt).toISOString()}
            </span>
          </div>
        </section>
      )}
    </main>
  );
}
