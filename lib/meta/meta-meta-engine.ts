/**
 * FreedomForge Meta — Meta-Meta Engine
 *
 * Policy-over-policies: manages a pool of MetaLearner instances across task
 * types and selects the best-performing one using Upper Confidence Bound (UCB1).
 *
 * Enables recursive self-improvement: the engine learns which learning
 * strategy (config) works best across diverse tasks and evolves over time.
 */

import { MetaLearner, getMetaLearner } from './meta-learning';

interface LearnerRecord {
  taskType: string;
  learner: MetaLearner;
  totalReward: number;
  callCount: number;
}

export class MetaMetaEngine {
  private learners: Map<string, LearnerRecord> = new Map();
  private totalCalls = 0;
  /** UCB1 exploration constant */
  private readonly C: number;

  constructor(explorationConstant = 1.41) {
    this.C = explorationConstant;
  }

  /**
   * Register a task type. Idempotent — safe to call multiple times.
   */
  register(taskType: string): void {
    if (this.learners.has(taskType)) return;
    this.learners.set(taskType, {
      taskType,
      learner:     getMetaLearner(taskType),
      totalReward: 0,
      callCount:   0,
    });
  }

  /**
   * Select the best learner to use for the next task using UCB1.
   * Unvisited learners are always selected first to bootstrap exploration.
   */
  selectBestLearner(): MetaLearner {
    if (this.learners.size === 0) {
      throw new Error('MetaMetaEngine: no learners registered');
    }

    let best: LearnerRecord | null = null;
    let bestScore = -Infinity;

    for (const record of this.learners.values()) {
      const score = this.ucb1Score(record);
      if (score > bestScore) {
        bestScore = score;
        best = record;
      }
    }

    return best!.learner;
  }

  /**
   * Report the reward received for a given task type.
   * Updates internal statistics used by UCB1 selection.
   */
  reportReward(taskType: string, reward: number): void {
    const record = this.learners.get(taskType);
    if (!record) return;
    record.totalReward += reward;
    record.callCount   += 1;
    this.totalCalls    += 1;
  }

  /**
   * Evolve: for each registered learner, run one adaptation step
   * using its current average reward.
   */
  evolve(): void {
    for (const record of this.learners.values()) {
      if (record.callCount === 0) continue;
      const avgReward = record.totalReward / record.callCount;
      record.learner.adapt(avgReward);
    }
  }

  /** Summary of all registered learners and their statistics. */
  getSummary(): Array<{
    taskType: string;
    callCount: number;
    avgReward: number;
    bestConfig: Record<string, number>;
    ucb1Score: number;
  }> {
    return Array.from(this.learners.values()).map(r => ({
      taskType:   r.taskType,
      callCount:  r.callCount,
      avgReward:  r.callCount > 0 ? r.totalReward / r.callCount : 0,
      bestConfig: r.learner.getBestConfig(),
      ucb1Score:  this.ucb1Score(r),
    }));
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  /**
   * UCB1 score:  μ + C * sqrt(ln(N) / n_i)
   * Unvisited arms get +∞ (always explored first).
   */
  private ucb1Score(record: LearnerRecord): number {
    if (record.callCount === 0) return Infinity;
    const mu = record.totalReward / record.callCount;
    const exploration = this.C * Math.sqrt(Math.log(this.totalCalls + 1) / record.callCount);
    return mu + exploration;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _instance: MetaMetaEngine | null = null;

export function getMetaMetaEngine(): MetaMetaEngine {
  if (!_instance) _instance = new MetaMetaEngine();
  return _instance;
}
