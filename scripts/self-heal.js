/*
 * Self-heal monitor
 *
 * Detects service issues, alerts via webhook, attempts remediation,
 * then notifies when cleared (or unresolved).
 *
 * Usage:
 *   APP_BASE_URL=https://freedomforge-max.vercel.app node scripts/self-heal.js
 *
 * Optional env:
 *   ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...
 *   ALERT_MENTION=<@123...> or <@&456...>
 *   SELF_HEAL_NOTIFY_OK=false
 *   SELF_HEAL_TIMEOUT_MS=10000
 *   SELF_HEAL_PROFIT_GUARD_ENABLED=true
 *   SELF_HEAL_PROFIT_GUARD_LOOKBACK_HOURS=2
 *   SELF_HEAL_PROFIT_GUARD_MIN_NET_ETH=0.0005
 *   SELF_HEAL_PROFIT_GUARD_MIN_SUCCESS_RATE=0.75
 *   SELF_HEAL_PROFIT_GUARD_MIN_ATTEMPTS=3
 *   SELF_HEAL_PROFIT_GUARD_LOG_LIMIT=800
 *   SELF_HEAL_DRY_RUN=false
 */

const path = require('path');
const fs = require('fs/promises');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.vercel.app').replace(/\/$/, '');
const ALERT_URL = process.env.ALERT_WEBHOOK_URL || '';
const ALERT_MENTION = (process.env.ALERT_MENTION || '').trim();
const ALERT_MODE = String(process.env.SELF_HEAL_ALERT_MODE || 'critical').toLowerCase();
const TIMEOUT_MS = parseInt(process.env.SELF_HEAL_TIMEOUT_MS || '10000', 10);
const NOTIFY_OK = String(process.env.SELF_HEAL_NOTIFY_OK || 'false').toLowerCase() === 'true';
const REMEDIATION_PAUSE_MS = parseInt(process.env.SELF_HEAL_REMEDIATION_PAUSE_MS || '5000', 10);
const PROFIT_GUARD_ENABLED = String(process.env.SELF_HEAL_PROFIT_GUARD_ENABLED || 'true').toLowerCase() !== 'false';
const PROFIT_GUARD_LOOKBACK_HOURS = Math.max(1, parseInt(process.env.SELF_HEAL_PROFIT_GUARD_LOOKBACK_HOURS || '2', 10));
const PROFIT_GUARD_MIN_NET_ETH = Math.max(0.0001, Math.min(1.0, Number(process.env.SELF_HEAL_PROFIT_GUARD_MIN_NET_ETH || '0.0005')));
const PROFIT_GUARD_MIN_SUCCESS_RATE = Math.max(0.1, Math.min(1.0, Number(process.env.SELF_HEAL_PROFIT_GUARD_MIN_SUCCESS_RATE || '0.75')));
const PROFIT_GUARD_MIN_ATTEMPTS = Math.max(1, parseInt(process.env.SELF_HEAL_PROFIT_GUARD_MIN_ATTEMPTS || '3', 10));
const PROFIT_GUARD_LOG_LIMIT = Math.max(100, parseInt(process.env.SELF_HEAL_PROFIT_GUARD_LOG_LIMIT || '800', 10));
const SELF_HEAL_DRY_RUN = String(process.env.SELF_HEAL_DRY_RUN || 'false').toLowerCase() === 'true';
const SELF_HEAL_HOUSEKEEPING_ENABLED = String(process.env.SELF_HEAL_HOUSEKEEPING_ENABLED || 'true').toLowerCase() !== 'false';
const SELF_HEAL_LOG_MAX_BYTES = Math.max(1024 * 1024, parseInt(process.env.SELF_HEAL_LOG_MAX_BYTES || String(8 * 1024 * 1024), 10));
const SELF_HEAL_LOG_KEEP_LINES = Math.max(200, parseInt(process.env.SELF_HEAL_LOG_KEEP_LINES || '2000', 10));

const HEALTH_URL = `${APP_BASE_URL}/api/alchemy/health`;
const STATUS_URL = `${APP_BASE_URL}/api/status`;
const WALLET_URL = `${APP_BASE_URL}/api/alchemy/wallet`;
const DISTRIBUTION_URL = `${APP_BASE_URL}/api/alchemy/wallet/distribute`;
const WALLET_LOGS_URL = `${APP_BASE_URL}/api/alchemy/wallet/logs`;

