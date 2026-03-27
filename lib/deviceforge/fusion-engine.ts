/**
 * FreedomForge DeviceForge — Signal Fusion Engine
 *
 * Fuses multiple parallel BCISignal streams (from different device types)
 * into a single BCIDecodeResult using weighted averaging with a simplified
 * Kalman filter for noise reduction.
 */

import { BCISignal, BCIDecodeResult, BCIIntent } from '@/lib/types';

// ─── Weights per device type ──────────────────────────────────────────────────

const DEVICE_WEIGHTS: Record<string, number> = {
  eeg:         0.50,
  emg:         0.25,
  eyetracking: 0.15,
  gyro:        0.10,
};

// ─── Kalman filter state (per channel index) ──────────────────────────────────

interface KalmanState {
  x: number; // estimate
  p: number; // error covariance
}

// ─── FusionEngine ─────────────────────────────────────────────────────────────

export class FusionEngine {
  private kalmanStates: Map<string, KalmanState[]> = new Map();

  /**
   * Fuse multiple BCISignals into a single BCIDecodeResult.
   * Signals from different device types are combined using pre-defined
   * weights and smoothed via a per-channel Kalman filter.
   */
  fuseBCISignals(signals: BCISignal[]): BCIDecodeResult {
    if (signals.length === 0) {
      return {
        intent: 'unknown',
        confidence: 0,
        signals: [],
        processedAt: Date.now(),
      };
    }

    // Normalize weights for the devices present in this batch
    const totalWeight = signals.reduce(
      (sum, s) => sum + (DEVICE_WEIGHTS[s.deviceType] ?? 0.1),
      0
    );

    // Weighted fused channels (use the max channel count present)
    const maxChannels = Math.max(...signals.map(s => s.channels.length));
    const fusedChannels = new Array(maxChannels).fill(0);

    // Weighted fused frequency bands
    let fusedDelta = 0, fusedTheta = 0, fusedAlpha = 0, fusedBeta = 0, fusedGamma = 0;
    let fusedConfidence = 0;

    for (const sig of signals) {
      const w = (DEVICE_WEIGHTS[sig.deviceType] ?? 0.1) / totalWeight;
      sig.channels.forEach((v, i) => { fusedChannels[i] += v * w; });
      fusedConfidence += sig.confidence * w;

      if (sig.frequencyBands) {
        fusedDelta += sig.frequencyBands.delta * w;
        fusedTheta += sig.frequencyBands.theta * w;
        fusedAlpha += sig.frequencyBands.alpha * w;
        fusedBeta  += sig.frequencyBands.beta  * w;
        fusedGamma += sig.frequencyBands.gamma * w;
      }
    }

    // Apply Kalman smoothing to fused channels
    const smoothedChannels = this.kalmanSmooth('fused', fusedChannels);

    const intent = this.classifyIntent({
      delta: fusedDelta,
      theta: fusedTheta,
      alpha: fusedAlpha,
      beta:  fusedBeta,
      gamma: fusedGamma,
    }, fusedConfidence);

    return {
      intent,
      confidence: fusedConfidence,
      signals,
      processedAt: Date.now(),
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Simplified scalar Kalman filter applied per channel.
   * Process noise Q=0.01, measurement noise R=0.1.
   */
  private kalmanSmooth(key: string, channels: number[]): number[] {
    const Q = 0.01; // process noise
    const R = 0.1;  // measurement noise

    if (!this.kalmanStates.has(key)) {
      this.kalmanStates.set(
        key,
        channels.map(v => ({ x: v, p: 1.0 }))
      );
    }

    const states = this.kalmanStates.get(key)!;

    // Grow state array if channel count increased
    while (states.length < channels.length) {
      states.push({ x: 0, p: 1.0 });
    }

    return channels.map((z, i) => {
      const s = states[i];
      // Predict
      const pPred = s.p + Q;
      // Update
      const K = pPred / (pPred + R);
      s.x = s.x + K * (z - s.x);
      s.p = (1 - K) * pPred;
      return s.x;
    });
  }

  /**
   * Classify intent based on dominant frequency band and confidence.
   *
   * Heuristics (EEG conventions):
   *   - High alpha + low beta  → relax
   *   - High beta  + high gamma → focus
   *   - High gamma             → command
   *   - Low confidence         → idle
   */
  private classifyIntent(
    bands: { delta: number; theta: number; alpha: number; beta: number; gamma: number },
    confidence: number
  ): BCIIntent {
    if (confidence < 0.3) return 'idle';

    const { alpha, beta, gamma } = bands;

    if (gamma > 0.6) return 'command';
    if (beta > 0.5 && gamma > 0.4) return 'focus';
    if (alpha > 0.5 && beta < 0.4) return 'relax';

    const dominant = Object.entries(bands).sort(([, a], [, b]) => b - a)[0][0];
    if (dominant === 'beta' || dominant === 'gamma') return 'focus';
    if (dominant === 'alpha' || dominant === 'theta') return 'relax';

    return 'idle';
  }

  /** Convenience wrapper: accepts raw unknown input and returns a simple intent/confidence pair. */
  async fuse(raw: unknown): Promise<{ fusedIntent: unknown; confidence: number }> {
    const signals = Array.isArray(raw) ? (raw as BCISignal[]) : [];
    const result = this.fuseBCISignals(signals);
    return { fusedIntent: result.intent, confidence: result.confidence };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: FusionEngine | null = null;

export function getFusionEngine(): FusionEngine {
  if (!_instance) _instance = new FusionEngine();
  return _instance;
}

/** Convenience wrapper for one-shot fusion without managing an instance. */
export function fuseBCISignals(signals: BCISignal[]): BCIDecodeResult {
  return getFusionEngine().fuseBCISignals(signals);
}
