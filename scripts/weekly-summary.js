/*
 * Weekly profitability summary
 *
 * Aggregates revenue/distribution logs from /api/alchemy/wallet/logs and sends
 * a compact KPI report to ALERT_WEBHOOK_URL (Discord-compatible), or stdout.
 *
 * Usage:
 *   APP_BASE_URL=https://freedomforge-max.up.railway.app node scripts/weekly-summary.js
 *
 * Optional env:
 *   ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...
 *   ALERT_MENTION=<@123...> or <@&456...>
 *   SUMMARY_LOOKBACK_HOURS=168
 *   SUMMARY_LOG_LIMIT=2000
 *   SUMMARY_SOURCE=weekly-kpi
 */

const path = require('path');
const dotenv = require('dotenv');
const { createLogger } = require('../lib/logger');
const logger = createLogger('weekly-summary');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.up.railway.app').replace(/\/$/, '');
const ALERT_URL = process.env.ALERT_WEBHOOK_URL || '';
const ALERT_MENTION = (process.env.ALERT_MENTION || '').trim();
const LOOKBACK_HOURS = Math.max(1, parseInt(process.env.SUMMARY_LOOKBACK_HOURS || '168', 10));
const LOG_LIMIT = Math.max(50, parseInt(process.env.SUMMARY_LOG_LIMIT || '2000', 10));
const SOURCE = process.env.SUMMARY_SOURCE || 'weekly-kpi';

const LOGS_URL = `${APP_BASE_URL}/api/alchemy/wallet/logs?limit=${LOG_LIMIT}`;
const WALLET_URL = `${APP_BASE_URL}/api/alchemy/wallet`;

function isDiscordWebhook(url) {
  return /discord(?:app)?\.com\/api\/webhooks\//i.test(url);
}

function withMention(message) {
  if (!ALERT_MENTION || !isDiscordWebhook(ALERT_URL)) return message;
  return `${ALERT_MENTION} ${message}`;
}

function parseBigIntSafe(value) {
  try {
    if (value === undefined || value === null || value === '') return BigInt(0);
    return BigInt(String(value));
  } catch {
    return BigInt(0);
  }
}

function formatWeiAsEth(wei) {
  const negative = wei < 0;
  const abs = negative ? -wei : wei;
  const base = BigInt('1000000000000000000');
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '');
  const result = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return negative ? `-${result}` : result;
}

