/**
 * PPO + GAE RL Agent for Grant Ranking
 *
 * Implements a lightweight Proximal Policy Optimization (PPO) agent with
 * Generalized Advantage Estimation (GAE) to learn optimal grant rankings
 * based on user feedback and contextual features.
 *
 * The agent learns which grants are most relevant to a specific applicant
 * profile and improves rankings over time through interaction signals.
 */

import type { Grant } from './grokGrantClient';

// ─── Constants ──────────────────────────────────────────────────────────────

const WEIGHT_CLIP_MIN = -5;
const WEIGHT_CLIP_MAX = 5;
const DEFAULT_MAX_RESULTS = 8;

export { DEFAULT_MAX_RESULTS };

// ─── Types ─────────────────────────────────────────────────────────────────

export interface GrantFeatures {
  amountScore: number;        // 0-1, normalized grant amount fit
  deadlineUrgency: number;    // 0-1, how soon the deadline is
  eligibilityMatch: number;   // 0-1, how well applicant matches
  focusAlignment: number;     // 0-1, topic alignment with query
  typePreference: number;     // 0-1, preferred grant type
  locationMatch: number;      // 0-1, geographic relevance
  applicationDifficulty: number; // 0-1 (inverted: 1=easy)
}

export interface RLState {
  weights: number[];          // Policy network weights (linear model)
  valueFn: number[];          // Value function weights
  episodeRewards: number[];   // Reward history per episode
  totalEpisodes: number;
  avgAdvantage: number;
  lastUpdatedAt: number;
}

export interface RLConfig {
  learningRate: number;       // PPO learning rate (default 0.003)
  gamma: number;              // Discount factor for GAE (default 0.99)
  lambda: number;             // GAE lambda (default 0.95)
  clipEpsilon: number;        // PPO clipping range (default 0.2)
  entropyCoeff: number;       // Entropy bonus coefficient (default 0.01)
  epochs: number;             // Mini-batch PPO epochs (default 4)
}

const DEFAULT_CONFIG: RLConfig = {
  learningRate: 0.003,
  gamma: 0.99,
  lambda: 0.95,
  clipEpsilon: 0.2,
  entropyCoeff: 0.01,
  epochs: 4,
};

const FEATURE_DIM = 7; // matches GrantFeatures fields

// ─── Feature Extraction ─────────────────────────────────────────────────────

/**
 * Extract normalized feature vector from a grant relative to the applicant context.
 */
export function extractFeatures(grant: Grant, query: string, applicantBudget?: number): GrantFeatures {
  const now = Date.now();
  const maxAmount = 10_000_000;
  const targetAmount = applicantBudget ?? 50_000;

  // Amount fit: how close is the grant range to the applicant's target
  const midAmount = (grant.amount.min + grant.amount.max) / 2;
  const amountDiff = Math.abs(midAmount - targetAmount) / Math.max(targetAmount, midAmount);
  const amountScore = Math.max(0, 1 - amountDiff);

  // Deadline urgency: 1 = due very soon (within 7 days), 0 = no deadline or far future
  let deadlineUrgency = 0;
  if (grant.deadline) {
    const daysLeft = (new Date(grant.deadline).getTime() - now) / (1000 * 60 * 60 * 24);
    if (daysLeft < 0) {
      deadlineUrgency = 0; // expired
    } else if (daysLeft <= 7) {
      deadlineUrgency = 1.0;
    } else if (daysLeft <= 30) {
      deadlineUrgency = 0.8;
    } else if (daysLeft <= 90) {
      deadlineUrgency = 0.5;
    } else {
      deadlineUrgency = 0.2;
    }
  } else {
    deadlineUrgency = 0.3; // rolling deadlines are moderately urgent
  }

  // Focus alignment: query terms in grant focus/description
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const grantText = [
    grant.title,
    grant.description,
    ...grant.focus,
    ...grant.eligibility,
    grant.category,
  ].join(' ').toLowerCase();
  const matchCount = queryTerms.filter(t => grantText.includes(t)).length;
  const focusAlignment = queryTerms.length > 0 ? matchCount / queryTerms.length : 0.5;

  // Eligibility match: rough heuristic based on eligibility list complexity
  const eligibilityMatch = Math.max(0.2, 1 - (grant.eligibility.length - 1) * 0.1);

  // Type preference: federal/state > foundation > corporate
  const typeScores: Record<string, number> = {
    federal: 0.9,
    state: 0.85,
    foundation: 0.8,
    nonprofit: 0.7,
    corporate: 0.65,
    other: 0.5,
  };
  const typePreference = typeScores[grant.type] ?? 0.5;

  // Location match
  const locationMatch = grant.location
    ? (grant.location.toLowerCase().includes('national') || grant.location.toLowerCase().includes('global')
      ? 0.7
      : 0.95)
    : 0.5;

  // Application difficulty (inversely proportional to amount: bigger = harder)
  const normalizedAmount = Math.min(midAmount / maxAmount, 1);
  const applicationDifficulty = 1 - normalizedAmount * 0.7;

  return {
    amountScore,
    deadlineUrgency,
    eligibilityMatch,
    focusAlignment,
    typePreference,
    locationMatch,
    applicationDifficulty,
  };
}

