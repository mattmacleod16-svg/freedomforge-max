/**
 * Multi-Chain DeFi Engine — Unified yield, flash loans, and liquidity across chains.
 * ═══════════════════════════════════════════════════════════════════════════════════
 *
 * Orchestrates DeFi strategies across:
 *  - Ethereum (Aave V3, Compound V3, Uniswap V3)
 *  - Base L2 (Aave V3, Compound V3, Aerodrome)
 *  - Solana (Kamino, Marinade, Jupiter)
 *  - MultiversX (xExchange, Hatom, AshSwap)
 *
 * Provides:
 *  - Yield comparison across chains/protocols
 *  - Flash loan opportunity detection
 *  - Liquidity provision management
 *  - Cross-chain rebalancing signals
 *  - Unified portfolio view
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../logger');
const log = createLogger('defi-multichain');

let rio;
try { rio = require('../resilient-io'); } catch { rio = null; }

// ─── Chain Adapters ─────────────────────────────────────────────────────────

let solanaClient;
try { ({ getSolanaClient: solanaClient } = require('./solana-client')); } catch { solanaClient = null; }

let mvxClient;
try { ({ getMultiversXClient: mvxClient } = require('../multiversx/client')); } catch { mvxClient = null; }

// ─── Protocol Definitions ───────────────────────────────────────────────────

const PROTOCOLS = {
  // Ethereum Mainnet
  'eth:aave-v3': {
    chain: 'ethereum', protocol: 'Aave V3', type: 'lending',
    poolAddress: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    assets: ['USDC', 'USDT', 'DAI', 'WETH', 'WBTC'],
    apySource: 'https://aave-api-v2.aave.com/data/markets-data',
  },
  'eth:compound-v3': {
    chain: 'ethereum', protocol: 'Compound V3', type: 'lending',
    cometAddress: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
    assets: ['USDC'],
    apySource: 'https://api.compound.finance/api/v2/ctoken',
  },
  // Base L2
  'base:aave-v3': {
    chain: 'base', protocol: 'Aave V3 (Base)', type: 'lending',
    poolAddress: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    assets: ['USDC', 'WETH', 'cbETH'],
  },
  'base:compound-v3': {
    chain: 'base', protocol: 'Compound V3 (Base)', type: 'lending',
    cometAddress: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
    assets: ['USDC'],
  },
  'base:aerodrome': {
    chain: 'base', protocol: 'Aerodrome', type: 'dex',
    routerAddress: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
    assets: ['WETH/USDC', 'cbETH/WETH'],
  },
  // Solana
  'sol:marinade': {
    chain: 'solana', protocol: 'Marinade', type: 'liquid-staking',
    apyEstimate: 7.2,
  },
  'sol:jito': {
    chain: 'solana', protocol: 'Jito', type: 'liquid-staking',
    apyEstimate: 7.8,
  },
  'sol:kamino': {
    chain: 'solana', protocol: 'Kamino', type: 'lending',
    assets: ['SOL', 'USDC', 'mSOL'],
  },
  // MultiversX
  'mvx:staking': {
    chain: 'multiversx', protocol: 'EGLD Staking', type: 'staking',
    apyEstimate: 8.0,
  },
  'mvx:xexchange': {
    chain: 'multiversx', protocol: 'xExchange', type: 'dex',
    assets: ['EGLD/USDC', 'EGLD/MEX'],
  },
  'mvx:hatom': {
    chain: 'multiversx', protocol: 'Hatom', type: 'lending',
    assets: ['EGLD', 'USDC', 'USDT'],
  },
};

// ─── Flash Loan Providers ───────────────────────────────────────────────────

const FLASH_LOAN_PROVIDERS = {
  'eth:aave-v3': {
    chain: 'ethereum',
    provider: 'Aave V3',
    maxLoanUSD: 50000000,
    fee: 0.0009, // 0.09%
    poolAddress: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  },
  'base:aave-v3': {
    chain: 'base',
    provider: 'Aave V3 (Base)',
    maxLoanUSD: 10000000,
    fee: 0.0009,
    poolAddress: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  },
  'sol:kamino': {
    chain: 'solana',
    provider: 'Kamino',
    maxLoanUSD: 5000000,
    fee: 0.001,  // 0.1%
  },
};

// ─── Yield APY Fetching ─────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 15000;

async function _fetch(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const text = await res.text();
    try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch DeFi Llama APY data for a given protocol pool */
async function fetchDefiLlamaYield(pool) {
  try {
    const data = await _fetch(`https://yields.llama.fi/pools`);
    if (!data?.data) return null;

    // Match by protocol name loosely
    const matches = data.data.filter(p =>
      p.project?.toLowerCase().includes(pool.toLowerCase()) ||
      p.pool?.toLowerCase().includes(pool.toLowerCase())
    );

    return matches.slice(0, 10).map(m => ({
      pool: m.pool,
      project: m.project,
      chain: m.chain,
      symbol: m.symbol,
      apy: m.apy,
      tvlUsd: m.tvlUsd,
      apyBase: m.apyBase,
      apyReward: m.apyReward,
    }));
  } catch (err) {
    log.warn('DefiLlama fetch failed', { error: err.message });
    return null;
  }
}

// ─── Multi-Chain DeFi Engine ────────────────────────────────────────────────

class MultiChainDeFiEngine {
  constructor() {
    this.protocols = PROTOCOLS;
    this.flashLoanProviders = FLASH_LOAN_PROVIDERS;
    this._yieldCache = {};
    this._cacheExpiry = 0;
  }

