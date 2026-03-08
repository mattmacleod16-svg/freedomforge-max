/**
 * Alchemy API Connector
 * Provides helper functions to interact with Alchemy web3/API services
 */

import { Alchemy, Network } from "@alch/alchemy-sdk";
import { Wallet, parseEther, JsonRpcProvider, Contract } from "ethers";
import { getAuthorizedRecipients } from './recipients';
import { sendAlert } from '../alerts';
import { ensureRevenueWalletHasGas } from '../gasTopup';
import { logEvent, readLast } from '../logger';

type DistributionOptions = {
  shardIndex?: number;
  totalShards?: number;
  botId?: string;
  networkOverride?: string;
};

const alchemyByNetwork = new Map<string, any>();
const rpcProviderByNetwork = new Map<string, JsonRpcProvider>();

function resolveNetworkConfig(raw?: string): { sdkNetwork: any; rpcSlug: string } {
  const value = (raw || 'eth-mainnet').toLowerCase();
  const networkEnum = Network as any;

  const firstAvailable = (...candidates: string[]) => {
    for (const key of candidates) {
      if (networkEnum[key]) return networkEnum[key];
    }
    return null;
  };

  if (value === 'base' || value === 'base-mainnet') {
    return { sdkNetwork: Network.BASE_MAINNET, rpcSlug: 'base-mainnet' };
  }

  if (value === 'mainnet' || value === 'eth-mainnet' || value === 'ethereum') {
    return { sdkNetwork: Network.ETH_MAINNET, rpcSlug: 'eth-mainnet' };
  }

  if (value === 'arb' || value === 'arbitrum' || value === 'arb-mainnet' || value === 'arbitrum-mainnet') {
    return {
      sdkNetwork: firstAvailable('ARB_MAINNET', 'ARBITRUM_MAINNET', 'ARB') || 'arb-mainnet',
      rpcSlug: 'arb-mainnet',
    };
  }

  if (value === 'op' || value === 'optimism' || value === 'opt-mainnet' || value === 'optimism-mainnet') {
    return {
      sdkNetwork: firstAvailable('OPT_MAINNET', 'OPTIMISM_MAINNET', 'OPT') || 'opt-mainnet',
      rpcSlug: 'opt-mainnet',
    };
  }

  if (value === 'polygon' || value === 'matic' || value === 'polygon-mainnet' || value === 'matic-mainnet') {
    return {
      sdkNetwork: firstAvailable('MATIC_MAINNET', 'POLYGON_MAINNET', 'MATIC') || 'polygon-mainnet',
      rpcSlug: 'polygon-mainnet',
    };
  }

  return { sdkNetwork: raw || Network.ETH_MAINNET, rpcSlug: raw || 'eth-mainnet' };
}

function getEthersNetwork(networkOverride?: string) {
  const network = resolveNetworkConfig(networkOverride || process.env.ALCHEMY_NETWORK).rpcSlug;
  if (network === 'base-mainnet' || network === 'base') {
    return { chainId: 8453, name: 'base' };
  }
  if (network === 'arb-mainnet' || network === 'arbitrum-mainnet') {
    return { chainId: 42161, name: 'arbitrum' };
  }
  if (network === 'opt-mainnet' || network === 'optimism-mainnet') {
    return { chainId: 10, name: 'optimism' };
  }
  if (network === 'polygon-mainnet' || network === 'matic-mainnet') {
    return { chainId: 137, name: 'polygon' };
  }
  return { chainId: 1, name: 'mainnet' };
}

function getAlchemyRpcUrl(networkOverride?: string): string | null {
  const apiKey = process.env.ALCHEMY_API_KEY;
  const network = resolveNetworkConfig(networkOverride || process.env.ALCHEMY_NETWORK).rpcSlug;
  if (!apiKey) return null;
  return `https://${network}.g.alchemy.com/v2/${apiKey}`;
}

function getNetworkEnvSuffix(rpcSlug: string): string {
  if (rpcSlug === 'eth-mainnet') return 'ETH_MAINNET';
  if (rpcSlug === 'base-mainnet') return 'BASE_MAINNET';
  if (rpcSlug === 'opt-mainnet') return 'OPT_MAINNET';
  if (rpcSlug === 'arb-mainnet') return 'ARB_MAINNET';
  if (rpcSlug === 'polygon-mainnet') return 'POLYGON_MAINNET';
  return rpcSlug.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function getNetworkScopedEnv(baseKey: string, networkOverride?: string): string | undefined {
  const rpcSlug = resolveNetworkConfig(networkOverride || process.env.ALCHEMY_NETWORK).rpcSlug;
  const scopedKey = `${baseKey}_${getNetworkEnvSuffix(rpcSlug)}`;
  return process.env[scopedKey] ?? process.env[baseKey];
}

const ETH_USD_CACHE_TTL_MS = 2 * 60 * 1000;
let cachedEthUsdPrice: { value: number; expiresAt: number } | null = null;

function parseFiniteNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function formatEthAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  const normalized = value.toFixed(18).replace(/0+$/, '').replace(/\.$/, '');
  return normalized.length > 0 ? normalized : '0';
}

