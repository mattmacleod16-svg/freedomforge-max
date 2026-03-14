#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.up.railway.app').replace(/\/$/, '');
const LOG_LIMIT = Math.max(200, parseInt(process.env.FORENSICS_LOG_LIMIT || '1500', 10));
const HOURS = Math.max(1, parseInt(process.env.FORENSICS_LOOKBACK_HOURS || '24', 10));
const NETWORKS = ['eth-mainnet', 'opt-mainnet', 'arb-mainnet', 'polygon-mainnet'];

function weiToEth(wei) {
  const n = BigInt(wei || '0');
  const base = BigInt('1000000000000000000');
  const whole = Number(n / base);
  const frac = Number(n % base) / 1e18;
  return whole + frac;
}

function inferNetwork(row) {
  const payload = row?.payload || {};
  const botId = String(payload.botId || '').toLowerCase();
  if (botId.startsWith('pol') || botId.includes('polygon')) return 'polygon-mainnet';
  if (botId.startsWith('arb')) return 'arb-mainnet';
  if (botId.startsWith('op')) return 'opt-mainnet';
  if (botId.startsWith('eth')) return 'eth-mainnet';
  return 'unknown';
}

async function fetchJson(pathname) {
  const headers = {};
  if (process.env.ALERT_SECRET) headers['x-api-secret'] = process.env.ALERT_SECRET;
  const response = await fetch(`${APP_BASE_URL}${pathname}`, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${pathname}`);
  }
  return response.json();
}

function createStats() {
  return {
    transfer: 0,
    transferFailed: 0,
    skippedThreshold: 0,
    skippedNoGas: 0,
    gasTopupError: 0,
    lastShareWei: null,
    lastMinPayoutWei: null,
    lastDynamicGasGuardWei: null,
  };
}

async function main() {
  const cutoff = Date.now() - HOURS * 60 * 60 * 1000;
  const wallets = {};

  for (const network of NETWORKS) {
    try {
      wallets[network] = await fetchJson(`/api/alchemy/wallet?network=${encodeURIComponent(network)}`);
    } catch (e) {
      wallets[network] = { error: String(e) };
    }
  }

  const logsPayload = await fetchJson(`/api/alchemy/wallet/logs?limit=${LOG_LIMIT}`);
  const logs = Array.isArray(logsPayload?.logs) ? logsPayload.logs : [];

  const statsByNetwork = {
    'eth-mainnet': createStats(),
    'opt-mainnet': createStats(),
    'arb-mainnet': createStats(),
    'polygon-mainnet': createStats(),
    unknown: createStats(),
  };

  for (const row of logs) {
    const ts = Date.parse(row?.time || '');
    if (!Number.isFinite(ts) || ts < cutoff) continue;

    const network = inferNetwork(row);
    const stats = statsByNetwork[network] || statsByNetwork.unknown;
    const payload = row?.payload || {};

    if (row?.type === 'transfer' || row?.type === 'transfer_token') stats.transfer += 1;
    if (row?.type === 'transfer_failed' || row?.type === 'transfer_token_failed') stats.transferFailed += 1;
    if (row?.type === 'distribution_skipped_threshold') {
      stats.skippedThreshold += 1;
      stats.lastShareWei = payload.share || null;
      stats.lastMinPayoutWei = payload.minPayoutWei || null;
      stats.lastDynamicGasGuardWei = payload.dynamicGasGuardWei || null;
    }
    if (row?.type === 'distribution_skipped_no_gas') stats.skippedNoGas += 1;
    if (row?.type === 'gas_topup_error' || row?.type === 'gas_check_error') stats.gasTopupError += 1;
  }

  console.log(`Wallet Forensics (${HOURS}h lookback)`);
  console.log(`App: ${APP_BASE_URL}`);
  console.log('');

  for (const network of NETWORKS) {
    const wallet = wallets[network] || {};
    const stats = statsByNetwork[network] || createStats();
    const balanceEth = wallet?.balance ? weiToEth(wallet.balance).toFixed(6) : 'n/a';

    console.log(`[${network}]`);
    if (wallet?.error) {
      console.log(`  wallet_error: ${wallet.error}`);
    } else {
      console.log(`  wallet: ${wallet.address || 'n/a'}`);
      console.log(`  balance_native: ${balanceEth}`);
      console.log(`  recipients: ${Array.isArray(wallet.recipients) ? wallet.recipients.length : 0}`);
    }
    console.log(`  transfers: ${stats.transfer}`);
    console.log(`  transfer_failures: ${stats.transferFailed}`);
    console.log(`  skipped_threshold: ${stats.skippedThreshold}`);
    console.log(`  skipped_no_gas: ${stats.skippedNoGas}`);
    console.log(`  gas_topup_errors: ${stats.gasTopupError}`);

    if (stats.lastShareWei && stats.lastMinPayoutWei) {
      console.log(`  last_share_vs_min_wei: ${stats.lastShareWei} / ${stats.lastMinPayoutWei}`);
      if (stats.lastDynamicGasGuardWei) {
        console.log(`  last_dynamic_gas_guard_wei: ${stats.lastDynamicGasGuardWei}`);
      }
    }
    console.log('');
  }

  const polygon = statsByNetwork['polygon-mainnet'];
  if (polygon.skippedThreshold > 0 && polygon.transfer === 0) {
    console.log('Polygon diagnosis: payouts are currently blocked by threshold/gas economics, not proof of silent loss.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