  /** Get all available protocols */
  getProtocols() {
    return Object.entries(this.protocols).map(([id, p]) => ({
      id,
      ...p,
    }));
  }

  /** Fetch yield data from DefiLlama for all protocols */
  async fetchYields(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this._cacheExpiry > now && Object.keys(this._yieldCache).length > 0) {
      return this._yieldCache;
    }

    log.info('Fetching multi-chain yield data...');

    const yields = {};

    // Fetch from DefiLlama
    try {
      const data = await _fetch('https://yields.llama.fi/pools');
      if (data?.data) {
        const relevant = data.data.filter(p =>
          ['aave-v3', 'compound-v3', 'marinade-finance', 'jito', 'kamino',
           'aerodrome', 'hatom-lending'].includes(p.project)
        );

        for (const pool of relevant) {
          const key = `${pool.chain}:${pool.project}:${pool.symbol}`;
          yields[key] = {
            protocol: pool.project,
            chain: pool.chain,
            symbol: pool.symbol,
            apy: pool.apy,
            apyBase: pool.apyBase,
            apyReward: pool.apyReward,
            tvlUsd: pool.tvlUsd,
          };
        }
      }
    } catch (err) {
      log.warn('DefiLlama yield fetch failed', { error: err.message });
    }

    this._yieldCache = yields;
    this._cacheExpiry = now + 30 * 60 * 1000; // 30 min cache

    log.info('Yield data loaded', { protocols: Object.keys(yields).length });
    return yields;
  }

  /** Get highest-yield opportunities sorted by APY */
  async getBestYields(minAPY = 2, maxResults = 20) {
    const yields = await this.fetchYields();
    return Object.values(yields)
      .filter(y => y.apy >= minAPY && y.tvlUsd > 100000)
      .sort((a, b) => b.apy - a.apy)
      .slice(0, maxResults);
  }

  /** Detect flash loan arbitrage opportunities (signal-only, no execution) */
  async detectFlashLoanOpportunities() {
    const opportunities = [];

    // Compare yields across chains for same asset
    const yields = await this.fetchYields();
    const bySymbol = {};

    for (const y of Object.values(yields)) {
      const sym = y.symbol?.split('-')[0] || y.symbol;
      if (!bySymbol[sym]) bySymbol[sym] = [];
      bySymbol[sym].push(y);
    }

    for (const [symbol, pools] of Object.entries(bySymbol)) {
      if (pools.length < 2) continue;
      pools.sort((a, b) => b.apy - a.apy);

      const best = pools[0];
      const worst = pools[pools.length - 1];
      const spread = best.apy - worst.apy;

      if (spread > 2.0) { // 2% spread minimum
        opportunities.push({
          symbol,
          strategy: 'yield-arb',
          bestPool: { chain: best.chain, protocol: best.protocol, apy: best.apy },
          worstPool: { chain: worst.chain, protocol: worst.protocol, apy: worst.apy },
          spreadPct: spread,
        });
      }
    }

    return opportunities;
  }

  /** Get cross-chain portfolio summary */
  async getPortfolioSummary() {
    const summary = {
      chains: {},
      totalUSD: 0,
    };

    // Solana
    if (solanaClient && process.env.SOLANA_WALLET_ADDRESS) {
      try {
        const sol = solanaClient();
        const portfolio = await sol.getPortfolioValue();
        summary.chains.solana = portfolio;
        summary.totalUSD += portfolio.totalUSD || 0;
      } catch (err) {
        summary.chains.solana = { error: err.message };
      }
    }

    // MultiversX
    if (mvxClient && process.env.MVX_WALLET_ADDRESS) {
      try {
        const mvx = mvxClient();
        const portfolio = await mvx.getPortfolioValue();
        summary.chains.multiversx = portfolio;
        summary.totalUSD += portfolio.totalUSD || 0;
      } catch (err) {
        summary.chains.multiversx = { error: err.message };
      }
    }

    // EVM chains (Ethereum, Base) — values come from Alchemy connector
    summary.chains.evm = { note: 'See /api/alchemy for EVM chain balances' };

    return summary;
  }

  /** Health check across all chains */
  async getHealth() {
    const health = { chains: {}, status: 'healthy' };

    const checks = [];

    if (solanaClient && process.env.SOLANA_WALLET_ADDRESS) {
      checks.push(
        solanaClient().getHealth()
          .then(h => { health.chains.solana = h; })
          .catch(e => { health.chains.solana = { status: 'error', error: e.message }; })
      );
    }

    if (mvxClient && process.env.MVX_WALLET_ADDRESS) {
      checks.push(
        mvxClient().getHealth()
          .then(h => { health.chains.multiversx = h; })
          .catch(e => { health.chains.multiversx = { status: 'error', error: e.message }; })
      );
    }

    await Promise.allSettled(checks);

    // Overall status
    const statuses = Object.values(health.chains).map(c => c.status);
    if (statuses.some(s => s === 'error')) health.status = 'degraded';
    if (statuses.every(s => s === 'error')) health.status = 'error';

    return health;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _engine = null;
function getMultiChainDeFiEngine() {
  if (!_engine) _engine = new MultiChainDeFiEngine();
  return _engine;
}

module.exports = {
  MultiChainDeFiEngine,
  getMultiChainDeFiEngine,
  PROTOCOLS,
  FLASH_LOAN_PROVIDERS,
  fetchDefiLlamaYield,
};
