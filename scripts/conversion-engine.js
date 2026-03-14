#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Wallet, JsonRpcProvider, Contract, parseEther } = require('ethers');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const ENABLED = String(process.env.CONVERSION_ENGINE_ENABLED || 'false').toLowerCase() === 'true';
const DRY_RUN = String(process.env.CONVERSION_ENGINE_DRY_RUN || 'true').toLowerCase() !== 'false';
const APP_BASE_URL = (process.env.APP_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'https://freedomforge-max.up.railway.app').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.CONVERSION_ENGINE_TIMEOUT_MS || 20000));
const MAX_TX_PER_CYCLE = Math.max(1, Number(process.env.CONVERSION_ENGINE_MAX_TX_PER_CYCLE || 1));
const SLIPPAGE_BPS_GLOBAL = Math.max(10, Math.min(300, Number(process.env.CONVERSION_SLIPPAGE_BPS || 100)));
const SPLIT_ENABLED = String(process.env.CONVERSION_SPLIT_ORDERS || 'true').toLowerCase() !== 'false';
const SPLIT_MAX_PARTS = Math.max(1, Math.min(8, Number(process.env.CONVERSION_SPLIT_MAX_PARTS || 3)));
const SPLIT_BASE_BPS = Math.max(500, Math.min(5000, Number(process.env.CONVERSION_SPLIT_BASE_BPS || 2500)));
const SPLIT_STRENGTHEN_BPS = Math.max(0, Math.min(500, Number(process.env.CONVERSION_STRENGTHEN_BPS || 20)));
const SPLIT_MAX_SCALE_BPS = Math.max(10000, Math.min(25000, Number(process.env.CONVERSION_SPLIT_MAX_SCALE_BPS || 15000)));
const ZEROX_API_KEY = (process.env.ZEROX_API_KEY || process.env.SWAP_API_KEY || '').trim();
const MIN_INTERVAL_SEC = Math.max(0, Number(process.env.CONVERSION_MIN_INTERVAL_SEC || 300));
const SKIP_COOLDOWN_SEC = Math.max(0, Number(process.env.CONVERSION_SKIP_COOLDOWN_SEC || 90));
const MAX_NETWORK_FEE_RATIO_BPS = Math.max(1, Math.min(5000, Number(process.env.CONVERSION_MAX_NETWORK_FEE_RATIO_BPS || 250)));
const STATE_FILE = process.env.CONVERSION_STATE_FILE || 'data/conversion-state.json';

const NATIVE_TOKEN_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

function resolveNetworkSlug(raw) {
  const value = String(raw || process.env.ALCHEMY_NETWORK || 'eth-mainnet').toLowerCase();
  if (value === 'mainnet' || value === 'eth-mainnet' || value === 'ethereum') return 'eth-mainnet';
  if (value === 'op' || value === 'opt-mainnet' || value === 'optimism' || value === 'optimism-mainnet') return 'opt-mainnet';
  if (value === 'arb' || value === 'arb-mainnet' || value === 'arbitrum' || value === 'arbitrum-mainnet') return 'arb-mainnet';
  if (value === 'polygon' || value === 'polygon-mainnet' || value === 'matic' || value === 'matic-mainnet') return 'polygon-mainnet';
  if (value === 'base' || value === 'base-mainnet') return 'base-mainnet';
  return value;
}

function networkSuffixFromSlug(slug) {
  if (slug === 'eth-mainnet') return 'ETH_MAINNET';
  if (slug === 'opt-mainnet') return 'OPT_MAINNET';
  if (slug === 'arb-mainnet') return 'ARB_MAINNET';
  if (slug === 'polygon-mainnet') return 'POLYGON_MAINNET';
  if (slug === 'base-mainnet') return 'BASE_MAINNET';
  return slug.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function chainIdFromSlug(slug) {
  if (slug === 'eth-mainnet') return 1;
  if (slug === 'opt-mainnet') return 10;
  if (slug === 'arb-mainnet') return 42161;
  if (slug === 'polygon-mainnet') return 137;
  if (slug === 'base-mainnet') return 8453;
  throw new Error(`Unsupported conversion network: ${slug}`);
}

function getRpcUrl(slug) {
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) return null;
  return `https://${slug}.g.alchemy.com/v2/${apiKey}`;
}

