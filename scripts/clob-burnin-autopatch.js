#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const { upsertEnvVar, triggerRedeployment, hasRailwayCli } = require('../lib/railway-helpers');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const RAILWAY_TOKEN = process.env.RAILWAY_TOKEN || '';
const RAILWAY_PROJECT_ID = process.env.RAILWAY_PROJECT_ID || '';
const RAILWAY_SERVICE_ID = process.env.RAILWAY_SERVICE_ID || '';
const RAILWAY_ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID || '';
const AUTO_REDEPLOY = String(process.env.CLOB_BURNIN_PATCH_AUTO_REDEPLOY || 'true').toLowerCase() === 'true';

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
  const railwayOpts = { token: RAILWAY_TOKEN, projectId: RAILWAY_PROJECT_ID, serviceId: RAILWAY_SERVICE_ID, environmentId: RAILWAY_ENVIRONMENT_ID };
  const canUseTokenApi = Boolean(RAILWAY_TOKEN);
  const canUseCli = hasRailwayCli();

  if (!canUseTokenApi && !canUseCli) {
    throw new Error('Missing RAILWAY_TOKEN and Railway CLI is not available/authenticated');
  }

  if (canUseTokenApi && !RAILWAY_PROJECT_ID) {
    throw new Error('Missing RAILWAY_PROJECT_ID');
  }

  const patch = conservativeProfile();
  const entries = Object.entries(patch);

  for (const [key, value] of entries) {
    await upsertEnvVar(key, value, railwayOpts);
  }

  if (AUTO_REDEPLOY) {
    try {
      await triggerRedeployment(railwayOpts);
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