async function sendAlert(message) {
  if (!ALERT_URL) {
    console.log(message);
    return;
  }
  const finalMessage = withMention(message);
  const body = JSON.stringify({ content: finalMessage, text: finalMessage });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(ALERT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok || res.status < 500) return;
      } finally { clearTimeout(timer); }
    } catch (err) { logger.warn('alert retry failed', { attempt, error: err?.message || err }); }
    if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`request failed (${response.status}) for ${url}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function summarizeLogs(logs) {
  const now = Date.now();
  const sinceMs = now - LOOKBACK_HOURS * 60 * 60 * 1000;

  const filtered = logs.filter((entry) => {
    const ts = Date.parse(entry?.time || '');
    return Number.isFinite(ts) && ts >= sinceMs;
  });

  let nativeSentWei = BigInt(0);
  let tokenSentWei = BigInt(0);
  let gasTopupEth = 0;
  let withdrawalEth = 0;

  const counts = {
    distributionStartNative: 0,
    distributionStartToken: 0,
    transferNativeSuccess: 0,
    transferNativeFailed: 0,
    transferTokenSuccess: 0,
    transferTokenFailed: 0,
    gasTopup: 0,
    gasTopupError: 0,
    gasCheckError: 0,
    tokenBalanceError: 0,
    skippedNativeThreshold: 0,
    skippedTokenThreshold: 0,
    withdraw: 0,
  };

  for (const entry of filtered) {
    const type = entry?.type;
    const payload = entry?.payload || {};

    if (type === 'distribution_start') counts.distributionStartNative += 1;
    if (type === 'distribution_start_token') counts.distributionStartToken += 1;

    if (type === 'transfer') {
      counts.transferNativeSuccess += 1;
      nativeSentWei += parseBigIntSafe(payload.amount);
    }

    if (type === 'transfer_failed') counts.transferNativeFailed += 1;

    if (type === 'transfer_token') {
      counts.transferTokenSuccess += 1;
      tokenSentWei += parseBigIntSafe(payload.amount);
    }

    if (type === 'transfer_token_failed') counts.transferTokenFailed += 1;

    if (type === 'gas_topup') {
      counts.gasTopup += 1;
      gasTopupEth += Number(payload.amount || 0) || 0;
    }

    if (type === 'gas_topup_error') counts.gasTopupError += 1;
    if (type === 'gas_check_error') counts.gasCheckError += 1;
    if (type === 'token_balance_error') counts.tokenBalanceError += 1;
    if (type === 'distribution_skipped_threshold') counts.skippedNativeThreshold += 1;
    if (type === 'distribution_skipped_token_threshold') counts.skippedTokenThreshold += 1;

    if (type === 'withdraw') {
      counts.withdraw += 1;
      withdrawalEth += Number(payload.amountEther || 0) || 0;
    }
  }

  const nativeAttempts = counts.transferNativeSuccess + counts.transferNativeFailed;
  const tokenAttempts = counts.transferTokenSuccess + counts.transferTokenFailed;
  const nativeSuccessRate = nativeAttempts === 0 ? 100 : Math.round((counts.transferNativeSuccess / nativeAttempts) * 100);
  const tokenSuccessRate = tokenAttempts === 0 ? 100 : Math.round((counts.transferTokenSuccess / tokenAttempts) * 100);

  return {
    filteredCount: filtered.length,
    counts,
    nativeSentWei,
    tokenSentWei,
    gasTopupEth,
    withdrawalEth,
    nativeAttempts,
    tokenAttempts,
    nativeSuccessRate,
    tokenSuccessRate,
  };
}

function buildMessage(summary, wallet) {
  const { counts } = summary;
  const currentBalanceWei = parseBigIntSafe(wallet?.balance || '0');
  const address = wallet?.address || 'unknown';

  const lines = [
    `📊 Revenue Weekly Summary (${SOURCE})`,
    `Window: last ${LOOKBACK_HOURS}h`,
    `Wallet: ${address}`,
    `Current balance: ${formatWeiAsEth(currentBalanceWei)} ETH (${currentBalanceWei.toString()} wei)`,
    `Native payouts: ${summary.nativeAttempts} attempts, ${counts.transferNativeSuccess} success, ${counts.transferNativeFailed} failed (${summary.nativeSuccessRate}% success)`,
    `Native sent: ${formatWeiAsEth(summary.nativeSentWei)} ETH (${summary.nativeSentWei.toString()} wei)`,
    `Token payouts: ${summary.tokenAttempts} attempts, ${counts.transferTokenSuccess} success, ${counts.transferTokenFailed} failed (${summary.tokenSuccessRate}% success)`,
    `Token sent (raw wei): ${summary.tokenSentWei.toString()}`,
    `Distribution runs: native ${counts.distributionStartNative}, token ${counts.distributionStartToken}`,
    `Gas topups: ${counts.gasTopup} (total ${summary.gasTopupEth.toFixed(4)} ETH), errors ${counts.gasTopupError + counts.gasCheckError}`,
    `Skipped: native threshold ${counts.skippedNativeThreshold}, token threshold ${counts.skippedTokenThreshold}`,
    `Withdrawals: ${counts.withdraw} (total ${summary.withdrawalEth.toFixed(4)} ETH)`,
    `Other critical errors: token balance ${counts.tokenBalanceError}`,
    `Logs analyzed: ${summary.filteredCount}`,
  ];

  return lines.join('\n');
}

async function main() {
  const [logsPayload, walletPayload] = await Promise.all([
    fetchJson(LOGS_URL),
    fetchJson(WALLET_URL),
  ]);

  const logs = Array.isArray(logsPayload?.logs) ? logsPayload.logs : [];
  const summary = summarizeLogs(logs);
  const message = buildMessage(summary, walletPayload || {});

  await sendAlert(message);
  console.log('weekly-summary: sent');
}

main().catch(async (error) => {
  const message = error?.message || String(error);
  console.error('weekly-summary failed:', message);
  try {
    await sendAlert(`❌ Weekly summary failed: ${message}`);
  } catch (alertErr) { logger.warn('failed to send failure alert', { error: alertErr?.message || alertErr }); }
  process.exit(1);
});
