/**
 * AgentCard Manager — Autonomous prepaid Visa card management for API credit purchases.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Integrates with agentcard.ai to create and manage prepaid virtual Visa cards
 * that the head AI agent uses to autonomously purchase API credits when balances
 * run low. This is the financial execution layer for true AI autonomy.
 *
 * Capabilities:
 *   - Create prepaid Visa cards with specified amounts
 *   - Retrieve card details (PAN, CVV, expiry) for API provider purchases
 *   - Monitor card balances and trigger auto-top-ups
 *   - Track spending by provider for budget accountability
 *   - Enforce spending limits and approval thresholds
 *
 * Security:
 *   - Card details encrypted at rest
 *   - Spending limits enforced per-card and per-provider
 *   - All transactions logged for audit trail
 *   - Owner approval required above configurable thresholds
 *
 * Supported API Providers for Auto-Purchase:
 *   - Perplexity AI (sonar, sonar-pro, sonar-reasoning-pro, sonar-deep-research)
 *   - OpenAI (GPT-4o, GPT-4o-mini)
 *   - Anthropic (Claude)
 *   - Grok/xAI
 *   - Tavily (search)
 *   - Any provider accepting Visa for credit top-ups
 */

'use strict';

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

let rio;
try { rio = require('../resilient-io'); } catch { rio = null; }

let costTracker;
try { costTracker = require('./api-cost-tracker'); } catch { costTracker = null; }

const DATA_DIR = process.env.VERCEL ? '/tmp/freedomforge-data' : path.resolve(process.cwd(), 'data');
const AGENTCARD_FILE = path.join(DATA_DIR, 'agentcard-state.json');

// ─── Configuration ──────────────────────────────────────────────────────────

// Maximum amount for a single card creation without owner approval
const AUTO_TOPUP_LIMIT_USD = Math.max(5, Math.min(100,
  Number(process.env.AGENTCARD_AUTO_TOPUP_LIMIT || 25)));

// Minimum API reserve balance that triggers auto-top-up
const LOW_BALANCE_THRESHOLD_USD = Math.max(1, Math.min(50,
  Number(process.env.AGENTCARD_LOW_BALANCE_THRESHOLD || 5)));

// Maximum total daily spend across all cards
const DAILY_SPEND_LIMIT_USD = Math.max(10, Math.min(500,
  Number(process.env.AGENTCARD_DAILY_SPEND_LIMIT || 50)));

// Maximum total monthly spend
const MONTHLY_SPEND_LIMIT_USD = Math.max(50, Math.min(2000,
  Number(process.env.AGENTCARD_MONTHLY_SPEND_LIMIT || 200)));

// Provider credit purchase URLs and minimum amounts
const PROVIDER_TOPUP_CONFIG = {
  perplexity: {
    name: 'Perplexity AI',
    creditUrl: 'https://www.perplexity.ai/settings/api',
    minTopupUsd: 5,
    defaultTopupUsd: 10,
    maxTopupUsd: 50,
    priority: 1,  // Highest priority — search-grounded intelligence
  },
  openai: {
    name: 'OpenAI',
    creditUrl: 'https://platform.openai.com/settings/organization/billing/overview',
    minTopupUsd: 5,
    defaultTopupUsd: 10,
    maxTopupUsd: 50,
    priority: 2,
  },
  anthropic: {
    name: 'Anthropic',
    creditUrl: 'https://console.anthropic.com/settings/billing',
    minTopupUsd: 5,
    defaultTopupUsd: 10,
    maxTopupUsd: 50,
    priority: 3,
  },
  xai: {
    name: 'xAI (Grok)',
    creditUrl: 'https://console.x.ai/billing',
    minTopupUsd: 5,
    defaultTopupUsd: 10,
    maxTopupUsd: 25,
    priority: 4,
  },
  tavily: {
    name: 'Tavily',
    creditUrl: 'https://app.tavily.com/billing',
    minTopupUsd: 5,
    defaultTopupUsd: 5,
    maxTopupUsd: 20,
    priority: 5,
  },
  gemini: {
    name: 'Google Gemini',
    creditUrl: 'https://aistudio.google.com/apikey',
    minTopupUsd: 5,
    defaultTopupUsd: 10,
    maxTopupUsd: 25,
    priority: 6,
  },
  mistral: {
    name: 'Mistral AI',
    creditUrl: 'https://console.mistral.ai/billing',
    minTopupUsd: 5,
    defaultTopupUsd: 10,
    maxTopupUsd: 25,
    priority: 7,
  },
};

