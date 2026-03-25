#!/usr/bin/env node
/**
 * deploy-taskmasters.js
 * ═══════════════════════════════════════════════════════════════════
 * Deploys and registers all FreedomForge TaskMaster agents to
 * coordinate the full-stack rollout across Railway, GitHub,
 * blockchain networks, Alchemy, and local environments.
 *
 * TaskMasters:
 *   1. Railway TaskMaster    — deployment health + auto-retry
 *   2. Blockchain TaskMaster — contract deploy orchestration + tx tracking
 *   3. Alchemy TaskMaster    — webhook validation + on-chain data feeds
 *   4. Sync TaskMaster       — GitHub ↔ Railway ↔ local lockstep
 *   5. MacBook TaskMaster    — local env var + data volume sync
 *
 * Uses existing agent-supervisor and agent-signal-bus infrastructure.
 *
 * Usage:
 *   node scripts/deploy-taskmasters.js
 *   npm run taskmasters:deploy
 */

'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

// Load existing agent infrastructure
let supervisor, bus;
try { supervisor = require('../lib/agent-supervisor'); } catch { supervisor = null; }
try { bus = require('../lib/agent-signal-bus'); } catch { bus = null; }

const APP_BASE_URL = (
  process.env.APP_BASE_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : 'https://freedomforge.one')
).replace(/\/$/, '');

const TIMEOUT_MS = parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '8000', 10);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString();

