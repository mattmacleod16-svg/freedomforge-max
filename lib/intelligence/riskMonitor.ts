import { getAutonomySnapshot } from '@/lib/intelligence/autonomyDirector';
import { getForecastSummary } from '@/lib/intelligence/forecastEngine';
import { getMarketIntelligenceSummary } from '@/lib/intelligence/marketFeatureStore';
import { readLast } from '@/lib/logger';

interface RiskControlsPayload {
  positionSizeBps?: number;
  stopLossPct?: number;
  reliability?: number;
}

interface RollbackPayload {
  rollbackTriggered?: boolean;
  reason?: string;
  rollbackMode?: string;
}

interface AutonomyDecisionPayload {
  rollback?: RollbackPayload;
  riskControls?: RiskControlsPayload;
  tunedPolicy?: {
    mode?: string;
    autoApproveMinConfidence?: number;
    maxRiskForAutoApprove?: number;
    alwaysEscalateOnEthicsFlags?: boolean;
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function findLatestAutonomyDecision(events: unknown[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const row = asRecord(events[index]);
    if (row.type === 'autonomy_decision') {
      return asRecord(row.payload) as AutonomyDecisionPayload;
    }
  }
  return null;
}

export async function getRiskStatusSummary() {
  const [autonomy, forecast, market, events] = await Promise.all([
    Promise.resolve(getAutonomySnapshot()),
    Promise.resolve(getForecastSummary()),
    Promise.resolve(getMarketIntelligenceSummary()),
    readLast(300),
  ]);

  const latestDecision = findLatestAutonomyDecision(events as unknown[]);
  const rollback = latestDecision?.rollback;
  const riskControls = latestDecision?.riskControls;

  const latestTriggerReason = rollback?.rollbackTriggered
    ? rollback.reason || 'rollback_triggered'
    : null;

  return {
    asOf: new Date().toISOString(),
    governance: {
      approvalMode: autonomy.governance?.approvalPolicy?.mode || 'unknown',
      autoApproveMinConfidence: autonomy.governance?.approvalPolicy?.autoApproveMinConfidence ?? null,
      maxRiskForAutoApprove: autonomy.governance?.approvalPolicy?.maxRiskForAutoApprove ?? null,
      currentErrorRate: autonomy.governance?.currentErrorRate ?? null,
      errorBudget: autonomy.governance?.errorBudget ?? null,
    },
    controls: {
      positionSizeBps: riskControls?.positionSizeBps ?? null,
      hardStopLossPct: riskControls?.stopLossPct ?? null,
      reliability: riskControls?.reliability ?? null,
    },
    rollback: {
      triggered: rollback?.rollbackTriggered ?? false,
      mode: rollback?.rollbackMode ?? null,
      reason: latestTriggerReason,
    },
    market: {
      regime: market.latest?.regime ?? 'unknown',
      confidence: market.latest?.confidence ?? null,
      signals: market.latest?.signals ?? [],
    },
    forecast: {
      averageBrierScore: forecast.averageBrierScore,
      directionalAccuracy: forecast.directionalAccuracy,
      calibrationError: forecast.calibrationError,
      unresolved: forecast.unresolved,
    },
    thresholds: {
      calibrationBrierHardFail: Number(process.env.CALIBRATION_BRIER_HARD_FAIL || 0.26),
      autonomyErrorHardFail: Number(process.env.AUTONOMY_ERROR_HARD_FAIL || 0.16),
      predictionBasePositionBps: Number(process.env.PREDICTION_BASE_POSITION_BPS || 150),
      predictionMaxPositionBps: Number(process.env.PREDICTION_MAX_POSITION_BPS || 1200),
    },
  };
}
