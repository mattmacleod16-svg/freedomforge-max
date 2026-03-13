/**
 * Config Hot-Reload
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Watch configuration files for changes and apply them without restart:
 *   - .env.local → environment variables
 *   - data/kill-switch.json → kill switch state
 *   - Any registered JSON config files
 *
 * The orchestrator calls `reloadIfChanged()` at the start of each cycle.
 * File changes are detected via mtime comparison (no fs.watch needed — more
 * reliable across platforms and NFS mounts).
 *
 * Usage:
 *   const config = require('./config-hot-reload');
 *   config.register('/path/to/config.json', (newData) => { ... });
 *   // In orchestrator cycle:
 *   const changes = config.reloadIfChanged();
 *
 * @module lib/config-hot-reload
 */

'use strict';

const { createLogger } = require('./logger');
const log = createLogger('config-reload');
const fs = require('fs');
const path = require('path');

let alertBus;
try { alertBus = require('./alerting-bus'); } catch { alertBus = null; }

// ─── Configuration ────────────────────────────────────────────────────────────
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const ENV_PATH = path.resolve(__dirname, '..', '.env.local');
const MIN_RELOAD_INTERVAL_MS = Number(process.env.CONFIG_MIN_RELOAD_MS || 5000); // 5s debounce

// ─── Watched Files Registry ───────────────────────────────────────────────────
const watchedFiles = new Map(); // filePath → { lastMtime, lastHash, callback, lastReloaded }

/**
 * Register a file to be watched for changes.
 *
 * @param {string} filePath - Absolute path to the file
 * @param {function} callback - Called with parsed data when file changes
 * @param {object} [opts]
 * @param {string} [opts.parser] - 'json' (default) or 'env' or 'raw'
 * @returns {boolean}
 */
function register(filePath, callback, opts = {}) {
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(DATA_DIR, filePath);
  const parser = opts.parser || (absPath.endsWith('.json') ? 'json' : absPath.includes('.env') ? 'env' : 'raw');

  let lastMtime = 0;
  try {
    const stat = fs.statSync(absPath);
    lastMtime = stat.mtimeMs;
  } catch { /* file may not exist yet */ }

  watchedFiles.set(absPath, {
    lastMtime,
    parser,
    callback,
    lastReloaded: 0,
    reloadCount: 0,
    errors: 0,
  });

  log.info(`Registered config watch: ${path.basename(absPath)} (parser: ${parser})`);
  return true;
}

/**
 * Unregister a file from watching.
 *
 * @param {string} filePath
 */
function unregister(filePath) {
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(DATA_DIR, filePath);
  watchedFiles.delete(absPath);
}

// ─── Reload Logic ─────────────────────────────────────────────────────────────

/**
 * Check all watched files for changes and reload if needed.
 * Call this at the start of each orchestrator cycle.
 *
 * @returns {{ reloaded: string[], errors: string[] }}
 */
function reloadIfChanged() {
  const reloaded = [];
  const errors = [];
  const now = Date.now();

  for (const [filePath, entry] of watchedFiles.entries()) {
    try {
      // Debounce
      if (now - entry.lastReloaded < MIN_RELOAD_INTERVAL_MS) continue;

      if (!fs.existsSync(filePath)) continue;

      const stat = fs.statSync(filePath);
      const currentMtime = stat.mtimeMs;

      // Check if file changed
      if (currentMtime <= entry.lastMtime) continue;

      // File changed — reload
      const data = readAndParse(filePath, entry.parser);
      if (data === null) {
        errors.push(filePath);
        entry.errors++;
        continue;
      }

      // Call callback
      try {
        entry.callback(data, filePath);
        entry.lastMtime = currentMtime;
        entry.lastReloaded = now;
        entry.reloadCount++;
        reloaded.push(path.basename(filePath));
        log.info(`Hot-reloaded: ${path.basename(filePath)} (reload #${entry.reloadCount})`);
      } catch (cbErr) {
        errors.push(filePath);
        entry.errors++;
        log.error(`Callback error for ${path.basename(filePath)}:`, cbErr?.message);
      }
    } catch (err) {
      errors.push(filePath);
      log.warn(`Error checking ${path.basename(filePath)}:`, err?.message);
    }
  }

  if (reloaded.length > 0) {
    if (alertBus) alertBus.info('config', `Hot-reloaded: ${reloaded.join(', ')}`);
  }

  return { reloaded, errors };
}

/**
 * Read and parse a file based on its type.
 */
function readAndParse(filePath, parser) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');

    switch (parser) {
      case 'json':
        return JSON.parse(raw);

      case 'env':
        return parseEnvFile(raw);

      case 'raw':
        return raw;

      default:
        return raw;
    }
  } catch (err) {
    log.warn(`Parse error for ${path.basename(filePath)}:`, err?.message);
    return null;
  }
}

/**
 * Parse .env file format into key-value object.
 */
function parseEnvFile(content) {
  const result = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

// ─── Built-in Watchers ────────────────────────────────────────────────────────

/**
 * Set up default watchers for common config files.
 */
function registerDefaults() {
  // Watch .env.local
  register(ENV_PATH, (envData) => {
    let applied = 0;
    for (const [key, value] of Object.entries(envData)) {
      if (process.env[key] !== value) {
        process.env[key] = value;
        applied++;
      }
    }
    if (applied > 0) {
      log.info(`Applied ${applied} env var changes from .env.local`);
    }
  }, { parser: 'env' });

  // Watch kill-switch.json
  const killSwitchPath = path.resolve(DATA_DIR, 'kill-switch.json');
  register(killSwitchPath, (data) => {
    log.info(`Kill switch config reloaded: active=${data?.active}, maintenance=${data?.maintenanceMode}`);
  });

  // Watch autonomy-state.json
  const autonomyPath = path.resolve(DATA_DIR, 'autonomy-state.json');
  register(autonomyPath, (data) => {
    log.info(`Autonomy state reloaded: level=${data?.currentLevel}`);
  });

  // Watch capital-mandate-state.json
  const mandatePath = path.resolve(DATA_DIR, 'capital-mandate-state.json');
  register(mandatePath, (data) => {
    log.info(`Capital mandate reloaded: phase=${data?.currentPhase}`);
  });
}

// ─── Force Reload ─────────────────────────────────────────────────────────────

/**
 * Force reload a specific file regardless of mtime.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function forceReload(filePath) {
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(DATA_DIR, filePath);
  const entry = watchedFiles.get(absPath);

  if (!entry) {
    log.warn(`Cannot force reload: ${path.basename(absPath)} not registered`);
    return false;
  }

  entry.lastMtime = 0; // Reset mtime to force reload
  const result = reloadIfChanged();
  return result.reloaded.length > 0;
}

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * Get hot-reload status dashboard.
 */
function getStatus() {
  const files = [];
  for (const [filePath, entry] of watchedFiles.entries()) {
    files.push({
      file: path.basename(filePath),
      path: filePath,
      parser: entry.parser,
      reloadCount: entry.reloadCount,
      errors: entry.errors,
      lastReloaded: entry.lastReloaded ? new Date(entry.lastReloaded).toISOString() : null,
    });
  }

  return {
    watchedFiles: files.length,
    files,
    minReloadIntervalMs: MIN_RELOAD_INTERVAL_MS,
  };
}

// ─── Initialize Default Watchers ──────────────────────────────────────────────
registerDefaults();

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  register,
  unregister,
  reloadIfChanged,
  forceReload,
  getStatus,
  registerDefaults,
  parseEnvFile,
};
