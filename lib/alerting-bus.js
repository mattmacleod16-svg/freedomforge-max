/**
 * Structured Alerting Bus
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Centralized alert routing with:
 *   - Severity levels: info → warning → critical → emergency
 *   - Alert deduplication (same alert within window → suppressed)
 *   - Channel routing (log, Discord webhook, push notification, signal bus)
 *   - Alert history with TTL
 *   - Escalation rules (alert promoted if persistent)
 *
 * Usage:
 *   const alertBus = require('./alerting-bus');
 *   alertBus.alert('critical', 'risk', 'Drawdown exceeded 10%', { drawdownPct: 10.5 });
 *
 * @module lib/alerting-bus
 */

'use strict';

const { createLogger } = require('./logger');
const log = createLogger('alerting-bus');
const fs = require('fs');
const path = require('path');

let signalBus;
try { signalBus = require('./agent-signal-bus'); } catch { signalBus = null; }

// ─── Configuration ────────────────────────────────────────────────────────────
const DISCORD_WEBHOOK_URL = process.env.DISCORD_ALERT_WEBHOOK || '';
const DEDUP_WINDOW_MS = Number(process.env.ALERT_DEDUP_MS || 300000);        // 5min
const ESCALATION_WINDOW_MS = Number(process.env.ALERT_ESCALATION_MS || 900000); // 15min
const ESCALATION_COUNT = Number(process.env.ALERT_ESCALATION_COUNT || 3);    // 3 repeats → escalate
const MAX_HISTORY = Number(process.env.ALERT_MAX_HISTORY || 1000);
const STATE_PATH = path.resolve(__dirname, '..', 'data', 'alerting-bus-state.json');

// ─── Severity Levels ──────────────────────────────────────────────────────────
const SEVERITY = {
  info: { level: 0, emoji: 'ℹ️', color: 0x3498db },
  warning: { level: 1, emoji: '⚠️', color: 0xf39c12 },
  critical: { level: 2, emoji: '🚨', color: 0xe74c3c },
  emergency: { level: 3, emoji: '🔥', color: 0x8b0000 },
};

const SEVERITY_ORDER = ['info', 'warning', 'critical', 'emergency'];

// ─── State ────────────────────────────────────────────────────────────────────
const alertHistory = [];     // [{id, severity, category, message, payload, timestamp, channels}]
const dedupMap = {};         // { fingerprint: { count, firstSeen, lastSeen, severity } }
const suppressedCount = {};  // { fingerprint: count }

// ─── Alert Entry Point ────────────────────────────────────────────────────────

/**
 * Fire an alert through the alerting bus.
 *
 * @param {string} severity - 'info' | 'warning' | 'critical' | 'emergency'
 * @param {string} category - Alert category (e.g., 'risk', 'exchange', 'system', 'anomaly')
 * @param {string} message - Human-readable alert message
 * @param {object} [payload] - Optional structured data
 * @returns {{ sent: boolean, id?: string, deduplicated?: boolean, escalated?: boolean }}
 */
