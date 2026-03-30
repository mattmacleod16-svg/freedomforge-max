/*
 * Platform-agnostic deployment helper
 *
 * Supports Railway (primary) and Vercel (legacy fallback).
 * Auto-detects which platform to use based on available env vars.
 *
 * Railway env:
 *   RAILWAY_TOKEN          – API token
 *   RAILWAY_PROJECT_ID     – Project ID
 *   RAILWAY_SERVICE_ID     – Service ID
 *   RAILWAY_ENVIRONMENT_ID – Environment ID (optional, defaults to production)
 *
 * Vercel env (legacy):
 *   VERCEL_TOKEN       – API token
 *   VERCEL_PROJECT_ID  – Project ID
 *   VERCEL_TEAM_ID     – Team ID (optional)
 */

const { spawnSync } = require('child_process');

// ── Railway config ──────────────────────────────────────────
const RAILWAY_TOKEN = process.env.RAILWAY_TOKEN || '';
const RAILWAY_PROJECT_ID = process.env.RAILWAY_PROJECT_ID || '';
const RAILWAY_SERVICE_ID = process.env.RAILWAY_SERVICE_ID || '';
const RAILWAY_ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID || '';

// ── Vercel config (legacy) ──────────────────────────────────
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || '';
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || '';
const VERCEL_PROJECT_SLUG = process.env.VERCEL_PROJECT_SLUG || 'freedomforge-max';
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || '';

// ── Platform detection ──────────────────────────────────────
function detectPlatform() {
  if (RAILWAY_TOKEN || RAILWAY_PROJECT_ID) return 'railway';
  if (VERCEL_TOKEN || VERCEL_PROJECT_ID) return 'vercel';

  // Check for CLIs
  if (hasCli('railway')) return 'railway';
  if (hasCli('vercel')) return 'vercel';

  return 'none';
}

function hasCli(cmd) {
  const result = spawnSync(cmd, ['--version'], { stdio: 'pipe', encoding: 'utf8' });
  return result.status === 0;
}

function runCli(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed: ${stderr || stdout || 'unknown error'}`);
  }
  return (result.stdout || '').trim();
}

// ── Railway operations ──────────────────────────────────────
async function railwayGraphQL(query, variables = {}) {
  const response = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RAILWAY_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Railway API error: HTTP ${response.status} ${body}`);
  }

  const result = await response.json();
  if (result.errors?.length) {
    throw new Error(`Railway API error: ${result.errors[0].message}`);
  }
  return result.data;
}

async function railwayUpsertEnvVar(key, value) {
  if (!RAILWAY_TOKEN && hasCli('railway')) {
    runCli('railway', ['variables', 'set', `${key}=${value}`]);
    return;
  }

  if (!RAILWAY_TOKEN) throw new Error('Missing RAILWAY_TOKEN');
  if (!RAILWAY_PROJECT_ID) throw new Error('Missing RAILWAY_PROJECT_ID');
  if (!RAILWAY_SERVICE_ID) throw new Error('Missing RAILWAY_SERVICE_ID');

  const query = `
    mutation variableUpsert($input: VariableUpsertInput!) {
      variableUpsert(input: $input)
    }
  `;

  const input = {
    projectId: RAILWAY_PROJECT_ID,
    serviceId: RAILWAY_SERVICE_ID,
    name: key,
    value: value,
  };
  if (RAILWAY_ENVIRONMENT_ID) {
    input.environmentId = RAILWAY_ENVIRONMENT_ID;
  }

  await railwayGraphQL(query, { input });
}

async function railwayRedeploy() {
  if (!RAILWAY_TOKEN && hasCli('railway')) {
    runCli('railway', ['up', '--detach']);
    return;
  }

  if (!RAILWAY_TOKEN) throw new Error('Missing RAILWAY_TOKEN');
  if (!RAILWAY_SERVICE_ID) throw new Error('Missing RAILWAY_SERVICE_ID');

  const query = `
    mutation serviceInstanceRedeploy($serviceId: String!, $environmentId: String) {
      serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
    }
  `;

  await railwayGraphQL(query, {
    serviceId: RAILWAY_SERVICE_ID,
    environmentId: RAILWAY_ENVIRONMENT_ID || undefined,
  });
}

// ── Vercel operations (legacy) ──────────────────────────────
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

async function vercelUpsertEnvVar(key, value) {
  if (!VERCEL_TOKEN && hasCli('vercel')) {
    const args = ['env', 'add', key, 'production', '--value', value, '--force', '--yes'];
    if (VERCEL_TEAM_ID) args.push('--scope', VERCEL_TEAM_ID);
    runCli('vercel', args);
    return;
  }

  if (!VERCEL_TOKEN) throw new Error('Missing VERCEL_TOKEN');

  let lastError = null;
  for (const projectRef of candidateProjectRefs()) {
    const url = vercelApiUrl(`/v10/projects/${encodeURIComponent(projectRef)}/env?upsert=true`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key, value, type: 'encrypted', target: ['production'] }),
    });

    if (response.ok) return;
    const body = await response.text().catch(() => '');
    lastError = `project=${projectRef} status=${response.status} body=${body}`;
    if (response.status !== 404) break;
  }

  throw new Error(`Vercel env upsert failed for ${key}: ${lastError || 'unknown error'}`);
}

async function vercelRedeploy() {
  if (!VERCEL_TOKEN && hasCli('vercel')) {
    const args = ['--prod', '--yes'];
    if (VERCEL_TEAM_ID) args.push('--scope', VERCEL_TEAM_ID);
    runCli('vercel', args);
    return;
  }

  let deployment = null;
  for (const projectRef of candidateProjectRefs()) {
    const listUrl = vercelApiUrl(`/v6/deployments?projectId=${encodeURIComponent(projectRef)}&target=production&limit=1`);
    const listResponse = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    });
    if (!listResponse.ok) continue;
    const listPayload = await listResponse.json();
    deployment = (listPayload.deployments || [])[0] || null;
    if (deployment?.uid) break;
  }

  if (!deployment?.uid) throw new Error('No production deployment found to redeploy');

  const redeployUrl = vercelApiUrl(`/v13/deployments/${deployment.uid}/redeploy`);
  const redeployResponse = await fetch(redeployUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'production' }),
  });

  if (!redeployResponse.ok) {
    const body = await redeployResponse.text().catch(() => '');
    throw new Error(`Redeploy failed: HTTP ${redeployResponse.status} ${body}`);
  }
}

// ── Public API ──────────────────────────────────────────────
const platform = detectPlatform();

async function upsertEnvVar(key, value, { dryRun = false } = {}) {
  if (dryRun) {
    console.log(`[dry-run] ${key}=${value}`);
    return;
  }

  if (platform === 'railway') return railwayUpsertEnvVar(key, value);
  if (platform === 'vercel') return vercelUpsertEnvVar(key, value);
  throw new Error('No deployment platform configured. Set RAILWAY_TOKEN or VERCEL_TOKEN.');
}

async function redeploy() {
  if (platform === 'railway') return railwayRedeploy();
  if (platform === 'vercel') return vercelRedeploy();
  throw new Error('No deployment platform configured. Set RAILWAY_TOKEN or VERCEL_TOKEN.');
}

module.exports = {
  platform,
  detectPlatform,
  upsertEnvVar,
  redeploy,
  hasCli,
  runCli,
};
