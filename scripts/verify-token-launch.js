#!/usr/bin/env node
/**
 * verify-token-launch.js
 * ═══════════════════════════════════════════════════════════════════
 * Reports $FORGE token deployment status on all viable blockchains.
 *
 * Chains covered:
 *   EVM:        Ethereum mainnet, Base mainnet, Ethereum Sepolia, Base Sepolia
 *   EVM-compat: Polygon
 *   Alt-chains: Solana, MultiversX
 *   Layer 2:    Arbitrum, Optimism (via Alchemy)
 *   Other:      ICP, Injective, StarkNet, XRPL, Ontology (lib/chains/ clients)
 *
 * For each chain, reports:
 *   deployed        — address found in env
 *   ready_to_deploy — keys are set, run the deploy command
 *   missing_keys    — required env vars not set
 *   not_supported   — chain client exists but no EVM deploy path
 *
 * Usage:
 *   node scripts/verify-token-launch.js
 *   npm run token:verify
 */

'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || '';
const WALLET_KEY     = process.env.WALLET_PRIVATE_KEY || '';
const FORGE_ADDR     = process.env.FORGE_TOKEN_ADDRESS || '';
const TIMEOUT_MS     = parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '8000', 10);

// ─── Chain Definitions ────────────────────────────────────────────────────────

const EVM_CHAINS = [
  {
    id: 'ethereum',
    label: 'Ethereum mainnet',
    slug: 'eth-mainnet',
    deployCmd: 'npm run contract:deploy:ethereum',
    requiredKeys: ['WALLET_PRIVATE_KEY', 'ALCHEMY_API_KEY'],
    deployedAddr: FORGE_ADDR,
    priority: 1,
  },
  {
    id: 'base',
    label: 'Base mainnet',
    slug: 'base-mainnet',
    deployCmd: 'npm run contract:deploy:base',
    requiredKeys: ['WALLET_PRIVATE_KEY', 'ALCHEMY_API_KEY'],
    deployedAddr: FORGE_ADDR, // same contract, different network
    priority: 2,
  },
  {
    id: 'polygon',
    label: 'Polygon mainnet',
    slug: 'polygon-mainnet',
    deployCmd: 'npm run ethereum:engine',
    requiredKeys: ['WALLET_PRIVATE_KEY', 'POLYGON_RPC_URL'],
    deployedAddr: process.env.POLYGON_FORGE_ADDRESS || '',
    priority: 3,
  },
  {
    id: 'arbitrum',
    label: 'Arbitrum mainnet',
    slug: 'arb-mainnet',
    deployCmd: 'npm run ethereum:engine',
    requiredKeys: ['WALLET_PRIVATE_KEY', 'ALCHEMY_API_KEY'],
    deployedAddr: process.env.ARB_FORGE_ADDRESS || '',
    priority: 4,
  },
  {
    id: 'optimism',
    label: 'Optimism mainnet',
    slug: 'opt-mainnet',
    deployCmd: 'npm run ethereum:engine',
    requiredKeys: ['WALLET_PRIVATE_KEY', 'ALCHEMY_API_KEY'],
    deployedAddr: process.env.OP_FORGE_ADDRESS || '',
    priority: 5,
  },
  {
    id: 'sepolia',
    label: 'Ethereum Sepolia (testnet)',
    slug: 'eth-sepolia',
    deployCmd: 'npm run contract:deploy:sepolia',
    requiredKeys: ['WALLET_PRIVATE_KEY', 'ALCHEMY_API_KEY'],
    deployedAddr: process.env.SEPOLIA_FORGE_ADDRESS || '',
    testnet: true,
    priority: 6,
  },
  {
    id: 'base-sepolia',
    label: 'Base Sepolia (testnet)',
    slug: 'base-sepolia',
    deployCmd: 'npm run contract:deploy:base-sepolia',
    requiredKeys: ['WALLET_PRIVATE_KEY', 'ALCHEMY_API_KEY'],
    deployedAddr: process.env.BASE_SEPOLIA_FORGE_ADDRESS || '',
    testnet: true,
    priority: 7,
  },
];

