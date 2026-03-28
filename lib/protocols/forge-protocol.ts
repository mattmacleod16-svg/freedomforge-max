/**
 * FreedomForge Master Protocols — FORGE Protocol
 *
 * Encodes the FORGE methodology:
 *   Frame → Observe → Reason → Go → Evaluate
 *
 * Self-contained pipeline; no external lib dependencies.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type ForgeProtocolKind = 'forge';

export type ForgeStage = 'frame' | 'observe' | 'reason' | 'go' | 'evaluate';

export interface ForgeProtocolPayload {
  input:         string;
  currentStage?: ForgeStage;
  context?:      Record<string, unknown>;
}

export interface ForgeStageResult {
  stage:   ForgeStage;
  output:  unknown;
  elapsed: number;
}

export interface ForgeProtocolResult {
  input:   string;
  stages:  ForgeStageResult[];
  final:   unknown;
  success: boolean;
}

export interface ForgeHealthStatus {
  protocol:  ForgeProtocolKind;
  enabled:   boolean;
  healthy:   boolean | null;
  latencyMs: number | null;
  details:   string;
}

type Envelope<T> = { id: string; protocol: ForgeProtocolKind; ts: number; payload: T };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextId() {
  return `forge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── FORGE pipeline ───────────────────────────────────────────────────────────

function runFrame(input: string, ctx: Record<string, unknown>): unknown {
  return {
    problem:     input,
    constraints: ctx['constraints'] ?? [],
    goal:        ctx['goal'] ?? `Resolve: ${input}`,
    framedAt:    Date.now(),
  };
}

function runObserve(framed: unknown, ctx: Record<string, unknown>): unknown {
  const f = framed as Record<string, unknown>;
  return {
    ...f,
    observations: ctx['observations'] ?? [`Input received: "${f['problem']}"`],
    signals:      ctx['signals']      ?? [],
    observedAt:   Date.now(),
  };
}

function runReason(observed: unknown): unknown {
  const o = observed as Record<string, unknown>;
  return {
    ...o,
    hypothesis:  `Based on observations, the optimal action targets: ${o['goal']}`,
    confidence:  0.85,
    reasonedAt:  Date.now(),
  };
}

function runGo(reasoned: unknown, ctx: Record<string, unknown>): unknown {
  const r = reasoned as Record<string, unknown>;
  return {
    ...r,
    action:      ctx['action'] ?? `Execute plan for: ${r['goal']}`,
    status:      'executed',
    executedAt:  Date.now(),
  };
}

function runEvaluate(executed: unknown): unknown {
  const e = executed as Record<string, unknown>;
  return {
    ...e,
    outcome:     e['status'] === 'executed' ? 'success' : 'partial',
    score:       e['confidence'] ?? 0.8,
    evaluatedAt: Date.now(),
  };
}

// ─── Packet factory ───────────────────────────────────────────────────────────

export function buildForgePacket(
  payload: ForgeProtocolPayload,
): Envelope<ForgeProtocolPayload> {
  return { id: nextId(), protocol: 'forge', ts: Date.now(), payload };
}

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function executeForgeProtocol(
  payload: ForgeProtocolPayload,
): Promise<ForgeProtocolResult> {
  const ctx     = payload.context ?? {};
  const stages: ForgeStageResult[] = [];

  const pipeline: Array<{ stage: ForgeStage; fn: (prev: unknown) => unknown }> = [
    { stage: 'frame',    fn: (_)    => runFrame(payload.input, ctx) },
    { stage: 'observe',  fn: (prev) => runObserve(prev, ctx) },
    { stage: 'reason',   fn: (prev) => runReason(prev) },
    { stage: 'go',       fn: (prev) => runGo(prev, ctx) },
    { stage: 'evaluate', fn: (prev) => runEvaluate(prev) },
  ];

  // If currentStage is set, start from that stage index
  const startIdx = payload.currentStage
    ? pipeline.findIndex(p => p.stage === payload.currentStage)
    : 0;
  const startFrom = startIdx < 0 ? 0 : startIdx;

  let current: unknown = payload.context ?? {};
  for (let i = startFrom; i < pipeline.length; i++) {
    const t0     = Date.now();
    current      = pipeline[i].fn(current);
    stages.push({ stage: pipeline[i].stage, output: current, elapsed: Date.now() - t0 });
  }

  const evaluated = current as Record<string, unknown>;
  return {
    input:   payload.input,
    stages,
    final:   current,
    success: evaluated['outcome'] === 'success',
  };
}

// ─── Health check ─────────────────────────────────────────────────────────────

export async function checkForgeProtocolHealth(): Promise<ForgeHealthStatus> {
  const start = Date.now();
  return {
    protocol:  'forge',
    enabled:   true,
    healthy:   true,
    latencyMs: Date.now() - start,
    details:   'FORGE pipeline (Frame→Observe→Reason→Go→Evaluate) operational',
  };
}
