import { parseEther } from 'ethers';
import { initRevenueWallet, getRevenueWalletBalance } from './alchemy/connector';
import { readLast } from './logger';

type MetricsSnapshot = {
  lookbackHours: number;
  logsAnalyzed: number;
  walletAddress: string | null;
  walletBalanceWei: bigint;
  payoutsWei: bigint;
  withdrawalsWei: bigint;
  topupsWei: bigint;
  estimatedRevenueInflowWei: bigint;
  transferSuccess: number;
  transferFailed: number;
  transferSuccessRate: number;
  topupCount: number;
  topupErrorCount: number;
  skipCount: number;
  distributionRuns: number;
};

function parseBigIntSafe(value: unknown): bigint {
  try {
    if (value === undefined || value === null || value === '') return BigInt(0);
    return BigInt(String(value));
  } catch {
    return BigInt(0);
  }
}

function parseEthToWeiSafe(value: unknown): bigint {
  try {
    if (value === undefined || value === null || value === '') return BigInt(0);
    return parseEther(String(value).trim());
  } catch {
    return BigInt(0);
  }
}

function parseIsoTime(value: unknown): number {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? ts : Number.NaN;
}

export async function collectMetricsSnapshot(): Promise<MetricsSnapshot> {
  const lookbackHours = Math.max(1, parseInt(process.env.METRICS_LOOKBACK_HOURS || '168', 10));
  const logLimit = Math.max(200, parseInt(process.env.METRICS_LOG_LIMIT || '5000', 10));

  const [rows, walletBalanceRaw] = await Promise.all([
    readLast(logLimit),
    getRevenueWalletBalance(),
  ]);

  const since = Date.now() - lookbackHours * 60 * 60 * 1000;
  const logs = rows.filter((row: any) => {
    const ts = parseIsoTime(row?.time);
    return Number.isFinite(ts) && ts >= since;
  });

  let payoutsWei = BigInt(0);
  let withdrawalsWei = BigInt(0);
  let topupsWei = BigInt(0);

  let transferSuccess = 0;
  let transferFailed = 0;
  let topupCount = 0;
  let topupErrorCount = 0;
  let skipCount = 0;
  let distributionRuns = 0;

  for (const row of logs as any[]) {
    const type = row?.type;
    const payload = row?.payload || {};

    if (type === 'distribution_start' || type === 'distribution_start_token') distributionRuns += 1;

    if (type === 'transfer') {
      transferSuccess += 1;
      payoutsWei += parseBigIntSafe(payload.amount);
    }

    if (type === 'transfer_failed') transferFailed += 1;

    if (type === 'withdraw') {
      withdrawalsWei += parseEthToWeiSafe(payload.amountEther);
    }

    if (type === 'gas_topup') {
      topupCount += 1;
      topupsWei += parseEthToWeiSafe(payload.amount);
    }

    if (type === 'gas_topup_error' || type === 'gas_check_error') {
      topupErrorCount += 1;
    }

    if (
      type === 'distribution_skipped_threshold' ||
      type === 'distribution_skipped_no_gas' ||
      type === 'distribution_skipped_native_gas_reserve' ||
      type === 'distribution_skipped_token_threshold'
    ) {
      skipCount += 1;
    }
  }

  const transferAttempts = transferSuccess + transferFailed;
  const transferSuccessRate = transferAttempts > 0 ? transferSuccess / transferAttempts : 1;
  const walletBalanceWei = parseBigIntSafe(walletBalanceRaw || '0');
  const estimatedRevenueInflowWei = walletBalanceWei + payoutsWei + withdrawalsWei - topupsWei;
  const walletAddress = initRevenueWallet()?.address || null;

  return {
    lookbackHours,
    logsAnalyzed: logs.length,
    walletAddress,
    walletBalanceWei,
    payoutsWei,
    withdrawalsWei,
    topupsWei,
    estimatedRevenueInflowWei,
    transferSuccess,
    transferFailed,
    transferSuccessRate,
    topupCount,
    topupErrorCount,
    skipCount,
    distributionRuns,
  };
}

export async function buildPrometheusMetrics(): Promise<string> {
  const snapshot = await collectMetricsSnapshot();

  const lines = [
    '# HELP ff_wallet_balance_wei Revenue wallet balance in wei',
    '# TYPE ff_wallet_balance_wei gauge',
    `ff_wallet_balance_wei ${snapshot.walletBalanceWei.toString()}`,

    '# HELP ff_estimated_revenue_inflow_wei Estimated inflow over lookback in wei (balance + payouts + withdrawals - topups)',
    '# TYPE ff_estimated_revenue_inflow_wei gauge',
    `ff_estimated_revenue_inflow_wei ${snapshot.estimatedRevenueInflowWei.toString()}`,

    '# HELP ff_payouts_sent_wei Total native payout volume over lookback in wei',
    '# TYPE ff_payouts_sent_wei gauge',
    `ff_payouts_sent_wei ${snapshot.payoutsWei.toString()}`,

    '# HELP ff_withdrawals_wei Total withdrawal volume over lookback in wei',
    '# TYPE ff_withdrawals_wei gauge',
    `ff_withdrawals_wei ${snapshot.withdrawalsWei.toString()}`,

    '# HELP ff_topups_wei Total gas topup volume over lookback in wei',
    '# TYPE ff_topups_wei gauge',
    `ff_topups_wei ${snapshot.topupsWei.toString()}`,

    '# HELP ff_transfer_success_total Successful transfers over lookback',
    '# TYPE ff_transfer_success_total gauge',
    `ff_transfer_success_total ${snapshot.transferSuccess}`,

    '# HELP ff_transfer_failed_total Failed transfers over lookback',
    '# TYPE ff_transfer_failed_total gauge',
    `ff_transfer_failed_total ${snapshot.transferFailed}`,

    '# HELP ff_transfer_success_rate Transfer success ratio over lookback',
    '# TYPE ff_transfer_success_rate gauge',
    `ff_transfer_success_rate ${snapshot.transferSuccessRate}`,

    '# HELP ff_distribution_runs_total Distribution runs over lookback',
    '# TYPE ff_distribution_runs_total gauge',
    `ff_distribution_runs_total ${snapshot.distributionRuns}`,

    '# HELP ff_distribution_skips_total Distribution skip events over lookback',
    '# TYPE ff_distribution_skips_total gauge',
    `ff_distribution_skips_total ${snapshot.skipCount}`,

    '# HELP ff_topup_events_total Successful gas topup events over lookback',
    '# TYPE ff_topup_events_total gauge',
    `ff_topup_events_total ${snapshot.topupCount}`,

    '# HELP ff_topup_errors_total Gas topup-related errors over lookback',
    '# TYPE ff_topup_errors_total gauge',
    `ff_topup_errors_total ${snapshot.topupErrorCount}`,

    '# HELP ff_logs_analyzed_total Number of log rows analyzed over lookback',
    '# TYPE ff_logs_analyzed_total gauge',
    `ff_logs_analyzed_total ${snapshot.logsAnalyzed}`,

    '# HELP ff_metrics_lookback_hours Lookback window in hours used for gauges',
    '# TYPE ff_metrics_lookback_hours gauge',
    `ff_metrics_lookback_hours ${snapshot.lookbackHours}`,
  ];

  return lines.join('\n') + '\n';
}
