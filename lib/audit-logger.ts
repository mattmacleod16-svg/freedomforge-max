/**
 * audit-logger.ts
 * ═══════════════════════════════════════════════════════════════════
 * Structured mutation audit trail for FreedomForge Max.
 *
 * Fulfils the X-Audit-Required contract set by middleware.ts —
 * when a mutation endpoint is tagged, the route handler should call
 * logAuditEvent() to persist an immutable record.
 *
 * Storage:
 *   - Appends JSONL to data/audit.log via resilient-io (atomic writes)
 *   - Publishes 'audit_event' signal to agent-signal-bus
 *   - Sends Discord alert for HIGH severity events
 *
 * IP Privacy:
 *   - IPs are one-way hashed (SHA-256) before storage
 *
 * Usage (in API route handler):
 *   import { logAuditEvent } from '@/lib/audit-logger';
 *
 *   await logAuditEvent({
 *     endpoint: '/api/alchemy/wallet/withdraw',
 *     method: 'POST',
 *     ip: request.headers.get('x-forwarded-for') || '0.0.0.0',
 *     user: session?.username || 'anonymous',
 *     result: 'success',
 *     detail: { amount: '0.1 ETH', to: '0xabc…' },
 *   });
 */

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuditResult = 'success' | 'failure' | 'denied' | 'rate_limited';
export type AuditSeverity = 'info' | 'warning' | 'high';

export interface AuditEvent {
  endpoint: string;
  method: string;
  ip: string;
  user: string;
  result: AuditResult;
  severity?: AuditSeverity;
  detail?: Record<string, unknown>;
}

interface AuditRecord extends AuditEvent {
  ts: string;
  ipHash: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AUDIT_LOG = path.resolve(
  process.cwd(),
  process.env.PERSISTENT_STORAGE_PATH || 'data',
  'audit.log'
);

const SEVERITY_MAP: Record<string, AuditSeverity> = {
  '/api/alchemy/wallet/withdraw': 'high',
  '/api/alchemy/wallet/distribute': 'high',
  '/api/sync': 'info',
  '/api/status/integrity': 'warning',
  '/api/status/skills': 'info',
};

// ─── Optional dependencies (graceful degradation) ────────────────────────────

let rio: { appendLine?: (p: string, s: string) => void } | null = null;
try {
  rio = require('./resilient-io') as typeof rio;
} catch { /* use fs fallback */ }

let bus: { publish?: (signal: Record<string, unknown>) => void } | null = null;
try {
  bus = require('./agent-signal-bus') as typeof bus;
} catch { /* optional */ }

// ─── IP Hashing ──────────────────────────────────────────────────────────────

function hashIp(ip: string): string {
  const salt = process.env.DASHBOARD_SESSION_SECRET || 'ff-audit-salt';
  return crypto.createHmac('sha256', salt).update(ip).digest('hex').slice(0, 16);
}

// ─── Ensure data directory ────────────────────────────────────────────────────

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  }
}

// ─── Discord Alert for HIGH severity ─────────────────────────────────────────

async function sendHighSeverityAlert(record: AuditRecord): Promise<void> {
  const webhook = process.env.ALERT_WEBHOOK_URL || process.env.DISCORD_ALERT_WEBHOOK;
  if (!webhook) return;

  const color = record.result === 'success' ? 15844367 : 15158332; // orange or red
  const body = {
    embeds: [{
      title: `🔐 HIGH Audit Event — ${record.method} ${record.endpoint}`,
      color,
      fields: [
        { name: 'Result', value: record.result, inline: true },
        { name: 'User', value: record.user || 'anonymous', inline: true },
        { name: 'IP Hash', value: record.ipHash, inline: true },
        { name: 'Detail', value: record.detail ? JSON.stringify(record.detail).slice(0, 200) : '—', inline: false },
      ],
      timestamp: record.ts,
      footer: { text: 'FreedomForge Audit Logger' },
    }],
  };

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* non-blocking */ }
}

// ─── Core: logAuditEvent ──────────────────────────────────────────────────────

export async function logAuditEvent(event: AuditEvent): Promise<void> {
  const severity = event.severity ?? SEVERITY_MAP[event.endpoint] ?? 'info';

  const record: AuditRecord = {
    ts: new Date().toISOString(),
    endpoint: event.endpoint,
    method: event.method,
    ipHash: hashIp(event.ip),
    user: event.user,
    result: event.result,
    severity,
    ...(event.detail ? { detail: event.detail } : {}),
  };

  const line = JSON.stringify(record);

  // Write to audit.log
  try {
    ensureDir(AUDIT_LOG);
    if (rio?.appendLine) {
      rio.appendLine(AUDIT_LOG, line);
    } else {
      fs.appendFileSync(AUDIT_LOG, line + '\n', 'utf8');
    }
  } catch { /* never let audit logging break the request */ }

  // Publish to signal bus
  try {
    bus?.publish?.({
      type: 'audit_event',
      source: 'audit-logger',
      confidence: 1.0,
      payload: record,
    });
  } catch { /* optional */ }

  // Alert on high-severity events
  if (severity === 'high') {
    void sendHighSeverityAlert(record);
  }
}

// ─── Convenience: buildAuditContext ──────────────────────────────────────────

/**
 * Extract audit context from a Next.js request and session.
 * Usage: const ctx = buildAuditContext(request, session);
 *        await logAuditEvent({ ...ctx, endpoint: '/api/...', result: 'success' });
 */
export function buildAuditContext(
  request: { headers: { get: (k: string) => string | null }; method: string },
  session?: { username?: string } | null
): Pick<AuditEvent, 'ip' | 'user' | 'method'> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '0.0.0.0';

  return {
    ip,
    user: session?.username || 'anonymous',
    method: request.method,
  };
}
