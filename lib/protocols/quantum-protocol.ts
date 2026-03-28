/**
 * FreedomForge Master Protocols — Quantum Protocol
 *
 * Routes quantum workloads to the appropriate QuantumForge engine:
 *   mode 'qaoa' → AdvancedQAOA.optimize()
 *   mode 'qml'  → QMLEngine.classifyBCIIntent()
 */

import { advancedQAOA, ProblemGraph } from '@/lib/quantum-forge/advanced-qaoa';
import { qmlEngine }                  from '@/lib/quantum-forge/qml-engine';

// ─── Types ────────────────────────────────────────────────────────────────────

type QuantumProtocolKind = 'quantum';

export interface QuantumProtocolPayload {
  mode:   'qaoa' | 'qml';
  input:  unknown;
  /** QAOA circuit depth (default 3) */
  p?:     number;
  /** Measurement shots (default 10 000) */
  shots?: number;
}

export interface QuantumProtocolResult {
  mode:   QuantumProtocolPayload['mode'];
  output: unknown;
}

export interface QuantumHealthStatus {
  protocol:  QuantumProtocolKind;
  enabled:   boolean;
  healthy:   boolean | null;
  latencyMs: number | null;
  details:   string;
  runtime:   'simulation';
}

type Envelope<T> = { id: string; protocol: QuantumProtocolKind; ts: number; payload: T };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextId() {
  return `quantum_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Packet factory ───────────────────────────────────────────────────────────

export function buildQuantumPacket(
  payload: QuantumProtocolPayload,
): Envelope<QuantumProtocolPayload> {
  return { id: nextId(), protocol: 'quantum', ts: Date.now(), payload };
}

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function executeQuantumProtocol(
  payload: QuantumProtocolPayload,
): Promise<QuantumProtocolResult> {
  if (payload.mode === 'qaoa') {
    const graph = payload.input as ProblemGraph ?? { nodes: 4, edges: [[0,1,1],[1,2,1],[2,3,1],[3,0,1]] };
    const output = advancedQAOA.optimize(graph, payload.p ?? 3, payload.shots ?? 10_000);
    return { mode: 'qaoa', output };
  }

  // qml
  const spikes = Array.isArray(payload.input)
    ? payload.input as number[]
    : [0.5, 0.5, 0.5, 0.5];
  const output = qmlEngine.classifyBCIIntent(spikes);
  return { mode: 'qml', output };
}

// ─── Health check ─────────────────────────────────────────────────────────────

export async function checkQuantumProtocolHealth(): Promise<QuantumHealthStatus> {
  const start = Date.now();
  advancedQAOA.optimize({ nodes: 2, edges: [[0, 1, 1]] }, 1, 100);
  return {
    protocol:  'quantum',
    enabled:   true,
    healthy:   true,
    latencyMs: Date.now() - start,
    details:   'QAOA + QML simulation engines operational',
    runtime:   'simulation',
  };
}
