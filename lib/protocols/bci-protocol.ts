/**
 * FreedomForge Master Protocols — BCI Protocol
 *
 * Routes raw BCI signals through the full decoding pipeline:
 * bciAdapter.decodeIntent() → qmlEngine.classifyBCIIntent()
 * Returns a combined IntentVector + QML classification.
 */

import { bciAdapter }      from '@/lib/deviceforge/hybrid-bci-adapter';
import { qmlEngine }       from '@/lib/quantum-forge/qml-engine';
import { RawBCIData, UserProfile, IntentVector } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type BCIProtocolKind = 'bci';

export interface BCIProtocolPayload {
  rawSignals: RawBCIData;
  userId?:    string;
  profile?:   UserProfile;
}

export interface BCIProtocolResult extends IntentVector {
  qmlIntent:      string;
  qmlConfidence:  number;
  userId:         string;
}

export interface BCIHealthStatus {
  protocol:  BCIProtocolKind;
  enabled:   boolean;
  healthy:   boolean | null;
  latencyMs: number | null;
  details:   string;
}

type Envelope<T> = { id: string; protocol: BCIProtocolKind; ts: number; payload: T };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextId() {
  return `bci_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Packet factory ───────────────────────────────────────────────────────────

export function buildBCIPacket(payload: BCIProtocolPayload): Envelope<BCIProtocolPayload> {
  return { id: nextId(), protocol: 'bci', ts: Date.now(), payload };
}

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function executeBCIProtocol(
  payload: BCIProtocolPayload,
): Promise<BCIProtocolResult> {
  const zkIntent = await bciAdapter.decodeIntent(payload.rawSignals, payload.profile);

  const channels = payload.rawSignals.neuralinkSpikes
    ?? payload.rawSignals.synchronLfps
    ?? [];
  const qml = qmlEngine.classifyBCIIntent(channels);

  return {
    ...zkIntent,
    qmlIntent:     qml.intent,
    qmlConfidence: qml.confidence,
    userId:        payload.userId ?? 'anonymous',
  };
}

// ─── Health check ─────────────────────────────────────────────────────────────

export async function checkBCIProtocolHealth(): Promise<BCIHealthStatus> {
  const start = Date.now();
  try {
    await bciAdapter.decodeIntent({ neuralinkSpikes: [0.5, 0.5, 0.5, 0.5] });
    return {
      protocol:  'bci',
      enabled:   true,
      healthy:   true,
      latencyMs: Date.now() - start,
      details:   'bciAdapter decode round-trip OK',
    };
  } catch (err) {
    return {
      protocol:  'bci',
      enabled:   true,
      healthy:   false,
      latencyMs: Date.now() - start,
      details:   err instanceof Error ? err.message : 'BCI health check failed',
    };
  }
}
