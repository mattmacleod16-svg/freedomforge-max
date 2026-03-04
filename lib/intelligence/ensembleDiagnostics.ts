import { readLast } from '@/lib/logger';

type EnsemblePayload = {
  queriedModels?: string[];
  participatingModels?: string[];
  droppedModels?: string[];
  droppedDetails?: Array<{ model?: string; reason?: string }>;
  agreementScore?: number;
  maxMode?: boolean;
};

type XaiPayload = {
  selectedAction?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') as string[] : [];
}

function parseSelectedModel(selectedAction: string) {
  return selectedAction.split('#')[0] || selectedAction;
}

export async function getEnsembleDiagnostics(limit = 600) {
  const events = await readLast(limit);

  const ensembleEvents: EnsemblePayload[] = [];
  const xaiEvents: XaiPayload[] = [];

  for (const row of events) {
    const event = asRecord(row);
    const type = String(event.type || '');
    const payload = asRecord(event.payload);

    if (type === 'ensemble_decision') {
      ensembleEvents.push({
        queriedModels: asStringArray(payload.queriedModels),
        participatingModels: asStringArray(payload.participatingModels),
        droppedModels: asStringArray(payload.droppedModels),
        droppedDetails: Array.isArray(payload.droppedDetails)
          ? payload.droppedDetails.map((item) => {
              const record = asRecord(item);
              return {
                model: typeof record.model === 'string' ? record.model : undefined,
                reason: typeof record.reason === 'string' ? record.reason : undefined,
              };
            })
          : [],
        agreementScore: typeof payload.agreementScore === 'number' ? payload.agreementScore : undefined,
        maxMode: typeof payload.maxMode === 'boolean' ? payload.maxMode : undefined,
      });
    }

    if (type === 'xai_decision') {
      xaiEvents.push({
        selectedAction: typeof payload.selectedAction === 'string' ? payload.selectedAction : undefined,
      });
    }
  }

  const queriedCounts = new Map<string, number>();
  const participationCounts = new Map<string, number>();
  const winCounts = new Map<string, number>();
  const droppedReasonCounts = new Map<string, number>();

  let agreementTotal = 0;
  let agreementCount = 0;

  for (const item of ensembleEvents) {
    (item.queriedModels || []).forEach((model) => {
      queriedCounts.set(model, (queriedCounts.get(model) || 0) + 1);
    });

    (item.participatingModels || []).forEach((model) => {
      participationCounts.set(model, (participationCounts.get(model) || 0) + 1);
    });

    (item.droppedDetails || []).forEach((row) => {
      const reason = row.reason || 'unknown';
      droppedReasonCounts.set(reason, (droppedReasonCounts.get(reason) || 0) + 1);
    });

    if (typeof item.agreementScore === 'number') {
      agreementTotal += item.agreementScore;
      agreementCount += 1;
    }
  }

  for (const row of xaiEvents) {
    if (!row.selectedAction) continue;
    const model = parseSelectedModel(row.selectedAction);
    winCounts.set(model, (winCounts.get(model) || 0) + 1);
  }

  const modelUniverse = new Set<string>([
    ...Array.from(queriedCounts.keys()),
    ...Array.from(participationCounts.keys()),
    ...Array.from(winCounts.keys()),
  ]);

  const modelStats = Array.from(modelUniverse).map((model) => {
    const queried = queriedCounts.get(model) || 0;
    const participated = participationCounts.get(model) || 0;
    const wins = winCounts.get(model) || 0;
    const participationRate = queried > 0 ? participated / queried : 0;
    const winRate = participated > 0 ? wins / participated : 0;

    return {
      model,
      queried,
      participated,
      wins,
      participationRate: Number(participationRate.toFixed(4)),
      winRate: Number(winRate.toFixed(4)),
    };
  }).sort((a, b) => b.winRate - a.winRate || b.participationRate - a.participationRate || b.queried - a.queried);

  const dropReasons = Array.from(droppedReasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  const avgAgreement = agreementCount > 0 ? Number((agreementTotal / agreementCount).toFixed(4)) : null;

  return {
    asOf: new Date().toISOString(),
    window: {
      scannedEvents: events.length,
      ensembleDecisions: ensembleEvents.length,
      xaiDecisions: xaiEvents.length,
    },
    consensus: {
      averageAgreement: avgAgreement,
      highDisagreementRate: agreementCount > 0
        ? Number((ensembleEvents.filter((item) => (item.agreementScore ?? 1) < 0.22).length / agreementCount).toFixed(4))
        : null,
      maxModeUsageRate: ensembleEvents.length > 0
        ? Number((ensembleEvents.filter((item) => item.maxMode).length / ensembleEvents.length).toFixed(4))
        : null,
    },
    modelStats,
    droppedReasons: dropReasons,
    recent: ensembleEvents.slice(-10),
  };
}
