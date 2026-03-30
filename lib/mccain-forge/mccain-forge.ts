/**
 * FreedomForge McCainForge — Maverick Decision Engine
 *
 * Scores contrarian conviction (0–100) across three pillars:
 *   - Independence          (40%) — divergence from ensemble consensus
 *   - Contrarian Confidence (35%) — signal strength for going against the crowd
 *   - Resilience            (25%) — ability to hold a position under pressure
 *
 * Returns a MaverickDecision with a composite score, a three-way
 * recommendation, actionable signals, and a full pillar breakdown.
 */

import { MaverickMetrics, MaverickDecision } from '@/lib/types';

// ─── Weights ──────────────────────────────────────────────────────────────────

const WEIGHT_INDEPENDENCE          = 0.40;
const WEIGHT_CONTRARIAN_CONFIDENCE = 0.35;
const WEIGHT_RESILIENCE            = 0.25;

// ─── Scoring helpers ──────────────────────────────────────────────────────────

/**
 * Independence score: inverse of ensemble agreement.
 * 0% agreement → 100 (full maverick), 100% agreement → 0 (pure consensus follower).
 */
function scoreIndependence(ensembleAgreementPct: number): number {
  return clamp((1 - ensembleAgreementPct) * 100, 0, 100);
}

/**
 * Contrarian confidence score: combines how committed the crowd is
 * with how fearful the market is. High agreement + extreme fear = max opportunity.
 *
 * sentimentScore maps: -1 (extreme fear) → 100, 0 → 50, +1 (extreme greed) → 0.
 */
function scoreContrarianConfidence(
  ensembleAgreementPct: number,
  sentimentScore: number,
): number {
  const agreementSignal = ensembleAgreementPct * 100;
  const sentimentSignal = ((1 - sentimentScore) / 2) * 100;
  return clamp((agreementSignal + sentimentSignal) / 2, 0, 100);
}

/**
 * Resilience score: high drawdown tolerance + low volatility + long position age.
 * Positions held 90+ days earn full age credit.
 */
function scoreResilience(
  drawdownTolerance: number,
  volatility: number,
  positionAgeDays: number,
): number {
  const toleranceComponent = drawdownTolerance * 100;
  const volatilityComponent = (1 - clamp(volatility, 0, 1)) * 100;
  const ageComponent = clamp(positionAgeDays / 90, 0, 1) * 100;
  return clamp((toleranceComponent + volatilityComponent + ageComponent) / 3, 0, 100);
}

// ─── Signal builder ───────────────────────────────────────────────────────────

function buildSignals(
  metrics: MaverickMetrics,
  independence: number,
  contrarianConfidence: number,
  resilience: number,
): string[] {
  const signals: string[] = [];

  if (independence > 70) {
    signals.push(
      'High independence detected — ensemble consensus is weak; maverick position is viable.',
    );
  }
  if (contrarianConfidence > 65 && metrics.ensembleAgreementPct > 0.7) {
    signals.push(
      'Strong contrarian setup: crowd is committed but sentiment is negative — consider holding or adding.',
    );
  }
  if (contrarianConfidence > 65 && metrics.sentimentScore < -0.5) {
    signals.push(
      'Extreme fear reading against high agreement — classic contrarian entry signal.',
    );
  }
  if (resilience < 40) {
    signals.push(
      'Resilience is low — review drawdown tolerance and reduce position size to extend hold window.',
    );
  }
  if (metrics.volatility > 0.5) {
    signals.push(
      'Elevated volatility is compressing resilience — consider hedging or tightening stops.',
    );
  }
  if (metrics.positionAgeDays < 7) {
    signals.push(
      'Position is new — allow more time before acting on contrarian conviction.',
    );
  }
  if (independence < 30) {
    signals.push(
      'Consensus is strong — only act if contrarian confidence and resilience are both high.',
    );
  }

  return signals.length > 0
    ? signals
    : ['Maverick metrics are balanced — no urgent signals at this time.'];
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function calculateMaverickDecision(metrics: MaverickMetrics): MaverickDecision {
  const independence         = scoreIndependence(metrics.ensembleAgreementPct);
  const contrarianConfidence = scoreContrarianConfidence(
    metrics.ensembleAgreementPct,
    metrics.sentimentScore,
  );
  const resilience           = scoreResilience(
    metrics.drawdownTolerance,
    metrics.volatility,
    metrics.positionAgeDays,
  );

  const composite = clamp(
    independence         * WEIGHT_INDEPENDENCE +
    contrarianConfidence * WEIGHT_CONTRARIAN_CONFIDENCE +
    resilience           * WEIGHT_RESILIENCE,
    0,
    100,
  );

  const maverickScore = Math.round(composite);

  const recommendation: MaverickDecision['recommendation'] =
    maverickScore >= 60 ? 'hold-contrarian' :
    maverickScore >= 35 ? 'wait-for-signal' :
    'align-with-consensus';

  return {
    maverickScore,
    recommendation,
    breakdown: {
      independence:         Math.round(independence),
      contrarianConfidence: Math.round(contrarianConfidence),
      resilience:           Math.round(resilience),
    },
    signals: buildSignals(metrics, independence, contrarianConfidence, resilience),
    timestamp: Date.now(),
  };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─── Class wrapper + singleton ────────────────────────────────────────────────

export class McCainForge {
  async evaluateMaverick(profile: { userId: string }): Promise<{ maverickScore: number }> {
    const decision = calculateMaverickDecision({
      ensembleAgreementPct: 0.6,
      sentimentScore:       -0.2,
      drawdownTolerance:    0.15,
      volatility:           0.25,
      positionAgeDays:      30,
    });
    return { maverickScore: decision.maverickScore };
  }
}

export const mccainForge = new McCainForge();
