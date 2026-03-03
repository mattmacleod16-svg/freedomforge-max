import { getForecastSummary } from '@/lib/intelligence/forecastEngine';
import { getMarketIntelligenceSummary } from '@/lib/intelligence/marketFeatureStore';
import { getMemorySummary, recallMemories } from '@/lib/intelligence/memoryEngine';

type Opportunity = {
  id: string;
  title: string;
  regime: string;
  conviction: number;
  direction: 'long' | 'short' | 'neutral';
  rationale: string;
  safeguards: string[];
  score: number;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolveDirection(probability: number) {
  if (probability >= 0.56) return 'long';
  if (probability <= 0.44) return 'short';
  return 'neutral';
}

export function getAdaptiveOpportunityPlan(userQuery?: string) {
  const market = getMarketIntelligenceSummary();
  const forecast = getForecastSummary();
  const memory = getMemorySummary();
  const recalled = userQuery ? recallMemories(userQuery, { topK: 5, regime: (market.latest?.regime || 'unknown') as any }) : [];

  const forecastProb = forecast.latestForecast?.probability ?? 0.5;
  const forecastConf = forecast.latestForecast?.confidence ?? 0.5;
  const brier = forecast.averageBrierScore ?? 0.25;
  const marketConf = market.latest?.confidence ?? 0.5;
  const regime = market.latest?.regime || 'unknown';

  const recallReward = recalled.length > 0 ? avg(recalled.map((item) => item.reward)) : memory.averageReward;
  const recallRisk = recalled.length > 0 ? avg(recalled.map((item) => item.riskScore)) : memory.averageRisk;

  const conviction = clamp(
    (Math.abs(forecastProb - 0.5) * 2 * 0.4) +
    (forecastConf * 0.25) +
    ((1 - brier) * 0.2) +
    (marketConf * 0.15)
  );

  const direction = resolveDirection(forecastProb);
  const score = clamp(conviction * 0.65 + (1 - recallRisk) * 0.2 + recallReward * 0.15);

  const safeguards = [
    'position-size from risk engine',
    'hard stop-loss enabled',
    'rollback to assisted mode on calibration stress',
  ];

  const opportunities: Opportunity[] = [
    {
      id: `opp_${Date.now()}_core`,
      title: direction === 'neutral' ? 'Wait for edge confirmation' : `Regime-aware ${direction} bias opportunity`,
      regime,
      conviction,
      direction,
      rationale: `forecast_p=${forecastProb.toFixed(3)} conf=${forecastConf.toFixed(3)} brier=${brier.toFixed(3)} market_conf=${marketConf.toFixed(3)} recall_reward=${recallReward.toFixed(3)}`,
      safeguards,
      score,
    },
  ];

  if (regime === 'risk_off') {
    opportunities.push({
      id: `opp_${Date.now()}_defensive`,
      title: 'Defensive volatility capture setup',
      regime,
      conviction: clamp(conviction * 0.85),
      direction: direction === 'long' ? 'neutral' : direction,
      rationale: 'risk_off regime detected; prioritize capital preservation and shorter horizons',
      safeguards: [...safeguards, 'tighten max risk threshold', 'prefer assisted mode'],
      score: clamp(score * 0.9),
    });
  }

  return {
    generatedAt: Date.now(),
    marketRegime: regime,
    memoryContextUsed: recalled.length,
    opportunities,
    summary: {
      bestScore: opportunities.reduce((best, item) => Math.max(best, item.score), 0),
      unresolvedForecasts: forecast.unresolved,
      calibrationError: forecast.calibrationError,
    },
  };
}
