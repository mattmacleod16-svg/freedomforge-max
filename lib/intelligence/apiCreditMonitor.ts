/**
 * API Credit Monitor
 * Tracks per-provider AI query spend for cost monitoring and self-funding loop.
 */

interface SpendRecord {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  timestamp: number;
}

// Per-model cost estimates (USD per 1M tokens, input/output)
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  default: { input: 0.50, output: 1.50 },
};

function estimateCost(modelName: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_COSTS[modelName] ?? MODEL_COSTS.default;
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

const spendLog: SpendRecord[] = [];
let totalSpendUsd = 0;

/**
 * Record API spend for a completed model query.
 * Called by modelOrchestrator after each successful response.
 */
export function recordApiSpend(
  modelName: string,
  inputTokens: number,
  outputTokens: number
): void {
  const estimatedCostUsd = estimateCost(modelName, inputTokens, outputTokens);
  const record: SpendRecord = {
    modelName,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    timestamp: Date.now(),
  };
  spendLog.push(record);
  totalSpendUsd += estimatedCostUsd;
}

/**
 * Get total estimated spend since process start.
 */
export function getTotalSpendUsd(): number {
  return totalSpendUsd;
}

/**
 * Get recent spend records (last N entries).
 */
export function getRecentSpend(limit = 100): SpendRecord[] {
  return spendLog.slice(-limit);
}

/**
 * Get spend summary grouped by model.
 */
export function getSpendByModel(): Record<string, { calls: number; totalCostUsd: number }> {
  const summary: Record<string, { calls: number; totalCostUsd: number }> = {};
  for (const record of spendLog) {
    if (!summary[record.modelName]) {
      summary[record.modelName] = { calls: 0, totalCostUsd: 0 };
    }
    summary[record.modelName].calls++;
    summary[record.modelName].totalCostUsd += record.estimatedCostUsd;
  }
  return summary;
}
