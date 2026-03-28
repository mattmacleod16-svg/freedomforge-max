// lib/guardians/guardian-agent.ts
import type { GuardianAlert, GuardianConfig, GuardianStatus } from '@/lib/types';

export type MetricFetcher = () => Promise<number>;
export type AlertHandler = (alert: GuardianAlert) => void;

export class GuardianAgent {
  public readonly id: string;
  public readonly config: GuardianConfig;

  private timer: NodeJS.Timeout | null = null;
  private alerts: GuardianAlert[] = [];
  private status: GuardianStatus = 'ok' as GuardianStatus; // adjust to your real union

  constructor(config: GuardianConfig, private fetchMetric: MetricFetcher, private onAlert: AlertHandler) {
    this.config = config;
    this.id = config.id;
  }

  watch(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.config.intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getStatus(): GuardianStatus {
    return this.status;
  }

  getAlertHistory(): GuardianAlert[] {
    return this.alerts;
  }

  private async tick(): Promise<void> {
    const value = await this.fetchMetric();
    if (value >= this.config.alertThreshold) {
      const alert: GuardianAlert = {
        // fill in required fields per your type definition
        // e.g. id/message/createdAt/severity/etc.
      } as GuardianAlert;

      this.alerts.push(alert);
      if (this.alerts.length > 200) this.alerts.shift();
      this.onAlert(alert);
      this.status = 'alert' as GuardianStatus; // adjust to your real union
    } else {
      this.status = 'ok' as GuardianStatus;
    }
  }
}
