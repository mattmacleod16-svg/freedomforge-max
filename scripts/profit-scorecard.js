#!/usr/bin/env node
/**
 * FreedomForge Profit Scorecard + Ironclad Owner Payout Protocol
 *
 * Mission Hardening:
 *   - Enforces 15% minimum payout (can never decrease)
 *   - Tracks payout state in data/payout-state.json
 *   - Escalation: +1% every 90 consecutive profit days
 *   - Updates payout history for dashboard transparency
 *   - Owner wallet: 0xEbf5Fc610Bd7BC27Fc1E26596DD1da186C1436b9 (Base/USDC)
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PAYOUT_STATE_FILE = path.join(DATA_DIR, 'payout-state.json');

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.vercel.app').replace(/\/$/, '');
const ALERT_URL = process.env.ALERT_WEBHOOK_URL || '';
const ALERT_MENTION = (process.env.ALERT_MENTION || '').trim();

const LOOKBACK_HOURS = Math.max(1, parseInt(process.env.SCORECARD_LOOKBACK_HOURS || '6', 10));
const LOG_LIMIT = Math.max(100, parseInt(process.env.SCORECARD_LOG_LIMIT || '4000', 10));
const MIN_SUCCESS_RATE = Number(process.env.SCORECARD_MIN_SUCCESS_RATE || '0.85');
const MIN_NET_ETH = Number(process.env.SCORECARD_MIN_NET_ETH || '0.001');
const HARD_FAIL_TOPUP_ERRORS = Math.max(0, parseInt(process.env.SCORECARD_HARD_FAIL_TOPUP_ERRORS || '2', 10));
const NO_PAYOUT_MAX_SKIPS = Math.max(10, parseInt(process.env.SCORECARD_NO_PAYOUT_MAX_SKIPS || '120', 10));

// ─── Payout State Management (Ironclad Protocol) ─────────────────────────────
function readPayoutState() {
  try {
    if (rio) return rio.readJsonSafe(PAYOUT_STATE_FILE, { fallback: null });
    return JSON.parse(fs.readFileSync(PAYOUT_STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writePayoutState(state) {
  state.updatedAt = new Date().toISOString();
  if (rio) {
    rio.writeJsonAtomic(PAYOUT_STATE_FILE, state);
  } else {
    // Atomic write: tmp + rename (crash-safe)
    const tmp = PAYOUT_STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, PAYOUT_STATE_FILE);
  }
}

function enforcePayoutFloor(state) {
  // Ironclad: payout can NEVER go below 15%
  const FLOOR = 15;
  if (!state) return;
  if ((state.payoutPct || 0) < FLOOR) {
    state.payoutPct = FLOOR;
    console.log(`[IRONCLAD] Payout restored to ${FLOOR}% floor`);
  }
  state.payoutPctFloor = FLOOR;
}

function checkEscalation(state) {
  if (!state || !state.escalationEnabled) return;
  const streakDays = state.consecutiveProfitDays || 0;
  const threshold = state.escalationRules?.profitStreakDaysForEscalation || 90;
  const increment = state.escalationRules?.escalationIncrementPct || 1;
  const newEscalation = Math.floor(streakDays / threshold) * increment;
  if (newEscalation > (state.currentEscalationPct || 0)) {
    state.currentEscalationPct = newEscalation;
    state.payoutPct = Math.max(state.payoutPctFloor || 15, 15) + newEscalation;
    console.log(`[IRONCLAD] Payout escalated to ${state.payoutPct}% (+${newEscalation}% from ${streakDays}-day streak)`);
  }
}

function recordPayoutRun(state, decision, metrics) {
  if (!state) return;
  enforcePayoutFloor(state);
  checkEscalation(state);
  // Append to history (keep last 100)
  if (!state.payoutHistory) state.payoutHistory = [];
  state.payoutHistory.push({
    ts: new Date().toISOString(),
    decision: decision.decision,
    score: decision.score,
    netEth: decision.netEth,
    successRate: decision.successRate,
    payoutPct: state.payoutPct,
  });
  if (state.payoutHistory.length > 100) state.payoutHistory = state.payoutHistory.slice(-100);
  writePayoutState(state);
}

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
  const body = JSON.stringify({ content: payload, text: payload });
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
    } catch {}
    if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
  }
}

async function fetchJson(pathname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${APP_BASE_URL}${pathname}`, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${pathname}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
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

  // ─── Ironclad Protocol: Track payout state ────────────────────────
  const payoutState = readPayoutState();
  if (payoutState) {
    recordPayoutRun(payoutState, summary, metrics);
    console.log(`[IRON] Payout state updated: ${payoutState.payoutPct}% | Wallet: ${payoutState.wallet?.slice(0,10)}...`);
  }

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