/**
 * Convert GrantFeatures to a flat array for the policy network.
 */
function featuresToVector(f: GrantFeatures): number[] {
  return [
    f.amountScore,
    f.deadlineUrgency,
    f.eligibilityMatch,
    f.focusAlignment,
    f.typePreference,
    f.locationMatch,
    f.applicationDifficulty,
  ];
}

// ─── Policy Network (Linear) ─────────────────────────────────────────────────

function initWeights(dim: number, scale = 0.1): number[] {
  // Xavier-style initialization
  return Array.from({ length: dim }, () => (Math.random() * 2 - 1) * scale);
}

function dot(a: number[], b: number[]): number {
  return a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-10, Math.min(10, x))));
}

/**
 * Compute action score (logit) for a grant given policy weights.
 */
function policyScore(weights: number[], features: number[]): number {
  return sigmoid(dot(weights, features));
}

// ─── GAE Computation ────────────────────────────────────────────────────────

interface Transition {
  features: number[];
  reward: number;
  value: number;
  nextValue: number;
  done: boolean;
}

/**
 * Compute Generalized Advantage Estimates.
 * GAE(λ) = Σ (γλ)^t δ_t  where δ_t = r_t + γV(s_{t+1}) - V(s_t)
 */
function computeGAE(transitions: Transition[], gamma: number, lambda: number): number[] {
  const advantages: number[] = new Array(transitions.length).fill(0);
  let lastGAE = 0;

  for (let t = transitions.length - 1; t >= 0; t--) {
    const tr = transitions[t];
    const delta = tr.reward + (tr.done ? 0 : gamma * tr.nextValue) - tr.value;
    lastGAE = delta + gamma * lambda * (tr.done ? 0 : lastGAE);
    advantages[t] = lastGAE;
  }

  return advantages;
}

// ─── PPO Update ─────────────────────────────────────────────────────────────

/**
 * Perform a PPO policy update step.
 * Uses clipped surrogate objective with entropy bonus.
 */
function ppoPolicyUpdate(
  weights: number[],
  transitions: Transition[],
  advantages: number[],
  config: RLConfig,
): number[] {
  const newWeights = [...weights];

  for (let epoch = 0; epoch < config.epochs; epoch++) {
    for (let t = 0; t < transitions.length; t++) {
      const f = transitions[t].features;
      const adv = advantages[t];

      // Current policy probability
      const newLogit = dot(newWeights, f);
      const newProb = sigmoid(newLogit);

      // Old policy probability (approximated as the stored value)
      const oldProb = transitions[t].value;

      // Ratio for PPO clipping
      const ratio = newProb / Math.max(oldProb, 1e-8);
      const clippedRatio = Math.max(
        1 - config.clipEpsilon,
        Math.min(1 + config.clipEpsilon, ratio)
      );

      // PPO surrogate loss gradient (simplified linear update)
      const effectiveAdv = Math.min(ratio * adv, clippedRatio * adv);

      // Entropy term to encourage exploration
      const entropy = -(newProb * Math.log(Math.max(newProb, 1e-8)) +
                        (1 - newProb) * Math.log(Math.max(1 - newProb, 1e-8)));

      const gradScale = config.learningRate * (effectiveAdv + config.entropyCoeff * entropy);

      // Gradient update
      for (let j = 0; j < newWeights.length; j++) {
        newWeights[j] += gradScale * (f[j] ?? 0) * newProb * (1 - newProb);
        // Clip weights to prevent explosion
        newWeights[j] = Math.max(WEIGHT_CLIP_MIN, Math.min(WEIGHT_CLIP_MAX, newWeights[j]));
      }
    }
  }

  return newWeights;
}

// ─── PPO RL Agent ───────────────────────────────────────────────────────────

export class PPORLAgent {
  private state: RLState;
  private config: RLConfig;

