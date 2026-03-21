/* ═══════════════════════════════════════════════════════════════
   GuardDog — FreedomForge Resilience & Error Prevention System
   ═══════════════════════════════════════════════════════════════

   Zero-failure-notification architecture:
   • Exponential backoff retry with jitter
   • Response cache for offline/degraded fallback
   • Error severity classification & toast filtering
   • Safe localStorage/JSON utilities
   • System health monitoring

   Usage:
     import { guardedFetch, safeGet } from '@/lib/guarddog';
     const data = await guardedFetch<MyType>('/api/data', {}, { fallback: [] });
   ═══════════════════════════════════════════════════════════════ */

export type Severity = 'critical' | 'warning' | 'info' | 'silent';

export interface GuardDogOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  fallback?: unknown;
  silent?: boolean;
}

/* ── Response Cache ─────────────────────────────────────────── */

const responseCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

/* ── Error Classification ───────────────────────────────────── */

export function classifySeverity(err: Error): Severity {
  const m = err.message.toLowerCase();
  if (m.includes('401') || m.includes('unauthorized') || m.includes('forbidden')) return 'critical';
  if (m.includes('429') || m.includes('rate limit') || m.includes('too many')) return 'warning';
  if (m.includes('network') || m.includes('abort') || m.includes('timeout') || m.includes('fetch')) return 'info';
  return 'silent';
}

export function shouldAlert(err: Error): boolean {
  return classifySeverity(err) === 'critical';
}

/* ── Helpers ─────────────────────────────────────────────────── */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const jitter = (ms: number) => ms + Math.random() * ms * 0.3;

/* ── Guarded Fetch ──────────────────────────────────────────── */

export async function guardedFetch<T = unknown>(
  url: string,
  init?: RequestInit,
  opts?: GuardDogOptions,
): Promise<T> {
  const {
    maxRetries = 2,
    retryDelayMs = 800,
    timeoutMs = 12000,
    fallback,
    silent = true,
  } = opts ?? {};

  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);

      if (res.status === 401) {
        if (typeof window !== 'undefined') {
          window.location.href = `/login?redirectTo=${encodeURIComponent(window.location.pathname)}`;
        }
        return (fallback as T) ?? ({} as T);
      }

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') ?? '3', 10) * 1000;
        await sleep(Math.min(retryAfter, 10000));
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as T;
      responseCache.set(url, { data, ts: Date.now() });
      return data;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxRetries) await sleep(jitter(retryDelayMs * 2 ** attempt));
    }
  }

  const cached = responseCache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data as T;
  if (fallback !== undefined) return fallback as T;
  if (!silent) console.warn(`[GuardDog] ${url} failed after ${maxRetries + 1} attempts:`, lastErr?.message);
  return {} as T;
}

/* ── Health Monitor ─────────────────────────────────────────── */

export async function healthCheck(): Promise<Record<string, boolean>> {
  const endpoints = ['/api/status', '/api/chat', '/api/vault', '/api/watchdog', '/api/trading'];
  const results: Record<string, boolean> = {};
  await Promise.allSettled(
    endpoints.map(async (ep) => {
      try {
        const res = await fetch(ep, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        results[ep] = res.ok;
      } catch {
        results[ep] = false;
      }
    }),
  );
  return results;
}

/* ── Safe Utilities ─────────────────────────────────────────── */

export function safeJsonParse<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function safeGet<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

export function safeSet(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota exceeded — silent */ }
}
