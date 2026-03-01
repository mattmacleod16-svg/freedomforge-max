/*
 * Apply recommended env overrides to Vercel
 *
 * Reads key/value pairs from ops/recommended-env-overrides.env and upserts them
 * to a Vercel project via API.
 *
 * Required env:
 *   VERCEL_TOKEN
 *   VERCEL_PROJECT_ID
 *
 * Optional env:
 *   VERCEL_TEAM_ID
 *   VERCEL_TARGET=production|preview|development|all (default: production)
 *   APPLY_KEYS=KEY1,KEY2 (default: all keys from file)
 *   OPS_PATCH_FILE=ops/recommended-env-overrides.env
 *   DRY_RUN=true|false (default: false)
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const token = process.env.VERCEL_TOKEN || '';
const projectId = process.env.VERCEL_PROJECT_ID || '';
const teamId = process.env.VERCEL_TEAM_ID || '';
const targetInput = (process.env.VERCEL_TARGET || 'production').trim();
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

function resolveTargets(target) {
  if (target === 'all') return ['production', 'preview', 'development'];
  if (target === 'production' || target === 'preview' || target === 'development') {
    return [target];
  }
  throw new Error(`invalid VERCEL_TARGET: ${target}`);
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

function buildUrl() {
  const base = `https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env?upsert=true`;
  if (!teamId) return base;
  return `${base}&teamId=${encodeURIComponent(teamId)}`;
}

async function upsertOne(url, key, value, targets) {
  const payload = {
    key,
    value,
    type: 'encrypted',
    target: targets,
  };

  if (dryRun) {
    console.log(`[dry-run] upsert ${key} -> ${targets.join(',')} value=${value}`);
    return;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`failed upsert for ${key}: status ${response.status} body ${body}`);
  }
}

async function main() {
  const entries = parsePatchFile(path.resolve(process.cwd(), patchFile));
  const targets = resolveTargets(targetInput);
  const keys = pickKeys(entries);

  if (keys.length === 0) {
    console.log('No keys selected for apply. Nothing to do.');
    return;
  }

  if (!dryRun) {
    if (!token) throw new Error('missing VERCEL_TOKEN');
    if (!projectId) throw new Error('missing VERCEL_PROJECT_ID');
  }

  const url = buildUrl();
  console.log(`Applying ${keys.length} env key(s) to Vercel target(s): ${targets.join(', ')}`);
  for (const key of keys) {
    await upsertOne(url, key, entries[key], targets);
  }
  console.log('apply-vercel-env: done');
}

main().catch((error) => {
  console.error('apply-vercel-env failed:', error?.message || String(error));
  process.exit(1);
});