  constructor(config: Partial<RLConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = {
      weights: initWeights(FEATURE_DIM),
      valueFn: initWeights(FEATURE_DIM),
      episodeRewards: [],
      totalEpisodes: 0,
      avgAdvantage: 0,
      lastUpdatedAt: Date.now(),
    };
  }

  /**
   * Load existing state (for persistence between sessions).
   */
  loadState(state: RLState): void {
    this.state = state;
  }

  /**
   * Export current state for persistence.
   */
  exportState(): RLState {
    return { ...this.state };
  }

  /**
   * Score a single grant (0-1, higher = more relevant).
   */
  scoreGrant(grant: Grant, query: string, applicantBudget?: number): number {
    const features = extractFeatures(grant, query, applicantBudget);
    const fv = featuresToVector(features);
    return policyScore(this.state.weights, fv);
  }

  /**
   * Rank a list of grants by relevance score (descending).
   */
  rankGrants(grants: Grant[], query: string, applicantBudget?: number): Array<Grant & { rlScore: number }> {
    return grants
      .map((g) => ({ ...g, rlScore: this.scoreGrant(g, query, applicantBudget) }))
      .sort((a, b) => b.rlScore - a.rlScore);
  }

  /**
   * Learn from user feedback on a ranked list of grants.
   * Positive feedback (clicked/applied) = +1 reward, negative (skipped) = -0.2
   *
   * @param grants - The ranked grants shown to user
   * @param feedbackMap - Map of grant ID → reward signal (+1, 0, -1)
   * @param query - The search query used
   */
  learn(
    grants: Grant[],
    feedbackMap: Record<string, number>,
    query: string,
    applicantBudget?: number,
  ): void {
    if (grants.length === 0) return;

    const transitions: Transition[] = grants.map((g, i) => {
      const features = featuresToVector(extractFeatures(g, query, applicantBudget));
      const value = policyScore(this.state.valueFn, features);
      const reward = feedbackMap[g.id] ?? 0;
      const nextIdx = i + 1;
      const nextFeatures = nextIdx < grants.length
        ? featuresToVector(extractFeatures(grants[nextIdx], query, applicantBudget))
        : features;
      const nextValue = policyScore(this.state.valueFn, nextFeatures);
      return {
        features,
        reward,
        value,
        nextValue,
        done: i === grants.length - 1,
      };
    });

    const advantages = computeGAE(transitions, this.config.gamma, this.config.lambda);
    const avgAdv = advantages.reduce((s, a) => s + a, 0) / advantages.length;

    // Update policy weights using PPO
    this.state.weights = ppoPolicyUpdate(
      this.state.weights,
      transitions,
      advantages,
      this.config,
    );

    // Update value function with simple TD update
    for (const t of transitions) {
      const pred = dot(this.state.valueFn, t.features);
      const target = t.reward + (t.done ? 0 : this.config.gamma * t.nextValue);
      const err = target - pred;
      for (let j = 0; j < this.state.valueFn.length; j++) {
        this.state.valueFn[j] += this.config.learningRate * err * t.features[j];
        this.state.valueFn[j] = Math.max(WEIGHT_CLIP_MIN, Math.min(WEIGHT_CLIP_MAX, this.state.valueFn[j]));
      }
    }

    const totalReward = transitions.reduce((s, t) => s + t.reward, 0);
    this.state.episodeRewards.push(totalReward);
    if (this.state.episodeRewards.length > 100) this.state.episodeRewards.shift();
    this.state.totalEpisodes++;
    this.state.avgAdvantage = avgAdv;
    this.state.lastUpdatedAt = Date.now();
  }

  /**
   * Get agent performance summary.
   */
  getStats(): { totalEpisodes: number; avgReward: number; avgAdvantage: number; lastUpdatedAt: number } {
    const n = this.state.episodeRewards.length;
    const avgReward = n > 0
      ? this.state.episodeRewards.reduce((s, r) => s + r, 0) / n
      : 0;
    return {
      totalEpisodes: this.state.totalEpisodes,
      avgReward,
      avgAdvantage: this.state.avgAdvantage,
      lastUpdatedAt: this.state.lastUpdatedAt,
    };
  }
}

// Singleton agent instance (in-memory; can be extended with persistence)
let _agentInstance: PPORLAgent | null = null;

export function getGrantRLAgent(): PPORLAgent {
  if (!_agentInstance) {
    _agentInstance = new PPORLAgent();
  }
  return _agentInstance;
}
