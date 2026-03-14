#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');

function parseArgs(argv) {
  const out = { envFile: '.env.local' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--env-file' && argv[i + 1]) {
      out.envFile = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
dotenv.config({ path: path.resolve(process.cwd(), args.envFile) });
dotenv.config();

const APP_BASE_URL = (process.env.APP_BASE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'https://freedomforge-max.up.railway.app')).replace(/\/$/, '');

const requiredEnv = [
  'WALLET_PRIVATE_KEY',
  'ALCHEMY_API_KEY',
  'ZEROX_API_KEY',
  'CONVERSION_ENGINE_ENABLED',
  'CONVERSION_NETWORKS',
];

const recommendedEnv = [
  'POLY_CLOB_API_KEY',
  'POLY_CLOB_API_SECRET',
  'POLY_CLOB_API_PASSPHRASE',
  'POLY_CLOB_REST_URL',
  'POLY_CLOB_WS_URL',
  'PREDICTION_MARKET_ENDPOINT',
  'ALERT_WEBHOOK_URL',
];

function hasValue(key) {
  const value = process.env[key];
  return Boolean(value && String(value).trim().length > 0);
}

async function checkHttp(name, url) {
  if (!url) {
    return { name, url: null, ok: false, reason: 'missing-url' };
  }

  try {
    const response = await fetch(url, { method: 'GET' });
    return {
      name,
      url,
      ok: response.ok,
      status: response.status,
      reason: response.ok ? 'ok' : 'non-2xx',
    };
  } catch (error) {
    return {
      name,
      url,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const missingRequired = requiredEnv.filter((key) => !hasValue(key));
  const missingRecommended = recommendedEnv.filter((key) => !hasValue(key));

  const predictionEndpoint = process.env.PREDICTION_MARKET_ENDPOINT || 'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=5';
  const checks = await Promise.all([
    checkHttp('app-health', `${APP_BASE_URL}/api/alchemy/health`),
    checkHttp('gamma', predictionEndpoint),
    checkHttp('wallet', `${APP_BASE_URL}/api/alchemy/wallet`),
  ]);

  const summary = {
    ts: new Date().toISOString(),
    envFile: args.envFile,
    appBaseUrl: APP_BASE_URL,
    required: {
      total: requiredEnv.length,
      missing: missingRequired,
      ready: missingRequired.length === 0,
    },
    recommended: {
      total: recommendedEnv.length,
      missing: missingRecommended,
    },
    endpointChecks: checks,
    nextActions: [],
  };

  if (missingRequired.length > 0) {
    summary.nextActions.push('Fill required env vars before live execution.');
  } else {
    summary.nextActions.push('Required env coverage is complete for MVP launch path.');
  }

  if (missingRecommended.includes('POLY_CLOB_API_KEY')) {
    summary.nextActions.push('Add Polymarket CLOB credentials to replicate tweet-style direct prediction-market execution.');
  }

  if (!checks.every((check) => check.ok)) {
    summary.nextActions.push('Fix failing endpoint checks before increasing cadence.');
  }

  console.log(JSON.stringify(summary, null, 2));

  if (missingRequired.length > 0 || !checks.every((check) => check.ok)) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
