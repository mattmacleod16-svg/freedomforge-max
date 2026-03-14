#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const RAILWAY_TOKEN = process.env.RAILWAY_TOKEN || '';
const RAILWAY_PROJECT_ID = process.env.RAILWAY_PROJECT_ID || '';
const RAILWAY_SERVICE_ID = process.env.RAILWAY_SERVICE_ID || '';
const RAILWAY_ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID || '';
const AUTO_REDEPLOY = String(process.env.CLOB_BURNIN_PATCH_AUTO_REDEPLOY || 'true').toLowerCase() === 'true';

const RAILWAY_GQL = 'https://backboard.railway.app/graphql/v2';

async function railwayGql(query, variables) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(RAILWAY_GQL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RAILWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Railway GraphQL HTTP ${response.status}: ${body}`);
    }
    const payload = await response.json();
    if (payload.errors && payload.errors.length > 0) {
      throw new Error(`Railway GraphQL error: ${payload.errors.map((e) => e.message).join(', ')}`);
    }
    return payload.data;
  } finally {
    clearTimeout(timer);
  }
}

async function upsertEnvVar(key, value) {
  const mutation = `
    mutation VariableUpsert($input: VariableUpsertInput!) {
      variableUpsert(input: $input)
    }
  `;
  await railwayGql(mutation, {
    input: {
      projectId: RAILWAY_PROJECT_ID,
      serviceId: RAILWAY_SERVICE_ID,
      environmentId: RAILWAY_ENVIRONMENT_ID,
      name: key,
      value,
    },
  });
}

async function tryRedeployLatestProduction() {
  const mutation = `
    mutation ServiceInstanceRedeploy($serviceId: String!, $environmentId: String!) {
      serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
    }
  `;
  await railwayGql(mutation, {
    serviceId: RAILWAY_SERVICE_ID,
    environmentId: RAILWAY_ENVIRONMENT_ID,
  });
}

function conservativeProfile() {
  return {
    POLY_CLOB_DRY_RUN: String(process.env.CLOB_BURNIN_PATCH_DRY_RUN || 'true'),
    POLY_CLOB_MAX_ORDERS_PER_CYCLE: String(process.env.CLOB_BURNIN_PATCH_MAX_ORDERS || '1'),
    POLY_CLOB_MICRO_SPLITS: String(process.env.CLOB_BURNIN_PATCH_MICRO_SPLITS || '1'),
    POLY_CLOB_MIN_INTERVAL_SEC: String(process.env.CLOB_BURNIN_PATCH_MIN_INTERVAL_SEC || '300'),
    POLY_CLOB_MIN_CONFIDENCE: String(process.env.CLOB_BURNIN_PATCH_MIN_CONFIDENCE || '0.60'),
    POLY_CLOB_ORDER_USD: String(process.env.CLOB_BURNIN_PATCH_ORDER_USD || '3'),
    POLY_CLOB_ORDER_USD_MAX: String(process.env.CLOB_BURNIN_PATCH_ORDER_USD_MAX || '10'),
    POLY_CLOB_PRICE_FLOOR: String(process.env.CLOB_BURNIN_PATCH_PRICE_FLOOR || '0.40'),
    POLY_CLOB_PRICE_CAP: String(process.env.CLOB_BURNIN_PATCH_PRICE_CAP || '0.60'),
  };
}

async function main() {
  if (!RAILWAY_TOKEN) {
    throw new Error('Missing RAILWAY_TOKEN');
  }
  if (!RAILWAY_PROJECT_ID || !RAILWAY_SERVICE_ID || !RAILWAY_ENVIRONMENT_ID) {
    throw new Error('Missing RAILWAY_PROJECT_ID, RAILWAY_SERVICE_ID, or RAILWAY_ENVIRONMENT_ID');
  }

  const patch = conservativeProfile();
  const entries = Object.entries(patch);

  for (const [key, value] of entries) {
    await upsertEnvVar(key, value);
  }

  if (AUTO_REDEPLOY) {
    try {
      await tryRedeployLatestProduction();
      console.log(`CLOB burn-in conservative patch applied (${entries.length} keys) + redeploy requested.`);
      return;
    } catch (error) {
      console.log(`CLOB burn-in conservative patch applied (${entries.length} keys), redeploy failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  }

  console.log(`CLOB burn-in conservative patch applied (${entries.length} keys).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