async function getEthUsdSpotPrice(): Promise<number | null> {
  const now = Date.now();
  if (cachedEthUsdPrice && cachedEthUsdPrice.expiresAt > now) {
    return cachedEthUsdPrice.value;
  }

  try {
    const response = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot', {
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload: any = await response.json();
    const amount = Number(payload?.data?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    cachedEthUsdPrice = { value: amount, expiresAt: now + ETH_USD_CACHE_TTL_MS };
    return amount;
  } catch {
    return null;
  }
}

async function resolveUsdMinPayoutWei(minUsd: number): Promise<{ minWei: bigint; ethUsd: number | null; source: string }> {
  if (!Number.isFinite(minUsd) || minUsd <= 0) {
    return { minWei: BigInt(0), ethUsd: null, source: 'disabled' };
  }

  const spot = await getEthUsdSpotPrice();
  if (spot && spot > 0) {
    const minEth = minUsd / spot;
    return { minWei: parseEther(formatEthAmount(minEth)), ethUsd: spot, source: 'coinbase-spot' };
  }

  const fallbackEthUsd = parseFiniteNumber(process.env.PAYOUT_USD_FALLBACK_ETH_PRICE, 0);
  if (fallbackEthUsd > 0) {
    const minEth = minUsd / fallbackEthUsd;
    return { minWei: parseEther(formatEthAmount(minEth)), ethUsd: fallbackEthUsd, source: 'env-fallback' };
  }

  return { minWei: BigInt(0), ethUsd: null, source: 'unavailable' };
}

export function getRpcProvider(networkOverride?: string): JsonRpcProvider | null {
  const rpcSlug = resolveNetworkConfig(networkOverride || process.env.ALCHEMY_NETWORK).rpcSlug;
  const existing = rpcProviderByNetwork.get(rpcSlug);
  if (existing) return existing;

  const rpcUrl = getAlchemyRpcUrl(networkOverride);
  if (!rpcUrl) return null;
  const provider = new JsonRpcProvider(rpcUrl, getEthersNetwork(networkOverride), { staticNetwork: true });
  rpcProviderByNetwork.set(rpcSlug, provider);
  return provider;
}

export function initAlchemy(networkOverride?: string) {
  const rpcSlug = resolveNetworkConfig(networkOverride || process.env.ALCHEMY_NETWORK).rpcSlug;
  const existing = alchemyByNetwork.get(rpcSlug);
  if (existing) return existing;

  const apiKey = process.env.ALCHEMY_API_KEY;
  const network: any = resolveNetworkConfig(networkOverride || process.env.ALCHEMY_NETWORK).sdkNetwork;

  if (!apiKey) {
    console.warn("Alchemy API key not set, blockchain features disabled");
    return null;
  }

  const client = new Alchemy({ apiKey, network });
  alchemyByNetwork.set(rpcSlug, client);
  return client;
}

export async function getLatestBlock(networkOverride?: string): Promise<number | null> {
  const client = initAlchemy(networkOverride);
  if (!client) return null;
  try {
    const block = await client.core.getBlockNumber();
    return block;
  } catch (err) {
    console.error("Alchemy error retrieving block number", err);
    return null;
  }
}

export async function getBalance(address: string, networkOverride?: string): Promise<string | null> {
  const client = initAlchemy(networkOverride);
  if (!client) return null;
  try {
    const balance = await client.core.getBalance(address);
    return balance.toString();
  } catch (err) {
    console.error("Alchemy error getting balance", err);
    return null;
  }
}

/**
 * Return balances for a list of ERC‑20 token contracts held by `address`.
 * Uses `TRACKED_TOKENS` env var (comma-separated list) or explicit list.
 */
export async function getTokenBalances(address: string, tokens?: string[], networkOverride?: string): Promise<{[token:string]: {balance: string | null; symbol?: string; decimals?: number}} | null> {
  const client = initAlchemy(networkOverride);
  if (!client) return null;
  const list = tokens || (process.env.TRACKED_TOKENS || '').split(',').map(t => t.trim()).filter(t => t);
  if (list.length === 0) return null;
  try {
    const result: {[token:string]: {balance: string | null; symbol?: string; decimals?: number}} = {};
    for (const t of list) {
      try {
        const balResp = await client.core.getTokenBalances(address, [t]);
        // Alchemy returns tokenBalances array; take first
        const tb = balResp.tokenBalances[0];
        const balance = tb ? tb.tokenBalance : null;
        // attempt to fetch metadata (symbol, decimals) for nicer display
        let symbol: string | undefined;
        let decimals: number | undefined;
        try {
          const meta = await client.core.getTokenMetadata(t);
          if (meta) {
            symbol = meta.symbol;
            decimals = meta.decimals;
          }
        } catch (metaErr) {
          console.error('token metadata error', t, metaErr);
        }
        result[t] = { balance, symbol, decimals };
      } catch (e) {
        console.error('token balance error', t, e);
        result[t] = { balance: null };
      }
    }
    return result;
  } catch (err) {
    console.error('Alchemy error getting token balances', err);
    return null;
  }
}

// ---------------- wallet helpers for revenue management

const revenueWalletByNetwork = new Map<string, Wallet>();
const generatedWalletAddressByNetwork = new Map<string, string>();
const missingWalletConfigAlertedByNetwork = new Set<string>();

export function getGeneratedWalletAddress(networkOverride?: string): string | null {
  const rpcSlug = resolveNetworkConfig(networkOverride || process.env.ALCHEMY_NETWORK).rpcSlug;
  return generatedWalletAddressByNetwork.get(rpcSlug) || null;
}

export function initRevenueWallet(networkOverride?: string): Wallet | null {
  const rpcSlug = resolveNetworkConfig(networkOverride || process.env.ALCHEMY_NETWORK).rpcSlug;
  const existing = revenueWalletByNetwork.get(rpcSlug);
  if (existing) return existing;

  let privateKey = process.env.WALLET_PRIVATE_KEY;
  const requestedAutoGenerate = String(process.env.WALLET_AUTO_GENERATE || 'false').toLowerCase() === 'true';
  const autoGenerateWallet = requestedAutoGenerate && process.env.NODE_ENV !== 'production';

  if (!privateKey) {
    if (!autoGenerateWallet) {
      if (!missingWalletConfigAlertedByNetwork.has(rpcSlug)) {
        const msg = requestedAutoGenerate && process.env.NODE_ENV === 'production'
          ? 'WALLET_AUTO_GENERATE is ignored in production; set WALLET_PRIVATE_KEY for a stable production wallet.'
          : 'No WALLET_PRIVATE_KEY configured; revenue wallet disabled. Set WALLET_PRIVATE_KEY to use one stable address. Set WALLET_AUTO_GENERATE=true only for local testing.';
        console.error(msg);
        sendAlert(msg);
        missingWalletConfigAlertedByNetwork.add(rpcSlug);
      }
      return null;
    }

    const generated = Wallet.createRandom();
    privateKey = generated.privateKey;
    generatedWalletAddressByNetwork.set(rpcSlug, generated.address);
    console.warn("🤖 WALLET_AUTO_GENERATE=true and no WALLET_PRIVATE_KEY set; generated temporary wallet:", generated.address);
    console.warn("⚠️ This wallet is ephemeral and should only be used for local testing");
    sendAlert(`🤖 Temporary wallet generated (WALLET_AUTO_GENERATE=true): ${generated.address} — set WALLET_PRIVATE_KEY for a stable production address`);
  }
  const provider = getRpcProvider(networkOverride);
  if (!provider) return null;
  const wallet = new Wallet(privateKey, provider);
  revenueWalletByNetwork.set(rpcSlug, wallet);
  generatedWalletAddressByNetwork.set(rpcSlug, wallet.address);
  return wallet;
}

export function createRandomWallet(): { address: string; privateKey: string } {
  const w = Wallet.createRandom();
  return { address: w.address, privateKey: w.privateKey };
}

export async function getRevenueWalletBalance(networkOverride?: string): Promise<string | null> {
  const w = initRevenueWallet(networkOverride);
  if (!w) return null;
  try {
    const provider = w.provider;
    if (!provider) return null;
    const bal = await provider.getBalance(w.address);
    return bal.toString();
  } catch (err) {
    console.error("Error getting revenue wallet balance", err);
    return null;
  }
}

export async function withdrawFromRevenue(to: string, amountEther: string, networkOverride?: string): Promise<string | null> {
  const w = initRevenueWallet(networkOverride);
  if (!w) return null;
  try {
    const tx = await w.sendTransaction({
      to,
      value: parseEther(amountEther),
    });
    await tx.wait();
    await logEvent('withdraw', { to, amountEther, txHash: tx.hash, wallet: w.address });
    return tx.hash;
  } catch (err) {
    console.error("Withdrawal error", err);    sendAlert(`Revenue wallet withdrawal failed: ${err}`);    return null;
  }
}

/**
 * Utility to disperse funds automatically to configured recipients.
 * Splits the full wallet balance evenly across all authorized addresses.
 */
export async function distributeRevenue(options: DistributionOptions = {}): Promise<{[address:string]: string | null} | null> {
  const allRecipients = getAuthorizedRecipients();
  const totalShardsRaw = options.totalShards ?? parseInt(process.env.BOT_SHARDS || '1', 10);
  const totalShards = Number.isFinite(totalShardsRaw) ? Math.max(1, totalShardsRaw) : 1;
  const shardIndexRaw = options.shardIndex ?? parseInt(process.env.BOT_SHARD_INDEX || '0', 10);
  const shardIndex = Number.isFinite(shardIndexRaw) ? Math.max(0, Math.min(totalShards - 1, shardIndexRaw)) : 0;
  const botId = options.botId || process.env.BOT_ID || `bot-${shardIndex}`;

  const recipients = allRecipients.filter((_, idx) => (idx % totalShards) === shardIndex);

  const w = initRevenueWallet(options.networkOverride);
  if (!w) {
    sendAlert('Revenue wallet initialization failed before distribution');
    return null;
  }

  if (allRecipients.length === 0) {
    sendAlert('No recipients configured for revenue distribution');
    return null;
  }

  if (recipients.length === 0) {
    await logEvent('distribution_skipped_empty_shard', { wallet: w.address, botId, shardIndex, totalShards, allRecipientsCount: allRecipients.length });
    return {};
  }

  const provider = w.provider;
  if (!provider) {
    sendAlert('Revenue wallet provider not available');
    return null;
  }

  const maxRetries = Math.max(1, parseInt(process.env.DISTRIBUTION_MAX_RETRIES || '3', 10));
  const retryBaseMs = Math.max(100, parseInt(process.env.DISTRIBUTION_RETRY_BASE_MS || '1000', 10));
  const gasReserveEth = (getNetworkScopedEnv('GAS_RESERVE_ETH', options.networkOverride) || process.env.SELF_SUSTAIN_RESERVE_ETH || '0.02').trim();
  const reinvestBpsRaw = parseInt(getNetworkScopedEnv('SELF_SUSTAIN_REINVEST_BPS', options.networkOverride) || '2000', 10);
  const reinvestBps = Math.max(0, Math.min(9900, Number.isFinite(reinvestBpsRaw) ? reinvestBpsRaw : 2000));
  const treasuryTargetEth = (getNetworkScopedEnv('TREASURY_TARGET_ETH', options.networkOverride) || '0.03').trim();
  const treasuryMaxReinvestBpsRaw = parseInt(getNetworkScopedEnv('TREASURY_MAX_REINVEST_BPS', options.networkOverride) || '9000', 10);
  const treasuryMaxReinvestBps = Math.max(reinvestBps, Math.min(9900, Number.isFinite(treasuryMaxReinvestBpsRaw) ? treasuryMaxReinvestBpsRaw : 9000));
  const selfFundingMode = String(getNetworkScopedEnv('SELF_FUNDING_MODE', options.networkOverride) || 'false').toLowerCase() === 'true';
  const selfFundingBalanceTargetEth = (getNetworkScopedEnv('SELF_FUNDING_BALANCE_TARGET_ETH', options.networkOverride) || treasuryTargetEth || '0.05').trim();
  const selfFundingBelowTargetBpsRaw = parseInt(getNetworkScopedEnv('SELF_FUNDING_REINVEST_BPS_BELOW_TARGET', options.networkOverride) || '9700', 10);
  const selfFundingAboveTargetBpsRaw = parseInt(getNetworkScopedEnv('SELF_FUNDING_REINVEST_BPS_ABOVE_TARGET', options.networkOverride) || '9400', 10);
  const selfFundingBelowTargetBps = Math.max(0, Math.min(9900, Number.isFinite(selfFundingBelowTargetBpsRaw) ? selfFundingBelowTargetBpsRaw : 9700));
  const selfFundingAboveTargetBps = Math.max(0, Math.min(9900, Number.isFinite(selfFundingAboveTargetBpsRaw) ? selfFundingAboveTargetBpsRaw : 9400));
  const selfFundingCriticalBalanceEth = (getNetworkScopedEnv('SELF_FUNDING_CRITICAL_BALANCE_ETH', options.networkOverride) || '0.02').trim();
  const selfFundingCriticalReinvestBpsRaw = parseInt(getNetworkScopedEnv('SELF_FUNDING_CRITICAL_REINVEST_BPS', options.networkOverride) || '9900', 10);
  const selfFundingCriticalReinvestBps = Math.max(0, Math.min(9950, Number.isFinite(selfFundingCriticalReinvestBpsRaw) ? selfFundingCriticalReinvestBpsRaw : 9900));
  const selfFundingPauseOverflowOnCritical = String(getNetworkScopedEnv('SELF_FUNDING_PAUSE_OVERFLOW_ON_CRITICAL', options.networkOverride) || 'true').toLowerCase() !== 'false';
  const selfFundingCriticalDynamicEnabled = String(getNetworkScopedEnv('SELF_FUNDING_CRITICAL_DYNAMIC_ENABLED', options.networkOverride) || 'true').toLowerCase() !== 'false';
  const selfFundingCriticalDynamicPerFailureBpsRaw = parseInt(getNetworkScopedEnv('SELF_FUNDING_CRITICAL_DYNAMIC_PER_FAILURE_BPS', options.networkOverride) || '250', 10);
  const selfFundingCriticalDynamicPerFailureBps = Number.isFinite(selfFundingCriticalDynamicPerFailureBpsRaw)
    ? Math.max(0, Math.min(5000, selfFundingCriticalDynamicPerFailureBpsRaw))
    : 250;
  const selfFundingCriticalDynamicMaxExtraBpsRaw = parseInt(getNetworkScopedEnv('SELF_FUNDING_CRITICAL_DYNAMIC_MAX_EXTRA_BPS', options.networkOverride) || '3000', 10);
  const selfFundingCriticalDynamicMaxExtraBps = Number.isFinite(selfFundingCriticalDynamicMaxExtraBpsRaw)
    ? Math.max(0, Math.min(10000, selfFundingCriticalDynamicMaxExtraBpsRaw))
    : 3000;
  const failSafeEnabled = String(getNetworkScopedEnv('SELF_FUNDING_TRANSFER_FAILSAFE_ENABLED', options.networkOverride) || 'true').toLowerCase() !== 'false';
  const failSafeWindowMinRaw = parseInt(getNetworkScopedEnv('SELF_FUNDING_TRANSFER_FAILSAFE_WINDOW_MIN', options.networkOverride) || '30', 10);
  const failSafeWindowMin = Number.isFinite(failSafeWindowMinRaw) ? Math.max(5, failSafeWindowMinRaw) : 30;
  const failSafeFailureThresholdRaw = parseInt(getNetworkScopedEnv('SELF_FUNDING_TRANSFER_FAILSAFE_FAILURE_THRESHOLD', options.networkOverride) || '2', 10);
  const failSafeFailureThreshold = Number.isFinite(failSafeFailureThresholdRaw) ? Math.max(1, failSafeFailureThresholdRaw) : 2;
  const failSafeReinvestBpsRaw = parseInt(getNetworkScopedEnv('SELF_FUNDING_TRANSFER_FAILSAFE_REINVEST_BPS', options.networkOverride) || '9900', 10);
  const failSafeReinvestBps = Math.max(0, Math.min(9950, Number.isFinite(failSafeReinvestBpsRaw) ? failSafeReinvestBpsRaw : 9900));
  const distributionMinIntervalSecRaw = parseInt(getNetworkScopedEnv('DISTRIBUTION_MIN_INTERVAL_SEC', options.networkOverride) || '180', 10);
  const distributionMinIntervalSec = Number.isFinite(distributionMinIntervalSecRaw) ? Math.max(0, distributionMinIntervalSecRaw) : 180;
  const minOverflowEth = (getNetworkScopedEnv('DISTRIBUTION_MIN_OVERFLOW_ETH', options.networkOverride) || '0.00005').trim();
  const payoutEnforceBaseNativeOnly = String(getNetworkScopedEnv('PAYOUT_ENFORCE_BASE_NATIVE_ONLY', options.networkOverride) || 'true').toLowerCase() !== 'false';
  const payoutAllowToken = String(getNetworkScopedEnv('PAYOUT_ALLOW_TOKEN', options.networkOverride) || 'false').toLowerCase() === 'true';
  const minPayoutUsd = parseFiniteNumber(getNetworkScopedEnv('PAYOUT_MIN_USD', options.networkOverride) || process.env.MIN_PAYOUT_USD || '50', 50);

  const activeRpcSlug = resolveNetworkConfig(options.networkOverride || process.env.ALCHEMY_NETWORK).rpcSlug;
  if (payoutEnforceBaseNativeOnly && activeRpcSlug !== 'base-mainnet') {
    await logEvent('distribution_skipped_non_base_network', {
      wallet: w.address,
      botId,
      shardIndex,
      totalShards,
      activeNetwork: activeRpcSlug,
      requiredNetwork: 'base-mainnet',
    });
    return {};
  }

  const telemetryEventsRaw = await readLast(1200);
  const telemetryEvents = Array.isArray(telemetryEventsRaw) ? telemetryEventsRaw : [];
  const walletLower = w.address.toLowerCase();
  const failSafeCutoff = Date.now() - failSafeWindowMin * 60 * 1000;
  let recentTransferFailCount = 0;
  let lastSuccessfulTransferAt = 0;

  for (const event of telemetryEvents) {
    const ts = Date.parse(event?.time || '');
    if (!Number.isFinite(ts)) continue;

    const eventWallet = String(event?.payload?.wallet || '').toLowerCase();
    if (eventWallet && eventWallet !== walletLower) continue;

    if (event?.type === 'transfer' || event?.type === 'transfer_token') {
      if (ts > lastSuccessfulTransferAt) lastSuccessfulTransferAt = ts;
    }

    if ((event?.type === 'transfer_failed' || event?.type === 'transfer_token_failed') && ts >= failSafeCutoff) {
      recentTransferFailCount += 1;
    }
  }

  const baseSelfFundingCriticalWei = parseEther(selfFundingCriticalBalanceEth);
  const selfFundingCriticalExtraBps = selfFundingCriticalDynamicEnabled
    ? Math.min(selfFundingCriticalDynamicMaxExtraBps, recentTransferFailCount * selfFundingCriticalDynamicPerFailureBps)
    : 0;
  const effectiveSelfFundingCriticalWei = baseSelfFundingCriticalWei > BigInt(0)
    ? (baseSelfFundingCriticalWei * BigInt(10000 + selfFundingCriticalExtraBps)) / BigInt(10000)
    : BigInt(0);

  const resolveEffectiveReinvestBps = (nativeBalanceWei: bigint) => {
    if (failSafeEnabled && recentTransferFailCount >= failSafeFailureThreshold) {
      return failSafeReinvestBps;
    }

    if (selfFundingMode) {
      if (effectiveSelfFundingCriticalWei > BigInt(0) && nativeBalanceWei < effectiveSelfFundingCriticalWei) {
        return selfFundingCriticalReinvestBps;
      }

      const selfFundingTargetWei = parseEther(selfFundingBalanceTargetEth);
      if (selfFundingTargetWei > BigInt(0) && nativeBalanceWei < selfFundingTargetWei) {
        return selfFundingBelowTargetBps;
      }
      return selfFundingAboveTargetBps;
    }

    const treasuryTargetWei = parseEther(treasuryTargetEth);
    let effective = reinvestBps;
    if (treasuryTargetWei > BigInt(0) && nativeBalanceWei < treasuryTargetWei) {
      const deficit = treasuryTargetWei - nativeBalanceWei;
      const dynamicBoost = Number((deficit * BigInt(treasuryMaxReinvestBps - reinvestBps)) / treasuryTargetWei);
      effective = Math.min(treasuryMaxReinvestBps, reinvestBps + Math.max(0, dynamicBoost));
    }
    return effective;
  };

  if (distributionMinIntervalSec > 0 && lastSuccessfulTransferAt > 0) {
    const elapsedSec = Math.floor((Date.now() - lastSuccessfulTransferAt) / 1000);
    if (elapsedSec < distributionMinIntervalSec) {
      await logEvent('distribution_skipped_interval', {
        wallet: w.address,
        botId,
        shardIndex,
        totalShards,
        elapsedSec,
        minIntervalSec: distributionMinIntervalSec,
        lastSuccessfulTransferAt: new Date(lastSuccessfulTransferAt).toISOString(),
      });
      return {};
    }
  }

  // ensure revenue wallet has gas before attempting distribution
  try {
    const topupOk = await ensureRevenueWalletHasGas(w.address, options.networkOverride);
    await logEvent('gas_check', { wallet: w.address, topupOk, botId, shardIndex, totalShards });
    if (!topupOk) {
      await logEvent('distribution_skipped_no_gas', { wallet: w.address, botId, shardIndex, totalShards });
      return {};
    }
  } catch (err) {
    console.error('Gas top-up check failed', err);
    sendAlert(`Gas top-up check failed: ${err}`);
    await logEvent('gas_check_error', { wallet: w.address, error: String(err) });
    // continue -- distribution will likely fail if there's no gas
  }

  const payoutToken = payoutAllowToken ? process.env.PAYOUT_TOKEN_ADDRESS?.trim() : '';

  if (!payoutAllowToken && process.env.PAYOUT_TOKEN_ADDRESS?.trim()) {
    await logEvent('distribution_token_disabled_by_policy', {
      wallet: w.address,
      botId,
      shardIndex,
      totalShards,
      token: process.env.PAYOUT_TOKEN_ADDRESS.trim(),
    });
  }

  if (payoutToken) {
    const token = new Contract(
      payoutToken,
      [
        'function balanceOf(address) view returns (uint256)',
        'function transfer(address to, uint256 amount) returns (bool)',
      ],
      w
    );

    let tokenBalance: bigint;
    try {
      tokenBalance = await token.balanceOf(w.address);
    } catch (err) {
      console.error('Token balance read failed', err);
      sendAlert(`Token payout balance read failed (${payoutToken}): ${err}`);
      await logEvent('token_balance_error', { wallet: w.address, token: payoutToken, error: String(err) });
      return null;
    }

    if (tokenBalance <= BigInt(0)) return null;

    const nativeBalanceForPolicy = await provider.getBalance(w.address);
    const effectiveReinvestBps = resolveEffectiveReinvestBps(nativeBalanceForPolicy);
    const effectiveKeepBps = 10000 - effectiveReinvestBps;
    if (selfFundingMode && selfFundingPauseOverflowOnCritical && effectiveSelfFundingCriticalWei > BigInt(0) && nativeBalanceForPolicy < effectiveSelfFundingCriticalWei) {
      await logEvent('distribution_skipped_self_funding_critical', {
        wallet: w.address,
        botId,
        shardIndex,
        totalShards,
        token: payoutToken,
        balanceWei: nativeBalanceForPolicy.toString(),
        criticalBalanceWei: effectiveSelfFundingCriticalWei.toString(),
        baseCriticalBalanceWei: baseSelfFundingCriticalWei.toString(),
        criticalExtraBps: selfFundingCriticalExtraBps,
        recentTransferFailCount,
      });
      return {};
    }
    const distributableToken = (tokenBalance * BigInt(effectiveKeepBps)) / BigInt(10000);
    const minOverflowWei = parseEther(minOverflowEth);
    if (minOverflowWei > BigInt(0) && distributableToken < minOverflowWei) {
      await logEvent('distribution_skipped_overflow_batch', {
        wallet: w.address,
        botId,
        shardIndex,
        totalShards,
        token: payoutToken,
        distributableWei: distributableToken.toString(),
        minOverflowWei: minOverflowWei.toString(),
      });
      return {};
    }

    const tokenShare = distributableToken / BigInt(allRecipients.length);
    if (tokenShare <= BigInt(0)) return null;

    const minTokenShareWei = BigInt((process.env.MIN_PAYOUT_TOKEN_WEI || '0').trim());
    if (tokenShare < minTokenShareWei) {
      await logEvent('distribution_skipped_token_threshold', {
        wallet: w.address,
        token: payoutToken,
        tokenShare: tokenShare.toString(),
        minTokenShareWei: minTokenShareWei.toString(),
      });
      return null;
    }

    const nativeBalance = nativeBalanceForPolicy;
    const gasReserve = parseEther(gasReserveEth);
    if (nativeBalance < gasReserve) {
      await logEvent('distribution_skipped_token_gas_reserve', {
        wallet: w.address,
        botId,
        shardIndex,
        totalShards,
        token: payoutToken,
        nativeBalance: nativeBalance.toString(),
        gasReserve: gasReserve.toString(),
      });
      return {};
    }

    const tokenResults: {[address:string]: string | null} = {};
    await logEvent('distribution_start_token', {
      wallet: w.address,
      botId,
      shardIndex,
      totalShards,
      token: payoutToken,
      available: tokenBalance.toString(),
      distributableToken: distributableToken.toString(),
      baseReinvestBps: reinvestBps,
      effectiveReinvestBps,
      recipients,
    });

    for (const addr of recipients) {
      let success = false;
      let lastError: any = null;
      for (let attempt = 1; attempt <= maxRetries && !success; ++attempt) {
        try {
          const tx = await token.transfer(addr, tokenShare);
          await tx.wait();
          tokenResults[addr] = tx.hash;
          success = true;
          await logEvent('transfer_token', { to: addr, token: payoutToken, amount: tokenShare.toString(), txHash: tx.hash, wallet: w.address, botId, shardIndex, totalShards });
        } catch (e) {
          lastError = e;
          console.warn(`token transfer attempt ${attempt} failed for ${addr}`, e);
          await new Promise((r) => setTimeout(r, retryBaseMs * attempt));
        }
      }

      if (!success) {
        console.error('token distribute error to', addr, lastError);
        tokenResults[addr] = null;
        sendAlert(`Failed token payout to ${addr} after multiple attempts: ${lastError}`);
        await logEvent('transfer_token_failed', { to: addr, token: payoutToken, error: String(lastError), wallet: w.address, botId, shardIndex, totalShards });
      }
    }

    if (Object.values(tokenResults).some((v) => v === null)) {
      sendAlert('One or more token payouts failed during distribution');
    }

    return tokenResults;
  }

  const balanceWei = await provider.getBalance(w.address);
  if (balanceWei <= BigInt(0)) {
    // nothing to send, but that's not really an error
    return null;
  }

  const effectiveReinvestBps = resolveEffectiveReinvestBps(balanceWei);
  const effectiveKeepBps = 10000 - effectiveReinvestBps;
  if (selfFundingMode && selfFundingPauseOverflowOnCritical && effectiveSelfFundingCriticalWei > BigInt(0) && balanceWei < effectiveSelfFundingCriticalWei) {
    await logEvent('distribution_skipped_self_funding_critical', {
      wallet: w.address,
      botId,
      shardIndex,
      totalShards,
      balanceWei: balanceWei.toString(),
      criticalBalanceWei: effectiveSelfFundingCriticalWei.toString(),
      baseCriticalBalanceWei: baseSelfFundingCriticalWei.toString(),
      criticalExtraBps: selfFundingCriticalExtraBps,
      recentTransferFailCount,
    });
    return {};
  }

  const gasReserve = parseEther(gasReserveEth);
  if (balanceWei <= gasReserve) {
    await logEvent('distribution_skipped_native_gas_reserve', {
      wallet: w.address,
      botId,
      shardIndex,
      totalShards,
      balanceWei: balanceWei.toString(),
      gasReserveWei: gasReserve.toString(),
    });
    return {};
  }

  const availableAfterReserve = balanceWei - gasReserve;
  const distributable = (availableAfterReserve * BigInt(effectiveKeepBps)) / BigInt(10000);
  if (distributable <= BigInt(0)) return {};

  const minOverflowWei = parseEther(minOverflowEth);
  if (minOverflowWei > BigInt(0) && distributable < minOverflowWei) {
    await logEvent('distribution_skipped_overflow_batch', {
      wallet: w.address,
      botId,
      shardIndex,
      totalShards,
      distributableWei: distributable.toString(),
      minOverflowWei: minOverflowWei.toString(),
    });
    return {};
  }

  const share = distributable / BigInt(allRecipients.length);
  if (share <= BigInt(0)) return null;

  const minPayoutEth = (getNetworkScopedEnv('MIN_PAYOUT_ETH', options.networkOverride) || '0').trim();
  const configuredMinPayoutWei = parseEther(minPayoutEth);
  const { minWei: usdMinPayoutWei, ethUsd: ethUsdForUsdFloor, source: usdFloorSource } = await resolveUsdMinPayoutWei(minPayoutUsd);

  let dynamicGasGuardWei = BigInt(0);
  try {
    const feeData = await provider.getFeeData();
    const gasPriceWei = feeData.gasPrice ?? feeData.maxFeePerGas ?? BigInt(0);
    const transferGasUnits = BigInt(21000);
    const multiplierRaw = Number(getNetworkScopedEnv('MIN_PAYOUT_GAS_MULTIPLIER', options.networkOverride) || 3);
    const gasMultiplier = Number.isFinite(multiplierRaw) ? Math.max(1, Math.min(20, Math.round(multiplierRaw))) : 3;
    dynamicGasGuardWei = gasPriceWei * transferGasUnits * BigInt(gasMultiplier);

    const maxDynamicGasGuardRaw = (getNetworkScopedEnv('MIN_PAYOUT_MAX_DYNAMIC_GAS_GUARD_WEI', options.networkOverride) || '').trim();
    if (maxDynamicGasGuardRaw) {
      const maxDynamicGasGuardWei = BigInt(maxDynamicGasGuardRaw);
      if (maxDynamicGasGuardWei > BigInt(0) && dynamicGasGuardWei > maxDynamicGasGuardWei) {
        dynamicGasGuardWei = maxDynamicGasGuardWei;
      }
    }
  } catch {
    dynamicGasGuardWei = BigInt(0);
  }

  const effectiveMinPayoutWei = [configuredMinPayoutWei, dynamicGasGuardWei, usdMinPayoutWei]
    .reduce((max, value) => (value > max ? value : max), BigInt(0));

  if (share < effectiveMinPayoutWei) {
    await logEvent('distribution_skipped_threshold', {
      wallet: w.address,
      botId,
      shardIndex,
      totalShards,
      share: share.toString(),
      minPayoutWei: effectiveMinPayoutWei.toString(),
      configuredMinPayoutWei: configuredMinPayoutWei.toString(),
      dynamicGasGuardWei: dynamicGasGuardWei.toString(),
      minPayoutUsd,
      usdMinPayoutWei: usdMinPayoutWei.toString(),
      ethUsdForUsdFloor,
      usdFloorSource,
    });
    return null;
  }

  const results: {[address:string]: string | null} = {};

  await logEvent('distribution_start', {
    wallet: w.address,
    botId,
    shardIndex,
    totalShards,
    availableAfterReserve: availableAfterReserve.toString(),
    distributable: distributable.toString(),
    gasReserveWei: gasReserve.toString(),
    baseReinvestBps: reinvestBps,
    effectiveReinvestBps,
    baseSelfFundingCriticalWei: baseSelfFundingCriticalWei.toString(),
    effectiveSelfFundingCriticalWei: effectiveSelfFundingCriticalWei.toString(),
    selfFundingCriticalExtraBps,
    recentTransferFailCount,
    failSafeTriggered: failSafeEnabled && recentTransferFailCount >= failSafeFailureThreshold,
    recipients,
  });

  for (const addr of recipients) {
    let success = false;
    let lastError: any = null;
    for (let attempt = 1; attempt <= maxRetries && !success; ++attempt) {
      try {
        const tx = await w.sendTransaction({ to: addr, value: share });
        await tx.wait();
        results[addr] = tx.hash;
        success = true;
        await logEvent('transfer', { to: addr, amount: share.toString(), txHash: tx.hash, wallet: w.address, botId, shardIndex, totalShards });
      } catch (e) {
        lastError = e;
        console.warn(`attempt ${attempt} failed for ${addr}`, e);
        // small delay between attempts
        await new Promise((r) => setTimeout(r, retryBaseMs * attempt));
      }
    }
    if (!success) {
      console.error('distribute error to', addr, lastError);
      results[addr] = null;
      sendAlert(`Failed to send revenue share to ${addr} after multiple attempts: ${lastError}`);
      await logEvent('transfer_failed', { to: addr, error: String(lastError), wallet: w.address, botId, shardIndex, totalShards });
    }
  }

  // if any of the results are null, that's worth alerting
  if (Object.values(results).some((v) => v === null)) {
    sendAlert('One or more revenue transfers failed during distribution');
  }

  return results;
}

export async function getNFTs(address: string, networkOverride?: string) {
  const client = initAlchemy(networkOverride);
  if (!client) return null;
  try {
    const data = await client.nft.getNftsForOwner(address);
    return data.ownedNfts;
  } catch (err) {
    console.error("Alchemy error fetching NFTs", err);
    return null;
  }
}
