#!/usr/bin/env node

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.vercel.app').replace(/\/$/, '');
const ALERT_URL = process.env.ALERT_WEBHOOK_URL || '';
const ALERT_MENTION = (process.env.ALERT_MENTION || '').trim();
const THRESHOLD = Number(process.env.GEO_RISK_ALERT_THRESHOLD || 0.6);

function withMention(message) {
  if (!ALERT_MENTION) return message;
  return `${ALERT_MENTION} ${message}`;
}

async function sendAlert(message) {
  if (!ALERT_URL) return;
  await fetch(ALERT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: withMention(message), text: withMention(message) }),
  });
}

async function fetchJson(path) {
  const response = await fetch(`${APP_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${path}`);
  }
  return response.json();
}

async function main() {
  const autonomy = await fetchJson('/api/status/autonomy');
  const latest = autonomy?.market?.latest || {};
  const risk = Number(latest.geopoliticalRisk || 0);
  const regime = latest.regime || 'unknown';
  const signals = Array.isArray(latest.geopoliticalSignals) ? latest.geopoliticalSignals : [];
  const heads = Array.isArray(latest.geopoliticalHeadlines) ? latest.geopoliticalHeadlines : [];

  console.log(`geo_watch risk=${risk.toFixed(3)} regime=${regime} signals=${signals.join(',') || 'none'}`);

  // Publish to cross-agent signal bus
  try {
    const bus = require('../lib/agent-signal-bus');
    bus.publish({
      type: 'geo_risk',
      source: 'geopolitical-watch',
      confidence: Math.min(1, risk),
      payload: { risk, regime, signals, headlineCount: heads.length },
    });
  } catch (busErr) {
    // signal-bus unavailable -- non-fatal
  }

  if (risk < THRESHOLD) {
    return;
  }

  const headlinePreview = heads.slice(0, 2).join(' | ') || 'n/a';
  const alert = `🌍 Geopolitical risk spike detected (risk=${risk.toFixed(3)} threshold=${THRESHOLD.toFixed(2)} regime=${regime}). signals=${signals.join(',') || 'none'} headlines=${headlinePreview}`;
  await sendAlert(alert);
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  await sendAlert(`⚠️ geopolitical-watch failed: ${message}`);
  process.exit(1);
});
