#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.vercel.app').replace(/\/$/, '');
const ALERT_URL = process.env.ALERT_WEBHOOK_URL || '';
const ALERT_MENTION = (process.env.ALERT_MENTION || '').trim();

const LOOKBACK_HOURS = Math.max(1, parseInt(process.env.SCORECARD_LOOKBACK_HOURS || '6', 10));
const LOG_LIMIT = Math.max(100, parseInt(process.env.SCORECARD_LOG_LIMIT || '4000', 10));
const MIN_SUCCESS_RATE = Number(process.env.SCORECARD_MIN_SUCCESS_RATE || '0.85');
const MIN_NET_ETH = Number(process.env.SCORECARD_MIN_NET_ETH || '0.001');
const HARD_FAIL_TOPUP_ERRORS = Math.max(0, parseInt(process.env.SCORECARD_HARD_FAIL_TOPUP_ERRORS || '2', 10));
const NO_PAYOUT_MAX_SKIPS = Math.max(10, parseInt(process.env.SCORECARD_NO_PAYOUT_MAX_SKIPS || '120', 10));

function parseBigIntSafe(value) {
  try {
    if (value === undefined || value === null || value === '') return BigInt(0);
    return BigInt(String(value));
  } catch {
    return BigInt(0);
  }
}

function weiToEthNumber(wei) {
  const base = BigInt('1000000000000000000');
  const whole = Number(wei / base);
  const frac = Number(wei % base) / 1e18;
  return whole + frac;
}

function formatEth(eth) {
  return Number(eth).toFixed(6);
}

function isDiscordWebhook(url) {
  return /discord(?:app)?\.com\/api\/webhooks\//i.test(url);
}

function withMention(message) {
  if (!ALERT_MENTION || !isDiscordWebhook(ALERT_URL)) return message;
  return `${ALERT_MENTION} ${message}`;
}

async function sendAlert(message) {
  if (!ALERT_URL) {
    console.log(message);
    return;
  }
  const payload = withMention(message);
  await fetch(ALERT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: payload, text: payload }),
  });
}

async function fetchJson(pathname) {
  const response = await fetch(`${APP_BASE_URL}${pathname}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${pathname}`);
  }
  return response.json();
}

function aggregate(logs) {
  const cutoff = Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000;
  let transferSuccess = 0;
  let transferFailed = 0;
  let skipThreshold = 0;
  let topupErrors = 0;
  let payoutsWei = BigInt(0);
  let topupsWei = BigInt(0);

  for (const row of logs) {
    const ts = Date.parse(row?.time || '');
    if (!Number.isFinite(ts) || ts < cutoff) continue;

    const type = row?.type;
    const payload = row?.payload || {};

    if (type === 'transfer') {
      transferSuccess += 1;
      payoutsWei += parseBigIntSafe(payload.amount);
    }
    if (type === 'transfer_failed') transferFailed += 1;
    if (type === 'distribution_skipped_threshold') skipThreshold += 1;

    if (type === 'gas_topup') {
      const amountEth = Number(payload.amount || 0) || 0;
      const amountWei = BigInt(Math.floor(amountEth * 1e18));
      topupsWei += amountWei;
    }
    if (type === 'gas_topup_error' || type === 'gas_check_error') topupErrors += 1;
  }

  return {
    transferSuccess,
    transferFailed,
    skipThreshold,
    topupErrors,
    payoutsWei,
    topupsWei,
  };
}

function decide(metrics) {
  const attempts = metrics.transferSuccess + metrics.transferFailed;
  const successRate = attempts > 0 ? metrics.transferSuccess / attempts : 1;
  const netEth = weiToEthNumber(metrics.payoutsWei - metrics.topupsWei);

  let score = 0;
  if (metrics.transferSuccess > 0) score += 2;
  if (successRate >= MIN_SUCCESS_RATE) score += 1;
  if (netEth >= MIN_NET_ETH) score += 2;
  if (metrics.topupErrors === 0) score += 1;
  if (metrics.skipThreshold > NO_PAYOUT_MAX_SKIPS) score -= 1;

  const hardFail = metrics.topupErrors >= HARD_FAIL_TOPUP_ERRORS || (attempts >= 5 && successRate < 0.5);

  let decision = 'WATCH';
  if (hardFail || score <= 0) decision = 'KILL';
  else if (score >= 4) decision = 'KEEP';

  return {
    decision,
    score,
    attempts,
    successRate,
    netEth,
  };
}

function buildMessage(wallet, metrics, decision) {
  return [
    `🧮 Profit Scorecard (${LOOKBACK_HOURS}h)`,
    `Decision: ${decision.decision} | score=${decision.score}`,
    `Wallet: ${wallet?.address || 'unknown'}`,
    `Recipients: ${Array.isArray(wallet?.recipients) ? wallet.recipients.length : 0}`,
    `Payout attempts: ${decision.attempts} | success=${metrics.transferSuccess} failed=${metrics.transferFailed} | rate=${(decision.successRate * 100).toFixed(1)}%`,
    `Payouts: ${formatEth(weiToEthNumber(metrics.payoutsWei))} ETH | Topups: ${formatEth(weiToEthNumber(metrics.topupsWei))} ETH | Net: ${formatEth(decision.netEth)} ETH`,
    `Skips(threshold): ${metrics.skipThreshold} | Topup errors: ${metrics.topupErrors}`,
    `Thresholds: min_success_rate=${MIN_SUCCESS_RATE} min_net_eth=${MIN_NET_ETH} hard_fail_topup_errors=${HARD_FAIL_TOPUP_ERRORS}`,
  ].join('\n');
}

async function main() {
  const [wallet, logsPayload] = await Promise.all([
    fetchJson('/api/alchemy/wallet'),
    fetchJson(`/api/alchemy/wallet/logs?limit=${LOG_LIMIT}`),
  ]);

  const logs = Array.isArray(logsPayload?.logs) ? logsPayload.logs : [];
  const metrics = aggregate(logs);
  const summary = decide(metrics);
  const message = buildMessage(wallet, metrics, summary);

  await sendAlert(message);
  console.log(message);

  if (summary.decision === 'KILL') {
    process.exitCode = 2;
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await sendAlert(`❌ Profit scorecard failed: ${message}`);
  } catch {}
  console.error(message);
  process.exit(1);
});
