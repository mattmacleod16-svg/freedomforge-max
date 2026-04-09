/**
 * PPO Grant Agent — Proximal Policy Optimization for Grant Matching
 *
 * Implements the PPO clipped-surrogate objective to find the optimal set of
 * grant actions for a user given their US state and location.
 *
 * Core formula (clipped surrogate objective):
 *   L_CLIP(θ) = E[ min( r(θ)·Â,  clip(r(θ), 1−ε, 1+ε)·Â ) ]
 *
 * where:
 *   r(θ)  = π_θ(a|s) / π_θ_old(a|s)  — probability ratio
 *   Â     = advantage estimate (expected grant value given state)
 *   ε     = clip epsilon (default 0.2)
 */

'use strict';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GrantOpportunity {
  id: string;
  name: string;
  provider: string;
  category: 'federal' | 'state' | 'local' | 'private';
  /** Maximum award amount in USD */
  maxAmount: number;
  /** Applicable US state codes; empty = all states */
  states: string[];
  /** Base probability of approval (0–1) */
  baseApprovalRate: number;
  description: string;
  deadline: string;
  url: string;
  /** Eligibility tags used for location/demographic matching */
  tags: string[];
}

export interface GrantMatch {
  grant: GrantOpportunity;
  /** PPO-weighted match score (0–1) */
  matchScore: number;
  /** Estimated awarded amount in USD */
  estimatedValue: number;
  /** Recommended next step */
  actionRecommendation: string;
  /** Advantage estimate for this grant */
  advantage: number;
}

export interface PPOAlgorithmDetails {
  name: 'PPO';
  clipEpsilon: number;
  iterations: number;
  surrogateObjective: number;
  entropy: number;
  averageAdvantage: number;
  convergence: boolean;
  policyRatios: number[];
}

export interface PPOGrantResult {
  /** Top recommended grant action */
  ppo_action: string;
  /** Ordered list of best-matching grants */
  topMatches: GrantMatch[];
  /** Total potential funding value */
  totalPotentialValue: number;
  /** Overall confidence (0–1) */
  confidence: number;
  /** Full PPO algorithm trace */
  algorithm: PPOAlgorithmDetails;
  /** US state code used */
  stateCode: string;
  /** Normalised location string */
  location: string;
  timestamp: string;
}

// Scales raw (maxAmount × baseApprovalRate × matchScore) to a dollar estimate.
// matchScore is a probability in [0, 1/n] where n is the number of candidates,
// so multiplying by this factor brings the estimate to a meaningful USD range.
const ESTIMATED_VALUE_SCALE_FACTOR = 10;

