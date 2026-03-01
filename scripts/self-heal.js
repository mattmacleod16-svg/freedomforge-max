/*
 * Self-heal monitor
 *
 * Detects service issues, alerts via webhook, attempts remediation,
 * then notifies when cleared (or unresolved).
 *
 * Usage:
 *   APP_BASE_URL=https://freedomforge-max-qt5y.vercel.app node scripts/self-heal.js
 *
 * Optional env:
 *   ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...
 *   ALERT_MENTION=<@123...> or <@&456...>
 *   SELF_HEAL_NOTIFY_OK=false
 *   SELF_HEAL_TIMEOUT_MS=10000
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max-qt5y.vercel.app').replace(/\/$/, '');
const ALERT_URL = process.env.ALERT_WEBHOOK_URL || '';
const ALERT_MENTION = (process.env.ALERT_MENTION || '').trim();
const TIMEOUT_MS = parseInt(process.env.SELF_HEAL_TIMEOUT_MS || '10000', 10);
const NOTIFY_OK = String(process.env.SELF_HEAL_NOTIFY_OK || 'false').toLowerCase() === 'true';
const REMEDIATION_PAUSE_MS = parseInt(process.env.SELF_HEAL_REMEDIATION_PAUSE_MS || '5000', 10);

const HEALTH_URL = `${APP_BASE_URL}/api/alchemy/health`;
const STATUS_URL = `${APP_BASE_URL}/api/status`;
const WALLET_URL = `${APP_BASE_URL}/api/alchemy/wallet`;
const DISTRIBUTION_URL = `${APP_BASE_URL}/api/alchemy/wallet/distribute`;

function isDiscordWebhook(url) {
  return /discord(?:app)?\.com\/api\/webhooks\//i.test(url);
}

function withMention(message) {
  if (!ALERT_MENTION || !isDiscordWebhook(ALERT_URL)) return message;
  return `${ALERT_MENTION} ${message}`;
}

async function sendAlert(message) {
  if (!ALERT_URL) return;
  const finalMessage = withMention(message);
  try {
    await fetch(ALERT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: finalMessage, text: finalMessage }),
    });
  } catch (error) {
    console.error('self-heal alert send failed:', error.message || error);
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
    const response = await fetchWithTimeout(DISTRIBUTION_URL);
    if (!response.ok) {
      return { ok: false, reason: `distribution endpoint ${response.status}` };
    }

    const payload = await response.json().catch(() => ({}));
    if (payload.results === null) {
      return { ok: false, reason: 'distribution returned null results' };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `distribution request failed: ${error.message || error}` };
  }
}

async function attemptRemediationChain() {
  const steps = [
    { name: 'initialize-system', run: attemptRemediation },
    { name: 'wallet-warmup', run: attemptWalletWarmup },
    { name: 'distribution-kick', run: attemptDistributionKick },
  ];

  const details = [];
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
  await sendAlert(`🚨 Self-heal detected issue: ${issueSummary}. Attempting remediation now.`);

  const remediation = await attemptRemediationChain();
  if (!remediation.ok) {
    await sendAlert(`❌ Self-heal remediation request failed: ${remediation.reason}`);
    process.exit(1);
  }

  await new Promise((resolve) => setTimeout(resolve, REMEDIATION_PAUSE_MS));
  const second = await evaluate();

  if (second.healthy) {
    await sendAlert(`✅ Self-heal cleared the issue at ${new Date().toISOString()}.`);
    console.log('self-heal: issue cleared');
    return;
  }

  await sendAlert('⚠️ Self-heal first remediation pass did not fully clear issue. Retrying remediation.');
  const secondRemediation = await attemptRemediationChain();
  if (!secondRemediation.ok) {
    await sendAlert(`❌ Self-heal second remediation pass failed: ${secondRemediation.reason}`);
    process.exit(1);
  }

  await new Promise((resolve) => setTimeout(resolve, REMEDIATION_PAUSE_MS));
  const third = await evaluate();

  if (third.healthy) {
    await sendAlert(`✅ Self-heal cleared the issue after retry at ${new Date().toISOString()}.`);
    console.log('self-heal: issue cleared after retry');
    return;
  }

  const remaining = third.reasons.join('; ');
  await sendAlert(`❌ Self-heal attempted fix but issue remains: ${remaining}`);
  console.error('self-heal: unresolved after remediation:', remaining);
  process.exit(1);
}

main().catch(async (error) => {
  const message = error?.message || String(error);
  console.error('self-heal crashed:', message);
  await sendAlert(`❌ Self-heal crashed: ${message}`);
  process.exit(1);
});
