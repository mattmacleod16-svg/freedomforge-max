/**
 * Solana DeFi Client — SPL token operations, yield, and flash loans on Solana.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Provides:
 *  - SOL + SPL token balance queries
 *  - Jupiter aggregator swap routing
 *  - Marinade / Jito liquid staking
 *  - Kamino / Solend lending yield
 *  - Flash loan execution helpers
 *  - Transaction tracking
 *
 * Uses Solana JSON-RPC directly (zero SDK dependency).
 *
 * Required env:
 *   SOLANA_RPC_URL       — e.g. https://api.mainnet-beta.solana.com or Helius/Triton
 *   SOLANA_WALLET_ADDRESS — base58 public key
 *   SOLANA_PRIVATE_KEY    — base58 private key (for signing)
 */

'use strict';

const { createLogger } = require('../logger');
const log = createLogger('solana-defi');

let rio;
try { rio = require('../resilient-io'); } catch { rio = null; }

const REQUEST_TIMEOUT_MS = 15000;

// ─── Network Configuration ──────────────────────────────────────────────────

const RPC_URLS = {
  mainnet: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  devnet:  'https://api.devnet.solana.com',
};

// ─── Well-Known Programs & Tokens ───────────────────────────────────────────

const PROGRAMS = {
  tokenProgram:     'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  associatedToken:  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  systemProgram:    '11111111111111111111111111111111',
  jupiter:          'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',   // Jupiter V6
  marinade:         'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD',   // Marinade Staking
  jito:             'Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb',   // Jito Liquid Staking
  kamino:           'KLend2g3cP87ber41GBadaL5ZrLDU6MiHL3VnMA7B5k',   // Kamino Lending
  solend:           'So1endDq2YkqhipRh3WViPa8hFUKuZMz1C2j5CS955J',   // Solend
};

const KNOWN_TOKENS = {
  SOL:    'So11111111111111111111111111111111111111112',  // Wrapped SOL
  USDC:   'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT:   'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  mSOL:   'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',   // Marinade SOL
  jitoSOL:'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // Jito SOL
  BONK:   'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  JUP:    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  RAY:    '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
};

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

async function solFetch(url, options = {}) {
  if (rio) {
    return rio.circuitBreaker('solana', () =>
      rio.fetchJsonRetry(url, options, { timeoutMs: REQUEST_TIMEOUT_MS, retries: 2 }),
      { failureThreshold: 5, resetTimeMs: 120000 }
    );
  }
  return fetchJson(url, options);
}

// ─── Solana JSON-RPC Client ─────────────────────────────────────────────────

class SolanaClient {
  constructor(opts = {}) {
    const network = (opts.network || process.env.SOLANA_NETWORK || 'mainnet').toLowerCase();
    this.rpcUrl = opts.rpcUrl || RPC_URLS[network] || RPC_URLS.mainnet;
    this.walletAddress = opts.walletAddress || process.env.SOLANA_WALLET_ADDRESS || '';
    this.networkName = network;
    this._rpcId = 0;

    log.info('Solana client initialized', { network, rpc: this.rpcUrl.replace(/\/\/.*@/, '//***@') });
  }

