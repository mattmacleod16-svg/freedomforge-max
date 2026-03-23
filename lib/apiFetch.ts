/**
 * apiFetch — thin client-side fetch wrapper for all FreedomForge API calls.
 *
 * Adds:
 *  - 10-second timeout by default (overridable)
 *  - 401 → redirect to /login preserving current URL as ?next=
 *  - 429 → throws RateLimitError with retryAfterMs from Retry-After header
 *  - Network / timeout errors rethrown with a clear message
 *
 * Usage:
 *   import { apiFetch } from '@/lib/apiFetch';
 *   const data = await apiFetch('/api/chat', { method: 'POST', body: JSON.stringify({...}) });
 */

export class RateLimitError extends Error {
  retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`Rate limited — retry in ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export interface ApiFetchOptions extends RequestInit {
  /** Timeout in ms. Default 10 000. Pass 0 to disable. */
  timeoutMs?: number;
  /** Skip the automatic 401 → /login redirect. Default false. */
  skipAuthRedirect?: boolean;
}

export async function apiFetch(url: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { timeoutMs = 10_000, skipAuthRedirect = false, signal: externalSignal, ...rest } = options;

  // Merge caller-supplied signal with timeout signal
  let signal: AbortSignal | undefined;
  if (timeoutMs > 0) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    if (externalSignal) {
      // Combine: abort if either fires
      const controller = new AbortController();
      const abort = () => controller.abort();
      timeoutSignal.addEventListener('abort', abort, { once: true });
      externalSignal.addEventListener('abort', abort, { once: true });
      signal = controller.signal;
    } else {
      signal = timeoutSignal;
    }
  } else {
    signal = externalSignal ?? undefined;
  }

  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal });
  } catch (err) {
    // AbortError from timeout
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error('Request timed out — please try again');
    }
    throw err;
  }

  // 401 → redirect to login
  if (res.status === 401 && !skipAuthRedirect && typeof window !== 'undefined') {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login?next=${next}`);
    // Return the response anyway so callers don't crash before redirect completes
    return res;
  }

  // 429 → throw RateLimitError
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60_000;
    throw new RateLimitError(retryAfterMs);
  }

  return res;
}
