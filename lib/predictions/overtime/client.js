/**
 * Overtime Markets Client — On-chain sports & event prediction markets.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Overtime is built on Thales Protocol (Optimism/Base/Arbitrum).
 * Provides sports markets, player props, and live-in-game markets.
 *
 * Required env:
 *   OVERTIME_NETWORK     — optimism | base | arbitrum (default: optimism)
 *   OVERTIME_API_URL     — defaults to https://overtimemarketsv2.xyz
 */

'use strict';

const { createLogger } = require('../../logger');
const log = createLogger('overtime');

let rio;
try { rio = require('../../resilient-io'); } catch { rio = null; }

const REQUEST_TIMEOUT_MS = 15000;
const API_URL = (process.env.OVERTIME_API_URL || 'https://overtimemarketsv2.xyz').replace(/\/$/, '');
const NETWORK = (process.env.OVERTIME_NETWORK || 'optimism').toLowerCase();

// Network chain IDs for Overtime
const CHAIN_IDS = {
  optimism: 10,
  base: 8453,
  arbitrum: 42161,
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

async function overtimeFetch(url, options = {}) {
  if (rio) {
    return rio.circuitBreaker('overtime', () =>
      rio.fetchJsonRetry(url, options, { timeoutMs: REQUEST_TIMEOUT_MS, retries: 2 }),
      { failureThreshold: 5, resetTimeMs: 120000 }
    );
  }
  return fetchJson(url, options);
}

// ─── Overtime Markets Client ────────────────────────────────────────────────

class OvertimeClient {
  constructor(opts = {}) {
    this.apiUrl = opts.apiUrl || API_URL;
    this.network = opts.network || NETWORK;
    this.chainId = CHAIN_IDS[this.network] || CHAIN_IDS.optimism;

    log.info('Overtime client initialized', { network: this.network, chainId: this.chainId });
  }

  /** Get all active sports markets */
  async getMarkets(sport = null) {
    let url = `${this.apiUrl}/overtime/networks/${this.chainId}/markets`;
    if (sport) url += `?sport=${sport}`;
    return overtimeFetch(url);
  }

  /** Get specific market details */
  async getMarket(marketAddress) {
    return overtimeFetch(`${this.apiUrl}/overtime/networks/${this.chainId}/markets/${marketAddress}`);
  }

  /** Get live markets (in-game) */
  async getLiveMarkets() {
    return overtimeFetch(`${this.apiUrl}/overtime/networks/${this.chainId}/live-markets`);
  }

  /** Get available sports */
  async getSports() {
    return overtimeFetch(`${this.apiUrl}/overtime/networks/${this.chainId}/sports`);
  }

  /** Get market quotes for buying a position */
  async getQuote(marketAddress, position, amount) {
    return overtimeFetch(`${this.apiUrl}/overtime/networks/${this.chainId}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketAddress, position, buyInAmount: amount }),
    });
  }

  /** Get user positions (requires wallet address) */
  async getUserPositions(walletAddress) {
    return overtimeFetch(
      `${this.apiUrl}/overtime/networks/${this.chainId}/users/${walletAddress}/positions`
    );
  }

  /** Get user's open trades */
  async getUserTrades(walletAddress) {
    return overtimeFetch(
      `${this.apiUrl}/overtime/networks/${this.chainId}/users/${walletAddress}/trades`
    );
  }

  // ─── Market Scanning ──────────────────────────────────────────────

  /** Find markets with mispricing (where odds diverge from implied probabilities) */
  async scanOpportunities(minEdge = 0.05) {
    try {
      const markets = await this.getMarkets();
      const opportunities = [];

      for (const market of (markets || [])) {
        if (!market.odds || market.isResolved || market.isPaused) continue;

        // Check for edge based on odds imbalance
        const homeOdds = Number(market.odds?.home || 0);
        const awayOdds = Number(market.odds?.away || 0);
        const drawOdds = Number(market.odds?.draw || 0);

        const totalImplied = homeOdds + awayOdds + drawOdds;
        const overround = totalImplied - 1;

        // Low overround = closer to fair odds = potential edge
        if (overround < 0.10 && overround > -0.05) {
          opportunities.push({
            market: market.address,
            homeTeam: market.homeTeam,
            awayTeam: market.awayTeam,
            sport: market.sport,
            homeOdds,
            awayOdds,
            drawOdds,
            overround,
            maturity: market.maturityDate,
          });
        }
      }

      return opportunities.sort((a, b) => a.overround - b.overround);
    } catch (err) {
      log.warn('Overtime opportunity scan failed', { error: err.message });
      return [];
    }
  }

  // ─── Health Check ─────────────────────────────────────────────────

  async getHealth() {
    try {
      const sports = await this.getSports();
      return {
        status: sports ? 'healthy' : 'degraded',
        platform: 'overtime',
        network: this.network,
        sportsAvailable: Array.isArray(sports) ? sports.length : 0,
      };
    } catch (err) {
      return { status: 'error', platform: 'overtime', error: err.message };
    }
  }
}

module.exports = { OvertimeClient };