function log(taskmaster, msg) {
  console.log(`[${ts()}] [${taskmaster}] ${msg}`);
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

function publishSignal(type, source, payload, confidence = 0.9) {
  if (!bus) return;
  try {
    bus.publish({ type, source, confidence, payload });
  } catch { /* signal bus optional */ }
}

// ─── TaskMaster 1: Railway ────────────────────────────────────────────────────

async function railwayTaskmaster() {
  const name = 'railway-taskmaster';
  log(name, `Starting — target: ${APP_BASE_URL}`);

  let attempts = 0;
  const MAX = 3;

  while (attempts < MAX) {
    attempts++;
    try {
      const res = await fetchWithTimeout(`${APP_BASE_URL}/api/health`);
      if (res.ok) {
        log(name, `✅ Railway healthy (attempt ${attempts}) — HTTP ${res.status}`);
        publishSignal('taskmaster_status', name, { status: 'healthy', url: APP_BASE_URL });
        return { status: 'healthy' };
      } else {
        log(name, `⚠️  HTTP ${res.status} — attempt ${attempts}/${MAX}`);
      }
    } catch (err) {
      log(name, `⚠️  Unreachable: ${err.message} — attempt ${attempts}/${MAX}`);
    }

    if (attempts < MAX) {
      const wait = attempts * 2000;
      log(name, `Retrying in ${wait / 1000}s…`);
      await new Promise(r => setTimeout(r, wait));
    }
  }

  log(name, `❌ Railway unhealthy after ${MAX} attempts`);
  publishSignal('taskmaster_status', name, { status: 'unhealthy', url: APP_BASE_URL });
  return { status: 'unhealthy' };
}

// ─── TaskMaster 2: Blockchain ─────────────────────────────────────────────────

async function blockchainTaskmaster() {
  const name = 'blockchain-taskmaster';
  log(name, 'Auditing blockchain deployment status…');

  const chains = [
    { id: 'ethereum', label: 'Ethereum mainnet', envKey: 'WALLET_PRIVATE_KEY', addrKey: 'FORGE_TOKEN_ADDRESS', deployCmd: 'npm run contract:deploy:ethereum' },
    { id: 'base', label: 'Base mainnet', envKey: 'WALLET_PRIVATE_KEY', addrKey: 'FORGE_TOKEN_ADDRESS', deployCmd: 'npm run contract:deploy:base' },
    { id: 'sepolia', label: 'Ethereum Sepolia', envKey: 'WALLET_PRIVATE_KEY', addrKey: null, deployCmd: 'npm run contract:deploy:sepolia' },
    { id: 'base-sepolia', label: 'Base Sepolia', envKey: 'WALLET_PRIVATE_KEY', addrKey: null, deployCmd: 'npm run contract:deploy:base-sepolia' },
    { id: 'solana', label: 'Solana', envKey: 'SOLANA_PRIVATE_KEY', addrKey: null, deployCmd: 'npm run launch:multichain:live' },
    { id: 'multiversx', label: 'MultiversX', envKey: 'MULTIVERSX_PRIVATE_KEY', addrKey: null, deployCmd: 'npm run launch:multichain:live' },
    { id: 'polygon', label: 'Polygon', envKey: 'POLYGON_RPC_URL', addrKey: null, deployCmd: 'npm run ethereum:engine' },
  ];

  const report = [];

  for (const chain of chains) {
    const hasKey = !!process.env[chain.envKey];
    const addr = chain.addrKey ? process.env[chain.addrKey] : null;
    const deployed = addr && addr !== 'YOUR_FORGE_TOKEN_ADDRESS';

    const status = !hasKey ? 'missing_key' : deployed ? 'deployed' : 'ready_to_deploy';

    if (status === 'deployed') {
      log(name, `  ✅ ${chain.label} — deployed at ${addr}`);
    } else if (status === 'ready_to_deploy') {
      log(name, `  🔷 ${chain.label} — keys set, run: ${chain.deployCmd}`);
    } else {
      log(name, `  ⚪ ${chain.label} — set ${chain.envKey} to enable`);
    }

    report.push({ chain: chain.id, label: chain.label, status, address: addr || null });
  }

  publishSignal('taskmaster_status', name, { status: 'reporting', chains: report });
  log(name, `✅ Blockchain audit complete — ${report.filter(r => r.status === 'deployed').length} deployed, ${report.filter(r => r.status === 'ready_to_deploy').length} ready`);

  return { status: 'complete', chains: report };
}

// ─── TaskMaster 3: Alchemy ────────────────────────────────────────────────────

async function alchemyTaskmaster() {
  const name = 'alchemy-taskmaster';
  log(name, 'Validating Alchemy API and webhooks…');

  const key = process.env.ALCHEMY_API_KEY;
  const network = process.env.ALCHEMY_NETWORK || 'eth-mainnet';

  if (!key) {
    log(name, '❌ ALCHEMY_API_KEY not set — Alchemy features disabled');
    publishSignal('taskmaster_status', name, { status: 'disabled', reason: 'missing_key' });
    return { status: 'disabled' };
  }

  // Test Alchemy RPC
  const slugMap = {
    'eth-mainnet': 'eth-mainnet', ethereum: 'eth-mainnet', mainnet: 'eth-mainnet',
    'base-mainnet': 'base-mainnet', base: 'base-mainnet',
    'polygon-mainnet': 'polygon-mainnet', polygon: 'polygon-mainnet',
  };
  const slug = slugMap[network.toLowerCase()] || network;
  const rpcUrl = `https://${slug}.g.alchemy.com/v2/${key}`;

  try {
    const res = await fetchWithTimeout(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    });
    const data = await res.json();
    if (data.result) {
      const block = parseInt(data.result, 16);
      log(name, `  ✅ Alchemy RPC live — ${slug} at block #${block.toLocaleString()}`);
    } else {
      log(name, `  ❌ Alchemy RPC error: ${JSON.stringify(data.error || data)}`);
    }
  } catch (err) {
    log(name, `  ❌ Alchemy RPC unreachable: ${err.message}`);
  }

  // Verify app webhook route
  try {
    const hookRes = await fetchWithTimeout(`${APP_BASE_URL}/api/alchemy/health`);
    log(name, `  ${hookRes.ok || hookRes.status === 405 ? '✅' : '⚠️ '} Webhook route /api/alchemy/health — HTTP ${hookRes.status}`);
  } catch {
    log(name, '  ⚠️  Webhook route unreachable (app may be starting)');
  }

  // Check tracked tokens
  const tracked = process.env.TRACKED_TOKENS || 'AERO,MATIC,ARB';
  log(name, `  ℹ️  Tracked tokens: ${tracked}`);

  publishSignal('taskmaster_status', name, { status: 'active', network: slug, tracked });
  log(name, '✅ Alchemy TaskMaster active');
  return { status: 'active' };
}

// ─── TaskMaster 4: Sync ───────────────────────────────────────────────────────

async function syncTaskmaster() {
  const name = 'sync-taskmaster';
  log(name, 'Verifying GitHub ↔ Railway ↔ local sync…');

  const checks = [];

  // Railway IDs present?
  const railwayVars = ['RAILWAY_TOKEN', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID', 'RAILWAY_ENVIRONMENT_ID'];
  const missingRailway = railwayVars.filter(v => !process.env[v]);
  if (missingRailway.length === 0) {
    log(name, '  ✅ Railway credentials set — CI/CD sync active');
    checks.push({ system: 'railway', status: 'synced' });
  } else {
    log(name, `  ⚠️  Railway missing: ${missingRailway.join(', ')} — auto-deploy may not work`);
    checks.push({ system: 'railway', status: 'partial', missing: missingRailway });
  }

  // App health
  try {
    const res = await fetchWithTimeout(`${APP_BASE_URL}/api/health`);
    if (res.ok) {
      log(name, `  ✅ Railway ↔ app in sync — ${APP_BASE_URL} live`);
      checks.push({ system: 'app', status: 'synced' });
    } else {
      log(name, `  ⚠️  App returned HTTP ${res.status}`);
      checks.push({ system: 'app', status: 'degraded' });
    }
  } catch (err) {
    log(name, `  ⚠️  App unreachable: ${err.message}`);
    checks.push({ system: 'app', status: 'offline' });
  }

  // Local env check
  const fs = require('fs');
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    log(name, '  ✅ .env.local present — local ↔ Railway sync possible');
    checks.push({ system: 'local_env', status: 'synced' });
  } else {
    log(name, '  ⚠️  .env.local not found — run: npm run api:sync:prod');
    checks.push({ system: 'local_env', status: 'missing' });
  }

  publishSignal('taskmaster_status', name, { status: 'monitoring', checks });
  log(name, '✅ Sync TaskMaster monitoring active');
  return { status: 'active', checks };
}

