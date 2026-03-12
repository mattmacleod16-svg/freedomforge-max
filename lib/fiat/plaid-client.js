/**
 * Plaid Fiat Rails — Bank account integration for fund management.
 * ═══════════════════════════════════════════════════════════════════
 *
 * Provides:
 *  - Bank account linking via Plaid Link
 *  - Balance monitoring across linked accounts
 *  - ACH transfer initiation (funding/withdrawal)
 *  - Transaction history for reconciliation
 *  - Identity verification
 *  - Real-time balance alerts
 *
 * Required env:
 *   PLAID_CLIENT_ID    — Plaid client ID
 *   PLAID_SECRET       — Plaid secret (sandbox/development/production)
 *   PLAID_ENV          — sandbox | development | production
 *   PLAID_ACCESS_TOKEN — stored after initial link (per institution)
 */

'use strict';

const { createLogger } = require('../logger');
const log = createLogger('plaid');

let rio;
try { rio = require('../resilient-io'); } catch { rio = null; }

const REQUEST_TIMEOUT_MS = 15000;

// ─── Plaid Environments ─────────────────────────────────────────────────────

const PLAID_ENVS = {
  sandbox:     'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production:  'https://production.plaid.com',
};

const CLIENT_ID   = (process.env.PLAID_CLIENT_ID || '').trim();
const SECRET      = (process.env.PLAID_SECRET || '').trim();
const PLAID_ENV   = (process.env.PLAID_ENV || 'sandbox').toLowerCase();
const BASE_URL    = PLAID_ENVS[PLAID_ENV] || PLAID_ENVS.sandbox;
const ACCESS_TOKEN = (process.env.PLAID_ACCESS_TOKEN || '').trim();

