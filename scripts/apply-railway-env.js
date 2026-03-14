/*
 * Apply recommended env overrides to Railway
 *
 * Reads key/value pairs from ops/recommended-env-overrides.env and upserts them
 * to a Railway service via the GraphQL API.
 *
 * Required env:
 *   RAILWAY_TOKEN
 *   RAILWAY_PROJECT_ID
 *   RAILWAY_SERVICE_ID
 *   RAILWAY_ENVIRONMENT_ID
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

const token = process.env.RAILWAY_TOKEN || '';
const projectId = process.env.RAILWAY_PROJECT_ID || '';
const serviceId = process.env.RAILWAY_SERVICE_ID || '';
const environmentId = process.env.RAILWAY_ENVIRONMENT_ID || '';
const applyKeysRaw = (process.env.APPLY_KEYS || '').trim();
const patchFile = process.env.OPS_PATCH_FILE || 'ops/recommended-env-overrides.env';
const dryRun = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';

const RAILWAY_GQL = 'https://backboard.railway.app/graphql/v2';

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

async function upsertOne(key, value) {
  if (dryRun) {
    console.log(`[dry-run] upsert ${key}=${value}`);
    return;
  }

  const mutation = `
    mutation VariableUpsert($input: VariableUpsertInput!) {
      variableUpsert(input: $input)
    }
  `;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(RAILWAY_GQL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: { projectId, serviceId, environmentId, name: key, value },
        },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`failed upsert for ${key}: status ${response.status} body ${body}`);
  }

  const payload = await response.json();
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(`Railway GraphQL error for ${key}: ${payload.errors.map((e) => e.message).join(', ')}`);
  }
}

async function main() {
  const entries = parsePatchFile(path.resolve(process.cwd(), patchFile));
  const keys = pickKeys(entries);

  if (keys.length === 0) {
    console.log('No keys selected for apply. Nothing to do.');
    return;
  }

  if (!dryRun) {
    if (!token) throw new Error('missing RAILWAY_TOKEN');
    if (!projectId) throw new Error('missing RAILWAY_PROJECT_ID');
    if (!serviceId) throw new Error('missing RAILWAY_SERVICE_ID');
    if (!environmentId) throw new Error('missing RAILWAY_ENVIRONMENT_ID');
  }

  console.log(`Applying ${keys.length} env key(s) to Railway service`);
  for (const key of keys) {
    await upsertOne(key, entries[key]);
  }
  console.log('apply-railway-env: done');
}

main().catch((error) => {
  console.error('apply-railway-env failed:', error?.message || String(error));
  process.exit(1);
});
