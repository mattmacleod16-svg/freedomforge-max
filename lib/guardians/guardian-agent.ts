/**
 * FreedomForge Guardians — Guardian Agent
 *
 * A peaceful watchdog that monitors one specific capability domain
 * (trading limits, AI budget, wallet balance, risk thresholds, etc.)
 * and emits structured alerts when thresholds are crossed.
 *
 * Reuses severity classification from lib/guarddog.ts.
 */

import { classifySeverity } from '@/lib/guarddog';
import {
  GuardianConfig,
  GuardianAlert,
  GuardianStatus,
} from '@/lib/types';

export type { GuardianConfig, GuardianAlert, GuardianStatus };

export type MetricFetcher = () => Promise<number>;

export class GuardianAgent {
  readonly config: GuardianConfig;
  private status: GuardianStatus = 'idle';
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private alertHistory: GuardianAlert[] = [];
  private fetchMetric: MetricFetcher;
  private onAlert: (alert: GuardianAlert) => void;

  constructor(
    config: GuardianConfig,
    fetchMetric: MetricFetcher,
    onAlert: (alert: GuardianAlert) => void = () => {},
  ) {
    this.config = config;
    this.fetchMetric = fetchMetric;
    this.onAlert = onAlert;
  }

  get id(): string {
    return this.config.id;
  }

  getStatus(): GuardianStatus {
    return this.status;
  }

  getAlertHistory(): GuardianAlert[] {
    return [...this.alertHistory];
  }

  /** Start periodic monitoring. */
  watch(): void {
    if (this.status === 'watching') return;
    this.status = 'watching';
    this.intervalHandle = setInterval(() => {
      this.runCheck().catch(err => {
        // Classify the error and only log non-silent ones
        const sev = classifySeverity(err instanceof Error ? err : new Error(String(err)));
        if (sev !== 'silent') {
          console.error(`[Guardian:${this.config.id}] check error (${sev}):`, err);
        }
      });
    }, this.config.intervalMs);
  }

  /** Stop monitoring and clean up. */
  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.status = 'offline';
  }

  /** Mark the most recent alert as resolved. */
  resolve(): void {
    if (this.status === 'alerted') {
      this.status = 'watching';
    }
  }

  /** Run a single check cycle (also callable directly for testing). */
  async runCheck(): Promise<GuardianAlert | null> {
    let value: number;
    try {
      value = await this.fetchMetric();
    } catch {
      return null;
    }

    if (value <= this.config.alertThreshold) return null;

    const severity = this.determineSeverity(value);

    const alert: GuardianAlert = {
      guardianId: this.config.id,
      capability: this.config.capability,
      severity,
      message: `[${this.config.name}] ${this.config.capability} value ${value.toFixed(2)} exceeded threshold ${this.config.alertThreshold}`,
      value,
      threshold: this.config.alertThreshold,
      timestamp: Date.now(),
    };

    this.alertHistory.push(alert);
    // Keep history bounded
    if (this.alertHistory.length > 100) {
      this.alertHistory.shift();
    }

    this.status = 'alerted';
    this.onAlert(alert);
    return alert;
  }

  /**
   * Watch a raw BCI signal and trigger a happiness gift if the intent
   * carries a negative fulfillment delta.
   * Uses dynamic imports to avoid circular module resolution at load time.
   */
  async watchAndProtect(signals: unknown): Promise<void> {
    const { bciAdapter }     = await import('@/lib/deviceforge/hybrid-bci-adapter');
    const { happinessForge } = await import('@/lib/happinessforge/happiness-engine');
    const intent = await bciAdapter.decodeIntent(signals as import('@/lib/types').RawBCIData);
    if ((intent.fulfillmentDelta ?? 0) < 0) {
      await happinessForge.giftFulfillment({ userId: this.config.id });
    }
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private determineSeverity(value: number): GuardianAlert['severity'] {
    const ratio = value / this.config.alertThreshold;
    if (ratio >= 2.0) return 'critical';
    if (ratio >= 1.5) return 'warning';
    return 'info';
  }
}