// ─── Fetch Helpers ──────────────────────────────────────────────────────────

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) {
      const errCode = data?.error_code || res.status;
      throw new Error(`Plaid ${errCode}: ${data?.error_message || JSON.stringify(data).slice(0, 200)}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function plaidFetch(url, options = {}) {
  if (rio) {
    return rio.circuitBreaker('plaid', () =>
      rio.fetchJsonRetry(url, options, { timeoutMs: REQUEST_TIMEOUT_MS, retries: 2 }),
      { failureThreshold: 5, resetTimeMs: 120000 }
    );
  }
  return fetchJson(url, options);
}

// ─── Plaid Client ───────────────────────────────────────────────────────────

class PlaidClient {
  constructor(opts = {}) {
    this.baseUrl = opts.baseUrl || BASE_URL;
    this.clientId = opts.clientId || CLIENT_ID;
    this.secret = opts.secret || SECRET;
    this.accessToken = opts.accessToken || ACCESS_TOKEN;
    this.env = opts.env || PLAID_ENV;

    log.info('Plaid client initialized', {
      env: this.env,
      hasCredentials: !!(this.clientId && this.secret),
      hasAccessToken: !!this.accessToken,
    });
  }

  /** Make authenticated Plaid API request */
  async request(endpoint, body = {}) {
    return plaidFetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId,
        secret: this.secret,
        ...body,
      }),
    });
  }

  // ─── Link Token (for Plaid Link UI) ────────────────────────────────

  /** Create a link token to initiate Plaid Link on the client side */
  async createLinkToken(userId = 'freedomforge-user') {
    return this.request('/link/token/create', {
      user: { client_user_id: userId },
      client_name: 'FreedomForge',
      products: ['auth', 'transactions', 'balance', 'identity'],
      country_codes: ['US'],
      language: 'en',
    });
  }

  /** Exchange public token for access token (after Plaid Link success) */
  async exchangePublicToken(publicToken) {
    return this.request('/item/public_token/exchange', {
      public_token: publicToken,
    });
  }

  // ─── Accounts & Balances ────────────────────────────────────────────

  /** Get linked accounts */
  async getAccounts() {
    const result = await this.request('/accounts/get', {
      access_token: this.accessToken,
    });
    return (result?.accounts || []).map(a => ({
      id: a.account_id,
      name: a.name,
      officialName: a.official_name,
      type: a.type,           // depository, credit, loan, investment
      subtype: a.subtype,     // checking, savings, credit card, etc.
      mask: a.mask,           // last 4 digits
      balances: {
        available: a.balances?.available,
        current: a.balances?.current,
        limit: a.balances?.limit,
        currency: a.balances?.iso_currency_code || 'USD',
      },
    }));
  }

  /** Get real-time balance */
  async getBalance(accountIds = null) {
    const body = { access_token: this.accessToken };
    if (accountIds) body.options = { account_ids: accountIds };
    return this.request('/accounts/balance/get', body);
  }

  /** Get total cash across all accounts */
  async getTotalCash() {
    const accounts = await this.getAccounts();
    let totalAvailable = 0;
    let totalCurrent = 0;

    for (const a of accounts) {
      if (a.type === 'depository') {
        totalAvailable += a.balances.available || 0;
        totalCurrent += a.balances.current || 0;
      }
    }

    return {
      accounts: accounts.filter(a => a.type === 'depository'),
      totalAvailable,
      totalCurrent,
      currency: 'USD',
    };
  }

  // ─── Transactions ───────────────────────────────────────────────────

  /** Get recent transactions */
  async getTransactions(startDate, endDate, accountIds = null) {
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

    const body = {
      access_token: this.accessToken,
      start_date: startDate || thirtyDaysAgo,
      end_date: endDate || today,
      options: { count: 100, offset: 0 },
    };
    if (accountIds) body.options.account_ids = accountIds;

    return this.request('/transactions/get', body);
  }

  /** Sync transactions incrementally */
  async syncTransactions(cursor = null) {
    const body = { access_token: this.accessToken };
    if (cursor) body.cursor = cursor;
    return this.request('/transactions/sync', body);
  }

  // ─── Auth (ACH/Wire details) ────────────────────────────────────────

  /** Get ACH routing numbers and account numbers */
  async getAuth() {
    return this.request('/auth/get', {
      access_token: this.accessToken,
    });
  }

  // ─── Transfer (ACH Transfers) ───────────────────────────────────────

  /** Initiate an ACH transfer */
  async createTransfer(accountId, amount, type = 'debit', description = 'FreedomForge funding') {
    return this.request('/transfer/create', {
      access_token: this.accessToken,
      account_id: accountId,
      type,              // debit (pull from bank) or credit (push to bank)
      network: 'ach',
      amount: String(amount),
      ach_class: 'ppd',
      description,
      user: {
        legal_name: 'FreedomForge',
      },
    });
  }

  /** Get transfer status */
  async getTransfer(transferId) {
    return this.request('/transfer/get', {
      transfer_id: transferId,
    });
  }

  /** List recent transfers */
  async listTransfers(count = 25) {
    return this.request('/transfer/list', {
      count,
    });
  }

  // ─── Identity ───────────────────────────────────────────────────────

  /** Get identity information for linked accounts */
  async getIdentity() {
    return this.request('/identity/get', {
      access_token: this.accessToken,
    });
  }

  // ─── Institution Info ───────────────────────────────────────────────

  /** Search institutions */
  async searchInstitutions(query, count = 10) {
    return this.request('/institutions/search', {
      query,
      country_codes: ['US'],
      products: ['auth', 'transactions'],
      options: { include_optional_metadata: true },
    });
  }

  // ─── Webhooks ───────────────────────────────────────────────────────

  /** Update webhook URL for the item */
  async updateWebhook(webhookUrl) {
    return this.request('/item/webhook/update', {
      access_token: this.accessToken,
      webhook: webhookUrl,
    });
  }

  // ─── Health Check ─────────────────────────────────────────────────

  async getHealth() {
    try {
      if (!this.clientId || !this.secret) {
        return { status: 'not_configured', platform: 'plaid' };
      }

      if (!this.accessToken) {
        return {
          status: 'needs_linking',
          platform: 'plaid',
          env: this.env,
          note: 'Create link token and complete Plaid Link to connect bank',
        };
      }

      const accounts = await this.getAccounts();
      return {
        status: 'healthy',
        platform: 'plaid',
        env: this.env,
        linkedAccounts: accounts.length,
        accountTypes: accounts.map(a => a.subtype),
      };
    } catch (err) {
      return { status: 'error', platform: 'plaid', error: err.message };
    }
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

let _instance = null;

function getPlaidClient(opts = {}) {
  if (!_instance) _instance = new PlaidClient(opts);
  return _instance;
}

module.exports = {
  PlaidClient,
  getPlaidClient,
};
