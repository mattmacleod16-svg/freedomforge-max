/**
 * Alchemy API Connector
 * Provides helper functions to interact with Alchemy web3/API services
 */

import { Alchemy, Network } from "@alch/alchemy-sdk";
import { Wallet, parseEther, JsonRpcProvider, Contract } from "ethers";
import { getAuthorizedRecipients } from './recipients';
import { sendAlert } from '../alerts';
import { ensureRevenueWalletHasGas } from '../gasTopup';
import { logEvent } from '../logger';

type DistributionOptions = {
  shardIndex?: number;
  totalShards?: number;
  botId?: string;
};

let alchemy: any | null = null;
let rpcProvider: JsonRpcProvider | null = null;

function resolveNetworkConfig(raw?: string): { sdkNetwork: any; rpcSlug: string } {
  const value = (raw || 'eth-mainnet').toLowerCase();

  if (value === 'base' || value === 'base-mainnet') {
    return { sdkNetwork: Network.BASE_MAINNET, rpcSlug: 'base-mainnet' };
  }

  if (value === 'mainnet' || value === 'eth-mainnet' || value === 'ethereum') {
    return { sdkNetwork: Network.ETH_MAINNET, rpcSlug: 'eth-mainnet' };
  }

  return { sdkNetwork: raw || Network.ETH_MAINNET, rpcSlug: raw || 'eth-mainnet' };
}

function getEthersNetwork() {
  const network = resolveNetworkConfig(process.env.ALCHEMY_NETWORK).rpcSlug;
  if (network === 'base-mainnet' || network === 'base') {
    return { chainId: 8453, name: 'base' };
  }
  return { chainId: 1, name: 'mainnet' };
}

function getAlchemyRpcUrl(): string | null {
  const apiKey = process.env.ALCHEMY_API_KEY;
  const network = resolveNetworkConfig(process.env.ALCHEMY_NETWORK).rpcSlug;
  if (!apiKey) return null;
  return `https://${network}.g.alchemy.com/v2/${apiKey}`;
}

export function getRpcProvider(): JsonRpcProvider | null {
  if (rpcProvider) return rpcProvider;
  const rpcUrl = getAlchemyRpcUrl();
  if (!rpcUrl) return null;
  rpcProvider = new JsonRpcProvider(rpcUrl, getEthersNetwork(), { staticNetwork: true });
  return rpcProvider;
}

export function initAlchemy() {
  if (alchemy) return alchemy;

  const apiKey = process.env.ALCHEMY_API_KEY;
  const network: any = resolveNetworkConfig(process.env.ALCHEMY_NETWORK).sdkNetwork;

  if (!apiKey) {
    console.warn("Alchemy API key not set, blockchain features disabled");
    return null;
  }

  alchemy = new Alchemy({ apiKey, network });
  return alchemy;
}

export async function getLatestBlock(): Promise<number | null> {
  const client = initAlchemy();
  if (!client) return null;
  try {
    const block = await client.core.getBlockNumber();
    return block;
  } catch (err) {
    console.error("Alchemy error retrieving block number", err);
    return null;
  }
}