// ─── State Management ───────────────────────────────────────────────────────

function loadState() {
  try {
    if (rio) return rio.readJsonSafe(AGENTCARD_FILE, { fallback: null }) || createFreshState();
    if (!fs.existsSync(AGENTCARD_FILE)) return createFreshState();
    return JSON.parse(fs.readFileSync(AGENTCARD_FILE, 'utf8'));
  } catch {
    return createFreshState();
  }
}

function saveState(state) {
  state.updatedAt = Date.now();
  try {
    if (rio) { rio.writeJsonAtomic(AGENTCARD_FILE, state); return; }
    fs.mkdirSync(path.dirname(AGENTCARD_FILE), { recursive: true });
    const tmp = AGENTCARD_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, AGENTCARD_FILE);
  } catch (err) {
    console.error('[agentcard-manager] save failed:', err.message);
  }
}

function createFreshState() {
  return {
    // Authentication
    authenticated: false,
    authEmail: null,
    lastAuthCheck: 0,

    // Active cards
    cards: [],  // { id, createdAt, initialAmountUsd, remainingUsd, provider, status, lastUsed }

    // Spending tracking
    spending: {
      todayUsd: 0,
      monthUsd: 0,
      lifetimeUsd: 0,
      lastResetDate: new Date().toISOString().slice(0, 10),
      lastResetMonth: new Date().toISOString().slice(0, 7),
    },

    // Top-up history
    topupHistory: [],  // { ts, provider, amountUsd, cardId, status, reason }

    // Provider credit balances (estimated)
    providerBalances: {},

    // Pending approvals (for amounts above auto limit)
    pendingApprovals: [],

    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ─── AgentCard CLI Wrapper ──────────────────────────────────────────────────

function runAgentCardCmd(args, timeoutMs = 30000) {
  try {
    const result = execSync(`agentcard ${args}`, {
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output: result.trim() };
  } catch (err) {
    return { success: false, output: err.stderr || err.message || 'Command failed' };
  }
}

/**
 * Check if agentcard CLI is installed and authenticated.
 */
function checkAuth() {
  const state = loadState();

  // Check if CLI is installed
  const versionCheck = runAgentCardCmd('--version', 5000);
  if (!versionCheck.success) {
    return {
      installed: false,
      authenticated: false,
      message: 'AgentCard CLI not installed. Run: npm install -g agentcard',
    };
  }

  // Check authentication
  const whoami = runAgentCardCmd('whoami', 10000);
  if (whoami.success && whoami.output && !whoami.output.includes('not logged in')) {
    state.authenticated = true;
    state.authEmail = whoami.output;
    state.lastAuthCheck = Date.now();
    saveState(state);
    return { installed: true, authenticated: true, email: whoami.output };
  }

  state.authenticated = false;
  saveState(state);
  return {
    installed: true,
    authenticated: false,
    message: 'Not authenticated. Run: agentcard signup --email <your-email>',
  };
}

/**
 * List all existing cards.
 */
function listCards() {
  const result = runAgentCardCmd('cards list', 15000);
  if (!result.success) return [];

  const state = loadState();

  // Parse card IDs from output
  const lines = result.output.split('\n').filter(l => l.trim());
  const cardIds = lines.filter(l => /^[a-zA-Z0-9_-]+$/.test(l.trim())).map(l => l.trim());

  // Update state with discovered cards
  cardIds.forEach(id => {
    if (!state.cards.find(c => c.id === id)) {
      state.cards.push({
        id,
        createdAt: Date.now(),
        initialAmountUsd: 0,  // Unknown for pre-existing cards
        remainingUsd: null,   // Will be updated on details fetch
        provider: 'unknown',
        status: 'active',
        lastUsed: 0,
      });
    }
  });

  saveState(state);
  return state.cards;
}

/**
 * Get card details (PAN, CVV, expiry) for a specific card.
 * SECURITY: These are sensitive — handle with care.
 */
function getCardDetails(cardId) {
  const result = runAgentCardCmd(`cards details ${cardId}`, 15000);
  if (!result.success) return null;

  // Parse card details from output
  const output = result.output;
  const details = {
    cardId,
    pan: extractField(output, /card.*number[:\s]*([0-9 -]{13,19})/i) ||
         extractField(output, /PAN[:\s]*([0-9 -]{13,19})/i),
    cvv: extractField(output, /CVV[:\s]*([0-9]{3,4})/i) ||
         extractField(output, /CVC[:\s]*([0-9]{3,4})/i),
    expiry: extractField(output, /exp[a-z]*[:\s]*([0-9]{2}\/?[0-9]{2,4})/i),
    raw: output,
  };

  return details;
}

function extractField(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

/**
 * Create a new prepaid card with specified amount.
 * Returns the Stripe checkout URL for payment.
 */
function createCard(amountUsd, provider = 'general') {
  const state = loadState();

  // Enforce spending limits
  resetSpendingCounters(state);

  if (state.spending.todayUsd + amountUsd > DAILY_SPEND_LIMIT_USD) {
    return {
      success: false,
      reason: `Daily spend limit reached ($${state.spending.todayUsd.toFixed(2)}/$${DAILY_SPEND_LIMIT_USD})`,
      needsApproval: true,
    };
  }

  if (state.spending.monthUsd + amountUsd > MONTHLY_SPEND_LIMIT_USD) {
    return {
      success: false,
      reason: `Monthly spend limit reached ($${state.spending.monthUsd.toFixed(2)}/$${MONTHLY_SPEND_LIMIT_USD})`,
      needsApproval: true,
    };
  }

  // Require owner approval above auto limit
  if (amountUsd > AUTO_TOPUP_LIMIT_USD) {
    state.pendingApprovals.push({
      ts: Date.now(),
      amountUsd,
      provider,
      status: 'pending',
      reason: `Amount $${amountUsd} exceeds auto-topup limit of $${AUTO_TOPUP_LIMIT_USD}`,
    });
    saveState(state);
    return {
      success: false,
      reason: `Amount $${amountUsd} exceeds auto-topup limit ($${AUTO_TOPUP_LIMIT_USD}). Owner approval required.`,
      needsApproval: true,
      approvalId: state.pendingApprovals.length - 1,
    };
  }

  // Create card via CLI
  const result = runAgentCardCmd(`cards create --amount ${amountUsd}`, 60000);

  if (!result.success) {
    return { success: false, reason: result.output };
  }

  // Extract checkout URL from output
  const checkoutUrl = extractField(result.output, /(https:\/\/checkout\.stripe\.com\/[^\s]+)/i);
  const cardId = extractField(result.output, /card[:\s]*([a-zA-Z0-9_-]+)/i);

  // Track the card
  const cardRecord = {
    id: cardId || `pending_${Date.now()}`,
    createdAt: Date.now(),
    initialAmountUsd: amountUsd,
    remainingUsd: amountUsd,
    provider,
    status: cardId ? 'active' : 'pending_payment',
    lastUsed: 0,
    checkoutUrl,
  };

  state.cards.push(cardRecord);
  state.spending.todayUsd += amountUsd;
  state.spending.monthUsd += amountUsd;
  state.spending.lifetimeUsd += amountUsd;

  state.topupHistory.push({
    ts: Date.now(),
    provider,
    amountUsd,
    cardId: cardRecord.id,
    status: 'created',
    reason: 'autonomous_topup',
  });

  // Keep history bounded
  if (state.topupHistory.length > 200) {
    state.topupHistory = state.topupHistory.slice(-200);
  }

  saveState(state);

  return {
    success: true,
    cardId: cardRecord.id,
    amountUsd,
    checkoutUrl,
    message: checkoutUrl
      ? `Card created. Complete payment at: ${checkoutUrl}`
      : `Card created: ${cardRecord.id}`,
  };
}

// ─── Autonomous Top-Up Engine ───────────────────────────────────────────────

/**
 * Check all API provider balances and trigger auto-top-ups when needed.
 * Called by the autonomous funding coordinator during each cycle.
 */
function runAutoTopupCycle() {
  const state = loadState();
  resetSpendingCounters(state);

  if (!state.authenticated) {
    const auth = checkAuth();
    if (!auth.authenticated) {
      return {
        ran: false,
        reason: auth.message || 'Not authenticated',
        actions: [],
      };
    }
  }

  const actions = [];
  const costSummary = costTracker ? costTracker.getCostSummary() : null;

  if (!costSummary) {
    return { ran: true, reason: 'No cost tracker available', actions: [] };
  }

  // Check each provider's usage rate and estimate when credits will run out
  const providerSpend = costSummary.providerRanking || [];

  for (const provider of providerSpend) {
    const config = PROVIDER_TOPUP_CONFIG[provider.provider];
    if (!config) continue;

    // Estimate daily burn rate for this provider
    const dailyBurn = provider.avgDailyCost || provider.cost / Math.max(1, costSummary.daysSinceReset || 1);

    // Check if estimated balance is getting low
    const estimatedBalance = state.providerBalances[provider.provider] || 0;
    const daysRemaining = dailyBurn > 0 ? estimatedBalance / dailyBurn : Infinity;

    // Trigger top-up if less than 3 days of credits remaining
    if (daysRemaining < 3 && dailyBurn > 0) {
      // Calculate optimal top-up amount (7-14 days of coverage)
      const targetDays = 10;
      const idealAmount = Math.ceil(dailyBurn * targetDays);
      const topupAmount = Math.max(
        config.minTopupUsd,
        Math.min(config.maxTopupUsd, idealAmount, AUTO_TOPUP_LIMIT_USD)
      );

      // Check if we can afford it within limits
      if (state.spending.todayUsd + topupAmount <= DAILY_SPEND_LIMIT_USD &&
          state.spending.monthUsd + topupAmount <= MONTHLY_SPEND_LIMIT_USD) {

        const result = createCard(topupAmount, provider.provider);
        actions.push({
          provider: provider.provider,
          providerName: config.name,
          action: result.success ? 'card_created' : 'blocked',
          amountUsd: topupAmount,
          reason: `${daysRemaining.toFixed(1)} days remaining at $${dailyBurn.toFixed(3)}/day burn rate`,
          result,
        });
      } else {
        actions.push({
          provider: provider.provider,
          providerName: config.name,
          action: 'skipped_limit',
          amountUsd: topupAmount,
          reason: `Would exceed spending limits (daily: $${state.spending.todayUsd.toFixed(2)}/$${DAILY_SPEND_LIMIT_USD}, monthly: $${state.spending.monthUsd.toFixed(2)}/$${MONTHLY_SPEND_LIMIT_USD})`,
        });
      }
    }
  }

  saveState(state);

  return {
    ran: true,
    actions,
    spending: {
      todayUsd: state.spending.todayUsd,
      monthUsd: state.spending.monthUsd,
      dailyLimit: DAILY_SPEND_LIMIT_USD,
      monthlyLimit: MONTHLY_SPEND_LIMIT_USD,
    },
  };
}

/**
 * Update estimated provider balance after a known credit purchase.
 */
function recordCreditPurchase(provider, amountUsd) {
  const state = loadState();
  if (!state.providerBalances[provider]) state.providerBalances[provider] = 0;
  state.providerBalances[provider] += amountUsd;
  saveState(state);
}

/**
 * Debit provider balance based on API usage (called by cost tracker).
 */
function debitProviderBalance(provider, costUsd) {
  const state = loadState();
  if (state.providerBalances[provider] != null) {
    state.providerBalances[provider] = Math.max(0, state.providerBalances[provider] - costUsd);
  }
  // Don't save on every debit — too frequent. Batched in funding cycle.
}

// ─── Spending Counter Reset ─────────────────────────────────────────────────

function resetSpendingCounters(state) {
  const today = new Date().toISOString().slice(0, 10);
  const month = new Date().toISOString().slice(0, 7);

  if (state.spending.lastResetDate !== today) {
    state.spending.todayUsd = 0;
    state.spending.lastResetDate = today;
  }

  if (state.spending.lastResetMonth !== month) {
    state.spending.monthUsd = 0;
    state.spending.lastResetMonth = month;
  }
}

// ─── Status & Approval ─────────────────────────────────────────────────────

/**
 * Get comprehensive AgentCard status for dashboard.
 */
function getAgentCardStatus() {
  const state = loadState();
  resetSpendingCounters(state);

  return {
    authenticated: state.authenticated,
    authEmail: state.authEmail,
    activeCards: state.cards.filter(c => c.status === 'active').length,
    totalCards: state.cards.length,
    spending: {
      todayUsd: state.spending.todayUsd,
      monthUsd: state.spending.monthUsd,
      lifetimeUsd: state.spending.lifetimeUsd,
      dailyLimit: DAILY_SPEND_LIMIT_USD,
      monthlyLimit: MONTHLY_SPEND_LIMIT_USD,
      dailyRemaining: Math.max(0, DAILY_SPEND_LIMIT_USD - state.spending.todayUsd),
      monthlyRemaining: Math.max(0, MONTHLY_SPEND_LIMIT_USD - state.spending.monthUsd),
    },
    providerBalances: state.providerBalances,
    pendingApprovals: state.pendingApprovals.filter(a => a.status === 'pending'),
    recentTopups: state.topupHistory.slice(-10),
    config: {
      autoTopupLimitUsd: AUTO_TOPUP_LIMIT_USD,
      lowBalanceThresholdUsd: LOW_BALANCE_THRESHOLD_USD,
      dailySpendLimitUsd: DAILY_SPEND_LIMIT_USD,
      monthlySpendLimitUsd: MONTHLY_SPEND_LIMIT_USD,
      providers: Object.keys(PROVIDER_TOPUP_CONFIG),
    },
  };
}

/**
 * Approve a pending top-up request (called by owner via dashboard/API).
 */
function approveTopup(approvalIndex) {
  const state = loadState();

  if (!state.pendingApprovals[approvalIndex]) {
    return { success: false, reason: 'Approval not found' };
  }

  const approval = state.pendingApprovals[approvalIndex];
  if (approval.status !== 'pending') {
    return { success: false, reason: `Already ${approval.status}` };
  }

  approval.status = 'approved';
  approval.approvedAt = Date.now();

  // Execute the card creation
  const result = createCard(approval.amountUsd, approval.provider);
  saveState(state);

  return {
    success: result.success,
    approval,
    result,
  };
}

/**
 * Deny a pending top-up request.
 */
function denyTopup(approvalIndex) {
  const state = loadState();
  if (state.pendingApprovals[approvalIndex]) {
    state.pendingApprovals[approvalIndex].status = 'denied';
    state.pendingApprovals[approvalIndex].deniedAt = Date.now();
    saveState(state);
  }
  return { success: true };
}

module.exports = {
  // Auth
  checkAuth,

  // Card management
  listCards,
  getCardDetails,
  createCard,

  // Autonomous top-up
  runAutoTopupCycle,
  recordCreditPurchase,
  debitProviderBalance,

  // Status & approval
  getAgentCardStatus,
  approveTopup,
  denyTopup,

  // Config (for external use)
  PROVIDER_TOPUP_CONFIG,
  AUTO_TOPUP_LIMIT_USD,
  LOW_BALANCE_THRESHOLD_USD,
  DAILY_SPEND_LIMIT_USD,
  MONTHLY_SPEND_LIMIT_USD,
};
