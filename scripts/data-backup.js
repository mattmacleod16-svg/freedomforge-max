#!/usr/bin/env node
/**
 * Data Backup Script
 * ===================
 *
 * Creates timestamped snapshots of the data/ directory containing all
 * critical trading state. Designed to run via cron or systemd timer.
 *
 * Features:
 *   - Atomic tar.gz creation (write to tmp, then move)
 *   - Retention policy: keeps last N backups, prunes older ones
 *   - Integrity verification: validates backup is readable after creation
 *   - Signal bus notification on success/failure
 *   - Optional remote sync via rsync/scp (if configured)
 *
 * Env vars:
 *   BACKUP_ENABLED       (default: 'true')
 *   BACKUP_DIR           (default: 'backups/')
 *   BACKUP_RETENTION     (default: 30) — number of backups to keep
 *   BACKUP_REMOTE_TARGET — rsync target (e.g., user@host:/path/backups/)
 *   ALERT_WEBHOOK_URL    — Discord webhook for failure alerts
 *
 * Run:  node scripts/data-backup.js
 *       npm run backup
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

// ─── Configuration ──────────────────────────────────────────────────────────

const ENABLED = String(process.env.BACKUP_ENABLED || 'true').toLowerCase() !== 'false';
const DATA_DIR = path.resolve(process.cwd(), 'data');
const BACKUP_DIR = path.resolve(process.cwd(), process.env.BACKUP_DIR || 'backups');
const RETENTION = Math.min(365, Math.max(1, Number(process.env.BACKUP_RETENTION || 30)));
const REMOTE_TARGET = (process.env.BACKUP_REMOTE_TARGET || '').trim();
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL || '';

let signalBus;
try { signalBus = require('../lib/agent-signal-bus'); } catch { signalBus = null; }

// ─── Helpers ────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: opts.timeout || 60000,
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    return { error: err?.message || String(err), stderr: err?.stderr || '' };
  }
}

function sendAlert(message) {
  if (!ALERT_WEBHOOK_URL) return;
  try {
    const { execFileSync } = require('child_process');
    execFileSync('curl', [
      '-s', '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({ content: message.slice(0, 1900) }),
      ALERT_WEBHOOK_URL,
    ], { encoding: 'utf8', timeout: 10000 });
  } catch { /* ignore */ }
}

// ─── Backup Logic ───────────────────────────────────────────────────────────

function createBackup() {
  // Ensure directories exist
  if (!fs.existsSync(DATA_DIR)) {
    return { success: false, error: 'data/ directory does not exist' };
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const filename = `freedomforge-data-${ts}.tar.gz`;
  const tmpPath = path.join(BACKUP_DIR, `.tmp-${filename}`);
  const finalPath = path.join(BACKUP_DIR, filename);

  // Create tar.gz
  const tarResult = run(`tar -czf "${tmpPath}" -C "${path.dirname(DATA_DIR)}" "${path.basename(DATA_DIR)}"`, { timeout: 120000 });

  if (tarResult?.error) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    return { success: false, error: `tar failed: ${tarResult.error}` };
  }

  // Verify the archive is readable
  const testResult = run(`tar -tzf "${tmpPath}" >/dev/null 2>&1 && echo OK`, { timeout: 30000 });
  if (typeof testResult === 'object' || !testResult.includes('OK')) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    return { success: false, error: 'backup verification failed (corrupt archive)' };
  }

  // Atomic move to final location
  fs.renameSync(tmpPath, finalPath);

  const stats = fs.statSync(finalPath);
  return {
    success: true,
    file: finalPath,
    filename,
    sizeBytes: stats.size,
    sizeKb: Math.round(stats.size / 1024),
  };
}

function pruneOldBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('freedomforge-data-') && f.endsWith('.tar.gz'))
    .sort()
    .reverse();

  const toDelete = files.slice(RETENTION);
  for (const f of toDelete) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
    } catch { /* ignore */ }
  }
  return { kept: Math.min(files.length, RETENTION), pruned: toDelete.length };
}

function syncRemote(backupPath) {
  if (!REMOTE_TARGET) return { synced: false, reason: 'no remote target configured' };

  const result = run(`rsync -az "${backupPath}" "${REMOTE_TARGET}"`, { timeout: 120000 });
  if (result?.error) {
    return { synced: false, error: result.error };
  }
  return { synced: true, target: REMOTE_TARGET };
}

function getDataInventory() {
  const inventory = {};
  try {
    const files = fs.readdirSync(DATA_DIR);
    for (const f of files) {
      const fp = path.join(DATA_DIR, f);
      try {
        const stats = fs.statSync(fp);
        if (stats.isFile()) {
          inventory[f] = { sizeBytes: stats.size, modifiedAt: stats.mtimeMs };
        } else if (stats.isDirectory()) {
          const subFiles = fs.readdirSync(fp);
          inventory[f + '/'] = { files: subFiles.length, isDir: true };
        }
      } catch { /* skip */ }
    }
  } catch { /* data dir doesn't exist */ }
  return inventory;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  if (!ENABLED) {
    console.log(JSON.stringify({ status: 'disabled', reason: 'BACKUP_ENABLED=false' }));
    process.exit(0);
  }

  const startMs = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log('  FREEDOMFORGE DATA BACKUP');
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(60)}\n`);

  // Data inventory
  const inventory = getDataInventory();
  const fileCount = Object.keys(inventory).length;
  console.log(`  Data files: ${fileCount}`);

  // Create backup
  console.log('  Creating backup...');
  const backup = createBackup();

  if (!backup.success) {
    console.error(`  BACKUP FAILED: ${backup.error}`);
    sendAlert(`**Backup Failed**: ${backup.error}`);

    if (signalBus) {
      try {
        signalBus.publish({
          type: 'backup_result',
          source: 'data-backup',
          confidence: 1.0,
          payload: { success: false, error: backup.error },
          ttlMs: 24 * 60 * 60 * 1000,
        });
      } catch { /* ignore */ }
    }

    console.log(JSON.stringify({ status: 'failed', error: backup.error }, null, 2));
    process.exit(1);
  }

  console.log(`  Backup created: ${backup.filename} (${backup.sizeKb} KB)`);

  // Prune old backups
  const prune = pruneOldBackups();
  console.log(`  Retention: kept ${prune.kept}, pruned ${prune.pruned} (max: ${RETENTION})`);

  // Remote sync
  const remote = syncRemote(backup.file);
  if (remote.synced) {
    console.log(`  Remote sync: OK (${remote.target})`);
  } else if (remote.error) {
    console.log(`  Remote sync: FAILED (${remote.error})`);
  } else {
    console.log(`  Remote sync: skipped (no target configured)`);
  }

  const duration = Date.now() - startMs;

  // Publish to signal bus
  if (signalBus) {
    try {
      signalBus.publish({
        type: 'backup_result',
        source: 'data-backup',
        confidence: 1.0,
        payload: {
          success: true,
          file: backup.filename,
          sizeKb: backup.sizeKb,
          dataFiles: fileCount,
          duration_ms: duration,
          remoteSynced: remote.synced,
        },
        ttlMs: 24 * 60 * 60 * 1000,
      });
    } catch { /* ignore */ }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('  BACKUP COMPLETE');
  console.log(`  Duration: ${duration}ms`);
  console.log(`${'='.repeat(60)}\n`);

  const report = {
    status: 'success',
    ts: new Date().toISOString(),
    duration_ms: duration,
    backup: { file: backup.filename, sizeKb: backup.sizeKb },
    retention: prune,
    remote,
    inventory,
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