function getScopedEnv(baseKey, suffix) {
  return process.env[`${baseKey}_${suffix}`] ?? process.env[baseKey];
}

let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

function withTimeout(ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { controller, timeout };
}

function get0xHeaders() {
  const headers = {};
  if (ZEROX_API_KEY) {
    headers['0x-api-key'] = ZEROX_API_KEY;
    headers['0x-version'] = 'v2';
  }
  return headers;
}

function loadState() {
  const statePath = path.resolve(process.cwd(), STATE_FILE);
  if (!fs.existsSync(statePath)) return { statePath, byNetwork: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return { statePath, byNetwork: parsed?.byNetwork || {} };
  } catch {
    return { statePath, byNetwork: {} };
  }
}

function saveState(statePath, byNetwork) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const data = { byNetwork, updatedAt: new Date().toISOString() };
  if (rio) { rio.writeJsonAtomic(statePath, data); }
  else {
    const tmp = statePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, statePath);
  }
}

async function fetchJson(url, headers = {}) {
  const { controller, timeout } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${JSON.stringify(payload).slice(0, 300)}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function readRecentNoGasSpikes(hours) {
  try {
    const logsPayload = await fetchJson(`${APP_BASE_URL}/api/alchemy/wallet/logs?limit=1000`);
    const logs = Array.isArray(logsPayload?.logs) ? logsPayload.logs : [];
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    let count = 0;
    for (const row of logs) {
      const ts = Date.parse(row?.time || '');
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      if (row?.type === 'distribution_skipped_no_gas' || row?.type === 'gas_topup_error' || row?.type === 'gas_check_error') {
        count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

async function getSellAmountWei(wallet, provider, sellToken, suffix) {
  const fixedAmountWeiRaw = (getScopedEnv('CONVERSION_SELL_AMOUNT_WEI', suffix) || '').trim();
  const sellPct = Math.max(1, Math.min(95, Number(getScopedEnv('CONVERSION_SELL_BALANCE_PCT', suffix) || 15)));

  if (sellToken.toLowerCase() === NATIVE_TOKEN_SENTINEL) {
    const nativeBalance = await provider.getBalance(wallet.address);
    const reserveEth = Number(getScopedEnv('CONVERSION_MIN_NATIVE_RESERVE_ETH', suffix) || 0.003);
    const reserveWei = parseEther(String(reserveEth));
    const spendable = nativeBalance > reserveWei ? nativeBalance - reserveWei : 0n;
    if (spendable <= 0n) return 0n;

    if (fixedAmountWeiRaw) {
      const fixed = BigInt(fixedAmountWeiRaw);
      return fixed <= spendable ? fixed : spendable;
    }
    return (spendable * BigInt(Math.round(sellPct * 100))) / 10000n;
  }

  const token = new Contract(sellToken, ERC20_ABI, provider);
  const tokenBalance = await token.balanceOf(wallet.address);
  if (tokenBalance <= 0n) return 0n;

  if (fixedAmountWeiRaw) {
    const fixed = BigInt(fixedAmountWeiRaw);
    return fixed <= tokenBalance ? fixed : tokenBalance;
  }

  return (tokenBalance * BigInt(Math.round(sellPct * 100))) / 10000n;
}

async function executeRoute(networkSlug, networkState, nowMs) {
  const suffix = networkSuffixFromSlug(networkSlug);
  const chainId = chainIdFromSlug(networkSlug);

  const sinceLastExecutionSec = networkState?.lastExecutedAt ? Math.floor((nowMs - Number(networkState.lastExecutedAt)) / 1000) : null;
  if (sinceLastExecutionSec !== null && sinceLastExecutionSec < MIN_INTERVAL_SEC) {
    return {
      network: networkSlug,
      status: 'skipped',
      reason: `min-interval-not-met (${sinceLastExecutionSec}s/${MIN_INTERVAL_SEC}s)`,
    };
  }

  const sinceLastSkipSec = networkState?.lastSkipAt ? Math.floor((nowMs - Number(networkState.lastSkipAt)) / 1000) : null;
  if (
    sinceLastSkipSec !== null &&
    sinceLastSkipSec < SKIP_COOLDOWN_SEC &&
    typeof networkState?.lastSkipReason === 'string' &&
    /no sell balance|below minimum|no-gas spike trigger/.test(networkState.lastSkipReason)
  ) {
    return {
      network: networkSlug,
      status: 'skipped',
      reason: `skip-cooldown (${sinceLastSkipSec}s/${SKIP_COOLDOWN_SEC}s) for ${networkState.lastSkipReason}`,
    };
  }

  const sellToken = (getScopedEnv('CONVERSION_FROM_TOKEN', suffix) || '').trim();
  const buyToken = (getScopedEnv('CONVERSION_TO_TOKEN', suffix) || '').trim();
  if (!sellToken || !buyToken) {
    return { network: networkSlug, status: 'skipped', reason: `missing CONVERSION_FROM_TOKEN_${suffix} / CONVERSION_TO_TOKEN_${suffix}` };
  }

  const privateKey = (process.env.WALLET_PRIVATE_KEY || '').trim();
  if (!privateKey) {
    return { network: networkSlug, status: 'skipped', reason: 'missing WALLET_PRIVATE_KEY' };
  }

  const rpcUrl = getRpcUrl(networkSlug);
  if (!rpcUrl) {
    return { network: networkSlug, status: 'skipped', reason: 'missing ALCHEMY_API_KEY' };
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);

  const sellAmount = await getSellAmountWei(wallet, provider, sellToken, suffix);
  if (sellAmount <= 0n) {
    return { network: networkSlug, status: 'skipped', reason: 'no sell balance / spendable amount', wallet: wallet.address };
  }

  const minSellAmountWeiRaw = (getScopedEnv('CONVERSION_MIN_SELL_AMOUNT_WEI', suffix) || '').trim();
  if (minSellAmountWeiRaw && sellAmount < BigInt(minSellAmountWeiRaw)) {
    return { network: networkSlug, status: 'skipped', reason: 'sell amount below minimum', wallet: wallet.address, sellAmountWei: sellAmount.toString() };
  }

  const slippageBps = Math.max(10, Math.min(500, Number(getScopedEnv('CONVERSION_SLIPPAGE_BPS', suffix) || SLIPPAGE_BPS_GLOBAL)));
  const minBuyAmountWeiRaw = (getScopedEnv('CONVERSION_MIN_BUY_AMOUNT_WEI', suffix) || '').trim();
  const minBuyAmountWei = minBuyAmountWeiRaw ? BigInt(minBuyAmountWeiRaw) : 0n;
  if (!ZEROX_API_KEY) {
    return {
      network: networkSlug,
      status: 'skipped',
      reason: 'missing ZEROX_API_KEY (required by 0x swap API)',
      wallet: wallet.address,
    };
  }

  const noGasSpikeHours = Math.max(1, Number(process.env.CONVERSION_TRIGGER_LOOKBACK_HOURS || 6));
  const noGasSpikeMin = Math.max(0, Number(process.env.CONVERSION_TRIGGER_NOGAS_SPIKE_MIN || 1));
  if (noGasSpikeMin > 0) {
    const noGasCount = await readRecentNoGasSpikes(noGasSpikeHours);
    if (noGasCount < noGasSpikeMin) {
      return {
        network: networkSlug,
        status: 'skipped',
        reason: `no-gas spike trigger not met (${noGasCount}/${noGasSpikeMin})`,
        wallet: wallet.address,
      };
    }
  }

  const maxParts = SPLIT_ENABLED ? SPLIT_MAX_PARTS : 1;
  let txCount = 0;
  let executedSellWei = 0n;
  let executedBuyWei = 0n;
  let remainderWei = sellAmount;
  let scaleBps = 10000;
  let lastRatioPpm = 0n;
  const fills = [];

  for (let part = 1; part <= maxParts && remainderWei > 0n; part += 1) {
    if (txCount >= MAX_TX_PER_CYCLE) {
      fills.push({ part, status: 'skipped', reason: 'max tx per cycle reached' });
      break;
    }

    let desiredPartWei;
    if (!SPLIT_ENABLED || maxParts === 1) {
      desiredPartWei = remainderWei;
    } else {
      const basePartWei = (sellAmount * BigInt(SPLIT_BASE_BPS)) / 10000n;
      desiredPartWei = (basePartWei * BigInt(scaleBps)) / 10000n;
      if (desiredPartWei <= 0n) desiredPartWei = 1n;
      if (desiredPartWei > remainderWei) desiredPartWei = remainderWei;
      if (part === maxParts) desiredPartWei = remainderWei;
    }

    const params = new URLSearchParams({
      chainId: String(chainId),
      sellToken,
      buyToken,
      sellAmount: desiredPartWei.toString(),
      taker: wallet.address,
      slippageBps: String(slippageBps),
    });

    const price = await fetchJson(`https://api.0x.org/swap/allowance-holder/price?${params.toString()}`, get0xHeaders());
    const buyAmountQuoted = BigInt(price?.buyAmount || '0');
    if (buyAmountQuoted <= 0n) {
      fills.push({ part, status: 'skipped', reason: 'no buy amount from quote' });
      break;
    }

    if (buyAmountQuoted < minBuyAmountWei) {
      fills.push({
        part,
        status: 'skipped',
        reason: 'quote below minimum buy amount',
        quotedBuyWei: buyAmountQuoted.toString(),
        minBuyWei: minBuyAmountWei.toString(),
      });
      break;
    }

    const ratioPpm = (buyAmountQuoted * 1000000n) / desiredPartWei;
    if (lastRatioPpm > 0n) {
      const strengthenThreshold = (lastRatioPpm * BigInt(10000 + SPLIT_STRENGTHEN_BPS)) / 10000n;
      if (ratioPpm >= strengthenThreshold) {
        scaleBps = Math.min(SPLIT_MAX_SCALE_BPS, Math.round(scaleBps * 1.18));
      } else {
        scaleBps = Math.max(8000, Math.round(scaleBps * 0.93));
      }
    }
    lastRatioPpm = ratioPpm;

    const quote = await fetchJson(`https://api.0x.org/swap/allowance-holder/quote?${params.toString()}`, get0xHeaders());
    const txReq = quote?.transaction;
    if (!txReq?.to || !txReq?.data) {
      fills.push({ part, status: 'skipped', reason: 'invalid quote transaction payload' });
      break;
    }

    if (sellToken.toLowerCase() === NATIVE_TOKEN_SENTINEL) {
      const networkFeeWei = BigInt(quote?.totalNetworkFee || '0');
      if (networkFeeWei > 0n && desiredPartWei > 0n) {
        const feeRatioBps = Number((networkFeeWei * 10000n) / desiredPartWei);
        if (feeRatioBps > MAX_NETWORK_FEE_RATIO_BPS) {
          fills.push({
            part,
            status: 'skipped',
            reason: `network-fee-ratio-too-high (${feeRatioBps}bps>${MAX_NETWORK_FEE_RATIO_BPS}bps)`,
          });
          break;
        }
      }
    }

    if (DRY_RUN) {
      txCount += 1;
      executedSellWei += desiredPartWei;
      executedBuyWei += BigInt(quote?.buyAmount || buyAmountQuoted.toString());
      remainderWei -= desiredPartWei;
      fills.push({
        part,
        status: 'dry-run',
        sellAmountWei: desiredPartWei.toString(),
        buyAmountWei: String(quote?.buyAmount || buyAmountQuoted.toString()),
        scaleBps,
      });
      continue;
    }

    if (sellToken.toLowerCase() !== NATIVE_TOKEN_SENTINEL) {
      const spender = quote?.issues?.allowance?.spender || quote?.allowanceTarget;
      if (!spender) {
        fills.push({ part, status: 'skipped', reason: 'missing spender/allowance target in quote' });
        break;
      }

      const token = new Contract(sellToken, ERC20_ABI, wallet);
      const allowance = await token.allowance(wallet.address, spender);
      if (allowance < desiredPartWei) {
        const approveTx = await token.approve(spender, desiredPartWei);
        await approveTx.wait();
      }
    }

    const tx = await wallet.sendTransaction({
      to: txReq.to,
      data: txReq.data,
      value: BigInt(txReq.value || '0'),
      gasLimit: txReq.gas ? BigInt(txReq.gas) : undefined,
      gasPrice: txReq.gasPrice ? BigInt(txReq.gasPrice) : undefined,
    });
    await tx.wait();

    txCount += 1;
    executedSellWei += desiredPartWei;
    executedBuyWei += BigInt(quote?.buyAmount || buyAmountQuoted.toString());
    remainderWei -= desiredPartWei;
    fills.push({
      part,
      status: 'executed',
      txHash: tx.hash,
      sellAmountWei: desiredPartWei.toString(),
      quotedBuyAmountWei: String(quote?.buyAmount || buyAmountQuoted.toString()),
      scaleBps,
    });
  }

  if (txCount === 0) {
    return {
      network: networkSlug,
      status: 'skipped',
      wallet: wallet.address,
      reason: fills[0]?.reason || 'no executable conversion fills',
      sellToken,
      buyToken,
      fills,
    };
  }

  return {
    network: networkSlug,
    status: DRY_RUN ? 'dry-run' : 'executed',
    wallet: wallet.address,
    sellToken,
    buyToken,
    sellAmountWeiRequested: sellAmount.toString(),
    sellAmountWeiExecuted: executedSellWei.toString(),
    buyAmountWeiQuoted: executedBuyWei.toString(),
    txCount,
    fills,
  };
}

async function main() {
  if (!ENABLED) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'CONVERSION_ENGINE_ENABLED is false' }, null, 2));
    return;
  }

  const configuredNetworks = (process.env.CONVERSION_NETWORKS || process.env.TRADE_LOOP_NETWORK || process.env.ALCHEMY_NETWORK || 'eth-mainnet')
    .split(',')
    .map((value) => resolveNetworkSlug(value.trim()))
    .filter(Boolean);

  const uniqueNetworks = [...new Set(configuredNetworks)];
  const results = [];
  const nowMs = Date.now();
  const state = loadState();

  for (const network of uniqueNetworks) {
    if (results.filter((row) => row.status === 'executed').length >= MAX_TX_PER_CYCLE) {
      results.push({ network, status: 'skipped', reason: 'max tx per cycle reached' });
      continue;
    }

    try {
      const row = await executeRoute(network, state.byNetwork[network] || {}, nowMs);
      results.push(row);

      const networkState = state.byNetwork[network] || {};
      networkState.lastAttemptAt = nowMs;

      if (row.status === 'executed') {
        networkState.lastExecutedAt = nowMs;
        networkState.lastSkipAt = undefined;
        networkState.lastSkipReason = undefined;
      } else if (row.status === 'skipped') {
        networkState.lastSkipAt = nowMs;
        networkState.lastSkipReason = row.reason || 'unspecified';
      }

      state.byNetwork[network] = networkState;
    } catch (error) {
      results.push({
        network,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });

      const networkState = state.byNetwork[network] || {};
      networkState.lastAttemptAt = nowMs;
      networkState.lastSkipAt = nowMs;
      networkState.lastSkipReason = 'error';
      state.byNetwork[network] = networkState;
    }
  }

  saveState(state.statePath, state.byNetwork);

  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    enabled: true,
    dryRun: DRY_RUN,
    appBaseUrl: APP_BASE_URL,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