export async function getBalance(address: string): Promise<string | null> {
  const client = initAlchemy();
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
export async function getTokenBalances(address: string, tokens?: string[]): Promise<{[token:string]: {balance: string | null; symbol?: string; decimals?: number}} | null> {
  const client = initAlchemy();
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

let revenueWallet: Wallet | null = null;
let generatedWalletAddress: string | null = null;
let missingWalletConfigAlerted = false;

export function getGeneratedWalletAddress(): string | null {
  return generatedWalletAddress;
}

export function initRevenueWallet(): Wallet | null {
  if (revenueWallet) return revenueWallet;
  let privateKey = process.env.WALLET_PRIVATE_KEY;
  const requestedAutoGenerate = String(process.env.WALLET_AUTO_GENERATE || 'false').toLowerCase() === 'true';
  const autoGenerateWallet = requestedAutoGenerate && process.env.NODE_ENV !== 'production';

  if (!privateKey) {
    if (!autoGenerateWallet) {
      if (!missingWalletConfigAlerted) {
        const msg = requestedAutoGenerate && process.env.NODE_ENV === 'production'
          ? 'WALLET_AUTO_GENERATE is ignored in production; set WALLET_PRIVATE_KEY for a stable production wallet.'
          : 'No WALLET_PRIVATE_KEY configured; revenue wallet disabled. Set WALLET_PRIVATE_KEY to use one stable address. Set WALLET_AUTO_GENERATE=true only for local testing.';
        console.error(msg);
        sendAlert(msg);
        missingWalletConfigAlerted = true;
      }
      return null;
    }

    const generated = Wallet.createRandom();
    privateKey = generated.privateKey;
    generatedWalletAddress = generated.address;
    console.warn("🤖 WALLET_AUTO_GENERATE=true and no WALLET_PRIVATE_KEY set; generated temporary wallet:", generated.address);
    console.warn("⚠️ This wallet is ephemeral and should only be used for local testing");
    sendAlert(`🤖 Temporary wallet generated (WALLET_AUTO_GENERATE=true): ${generated.address} — set WALLET_PRIVATE_KEY for a stable production address`);
  }
  const provider = getRpcProvider();
  if (!provider) return null;
  revenueWallet = new Wallet(privateKey, provider);
  generatedWalletAddress = revenueWallet.address;
  return revenueWallet;
}

export function createRandomWallet(): { address: string; privateKey: string } {
  const w = Wallet.createRandom();
  return { address: w.address, privateKey: w.privateKey };
}

export async function getRevenueWalletBalance(): Promise<string | null> {
  const w = initRevenueWallet();
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

export async function withdrawFromRevenue(to: string, amountEther: string): Promise<string | null> {
  const w = initRevenueWallet();
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

  const w = initRevenueWallet();
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
  const alertOnSuccess = String(process.env.ALERT_ON_SUCCESS || 'false').toLowerCase() === 'true';
  const gasReserveEth = (process.env.GAS_RESERVE_ETH || process.env.SELF_SUSTAIN_RESERVE_ETH || '0.02').trim();
  const reinvestBpsRaw = parseInt(process.env.SELF_SUSTAIN_REINVEST_BPS || '2000', 10);
  const reinvestBps = Math.max(0, Math.min(9000, Number.isFinite(reinvestBpsRaw) ? reinvestBpsRaw : 2000));
  const treasuryTargetEth = (process.env.TREASURY_TARGET_ETH || '0.03').trim();
  const treasuryMaxReinvestBpsRaw = parseInt(process.env.TREASURY_MAX_REINVEST_BPS || '9000', 10);
  const treasuryMaxReinvestBps = Math.max(reinvestBps, Math.min(9000, Number.isFinite(treasuryMaxReinvestBpsRaw) ? treasuryMaxReinvestBpsRaw : 9000));

  // ensure revenue wallet has gas before attempting distribution
  try {
    const topupOk = await ensureRevenueWalletHasGas(w.address);
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

  const payoutToken = process.env.PAYOUT_TOKEN_ADDRESS?.trim();

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
    const treasuryTargetWei = parseEther(treasuryTargetEth);
    let effectiveReinvestBps = reinvestBps;
    if (treasuryTargetWei > BigInt(0) && nativeBalanceForPolicy < treasuryTargetWei) {
      const deficit = treasuryTargetWei - nativeBalanceForPolicy;
      const dynamicBoost = Number((deficit * BigInt(treasuryMaxReinvestBps - reinvestBps)) / treasuryTargetWei);
      effectiveReinvestBps = Math.min(treasuryMaxReinvestBps, reinvestBps + Math.max(0, dynamicBoost));
    }
    const effectiveKeepBps = 10000 - effectiveReinvestBps;
    const distributableToken = (tokenBalance * BigInt(effectiveKeepBps)) / BigInt(10000);

    const tokenShare = distributableToken / BigInt(recipients.length);
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
          if (alertOnSuccess) {
            sendAlert(`Token payout sent to ${addr}: ${tokenShare.toString()} wei of ${payoutToken} (tx ${tx.hash})`);
          }
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

  const treasuryTargetWei = parseEther(treasuryTargetEth);
  let effectiveReinvestBps = reinvestBps;
  if (treasuryTargetWei > BigInt(0) && balanceWei < treasuryTargetWei) {
    const deficit = treasuryTargetWei - balanceWei;
    const dynamicBoost = Number((deficit * BigInt(treasuryMaxReinvestBps - reinvestBps)) / treasuryTargetWei);
    effectiveReinvestBps = Math.min(treasuryMaxReinvestBps, reinvestBps + Math.max(0, dynamicBoost));
  }
  const effectiveKeepBps = 10000 - effectiveReinvestBps;

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

  const share = distributable / BigInt(recipients.length);
  if (share <= BigInt(0)) return null;

  const minPayoutEth = (process.env.MIN_PAYOUT_ETH || '0').trim();
  const minPayoutWei = parseEther(minPayoutEth);
  if (share < minPayoutWei) {
    await logEvent('distribution_skipped_threshold', {
      wallet: w.address,
      botId,
      shardIndex,
      totalShards,
      share: share.toString(),
      minPayoutWei: minPayoutWei.toString(),
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
        if (alertOnSuccess) {
          sendAlert(`Revenue payout sent to ${addr}: ${share.toString()} wei native ETH (tx ${tx.hash})`);
        }
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

export async function getNFTs(address: string) {
  const client = initAlchemy();
  if (!client) return null;
  try {
    const data = await client.nft.getNftsForOwner(address);
    return data.ownedNfts;
  } catch (err) {
    console.error("Alchemy error fetching NFTs", err);
    return null;
  }
}