async function trimFileByLines(filePath, keepLines) {
  const content = await fs.readFile(filePath, 'utf8');
  const lines = content.split('\n');
  const trimmed = lines.slice(-keepLines).join('\n');
  const tmpPath = filePath + '.tmp';
  await fs.writeFile(tmpPath, trimmed, 'utf8');
  await fs.rename(tmpPath, filePath);
}

async function maybeTrimLargeFile(filePath, maxBytes, keepLines) {
  const stat = await fs.stat(filePath);
  if (stat.size <= maxBytes) {
    return { trimmed: false, size: stat.size };
  }

  await trimFileByLines(filePath, keepLines);
  const after = await fs.stat(filePath);
  return { trimmed: true, before: stat.size, after: after.size };
}

async function runHousekeeping() {
  if (!SELF_HEAL_HOUSEKEEPING_ENABLED) {
    return { enabled: false, trimmedFiles: [] };
  }

  const targets = [];
  const logsDir = path.resolve(process.cwd(), 'logs');
  const dataDir = path.resolve(process.cwd(), 'data');

  const logEntries = await fs.readdir(logsDir).catch(() => []);
  for (const name of logEntries) {
    if (!name.endsWith('.log')) continue;
    targets.push(path.join(logsDir, name));
  }

  const eventsLog = path.join(dataDir, 'events.log');
  const eventsExists = await fs
    .stat(eventsLog)
    .then(() => true)
    .catch(() => false);
  if (eventsExists) targets.push(eventsLog);

  const trimmedFiles = [];
  for (const filePath of targets) {
    try {
      const result = await maybeTrimLargeFile(filePath, SELF_HEAL_LOG_MAX_BYTES, SELF_HEAL_LOG_KEEP_LINES);
      if (result.trimmed) {
        trimmedFiles.push({ file: filePath, before: result.before, after: result.after });
      }
    } catch (error) {
      console.warn(`self-heal housekeeping skipped ${filePath}:`, error?.message || String(error));
    }
  }

  return { enabled: true, trimmedFiles };
}

function parseBigIntSafe(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return BigInt(0);
    return BigInt(Math.trunc(value));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return BigInt(0);
    if (/^-?\d+$/.test(trimmed)) return BigInt(trimmed);
    const asNumber = Number(trimmed);
    if (!Number.isFinite(asNumber)) return BigInt(0);
    return BigInt(Math.trunc(asNumber));
  }
  return BigInt(0);
}

function weiToEthNumber(wei) {
  const whole = wei / BigInt(1e18);
  const fraction = wei % BigInt(1e18);
  const sign = wei < 0 ? -1 : 1;
  const wholeAbs = Number(whole < 0 ? -whole : whole);
  const fractionAbs = Number((fraction < 0 ? -fraction : fraction) / BigInt(1e12)) / 1e6;
  return sign * (wholeAbs + fractionAbs);
}

function isDiscordWebhook(url) {
  return /discord(?:app)?\.com\/api\/webhooks\//i.test(url);
}

function withMention(message) {
  if (!ALERT_MENTION || !isDiscordWebhook(ALERT_URL)) return message;
  return `${ALERT_MENTION} ${message}`;
}

async function sendAlert(message, options = {}) {
  if (!ALERT_URL) return;
  const level = String(options.level || 'info').toLowerCase();
  if (ALERT_MODE === 'off') return;
  if (ALERT_MODE !== 'all' && level !== 'critical') return;
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
    } catch (error) {
      if (attempt === 2) console.error('self-heal alert send failed after 3 attempts:', error.message || error);
    }
    if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkHealth() {
  try {
    const response = await fetchWithTimeout(HEALTH_URL);
    if (!response.ok) {
      return { ok: false, reason: `health status ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `health request failed: ${error.message || error}` };
  }
}

async function checkStatusReady() {
  try {
    const response = await fetchWithTimeout(STATUS_URL);
    if (!response.ok) {
      return { ok: false, reason: `status endpoint ${response.status}` };
    }
    const payload = await response.json().catch(() => ({}));
    if (!payload.ready) {
      return { ok: false, reason: 'system not ready' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `status request failed: ${error.message || error}` };
  }
}

async function attemptRemediation() {
  try {
    const response = await fetchWithTimeout(STATUS_URL, { method: 'POST' });
    if (!response.ok) {
      return { ok: false, reason: `init endpoint ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `init request failed: ${error.message || error}` };
  }
}

async function attemptWalletWarmup() {
  try {
    const response = await fetchWithTimeout(WALLET_URL);
    if (!response.ok) {
      return { ok: false, reason: `wallet endpoint ${response.status}` };
    }
    const payload = await response.json().catch(() => ({}));
    if (!payload.address) {
      return { ok: false, reason: 'wallet endpoint missing address' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `wallet request failed: ${error.message || error}` };
  }
}

async function attemptDistributionKick() {
  try {
    const response = await fetchWithTimeout(DISTRIBUTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.ALERT_SECRET ? { 'x-api-secret': process.env.ALERT_SECRET } : {}) }, body: JSON.stringify({}) });
    if (!response.ok) {
      return { ok: false, reason: `distribution endpoint ${response.status}` };
    }

    const payload = await response.json().catch(() => ({}));
    if (payload.results === null) {
      return { ok: true, reason: 'distribution skipped by threshold/reserve (expected)' };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `distribution request failed: ${error.message || error}` };
  }
}

