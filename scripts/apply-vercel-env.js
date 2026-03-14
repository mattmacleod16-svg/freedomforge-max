/*
 * Apply recommended env overrides to deployment platform (Railway or Vercel)
 *
 * Reads key/value pairs from ops/recommended-env-overrides.env and upserts them
 * to the configured deployment platform via API.
 *
 * Required env (one of):
 *   RAILWAY_TOKEN + RAILWAY_PROJECT_ID + RAILWAY_SERVICE_ID
 *   VERCEL_TOKEN + VERCEL_PROJECT_ID
 *
 * Optional env:
 *   APPLY_KEYS=KEY1,KEY2 (default: all keys from file)
 *   OPS_PATCH_FILE=ops/recommended-env-overrides.env
 *   DRY_RUN=true|false (default: false)
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const { upsertEnvVar, platform } = require('../lib/deploy-platform');

const applyKeysRaw = (process.env.APPLY_KEYS || '').trim();
const patchFile = process.env.OPS_PATCH_FILE || 'ops/recommended-env-overrides.env';
const dryRun = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';

function parsePatchFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`patch file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8').split('\n');
  const out = {};

  for (const line of raw) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) out[key] = value;
  }

  return out;
}

function pickKeys(allEntries) {
  const keys = Object.keys(allEntries);
  if (!applyKeysRaw) return keys;

  const wanted = new Set(
    applyKeysRaw
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
  );

  return keys.filter((k) => wanted.has(k));
}

async function main() {
  const entries = parsePatchFile(path.resolve(process.cwd(), patchFile));
  const keys = pickKeys(entries);

  if (keys.length === 0) {
    console.log('No keys selected for apply. Nothing to do.');
    return;
  }

  if (!dryRun && platform === 'none') {
    throw new Error('No deployment platform configured. Set RAILWAY_TOKEN or VERCEL_TOKEN.');
  }

  console.log(`Applying ${keys.length} env key(s) via ${platform} (${dryRun ? 'dry-run' : 'live'})`);
  for (const key of keys) {
    await upsertEnvVar(key, entries[key], { dryRun });
  }
  console.log('apply-env: done');
}

main().catch((error) => {
  console.error('apply-env failed:', error?.message || String(error));
  process.exit(1);
});
