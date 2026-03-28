/**
 * FreedomForge Master Protocols — Niche Startup Protocol
 *
 * Routes user intent through NicheStartupForge:
 * nicheStartupForge.generateAndLaunch(userIntent) → NicheBusinessPlan
 */

import { nicheStartupForge } from '@/lib/niche-startup-forge/niche-startup-generator';

// ─── Types ────────────────────────────────────────────────────────────────────

type NicheStartupProtocolKind = 'niche-startup';

export interface NicheStartupProtocolPayload {
  userIntent:   string;
  autoLaunch?:  boolean;
}

export interface NicheStartupProtocolResult {
  userIntent:   string;
  plan:         unknown;
  launched:     boolean;
}

export interface NicheStartupHealthStatus {
  protocol:   NicheStartupProtocolKind;
  enabled:    boolean;
  healthy:    boolean | null;
  latencyMs:  number | null;
  details:    string;
  rpcUrl?:    string;
}

type Envelope<T> = { id: string; protocol: NicheStartupProtocolKind; ts: number; payload: T };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextId() {
  return `niche_startup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Packet factory ───────────────────────────────────────────────────────────

export function buildNicheStartupPacket(
  payload: NicheStartupProtocolPayload,
): Envelope<NicheStartupProtocolPayload> {
  return { id: nextId(), protocol: 'niche-startup', ts: Date.now(), payload };
}

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function executeNicheStartupProtocol(
  payload: NicheStartupProtocolPayload,
): Promise<NicheStartupProtocolResult> {
  const launch = payload.autoLaunch !== false;
  const plan = await nicheStartupForge.generateAndLaunch(payload.userIntent);
  return {
    userIntent: payload.userIntent,
    plan,
    launched: launch,
  };
}

// ─── Health check ─────────────────────────────────────────────────────────────

export async function checkNicheStartupProtocolHealth(): Promise<NicheStartupHealthStatus> {
  const start  = Date.now();
  const rpcUrl = process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL;
  const healthy = Boolean(rpcUrl);
  return {
    protocol:  'niche-startup',
    enabled:   true,
    healthy,
    latencyMs: Date.now() - start,
    details:   healthy
      ? 'RPC_URL configured — on-chain launch enabled'
      : 'RPC_URL not set — on-chain launch will use simulation fallback',
    rpcUrl:    rpcUrl ? rpcUrl.slice(0, 20) + '...' : undefined,
  };
}
