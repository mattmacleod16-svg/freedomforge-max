/*
 * Monthly strategy recommendation report
 *
 * Reviews the last month of operational/revenue logs and posts concrete
 * parameter recommendations to improve reliability and payout throughput.
 *
 * Usage:
 *   APP_BASE_URL=https://freedomforge-max.vercel.app node scripts/monthly-strategy.js
 *
 * Optional env:
 *   ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...
 *   ALERT_MENTION=<@123...> or <@&456...>
 *   STRATEGY_LOOKBACK_HOURS=720
 *   STRATEGY_LOG_LIMIT=4000
 *   STRATEGY_SOURCE=monthly-strategy
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.vercel.app').replace(/\/$/, '');
const ALERT_URL = process.env.ALERT_WEBHOOK_URL || '';
const ALERT_MENTION = (process.env.ALERT_MENTION || '').trim();
const LOOKBACK_HOURS = Math.max(24, parseInt(process.env.STRATEGY_LOOKBACK_HOURS || '720', 10));
const LOG_LIMIT = Math.max(100, parseInt(process.env.STRATEGY_LOG_LIMIT || '4000', 10));
const SOURCE = process.env.STRATEGY_SOURCE || 'monthly-strategy';

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
  const abs = wei < 0 ? -wei : wei;
  const base = BigInt('1000000000000000000');
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
  const text = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return wei < 0 ? `-${text}` : text;
}

async function sendAlert(message) {
  if (!ALERT_URL) {
    console.log(message);
    return;
  }
  const finalMessage = withMention(message);
  await fetch(ALERT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: finalMessage, text: finalMessage }),
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`request failed (${response.status}) for ${url}`);
  return response.json();
}

function summarize(logs) {
  const now = Date.now();
  const since = now - LOOKBACK_HOURS * 60 * 60 * 1000;
  const filtered = logs.filter((entry) => {
    const ts = Date.parse(entry?.time || '');
    return Number.isFinite(ts) && ts >= since;
  });

  const counts = {
    distributionStart: 0,
    distributionStartToken: 0,
    transferSuccess: 0,
    transferFail: 0,
    transferTokenSuccess: 0,
    transferTokenFail: 0,
    gasTopup: 0,
    gasTopupError: 0,
    gasCheckError: 0,
    tokenBalanceError: 0,
    skippedNativeThreshold: 0,
    skippedTokenThreshold: 0,
  };

  let nativeSentWei = BigInt(0);
  let tokenSentWei = BigInt(0);

  for (const row of filtered) {
    const type = row?.type;
    const payload = row?.payload || {};
    if (type === 'distribution_start') counts.distributionStart += 1;
    if (type === 'distribution_start_token') counts.distributionStartToken += 1;
    if (type === 'transfer') {
      counts.transferSuccess += 1;
      nativeSentWei += parseBigIntSafe(payload.amount);
    }
    if (type === 'transfer_failed') counts.transferFail += 1;
    if (type === 'transfer_token') {
      counts.transferTokenSuccess += 1;
      tokenSentWei += parseBigIntSafe(payload.amount);
    }
    if (type === 'transfer_token_failed') counts.transferTokenFail += 1;
    if (type === 'gas_topup') counts.gasTopup += 1;
    if (type === 'gas_topup_error') counts.gasTopupError += 1;
    if (type === 'gas_check_error') counts.gasCheckError += 1;
    if (type === 'token_balance_error') counts.tokenBalanceError += 1;
    if (type === 'distribution_skipped_threshold') counts.skippedNativeThreshold += 1;
    if (type === 'distribution_skipped_token_threshold') counts.skippedTokenThreshold += 1;
  }

  return { filtered, counts, nativeSentWei, tokenSentWei };
}

function recommendations(summary) {
  const recs = [];
  const c = summary.counts;

  const nativeAttempts = c.transferSuccess + c.transferFail;
  const tokenAttempts = c.transferTokenSuccess + c.transferTokenFail;
  const nativeFailRate = nativeAttempts > 0 ? c.transferFail / nativeAttempts : 0;
  const tokenFailRate = tokenAttempts > 0 ? c.transferTokenFail / tokenAttempts : 0;

  if (c.distributionStart + c.distributionStartToken === 0) {
    recs.push('No distributions ran this month. Lower `MIN_PAYOUT_ETH` / `MIN_PAYOUT_TOKEN_WEI` or increase funding/traffic so payouts trigger more often.');
  }

  if (c.skippedNativeThreshold >= 5 || c.skippedTokenThreshold >= 5) {
    recs.push('Frequent threshold skips detected. Consider reducing payout thresholds to increase distribution frequency.');
  }

  if (nativeFailRate >= 0.1 || tokenFailRate >= 0.1) {
    recs.push('Transfer failure rate is high. Increase `DISTRIBUTION_MAX_RETRIES` and `DISTRIBUTION_RETRY_BASE_MS` for more resilient sends.');
  }

  if (c.gasTopupError + c.gasCheckError > 0) {
    recs.push('Gas management errors occurred. Verify `FUNDING_PRIVATE_KEY`, `GAS_TOPUP_THRESHOLD`, and `GAS_TOPUP_AMOUNT` are set correctly.');
  }

  if (c.tokenBalanceError > 0) {
    recs.push('Token balance errors detected. Validate `PAYOUT_TOKEN_ADDRESS`, network configuration, and token contract health.');
  }

  if (recs.length === 0) {
    recs.push('System health looks stable. Keep current distribution settings and focus on scaling inbound revenue volume.');
  }

  return {
    nativeAttempts,
    tokenAttempts,
    nativeFailRate: Math.round(nativeFailRate * 100),
    tokenFailRate: Math.round(tokenFailRate * 100),
    recs,
  };
}

function buildMessage(summary, analysis, wallet) {
  const c = summary.counts;
  const walletAddress = wallet?.address || 'unknown';
  const walletBalance = parseBigIntSafe(wallet?.balance || '0');

  const lines = [
    `🧠 Monthly Strategy Report (${SOURCE})`,
    `Window: last ${LOOKBACK_HOURS}h`,
    `Wallet: ${walletAddress}`,
    `Current balance: ${formatWeiAsEth(walletBalance)} ETH`,
    `Native volume sent: ${formatWeiAsEth(summary.nativeSentWei)} ETH | attempts ${analysis.nativeAttempts} | fail rate ${analysis.nativeFailRate}%`,
    `Token volume sent (raw wei): ${summary.tokenSentWei.toString()} | attempts ${analysis.tokenAttempts} | fail rate ${analysis.tokenFailRate}%`,
    `Distribution runs: native ${c.distributionStart}, token ${c.distributionStartToken}`,
    `Threshold skips: native ${c.skippedNativeThreshold}, token ${c.skippedTokenThreshold}`,
    `Gas/topup issues: ${c.gasTopupError + c.gasCheckError} | Token balance errors: ${c.tokenBalanceError}`,
    'Recommended actions:',
    ...analysis.recs.map((r, i) => `${i + 1}) ${r}`),
  ];

  return lines.join('\n');
}

async function main() {
  const [logsPayload, walletPayload] = await Promise.all([
    fetchJson(LOGS_URL),
    fetchJson(WALLET_URL),
  ]);

  const logs = Array.isArray(logsPayload?.logs) ? logsPayload.logs : [];
  const summary = summarize(logs);
  const analysis = recommendations(summary);
  const message = buildMessage(summary, analysis, walletPayload || {});

  await sendAlert(message);
  console.log('monthly-strategy: sent');
}

main().catch(async (error) => {
  const message = error?.message || String(error);
  console.error('monthly-strategy failed:', message);
  try {
    await sendAlert(`❌ Monthly strategy report failed: ${message}`);
  } catch {}
  process.exit(1);
});
