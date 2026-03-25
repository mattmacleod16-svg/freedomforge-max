#!/usr/bin/env node
/**
 * sync-all-environments.js
 * ═══════════════════════════════════════════════════════════════════
 * Master environment sync verifier for FreedomForge Max.
 *
 * Checks:
 *   - Railway deployment health
 *   - Alchemy API connectivity
 *   - Required environment variable groups
 *   - Smart contract deployment status
 *   - Multi-chain readiness
 *   - MacBook Air / local persistent storage
 *
 * Usage:
 *   node scripts/sync-all-environments.js
 *   npm run sync:all
 *
 * Exit codes:
 *   0 — all environments healthy
 *   1 — one or more checks failed
 */

'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

const APP_BASE_URL = (
  process.env.APP_BASE_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : 'https://freedomforge.one')
).replace(/\/$/, '');

const TIMEOUT_MS = parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '8000', 10);

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, detail = '') {
  passed++;
  console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail = '') {
  failed++;
  failures.push(label);
  console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
}

function warn(label, detail = '') {
  console.log(`  ⚠️  ${label}${detail ? ` — ${detail}` : ''}`);
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 55 - title.length))}`);
}

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ─── Check 1: Railway Health ──────────────────────────────────────────────────

async function checkRailwayHealth() {
  section('Railway Deployment Health');
  const url = `${APP_BASE_URL}/api/health`;
  try {
    const res = await fetchWithTimeout(url);
    if (res.ok) {
      ok('Railway app responding', `${url} → HTTP ${res.status}`);
    } else {
      fail('Railway health check failed', `HTTP ${res.status} from ${url}`);
    }
  } catch (err) {
    fail('Railway app unreachable', `${url}: ${err.message}`);
  }
}

// ─── Check 2: Alchemy API ─────────────────────────────────────────────────────

async function checkAlchemy() {
  section('Alchemy API Connectivity');
  const key = process.env.ALCHEMY_API_KEY;
  const network = process.env.ALCHEMY_NETWORK || 'eth-mainnet';

  if (!key) {
    fail('ALCHEMY_API_KEY not set');
    return;
  }
  ok('ALCHEMY_API_KEY present', `${key.slice(0, 6)}…`);

  // Resolve the correct Alchemy RPC slug
  const slugMap = {
    'eth-mainnet': 'eth-mainnet',
    ethereum: 'eth-mainnet',
    mainnet: 'eth-mainnet',
    'base-mainnet': 'base-mainnet',
    base: 'base-mainnet',
    'arb-mainnet': 'arb-mainnet',
    arbitrum: 'arb-mainnet',
    'opt-mainnet': 'opt-mainnet',
    optimism: 'opt-mainnet',
    'polygon-mainnet': 'polygon-mainnet',
    polygon: 'polygon-mainnet',
  };
  const slug = slugMap[network.toLowerCase()] || network;
  const rpcUrl = `https://${slug}.g.alchemy.com/v2/${key}`;

  try {
    const res = await fetchWithTimeout(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.result) {
        const block = parseInt(data.result, 16);
        ok('Alchemy RPC reachable', `${slug} block #${block.toLocaleString()}`);
      } else {
        fail('Alchemy RPC error', JSON.stringify(data.error || data));
      }
    } else {
      fail('Alchemy RPC HTTP error', `${res.status}`);
    }
  } catch (err) {
    fail('Alchemy RPC unreachable', err.message);
  }

  // Check webhook route on the app itself
  try {
    const hookRes = await fetchWithTimeout(`${APP_BASE_URL}/api/alchemy/health`);
    if (hookRes.ok || hookRes.status === 405) {
      ok('Alchemy webhook route live', `/api/alchemy/health → ${hookRes.status}`);
    } else {
      warn('Alchemy webhook route returned non-OK', `HTTP ${hookRes.status}`);
    }
  } catch {
    warn('Alchemy webhook route unreachable (app may be offline)');
  }
}

// ─── Check 3: Environment Variable Groups ────────────────────────────────────