const ALT_CHAINS = [
  {
    id: 'solana',
    label: 'Solana',
    deployCmd: 'npm run launch:multichain:live',
    requiredKeys: ['SOLANA_PRIVATE_KEY'],
    deployedAddr: process.env.SOLANA_FORGE_MINT || '',
    client: 'lib/chains/ (not available — Solana uses SPL token standard)',
  },
  {
    id: 'multiversx',
    label: 'MultiversX (Elrond)',
    deployCmd: 'npm run launch:multichain:live',
    requiredKeys: ['MULTIVERSX_PRIVATE_KEY'],
    deployedAddr: process.env.MULTIVERSX_FORGE_ADDRESS || '',
    client: 'scripts/multiversx-engine.js',
  },
  {
    id: 'icp',
    label: 'Internet Computer (ICP)',
    deployCmd: 'configure ICP canister manually',
    requiredKeys: ['ICP_IDENTITY'],
    deployedAddr: process.env.ICP_CANISTER_ID || '',
    client: 'lib/chains/icpClient.ts',
    optional: true,
  },
  {
    id: 'injective',
    label: 'Injective',
    deployCmd: 'configure via lib/chains/injectiveClient.ts',
    requiredKeys: ['INJECTIVE_PRIVATE_KEY'],
    deployedAddr: process.env.INJECTIVE_FORGE_ADDRESS || '',
    client: 'lib/chains/injectiveClient.ts',
    optional: true,
  },
  {
    id: 'starknet',
    label: 'StarkNet',
    deployCmd: 'configure via lib/chains/starknetClient.ts',
    requiredKeys: ['STARKNET_PRIVATE_KEY', 'STARKNET_ACCOUNT_ADDRESS'],
    deployedAddr: process.env.STARKNET_FORGE_ADDRESS || '',
    client: 'lib/chains/starknetClient.ts',
    optional: true,
  },
  {
    id: 'xrpl',
    label: 'XRP Ledger (XRPL)',
    deployCmd: 'configure via lib/chains/xrplClient.ts',
    requiredKeys: ['XRPL_SECRET'],
    deployedAddr: process.env.XRPL_FORGE_CURRENCY || '',
    client: 'lib/chains/xrplClient.ts',
    optional: true,
  },
  {
    id: 'ontology',
    label: 'Ontology',
    deployCmd: 'configure via lib/chains/ontologyClient.ts',
    requiredKeys: ['ONTOLOGY_PRIVATE_KEY'],
    deployedAddr: process.env.ONTOLOGY_FORGE_ADDRESS || '',
    client: 'lib/chains/ontologyClient.ts',
    optional: true,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isDeployed(addr) {
  return !!addr && addr !== '' && !addr.startsWith('YOUR_') && !addr.startsWith('0x000000');
}

function getStatus(chain) {
  const missingKeys = chain.requiredKeys.filter(k => !process.env[k]);
  if (isDeployed(chain.deployedAddr)) return 'deployed';
  if (missingKeys.length === 0) return 'ready_to_deploy';
  return 'missing_keys';
}

function icon(status, optional) {
  if (status === 'deployed') return '✅';
  if (status === 'ready_to_deploy') return '🔷';
  if (optional) return '⚪';
  return '🔑';
}

async function verifyOnChain(chain) {
  if (!ALCHEMY_API_KEY || !isDeployed(chain.deployedAddr)) return null;
  const url = `https://${chain.slug}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getCode',
        params: [chain.deployedAddr, 'latest'],
        id: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    if (data.result && data.result !== '0x') return true;
    if (data.result === '0x') return false;
    return null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('FreedomForge Max — Token Launch Verification');
  console.log('═'.repeat(60));
  console.log(`  Date : ${new Date().toISOString()}`);
  if (FORGE_ADDR && isDeployed(FORGE_ADDR)) {
    console.log(`  $FORGE ERC-20 address : ${FORGE_ADDR}`);
  }
  console.log();

  let deployed = 0, readyToDeploy = 0, missingKeys = 0;

  // ── EVM Chains ──────────────────────────────────────────────────────────────
  console.log('EVM Chains (Solidity / FreedomForgeToken.sol)');
  console.log('─'.repeat(60));

  for (const chain of EVM_CHAINS) {
    const status = getStatus(chain);
    const ic = icon(status, false);
    const label = chain.testnet ? `${chain.label}` : chain.label;

    if (status === 'deployed') {
      deployed++;
      // Try on-chain verification
      const verified = chain.slug && ALCHEMY_API_KEY ? await verifyOnChain(chain) : null;
      const verifyStr = verified === true ? ' (bytecode verified ✓)' : verified === false ? ' (address set but no bytecode!)' : '';
      console.log(`  ${ic} ${label.padEnd(30)} ${chain.deployedAddr}${verifyStr}`);
    } else if (status === 'ready_to_deploy') {
      readyToDeploy++;
      console.log(`  ${ic} ${label.padEnd(30)} Run: ${chain.deployCmd}`);
    } else {
      const missing = chain.requiredKeys.filter(k => !process.env[k]);
      missingKeys++;
      console.log(`  ${ic} ${label.padEnd(30)} Missing: ${missing.join(', ')}`);
    }
  }

  // ── Alt Chains ──────────────────────────────────────────────────────────────
  console.log('\nAlt-Chains & Layer-1 Networks');
  console.log('─'.repeat(60));

  for (const chain of ALT_CHAINS) {
    const status = getStatus(chain);
    const ic = icon(status, chain.optional);
    const optTag = chain.optional ? ' (optional)' : '';

    if (status === 'deployed') {
      deployed++;
      console.log(`  ${ic} ${chain.label.padEnd(30)} ${chain.deployedAddr}`);
    } else if (status === 'ready_to_deploy') {
      readyToDeploy++;
      console.log(`  ${ic} ${chain.label.padEnd(30)} Run: ${chain.deployCmd}`);
    } else {
      const missing = chain.requiredKeys.filter(k => !process.env[k]);
      if (!chain.optional) missingKeys++;
      console.log(`  ${ic} ${chain.label.padEnd(30)} Missing: ${missing.join(', ')}${optTag}`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const total = EVM_CHAINS.length + ALT_CHAINS.length;
  console.log('\n' + '═'.repeat(60));
  console.log('Launch Status Summary');
  console.log('═'.repeat(60));
  console.log(`  ✅ Deployed        : ${deployed}/${total}`);
  console.log(`  🔷 Ready to deploy : ${readyToDeploy}/${total}`);
  console.log(`  🔑 Missing keys    : ${missingKeys}/${total}`);

  console.log('\n  Priority deployment order:');
  console.log('    1. npm run contract:deploy:sepolia      — testnet first');
  console.log('    2. npm run contract:deploy:base-sepolia — Base testnet');
  console.log('    3. npm run contract:deploy:ethereum     — Ethereum mainnet');
  console.log('    4. npm run contract:deploy:base         — Base mainnet');
  console.log('    5. npm run launch:multichain:live       — Solana + MultiversX');

  console.log('\n  Required for EVM deployment:');
  console.log('    WALLET_PRIVATE_KEY   — deployer wallet');
  console.log('    ALCHEMY_API_KEY      — node provider');
  console.log();

  process.exit(0);
}

main();
