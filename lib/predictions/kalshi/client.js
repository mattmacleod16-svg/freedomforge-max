/**
 * Kalshi Client — Event contracts trading on the Kalshi exchange.
 * ═══════════════════════════════════════════════════════════════
 *
 * Kalshi is a CFTC-regulated event contracts exchange.
 * Provides binary event outcomes on economics, politics, weather, etc.
 *
 * Required env:
 *   KALSHI_API_KEY     — API key from Kalshi dashboard
 *   KALSHI_API_SECRET  — API secret / private key (RSA PEM for v2)
 *   KALSHI_BASE_URL    — defaults to https://api.elections.kalshi.com/trade-api/v2
 */

'use strict';

const crypto = require('crypto');
const { createLogger } = require('../../logger');
const log = createLogger('kalshi');

let rio;
try { rio = require('../../resilient-io'); } catch { rio = null; }

const REQUEST_TIMEOUT_MS = 15000;

const BASE_URL = (process.env.KALSHI_BASE_URL || 'https://api.elections.kalshi.com/trade-api/v2').replace(/\/$/, '');
const API_KEY = (process.env.KALSHI_API_KEY || '').trim();
const API_SECRET = (process.env.KALSHI_API_SECRET || '').trim();

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

async function kalshiFetch(url, options = {}) {
  if (rio) {
    return rio.circuitBreaker('kalshi', () =>
      rio.fetchJsonRetry(url, options, { timeoutMs: REQUEST_TIMEOUT_MS, retries: 2 }),
      { failureThreshold: 5, resetTimeMs: 120000 }
    );
  }
  return fetchJson(url, options);
}

// ─── Kalshi API Client ──────────────────────────────────────────────────────

class KalshiClient {
  constructor(opts = {}) {
    this.baseUrl = opts.baseUrl || BASE_URL;
    this.apiKey = opts.apiKey || API_KEY;
    this.apiSecret = opts.apiSecret || API_SECRET;
    this._token = null;
    this._tokenExpiry = 0;

    log.info('Kalshi client initialized', {
      baseUrl: this.baseUrl,
      hasKey: !!this.apiKey,
    });
  }

  /** Authenticate and get session token */
  async login() {
    if (this._token && Date.now() < this._tokenExpiry) return this._token;

    const result = await kalshiFetch(`${this.baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.apiKey, password: this.apiSecret }),
    });

    this._token = result.token;
    this._tokenExpiry = Date.now() + 55 * 60 * 1000; // 55 min
    log.info('Kalshi authenticated');
    return this._token;
  }

  /** Make authenticated API request */
  async request(method, path, body = null) {
    const token = await this.login();
    const url = `${this.baseUrl}${path}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    };
    if (body) options.body = JSON.stringify(body);
    return kalshiFetch(url, options);
  }

  // ─── Markets ────────────────────────────────────────────────────────

  /** List active event categories */
  async getEvents(params = {}) {
    const qs = new URLSearchParams({
      limit: String(params.limit || 50),
      status: params.status || 'open',
      ...(params.series_ticker ? { series_ticker: params.series_ticker } : {}),
    });
    return this.request('GET', `/events?${qs}`);
  }

  /** Get markets for a specific event */
  async getMarkets(params = {}) {
    const qs = new URLSearchParams({
      limit: String(params.limit || 100),
      status: params.status || 'open',
      ...(params.event_ticker ? { event_ticker: params.event_ticker } : {}),
      ...(params.series_ticker ? { series_ticker: params.series_ticker } : {}),
    });
    return this.request('GET', `/markets?${qs}`);
  }

  /** Get single market by ticker */
  async getMarket(ticker) {
    return this.request('GET', `/markets/${ticker}`);
  }

  /** Get orderbook for a market */
  async getOrderbook(ticker, depth = 10) {
    return this.request('GET', `/markets/${ticker}/orderbook?depth=${depth}`);
  }

  // ─── Trading ────────────────────────────────────────────────────────

  /** Place an order */
  async placeOrder(ticker, side, count, yesPrice, type = 'limit') {
    return this.request('POST', '/portfolio/orders', {
      ticker,
      action: side === 'buy' ? 'buy' : 'sell',
      side: 'yes',
      count,
      type,
      yes_price: yesPrice,       // price in cents (1-99)
    });
  }

  /** Cancel an order */
  async cancelOrder(orderId) {
    return this.request('DELETE', `/portfolio/orders/${orderId}`);
  }

  /** Get open orders */
  async getOrders(status = 'resting') {
    return this.request('GET', `/portfolio/orders?status=${status}`);
  }

  // ─── Portfolio ──────────────────────────────────────────────────────

  /** Get account balance */
  async getBalance() {
    return this.request('GET', '/portfolio/balance');
  }

  /** Get positions */
  async getPositions() {
    return this.request('GET', '/portfolio/positions');
  }

  /** Get settlement history */
  async getSettlements(limit = 50) {
    return this.request('GET', `/portfolio/settlements?limit=${limit}`);
  }

  // ─── Health Check ─────────────────────────────────────────────────

  async getHealth() {
    try {
      const balance = await this.getBalance();
      return {
        status: 'healthy',
        platform: 'kalshi',
        balance: balance?.balance || null,
      };
    } catch (err) {
      return { status: 'error', platform: 'kalshi', error: err.message };
    }
  }
}

module.exports = { KalshiClient };
