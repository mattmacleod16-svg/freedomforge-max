/**
 * API Cost Tracker — Real-time cost metering for every API call across the empire.
 * ═══════════════════════════════════════════════════════════════════════════════════
 *
 * Tracks costs per API provider so the self-funding system knows exactly
 * how much revenue needs to be generated to cover operational expenses.
 *
 * Covered APIs:
 *   - AI Models: Grok, OpenAI, Anthropic, Gemini, Groq, Mistral, Cerebras, NVIDIA, OpenRouter
 *   - Blockchain: Alchemy, Solana RPC, MultiversX
 *   - Data: Tavily, CoinGecko, Polymarket, Alternative.me
 *   - Trading: Coinbase, Kraken, Alpaca, IBKR, Kalshi
 *   - Finance: Plaid
 *   - Social: X/Twitter API, Discord
 *   - Infrastructure: Vercel, hosting
 */

'use strict';

const fs = require('fs');
const path = require('path');

let rio;
try { rio = require('../resilient-io'); } catch { rio = null; }

const DATA_DIR = process.env.VERCEL ? '/tmp/freedomforge-data' : path.resolve(process.cwd(), 'data');
const COST_FILE = path.join(DATA_DIR, 'api-cost-ledger.json');

// ─── Per-API Pricing (estimated USD per unit) ────────────────────────────────

const PRICING = {
  // AI Models (per 1K tokens, blended input/output)
  'grok':        { perUnit: 0.005,   unit: '1k_tokens', category: 'ai' },
  'openai':      { perUnit: 0.0025,  unit: '1k_tokens', category: 'ai' },
  'anthropic':   { perUnit: 0.003,   unit: '1k_tokens', category: 'ai' },
  'gemini':      { perUnit: 0.00035, unit: '1k_tokens', category: 'ai' },
  'groq':        { perUnit: 0.00027, unit: '1k_tokens', category: 'ai' },
  'mistral':     { perUnit: 0.002,   unit: '1k_tokens', category: 'ai' },
  'cerebras':    { perUnit: 0.0006,  unit: '1k_tokens', category: 'ai' },
  'nvidia':      { perUnit: 0.0009,  unit: '1k_tokens', category: 'ai' },
  'openrouter':  { perUnit: 0.002,   unit: '1k_tokens', category: 'ai' },
  'huggingface': { perUnit: 0.0003,  unit: '1k_tokens', category: 'ai' },
  'perplexity':  { perUnit: 0.005,   unit: '1k_tokens', category: 'ai' },  // sonar-pro with search
  'ollama':      { perUnit: 0,       unit: '1k_tokens', category: 'ai' },  // Local, free
  'clawd':       { perUnit: 0,       unit: 'request',   category: 'ai' },  // Self-hosted

  // Blockchain
  'alchemy':     { perUnit: 0.0001,  unit: 'compute_unit', category: 'blockchain' },
  'solana_rpc':  { perUnit: 0.00005, unit: 'request',      category: 'blockchain' },
  'multiversx':  { perUnit: 0.00003, unit: 'request',      category: 'blockchain' },
  'zora_rpc':    { perUnit: 0.00005, unit: 'request',      category: 'blockchain' },

  // Data feeds
  'tavily':      { perUnit: 0.01,    unit: 'search',   category: 'data' },
  'coingecko':   { perUnit: 0,       unit: 'request',  category: 'data' },  // Free tier
  'polymarket':  { perUnit: 0,       unit: 'request',  category: 'data' },  // Free API
  'alternative': { perUnit: 0,       unit: 'request',  category: 'data' },  // Free API

  // Trading venues (maker/taker fees per trade USD volume)
  'coinbase':    { perUnit: 0.006,   unit: 'trade_usd', category: 'trading' },
  'kraken':      { perUnit: 0.004,   unit: 'trade_usd', category: 'trading' },
  'alpaca':      { perUnit: 0,       unit: 'trade_usd', category: 'trading' },  // Commission free
  'ibkr':        { perUnit: 0.0005,  unit: 'trade_usd', category: 'trading' },
  'kalshi':      { perUnit: 0.07,    unit: 'contract',  category: 'trading' },

  // Finance
  'plaid':       { perUnit: 0.30,    unit: 'api_call', category: 'finance' },

  // Social
  'x_twitter':   { perUnit: 0.01,    unit: 'request', category: 'social' },
  'discord':     { perUnit: 0,       unit: 'request', category: 'social' },

  // Infrastructure
  'vercel':      { perUnit: 0,       unit: 'invocation', category: 'infra' },  // Within free/pro tier
  'gas_eth':     { perUnit: 1,       unit: 'eth',       category: 'blockchain' },
};

