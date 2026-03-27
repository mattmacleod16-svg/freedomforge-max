/**
 * FreedomForge Guardians — Guardian Manager
 *
 * Singleton registry that spawns, tracks, and coordinates all GuardianAgents.
 * Aggregates alerts and exposes a status snapshot for the dashboard.
 */

import { GuardianAgent, MetricFetcher } from './guardian-agent';
import { GuardianAlert, GuardianConfig, GuardianStatus } from '@/lib/types';

export interface GuardianSnapshot {
  id: string;
  name: string;
  capability: string;
  status: GuardianStatus;
  alertCount: number;
  lastAlert: GuardianAlert | null;
}

class GuardianManagerClass {
  private agents: Map<string, GuardianAgent> = new Map();
  private globalAlertLog: GuardianAlert[] = [];

  /**
   * Register and immediately start watching a new guardian.
   * If a guardian with the same id already exists it is returned as-is.
   */
  register(
    config: GuardianConfig,
    fetchMetric: MetricFetcher,
  ): GuardianAgent {
    if (this.agents.has(config.id)) {
      return this.agents.get(config.id)!;
    }

    const agent = new GuardianAgent(config, fetchMetric, alert => {
      this.globalAlertLog.push(alert);
      if (this.globalAlertLog.length > 500) this.globalAlertLog.shift();
    });

    agent.watch();
    this.agents.set(config.id, agent);
    return agent;
  }

  /** Stop and remove a guardian by id. */
  unregister(id: string): void {
    const agent = this.agents.get(id);
    if (agent) {
      agent.stop();
      this.agents.delete(id);
    }
  }

  getAgent(id: string): GuardianAgent | undefined {
    return this.agents.get(id);
  }

  /** Snapshot of all currently registered guardians. */
  getStatus(): GuardianSnapshot[] {
    return Array.from(this.agents.values()).map(agent => {
      const history = agent.getAlertHistory();
      return {
        id: agent.id,
        name: agent.config.name,
        capability: agent.config.capability,
        status: agent.getStatus(),
        alertCount: history.length,
        lastAlert: history[history.length - 1] ?? null,
      };
    });
  }

  /** All alerts across all guardians, newest first. */
  getGlobalAlerts(limit = 50): GuardianAlert[] {
    return this.globalAlertLog.slice(-limit).reverse();
  }

  /**
   * Return (or create) a system-health guardian scoped to a specific user.
   * Provides the user-centric API: `guardianManager.getGuardian(userId)`.
   */
  getGuardian(userId: string): GuardianAgent {
    const key = `user-${userId}`;
    const existing = this.agents.get(key);
    if (existing) return existing;
    return this.register(
      {
        id:             key,
        name:           `user-guardian-${userId}`,
        capability:     'system-health',
        intervalMs:     60_000,
        alertThreshold: 10,
      },
      async () => 0,
    );
  }

  /** Stop all guardians (e.g. on server shutdown). */
  shutdownAll(): void {
    for (const agent of this.agents.values()) {
      agent.stop();
    }
    this.agents.clear();
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const GuardianManager = new GuardianManagerClass();
