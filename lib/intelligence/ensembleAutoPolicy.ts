import { getEnsembleDiagnostics } from '@/lib/intelligence/ensembleDiagnostics';
import { applyEnsembleSignals } from '@/lib/intelligence/championPolicy';
import { logEvent } from '@/lib/logger';

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export async function runEnsembleAutoPolicy(input?: {
  limit?: number;
  regime?: 'risk_on' | 'risk_off' | 'neutral' | 'unknown';
}) {
  const diagnostics = await getEnsembleDiagnostics(input?.limit || 800);

  const ensembleDecisions = diagnostics.window.ensembleDecisions || 0;
  if (ensembleDecisions < 1) {
    return {
      applied: false,
      reason: 'insufficient_ensemble_samples',
      diagnostics,
    };
  }

  const regime = input?.regime || 'unknown';
  const signal = {
    modelStats: diagnostics.modelStats,
    averageAgreement: diagnostics.consensus.averageAgreement,
    highDisagreementRate: diagnostics.consensus.highDisagreementRate,
  };

  const averageAgreement = typeof signal.averageAgreement === 'number' ? signal.averageAgreement : 0.5;
  const highDisagreementRate = typeof signal.highDisagreementRate === 'number' ? signal.highDisagreementRate : 0;

  const shouldApply = (
    diagnostics.modelStats.length >= 2 && (
      averageAgreement < 0.32 ||
      highDisagreementRate > 0.35 ||
      diagnostics.modelStats.some((item) => item.winRate >= 0.65 && item.queried >= 1)
    )
  );

  if (!shouldApply) {
    return {
      applied: false,
      reason: 'signals_stable_no_tune_needed',
      diagnostics,
    };
  }

  const result = applyEnsembleSignals({
    regime,
    signals: signal,
  });

  await logEvent('ensemble_policy_tuned', {
    regime,
    appliedModels: result.appliedModels,
    averageAgreement: clamp(averageAgreement),
    highDisagreementRate: clamp(highDisagreementRate),
    topAfterTuning: result.topAfterTuning,
  });

  return {
    applied: true,
    diagnostics,
    tuning: result,
  };
}
