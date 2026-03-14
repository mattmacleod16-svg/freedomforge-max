#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const { upsertEnvVar: platformUpsertEnvVar, redeploy: platformRedeploy, platform: deployPlatform } = require('../lib/deploy-platform');
const AUTO_REDEPLOY = String(process.env.CLOB_BURNIN_RESTORE_AUTO_REDEPLOY || 'true').toLowerCase() === 'true';

async function upsertEnvVar(key, value) {
  return platformUpsertEnvVar(key, value);
}

async function tryRedeployLatestProduction() {
  return platformRedeploy();
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
  if (deployPlatform === 'none') {
    throw new Error('No deployment platform configured. Set RAILWAY_TOKEN or VERCEL_TOKEN.');
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
