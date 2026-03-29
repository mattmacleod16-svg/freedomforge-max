/**
 * FreedomForge Master Protocols — Guardian Protocol
 *
 * Coordinates peaceful watchdog agents through a typed protocol envelope.
 * Actions: watch (passive monitor), alert (trigger alert), resolve (clear alert).
 */

import { GuardianManager } from '@/lib/guardians/guardian-manager';
import { RawBCIData } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type GuardianProtocolKind = 'guardian';

export interface GuardianProtocolPayload {
  userId:   string;
  signals?: RawBCIData;
  action:   'watch' | 'alert' | 'resolve';
}

export interface GuardianProtocolResult {
  userId:     string;
  action:     GuardianProtocolPayload['action'];
  status:     string;
  alertCount: number;
}

export interface GuardianHealthStatus {
  protocol:      GuardianProtocolKind;
  enabled:       boolean;
  healthy:       boolean | null;
  latencyMs:     number | null;
  details:       string;
  activeGuardians?: number;
}

type Envelope<T> = { id: string; protocol: GuardianProtocolKind; ts: number; payload: T };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextId() {
  return `guardian_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Packet factory ───────────────────────────────────────────────────────────

export function buildGuardianPacket(
  payload: GuardianProtocolPayload,
): Envelope<GuardianProtocolPayload> {
  return { id: nextId(), protocol: 'guardian', ts: Date.now(), payload };
}

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function executeGuardianProtocol(
  payload: GuardianProtocolPayload,
): Promise<GuardianProtocolResult> {
  const guardian = GuardianManager.getGuardian(payload.userId);

  switch (payload.action) {
    case 'watch':
      if (payload.signals !== undefined) {
        await guardian.watchAndProtect(payload.signals);
      }
      break;
    case 'alert':
      await guardian.runCheck();
      break;
    case 'resolve':
      guardian.resolve();
      break;
  }

  return {
    userId:     payload.userId,
    action:     payload.action,
    status:     guardian.getStatus(),
    alertCount: guardian.getAlertHistory().length,
  };
}

// ─── Health check ─────────────────────────────────────────────────────────────

export async function checkGuardianProtocolHealth(): Promise<GuardianHealthStatus> {
  const start = Date.now();
  const snapshot = GuardianManager.getStatus();
  return {
    protocol:        'guardian',
    enabled:         true,
    healthy:         true,
    latencyMs:       Date.now() - start,
    details:         `${snapshot.length} guardian(s) active`,
    activeGuardians: snapshot.length,
  };
}
