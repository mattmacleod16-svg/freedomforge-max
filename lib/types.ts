/**
 * FreedomForge Max — Centralized Shared TypeScript Types
 *
 * All cross-module types live here. Individual modules may extend
 * these base types with implementation-specific interfaces.
 */

// ─── BCI / DeviceForge ────────────────────────────────────────────────────────

export type BCIDeviceType = 'eeg' | 'emg' | 'eyetracking' | 'gyro';

export interface BCISignal {
  deviceType: BCIDeviceType;
  /** Raw normalized amplitude values (0–1) per channel */
  channels: number[];
  /** Frequency band powers: delta, theta, alpha, beta, gamma */
  frequencyBands?: {
    delta: number;
    theta: number;
    alpha: number;
    beta: number;
    gamma: number;
  };
  confidence: number;
  timestampMs: number;
}

export type BCIIntent = 'focus' | 'relax' | 'command' | 'idle' | 'unknown';

export interface BCIDecodeResult {
  intent: BCIIntent;
  confidence: number;
  signals: BCISignal[];
  processedAt: number;
}

// ─── Guardians ────────────────────────────────────────────────────────────────

export type GuardianCapability =
  | 'trading'
  | 'ai-budget'
  | 'wallet'
  | 'risk'
  | 'rate-limit'
  | 'system-health';

export type GuardianStatus = 'idle' | 'watching' | 'alerted' | 'resolved' | 'offline';

export interface GuardianConfig {
  id: string;
  name: string;
  capability: GuardianCapability;
  /** Check interval in milliseconds */
  intervalMs: number;
  /** Threshold that triggers an alert (interpretation is capability-specific) */
  alertThreshold: number;
}

export interface GuardianAlert {
  guardianId: string;
  capability: GuardianCapability;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  timestamp: number;
}

// ─── HappinessForge ───────────────────────────────────────────────────────────

export interface UserMetrics {
  /** Portfolio return vs. baseline (-100 to +∞ %) */
  financialReturnPct: number;
  /** Estimated hours/week freed from manual tasks (0–168) */
  timeFreedomHrsPerWeek: number;
  /** Unresolved system alerts (lower = better) */
  openAlertCount: number;
  /** Average AI response satisfaction (1–5) */
  aiSatisfactionScore: number;
  /** Autonomy level: fraction of decisions handled automatically (0–1) */
  autonomyRatio: number;
}

export interface HappinessScore {
  total: number; // 0–100
  breakdown: {
    financialFreedom: number;
    timeFreedom: number;
    peaceOfMind: number;
  };
  suggestions: string[];
  timestamp: number;
}

// ─── Meta-Learning ────────────────────────────────────────────────────────────

export interface MetaEpisode {
  id: string;
  taskType: string;
  config: Record<string, number>;
  reward: number;
  durationMs: number;
  timestamp: number;
}

export interface MetaLearningState {
  episodes: MetaEpisode[];
  bestConfig: Record<string, number>;
  bestReward: number;
  totalEpisodes: number;
  lastUpdated: number;
}

// ─── OnchainStockForge ────────────────────────────────────────────────────────

export interface StockLaunchParams {
  companyName: string;
  ticker: string;
  totalShares: number;
  pricePerShareWei: bigint;
}

export interface OnchainCompanyInfo {
  contractAddress: string;
  companyName: string;
  ticker: string;
  totalShares: number;
  pricePerShareWei: bigint;
  owner: string;
  launchedAt: number;
}

// ─── Higher-level BCI / User types ───────────────────────────────────────────

export interface RawBCIData {
  neuralinkSpikes?: number[];
  synchronLfps?: number[];
}

export interface IntentVector {
  fusedIntent: unknown;
  confidence: number;
  zkProof?: string;
}

export interface UserProfile {
  userId: string;
  planetary?: 'earth' | 'lunar' | 'mars';
}