// ─── Cost Ledger ─────────────────────────────────────────────────────────────

function loadCostLedger() {
  try {
    if (rio) return rio.readJsonSafe(COST_FILE, { fallback: null }) || createFreshLedger();
    if (!fs.existsSync(COST_FILE)) return createFreshLedger();
    return JSON.parse(fs.readFileSync(COST_FILE, 'utf8'));
  } catch {
    return createFreshLedger();
  }
}

function saveCostLedger(ledger) {
  ledger.updatedAt = Date.now();
  try {
    if (rio) { rio.writeJsonAtomic(COST_FILE, ledger); return; }
    fs.mkdirSync(path.dirname(COST_FILE), { recursive: true });
    const tmp = COST_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
    fs.renameSync(tmp, COST_FILE);
  } catch (err) {
    console.error('[api-cost-tracker] save failed:', err.message);
  }
}

function createFreshLedger() {
  return {
    // Per-provider accumulated costs
    providers: {},
    // Per-category totals
    categories: {},
    // Daily cost snapshots (last 90 days)
    dailyCosts: [],
    // Lifetime totals
    lifetimeCostUsd: 0,
    lifetimeApiCalls: 0,
    // Budget tracking
    dailyBudgetUsd: Number(process.env.API_DAILY_BUDGET_USD || 5),
    monthlyBudgetUsd: Number(process.env.API_MONTHLY_BUDGET_USD || 100),
    todayCostUsd: 0,
    todayDate: new Date().toISOString().slice(0, 10),
    monthCostUsd: 0,
    currentMonth: new Date().toISOString().slice(0, 7),
    // Alerts
    budgetAlerts: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Record an API call and its estimated cost.
 * @param {string} provider - Provider ID (e.g., 'openai', 'alchemy')
 * @param {number} units - Number of units consumed (tokens/1000, requests, etc.)
 * @param {object} meta - Optional metadata (endpoint, model, etc.)
 */
function recordApiCall(provider, units = 1, meta = {}) {
  const ledger = loadCostLedger();
  const pricing = PRICING[provider] || { perUnit: 0, unit: 'request', category: 'unknown' };
  const costUsd = Number((units * pricing.perUnit).toFixed(8));
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  // Reset daily counter if new day
  if (ledger.todayDate !== today) {
    // Archive yesterday
    if (ledger.todayDate && ledger.todayCostUsd > 0) {
      ledger.dailyCosts.push({
        date: ledger.todayDate,
        costUsd: ledger.todayCostUsd,
        calls: ledger.lifetimeApiCalls,
      });
      if (ledger.dailyCosts.length > 90) ledger.dailyCosts = ledger.dailyCosts.slice(-90);
    }
    ledger.todayDate = today;
    ledger.todayCostUsd = 0;
  }

  // Reset monthly counter if new month
  if (ledger.currentMonth !== month) {
    ledger.currentMonth = month;
    ledger.monthCostUsd = 0;
  }

  // Update provider stats
  if (!ledger.providers[provider]) {
    ledger.providers[provider] = {
      calls: 0,
      totalUnits: 0,
      totalCostUsd: 0,
      category: pricing.category,
      unit: pricing.unit,
      lastCallAt: 0,
    };
  }
  const prov = ledger.providers[provider];
  prov.calls += 1;
  prov.totalUnits += units;
  prov.totalCostUsd = Number((prov.totalCostUsd + costUsd).toFixed(8));
  prov.lastCallAt = Date.now();

  // Update category totals
  if (!ledger.categories[pricing.category]) {
    ledger.categories[pricing.category] = { totalCostUsd: 0, totalCalls: 0 };
  }
  ledger.categories[pricing.category].totalCostUsd = Number(
    (ledger.categories[pricing.category].totalCostUsd + costUsd).toFixed(8)
  );
  ledger.categories[pricing.category].totalCalls += 1;

  // Update totals
  ledger.lifetimeCostUsd = Number((ledger.lifetimeCostUsd + costUsd).toFixed(8));
  ledger.lifetimeApiCalls += 1;
  ledger.todayCostUsd = Number((ledger.todayCostUsd + costUsd).toFixed(8));
  ledger.monthCostUsd = Number((ledger.monthCostUsd + costUsd).toFixed(8));

  // Budget alerts
  if (ledger.todayCostUsd > ledger.dailyBudgetUsd * 0.8) {
    const alertKey = `daily_80pct_${today}`;
    if (!ledger.budgetAlerts.includes(alertKey)) {
      ledger.budgetAlerts.push(alertKey);
      if (ledger.budgetAlerts.length > 50) ledger.budgetAlerts = ledger.budgetAlerts.slice(-50);
    }
  }

  saveCostLedger(ledger);

  return {
    provider,
    costUsd,
    units,
    category: pricing.category,
    todayTotal: ledger.todayCostUsd,
    monthTotal: ledger.monthCostUsd,
    withinBudget: ledger.todayCostUsd <= ledger.dailyBudgetUsd,
  };
}

/**
 * Get the full cost summary for dashboard/status.
 */
function getCostSummary() {
  const ledger = loadCostLedger();
  const today = new Date().toISOString().slice(0, 10);

  // Reset if stale
  if (ledger.todayDate !== today) {
    ledger.todayDate = today;
    ledger.todayCostUsd = 0;
  }

  // Sort providers by cost descending
  const providerRanking = Object.entries(ledger.providers)
    .map(([id, stats]) => ({ id, ...stats }))
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd);

  // Calculate daily average
  const recentDays = ledger.dailyCosts.slice(-30);
  const avgDailyCost = recentDays.length > 0
    ? recentDays.reduce((sum, d) => sum + d.costUsd, 0) / recentDays.length
    : ledger.todayCostUsd;

  // Project monthly from daily average
  const projectedMonthlyCost = Number((avgDailyCost * 30).toFixed(2));

  return {
    lifetimeCostUsd: ledger.lifetimeCostUsd,
    lifetimeApiCalls: ledger.lifetimeApiCalls,
    todayCostUsd: ledger.todayCostUsd,
    monthCostUsd: ledger.monthCostUsd,
    dailyBudgetUsd: ledger.dailyBudgetUsd,
    monthlyBudgetUsd: ledger.monthlyBudgetUsd,
    dailyBudgetUsedPct: ledger.dailyBudgetUsd > 0
      ? Number((ledger.todayCostUsd / ledger.dailyBudgetUsd * 100).toFixed(1))
      : 0,
    monthlyBudgetUsedPct: ledger.monthlyBudgetUsd > 0
      ? Number((ledger.monthCostUsd / ledger.monthlyBudgetUsd * 100).toFixed(1))
      : 0,
    avgDailyCost: Number(avgDailyCost.toFixed(4)),
    projectedMonthlyCost,
    providerRanking,
    categoryBreakdown: ledger.categories,
    recentDays: ledger.dailyCosts.slice(-14),
    withinDailyBudget: ledger.todayCostUsd <= ledger.dailyBudgetUsd,
    withinMonthlyBudget: ledger.monthCostUsd <= ledger.monthlyBudgetUsd,
  };
}

/**
 * Check if a provider call should be throttled based on budget.
 */
function shouldThrottleProvider(provider) {
  const ledger = loadCostLedger();
  const today = new Date().toISOString().slice(0, 10);
  if (ledger.todayDate !== today) return false; // Fresh day

  // Hard stop at 120% of daily budget
  if (ledger.todayCostUsd > ledger.dailyBudgetUsd * 1.2) return true;

  // Throttle expensive providers if over 80% budget
  const pricing = PRICING[provider];
  if (pricing && pricing.perUnit > 0.003 && ledger.todayCostUsd > ledger.dailyBudgetUsd * 0.8) {
    return true;
  }

  return false;
}

module.exports = {
  recordApiCall,
  getCostSummary,
  shouldThrottleProvider,
  PRICING,
};
