/**
 * FreedomForge Master Protocols — Meta Protocol
 *
 * Orchestrates the meta-learning stack: ReptileAdapter fast-adaptation
 * followed by MetaMetaEngine policy evolution.
 */

import { ReptileAdapter }      from '@/lib/meta/meta-learning';
import { getMetaMetaEngine }   from '@/lib/meta/meta-meta-engine';

// ─── Types ────────────────────────────────────────────────────────────────────

type MetaProtocolKind = 'meta';

export interface MetaProtocolPayload {
  taskType: string;
  fused:    unknown;
  adapt?:   boolean; // if false, skip ReptileAdapter and go straight to evolve
}

export interface MetaProtocolResult {
  taskType:  string;
  adapted:   unknown;
  evolved:   unknown;
  bestConfig: Record<string, number>;
}

export interface MetaHealthStatus {
  protocol:      MetaProtocolKind;
  enabled:       boolean;
  healthy:       boolean | null;
  latencyMs:     number | null;
  details:       string;
  learnerCount?: number;
}

type Envelope<T> = { id: string; protocol: MetaProtocolKind; ts: number; payload: T };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextId() {
  return `meta_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Packet factory ───────────────────────────────────────────────────────────

export function buildMetaPacket(
  payload: MetaProtocolPayload,
): Envelope<MetaProtocolPayload> {
  return { id: nextId(), protocol: 'meta', ts: Date.now(), payload };
}

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function executeMetaProtocol(
  payload: MetaProtocolPayload,
): Promise<MetaProtocolResult> {
  const engine  = getMetaMetaEngine();
  engine.register(payload.taskType);

  const adapter = new ReptileAdapter();
  const adapted = payload.adapt !== false
    ? await adapter.adapt(payload.fused)
    : payload.fused;

  engine.evolve();
  const evolved = { ...(adapted as object), metaProtocolEvolved: true };

  const summary = engine.getSummary().find(s => s.taskType === payload.taskType);

  return {
    taskType:   payload.taskType,
    adapted,
    evolved,
    bestConfig: summary?.bestConfig ?? {},
  };
}

// ─── Health check ─────────────────────────────────────────────────────────────

export async function checkMetaProtocolHealth(): Promise<MetaHealthStatus> {
  const start   = Date.now();
  const engine  = getMetaMetaEngine();
  const summary = engine.getSummary();
  return {
    protocol:     'meta',
    enabled:      true,
    healthy:      true,
    latencyMs:    Date.now() - start,
    details:      `${summary.length} task type(s) registered in MetaMetaEngine`,
    learnerCount: summary.length,
  };
}