async function evaluateProfitGuard() {
  if (!PROFIT_GUARD_ENABLED) return { blocked: false, reason: 'profit-guard-disabled' };

  try {
    const response = await fetchWithTimeout(`${WALLET_LOGS_URL}?limit=${PROFIT_GUARD_LOG_LIMIT}`);
    if (!response.ok) {
      return { blocked: false, reason: `profit-guard-log-fetch-nonfatal status=${response.status}` };
    }

    const payload = await response.json().catch(() => ({}));
    const logs = Array.isArray(payload?.logs) ? payload.logs : [];
    const cutoff = Date.now() - PROFIT_GUARD_LOOKBACK_HOURS * 60 * 60 * 1000;

    let transferSuccess = 0;
    let transferFailed = 0;
    let payoutsWei = BigInt(0);
    let topupsWei = BigInt(0);

    for (const row of logs) {
      const ts = Date.parse(row?.time || '');
      if (!Number.isFinite(ts) || ts < cutoff) continue;

      const type = row?.type;
      const itemPayload = row?.payload || {};

      if (type === 'transfer') {
        transferSuccess += 1;
        payoutsWei += parseBigIntSafe(itemPayload.amount);
      }
      if (type === 'transfer_failed') transferFailed += 1;
      if (type === 'gas_topup') {
        const amountEth = Number(itemPayload.amount || 0) || 0;
        topupsWei += BigInt(Math.floor(amountEth * 1e18));
      }
    }

    const attempts = transferSuccess + transferFailed;
    if (attempts < PROFIT_GUARD_MIN_ATTEMPTS) {
      return {
        blocked: false,
        reason: `profit-guard-min-attempts-not-met (${attempts}/${PROFIT_GUARD_MIN_ATTEMPTS})`,
      };
    }

    const successRate = attempts > 0 ? transferSuccess / attempts : 1;
    const netEth = weiToEthNumber(payoutsWei - topupsWei);
    const blocked = successRate < PROFIT_GUARD_MIN_SUCCESS_RATE || netEth < PROFIT_GUARD_MIN_NET_ETH;

    return {
      blocked,
      reason: blocked
        ? `profit-guard-block successRate=${(successRate * 100).toFixed(1)}% netEth=${netEth.toFixed(6)} thresholds(rate>=${PROFIT_GUARD_MIN_SUCCESS_RATE}, net>=${PROFIT_GUARD_MIN_NET_ETH})`
        : `profit-guard-pass successRate=${(successRate * 100).toFixed(1)}% netEth=${netEth.toFixed(6)}`,
    };
  } catch (error) {
    const message = error?.message || String(error);
    return { blocked: false, reason: `profit-guard-log-fetch-nonfatal error=${message}` };
  }
}

async function attemptRemediationChain() {
  const profitGuard = await evaluateProfitGuard();
  const steps = [
    { name: 'initialize-system', run: attemptRemediation },
    { name: 'wallet-warmup', run: attemptWalletWarmup },
    {
      name: 'distribution-kick',
      run: async () => {
        if (profitGuard.blocked) {
          return { ok: true, reason: `skipped-by-${profitGuard.reason}` };
        }
        return attemptDistributionKick();
      },
    },
  ];

  const details = [{ step: 'profit-guard', ok: !profitGuard.blocked, reason: profitGuard.reason }];
  let hadSuccess = false;

  for (const step of steps) {
    const result = await step.run();
    details.push({ step: step.name, ...result });
    if (result.ok) {
      hadSuccess = true;
    }
  }

  if (!hadSuccess) {
    const reason = details.map((d) => `${d.step}: ${d.reason}`).join('; ');
    return { ok: false, reason, details };
  }

  return { ok: true, details };
}

