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

async function upsertEnvVar(key, value) {
  if (!RAILWAY_TOKEN) throw new Error('Missing RAILWAY_TOKEN');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(RAILWAY_GQL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RAILWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'mutation UpsertVariable($input: VariableUpsertInput!) { variableUpsert(input: $input) }',
        variables: {
          input: {
            projectId: RAILWAY_PROJECT_ID,
            environmentId: RAILWAY_ENVIRONMENT_ID,
            serviceId: RAILWAY_SERVICE_ID,
            name: key,
            value: String(value),
          },
        },
      }),
      signal: controller.signal,
    });
  } finally { clearTimeout(timer); }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Railway env upsert failed for ${key}: HTTP ${response.status} ${body}`);
  }
  const json = await response.json().catch(() => null);
  if (json?.errors?.length) {
    throw new Error(`Railway env upsert failed for ${key}: ${json.errors[0]?.message}`);
  }
}

async function tryRedeployLatestProduction() {
  if (!RAILWAY_TOKEN) throw new Error('Missing RAILWAY_TOKEN');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(RAILWAY_GQL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RAILWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'mutation ServiceInstanceDeploy($serviceId: String!, $environmentId: String!) { serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId) }',
        variables: {
          serviceId: RAILWAY_SERVICE_ID,
          environmentId: RAILWAY_ENVIRONMENT_ID,
        },
      }),
      signal: controller.signal,
    });
  } finally { clearTimeout(timer); }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Railway redeploy failed: HTTP ${response.status} ${body}`);
  }
  const json = await response.json().catch(() => null);
  if (json?.errors?.length) {
    throw new Error(`Railway redeploy failed: ${json.errors[0]?.message}`);
  }
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
