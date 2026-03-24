#!/usr/bin/env node
'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const ENABLED = String(process.env.SOLANA_ENABLED || 'false').toLowerCase() === 'true';
const DRY_RUN = String(process.env.SOLANA_DRY_RUN || 'true').toLowerCase() !== 'false';
const RPC_URL = String(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com').trim();
const WALLET_ADDRESS = String(process.env.SOLANA_WALLET_ADDRESS || '').trim();
const PRICE_SYMBOL = String(process.env.SOLANA_PRICE_SYMBOL || 'SOL').trim().toUpperCase();
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.SOLANA_TIMEOUT_MS || 12000));

function withTimeout(ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { controller, timeout };
}

async function rpcCall(method, params = []) {
  const { controller, timeout } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Solana RPC HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload?.error) {
      throw new Error(`Solana RPC error: ${payload.error.message || 'unknown'}`);
    }

    return payload?.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSolPriceUsd() {
  const { controller, timeout } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const url = `https://price.jup.ag/v6/price?ids=${encodeURIComponent(PRICE_SYMBOL)}`;
    const response = await fetch(url, {
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const price = Number(payload?.data?.[PRICE_SYMBOL]?.price || 0);
    if (!Number.isFinite(price) || price <= 0) return null;
    return price;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function runCycle() {
  if (!ENABLED) {
    return { status: 'skipped', reason: 'SOLANA_ENABLED is false' };
  }

  if (!RPC_URL) {
    return { status: 'skipped', reason: 'missing SOLANA_RPC_URL' };
  }

  const epochInfo = await rpcCall('getEpochInfo');
  const health = { epoch: epochInfo?.epoch ?? null, slotIndex: epochInfo?.slotIndex ?? null };

  let balanceLamports = null;
  if (WALLET_ADDRESS) {
    const bal = await rpcCall('getBalance', [WALLET_ADDRESS]);
    balanceLamports = Number(bal?.value ?? 0);
  }

  const solPriceUsd = await fetchSolPriceUsd();

  if (DRY_RUN) {
    return {
      status: 'dry-run',
      chain: 'solana',
      rpc: RPC_URL,
      wallet: WALLET_ADDRESS || null,
      health,
      balanceLamports,
      solPriceUsd,
      action: 'preflight-validated',
    };
  }

  if (!WALLET_ADDRESS) {
    return {
      status: 'skipped',
      chain: 'solana',
      reason: 'missing SOLANA_WALLET_ADDRESS for live mode',
      health,
    };
  }

  return {
    status: 'ready',
    chain: 'solana',
    rpc: RPC_URL,
    wallet: WALLET_ADDRESS,
    health,
    balanceLamports,
    solPriceUsd,
    action: 'live-launch-ready',
  };
}

if (require.main === module) {
  runCycle()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result?.status === 'error' ? 1 : 0);
    })
    .catch((error) => {
      console.log(JSON.stringify({ status: 'error', chain: 'solana', error: error?.message || String(error) }, null, 2));
      process.exit(1);
    });
}

module.exports = { runCycle };
