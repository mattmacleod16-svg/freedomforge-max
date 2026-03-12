/**
 * Exchange Client — Hardened API client wrappers for external exchanges.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Wraps all outbound exchange HTTP calls with:
 *  - Per-exchange rate limiting (token bucket)
 *  - Circuit breaker (CLOSED → OPEN → HALF_OPEN)
 *  - Retry with exponential backoff + timeout
 *
 * Delegates entirely to resilient-io.js for the heavy lifting.
 *
 * Usage:
 *   const { createCoinbaseClient } = require('./exchange-client');
 *   const cb = createCoinbaseClient({ apiKey: '...', apiSecret: '...' });
 *   const ticker = await cb.fetchJson('https://api.coinbase.com/v2/prices/BTC-USD/spot');
 */

'use strict';

// ─── Load resilient-io (graceful degradation if unavailable) ─────────────────

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

const { createLogger } = require('./logger');
const _log = createLogger('exchange-client');

// ─── Exchange Configurations ─────────────────────────────────────────────────

const EXCHANGE_CONFIGS = {
  coinbase: {
    rateLimitKey: 'exchange:coinbase',
    circuitKey:   'exchange:coinbase',
    rateLimit:    { maxTokens: 10, refillPerSec: 10 },
    circuit:      { failureThreshold: 5, resetTimeMs: 120000 },
  },
  kraken: {
    rateLimitKey: 'exchange:kraken',
    circuitKey:   'exchange:kraken',
    rateLimit:    { maxTokens: 15, refillPerSec: 1 },
    circuit:      { failureThreshold: 5, resetTimeMs: 120000 },
  },
  binance: {
    rateLimitKey: 'exchange:binance',
    circuitKey:   'exchange:binance',
    rateLimit:    { maxTokens: 20, refillPerSec: 20 },
    circuit:      { failureThreshold: 5, resetTimeMs: 120000 },
  },
  alpaca: {
    rateLimitKey: 'exchange:alpaca',
    circuitKey:   'exchange:alpaca',
    rateLimit:    { maxTokens: 10, refillPerSec: 3 },
    circuit:      { failureThreshold: 5, resetTimeMs: 120000 },
  },
  ibkr: {
    rateLimitKey: 'exchange:ibkr',
    circuitKey:   'exchange:ibkr',
    rateLimit:    { maxTokens: 10, refillPerSec: 5 },
    circuit:      { failureThreshold: 5, resetTimeMs: 120000 },
  },
  multiversx: {
    rateLimitKey: 'exchange:multiversx',
    circuitKey:   'exchange:multiversx',
    rateLimit:    { maxTokens: 10, refillPerSec: 5 },
    circuit:      { failureThreshold: 5, resetTimeMs: 120000 },
  },
  kalshi: {
    rateLimitKey: 'exchange:kalshi',
    circuitKey:   'exchange:kalshi',
    rateLimit:    { maxTokens: 10, refillPerSec: 3 },
    circuit:      { failureThreshold: 5, resetTimeMs: 120000 },
  },
  plaid: {
    rateLimitKey: 'exchange:plaid',
    circuitKey:   'exchange:plaid',
    rateLimit:    { maxTokens: 5, refillPerSec: 1 },
    circuit:      { failureThreshold: 3, resetTimeMs: 180000 },
  },
};

// Track which exchanges have been instantiated (for getExchangeHealth)
const activeExchanges = new Set();

// ─── Fallback fetch (no resilient-io) ────────────────────────────────────────

async function fallbackFetchJson(url, fetchOpts = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...fetchOpts, signal: controller.signal });
    const text = await res.text();
    try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
  } finally {
    clearTimeout(timer);
  }
}

// ─── Generic Client Factory ──────────────────────────────────────────────────

function createExchangeClient(exchangeName, opts = {}) {
  const cfg = EXCHANGE_CONFIGS[exchangeName];
  if (!cfg) throw new Error(`Unknown exchange: ${exchangeName}`);

  const timeoutMs = opts.timeoutMs || 15000;
  activeExchanges.add(exchangeName);

  let prevCircuitStatus = 'CLOSED';

  /**
   * Hardened JSON fetch: rate limit → circuit breaker → retry → parse.
   */
  async function fetchJson(url, fetchOpts = {}) {
    // No resilient-io — bare fetch with timeout
    if (!rio) {
      return fallbackFetchJson(url, fetchOpts, timeoutMs);
    }

    // 1. Wait for rate limit token
    await rio.rateLimitWait(cfg.rateLimitKey, cfg.rateLimit, 10000);

    // 2. Circuit breaker wraps the retried fetch
    return rio.circuitBreaker(
      cfg.circuitKey,
      async () => {
        const result = await rio.fetchJsonRetry(url, fetchOpts, {
          retries: 2,
          timeoutMs,
          baseDelayMs: 500,
        });

        // Successful call — log recovery if circuit was previously not CLOSED
        if (prevCircuitStatus !== 'CLOSED') {
          _log.info('Circuit breaker recovered', { exchange: exchangeName, status: 'CLOSED' });
          prevCircuitStatus = 'CLOSED';
        }

        return result;
      },
      cfg.circuit,
    ).catch(err => {
      // Log when circuit opens
      if (rio) {
        const state = rio.getCircuitStatus(cfg.circuitKey);
        if (state && state.status === 'OPEN' && prevCircuitStatus !== 'OPEN') {
          _log.warn('Circuit breaker OPEN', { exchange: exchangeName, failures: cfg.circuit.failureThreshold, pauseSec: cfg.circuit.resetTimeMs / 1000 });
          prevCircuitStatus = 'OPEN';
        }
      }
      throw err;
    });
  }

  /**
   * Return live circuit breaker + rate limit status.
   */
  function getStatus() {
    if (!rio) {
      return { circuitState: 'UNKNOWN (rio unavailable)', rateLimit: {} };
    }
    return {
      circuitState: rio.getCircuitStatus(cfg.circuitKey),
      rateLimit: cfg.rateLimit,
    };
  }

  return { fetchJson, getStatus };
}

