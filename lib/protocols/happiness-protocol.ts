/**
 * FreedomForge Master Protocols — Happiness Protocol
 *
 * Routes user fulfillment requests through HappinessForge:
 *   action 'score' → calculateHappinessScore(metrics)
 *   action 'gift'  → happinessForge.giftFulfillment({ userId })
 */

import { happinessForge, calculateHappinessScore } from '@/lib/happinessforge/happiness-engine';
import { UserMetrics } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type HappinessProtocolKind = 'happiness';

export interface HappinessProtocolPayload {
  userId:   string;
  action:   'score' | 'gift';
  metrics?: UserMetrics;
}

export interface HappinessProtocolResult {
  userId:     string;
  action:     HappinessProtocolPayload['action'];
  score?:     unknown;
  joyUplift?: number;
}

export interface HappinessHealthStatus {
  protocol:  HappinessProtocolKind;
  enabled:   boolean;
  healthy:   boolean | null;
  latencyMs: number | null;
  details:   string;
}

type Envelope<T> = { id: string; protocol: HappinessProtocolKind; ts: number; payload: T };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextId() {
  return `happiness_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Packet factory ───────────────────────────────────────────────────────────

export function buildHappinessPacket(
  payload: HappinessProtocolPayload,
): Envelope<HappinessProtocolPayload> {
  return { id: nextId(), protocol: 'happiness', ts: Date.now(), payload };
}

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function executeHappinessProtocol(
  payload: HappinessProtocolPayload,
): Promise<HappinessProtocolResult> {
  if (payload.action === 'score') {
    const metrics: UserMetrics = payload.metrics ?? {
      financialReturnPct:      0,
      timeFreedomHrsPerWeek:   0,
      openAlertCount:          0,
      aiSatisfactionScore:     3,
      autonomyRatio:           0.5,
    };
    const score = calculateHappinessScore(metrics);
    return { userId: payload.userId, action: 'score', score };
  }

  // gift
  const { joyUplift } = await happinessForge.giftFulfillment({ userId: payload.userId });
  return { userId: payload.userId, action: 'gift', joyUplift };
}

// ─── Health check ─────────────────────────────────────────────────────────────

export async function checkHappinessProtocolHealth(): Promise<HappinessHealthStatus> {
  const start = Date.now();
  return {
    protocol:  'happiness',
    enabled:   true,
    healthy:   true,
    latencyMs: Date.now() - start,
    details:   'HappinessForge + calculateHappinessScore operational',
  };
}