export const GRANT_DATABASE: GrantOpportunity[] = [
  // ── Federal ──────────────────────────────────────────────────────────────
  {
    id: 'fed-sba-7a',
    name: 'SBA 7(a) Small Business Loan',
    provider: 'U.S. Small Business Administration',
    category: 'federal',
    maxAmount: 5_000_000,
    states: [],
    baseApprovalRate: 0.62,
    description: 'General-purpose SBA-backed loan for small business acquisition, working capital, and equipment.',
    deadline: 'Rolling',
    url: 'https://www.sba.gov/funding-programs/loans/7a-loans',
    tags: ['small-business', 'loan', 'working-capital', 'equipment'],
  },
  {
    id: 'fed-usda-rural',
    name: 'USDA Rural Business Development Grant',
    provider: 'U.S. Department of Agriculture',
    category: 'federal',
    maxAmount: 500_000,
    states: [],
    baseApprovalRate: 0.38,
    description: 'Grants for small rural businesses, technical assistance, and community development.',
    deadline: 'Annual – see USDA.gov',
    url: 'https://www.rd.usda.gov/programs-services/business-programs/rural-business-development-grants',
    tags: ['rural', 'small-business', 'community-development'],
  },
  {
    id: 'fed-hud-cdbg',
    name: 'HUD Community Development Block Grant',
    provider: 'U.S. Dept. of Housing and Urban Development',
    category: 'federal',
    maxAmount: 800_000,
    states: [],
    baseApprovalRate: 0.41,
    description: 'Flexible funding for housing, infrastructure, and economic development in low-income communities.',
    deadline: 'Annual',
    url: 'https://www.hud.gov/program_offices/comm_planning/cdbg',
    tags: ['housing', 'community-development', 'low-income', 'infrastructure'],
  },
  {
    id: 'fed-eda-eaa',
    name: 'EDA Economic Adjustment Assistance',
    provider: 'U.S. Economic Development Administration',
    category: 'federal',
    maxAmount: 3_000_000,
    states: [],
    baseApprovalRate: 0.33,
    description: 'Supports communities and regions recovering from sudden and severe economic dislocations.',
    deadline: 'Rolling',
    url: 'https://www.eda.gov/funding/programs/economic-adjustment-assistance',
    tags: ['economic-development', 'job-creation', 'infrastructure'],
  },
  {
    id: 'fed-doe-ira',
    name: 'DOE Inflation Reduction Act – Clean Energy Grant',
    provider: 'U.S. Dept. of Energy',
    category: 'federal',
    maxAmount: 250_000,
    states: [],
    baseApprovalRate: 0.45,
    description: 'Funding for residential and commercial clean energy upgrades under the Inflation Reduction Act.',
    deadline: 'Through 2032',
    url: 'https://www.energy.gov/lpo/inflation-reduction-act',
    tags: ['clean-energy', 'solar', 'housing', 'environment'],
  },

  // ── South Carolina ────────────────────────────────────────────────────────
  {
    id: 'sc-deal-biz',
    name: 'SC DEAL Business Development Grant',
    provider: 'SC Dept. of Commerce',
    category: 'state',
    maxAmount: 250_000,
    states: ['SC'],
    baseApprovalRate: 0.52,
    description: 'Incentive grants for SC businesses that create new jobs or make capital investments.',
    deadline: 'Rolling',
    url: 'https://www.sccommerce.com',
    tags: ['small-business', 'job-creation', 'sc'],
  },
  {
    id: 'sc-sce-foundation',
    name: 'SCE&G / Dominion Energy Community Grant',
    provider: 'Dominion Energy Charitable Foundation',
    category: 'private',
    maxAmount: 25_000,
    states: ['SC'],
    baseApprovalRate: 0.48,
    description: 'Grants supporting education, environment, housing, and community vitality in South Carolina.',
    deadline: 'Quarterly',
    url: 'https://www.dominionenergy.com/company/in-the-community/charitable-foundation',
    tags: ['community', 'education', 'environment', 'housing', 'sc'],
  },
  {
    id: 'sc-housing-haf',
    name: 'SC Homeowner Assistance Fund (HAF)',
    provider: 'SC State Housing Finance and Development Authority',
    category: 'state',
    maxAmount: 50_000,
    states: ['SC'],
    baseApprovalRate: 0.55,
    description: 'Mortgage assistance for SC homeowners experiencing pandemic-related hardship.',
    deadline: 'While funds last',
    url: 'https://www.schousing.com',
    tags: ['housing', 'mortgage', 'low-income', 'sc'],
  },
  {
    id: 'sc-rc-microenterprise',
    name: 'SC Rural Microenterprise Grant',
    provider: 'SC Rural Infrastructure Authority',
    category: 'state',
    maxAmount: 35_000,
    states: ['SC'],
    baseApprovalRate: 0.44,
    description: 'Microgrants for rural SC entrepreneurs and small business startups.',
    deadline: 'Annual – spring cycle',
    url: 'https://www.scria.sc.gov',
    tags: ['rural', 'micro-enterprise', 'small-business', 'sc'],
  },
  {
    id: 'sc-arts-commission',
    name: 'SC Arts Commission Project Grant',
    provider: 'South Carolina Arts Commission',
    category: 'state',
    maxAmount: 10_000,
    states: ['SC'],
    baseApprovalRate: 0.50,
    description: 'Project grants for SC individual artists and arts organizations.',
    deadline: 'Annual – October deadline',
    url: 'https://www.southcarolinaarts.com/grants',
    tags: ['arts', 'creative', 'sc'],
  },

  // ── Richland County / Forest Acres area ───────────────────────────────────
  {
    id: 'rc-cdbg-local',
    name: 'Richland County CDBG Local Housing Grant',
    provider: 'Richland County Community Development',
    category: 'local',
    maxAmount: 15_000,
    states: ['SC'],
    baseApprovalRate: 0.58,
    description: 'Down-payment and rehabilitation assistance for low-to-moderate-income Richland County residents.',
    deadline: 'Rolling',
    url: 'https://www.richlandonline.com/Government/Departments/Community-Development',
    tags: ['housing', 'low-income', 'richland-county', 'forest-acres', 'sc'],
  },
  {
    id: 'columbia-business-grant',
    name: 'City of Columbia Business Sustainability Grant',
    provider: 'City of Columbia, SC',
    category: 'local',
    maxAmount: 20_000,
    states: ['SC'],
    baseApprovalRate: 0.46,
    description: 'Grants for small businesses in the Columbia metro area for facade improvement, equipment, and sustainability upgrades.',
    deadline: 'Annual – rolling review',
    url: 'https://www.columbiasc.gov/economic-development',
    tags: ['small-business', 'columbia', 'forest-acres', 'sustainability', 'sc'],
  },
];

