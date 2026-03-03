/*
 * Simple standalone monitor/worker script that regularly hits the distribution
 * endpoint and reports failures to the alert webhook.  This can be run on any
 * machine that stays online (a VPS, your laptop, etc.) as a redundant guard
 * in case the GitHub Actions cron or other external scheduler ever stops
 * working.  It is intentionally very small and uses only built-in APIs.
 *
 * Usage:
 *   ALERT_WEBHOOK_URL=... DISTRIBUTION_URL=... node scripts/monitor.js
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const appBaseUrl = (process.env.APP_BASE_URL || 'https://freedomforge-max.vercel.app').replace(/\/$/, '');
const DIST_URL = process.env.DISTRIBUTION_URL || `${appBaseUrl}/api/alchemy/wallet/distribute`;
const ALERT_URL = process.env.ALERT_WEBHOOK_URL;
const ALERT_MENTION = (process.env.ALERT_MENTION || '').trim();
const POLL_MS = parseInt(process.env.MONITOR_INTERVAL_MS || '900000', 10); // default 15m

if (!DIST_URL) {
  console.error('DISTRIBUTION_URL not set');
  process.exit(1);
}

async function sendAlert(msg) {
  if (!ALERT_URL) return;
  const shouldMention = /discord(?:app)?\.com\/api\/webhooks\//i.test(ALERT_URL) && ALERT_MENTION;
  const finalMsg = shouldMention ? `${ALERT_MENTION} ${msg}` : msg;
  try {
    await fetch(ALERT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: finalMsg, text: finalMsg }),
    });
  } catch (e) {
    console.error('failed to send alert', e);
  }
}

async function checkOnce() {
  try {
    const res = await fetch(DIST_URL);
    if (!res.ok) {
      throw new Error('bad status ' + res.status);
    }
    console.log(new Date().toISOString(), 'distribution OK');
  } catch (e) {
    console.error('distribution check failed', e);
    await sendAlert('Monitor script: distribution failure: ' + e);
  }
}

// start immediately
checkOnce();
setInterval(checkOnce, POLL_MS);
