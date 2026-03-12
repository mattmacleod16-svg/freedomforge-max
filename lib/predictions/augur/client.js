/**
 * Augur / Augur Turbo Client — Decentralized prediction markets on Ethereum/Polygon.
 * ═══════════════════════════════════════════════════════════════════════════════════
 *
 * Augur v2 operates on Ethereum mainnet with 0x-based orderbook.
 * Augur Turbo (now part of the broader ecosystem) runs on Polygon.
 *
 * This client reads market data from the Augur subgraph and
 * can bridge to on-chain resolution via ethers.js.
 *
 * Required env:
 *   AUGUR_SUBGRAPH_URL  — The Graph endpoint for Augur
 */

'use strict';

const { createLogger } = require('../../logger');
const log = createLogger('augur');

let rio;
try { rio = require('../../resilient-io'); } catch { rio = null; }

const REQUEST_TIMEOUT_MS = 15000;

// Augur subgraph URLs
const SUBGRAPH_URLS = {
  ethereum: process.env.AUGUR_SUBGRAPH_URL || 'https://api.thegraph.com/subgraphs/name/augurproject/augur-v2',
  polygon:  process.env.AUGUR_POLYGON_SUBGRAPH || 'https://api.thegraph.com/subgraphs/name/augurproject/augur-turbo',
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

async function augurFetch(url, options = {}) {
  if (rio) {
    return rio.circuitBreaker('augur', () =>
      rio.fetchJsonRetry(url, options, { timeoutMs: REQUEST_TIMEOUT_MS, retries: 2 }),
      { failureThreshold: 5, resetTimeMs: 120000 }
    );
  }
  return fetchJson(url, options);
}

// ─── GraphQL Queries ────────────────────────────────────────────────────────

const QUERIES = {
  activeMarkets: `{
    markets(first: 50, where: {finalized: false}, orderBy: volume, orderDirection: desc) {
      id
      description
      longDescription
      endTimestamp
      status
      volume
      openInterest
      outcomes
      marketType
      creationBlock
    }
  }`,

  marketDetail: (id) => `{
    market(id: "${id}") {
      id
      description
      longDescription
      endTimestamp
      status
      volume
      openInterest
      outcomes
      marketType
      finalized
      winningPayoutNumerator
    }
  }`,

  recentTrades: (marketId) => `{
    trades(first: 50, where: {market: "${marketId}"}, orderBy: timestamp, orderDirection: desc) {
      id
      timestamp
      amount
      price
      outcome
      type
    }
  }`,
};

// ─── Augur Client ───────────────────────────────────────────────────────────

class AugurClient {
  constructor(opts = {}) {
    this.network = (opts.network || process.env.AUGUR_NETWORK || 'ethereum').toLowerCase();
    this.subgraphUrl = SUBGRAPH_URLS[this.network] || SUBGRAPH_URLS.ethereum;

    log.info('Augur client initialized', { network: this.network });
  }

  /** Execute GraphQL query against Augur subgraph */
  async query(gql) {
    return augurFetch(this.subgraphUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: gql }),
    });
  }

  /** Get active (non-finalized) markets */
  async getActiveMarkets() {
    const result = await this.query(QUERIES.activeMarkets);
    return result?.data?.markets || [];
  }

  /** Get specific market detail */
  async getMarket(marketId) {
    const result = await this.query(QUERIES.marketDetail(marketId));
    return result?.data?.market || null;
  }

  /** Get recent trades in a market */
  async getMarketTrades(marketId) {
    const result = await this.query(QUERIES.recentTrades(marketId));
    return result?.data?.trades || [];
  }

  /** Scan for mispriced markets */
  async scanOpportunities(minVolume = 1000) {
    const markets = await this.getActiveMarkets();
    const opportunities = [];

    for (const market of markets) {
      const volume = Number(market.volume || 0);
      if (volume < minVolume) continue;

      // Look for markets with significant open interest and approaching end
      const endTime = Number(market.endTimestamp || 0) * 1000;
      const now = Date.now();
      const daysToEnd = (endTime - now) / (1000 * 86400);

      if (daysToEnd > 0 && daysToEnd < 30) {
        opportunities.push({
          id: market.id,
          description: market.description,
          volume,
          openInterest: Number(market.openInterest || 0),
          daysToEnd: Math.round(daysToEnd * 10) / 10,
          outcomes: market.outcomes,
          type: market.marketType,
        });
      }
    }

    return opportunities.sort((a, b) => b.volume - a.volume);
  }

  // ─── Health Check ─────────────────────────────────────────────────

  async getHealth() {
    try {
      const markets = await this.getActiveMarkets();
      return {
        status: markets ? 'healthy' : 'degraded',
        platform: 'augur',
        network: this.network,
        activeMarkets: markets?.length || 0,
      };
    } catch (err) {
      return { status: 'error', platform: 'augur', error: err.message };
    }
  }
}

module.exports = { AugurClient };
