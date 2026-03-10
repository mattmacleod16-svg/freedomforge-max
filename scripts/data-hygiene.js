#!/usr/bin/env node
/**
 * data-hygiene.js – Automated data pruning & log rotation
 * Runs daily via systemd timer to keep disk lean and JSON files fast.
 *
 * Rules:
 *   - Trim growing arrays in state JSON files to a max length (newest kept)
 *   - Compress log files older than 3 days, delete after 14 days
 *   - Vacuum systemd journal to 100M
 *   - Report savings to stdout (captured by journal)
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOGS_DIR = path.join(__dirname, '..', 'logs');

// ── Array-trim rules ────────────────────────────────────────────
// { file, path-to-array (dot-separated), maxLen }
const TRIM_RULES = [
  // Brain generations – biggest grower (~3.5KB each)
  { file: 'self-evolving-brain.json', key: 'generations', max: 200 },
  // Calibration buckets inside brain
  { file: 'self-evolving-brain.json', key: 'calibration.buckets', max: 50 },

  // Trade journal (top-level array or .trades)
  { file: 'trade-journal.json', key: null, max: 500, topArray: true },
  { file: 'trade-journal.json', key: 'trades', max: 500 },

  // Audit history
  { file: 'audit-history.json', key: null, max: 100, topArray: true },
  { file: 'audit-history.json', key: 'audits', max: 100 },

  // Signal bus – trim any arrays
  { file: 'agent-signal-bus.json', key: '*arrays', max: 200 },

  // Public alpha - alphas list
  { file: 'public-alpha-state.json', key: '*arrays', max: 200 },

  // Prediction market – markets, bets, history
  { file: 'prediction-market-state.json', key: '*arrays', max: 200 },

  // Strategy evolution – trim nested arrays
  { file: 'strategy-evolution.json', key: '*arrays', max: 200 },

  // Guardian alert history
  { file: 'liquidation-guardian-state.json', key: 'alertHistory', max: 50 },
  { file: 'liquidation-guardian-state.json', key: 'marginHistory', max: 100 },

  // Orchestrator errors
  { file: 'orchestrator-state.json', key: 'errors', max: 50 },

  // Watchdog alerts
  { file: 'watchdog-alerts.json', key: null, max: 100, topArray: true },
  { file: 'watchdog-alerts.json', key: 'alerts', max: 100 },
];

// ── Helpers ────────────────────────────────────────────────────
function deepGet(obj, keyPath) {
  return keyPath.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

function deepSet(obj, keyPath, value) {
  const keys = keyPath.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!o[keys[i]]) return;
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

function trimArray(arr, max) {
  if (!Array.isArray(arr) || arr.length <= max) return { arr, trimmed: 0 };
  const trimmed = arr.length - max;
  return { arr: arr.slice(-max), trimmed };
}

// ── Main trimming logic ─────────────────────────────────────────
function trimDataFiles() {
  let totalTrimmed = 0;
  let totalBytesSaved = 0;
  const processed = new Set();

  for (const rule of TRIM_RULES) {
    const filePath = path.join(DATA_DIR, rule.file);
    if (!fs.existsSync(filePath)) continue;

    try {
      const beforeSize = fs.statSync(filePath).size;
      const raw = fs.readFileSync(filePath, 'utf8');
      let data = JSON.parse(raw);
      let changed = false;

      if (rule.topArray && Array.isArray(data)) {
        // Top-level array file
        const { arr, trimmed } = trimArray(data, rule.max);
        if (trimmed > 0) {
          data = arr;
          changed = true;
          totalTrimmed += trimmed;
          console.log(`  ${rule.file}: trimmed ${trimmed} top-level entries → ${rule.max}`);
        }
      } else if (rule.key === '*arrays') {
        // Wildcard: trim ALL arrays in the object (1 level deep + 2 levels)
        const trimDeep = (obj, depth = 0) => {
          if (depth > 2 || !obj || typeof obj !== 'object') return;
          for (const k of Object.keys(obj)) {
            if (Array.isArray(obj[k]) && obj[k].length > rule.max) {
              const { arr, trimmed } = trimArray(obj[k], rule.max);
              obj[k] = arr;
              changed = true;
              totalTrimmed += trimmed;
              console.log(`  ${rule.file}.${k}: trimmed ${trimmed} → ${rule.max}`);
            } else if (typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
              trimDeep(obj[k], depth + 1);
            }
          }
        };
        trimDeep(data);
      } else if (rule.key && typeof data === 'object') {
        const val = deepGet(data, rule.key);
        if (Array.isArray(val)) {
          const { arr, trimmed } = trimArray(val, rule.max);
          if (trimmed > 0) {
            deepSet(data, rule.key, arr);
            changed = true;
            totalTrimmed += trimmed;
            console.log(`  ${rule.file}.${rule.key}: trimmed ${trimmed} → ${rule.max}`);
          }
        }
      }

      if (changed) {
        const out = JSON.stringify(data, null, 2);
        fs.writeFileSync(filePath, out, 'utf8');
        const afterSize = fs.statSync(filePath).size;
        const saved = beforeSize - afterSize;
        if (saved > 0) totalBytesSaved += saved;
        console.log(`  ${rule.file}: ${(beforeSize / 1024).toFixed(1)}KB → ${(afterSize / 1024).toFixed(1)}KB (saved ${(saved / 1024).toFixed(1)}KB)`);
      }

      processed.add(rule.file);
    } catch (err) {
      console.warn(`  WARN: ${rule.file}: ${err.message}`);
    }
  }

  return { totalTrimmed, totalBytesSaved };
}

// ── Log rotation ──────────────────────────────────────────────
function rotateLogs() {
  if (!fs.existsSync(LOGS_DIR)) return { deleted: 0, compressed: 0 };

  const now = Date.now();
  const DAY = 86400000;
  let deleted = 0;
  let compressed = 0;

  const files = fs.readdirSync(LOGS_DIR);
  for (const f of files) {
    const fp = path.join(LOGS_DIR, f);
    try {
      const stat = fs.statSync(fp);
      const ageMs = now - stat.mtimeMs;

      // Delete files older than 14 days
      if (ageMs > 14 * DAY) {
        fs.unlinkSync(fp);
        deleted++;
        console.log(`  log deleted (>14d): ${f}`);
        continue;
      }

      // Compress non-gz files older than 3 days
      if (ageMs > 3 * DAY && !f.endsWith('.gz')) {
        try {
          execSync(`gzip "${fp}"`, { timeout: 10000 });
          compressed++;
          console.log(`  log compressed (>3d): ${f}`);
        } catch { /* gzip not available or failed, skip */ }
      }
    } catch { /* skip */ }
  }

  return { deleted, compressed };
}

