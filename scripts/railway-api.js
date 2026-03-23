/**
 * Railway API utility — replaces all Vercel env upsert / redeploy functions.
 *
 * Uses the Railway GraphQL API to:
 *   - Upsert environment variables on a service
 *   - Trigger a redeployment of the latest production deployment
 *
 * Required env:
 *   RAILWAY_TOKEN          — API token from railway.com/account/tokens
 *   RAILWAY_PROJECT_ID     — Project ID from Railway dashboard (Settings → General)
 *   RAILWAY_SERVICE_ID     — Service ID (discovered automatically if not set)
 *
 * Optional env:
 *   RAILWAY_ENVIRONMENT_ID — Specific environment to target (defaults to production)
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const RAILWAY_TOKEN = process.env.RAILWAY_TOKEN || '';
const RAILWAY_PROJECT_ID = process.env.RAILWAY_PROJECT_ID || '';
let RAILWAY_SERVICE_ID = process.env.RAILWAY_SERVICE_ID || '';
let RAILWAY_ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID || '';

const GQL_ENDPOINT = 'https://backboard.railway.com/graphql/v2';

// ─── GraphQL helper ────────────────────────────────────────────────────────

async function gql(query, variables = {}) {
  if (!RAILWAY_TOKEN) throw new Error('Missing RAILWAY_TOKEN');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(GQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RAILWAY_TOKEN}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Railway API HTTP ${res.status}: ${body}`);
    }
    const json = await res.json();
    if (json.errors?.length) {
      throw new Error(`Railway API error: ${json.errors.map(e => e.message).join('; ')}`);
    }
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Auto-discover service & environment IDs ───────────────────────────────

async function ensureIds() {
  if (!RAILWAY_PROJECT_ID) throw new Error('Missing RAILWAY_PROJECT_ID');

  // Discover service ID if not set
  if (!RAILWAY_SERVICE_ID) {
    const data = await gql(`
      query ($projectId: String!) {
        project(id: $projectId) {
          services {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    `, { projectId: RAILWAY_PROJECT_ID });

    const services = (data?.project?.services?.edges || []).map(e => e.node);
    if (services.length === 0) {
      throw new Error('No services found in Railway project');
    }
    // Prefer a service named 'freedomforge-max' or the first one
    const preferred = services.find(s =>
      s.name.toLowerCase().includes('freedomforge') || s.name.toLowerCase().includes('web')
    ) || services[0];
    RAILWAY_SERVICE_ID = preferred.id;
    console.log(`[railway-api] Auto-discovered service: "${preferred.name}" (${preferred.id})`);
  }

  // Discover production environment ID if not set
  if (!RAILWAY_ENVIRONMENT_ID) {
    const data = await gql(`
      query ($projectId: String!) {
        project(id: $projectId) {
          environments {
            edges {
              node {
                id
                name
                isEphemeral
              }
            }
          }
        }
      }
    `, { projectId: RAILWAY_PROJECT_ID });

    const envs = (data?.project?.environments?.edges || []).map(e => e.node);
    const prod = envs.find(e => e.name.toLowerCase() === 'production' && !e.isEphemeral)
      || envs.find(e => !e.isEphemeral)
      || envs[0];
    if (!prod) throw new Error('No environments found in Railway project');
    RAILWAY_ENVIRONMENT_ID = prod.id;
    console.log(`[railway-api] Auto-discovered environment: "${prod.name}" (${prod.id})`);
  }
}

// ─── Upsert a single env var ───────────────────────────────────────────────

async function upsertEnvVar(key, value) {
  await ensureIds();
  await gql(`
    mutation ($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }
  `, {
    input: {
      projectId: RAILWAY_PROJECT_ID,
      environmentId: RAILWAY_ENVIRONMENT_ID,
      serviceId: RAILWAY_SERVICE_ID,
      variables: { [key]: value },
    },
  });
}

// ─── Bulk upsert env vars (more efficient — single API call) ───────────────

async function bulkUpsertEnvVars(kvMap) {
  await ensureIds();
  await gql(`
    mutation ($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }
  `, {
    input: {
      projectId: RAILWAY_PROJECT_ID,
      environmentId: RAILWAY_ENVIRONMENT_ID,
      serviceId: RAILWAY_SERVICE_ID,
      variables: kvMap,
    },
  });
}

// ─── Trigger redeploy ─────────────────────────────────────────────────────

async function triggerRedeploy() {
  await ensureIds();
  // Get latest deployment
  const data = await gql(`
    query ($projectId: String!, $serviceId: String!, $environmentId: String!) {
      deployments(
        first: 1
        input: {
          projectId: $projectId
          serviceId: $serviceId
          environmentId: $environmentId
        }
      ) {
        edges {
          node {
            id
            status
          }
        }
      }
    }
  `, {
    projectId: RAILWAY_PROJECT_ID,
    serviceId: RAILWAY_SERVICE_ID,
    environmentId: RAILWAY_ENVIRONMENT_ID,
  });

  const latest = data?.deployments?.edges?.[0]?.node;
  if (!latest) {
    // No existing deployment — trigger fresh deploy via serviceInstanceRedeploy
    await gql(`
      mutation ($serviceId: String!, $environmentId: String!) {
        serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
      }
    `, { serviceId: RAILWAY_SERVICE_ID, environmentId: RAILWAY_ENVIRONMENT_ID });
    return;
  }

  // Redeploy the latest
  await gql(`
    mutation ($deploymentId: String!) {
      deploymentRedeploy(id: $deploymentId)
    }
  `, { deploymentId: latest.id });
}

// ─── Get current env vars ──────────────────────────────────────────────────

async function getEnvVars() {
  await ensureIds();
  const data = await gql(`
    query ($projectId: String!, $serviceId: String!, $environmentId: String!) {
      variables(
        projectId: $projectId
        serviceId: $serviceId
        environmentId: $environmentId
      )
    }
  `, {
    projectId: RAILWAY_PROJECT_ID,
    serviceId: RAILWAY_SERVICE_ID,
    environmentId: RAILWAY_ENVIRONMENT_ID,
  });
  return data?.variables || {};
}

// ─── Get service info ──────────────────────────────────────────────────────

async function getServiceInfo() {
  await ensureIds();
  return { projectId: RAILWAY_PROJECT_ID, serviceId: RAILWAY_SERVICE_ID, environmentId: RAILWAY_ENVIRONMENT_ID };
}

module.exports = {
  upsertEnvVar,
  bulkUpsertEnvVars,
  triggerRedeploy,
  getEnvVars,
  getServiceInfo,
  ensureIds,
};

// ─── CLI mode: node scripts/railway-api.js <command> ─────────────────────

if (require.main === module) {
  const cmd = process.argv[2];

  const commands = {
    async 'list-vars'() {
      const vars = await getEnvVars();
      const keys = Object.keys(vars).sort();
      console.log(`Railway env vars (${keys.length} total):`);
      for (const k of keys) {
        const v = vars[k];
        const display = v.length > 40 ? v.slice(0, 37) + '...' : v;
        console.log(`  ${k}=${display}`);
      }
    },
    async 'set'() {
      const key = process.argv[3];
      const value = process.argv[4];
      if (!key || value === undefined) {
        console.error('Usage: railway-api.js set <KEY> <VALUE>');
        process.exit(1);
      }
      await upsertEnvVar(key, value);
      console.log(`Set ${key} on Railway`);
    },
    async 'redeploy'() {
      await triggerRedeploy();
      console.log('Redeploy triggered on Railway');
    },
    async 'info'() {
      const info = await getServiceInfo();
      console.log(JSON.stringify(info, null, 2));
    },
  };

  if (!commands[cmd]) {
    console.log('Usage: node scripts/railway-api.js <list-vars|set|redeploy|info>');
    process.exit(1);
  }

  commands[cmd]().catch(err => {
    console.error(err.message || String(err));
    process.exit(1);
  });
}
