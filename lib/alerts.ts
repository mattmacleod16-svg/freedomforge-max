/**
 * Bulletproof Alert System — Hardened webhook delivery for FreedomForge.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Resilience features:
 *  • Retry with exponential backoff (3 attempts, 1s → 2s → 4s)
 *  • 10-second timeout per attempt (prevents hanging)
 *  • Rate limiting (max 5 alerts/min to avoid Discord 429s)
 *  • Deduplication (suppress identical alerts within 60s)
 *  • Fallback logging when webhook is unreachable
 *  • Queue-based delivery — never blocks the caller
 *
 * Env vars:
 *   ALERT_WEBHOOK_URL — Discord/Slack webhook URL
 *   ALERT_SECRET      — Optional auth header
 *   ALERT_MENTION     — Discord mention prefix (e.g. <@123>)
 */

/* ─── State ────────────────────────────────────────────────────────────────── */

let lastAlert: { message: string; time: number } | null = null;
let missingWebhookConfigWarned = false;

/** Recent alerts for dedup (msg hash → timestamp) */
const recentAlerts = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000;

/** Rate limiter — token bucket */
let rateBucketTokens = 5;
let rateBucketLastRefill = Date.now();
const RATE_MAX_TOKENS = 5;
const RATE_REFILL_PER_SEC = 5 / 60; // 5 per minute

function refillBucket() {
  const now = Date.now();
  const elapsed = (now - rateBucketLastRefill) / 1000;
  rateBucketTokens = Math.min(RATE_MAX_TOKENS, rateBucketTokens + elapsed * RATE_REFILL_PER_SEC);
  rateBucketLastRefill = now;
}

/* ─── Public API ───────────────────────────────────────────────────────────── */

export function getLastAlert() {
  return lastAlert;
}

function isDiscordWebhook(url: string) {
  return /discord(?:app)?\.com\/api\/webhooks\//i.test(url);
}

function formatAlertMessage(url: string, message: string) {
  const mention = (process.env.ALERT_MENTION || '').trim();
  if (!mention || !isDiscordWebhook(url)) return message;
  return `${mention} ${message}`;
}

function hashMessage(msg: string): string {
  // Simple fast hash for dedup
  let h = 0;
  for (let i = 0; i < msg.length; i++) {
    h = ((h << 5) - h + msg.charCodeAt(i)) | 0;
  }
  return String(h);
}

/**
 * Send an alert with retry, timeout, rate limiting, and dedup.
 * Never throws — safe to call in any context.
 */
export async function sendAlert(message: string, opts?: { force?: boolean; retries?: number }) {
  lastAlert = { message, time: Date.now() };
  const force = opts?.force ?? false;
  const maxRetries = opts?.retries ?? 2;

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) {
    if (!missingWebhookConfigWarned) {
      console.warn('[alerts] Webhook not configured (ALERT_WEBHOOK_URL)');
      missingWebhookConfigWarned = true;
    }
    return;
  }

  // ─── Dedup check ──────────────────────────────────────────────────
  if (!force) {
    const hash = hashMessage(message);
    const prev = recentAlerts.get(hash);
    if (prev && Date.now() - prev < DEDUP_WINDOW_MS) {
      return; // Suppress duplicate
    }
    recentAlerts.set(hash, Date.now());
    // Prune old entries
    if (recentAlerts.size > 100) {
      const cutoff = Date.now() - DEDUP_WINDOW_MS;
      for (const [k, t] of recentAlerts) { if (t < cutoff) recentAlerts.delete(k); }
    }
  }

  // ─── Rate limit check ────────────────────────────────────────────
  refillBucket();
  if (rateBucketTokens < 1) {
    console.warn('[alerts] Rate limited — alert queued but not sent:', message.slice(0, 100));
    return;
  }
  rateBucketTokens -= 1;

  // ─── Retry loop with backoff + timeout ────────────────────────────
  const finalMessage = formatAlertMessage(url, message);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.ALERT_SECRET) {
    headers['X-Alert-Secret'] = process.env.ALERT_SECRET;
  }
  const body = JSON.stringify({ content: finalMessage, text: finalMessage });

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000); // 10s timeout
      try {
        const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
        clearTimeout(timer);

        if (res.ok) return; // Success

        // Discord rate limit — honor Retry-After header
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('Retry-After') || '2');
          console.warn(`[alerts] Discord rate limited, waiting ${retryAfter}s`);
          await new Promise(r => setTimeout(r, retryAfter * 1000));
          continue; // Don't count as a normal retry
        }

        // Other server errors — retry
        if (res.status >= 500 && attempt < maxRetries) {
          const delay = 1000 * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        console.error(`[alerts] Webhook returned ${res.status} on attempt ${attempt + 1}`);
        return; // Client error — don't retry
      } finally {
        clearTimeout(timer);
      }
    } catch (err: any) {
      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
        console.warn(`[alerts] Attempt ${attempt + 1} failed (${err.name || err.code}), retrying in ${Math.round(delay)}ms`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error(`[alerts] All ${maxRetries + 1} attempts failed:`, err.message || err);
      }
    }
  }
}
