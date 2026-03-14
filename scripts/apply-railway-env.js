/*
 * Apply recommended env overrides to Railway
 *
 * Reads key/value pairs from ops/recommended-env-overrides.env and upserts them
 * to a Railway project via the Railway GraphQL API (or Railway CLI as fallback).
 *
 * Required env:
 *   RAILWAY_TOKEN
 *   RAILWAY_PROJECT_ID
 *
 * Optional env:
 *   RAILWAY_SERVICE_ID
 *   RAILWAY_ENVIRONMENT_ID
 *   APPLY_KEYS=KEY1,KEY2 (default: all keys from file)
 *   OPS_PATCH_FILE=ops/recommended-env-overrides.env
 *   DRY_RUN=true|false (default: false)
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { upsertEnvVars, hasRailwayCli } = require('../lib/railway-helpers');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const token = process.env.RAILWAY_TOKEN || '';
const projectId = process.env.RAILWAY_PROJECT_ID || '';
const serviceId = process.env.RAILWAY_SERVICE_ID || '';
const environmentId = process.env.RAILWAY_ENVIRONMENT_ID || '';
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

  if (!dryRun) {
    if (!token && !hasRailwayCli()) throw new Error('missing RAILWAY_TOKEN (and Railway CLI is not available)');
    if (token && !projectId) throw new Error('missing RAILWAY_PROJECT_ID');
  }

  if (dryRun) {
    for (const key of keys) {
      console.log(`[dry-run] upsert ${key}=${entries[key]}`);
    }
    console.log(`apply-railway-env: dry-run complete (${keys.length} keys)`);
    return;
  }

  const kvMap = Object.fromEntries(keys.map((k) => [k, entries[k]]));
  console.log(`Applying ${keys.length} env key(s) to Railway project...`);
  await upsertEnvVars(kvMap, { token, projectId, serviceId, environmentId });
  console.log('apply-railway-env: done');
}

main().catch((error) => {
  console.error('apply-railway-env failed:', error?.message || String(error));
  process.exit(1);
});