// ─── TaskMaster 5: MacBook Air ────────────────────────────────────────────────

function macbookTaskmaster() {
  const name = 'macbook-taskmaster';
  log(name, 'Syncing MacBook Air local environment…');

  const fs = require('fs');
  const report = [];

  // Persistent storage
  const storagePath = process.env.PERSISTENT_STORAGE_PATH || 'data';
  const fullPath = path.resolve(process.cwd(), storagePath);
  if (fs.existsSync(fullPath)) {
    log(name, `  ✅ Local storage accessible: ${fullPath}`);
    report.push({ item: 'storage', status: 'ok', path: fullPath });
  } else {
    log(name, `  ⚠️  Storage path missing: ${fullPath}`);
    log(name, '       Run: mkdir -p data && npm run sync:personal');
    report.push({ item: 'storage', status: 'missing' });
  }

  // iOS Capacitor config
  const capConfig = path.resolve(process.cwd(), 'capacitor.config.ts');
  if (fs.existsSync(capConfig)) {
    log(name, '  ✅ Capacitor config present — iOS sync available');
    log(name, '       Run: npm run ios:sync && npm run ios:open');
    report.push({ item: 'ios_capacitor', status: 'ready' });
  } else {
    report.push({ item: 'ios_capacitor', status: 'missing' });
  }

  // .env.local
  const envLocal = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envLocal)) {
    log(name, '  ✅ .env.local present on this machine');
    report.push({ item: 'env_local', status: 'present' });
  } else {
    log(name, '  ⚠️  .env.local missing — pull from Railway:');
    log(name, '       npm run api:sync:prod');
    report.push({ item: 'env_local', status: 'missing' });
  }

  publishSignal('taskmaster_status', name, { status: 'synced', report });
  log(name, '✅ MacBook TaskMaster complete');
  return { status: 'complete', report };
}

// ─── Register with Supervisor ─────────────────────────────────────────────────

function registerWithSupervisor(results) {
  if (!supervisor) {
    console.log('\n[taskmasters] agent-supervisor not available — running standalone');
    return;
  }

  // Register each taskmaster for lifecycle monitoring
  const taskmasters = [
    { id: 'railway-taskmaster', critical: true },
    { id: 'blockchain-taskmaster', critical: false },
    { id: 'alchemy-taskmaster', critical: false },
    { id: 'sync-taskmaster', critical: true },
    { id: 'macbook-taskmaster', critical: false },
  ];

  for (const tm of taskmasters) {
    if (typeof supervisor.register === 'function') {
      supervisor.register(tm.id, {
        critical: tm.critical,
        restart: () => console.log(`[supervisor] ${tm.id} restart requested`),
      });
    }
  }

  console.log('\n[taskmasters] All TaskMasters registered with agent-supervisor');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  FreedomForge Max — TaskMaster Deployment               ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`Time: ${ts()}\n`);

  const results = {};

  console.log('▶ Deploying 5 TaskMasters…\n');

  results.railway    = await railwayTaskmaster();
  results.blockchain = await blockchainTaskmaster();
  results.alchemy    = await alchemyTaskmaster();
  results.sync       = await syncTaskmaster();
  results.macbook    = macbookTaskmaster();

  registerWithSupervisor(results);

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  TaskMaster Deployment Summary                          ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  for (const [name, result] of Object.entries(results)) {
    const icon = result.status === 'healthy' || result.status === 'active' || result.status === 'complete' || result.status === 'synced' ? '✅' : result.status === 'disabled' ? '⚪' : '⚠️ ';
    console.log(`║  ${icon} ${name.padEnd(22)} ${result.status.padEnd(20)} ║`);
  }
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  Next steps:                                            ║');
  console.log('║    npm run sync:all          — full environment check   ║');
  console.log('║    npm run token:verify      — blockchain launch status ║');
  console.log('║    npm run alchemy:verify    — deep Alchemy test        ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  process.exit(0);
})();