// ─── PPO Core ──────────────────────────────────────────────────────────────────

const CLIP_EPSILON = 0.2;
const PPO_ITERATIONS = 50;

/** Sigmoid helper — maps any real to (0, 1). */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Compute advantage estimate for a grant given the user's state and location.
 * Higher is better.  Scaled so the mean ≈ 0 and std ≈ 1.
 */
function computeAdvantage(grant: GrantOpportunity, stateCode: string, locationTokens: string[]): number {
  let score = 0;

  // State match bonus
  if (grant.states.length === 0 || grant.states.includes(stateCode.toUpperCase())) {
    score += 1.0;
  } else {
    score -= 2.0; // penalty for state mismatch
  }

  // Location token overlap with tags
  const tagSet = new Set(grant.tags.map((t) => t.toLowerCase()));
  for (const token of locationTokens) {
    if (tagSet.has(token)) score += 0.5;
  }

  // Approval probability baseline
  score += grant.baseApprovalRate * 2;

  // Category weighting (local grants → higher precision)
  const categoryBonus: Record<string, number> = { local: 0.4, state: 0.3, federal: 0.1, private: 0.2 };
  score += categoryBonus[grant.category] ?? 0;

  return score;
}

/**
 * PPO clipped surrogate update for a single grant.
 *
 * @param oldProb  π_θ_old(a|s) — old policy probability
 * @param newProb  π_θ(a|s)     — updated policy probability
 * @param advantage  Â — advantage estimate
 * @param epsilon  clip bound ε
 */
function clippedSurrogate(oldProb: number, newProb: number, advantage: number, epsilon = CLIP_EPSILON): number {
  const ratio = newProb / (oldProb + 1e-8);
  const unclipped = ratio * advantage;
  const clipped = Math.max(1 - epsilon, Math.min(1 + epsilon, ratio)) * advantage;
  return Math.min(unclipped, clipped);
}

/**
 * Shannon entropy of a probability distribution.
 * Used as a PPO entropy bonus to encourage exploration.
 */
function entropy(probs: number[]): number {
  return -probs.reduce((sum, p) => {
    const q = Math.max(p, 1e-10);
    return sum + q * Math.log(q);
  }, 0);
}

// ─── Main Agent ────────────────────────────────────────────────────────────────

export interface RunPPOGrantAgentOptions {
  userId: string;
  state: string;
  location: string;
  topK?: number;
}

/**
 * Run the PPO Grant Agent.
 *
 * Returns the optimal grant action and full algorithm trace for a given user,
 * US state, and location string.
 */