function alert(severity, category, message, payload = {}) {
  const sev = SEVERITY[severity] ? severity : 'info';
  const fingerprint = `${sev}:${category}:${message}`;
  const now = Date.now();

  // ── Deduplication ───────────────────────────────────────────────────
  if (dedupMap[fingerprint]) {
    const entry = dedupMap[fingerprint];
    if (now - entry.lastSeen < DEDUP_WINDOW_MS) {
      entry.count++;
      entry.lastSeen = now;
      suppressedCount[fingerprint] = (suppressedCount[fingerprint] || 0) + 1;

      // Check escalation — repeated alerts get promoted
      if (entry.count >= ESCALATION_COUNT && SEVERITY_ORDER.indexOf(sev) < SEVERITY_ORDER.length - 1) {
        const escalatedSeverity = SEVERITY_ORDER[SEVERITY_ORDER.indexOf(sev) + 1];
        log.warn(`Alert escalated: ${sev} → ${escalatedSeverity} (${fingerprint} fired ${entry.count}x in ${ESCALATION_WINDOW_MS / 60000}min)`);
        return alert(escalatedSeverity, category, `[ESCALATED] ${message}`, { ...payload, escalatedFrom: sev, repeatCount: entry.count });
      }

      return { sent: false, deduplicated: true, suppressedCount: suppressedCount[fingerprint] };
    }
  }

  // Record dedup entry
  dedupMap[fingerprint] = { count: 1, firstSeen: now, lastSeen: now, severity: sev };

  // ── Create alert record ─────────────────────────────────────────────
  const id = `alert_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    severity: sev,
    category,
    message,
    payload,
    timestamp: new Date(now).toISOString(),
    channels: [],
  };

  // ── Route to channels ──────────────────────────────────────────────
  // Always log
  routeToLog(record);
  record.channels.push('log');

  // Publish to signal bus for all severities
  if (signalBus) {
    try {
      signalBus.publish({
        type: 'system_alert',
        source: 'alerting-bus',
        confidence: SEVERITY[sev].level / 3,
        payload: { id, severity: sev, category, message },
        ttlMs: sev === 'emergency' ? 3600000 : 1800000,
      });
      record.channels.push('signal_bus');
    } catch { /* best effort */ }
  }

  // Discord for critical and emergency
  if (SEVERITY[sev].level >= 2 && DISCORD_WEBHOOK_URL) {
    routeToDiscord(record).catch(() => {});
    record.channels.push('discord');
  }

  // Persist
  alertHistory.push(record);
  if (alertHistory.length > MAX_HISTORY) alertHistory.splice(0, alertHistory.length - MAX_HISTORY);
  persistState();

  return { sent: true, id, escalated: message.startsWith('[ESCALATED]') };
}

// ─── Channel Routers ──────────────────────────────────────────────────────────

function routeToLog(record) {
  const emoji = SEVERITY[record.severity]?.emoji || '';
  const msg = `${emoji} [${record.severity.toUpperCase()}][${record.category}] ${record.message}`;

  switch (record.severity) {
    case 'emergency':
    case 'critical': log.error(msg); break;
    case 'warning': log.warn(msg); break;
    default: log.info(msg);
  }
}

async function routeToDiscord(record) {
  if (!DISCORD_WEBHOOK_URL) return;

  const color = SEVERITY[record.severity]?.color || 0x000000;
  const emoji = SEVERITY[record.severity]?.emoji || '';

  const body = {
    embeds: [{
      title: `${emoji} ${record.severity.toUpperCase()}: ${record.category}`,
      description: record.message,
      color,
      fields: Object.entries(record.payload || {}).slice(0, 10).map(([k, v]) => ({
        name: k,
        value: String(v).slice(0, 100),
        inline: true,
      })),
      timestamp: record.timestamp,
      footer: { text: `FreedomForge-Max Alert | ${record.id}` },
    }],
  };

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    log.warn('Discord alert failed:', err?.message);
  }
}

// ─── Query & Management ───────────────────────────────────────────────────────

/**
 * Get alert history.
 *
 * @param {object} [opts]
 * @param {string} [opts.severity] - Filter by severity
 * @param {string} [opts.category] - Filter by category
 * @param {number} [opts.limit] - Max results
 * @param {number} [opts.sinceMs] - Only alerts newer than this timestamp
 * @returns {object[]}
 */
function getAlerts(opts = {}) {
  let results = [...alertHistory];

  if (opts.severity) results = results.filter(a => a.severity === opts.severity);
  if (opts.category) results = results.filter(a => a.category === opts.category);
  if (opts.sinceMs) results = results.filter(a => new Date(a.timestamp).getTime() >= opts.sinceMs);

  results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return results.slice(0, opts.limit || 50);
}

/**
 * Get alert summary/dashboard.
 */
function getSummary() {
  const now = Date.now();
  const last1h = alertHistory.filter(a => new Date(a.timestamp).getTime() > now - 3600000);
  const last24h = alertHistory.filter(a => new Date(a.timestamp).getTime() > now - 86400000);

  const bySeverity = {};
  for (const sev of SEVERITY_ORDER) {
    bySeverity[sev] = last24h.filter(a => a.severity === sev).length;
  }

  const byCategory = {};
  for (const a of last24h) {
    byCategory[a.category] = (byCategory[a.category] || 0) + 1;
  }

  return {
    totalAlerts: alertHistory.length,
    last1h: last1h.length,
    last24h: last24h.length,
    bySeverity,
    byCategory,
    totalSuppressed: Object.values(suppressedCount).reduce((s, v) => s + v, 0),
    recentAlerts: alertHistory.slice(-5),
  };
}

/**
 * Clear suppression counts and dedup map. Useful during maintenance.
 */
function resetDedup() {
  for (const key of Object.keys(dedupMap)) delete dedupMap[key];
  for (const key of Object.keys(suppressedCount)) delete suppressedCount[key];
  log.info('Alert dedup state reset');
}

// ─── Convenience Methods ──────────────────────────────────────────────────────
function info(category, message, payload) { return alert('info', category, message, payload); }
function warning(category, message, payload) { return alert('warning', category, message, payload); }
function critical(category, message, payload) { return alert('critical', category, message, payload); }
function emergency(category, message, payload) { return alert('emergency', category, message, payload); }

// ─── Persistence ──────────────────────────────────────────────────────────────
function persistState() {
  try {
    const state = {
      recentAlerts: alertHistory.slice(-100),
      suppressedCount,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch { /* best effort */ }
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  alert,
  info,
  warning,
  critical,
  emergency,
  getAlerts,
  getSummary,
  resetDedup,
};
