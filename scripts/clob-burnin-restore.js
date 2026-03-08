#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const VERCEL_TOKEN = process.env.VERCEL_TOKEN || '';
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || '';
const VERCEL_PROJECT_SLUG = process.env.VERCEL_PROJECT_SLUG || 'freedomforge-max';
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || '';
const AUTO_REDEPLOY = String(process.env.CLOB_BURNIN_RESTORE_AUTO_REDEPLOY || 'true').toLowerCase() === 'true';

function hasVercelCli() {
  const result = spawnSync('vercel', ['--version'], { stdio: 'pipe', encoding: 'utf8' });
  return result.status === 0;
}

function runVercel(args) {
  const result = spawnSync('vercel', args, { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    throw new Error(`vercel ${args.join(' ')} failed: ${stderr || stdout || 'unknown error'}`);
  }
}

function vercelApiUrl(pathname) {
  const base = `https://api.vercel.com${pathname}`;
  if (!VERCEL_TEAM_ID) return base;
  const joiner = pathname.includes('?') ? '&' : '?';
  return `${base}${joiner}teamId=${encodeURIComponent(VERCEL_TEAM_ID)}`;
}

function candidateProjectRefs() {
  const refs = [VERCEL_PROJECT_ID, VERCEL_PROJECT_SLUG]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return [...new Set(refs)];
}

async function upsertEnvVar(key, value) {
  if (!VERCEL_TOKEN && hasVercelCli()) {
    const args = ['env', 'add', key, 'production', '--value', value, '--force', '--yes'];
    if (VERCEL_TEAM_ID) args.push('--scope', VERCEL_TEAM_ID);
    runVercel(args);
    return;
  }

  let lastError = null;
  for (const projectRef of candidateProjectRefs()) {
    const url = vercelApiUrl(`/v10/projects/${encodeURIComponent(projectRef)}/env?upsert=true`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key,
        value,
        type: 'encrypted',
        target: ['production'],
      }),
    });

    if (response.ok) return;
    const body = await response.text().catch(() => '');
    lastError = `project=${projectRef} status=${response.status} body=${body}`;
    if (response.status !== 404) break;
  }

  throw new Error(`Vercel env upsert failed for ${key}: ${lastError || 'unknown error'}`);
}

async function tryRedeployLatestProduction() {
  if (!VERCEL_TOKEN && hasVercelCli()) {
    const args = ['--prod', '--yes'];
    if (VERCEL_TEAM_ID) args.push('--scope', VERCEL_TEAM_ID);
    runVercel(args);
    return;
  }

  let deployment = null;

  for (const projectRef of candidateProjectRefs()) {
    const listUrl = vercelApiUrl(`/v6/deployments?projectId=${encodeURIComponent(projectRef)}&target=production&limit=1`);
    const listResponse = await fetch(listUrl, {
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!listResponse.ok) continue;
    const listPayload = await listResponse.json();
    deployment = (listPayload.deployments || [])[0] || null;
    if (deployment?.uid) break;
  }

  if (!deployment?.uid) {
    throw new Error('No production deployment found to redeploy');
  }

  const redeployUrl = vercelApiUrl(`/v13/deployments/${deployment.uid}/redeploy`);
  const redeployResponse = await fetch(redeployUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ target: 'production' }),
  });

  if (!redeployResponse.ok) {
    const body = await redeployResponse.text().catch(() => '');
    throw new Error(`Redeploy failed: HTTP ${redeployResponse.status} ${body}`);
  }
}

function normalProfile() {
  return {
    POLY_CLOB_MAX_ORDERS_PER_CYCLE: String(process.env.CLOB_BURNIN_RESTORE_MAX_ORDERS || '2'),
    POLY_CLOB_MICRO_SPLITS: String(process.env.CLOB_BURNIN_RESTORE_MICRO_SPLITS || '2'),
    POLY_CLOB_MIN_INTERVAL_SEC: String(process.env.CLOB_BURNIN_RESTORE_MIN_INTERVAL_SEC || '120'),
    POLY_CLOB_MIN_CONFIDENCE: String(process.env.CLOB_BURNIN_RESTORE_MIN_CONFIDENCE || '0.56'),
    POLY_CLOB_ORDER_USD: String(process.env.CLOB_BURNIN_RESTORE_ORDER_USD || '5'),
    POLY_CLOB_ORDER_USD_MAX: String(process.env.CLOB_BURNIN_RESTORE_ORDER_USD_MAX || '25'),
    POLY_CLOB_PRICE_FLOOR: String(process.env.CLOB_BURNIN_RESTORE_PRICE_FLOOR || '0.38'),
    POLY_CLOB_PRICE_CAP: String(process.env.CLOB_BURNIN_RESTORE_PRICE_CAP || '0.62'),
  };
}

async function main() {
  const canUseTokenApi = Boolean(VERCEL_TOKEN);
  const canUseCli = hasVercelCli();

  if (!canUseTokenApi && !canUseCli) {
    throw new Error('Missing VERCEL_TOKEN and Vercel CLI is not available/authenticated');
  }

  if (canUseTokenApi && candidateProjectRefs().length === 0) {
    throw new Error('Missing both VERCEL_PROJECT_ID and VERCEL_PROJECT_SLUG');
  }

  const patch = normalProfile();
  const entries = Object.entries(patch);

  for (const [key, value] of entries) {
    await upsertEnvVar(key, value);
  }

  if (AUTO_REDEPLOY) {
    try {
      await tryRedeployLatestProduction();
      console.log(`CLOB burn-in normal profile restored (${entries.length} keys) + redeploy requested.`);
      return;
    } catch (error) {
      console.log(`CLOB burn-in normal profile restored (${entries.length} keys), redeploy failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  }

  console.log(`CLOB burn-in normal profile restored (${entries.length} keys).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
