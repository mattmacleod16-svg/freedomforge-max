/*
 * Generate ops patch recommendations
 *
 * Produces repository files that can be proposed as a pull request:
 * - ops/recommended-env-overrides.env
 * - ops/strategy-recommendations.md
 *
 * Data source:
 * - /api/alchemy/wallet/logs
 * - /api/alchemy/wallet
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.up.railway.app').replace(/\/$/, '');
const LOOKBACK_HOURS = Math.max(24, parseInt(process.env.PATCH_LOOKBACK_HOURS || '720', 10));
const LOG_LIMIT = Math.max(100, parseInt(process.env.PATCH_LOG_LIMIT || '4000', 10));

const LOGS_URL = `${APP_BASE_URL}/api/alchemy/wallet/logs?limit=${LOG_LIMIT}`;
const WALLET_URL = `${APP_BASE_URL}/api/alchemy/wallet`;

const OPS_DIR = path.resolve(process.cwd(), 'ops');
const ENV_PATCH_FILE = path.join(OPS_DIR, 'recommended-env-overrides.env');
const REPORT_FILE = path.join(OPS_DIR, 'strategy-recommendations.md');

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
  const fracStr = frac.toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
  const text = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return negative ? `-${text}` : text;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`request failed (${response.status}) for ${url}`);
    return response.json();
  } finally { clearTimeout(timer); }
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

  const nativeAttempts = counts.transferSuccess + counts.transferFail;
  const tokenAttempts = counts.transferTokenSuccess + counts.transferTokenFail;
  const nativeFailRatePct = nativeAttempts > 0 ? Math.round((counts.transferFail / nativeAttempts) * 100) : 0;
  const tokenFailRatePct = tokenAttempts > 0 ? Math.round((counts.transferTokenFail / tokenAttempts) * 100) : 0;

  return {
    filteredCount: filtered.length,
    counts,
    nativeAttempts,
    tokenAttempts,
    nativeFailRatePct,
    tokenFailRatePct,
    nativeSentWei,
    tokenSentWei,
  };
}

function inferPatch(summary, wallet) {
  const c = summary.counts;
  const env = {};
  const reasons = [];

  if (summary.nativeFailRatePct >= 10 || summary.tokenFailRatePct >= 10) {
    env.DISTRIBUTION_MAX_RETRIES = '5';
    env.DISTRIBUTION_RETRY_BASE_MS = '2000';
    reasons.push('High transfer failure rate detected; increase retry budget and backoff to improve successful sends.');
  }

  if (c.skippedNativeThreshold >= 8) {
    env.MIN_PAYOUT_ETH = '0';
    reasons.push('Frequent native threshold skips detected; lower native payout threshold to 0 to avoid missed distribution windows.');
  }

  if (c.skippedTokenThreshold >= 8) {
    env.MIN_PAYOUT_TOKEN_WEI = '0';
    reasons.push('Frequent token threshold skips detected; lower token payout threshold to 0 to increase distribution frequency.');
  }

  if (c.gasTopupError + c.gasCheckError > 0) {
    env.GAS_TOPUP_THRESHOLD = '0.02';
    env.GAS_TOPUP_AMOUNT = '0.08';
    reasons.push('Gas management errors detected; recommend raising top-up threshold and amount to reduce low-gas transfer failures.');
  }

  if (c.distributionStart + c.distributionStartToken === 0) {
    reasons.push('No distribution starts seen in lookback; review payout thresholds and inbound flow before enabling any success notifications.');
  }

  if (Object.keys(env).length === 0) {
    reasons.push('No high-impact reliability regressions detected; keep current env parameters unchanged.');
  }

  return {
    env,
    reasons,
    walletAddress: wallet?.address || 'unknown',
    walletBalanceWei: parseBigIntSafe(wallet?.balance || '0'),
  };
}

function buildEnvPatch(envPatch) {
  const lines = [];
  lines.push('# Auto-generated by scripts/generate-ops-patch.js');
  lines.push(`# Generated at ${new Date().toISOString()}`);
  lines.push('# Apply selectively to your Railway/GitHub environment variables');
  lines.push('');

  const keys = Object.keys(envPatch);
  if (keys.length === 0) {
    lines.push('# No parameter changes recommended this cycle.');
    return lines.join('\n') + '\n';
  }

  for (const key of keys.sort()) {
    lines.push(`${key}=${envPatch[key]}`);
  }

  return lines.join('\n') + '\n';
}

function buildReport(summary, patch) {
  const c = summary.counts;
  const lines = [];
  lines.push('# Monthly Ops Patch Recommendations');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Lookback window: last ${LOOKBACK_HOURS} hours`);
  lines.push('');
  lines.push('## Current Snapshot');
  lines.push(`- Wallet: ${patch.walletAddress}`);
  lines.push(`- Wallet balance: ${formatWeiAsEth(patch.walletBalanceWei)} ETH (${patch.walletBalanceWei.toString()} wei)`);
  lines.push(`- Native payout attempts: ${summary.nativeAttempts} (fail rate ${summary.nativeFailRatePct}%)`);
  lines.push(`- Token payout attempts: ${summary.tokenAttempts} (fail rate ${summary.tokenFailRatePct}%)`);
  lines.push(`- Distribution starts: native ${c.distributionStart}, token ${c.distributionStartToken}`);
  lines.push(`- Threshold skips: native ${c.skippedNativeThreshold}, token ${c.skippedTokenThreshold}`);
  lines.push(`- Gas errors: ${c.gasTopupError + c.gasCheckError}`);
  lines.push(`- Token balance errors: ${c.tokenBalanceError}`);
  lines.push(`- Native sent: ${formatWeiAsEth(summary.nativeSentWei)} ETH`);
  lines.push(`- Token sent (raw wei): ${summary.tokenSentWei.toString()}`);
  lines.push(`- Logs analyzed: ${summary.filteredCount}`);
  lines.push('');
  lines.push('## Recommendations');
  patch.reasons.forEach((r) => lines.push(`- ${r}`));
  lines.push('');
  lines.push('## Proposed Env Patch File');
  lines.push('- See `ops/recommended-env-overrides.env` for suggested parameter values.');
  lines.push('- Apply these to deployment environment variables (Railway/GitHub), then monitor weekly summary deltas.');
  lines.push('');
  return lines.join('\n') + '\n';
}

async function main() {
  const [logsPayload, walletPayload] = await Promise.all([
    fetchJson(LOGS_URL),
    fetchJson(WALLET_URL),
  ]);

  const logs = Array.isArray(logsPayload?.logs) ? logsPayload.logs : [];
  const summary = summarize(logs);
  const patch = inferPatch(summary, walletPayload || {});

  fs.mkdirSync(OPS_DIR, { recursive: true });
  const envTmp = ENV_PATCH_FILE + '.tmp';
  fs.writeFileSync(envTmp, buildEnvPatch(patch.env), 'utf8');
  fs.renameSync(envTmp, ENV_PATCH_FILE);
  const reportTmp = REPORT_FILE + '.tmp';
  fs.writeFileSync(reportTmp, buildReport(summary, patch), 'utf8');
  fs.renameSync(reportTmp, REPORT_FILE);

  console.log('generate-ops-patch: wrote');
  console.log(ENV_PATCH_FILE);
  console.log(REPORT_FILE);
}

main().catch((error) => {
  console.error('generate-ops-patch failed:', error?.message || String(error));
  process.exit(1);
});
