/**
 * Railway deployment helpers
 *
 * Provides env-var upsert and redeployment utilities using the Railway GraphQL API.
 *
 * Required env:
 *   RAILWAY_TOKEN         — Railway API token
 *   RAILWAY_PROJECT_ID    — Railway project ID
 *   RAILWAY_SERVICE_ID    — Railway service ID (optional, used for targeted redeploy)
 *   RAILWAY_ENVIRONMENT_ID — Railway environment ID (defaults to production environment)
 *
 * Optional env:
 *   RAILWAY_SERVICE_NAME  — Human-readable service name (fallback identifier)
 */

'use strict';

const { spawnSync } = require('child_process');

const RAILWAY_API_URL = 'https://backboard.railway.app/graphql/v2';

/**
 * Check whether the Railway CLI is installed and authenticated.
 */
function hasRailwayCli() {
  const result = spawnSync('railway', ['whoami'], { stdio: 'pipe', encoding: 'utf8' });
  return result.status === 0;
}

/**
 * Run a Railway CLI command synchronously.
 * @param {string[]} args
 */
function runRailway(args) {
  const result = spawnSync('railway', args, { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    throw new Error(`railway ${args.join(' ')} failed: ${stderr || stdout || 'unknown error'}`);
  }
  return (result.stdout || '').trim();
}

/**
 * Execute a GraphQL mutation/query against the Railway API.
 * @param {string} token  Railway API token
 * @param {string} query  GraphQL query/mutation string
 * @param {object} variables  GraphQL variables
 */
async function railwayGraphQL(token, query, variables = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetch(RAILWAY_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Railway API HTTP ${response.status}: ${body}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`Railway API returned non-JSON: ${body}`);
  }

  if (parsed.errors && parsed.errors.length > 0) {
    throw new Error(`Railway API error: ${parsed.errors.map((e) => e.message).join('; ')}`);
  }

  return parsed.data;
}

/**
 * Upsert a single environment variable in the Railway project's production environment.
 *
 * Falls back to Railway CLI (`railway variables set`) if no token is provided
 * but the CLI is available.
 *
 * @param {string} key
 * @param {string} value
 * @param {{ token?: string, projectId?: string, serviceId?: string, environmentId?: string }} opts
 */
async function upsertEnvVar(key, value, opts = {}) {
  const token = opts.token || process.env.RAILWAY_TOKEN || '';
  const projectId = opts.projectId || process.env.RAILWAY_PROJECT_ID || '';
  const serviceId = opts.serviceId || process.env.RAILWAY_SERVICE_ID || '';
  const environmentId = opts.environmentId || process.env.RAILWAY_ENVIRONMENT_ID || '';

  if (!token && hasRailwayCli()) {
    const args = ['variables', 'set', `${key}=${value}`];
    if (serviceId) args.push('--service', serviceId);
    runRailway(args);
    return;
  }

  if (!token) {
    throw new Error('RAILWAY_TOKEN is required to upsert env vars (no Railway CLI available)');
  }

  if (!projectId) {
    throw new Error('RAILWAY_PROJECT_ID is required to upsert env vars');
  }

  // Use Railway's upsertVariableCollection mutation
  const mutation = `
    mutation UpsertVariables($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }
  `;

  const variables = {
    input: {
      projectId,
      ...(environmentId ? { environmentId } : {}),
      ...(serviceId ? { serviceId } : {}),
      variables: { [key]: value },
    },
  };

  await railwayGraphQL(token, mutation, variables);
}

/**
 * Upsert multiple environment variables in one API call.
 *
 * @param {Record<string, string>} kvMap
 * @param {{ token?: string, projectId?: string, serviceId?: string, environmentId?: string }} opts
 */
async function upsertEnvVars(kvMap, opts = {}) {
  const token = opts.token || process.env.RAILWAY_TOKEN || '';
  const projectId = opts.projectId || process.env.RAILWAY_PROJECT_ID || '';
  const serviceId = opts.serviceId || process.env.RAILWAY_SERVICE_ID || '';
  const environmentId = opts.environmentId || process.env.RAILWAY_ENVIRONMENT_ID || '';

  if (!token && hasRailwayCli()) {
    for (const [key, value] of Object.entries(kvMap)) {
      const args = ['variables', 'set', `${key}=${value}`];
      if (serviceId) args.push('--service', serviceId);
      runRailway(args);
    }
    return;
  }

  if (!token) {
    throw new Error('RAILWAY_TOKEN is required to upsert env vars (no Railway CLI available)');
  }

  if (!projectId) {
    throw new Error('RAILWAY_PROJECT_ID is required to upsert env vars');
  }

  const mutation = `
    mutation UpsertVariables($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }
  `;

  const variables = {
    input: {
      projectId,
      ...(environmentId ? { environmentId } : {}),
      ...(serviceId ? { serviceId } : {}),
      variables: kvMap,
    },
  };

  await railwayGraphQL(token, mutation, variables);
}

/**
 * Trigger a redeployment of the latest production deployment via Railway API,
 * or via Railway CLI if no token is provided.
 *
 * @param {{ token?: string, projectId?: string, serviceId?: string, environmentId?: string }} opts
 */
async function triggerRedeployment(opts = {}) {
  const token = opts.token || process.env.RAILWAY_TOKEN || '';
  const serviceId = opts.serviceId || process.env.RAILWAY_SERVICE_ID || '';

  if (!token && hasRailwayCli()) {
    const args = ['up', '--detach'];
    if (serviceId) args.push('--service', serviceId);
    runRailway(args);
    console.log('Redeployment requested via Railway CLI.');
    return;
  }

  if (!token) {
    throw new Error('RAILWAY_TOKEN is required to trigger redeployment (no Railway CLI available)');
  }

  if (!serviceId) {
    throw new Error('RAILWAY_SERVICE_ID is required to trigger redeployment via API');
  }

  const mutation = `
    mutation ServiceInstanceRedeploy($serviceId: String!, $environmentId: String) {
      serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
    }
  `;

  const variables = {
    serviceId,
    ...(opts.environmentId || process.env.RAILWAY_ENVIRONMENT_ID
      ? { environmentId: opts.environmentId || process.env.RAILWAY_ENVIRONMENT_ID }
      : {}),
  };

  await railwayGraphQL(token, mutation, variables);
  console.log('Redeployment requested via Railway API.');
}

module.exports = {
  hasRailwayCli,
  runRailway,
  railwayGraphQL,
  upsertEnvVar,
  upsertEnvVars,
  triggerRedeployment,
};
