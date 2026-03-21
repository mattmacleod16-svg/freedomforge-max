'use client';

import { useState, useCallback, useMemo } from 'react';
import { obfuscateDisplay, obfuscateMiddle, rot13 } from '@/lib/cipher';

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type MaskMode = 'tail' | 'middle' | 'rot13' | 'full';

interface DataMaskProps {
  value: string;
  mode?: MaskMode;
  visibleChars?: number;
  label?: string;
  sensitive?: boolean;
  className?: string;
}

interface MaskFieldGroupProps {
  fields: Array<{
    label: string;
    value: string;
    mode?: MaskMode;
    sensitive?: boolean;
  }>;
  className?: string;
}

/* ─── Single Masked Field ─────────────────────────────────────────────────── */

export function DataMask({
  value,
  mode = 'tail',
  visibleChars = 4,
  label,
  sensitive = false,
  className = '',
}: DataMaskProps) {
  const [revealed, setRevealed] = useState(false);

  const maskedValue = useMemo(() => {
    if (revealed) return value;
    switch (mode) {
      case 'tail':
        return obfuscateDisplay(value, visibleChars);
      case 'middle':
        return obfuscateMiddle(value, visibleChars);
      case 'rot13':
        return rot13(value).output;
      case 'full':
        return '\u2022'.repeat(Math.min(value.length, 16));
      default:
        return obfuscateDisplay(value, visibleChars);
    }
  }, [value, mode, visibleChars, revealed]);

  const toggle = useCallback(() => {
    setRevealed((prev) => !prev);
  }, []);

  return (
    <div className={`group flex items-center gap-3 ${className}`}>
      {label && (
        <span className="text-xs uppercase tracking-wider text-zinc-500">{label}</span>
      )}
      <div className="flex flex-1 items-center gap-2 rounded-lg border border-zinc-800 bg-black/40 px-3 py-2">
        <span
          className={`flex-1 font-mono text-sm transition-all duration-300 ${
            revealed
              ? sensitive
                ? 'text-amber-400'
                : 'text-emerald-400'
              : 'text-zinc-400'
          }`}
        >
          {maskedValue}
        </span>
        <button
          onClick={toggle}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-400 transition-all hover:border-purple-500/40 hover:text-purple-300"
          aria-label={revealed ? 'Hide value' : 'Reveal value'}
        >
          {revealed ? 'HIDE' : 'SHOW'}
        </button>
      </div>
      {sensitive && revealed && (
        <span className="animate-pulse text-xs text-amber-500">EXPOSED</span>
      )}
    </div>
  );
}

/* ─── Grouped Masked Fields ───────────────────────────────────────────────── */

export function MaskFieldGroup({ fields, className = '' }: MaskFieldGroupProps) {
  const [allRevealed, setAllRevealed] = useState(false);

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${allRevealed ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
          <span className="text-xs uppercase tracking-wider text-zinc-500">
            {allRevealed ? 'Data Exposed' : 'Data Protected'}
          </span>
        </div>
        <button
          onClick={() => setAllRevealed((prev) => !prev)}
          className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-400 transition-all hover:border-purple-500/40 hover:text-purple-300"
        >
          {allRevealed ? 'MASK ALL' : 'REVEAL ALL'}
        </button>
      </div>
      {fields.map((field) => (
        <MaskFieldItem
          key={field.label}
          label={field.label}
          value={field.value}
          mode={field.mode}
          sensitive={field.sensitive}
          forceRevealed={allRevealed}
        />
      ))}
    </div>
  );
}

/* ─── Internal Field Item (supports group override) ───────────────────────── */

function MaskFieldItem({
  label,
  value,
  mode = 'tail',
  sensitive = false,
  forceRevealed = false,
}: {
  label: string;
  value: string;
  mode?: MaskMode;
  sensitive?: boolean;
  forceRevealed?: boolean;
}) {
  const maskedValue = useMemo(() => {
    if (forceRevealed) return value;
    switch (mode) {
      case 'tail':
        return obfuscateDisplay(value);
      case 'middle':
        return obfuscateMiddle(value);
      case 'rot13':
        return rot13(value).output;
      case 'full':
        return '\u2022'.repeat(Math.min(value.length, 16));
      default:
        return obfuscateDisplay(value);
    }
  }, [value, mode, forceRevealed]);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800/60 bg-black/30 px-3 py-2">
      <span className="w-28 shrink-0 text-xs uppercase tracking-wider text-zinc-500">{label}</span>
      <span
        className={`flex-1 font-mono text-sm transition-all duration-300 ${
          forceRevealed
            ? sensitive
              ? 'text-amber-400'
              : 'text-emerald-400'
            : 'text-zinc-400'
        }`}
      >
        {maskedValue}
      </span>
      {sensitive && forceRevealed && (
        <span className="animate-pulse text-xs text-amber-500">SENSITIVE</span>
      )}
    </div>
  );
}

/* ─── Shield Status Indicator ─────────────────────────────────────────────── */

export function ShieldStatus({ active }: { active: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        className={active ? 'text-emerald-400' : 'text-red-400'}
      >
        <path
          d="M8 1L2 4v4c0 3.3 2.6 6.4 6 7 3.4-.6 6-3.7 6-7V4L8 1z"
          fill="currentColor"
          opacity={0.2}
        />
        <path
          d="M8 1L2 4v4c0 3.3 2.6 6.4 6 7 3.4-.6 6-3.7 6-7V4L8 1z"
          stroke="currentColor"
          strokeWidth="1.2"
          fill="none"
        />
        {active && (
          <path d="M5.5 8L7 9.5L10.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
      <span className={`text-xs font-medium ${active ? 'text-emerald-400' : 'text-red-400'}`}>
        {active ? 'SHIELDED' : 'EXPOSED'}
      </span>
    </div>
  );
}
