/**
 * FreedomForge QuantumForge — Quantum Machine Learning Engine
 *
 * TypeScript simulation of a Quantum Support Vector Classifier (QSVC)
 * for BCI spike intent classification, using a ZZFeatureMap kernel.
 *
 * Pipeline:
 *   spikeData → ZZFeatureMap (encode to Hilbert space) →
 *   QuantumKernel (compute inner products) →
 *   QSVC (kernel SVM) → BCIIntent label
 *
 * In production, replace the simulation layer with:
 *   - Qiskit Machine Learning  (qiskit-machine-learning)
 *   - PennyLane                (pennylane + pennylane-qiskit)
 *   - TensorFlow Quantum       (tfq)
 */

import { BCIIntent } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpikeData {
  channels:    number[];
  timestampMs: number;
  label?:      BCIIntent; // present during training
}

export interface QMLPrediction {
  intent:     BCIIntent;
  confidence: number;
  kernel:     'ZZFeatureMap';
}

// ─── Simulation helpers ───────────────────────────────────────────────────────
// TODO(quantum-sdk): Replace with real quantum feature map + kernel evaluation

interface FeatureMap {
  featureDimension: number;
  reps: number;
  encode(features: number[]): number[];
}

function zzFeatureMap(featureDimension: number, reps: number): FeatureMap {
  return {
    featureDimension,
    reps,
    encode(features: number[]): number[] {
      // Simulated ZZFeatureMap encoding: apply cos(π/2·x_i)·cos(π/2·x_j) cross terms
      const padded = features.slice(0, featureDimension).concat(
        Array(Math.max(0, featureDimension - features.length)).fill(0)
      );
      const encoded: number[] = [];
      for (let r = 0; r < reps; r++) {
        for (let i = 0; i < featureDimension; i++) {
          encoded.push(Math.cos((Math.PI / 2) * padded[i]));
          for (let j = i + 1; j < featureDimension; j++) {
            encoded.push(
              Math.cos((Math.PI - padded[i]) * (Math.PI - padded[j]))
            );
          }
        }
      }
      return encoded;
    },
  };
}

function quantumKernel(featureMap: FeatureMap) {
  return {
    /** Compute inner product between two encoded feature vectors. */
    compute(a: number[], b: number[]): number {
      const fa = featureMap.encode(a);
      const fb = featureMap.encode(b);
      const dot = fa.reduce((s, v, i) => s + v * (fb[i] ?? 0), 0);
      return dot / Math.max(1, Math.sqrt(fa.length));
    },
  };
}

// ─── QSVC ─────────────────────────────────────────────────────────────────────

class QSVC {
  private kernel: ReturnType<typeof quantumKernel>;
  private supportVectors: Array<{ features: number[]; label: BCIIntent }> = [];

  constructor(kernel: ReturnType<typeof quantumKernel>) {
    this.kernel = kernel;
  }

  /** Train on labelled spike data. */
  fit(data: SpikeData[]): void {
    this.supportVectors = data
      .filter(d => d.label !== undefined)
      .map(d => ({ features: d.channels, label: d.label! }));
  }

  /** Predict intent for a single spike vector. */
  predict(features: number[]): QMLPrediction {
    if (this.supportVectors.length === 0) {
      return { intent: 'idle', confidence: 0, kernel: 'ZZFeatureMap' };
    }

    // Kernel-weighted vote across support vectors
    const scores = new Map<BCIIntent, number>();
    for (const sv of this.supportVectors) {
      const k = this.kernel.compute(features, sv.features);
      scores.set(sv.label, (scores.get(sv.label) ?? 0) + k);
    }

    let best: BCIIntent = 'idle';
    let bestScore = -Infinity;
    for (const [label, score] of scores) {
      if (score > bestScore) { bestScore = score; best = label; }
    }

    const total = Array.from(scores.values()).reduce((s, v) => s + Math.abs(v), 0);
    const confidence = total > 0 ? Math.abs(bestScore) / total : 0;

    return { intent: best, confidence: Math.min(confidence, 1), kernel: 'ZZFeatureMap' };
  }
}

// ─── QMLEngine ────────────────────────────────────────────────────────────────

export class QMLEngine {
  private readonly featureMap = zzFeatureMap(4, 2);
  private readonly qsvc       = new QSVC(quantumKernel(zzFeatureMap(4, 2)));
  private trained              = false;

  /**
   * Train the QSVC on labelled spike data.
   * Call this once at startup with pre-labelled calibration data.
   */
  train(labelledData: SpikeData[]): void {
    this.qsvc.fit(labelledData);
    this.trained = true;
  }

  /**
   * Classify raw BCI spike data into a BCIIntent.
   *
   * @param spikeData  Array of channel amplitudes (0–1 normalized)
   */
  classifyBCIIntent(spikeData: number[]): QMLPrediction {
    if (!this.trained) {
      // Bootstrap with synthetic calibration data on first call
      this.train(defaultCalibrationData());
    }
    return this.qsvc.predict(spikeData);
  }
}

// ─── Calibration bootstrap ────────────────────────────────────────────────────

function defaultCalibrationData(): SpikeData[] {
  const ts = Date.now();
  return [
    { channels: [0.1, 0.1, 0.1, 0.1], timestampMs: ts, label: 'idle'    },
    { channels: [0.8, 0.7, 0.9, 0.8], timestampMs: ts, label: 'focus'   },
    { channels: [0.5, 0.5, 0.8, 0.4], timestampMs: ts, label: 'relax'   },
    { channels: [0.9, 0.9, 0.9, 0.9], timestampMs: ts, label: 'command' },
  ];
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const qmlEngine = new QMLEngine();
