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
const ALERT_MODE = String(process.env.MONITOR_ALERT_MODE || 'critical').toLowerCase();
const POLL_MS = parseInt(process.env.MONITOR_INTERVAL_MS || '900000', 10); // default 15m

if (!DIST_URL) {
  console.error('DISTRIBUTION_URL not set');
  process.exit(1);
}

async function sendAlert(msg, options = {}) {
  if (!ALERT_URL) return;
  const level = String(options.level || 'info').toLowerCase();
  if (ALERT_MODE === 'off') return;
  if (ALERT_MODE !== 'all' && level !== 'critical') return;
  const shouldMention = /discord(?:app)?\.com\/api\/webhooks\//i.test(ALERT_URL) && ALERT_MENTION;
  const finalMsg = shouldMention ? `${ALERT_MENTION} ${msg}` : msg;
  const body = JSON.stringify({ content: finalMsg, text: finalMsg });
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
    } catch (e) {
      if (attempt === 2) console.error('failed to send alert after 3 attempts', e);
    }
    if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
  }
}

async function checkOnce() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch(DIST_URL, { signal: controller.signal });
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      throw new Error('bad status ' + res.status);
    }
    console.log(new Date().toISOString(), 'distribution OK');
  } catch (e) {
    console.error('distribution check failed', e);
    await sendAlert('Monitor script: distribution failure: ' + e, { level: 'critical' });
  }
}

// start immediately
checkOnce().catch(console.error);
setInterval(checkOnce, POLL_MS);