// ─── Per-Exchange Client Factories ───────────────────────────────────────────

/**
 * @param {object} opts
 * @param {number} [opts.timeoutMs=15000]
 * @param {string} [opts.apiKey]
 * @param {string} [opts.apiSecret]
 * @param {string} [opts.apiPassphrase]
 * @param {string} [opts.baseUrl='https://api.coinbase.com']
 */
function createCoinbaseClient(opts = {}) {
  const client = createExchangeClient('coinbase', opts);
  return {
    fetchJson: client.fetchJson,
    getStatus: client.getStatus,
    baseUrl: opts.baseUrl || 'https://api.coinbase.com',
  };
}

/**
 * @param {object} opts
 * @param {number} [opts.timeoutMs=15000]
 * @param {string} [opts.apiKey]
 * @param {string} [opts.apiSecret]
 * @param {string} [opts.baseUrl='https://api.kraken.com']
 */
function createKrakenClient(opts = {}) {
  const client = createExchangeClient('kraken', opts);
  return {
    fetchJson: client.fetchJson,
    getStatus: client.getStatus,
    baseUrl: opts.baseUrl || 'https://api.kraken.com',
  };
}

/**
 * @param {object} opts
 * @param {number} [opts.timeoutMs=15000]
 * @param {string} [opts.baseUrl='https://api.binance.com']
 */
function createBinanceClient(opts = {}) {
  const client = createExchangeClient('binance', opts);
  return {
    fetchJson: client.fetchJson,
    getStatus: client.getStatus,
    baseUrl: opts.baseUrl || 'https://api.binance.com',
  };
}

/**
 * @param {object} opts — Alpaca Markets client
 */
function createAlpacaClient(opts = {}) {
  const client = createExchangeClient('alpaca', opts);
  return {
    fetchJson: client.fetchJson,
    getStatus: client.getStatus,
    baseUrl: opts.baseUrl || 'https://api.alpaca.markets',
  };
}

/**
 * @param {object} opts — Interactive Brokers client
 */
function createIBKRClient(opts = {}) {
  const client = createExchangeClient('ibkr', opts);
  return {
    fetchJson: client.fetchJson,
    getStatus: client.getStatus,
    baseUrl: opts.baseUrl || 'https://localhost:5000',
  };
}

/**
 * @param {object} opts — MultiversX client
 */
function createMultiversXClient(opts = {}) {
  const client = createExchangeClient('multiversx', opts);
  return {
    fetchJson: client.fetchJson,
    getStatus: client.getStatus,
    baseUrl: opts.baseUrl || 'https://api.multiversx.com',
  };
}

/**
 * @param {object} opts — Kalshi prediction market client
 */
function createKalshiClient(opts = {}) {
  const client = createExchangeClient('kalshi', opts);
  return {
    fetchJson: client.fetchJson,
    getStatus: client.getStatus,
    baseUrl: opts.baseUrl || 'https://api.elections.kalshi.com',
  };
}

/**
 * @param {object} opts — Plaid banking client
 */
function createPlaidClient(opts = {}) {
  const client = createExchangeClient('plaid', opts);
  return {
    fetchJson: client.fetchJson,
    getStatus: client.getStatus,
    baseUrl: opts.baseUrl || 'https://production.plaid.com',
  };
}

// ─── Health Overview ─────────────────────────────────────────────────────────

/**
 * Returns circuit breaker and rate limit status for all active exchanges.
 * @returns {object} keyed by exchange name
 */
function getExchangeHealth() {
  const health = {};
  for (const name of activeExchanges) {
    const cfg = EXCHANGE_CONFIGS[name];
    health[name] = {
      circuitState: rio ? rio.getCircuitStatus(cfg.circuitKey) : 'UNKNOWN',
      rateLimit: cfg.rateLimit,
    };
  }
  return health;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  createCoinbaseClient,
  createKrakenClient,
  createBinanceClient,
  createAlpacaClient,
  createIBKRClient,
  createMultiversXClient,
  createKalshiClient,
  createPlaidClient,
  getExchangeHealth,
};
