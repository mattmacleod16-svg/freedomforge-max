/**
 * error-telemetry.ts
 * ═══════════════════════════════════════════════════════════════════
 * Centralized error capture and telemetry routing for FreedomForge Max.
 *
 * Bridges the gap between local JSONL logging and actionable alerts.
 * Routes errors to:
 *   1. Existing logger (structured JSONL)
 *   2. alerting-bus (Discord webhook for ≥ warning severity)
 *   3. agent-signal-bus (cross-agent awareness)
 *
 * Provides `withErrorTelemetry()` — a wrapper for Next.js API route
 * handlers that catches unhandled exceptions and reports them.
 *
 * Usage:
 *   import { captureError, withErrorTelemetry } from '@/lib/error-telemetry';
 *
 *   // In any async context:
 *   captureError(err, { context: 'trading-engine', endpoint: '/api/trading' });
 *
 *   // Wrap a route handler:
 *   export const POST = withErrorTelemetry(async (req) => { ... });
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface ErrorContext {
  context?: string;
  endpoint?: string;
  userId?: string;
  extra?: Record<string, unknown>;
}

// ─── Optional dependencies (graceful degradation) ────────────────────────────

let alertingBus: {
  publish?: (alert: {
    severity: string;
    title: string;
    message: string;
    channels?: string[];
    dedupKey?: string;
  }) => void;
} | null = null;
try {
  alertingBus = require('./alerting-bus') as typeof alertingBus;
} catch { /* optional */ }

let signalBus: { publish?: (s: Record<string, unknown>) => void } | null = null;
try {
  signalBus = require('./agent-signal-bus') as typeof signalBus;
} catch { /* optional */ }

let logger: { error?: (msg: string, meta?: unknown) => void; warn?: (msg: string, meta?: unknown) => void } | null = null;
try {
  const { createLogger } = require('./logger') as { createLogger: (n: string) => typeof logger };
  logger = createLogger('error-telemetry');
} catch { /* optional */ }

// ─── Rate-limiting duplicate alerts ──────────────────────────────────────────

const recentErrors = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000; // suppress identical error within 1 minute

function shouldSuppress(key: string): boolean {
  const last = recentErrors.get(key);
  if (last && Date.now() - last < DEDUP_WINDOW_MS) return true;
  recentErrors.set(key, Date.now());
  // Bounded map — evict oldest entries when large
  if (recentErrors.size > 200) {
    const first = recentErrors.keys().next().value;
    if (first) recentErrors.delete(first);
  }
  return false;
}

// ─── Core: captureError ───────────────────────────────────────────────────────

/**
 * Capture an error and route it to all configured telemetry channels.
 * Never throws — telemetry must never break the application.
 */
export function captureError(
  err: unknown,
  ctx: ErrorContext = {},
  severity: ErrorSeverity = 'error'
): void {
  try {
    const error = err instanceof Error ? err : new Error(String(err));
    const message = error.message || 'Unknown error';
    const stack = error.stack || '';
    const dedupKey = `${ctx.context || ''}:${message}`.slice(0, 120);
    const suppressed = shouldSuppress(dedupKey);

    const meta = {
      severity,
      context: ctx.context,
      endpoint: ctx.endpoint,
      userId: ctx.userId,
      extra: ctx.extra,
      stack: stack.split('\n').slice(0, 5).join(' | '),
      ts: new Date().toISOString(),
    };

    // 1. Local logger
    if (severity === 'error' || severity === 'critical') {
      logger?.error?.(message, meta);
    } else {
      logger?.warn?.(message, meta);
    }

    if (suppressed) return;

    // 2. Alerting bus (Discord)
    const alertSeverity = severity === 'critical' ? 'emergency' : severity === 'error' ? 'critical' : 'warning';
    alertingBus?.publish?.({
      severity: alertSeverity,
      title: `[${(ctx.context || 'api').toUpperCase()}] ${message.slice(0, 100)}`,
      message: `**Endpoint:** ${ctx.endpoint || 'unknown'}\n**Stack:** ${stack.split('\n')[1]?.trim() || '—'}\n**Severity:** ${severity}`,
      channels: ['log', 'discord'],
      dedupKey,
    });

    // 3. Signal bus (cross-agent awareness)
    signalBus?.publish?.({
      type: 'error_telemetry',
      source: 'error-telemetry',
      confidence: 1.0,
      payload: { message, severity, endpoint: ctx.endpoint, context: ctx.context, ts: meta.ts },
    });

  } catch { /* absorb all errors in telemetry */ }
}

// ─── withErrorTelemetry wrapper ───────────────────────────────────────────────

type RouteHandler = (req: NextRequest, ctx?: unknown) => Promise<Response>;

/**
 * Wraps a Next.js App Router handler to catch unhandled errors,
 * report them via captureError, and return a clean 500 JSON response.
 *
 * Usage:
 *   export const POST = withErrorTelemetry(async (req) => {
 *     // your handler
 *   }, { context: 'trading-execute', endpoint: '/api/trading/execute' });
 */
export function withErrorTelemetry(
  handler: RouteHandler,
  ctx: ErrorContext = {}
): RouteHandler {
  return async (req: NextRequest, routeCtx?: unknown): Promise<Response> => {
    try {
      return await handler(req, routeCtx);
    } catch (err) {
      captureError(err, {
        context: ctx.context || 'api-route',
        endpoint: ctx.endpoint || req.nextUrl?.pathname || 'unknown',
        extra: { method: req.method },
      });

      return NextResponse.json(
        { error: 'An unexpected error occurred', ts: new Date().toISOString() },
        { status: 500 }
      );
    }
  };
}

// ─── Global unhandled rejection handler (Node.js / Edge) ─────────────────────

/**
 * Call once at app startup (e.g., in app/layout.tsx or a server initializer)
 * to capture unhandled promise rejections that escape all try/catch.
 */
export function registerGlobalErrorHandlers(): void {
  if (typeof process !== 'undefined') {
    process.on('unhandledRejection', (reason) => {
      captureError(reason, { context: 'unhandled-rejection' }, 'critical');
    });
    process.on('uncaughtException', (err) => {
      captureError(err, { context: 'uncaught-exception' }, 'critical');
    });
  }
}
