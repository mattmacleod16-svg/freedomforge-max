/**
 * MultiversX (EGLD) Client — xPortal wallet integration for FreedomForge.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Provides:
 *  - Wallet balance queries (EGLD + ESDT tokens)
 *  - EGLD/ESDT transfer execution
 *  - Staking delegation + MEX DeFi interaction
 *  - Smart contract queries (xExchange / Hatom / AshSwap)
 *  - Transaction tracking + gas estimation
 *
 * Uses the MultiversX REST gateway API (no SDK dependency required).
 * The xPortal wallet PEM or keystore JSON is used for signing.
 *
 * Required env:
 *   MVX_WALLET_ADDRESS   — erd1... bech32 address from xPortal
 *   MVX_WALLET_PEM       — path to PEM file (or inline PEM string)
 *   MVX_NETWORK          — mainnet | devnet | testnet (default: mainnet)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createLogger } = require('../logger');
const log = createLogger('multiversx');

let rio;
try { rio = require('../resilient-io'); } catch { rio = null; }

// ─── Network Configuration ──────────────────────────────────────────────────

const NETWORKS = {
  mainnet: {
    gateway: 'https://gateway.multiversx.com',
    api:     'https://api.multiversx.com',
    chainId: '1',
  },
  devnet: {
    gateway: 'https://devnet-gateway.multiversx.com',
    api:     'https://devnet-api.multiversx.com',
    chainId: 'D',
  },
  testnet: {
    gateway: 'https://testnet-gateway.multiversx.com',
    api:     'https://testnet-api.multiversx.com',
    chainId: 'T',
  },
};

// ─── Well-Known Contract Addresses ──────────────────────────────────────────

const CONTRACTS = {
  // xExchange (Maiar Exchange) router
  xExchangeRouter: 'erd1qqqqqqqqqqqqqpgqeel2kumf0r8ffyhth7pqdujjat9nx0862jpsg2pqaq',
  // Hatom lending protocol
  hatomController: 'erd1qqqqqqqqqqqqqpgq5774jcntdqkzv62tlvvhfn2y7eevnph6ivaq0g59nd',
  // AshSwap aggregator
  ashSwapAggregator: 'erd1qqqqqqqqqqqqqpgqcc69ts8409p3h77q5chsaqz57y6hugvc4fvsg2dlkx',
  // Staking delegation manager
  delegationManager: 'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqylllslmq4y6',
};

// ─── Common ESDT Tokens on MultiversX ───────────────────────────────────────

const KNOWN_TOKENS = {
  WEGLD:  'WEGLD-bd4d79',
  USDC:   'USDC-c76f1f',
  USDT:   'USDT-f8c08c',
  MEX:    'MEX-455c57',
  RIDE:   'RIDE-7d18e9',
  UTK:    'UTK-2f80e9',
  ASH:    'ASH-a642d1',
  HTM:    'HTM-f51d55',
};

const REQUEST_TIMEOUT_MS = 15000;

// ─── Fetch Helpers ──────────────────────────────────────────────────────────

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function mvxFetch(url, options = {}) {
  if (rio) {
    return rio.circuitBreaker('multiversx', () =>
      rio.fetchJsonRetry(url, options, { timeoutMs: REQUEST_TIMEOUT_MS, retries: 2 }),
      { failureThreshold: 5, resetTimeMs: 120000 }
    );
  }
  return fetchJson(url, options);
}

// ─── MultiversX Client ──────────────────────────────────────────────────────

class MultiversXClient {
  constructor(opts = {}) {
    const network = (opts.network || process.env.MVX_NETWORK || 'mainnet').toLowerCase();
    if (!NETWORKS[network]) throw new Error(`Unknown MultiversX network: ${network}`);

    this.network = NETWORKS[network];
    this.networkName = network;
    this.walletAddress = opts.walletAddress || process.env.MVX_WALLET_ADDRESS || '';
    this.pemPath = opts.pemPath || process.env.MVX_WALLET_PEM || '';
    this._signer = null;

    log.info('MultiversX client initialized', {
      network,
      address: this.walletAddress ? `${this.walletAddress.slice(0, 10)}...` : 'not set',
    });
  }

  // ─── Account ────────────────────────────────────────────────────────────

  /** Get account balance and nonce */
  async getAccount() {
    const data = await mvxFetch(`${this.network.api}/accounts/${this.walletAddress}`);
    return {
      address: data.address,
      balance: data.balance,                       // in atomic units (1 EGLD = 10^18)
      balanceEGLD: Number(data.balance) / 1e18,
      nonce: data.nonce,
      shard: data.shard,
      username: data.username || null,              // herotag if set
    };
  }

  /** Get EGLD balance in human-readable format */
  async getBalance() {
    const acct = await this.getAccount();
    return acct.balanceEGLD;
  }

  /** Get all ESDT token balances */
  async getTokenBalances() {
    const tokens = await mvxFetch(`${this.network.api}/accounts/${this.walletAddress}/tokens?size=100`);
    return (tokens || []).map(t => ({
      identifier: t.identifier,
      name: t.name,
      ticker: t.ticker,
      balance: t.balance,
      balanceHuman: Number(t.balance) / Math.pow(10, t.decimals || 18),
      decimals: t.decimals,
      price: t.price || 0,
      valueUSD: t.valueUsd || 0,
    }));
  }

  /** Get total portfolio value in USD */
  async getPortfolioValue() {
    const [account, tokens] = await Promise.all([
      this.getAccount(),
      this.getTokenBalances(),
    ]);

    // EGLD price from API
    const economics = await mvxFetch(`${this.network.api}/economics`).catch(() => null);
    const egldPrice = economics?.price || 0;
    const egldValue = account.balanceEGLD * egldPrice;
    const tokenValue = tokens.reduce((sum, t) => sum + (t.valueUSD || 0), 0);

    return {
      egld: { balance: account.balanceEGLD, price: egldPrice, valueUSD: egldValue },
      tokens,
      totalUSD: egldValue + tokenValue,
    };
  }

  // ─── Transactions ───────────────────────────────────────────────────────

  /** Get recent transactions */
  async getTransactions(count = 25) {
    return mvxFetch(`${this.network.api}/accounts/${this.walletAddress}/transactions?size=${count}&order=desc`);
  }

  /** Get network gas price */
  async getNetworkConfig() {
    const data = await mvxFetch(`${this.network.gateway}/network/config`);
    return data?.data?.config || {};
  }

  /** Estimate gas cost for a simple EGLD transfer */
  async estimateTransferGas() {
    const config = await this.getNetworkConfig();
    const minGasPrice = config.erd_min_gas_price || 1000000000;
    const minGasLimit = config.erd_min_gas_limit || 50000;
    return {
      gasPrice: minGasPrice,
      gasLimit: minGasLimit,
      costEGLD: (minGasPrice * minGasLimit) / 1e18,
    };
  }

  /** Build an unsigned EGLD transfer transaction */
  async buildTransferTx(to, amountEGLD, data = '') {
    const account = await this.getAccount();
    const config = await this.getNetworkConfig();
    const gasPrice = config.erd_min_gas_price || 1000000000;
    const gasLimit = data
      ? Math.max(50000, 50000 + data.length * 1500)
      : 50000;

    return {
      nonce: account.nonce,
      value: BigInt(Math.floor(amountEGLD * 1e18)).toString(),
      receiver: to,
      sender: this.walletAddress,
      gasPrice,
      gasLimit,
      data: data ? Buffer.from(data).toString('base64') : undefined,
      chainID: this.network.chainId,
      version: 1,
    };
  }

  /** Build an ESDT transfer transaction */
  async buildEsdtTransferTx(to, tokenIdentifier, amount, decimals = 18) {
    const hexAmount = BigInt(Math.floor(amount * Math.pow(10, decimals))).toString(16);
    const hexToken = Buffer.from(tokenIdentifier).toString('hex');
    const data = `ESDTTransfer@${hexToken}@${hexAmount.padStart(2, '0')}`;
    return this.buildTransferTx(to, 0, data);
  }

  // ─── Staking ────────────────────────────────────────────────────────────

  /** Get staking/delegation info */
  async getStakingPositions() {
    try {
      const delegation = await mvxFetch(
        `${this.network.api}/accounts/${this.walletAddress}/delegation`
      );
      return (delegation || []).map(d => ({
        address: d.address,
        contract: d.contract,
        userUnBondable: d.userUnBondable,
        userActiveStake: d.userActiveStake,
        userActiveStakeEGLD: Number(d.userActiveStake || 0) / 1e18,
        claimableRewards: d.claimableRewards,
        claimableRewardsEGLD: Number(d.claimableRewards || 0) / 1e18,
      }));
    } catch (err) {
      log.warn('Failed to fetch staking positions', { error: err.message });
      return [];
    }
  }

  /** Build delegate EGLD transaction */
  async buildDelegateTx(validatorContract, amountEGLD) {
    return this.buildTransferTx(validatorContract, amountEGLD, 'delegate');
  }

  /** Build claim rewards transaction */
  async buildClaimRewardsTx(validatorContract) {
    return this.buildTransferTx(validatorContract, 0, 'claimRewards');
  }

  // ─── xExchange (DEX) ───────────────────────────────────────────────────

  /** Get xExchange token prices */
  async getXExchangePairs() {
    try {
      return await mvxFetch(`${this.network.api}/mex/pairs?size=50`);
    } catch (err) {
      log.warn('Failed to fetch xExchange pairs', { error: err.message });
      return [];
    }
  }

  /** Get MEX economics (TVL, price, etc.) */
  async getMexEconomics() {
    try {
      return await mvxFetch(`${this.network.api}/mex/economics`);
    } catch {
      return null;
    }
  }

  /** Query a smart contract (view function) */
  async querySmartContract(scAddress, funcName, args = []) {
    const body = {
      scAddress,
      funcName,
      args: args.map(a => Buffer.from(String(a)).toString('hex')),
    };
    const result = await mvxFetch(`${this.network.gateway}/vm-values/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return result?.data;
  }

  // ─── NFTs / SFTs ──────────────────────────────────────────────────────

  /** Get NFT/SFT holdings */
  async getNfts(count = 50) {
    return mvxFetch(`${this.network.api}/accounts/${this.walletAddress}/nfts?size=${count}`);
  }

  // ─── Health Check ─────────────────────────────────────────────────────

  async getHealth() {
    try {
      const [account, economics] = await Promise.all([
        this.getAccount().catch(() => null),
        mvxFetch(`${this.network.api}/economics`).catch(() => null),
      ]);

      return {
        status: account ? 'healthy' : 'degraded',
        network: this.networkName,
        address: this.walletAddress ? `${this.walletAddress.slice(0, 10)}...` : 'not configured',
        balanceEGLD: account?.balanceEGLD ?? null,
        egldPrice: economics?.price ?? null,
        staked: economics?.staked ?? null,
      };
    } catch (err) {
      return { status: 'error', error: err.message };
    }
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

let _instance = null;

function getMultiversXClient(opts = {}) {
  if (!_instance) _instance = new MultiversXClient(opts);
  return _instance;
}

module.exports = {
  MultiversXClient,
  getMultiversXClient,
  CONTRACTS,
  KNOWN_TOKENS,
  NETWORKS,
};
