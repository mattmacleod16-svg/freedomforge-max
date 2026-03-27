/**
 * FreedomForge DeviceForge — Hybrid BCI Adapter
 *
 * Abstracts multiple BCI hardware sources (EEG, EMG, eye-tracking, gyro)
 * into a unified BCISignal stream. Normalizes raw device output and
 * emits confidence-scored signals for downstream fusion.
 */

import { BCIDeviceType, BCISignal } from '@/lib/types';

export interface BCIAdapterConfig {
  deviceType: BCIDeviceType;
  channelCount: number;
  sampleRateHz: number;
  /** Optional hardware endpoint (e.g. USB path, BLE address, WebSocket URL) */
  endpoint?: string;
}

type AdapterState = 'disconnected' | 'connecting' | 'connected' | 'error';

export class HybridBCIAdapter {
  private config: BCIAdapterConfig;
  private state: AdapterState = 'disconnected';
  private lastSignal: BCISignal | null = null;

  constructor(config: BCIAdapterConfig) {
    this.config = config;
  }

  get deviceType(): BCIDeviceType {
    return this.config.deviceType;
  }

  get isConnected(): boolean {
    return this.state === 'connected';
  }

  async connect(): Promise<void> {
    this.state = 'connecting';
    // In production this would open a USB/BLE/WebSocket connection.
    // Here we simulate a 20ms handshake delay.
    await delay(20);
    this.state = 'connected';
  }

  async disconnect(): Promise<void> {
    this.state = 'disconnected';
    this.lastSignal = null;
  }

  /**
   * Read one signal frame from the device.
   * Returns a normalized BCISignal with per-channel amplitudes and
   * frequency band power estimates derived from the device type.
   */
  async readSignal(): Promise<BCISignal> {
    if (this.state !== 'connected') {
      throw new Error(`HybridBCIAdapter [${this.config.deviceType}]: not connected`);
    }

    const channels = this.sampleChannels();
    const frequencyBands = this.estimateFrequencyBands(channels);
    const confidence = this.estimateConfidence(channels, frequencyBands);

    const signal: BCISignal = {
      deviceType: this.config.deviceType,
      channels,
      frequencyBands,
      confidence,
      timestampMs: Date.now(),
    };

    this.lastSignal = signal;
    return signal;
  }

  getLastSignal(): BCISignal | null {
    return this.lastSignal;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Sample normalized channel amplitudes.
   * In production, this reads from the device SDK / driver buffer.
   */
  private sampleChannels(): number[] {
    return Array.from({ length: this.config.channelCount }, () =>
      clamp(gaussianNoise(0.5, 0.15), 0, 1)
    );
  }

  /**
   * Estimate EEG frequency band powers from channel data.
   * For non-EEG devices, a simplified proxy is computed.
   */
  private estimateFrequencyBands(channels: number[]): BCISignal['frequencyBands'] {
    const mean = channels.reduce((s, v) => s + v, 0) / channels.length;

    if (this.config.deviceType === 'eeg') {
      // Simplified band estimation — in production use FFT on raw samples
      return {
        delta: clamp(mean * 0.9 + gaussianNoise(0, 0.05), 0, 1),
        theta: clamp(mean * 0.7 + gaussianNoise(0, 0.05), 0, 1),
        alpha: clamp(mean * 1.1 + gaussianNoise(0, 0.05), 0, 1),
        beta:  clamp(mean * 0.8 + gaussianNoise(0, 0.05), 0, 1),
        gamma: clamp(mean * 0.5 + gaussianNoise(0, 0.05), 0, 1),
      };
    }

    // Proxy for EMG / eye-tracking / gyro: uniform estimate
    return {
      delta: mean,
      theta: mean,
      alpha: mean,
      beta:  mean,
      gamma: mean,
    };
  }

  /** Confidence is higher when channel variance is low (clean signal). */
  private estimateConfidence(channels: number[], bands: BCISignal['frequencyBands']): number {
    const mean = channels.reduce((s, v) => s + v, 0) / channels.length;
    const variance = channels.reduce((s, v) => s + (v - mean) ** 2, 0) / channels.length;
    // Low variance → high confidence
    const base = clamp(1 - variance * 4, 0.1, 1);
    // EEG alpha power boost
    const alphaPower = this.config.deviceType === 'eeg' ? (bands?.alpha ?? 0) : 0;
    return clamp(base + alphaPower * 0.1, 0, 1);
  }
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Box-Muller approximate Gaussian noise */
function gaussianNoise(mean: number, std: number): number {
  const u = Math.random(), v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u + 1e-10)) * Math.cos(2 * Math.PI * v);
  return mean + z * std;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/** Create a default EEG adapter suitable for standard 8-channel headsets. */
export function createDefaultEEGAdapter(): HybridBCIAdapter {
  return new HybridBCIAdapter({
    deviceType: 'eeg',
    channelCount: 8,
    sampleRateHz: 256,
  });
}
