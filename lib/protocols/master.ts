/**
 * FreedomForge Master Protocols — Orchestrator
 *
 * Priority-ordered protocol registry and router:
 *   1. guardian      — peaceful watchdog (highest priority)
 *   2. bci           — brain-computer interface
 *   3. meta          — meta-learning + policy evolution
 *   4. quantum       — QAOA + QML simulation
 *   5. niche-startup — luxury AI startup generator
 *   6. happiness     — user fulfillment engine
 *   7. forge         — FORGE methodology pipeline
 *   8. acp/mcp/a2a/aui — agent communication protocols
 *   9. adapters      — blockchain / RPC health (lowest priority)
 */

import {
  executeGuardianProtocol,
  checkGuardianProtocolHealth,
  GuardianProtocolPayload,
  GuardianHealthStatus,
} from './guardian-protocol';

import {
  executeBCIProtocol,
  checkBCIProtocolHealth,
  BCIProtocolPayload,
  BCIHealthStatus,
} from './bci-protocol';

import {
  executeMetaProtocol,
  checkMetaProtocolHealth,
  MetaProtocolPayload,
  MetaHealthStatus,
} from './meta-protocol';

import {
  executeQuantumProtocol,
  checkQuantumProtocolHealth,
  QuantumProtocolPayload,
  QuantumHealthStatus,
} from './quantum-protocol';

import {
  executeNicheStartupProtocol,
  checkNicheStartupProtocolHealth,
  NicheStartupProtocolPayload,
  NicheStartupHealthStatus,
} from './niche-startup-protocol';

import {
  executeHappinessProtocol,
  checkHappinessProtocolHealth,
  HappinessProtocolPayload,
  HappinessHealthStatus,
} from './happiness-protocol';

import {
  executeForgeProtocol,
  checkForgeProtocolHealth,
  ForgeProtocolPayload,
  ForgeHealthStatus,
} from './forge-protocol';

import { getAgentProtocolStatuses } from './agentProtocols';
import { getProtocolStatuses }      from './adapters';
import { GuardianManager }          from '@/lib/guardians/guardian-manager';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MasterProtocolKind =
  | 'guardian'
  | 'bci'
  | 'meta'
  | 'quantum'
  | 'niche-startup'
  | 'happiness'
  | 'forge';

type AnyHealthStatus =
  | GuardianHealthStatus
  | BCIHealthStatus
  | MetaHealthStatus
  | QuantumHealthStatus
  | NicheStartupHealthStatus
  | HappinessHealthStatus
  | ForgeHealthStatus
  | { protocol: string; enabled: boolean; healthy: boolean | null; latencyMs: number | null; details: string };

export interface MasterStatus {
  initialized: boolean;
  protocols:   AnyHealthStatus[];
  timestamp:   number;
}

type ProtocolPayloadMap = {
  guardian:      GuardianProtocolPayload;
  bci:           BCIProtocolPayload;
  meta:          MetaProtocolPayload;
  quantum:       QuantumProtocolPayload;
  'niche-startup': NicheStartupProtocolPayload;
  happiness:     HappinessProtocolPayload;
  forge:         ForgeProtocolPayload;
};

// ─── Orchestrator ─────────────────────────────────────────────────────────────

class MasterProtocolOrchestrator {
  private initialized = false;
  private lastStatus:  AnyHealthStatus[] = [];

  async initialize(): Promise<AnyHealthStatus[]> {
    const [
      guardian,
      bci,
      meta,
      quantum,
      nicheStartup,
      happiness,
      forge,
      agentStatuses,
      adapterStatuses,
    ] = await Promise.all([
      checkGuardianProtocolHealth(),
      checkBCIProtocolHealth(),
      checkMetaProtocolHealth(),
      checkQuantumProtocolHealth(),
      checkNicheStartupProtocolHealth(),
      checkHappinessProtocolHealth(),
      checkForgeProtocolHealth(),
      getAgentProtocolStatuses(),
      getProtocolStatuses(),
    ]);

    this.lastStatus = [
      guardian,
      bci,
      meta,
      quantum,
      nicheStartup,
      happiness,
      forge,
      ...agentStatuses,
      ...adapterStatuses,
    ];
    this.initialized = true;
    return this.lastStatus;
  }

  async route<K extends MasterProtocolKind>(
    kind:    K,
    payload: ProtocolPayloadMap[K],
  ): Promise<unknown> {
    switch (kind) {
      case 'guardian':
        return executeGuardianProtocol(payload as GuardianProtocolPayload);
      case 'bci':
        return executeBCIProtocol(payload as BCIProtocolPayload);
      case 'meta':
        return executeMetaProtocol(payload as MetaProtocolPayload);
      case 'quantum':
        return executeQuantumProtocol(payload as QuantumProtocolPayload);
      case 'niche-startup':
        return executeNicheStartupProtocol(payload as NicheStartupProtocolPayload);
      case 'happiness':
        return executeHappinessProtocol(payload as HappinessProtocolPayload);
      case 'forge':
        return executeForgeProtocol(payload as ForgeProtocolPayload);
      default: {
        const _exhaustive: never = kind;
        throw new Error(`Unknown protocol kind: ${_exhaustive}`);
      }
    }
  }

  async getStatus(): Promise<MasterStatus> {
    if (!this.initialized) {
      await this.initialize();
    }
    return {
      initialized: this.initialized,
      protocols:   this.lastStatus,
      timestamp:   Date.now(),
    };
  }

  async shutdown(): Promise<void> {
    GuardianManager.shutdownAll();
    this.initialized = false;
    this.lastStatus  = [];
  }
}

export const masterProtocol = new MasterProtocolOrchestrator();