function checkEnvVars() {
  section('Environment Variables');

  const groups = {
    'Railway IDs': ['RAILWAY_TOKEN', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID', 'RAILWAY_ENVIRONMENT_ID'],
    'Alchemy / Blockchain': ['ALCHEMY_API_KEY', 'ALCHEMY_NETWORK'],
    'Wallet': ['WALLET_PRIVATE_KEY'],
    'AI / OpenRouter': ['OPENROUTER_API_KEY'],
    'Auth': ['DASHBOARD_SESSION_SECRET'],
    '$FORGE Token': ['FORGE_TOKEN_ADDRESS'],
    'Trading (optional)': ['ALPACA_API_KEY', 'COINBASE_API_KEY', 'KRAKEN_API_KEY'],
    'Alerts (optional)': ['ALERT_WEBHOOK_URL'],
  };

  for (const [group, vars] of Object.entries(groups)) {
    const missing = vars.filter(v => !process.env[v]);
    const optional = group.includes('optional');

    if (missing.length === 0) {
      ok(`${group}`, `all ${vars.length} var(s) set`);
    } else if (optional) {
      warn(`${group}`, `missing: ${missing.join(', ')}`);
    } else {
      fail(`${group}`, `missing: ${missing.join(', ')}`);
    }
  }
}

// ─── Check 4: Smart Contract Deployment Status ────────────────────────────────

function checkContracts() {
  section('Smart Contract Deployment');

  const forgeAddr = process.env.FORGE_TOKEN_ADDRESS;
  const payoutAddr = process.env.PAYOUT_TOKEN_ADDRESS;

  if (forgeAddr && forgeAddr !== 'YOUR_FORGE_TOKEN_ADDRESS') {
    ok('$FORGE ERC-20 deployed', forgeAddr);
  } else {
    warn('$FORGE token not yet deployed', 'run: npm run contract:deploy:ethereum');
  }

  if (payoutAddr && payoutAddr !== 'YOUR_PAYOUT_TOKEN_ADDRESS') {
    ok('Payout token configured', payoutAddr);
  } else {
    warn('Payout token address not set', 'set PAYOUT_TOKEN_ADDRESS in .env.local');
  }

  // Check that contract source exists
  const fs = require('fs');
  const contractPath = path.resolve(process.cwd(), 'contracts/FreedomForgeToken.sol');
  if (fs.existsSync(contractPath)) {
    ok('FreedomForgeToken.sol present', 'contracts/FreedomForgeToken.sol');
  } else {
    fail('FreedomForgeToken.sol missing');
  }

  const deployPath = path.resolve(process.cwd(), 'contracts/deploy.ts');
  if (fs.existsSync(deployPath)) {
    ok('Deploy script present', 'contracts/deploy.ts');
  } else {
    fail('contracts/deploy.ts missing');
  }
}

// ─── Check 5: Multi-Chain Readiness ──────────────────────────────────────────

function checkChains() {
  section('Multi-Chain Readiness');

  const chains = [
    { name: 'Ethereum mainnet', key: 'WALLET_PRIVATE_KEY', extra: 'ALCHEMY_API_KEY', deployCmd: 'contract:deploy:ethereum' },
    { name: 'Base mainnet', key: 'WALLET_PRIVATE_KEY', extra: 'ALCHEMY_API_KEY', deployCmd: 'contract:deploy:base' },
    { name: 'Ethereum Sepolia (testnet)', key: 'WALLET_PRIVATE_KEY', extra: 'ALCHEMY_API_KEY', deployCmd: 'contract:deploy:sepolia' },
    { name: 'Base Sepolia (testnet)', key: 'WALLET_PRIVATE_KEY', extra: 'ALCHEMY_API_KEY', deployCmd: 'contract:deploy:base-sepolia' },
    { name: 'Solana', key: 'SOLANA_PRIVATE_KEY', deployCmd: 'launch:multichain' },
    { name: 'MultiversX', key: 'MULTIVERSX_PRIVATE_KEY', deployCmd: 'launch:multichain' },
    { name: 'Polygon', key: 'POLYGON_RPC_URL', deployCmd: 'ethereum:engine' },
    { name: 'ICP (Internet Computer)', key: 'ICP_IDENTITY', optional: true },
    { name: 'Injective', key: 'INJECTIVE_PRIVATE_KEY', optional: true },
    { name: 'StarkNet', key: 'STARKNET_PRIVATE_KEY', optional: true },
    { name: 'XRPL', key: 'XRPL_SECRET', optional: true },
    { name: 'Ontology', key: 'ONTOLOGY_PRIVATE_KEY', optional: true },
  ];

  let ready = 0;
  let pending = 0;

  for (const chain of chains) {
    const hasKey = !!process.env[chain.key];
    const hasExtra = chain.extra ? !!process.env[chain.extra] : true;

    if (hasKey && hasExtra) {
      ok(chain.name, 'keys present');
      ready++;
    } else if (chain.optional) {
      warn(chain.name, `missing: ${chain.key}${chain.extra && !process.env[chain.extra] ? `, ${chain.extra}` : ''} (optional)`);
      pending++;
    } else {
      warn(chain.name, `missing key(s) — run: npm run ${chain.deployCmd || 'contract:deploy:ethereum'} when ready`);
      pending++;
    }
  }

  console.log(`\n  📊 ${ready} chain(s) ready, ${pending} pending key configuration`);
}

// ─── Check 6: MacBook Air / Local Storage ────────────────────────────────────

function checkLocalStorage() {
  section('Local Persistent Storage (MacBook Air sync)');
  const fs = require('fs');

  const storagePath = process.env.PERSISTENT_STORAGE_PATH || 'data';
  const fullPath = path.resolve(process.cwd(), storagePath);

  if (fs.existsSync(fullPath)) {
    ok('Persistent storage path accessible', fullPath);
  } else {
    warn('Persistent storage path not found', `expected at ${fullPath} — create or set PERSISTENT_STORAGE_PATH`);
  }

  const envLocal = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envLocal)) {
    ok('.env.local present');
  } else {
    warn('.env.local not found', 'run: npm run api:sync:prod to pull from Railway');
  }

  // Check if running on Railway or locally
  if (process.env.RAILWAY_ENVIRONMENT) {
    ok('Environment', `Railway (${process.env.RAILWAY_ENVIRONMENT})`);
  } else {
    ok('Environment', 'Local development (MacBook Air or server)');
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function printSummary() {
  const total = passed + failed;
  console.log('\n' + '═'.repeat(60));
  console.log(`FreedomForge Sync Summary — ${new Date().toISOString()}`);
  console.log('═'.repeat(60));
  console.log(`  Checks passed : ${passed}/${total}`);
  console.log(`  Checks failed : ${failed}/${total}`);

  if (failures.length > 0) {
    console.log('\n  Failed checks:');
    for (const f of failures) console.log(`    • ${f}`);
  }

  console.log('\n  Quick commands:');
  console.log('    npm run alchemy:verify       — deep Alchemy API test');
  console.log('    npm run token:verify         — per-chain token launch status');
  console.log('    npm run taskmasters:deploy   — launch TaskMaster agents');
  console.log('    npm run sync:personal:prod   — sync personal data to Railway');
  console.log('    npm run contract:deploy:ethereum — deploy $FORGE to Ethereum mainnet');
  console.log('    npm run launch:multichain:live   — launch on Solana + MultiversX');
  console.log('═'.repeat(60));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('FreedomForge Max — Full Environment Sync Check');
  console.log('═'.repeat(60));
  console.log(`  Target: ${APP_BASE_URL}`);
  console.log(`  Date  : ${new Date().toISOString()}`);

  await checkRailwayHealth();
  await checkAlchemy();
  checkEnvVars();
  checkContracts();
  checkChains();
  checkLocalStorage();
  printSummary();

  process.exit(failed > 0 ? 1 : 0);
})();
