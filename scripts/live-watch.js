/*
 * Live revenue/bot monitor
 *
 * Polls wallet + logs and prints a compact real-time status panel.
 *
 * Usage:
 *   APP_BASE_URL=https://freedomforge-max.up.railway.app npm run watch:live
 *
 * Optional env:
 *   WATCH_INTERVAL_MS=15000
 *   WATCH_LOOKBACK_HOURS=168
 *   WATCH_LOG_LIMIT=2000
 *   WATCH_ONCE=true
 */

const path = require('path');
const dotenv = require('dotenv');
const { parseEther } = require('ethers');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.up.railway.app').replace(/\/$/, '');
const WATCH_INTERVAL_MS = Math.max(5000, parseInt(process.env.WATCH_INTERVAL_MS || '15000', 10));
const WATCH_LOOKBACK_HOURS = Math.max(1, parseInt(process.env.WATCH_LOOKBACK_HOURS || '168', 10));
const WATCH_LOG_LIMIT = Math.max(100, parseInt(process.env.WATCH_LOG_LIMIT || '2000', 10));
const WATCH_ONCE = String(process.env.WATCH_ONCE || 'false').toLowerCase() === 'true';

const LOGS_URL = `${APP_BASE_URL}/api/alchemy/wallet/logs?limit=${WATCH_LOG_LIMIT}`;
const WALLET_URL = `${APP_BASE_URL}/api/alchemy/wallet`;

function parseBigIntSafe(value) {
  try {
    if (value === undefined || value === null || value === '') return BigInt(0);
    return BigInt(String(value));
  } catch {
    return BigInt(0);
  }
}

function ethToWeiSafe(value) {
  try {
    if (value === undefined || value === null || value === '') return BigInt(0);
    return parseEther(String(value));
  } catch {
    return BigInt(0);
  }
}

function formatWeiAsEth(wei, decimals = 6) {
  const negative = wei < 0;
  const abs = negative ? -wei : wei;
  const base = BigInt('1000000000000000000');
  const whole = abs / base;
  const frac = abs % base;
  const fracText = frac.toString().padStart(18, '0').slice(0, decimals).replace(/0+$/, '');
  const out = fracText ? `${whole}.${fracText}` : `${whole}`;
  return negative ? `-${out}` : out;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`request failed (${response.status}) for ${url}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function summarize(logs, currentBalanceWei) {
  const since = Date.now() - WATCH_LOOKBACK_HOURS * 60 * 60 * 1000;
  const filtered = logs.filter((row) => {
    const ts = Date.parse(row?.time || '');
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

  for (const row of filtered) {
    const type = row?.type;
    const payload = row?.payload || {};

    if (type === 'transfer') {
      transferSuccess += 1;
      payoutsWei += parseBigIntSafe(payload.amount);
    }

    if (type === 'transfer_failed') transferFailed += 1;

    if (type === 'withdraw') {
      withdrawalsWei += ethToWeiSafe(payload.amountEther);
    }

    if (type === 'gas_topup') {
      topupCount += 1;
      topupsWei += ethToWeiSafe(payload.amount);
    }

    if (type === 'gas_topup_error' || type === 'gas_check_error') {
      topupErrorCount += 1;
    }

    if (
      type === 'distribution_skipped_threshold' ||
      type === 'distribution_skipped_native_gas_reserve' ||
      type === 'distribution_skipped_no_gas' ||
      type === 'distribution_skipped_token_threshold'
    ) {
      skipCount += 1;
    }
  }

  const attempts = transferSuccess + transferFailed;
  const successRate = attempts > 0 ? Math.round((transferSuccess / attempts) * 100) : 100;

  // Revenue estimate excludes treasury gas topups as bot-created value.
  const estimatedRevenueInflowWei = currentBalanceWei + payoutsWei + withdrawalsWei - topupsWei;

  return {
    filteredCount: filtered.length,
    payoutsWei,
    withdrawalsWei,
    topupsWei,
    estimatedRevenueInflowWei,
    transferSuccess,
    transferFailed,
    successRate,
    topupCount,
    topupErrorCount,
    skipCount,
    recent: filtered.slice(-5),
  };
}

function render(snapshot) {
  const {
    now,
    walletAddress,
    currentBalanceWei,
    recipientsCount,
    summary,
  } = snapshot;

  const lines = [
    `\n===== FreedomForge Live Watch @ ${now} =====`,
    `Wallet: ${walletAddress}`,
    `Balance: ${formatWeiAsEth(currentBalanceWei)} ETH`,
    `Recipients: ${recipientsCount}`,
    `Window: last ${WATCH_LOOKBACK_HOURS}h (logs analyzed: ${summary.filteredCount})`,
    `Estimated revenue inflow (ex-topups): ${formatWeiAsEth(summary.estimatedRevenueInflowWei)} ETH`,
    `Payouts sent: ${formatWeiAsEth(summary.payoutsWei)} ETH | Withdrawals: ${formatWeiAsEth(summary.withdrawalsWei)} ETH`,
    `Treasury topups: ${formatWeiAsEth(summary.topupsWei)} ETH (${summary.topupCount} events, errors ${summary.topupErrorCount})`,
    `Transfer reliability: ${summary.transferSuccess}/${summary.transferSuccess + summary.transferFailed} success (${summary.successRate}%) | skips ${summary.skipCount}`,
    'Recent events:',
  ];

  for (const row of summary.recent) {
    const t = row?.time ? new Date(row.time).toLocaleString() : 'n/a';
    const type = row?.type || 'unknown';
    lines.push(`- ${t} | ${type}`);
  }

  return lines.join('\n');
}

async function checkOnce() {
  const [wallet, logsPayload] = await Promise.all([
    fetchJson(WALLET_URL),
    fetchJson(LOGS_URL),
  ]);

  const logs = Array.isArray(logsPayload?.logs) ? logsPayload.logs : [];
  const currentBalanceWei = parseBigIntSafe(wallet?.balance || '0');
  const summary = summarize(logs, currentBalanceWei);

  const snapshot = {
    now: new Date().toLocaleString(),
    walletAddress: wallet?.address || 'unknown',
    recipientsCount: Array.isArray(wallet?.recipients) ? wallet.recipients.length : 0,
    currentBalanceWei,
    summary,
  };

  console.log(render(snapshot));
}

async function main() {
  await checkOnce();
  if (WATCH_ONCE) return;

  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      console.clear();
      await checkOnce();
    } catch (error) {
      console.error('live-watch error:', error?.message || String(error));
    } finally {
      running = false;
    }
  }, WATCH_INTERVAL_MS);
}

main().catch((error) => {
  console.error('live-watch failed:', error?.message || String(error));
  process.exit(1);
});
