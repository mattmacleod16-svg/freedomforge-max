/**
 * FreedomForge Meta — Meta-Learning Engine
 *
 * Implements a learn-to-learn framework: tracks model/strategy performance
 * across episodes and adapts hyperparameter configurations to maximize reward.
 *
 * State is persisted to data/meta-learning-state.json (mirrors adaptiveCortex pattern).
 */

import fs from 'fs';
import path from 'path';
import { MetaEpisode, MetaLearningState } from '@/lib/types';

const DATA_DIR   = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'meta-learning-state.json');
const MAX_EPISODES = 500;

// ─── Default config space ─────────────────────────────────────────────────────

const DEFAULT_CONFIG: Record<string, number> = {
  learningRate:   0.01,
  explorationEps: 0.2,
  batchSize:      32,
  horizon:        10,
};

// ─── MetaLearner ─────────────────────────────────────────────────────────────

export class MetaLearner {
  private taskType: string;
  private state: MetaLearningState;

  constructor(taskType: string) {
    this.taskType = taskType;
    this.state = this.loadState();
  }

  /**
   * Record the outcome of a learning episode.
   * If this episode beats the current best, update bestConfig.
   */
  recordEpisode(
    config: Record<string, number>,
    reward: number,
    durationMs: number,
  ): MetaEpisode {
    const episode: MetaEpisode = {
      id:         `${this.taskType}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      taskType:   this.taskType,
      config:     { ...config },
      reward,
      durationMs,
      timestamp:  Date.now(),
    };

    this.state.episodes.push(episode);
    this.state.totalEpisodes += 1;

    if (reward > this.state.bestReward) {
      this.state.bestReward  = reward;
      this.state.bestConfig  = { ...config };
    }

    // Trim to max
    if (this.state.episodes.length > MAX_EPISODES) {
      this.state.episodes.shift();
    }

    this.state.lastUpdated = Date.now();
    this.persistState();
    return episode;
  }

  /**
   * Adapt the current config using a simple hill-climbing approach:
   * perturb the best known config and accept if reward improves.
   */
  adapt(currentReward: number): Record<string, number> {
    const base = { ...this.state.bestConfig };
    const candidate: Record<string, number> = {};

    for (const [key, val] of Object.entries(base)) {
      // Small Gaussian perturbation (±10%)
      candidate[key] = clamp(val + (Math.random() - 0.5) * 0.2 * val, 1e-6, 1e4);
    }

    if (currentReward >= this.state.bestReward) {
      this.state.bestConfig = candidate;
      this.state.bestReward = currentReward;
      this.persistState();
    }

    return candidate;
  }

  getBestConfig(): Record<string, number> {
    return { ...this.state.bestConfig };
  }

  getState(): Readonly<MetaLearningState> {
    return this.state;
  }

  // ─── Persistence ────────────────────────────────────────────────────────────

  private loadState(): MetaLearningState {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, 'utf-8');
        const all = JSON.parse(raw) as Record<string, MetaLearningState>;
        if (all[this.taskType]) return all[this.taskType];
      }
    } catch {
      // Fall through to default
    }

    return {
      episodes:       [],
      bestConfig:     { ...DEFAULT_CONFIG },
      bestReward:     -Infinity,
      totalEpisodes:  0,
      lastUpdated:    Date.now(),
    };
  }

  private persistState(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

      let all: Record<string, MetaLearningState> = {};
      if (fs.existsSync(STATE_FILE)) {
        try { all = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); } catch { /* ignore */ }
      }

      all[this.taskType] = this.state;
      fs.writeFileSync(STATE_FILE, JSON.stringify(all, null, 2));
    } catch {
      // Non-fatal: state will be recomputed next run
    }
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const _learners = new Map<string, MetaLearner>();

export function getMetaLearner(taskType: string): MetaLearner {
  if (!_learners.has(taskType)) {
    _learners.set(taskType, new MetaLearner(taskType));
  }
  return _learners.get(taskType)!;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