  /** Execute JSON-RPC call */
  async rpc(method, params = []) {
    this._rpcId += 1;
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: this._rpcId,
      method,
      params,
    });

    const result = await solFetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (result.error) {
      throw new Error(`RPC error ${result.error.code}: ${result.error.message}`);
    }
    return result.result;
  }

  // ─── Account / Balance ──────────────────────────────────────────────

  /** Get SOL balance in lamports and human-readable */
  async getBalance() {
    const result = await this.rpc('getBalance', [this.walletAddress]);
    const lamports = result?.value || 0;
    return {
      lamports,
      sol: lamports / 1e9,
    };
  }

  /** Get SPL token accounts */
  async getTokenAccounts() {
    const result = await this.rpc('getTokenAccountsByOwner', [
      this.walletAddress,
      { programId: PROGRAMS.tokenProgram },
      { encoding: 'jsonParsed' },
    ]);

    return (result?.value || []).map(acct => {
      const info = acct.account.data.parsed?.info;
      return {
        address: acct.pubkey,
        mint: info?.mint,
        amount: info?.tokenAmount?.uiAmount || 0,
        decimals: info?.tokenAmount?.decimals || 0,
        rawAmount: info?.tokenAmount?.amount || '0',
      };
    });
  }

  /** Get portfolio summary */
  async getPortfolioValue() {
    const [balance, tokens] = await Promise.all([
      this.getBalance(),
      this.getTokenAccounts(),
    ]);

    // Get SOL price from Jupiter price API
    let solPrice = 0;
    try {
      const priceData = await solFetch(
        `https://api.jup.ag/price/v2?ids=${KNOWN_TOKENS.SOL}`
      );
      solPrice = Number(priceData?.data?.[KNOWN_TOKENS.SOL]?.price || 0);
    } catch { /* ignore */ }

    const solValueUSD = balance.sol * solPrice;

    // Map token mints to known tickers
    const mintToTicker = Object.fromEntries(
      Object.entries(KNOWN_TOKENS).map(([k, v]) => [v, k])
    );

    const tokenDetails = tokens.map(t => ({
      ...t,
      ticker: mintToTicker[t.mint] || t.mint?.slice(0, 8),
    }));

    return {
      sol: { balance: balance.sol, price: solPrice, valueUSD: solValueUSD },
      tokens: tokenDetails,
      totalUSD: solValueUSD, // tokens need price oracle for full value
    };
  }

  // ─── Jupiter Swap Routing ───────────────────────────────────────────

  /** Get Jupiter swap quote */
  async getSwapQuote(inputMint, outputMint, amountLamports, slippageBps = 50) {
    const url = `https://quote-api.jup.ag/v6/quote?` +
      `inputMint=${inputMint}&outputMint=${outputMint}` +
      `&amount=${amountLamports}&slippageBps=${slippageBps}`;

    return solFetch(url);
  }

  /** Get Jupiter swap transaction */
  async getSwapTransaction(quoteResponse) {
    return solFetch('https://quote-api.jup.ag/v6/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: this.walletAddress,
        wrapAndUnwrapSol: true,
      }),
    });
  }

  // ─── Staking (Marinade / Jito) ──────────────────────────────────────

  /** Get mSOL/jitoSOL balance (liquid staking positions) */
  async getLiquidStakingPositions() {
    const tokens = await this.getTokenAccounts();
    return {
      marinade: tokens.find(t => t.mint === KNOWN_TOKENS.mSOL) || null,
      jito: tokens.find(t => t.mint === KNOWN_TOKENS.jitoSOL) || null,
    };
  }

  // ─── Transaction History ────────────────────────────────────────────

  /** Get recent transaction signatures */
  async getRecentTransactions(limit = 20) {
    return this.rpc('getSignaturesForAddress', [
      this.walletAddress,
      { limit },
    ]);
  }

  /** Get transaction details */
  async getTransaction(signature) {
    return this.rpc('getTransaction', [
      signature,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
    ]);
  }

  // ─── Network Info ───────────────────────────────────────────────────

  /** Get recent slot and block time */
  async getSlotInfo() {
    const slot = await this.rpc('getSlot');
    const blockTime = await this.rpc('getBlockTime', [slot]);
    return { slot, blockTime };
  }

  /** Get current epoch info */
  async getEpochInfo() {
    return this.rpc('getEpochInfo');
  }

  // ─── Health Check ─────────────────────────────────────────────────

  async getHealth() {
    try {
      const [balance, slot] = await Promise.all([
        this.getBalance().catch(() => null),
        this.rpc('getHealth').catch(() => 'unknown'),
      ]);

      return {
        status: balance ? 'healthy' : 'degraded',
        network: this.networkName,
        address: this.walletAddress ? `${this.walletAddress.slice(0, 6)}...` : 'not configured',
        balanceSOL: balance?.sol ?? null,
        rpcHealth: slot,
      };
    } catch (err) {
      return { status: 'error', error: err.message };
    }
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

let _instance = null;

function getSolanaClient(opts = {}) {
  if (!_instance) _instance = new SolanaClient(opts);
  return _instance;
}

module.exports = {
  SolanaClient,
  getSolanaClient,
  PROGRAMS,
  KNOWN_TOKENS,
};