// ── Journal vacuum ──────────────────────────────────────────
function vacuumJournal() {
  try {
    execSync('journalctl --user --vacuum-size=100M 2>/dev/null', { timeout: 10000 });
    execSync('journalctl --vacuum-size=200M 2>/dev/null', { timeout: 10000 });
    console.log('  systemd journal vacuumed (user: 100M, system: 200M)');
  } catch { /* non-critical */ }
}

// ── Compact JSON whitespace for large files ──────────────────
function compactLargeFiles() {
  const COMPACT_THRESHOLD = 500 * 1024; // 500KB
  if (!fs.existsSync(DATA_DIR)) return 0;

  let saved = 0;
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const fp = path.join(DATA_DIR, f);
    try {
      const stat = fs.statSync(fp);
      if (stat.size > COMPACT_THRESHOLD) {
        const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
        // Use minimal indentation for large files
        const compact = JSON.stringify(data);
        if (compact.length < stat.size * 0.8) {
          fs.writeFileSync(fp, compact, 'utf8');
          const newSize = fs.statSync(fp).size;
          saved += stat.size - newSize;
          console.log(`  compacted ${f}: ${(stat.size / 1024).toFixed(0)}KB → ${(newSize / 1024).toFixed(0)}KB`);
        }
      }
    } catch { /* skip corrupt files */ }
  }
  return saved;
}

// ── Run ─────────────────────────────────────────────────────
console.log(`[data-hygiene] ${new Date().toISOString()}`);
console.log('Trimming JSON arrays...');
const { totalTrimmed, totalBytesSaved } = trimDataFiles();

console.log('Compacting large files...');
const compactSaved = compactLargeFiles();

console.log('Rotating logs...');
const { deleted, compressed } = rotateLogs();

console.log('Vacuuming journal...');
vacuumJournal();

const totalSavedKB = ((totalBytesSaved + compactSaved) / 1024).toFixed(1);
console.log(`\n[data-hygiene] DONE — trimmed ${totalTrimmed} entries, ${deleted} logs deleted, ${compressed} compressed, ${totalSavedKB}KB saved`);
