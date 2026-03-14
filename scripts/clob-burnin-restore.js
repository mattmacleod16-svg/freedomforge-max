#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');
const dotenv = require('dotenv');
const { upsertEnvVar, triggerRedeployment, hasRailwayCli } = require('../lib/railway-helpers');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const RAILWAY_TOKEN = process.env.RAILWAY_TOKEN || '';
const RAILWAY_PROJECT_ID = process.env.RAILWAY_PROJECT_ID || '';
const RAILWAY_SERVICE_ID = process.env.RAILWAY_SERVICE_ID || '';
const RAILWAY_ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID || '';
const AUTO_REDEPLOY = String(process.env.CLOB_BURNIN_RESTORE_AUTO_REDEPLOY || 'true').toLowerCase() === 'true';

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
  const railwayOpts = { token: RAILWAY_TOKEN, projectId: RAILWAY_PROJECT_ID, serviceId: RAILWAY_SERVICE_ID, environmentId: RAILWAY_ENVIRONMENT_ID };
  const canUseTokenApi = Boolean(RAILWAY_TOKEN);
  const canUseCli = hasRailwayCli();

  if (!canUseTokenApi && !canUseCli) {
    throw new Error('Missing RAILWAY_TOKEN and Railway CLI is not available/authenticated');
  }

  if (canUseTokenApi && !RAILWAY_PROJECT_ID) {
    throw new Error('Missing RAILWAY_PROJECT_ID');
  }

  const patch = normalProfile();
  const entries = Object.entries(patch);

  for (const [key, value] of entries) {
    await upsertEnvVar(key, value, railwayOpts);
  }

  if (AUTO_REDEPLOY) {
    try {
      await triggerRedeployment(railwayOpts);
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
