#!/usr/bin/env node
/**
 * verify-alchemy.js
 * ═══════════════════════════════════════════════════════════════════
 * Deep verification of Alchemy API connectivity and webhook routes.
 *
 * Checks:
 *   - ALCHEMY_API_KEY validity (live RPC call)
 *   - ALCHEMY_NETWORK correctness
 *   - Webhook route responsiveness on the deployed app
 *   - TRACKED_TOKENS configuration
 *   - Wallet balance query (if WALLET_PRIVATE_KEY set)
 *   - Multi-network status (mainnet, Base, Polygon)
 *
 * Usage:
 *   node scripts/verify-alchemy.js
 *   npm run alchemy:verify
 */

'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const APP_BASE_URL = (
  process.env.APP_BASE_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : 'https://freedomforge.one')
).replace(/\/$/, '');

const TIMEOUT_MS = parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '10000', 10);

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
function info(label, detail = '') {
  console.log(`  ℹ️  ${label}${detail ? ` — ${detail}` : ''}`);
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

// Network slug resolution (mirrors lib/alchemy/connector.ts logic)
const NETWORK_SLUG_MAP = {
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
  'eth-sepolia': 'eth-sepolia',
  sepolia: 'eth-sepolia',
  'base-sepolia': 'base-sepolia',
};

function resolveSlug(network) {
  return NETWORK_SLUG_MAP[(network || '').toLowerCase()] || network;
}

async function testRpc(key, slug, label) {
  const url = `https://${slug}.g.alchemy.com/v2/${key}`;
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    });
    if (!res.ok) {
      fail(`${label} RPC`, `HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (data.result) {
      const block = parseInt(data.result, 16);
      ok(`${label} RPC`, `block #${block.toLocaleString()}`);
      return block;
    } else if (data.error) {
      fail(`${label} RPC`, `error ${data.error.code}: ${data.error.message}`);
      return null;
    }
  } catch (err) {
    fail(`${label} RPC`, err.message);
    return null;
  }
}

async function getWalletBalance(key, slug, address, label) {
  const url = `https://${slug}.g.alchemy.com/v2/${key}`;
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 }),
    });
    const data = await res.json();
    if (data.result) {
      const wei = BigInt(data.result);
      const eth = Number(wei) / 1e18;
      ok(`${label} wallet balance`, `${eth.toFixed(6)} ETH`);
    }
  } catch { /* optional check */ }
}

// ─── Main Checks ─────────────────────────────────────────────────────────────

async function main() {
  console.log('FreedomForge Max — Alchemy API Deep Verification');
  console.log('═'.repeat(60));
  console.log(`  App  : ${APP_BASE_URL}`);
  console.log(`  Date : ${new Date().toISOString()}`);

  section('API Key');

  const key = process.env.ALCHEMY_API_KEY;
  if (!key) {
    fail('ALCHEMY_API_KEY', 'not set in .env.local');
    console.log('\n  To fix: add ALCHEMY_API_KEY=<your-key> to .env.local');
    console.log('  Get a key at: https://www.alchemy.com');
    process.exit(1);
  }
  ok('ALCHEMY_API_KEY present', `${key.slice(0, 6)}…${key.slice(-4)}`);

  const configuredNetwork = process.env.ALCHEMY_NETWORK || 'eth-mainnet';
  const configuredSlug = resolveSlug(configuredNetwork);
  ok('ALCHEMY_NETWORK', `${configuredNetwork} → ${configuredSlug}`);

  section('Primary Network RPC Test');
  await testRpc(key, configuredSlug, `Primary (${configuredSlug})`);

  section('Multi-Network Coverage');
  const networks = [
    { slug: 'eth-mainnet', label: 'Ethereum mainnet' },
    { slug: 'base-mainnet', label: 'Base mainnet' },
    { slug: 'polygon-mainnet', label: 'Polygon mainnet' },
    { slug: 'arb-mainnet', label: 'Arbitrum mainnet' },
    { slug: 'eth-sepolia', label: 'Sepolia testnet' },
  ];
  for (const { slug, label } of networks) {
    if (slug === configuredSlug) continue; // already tested
    await testRpc(key, slug, label);
  }

  section('Wallet Balance Check');
  const walletKey = process.env.WALLET_PRIVATE_KEY;
  if (walletKey && walletKey.length >= 64) {
    try {
      // Derive address from private key using ethers
      let ethers;
      try { ethers = require('ethers'); } catch { ethers = null; }
      if (ethers) {
        const wallet = new ethers.Wallet(walletKey.startsWith('0x') ? walletKey : `0x${walletKey}`);
        info('Revenue wallet address', wallet.address);
        await getWalletBalance(key, configuredSlug, wallet.address, 'Revenue wallet');
      } else {
        info('ethers not available for wallet check');
      }
    } catch (err) {
      info('Wallet balance check skipped', err.message);
    }
  } else {
    info('WALLET_PRIVATE_KEY not set — skipping balance check');
  }

  section('App Webhook Routes');
  const routes = [
    { path: '/api/alchemy/health', label: 'Health endpoint' },
    { path: '/api/health', label: 'App health' },
  ];
  for (const { path: routePath, label } of routes) {
    try {
      const res = await fetchWithTimeout(`${APP_BASE_URL}${routePath}`);
      if (res.ok || res.status === 405) {
        ok(label, `HTTP ${res.status}`);
      } else {
        fail(label, `HTTP ${res.status}`);
      }
    } catch (err) {
      fail(label, err.message);
    }
  }

  section('Tracked Tokens');
  const trackedRaw = process.env.TRACKED_TOKENS || 'AERO,MATIC,ARB';
  const tokens = trackedRaw.split(',').map(t => t.trim()).filter(Boolean);
  ok('TRACKED_TOKENS configured', tokens.join(', '));
  info(`${tokens.length} token(s) tracked for on-chain events`);

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log(`Alchemy Verification — ${new Date().toISOString()}`);
  console.log('═'.repeat(60));
  console.log(`  Passed : ${passed}`);
  console.log(`  Failed : ${failed}`);
  if (failures.length > 0) {
    console.log(`\n  Failed: ${failures.join(', ')}`);
  }
  console.log('═'.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main();