async function diagnosticsOnlySummary() {
  const profitGuard = await evaluateProfitGuard();
  return {
    mode: 'dry-run',
    profitGuard,
    plannedSteps: [
      'initialize-system (POST /api/status)',
      'wallet-warmup (GET /api/alchemy/wallet)',
      `distribution-kick (${profitGuard.blocked ? 'would be skipped by profit guard' : 'would execute'})`,
    ],
  };
}

async function evaluate() {
  const health = await checkHealth();
  const status = await checkStatusReady();

  if (health.ok && status.ok) {
    return { healthy: true, reasons: [] };
  }

  const reasons = [];
  if (!health.ok) reasons.push(health.reason);
  if (!status.ok) reasons.push(status.reason);
  return { healthy: false, reasons };
}

async function main() {
  const housekeeping = await runHousekeeping();
  if (housekeeping.trimmedFiles?.length) {
    const summary = housekeeping.trimmedFiles.map((item) => `${path.basename(item.file)} ${item.before}->${item.after}`).join(', ');
    console.log(`self-heal housekeeping: trimmed ${housekeeping.trimmedFiles.length} file(s): ${summary}`);
  }

  const first = await evaluate();

  if (first.healthy) {
    if (NOTIFY_OK) {
      await sendAlert(`✅ Self-heal check OK at ${new Date().toISOString()}`);
    }
    console.log('self-heal: service healthy');
    return;
  }

  const issueSummary = first.reasons.join('; ');
  console.error('self-heal: issue detected:', issueSummary);
  await sendAlert(`🚨 Self-heal detected issue: ${issueSummary}. Attempting remediation now.`, { level: 'critical' });

  if (SELF_HEAL_DRY_RUN) {
    const diagnostics = await diagnosticsOnlySummary();
    const planned = diagnostics.plannedSteps.join(' -> ');
    const guardReason = diagnostics.profitGuard?.reason || 'unknown';
    await sendAlert(`🧪 Self-heal dry-run mode: no remediation executed. planned=${planned}; profit_guard=${guardReason}`, { level: 'info' });
    console.warn('self-heal: dry-run mode enabled, remediation skipped');
    process.exit(1);
  }

  const remediation = await attemptRemediationChain();
  if (!remediation.ok) {
    await sendAlert(`❌ Self-heal remediation request failed: ${remediation.reason}`, { level: 'critical' });
    process.exit(1);
  }

  await new Promise((resolve) => setTimeout(resolve, REMEDIATION_PAUSE_MS));
  const second = await evaluate();

  if (second.healthy) {
    await sendAlert(`✅ Self-heal cleared the issue at ${new Date().toISOString()}.`, { level: 'info' });
    console.log('self-heal: issue cleared');
    return;
  }

  await sendAlert('⚠️ Self-heal first remediation pass did not fully clear issue. Retrying remediation.', { level: 'critical' });
  const secondRemediation = await attemptRemediationChain();
  if (!secondRemediation.ok) {
    await sendAlert(`❌ Self-heal second remediation pass failed: ${secondRemediation.reason}`, { level: 'critical' });
    process.exit(1);
  }

  await new Promise((resolve) => setTimeout(resolve, REMEDIATION_PAUSE_MS));
  const third = await evaluate();

  if (third.healthy) {
    await sendAlert(`✅ Self-heal cleared the issue after retry at ${new Date().toISOString()}.`, { level: 'info' });
    console.log('self-heal: issue cleared after retry');
    return;
  }

  const remaining = third.reasons.join('; ');
  await sendAlert(`❌ Self-heal attempted fix but issue remains: ${remaining}`, { level: 'critical' });
  console.error('self-heal: unresolved after remediation:', remaining);
  process.exit(1);
}

main().catch(async (error) => {
  const message = error?.message || String(error);
  console.error('self-heal crashed:', message);
  await sendAlert(`❌ Self-heal crashed: ${message}`, { level: 'critical' });
  process.exit(1);
});