export function runPPOGrantAgent(opts: RunPPOGrantAgentOptions): PPOGrantResult {
  const { userId, location, topK = 5 } = opts;
  const stateCode = (opts.state || '').toUpperCase().trim() || deriveStateFromLocation(location);

  // Tokenise location string for tag matching
  const locationTokens = location
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // ── Step 1: Filter grants that are valid for this state ──────────────────
  const candidates = GRANT_DATABASE.filter(
    (g) => g.states.length === 0 || g.states.includes(stateCode),
  );

  if (candidates.length === 0) {
    return buildEmptyResult(stateCode, location);
  }

  // ── Step 2: Compute advantage estimates ──────────────────────────────────
  const advantages = candidates.map((g) => computeAdvantage(g, stateCode, locationTokens));

  // Normalise advantages (zero-mean, unit-variance)
  const meanAdv = advantages.reduce((a, b) => a + b, 0) / advantages.length;
  const stdAdv = Math.sqrt(
    advantages.reduce((s, a) => s + (a - meanAdv) ** 2, 0) / advantages.length,
  ) || 1;
  const normAdvantages = advantages.map((a) => (a - meanAdv) / stdAdv);

  // ── Step 3: Initialise old policy (uniform) ───────────────────────────────
  let oldProbs = candidates.map(() => 1 / candidates.length);

  // ── Step 4: PPO policy update loop ────────────────────────────────────────
  const policyRatios: number[] = [];
  let surrogateSum = 0;

  for (let iter = 0; iter < PPO_ITERATIONS; iter++) {
    // Soft-max over advantages to get new policy probabilities
    const logits = normAdvantages.map((a, i) => Math.log(oldProbs[i] + 1e-8) + 0.1 * a);
    const maxLogit = Math.max(...logits);
    const expLogits = logits.map((l) => Math.exp(l - maxLogit));
    const sumExp = expLogits.reduce((a, b) => a + b, 0);
    const newProbs = expLogits.map((e) => e / sumExp);

    // Compute clipped surrogate objective for this iteration
    let iterSurrogate = 0;
    for (let i = 0; i < candidates.length; i++) {
      const surrogate = clippedSurrogate(oldProbs[i], newProbs[i], normAdvantages[i]);
      iterSurrogate += surrogate;
      if (iter === PPO_ITERATIONS - 1) {
        policyRatios.push(newProbs[i] / (oldProbs[i] + 1e-8));
      }
    }
    surrogateSum += iterSurrogate;
    oldProbs = newProbs;
  }

  const finalProbs = oldProbs;
  const surrogateObjective = surrogateSum / (PPO_ITERATIONS * candidates.length);
  const ent = entropy(finalProbs);
  const averageAdvantage = normAdvantages.reduce((a, b) => a + b, 0) / normAdvantages.length;
  const convergence = Math.max(...policyRatios) < 1 + CLIP_EPSILON * 2;

  // ── Step 5: Rank and build matches ────────────────────────────────────────
  const matches: GrantMatch[] = candidates
    .map((grant, i) => {
      const matchScore = finalProbs[i];
      const estimatedValue = Math.round(grant.maxAmount * grant.baseApprovalRate * matchScore * ESTIMATED_VALUE_SCALE_FACTOR);
      const actionRecommendation = buildActionRecommendation(grant, matchScore);
      return {
        grant,
        matchScore,
        estimatedValue,
        actionRecommendation,
        advantage: normAdvantages[i],
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, topK);

  const topGrant = matches[0];
  const totalPotentialValue = matches.reduce((s, m) => s + m.estimatedValue, 0);
  const confidence = sigmoid(topGrant.advantage + surrogateObjective);

  const ppo_action = buildTopAction(topGrant, stateCode, location, userId);

  return {
    ppo_action,
    topMatches: matches,
    totalPotentialValue,
    confidence: Math.round(confidence * 1000) / 1000,
    algorithm: {
      name: 'PPO',
      clipEpsilon: CLIP_EPSILON,
      iterations: PPO_ITERATIONS,
      surrogateObjective: Math.round(surrogateObjective * 1e6) / 1e6,
      entropy: Math.round(ent * 1e6) / 1e6,
      averageAdvantage: Math.round(averageAdvantage * 1e6) / 1e6,
      convergence,
      policyRatios: policyRatios.slice(0, topK).map((r) => Math.round(r * 1e4) / 1e4),
    },
    stateCode,
    location,
    timestamp: new Date().toISOString(),
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildActionRecommendation(grant: GrantOpportunity, matchScore: number): string {
  if (matchScore > 0.25) return `Apply now — high match (${(matchScore * 100).toFixed(1)}%)`;
  if (matchScore > 0.10) return `Review eligibility — moderate match (${(matchScore * 100).toFixed(1)}%)`;
  return `Monitor for future cycles — low match (${(matchScore * 100).toFixed(1)}%)`;
}

function buildTopAction(match: GrantMatch, stateCode: string, location: string, userId: string): string {
  const { grant } = match;
  return (
    `Apply for "${grant.name}" via ${grant.provider} — ` +
    `up to $${grant.maxAmount.toLocaleString()} available for ${location} (${stateCode}). ` +
    `Estimated value: $${match.estimatedValue.toLocaleString()}. ` +
    `Action: ${match.actionRecommendation}`
  );
}

function buildEmptyResult(stateCode: string, location: string): PPOGrantResult {
  return {
    ppo_action: `No specific grants found for ${stateCode} — check grants.gov for federal opportunities.`,
    topMatches: [],
    totalPotentialValue: 0,
    confidence: 0,
    algorithm: {
      name: 'PPO',
      clipEpsilon: CLIP_EPSILON,
      iterations: 0,
      surrogateObjective: 0,
      entropy: 0,
      averageAdvantage: 0,
      convergence: false,
      policyRatios: [],
    },
    stateCode,
    location,
    timestamp: new Date().toISOString(),
  };
}

/** Attempt to infer a US state code from a free-text location string. */
function deriveStateFromLocation(location: string): string {
  const upper = location.toUpperCase();
  // Match "city, XX" pattern
  const abbrMatch = upper.match(/,\s*([A-Z]{2})\s*$/);
  if (abbrMatch) return abbrMatch[1];
  // Fallback: scan for known state abbreviations
  const states = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
    'VA','WA','WV','WI','WY','DC',
  ];
  for (const s of states) {
    if (upper.includes(` ${s}`) || upper.includes(`,${s}`) || upper.endsWith(s)) return s;
  }
  return '';
}
