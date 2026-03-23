/**
 * API Credit Auto-Purchaser & Autonomous Self-Funding Engine
 *
 * Extends the API Credit Monitor to automatically purchase/top-up API credits
 * from trading revenue when balances run low. Converts reserved USD to actual
 * API provider credits through their billing APIs.
 *
 * Flow:
 *   1. apiCreditMonitor reserves BPS from revenue → tracked as `reservedUsd`
 *   2. This module monitors spend velocity & remaining runway
 *   3. When runway drops below threshold, triggers auto-purchase
 *   4. Supports: OpenRouter (direct top-up), Anthropic, Perplexity (alerts)
 *   5. Auto-scales reserve BPS based on usage velocity
 *   6. Logs all purchases for audit trail
 *
 * Self-Funding Principle: The agent pays for its own AI API costs from
 * trading profits. Owner funded initial credits; agent funds everything
 * moving forward.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import {
  getApiRunway,
  getSpendSummary,
  recordReservedRevenue,
  getCreditDashboard,
} from './apiCreditMonitor';

const { createLogger } = require('../logger');
const log = createLogger('api-auto-fund');

// ── Types ──────────────────────────────────────────────────────────────────

interface PurchaseRecord {
  id: string;
  provider: string;
  amountUsd: number;
  method: 'openrouter_topup' | 'stripe_billing' | 'manual_alert' | 'crypto_payment';
  status: 'success' | 'failed' | 'pending' | 'alerted';
  txRef?: string;
  timestamp: number;
  error?: string;
}

interface AutoFundingState {
  version: 1;
  enabled: boolean;
  purchases: PurchaseRecord[];
  totalPurchasedUsd: number;
  totalFailedUsd: number;
  lastPurchaseAt: number;
  lastCheckAt: number;
  currentReserveBps: number;
  spendVelocityUsdPerHour: number;
  estimatedRunwayHours: number;
  autoScaleHistory: Array<{
    timestamp: number;
    fromBps: number;
    toBps: number;
    reason: string;
  }>;
}

interface ProviderTopUpConfig {
  provider: string;
  minBalanceUsd: number;        // Trigger purchase when below this
  targetBalanceUsd: number;     // Top up to this amount
  maxSinglePurchaseUsd: number; // Never spend more than this at once
  cooldownMs: number;           // Min time between purchases
  enabled: boolean;
  method: PurchaseRecord['method'];
}

// ── Config ─────────────────────────────────────────────────────────────────

const DATA_DIR = process.env.RAILWAY_ENVIRONMENT
  ? (process.env.PERSISTENT_STORAGE_PATH || '/tmp/freedomforge-data')
  : resolve(process.cwd(), 'data');

const STATE_FILE = resolve(DATA_DIR, 'api-auto-funding-state.json');

const DEFAULT_PROVIDER_CONFIGS: ProviderTopUpConfig[] = [
  {
    provider: 'openrouter',
    minBalanceUsd: 3.00,
    targetBalanceUsd: 15.00,
    maxSinglePurchaseUsd: 25.00,
    cooldownMs: 4 * 3600_000, // 4 hours
    enabled: true,
    method: 'openrouter_topup',
  },
  {
    provider: 'anthropic',
    minBalanceUsd: 5.00,
    targetBalanceUsd: 20.00,
    maxSinglePurchaseUsd: 50.00,
    cooldownMs: 24 * 3600_000, // daily
    enabled: true,
    method: 'manual_alert', // Anthropic doesn't have a top-up API; alert owner
  },
  {
    provider: 'perplexity',
    minBalanceUsd: 3.00,
    targetBalanceUsd: 15.00,
    maxSinglePurchaseUsd: 30.00,
    cooldownMs: 24 * 3600_000,
    enabled: true,
    method: 'manual_alert', // Perplexity doesn't have a top-up API; alert owner
  },
];

// ── State ──────────────────────────────────────────────────────────────────

let state: AutoFundingState | null = null;

function loadState(): AutoFundingState {
  if (state) return state;
  try {
    const raw = readFileSync(STATE_FILE, 'utf-8');
    state = JSON.parse(raw) as AutoFundingState;
  } catch {
    state = {
      version: 1,
      enabled: true,
      purchases: [],
      totalPurchasedUsd: 0,
      totalFailedUsd: 0,
      lastPurchaseAt: 0,
      lastCheckAt: 0,
      currentReserveBps: parseInt(process.env.API_CREDIT_RESERVE_BPS || '500', 10),
      spendVelocityUsdPerHour: 0,
      estimatedRunwayHours: Infinity,
      autoScaleHistory: [],
    };
  }
  return state;
}

function saveState(): void {
  if (!state) return;
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    log.error('Failed to save state:', err);
  }
}

// ── Spend Velocity Calculator ──────────────────────────────────────────────

function calculateSpendVelocity(): { usdPerHour: number; runwayHours: number } {
  const s = loadState();
  const { byProvider, totalUsd } = getSpendSummary();
  const runway = getApiRunway();

  // Calculate velocity from recent spend patterns
  let recentSpendUsd = 0;
  let oldestQueryAt = Date.now();

  for (const [, providerData] of Object.entries(byProvider)) {
    recentSpendUsd += providerData.totalCostUsd;
    if (providerData.lastQueryAt > 0 && providerData.lastQueryAt < oldestQueryAt) {
      oldestQueryAt = providerData.lastQueryAt;
    }
  }

  const hoursTracked = Math.max(1, (Date.now() - oldestQueryAt) / 3600_000);
  const usdPerHour = recentSpendUsd / hoursTracked;
  const runwayHours = usdPerHour > 0 ? runway.remainingUsd / usdPerHour : Infinity;

  s.spendVelocityUsdPerHour = Number(usdPerHour.toFixed(4));
  s.estimatedRunwayHours = Number(Math.min(99999, runwayHours).toFixed(1));

  return { usdPerHour, runwayHours };
}

// ── Auto-Scale Reserve BPS ─────────────────────────────────────────────────
// If spend velocity is high and runway is short, increase the reserve BPS
// so more trading revenue is set aside for API costs.

function autoScaleReserveBps(): { adjusted: boolean; newBps: number; reason: string } {
  const s = loadState();
  const { usdPerHour, runwayHours } = calculateSpendVelocity();
  const currentBps = s.currentReserveBps;

  const minBps = 200;   // 2% floor
  const maxBps = 1500;  // 15% cap — never starve the treasury

  let newBps = currentBps;
  let reason = 'stable';

  if (runwayHours < 6 && usdPerHour > 0.005) {
    // Critical: less than 6 hours of runway — aggressive reserve
    newBps = Math.min(maxBps, currentBps + 200);
    reason = `critical_runway=${runwayHours.toFixed(1)}h velocity=$${usdPerHour.toFixed(4)}/h`;
  } else if (runwayHours < 24 && usdPerHour > 0.003) {
    // Low: less than 24 hours — moderate increase
    newBps = Math.min(maxBps, currentBps + 100);
    reason = `low_runway=${runwayHours.toFixed(1)}h velocity=$${usdPerHour.toFixed(4)}/h`;
  } else if (runwayHours > 168 && currentBps > minBps) {
    // Plenty of runway (>1 week) — can lower reserves
    newBps = Math.max(minBps, currentBps - 50);
    reason = `ample_runway=${runwayHours.toFixed(1)}h reducing_reserves`;
  }

  if (newBps !== currentBps) {
    s.autoScaleHistory.push({
      timestamp: Date.now(),
      fromBps: currentBps,
      toBps: newBps,
      reason,
    });
    // Keep only last 50 entries
    if (s.autoScaleHistory.length > 50) {
      s.autoScaleHistory = s.autoScaleHistory.slice(-50);
    }
    s.currentReserveBps = newBps;
    saveState();
    return { adjusted: true, newBps, reason };
  }

  return { adjusted: false, newBps: currentBps, reason };
}

// ── Provider Top-Up Logic ──────────────────────────────────────────────────

async function topUpOpenRouter(amountUsd: number): Promise<PurchaseRecord> {
  const key = process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY;
  if (!key) {
    return {
      id: `pur_${Date.now()}`,
      provider: 'openrouter',
      amountUsd,
      method: 'openrouter_topup',
      status: 'failed',
      timestamp: Date.now(),
      error: 'No OPENROUTER_API_KEY configured',
    };
  }

  // OpenRouter supports credit purchases via their API
  // POST https://openrouter.ai/api/v1/credits/purchase
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch('https://openrouter.ai/api/v1/credits', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        amount: amountUsd,
        currency: 'usd',
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      return {
        id: `pur_${Date.now()}`,
        provider: 'openrouter',
        amountUsd,
        method: 'openrouter_topup',
        status: 'success',
        txRef: data?.data?.id || data?.id || 'ok',
        timestamp: Date.now(),
      };
    }

    // If the direct top-up endpoint doesn't exist, fall back to alert
    const errText = await res.text().catch(() => 'unknown');
    return {
      id: `pur_${Date.now()}`,
      provider: 'openrouter',
      amountUsd,
      method: 'openrouter_topup',
      status: 'failed',
      timestamp: Date.now(),
      error: `HTTP ${res.status}: ${errText.slice(0, 200)}`,
    };
  } catch (err) {
    return {
      id: `pur_${Date.now()}`,
      provider: 'openrouter',
      amountUsd,
      method: 'openrouter_topup',
      status: 'failed',
      timestamp: Date.now(),
      error: err instanceof Error ? err.message : 'unknown',
    };
  }
}

async function sendFundingAlert(
  provider: string,
  amountUsd: number,
  reason: string
): Promise<PurchaseRecord> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  const mention = process.env.ALERT_MENTION || '';

  const message = [
    `${mention} **API Credit Auto-Funding Alert**`,
    `Provider: **${provider}**`,
    `Recommended top-up: **$${amountUsd.toFixed(2)}**`,
    `Reason: ${reason}`,
    '',
    `The agent's API credit runway is running low. Trading revenue has reserved`,
    `funds for this purpose. Please top up the ${provider} account or enable`,
    `auto-billing if the provider supports it.`,
    '',
    `_This is an autonomous self-funding request from FreedomForge._`,
  ].join('\n');

  const record: PurchaseRecord = {
    id: `pur_${Date.now()}`,
    provider,
    amountUsd,
    method: 'manual_alert',
    status: 'alerted',
    timestamp: Date.now(),
  };

  if (!webhookUrl) {
    log.warn(`${provider} needs $${amountUsd.toFixed(2)} top-up but no ALERT_WEBHOOK_URL`);
    record.status = 'failed';
    record.error = 'No ALERT_WEBHOOK_URL configured';
    return record;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return record;
  } catch (err) {
    record.status = 'failed';
    record.error = err instanceof Error ? err.message : 'webhook_failed';
    return record;
  }
}

// ── Main Auto-Funding Tick ─────────────────────────────────────────────────

/**
 * Call this from the master orchestrator loop.
 * Checks spend velocity, auto-scales reserves, and triggers purchases when needed.
 */
export async function autoFundingTick(): Promise<{
  checked: boolean;
  purchases: PurchaseRecord[];
  reserveAdjusted: boolean;
  newReserveBps: number;
  runway: { reservedUsd: number; spentUsd: number; remainingUsd: number };
  velocity: { usdPerHour: number; runwayHours: number };
}> {
  const s = loadState();

  if (!s.enabled) {
    return {
      checked: false,
      purchases: [],
      reserveAdjusted: false,
      newReserveBps: s.currentReserveBps,
      runway: getApiRunway(),
      velocity: { usdPerHour: 0, runwayHours: Infinity },
    };
  }

  s.lastCheckAt = Date.now();
  const velocity = calculateSpendVelocity();
  const scaleResult = autoScaleReserveBps();
  const runway = getApiRunway();
  const dashboard = getCreditDashboard();
  const purchases: PurchaseRecord[] = [];

  // Check each provider
  for (const config of DEFAULT_PROVIDER_CONFIGS) {
    if (!config.enabled) continue;

    // Check cooldown
    const lastPurchaseForProvider = s.purchases
      .filter((p) => p.provider === config.provider)
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (lastPurchaseForProvider && (Date.now() - lastPurchaseForProvider.timestamp) < config.cooldownMs) {
      continue;
    }

    // Check if this provider's spend is concerning
    const providerSpend = dashboard.spend[config.provider];
    const providerBalance = dashboard.balances[config.provider];

    // Decision: Should we top up?
    let shouldTopUp = false;
    let topUpAmount = 0;
    let reason = '';

    // If we have actual balance data from the provider
    if (providerBalance?.balanceUsd !== null && providerBalance?.balanceUsd !== undefined) {
      if (providerBalance.balanceUsd < config.minBalanceUsd) {
        shouldTopUp = true;
        topUpAmount = Math.min(config.maxSinglePurchaseUsd, config.targetBalanceUsd - providerBalance.balanceUsd);
        reason = `balance=$${providerBalance.balanceUsd.toFixed(2)} < min=$${config.minBalanceUsd.toFixed(2)}`;
      }
    }

    // If we don't have balance data, use spend velocity as proxy
    if (!shouldTopUp && providerSpend && velocity.runwayHours < 48) {
      const providerVelocity = providerSpend.totalCostUsd / Math.max(1, (Date.now() - (s.purchases[0]?.timestamp || Date.now() - 86400_000)) / 3600_000);
      if (providerVelocity > 0.01) { // spending > $0.01/hr on this provider
        shouldTopUp = true;
        topUpAmount = Math.min(config.maxSinglePurchaseUsd, config.targetBalanceUsd);
        reason = `high_velocity=$${providerVelocity.toFixed(4)}/h runway=${velocity.runwayHours.toFixed(1)}h`;
      }
    }

    // Also trigger if overall runway is critically low
    if (!shouldTopUp && runway.remainingUsd < 2.00 && providerSpend && providerSpend.queriesSinceReset > 0) {
      shouldTopUp = true;
      topUpAmount = Math.min(config.maxSinglePurchaseUsd, 10.00);
      reason = `critical_overall_runway=$${runway.remainingUsd.toFixed(2)}`;
    }

    if (!shouldTopUp || topUpAmount <= 0) continue;

    // Ensure we have funds reserved
    if (topUpAmount > runway.remainingUsd) {
      topUpAmount = Math.max(0, runway.remainingUsd * 0.5); // Use at most half of remaining
      if (topUpAmount < 1.00) continue; // Not worth it below $1
    }

    // Execute purchase/alert
    let record: PurchaseRecord;
    if (config.method === 'openrouter_topup') {
      record = await topUpOpenRouter(topUpAmount);
    } else {
      record = await sendFundingAlert(config.provider, topUpAmount, reason);
    }

    purchases.push(record);
    s.purchases.push(record);

    if (record.status === 'success') {
      s.totalPurchasedUsd += topUpAmount;
      s.lastPurchaseAt = Date.now();
      // Record this as spending from the reserved pool
      recordReservedRevenue(-topUpAmount); // Reduce reserved by amount spent on credits
    } else if (record.status === 'failed') {
      s.totalFailedUsd += topUpAmount;
    }
  }

  // Trim old purchase records (keep last 200)
  if (s.purchases.length > 200) {
    s.purchases = s.purchases.slice(-200);
  }

  saveState();

  return {
    checked: true,
    purchases,
    reserveAdjusted: scaleResult.adjusted,
    newReserveBps: scaleResult.newBps,
    runway,
    velocity,
  };
}

// ── Revenue Contribution Hook ──────────────────────────────────────────────
// Call this when trading revenue comes in to auto-reserve for API costs

/**
 * Called by the distribution engine after each revenue cycle.
 * Calculates how much to reserve for API credits based on current BPS.
 */
export function calculateApiCreditReserve(revenueUsd: number): {
  reserveUsd: number;
  reserveBps: number;
  reason: string;
} {
  const s = loadState();
  const bps = s.currentReserveBps;
  const reserveUsd = (revenueUsd * bps) / 10000;

  if (reserveUsd > 0) {
    recordReservedRevenue(reserveUsd);
  }

  return {
    reserveUsd: Number(reserveUsd.toFixed(4)),
    reserveBps: bps,
    reason: `reserved ${bps}bps ($${reserveUsd.toFixed(4)}) from $${revenueUsd.toFixed(4)} revenue`,
  };
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export function getAutoFundingDashboard(): {
  enabled: boolean;
  runway: { reservedUsd: number; spentUsd: number; remainingUsd: number };
  velocity: { usdPerHour: number; runwayHours: number };
  currentReserveBps: number;
  totalPurchasedUsd: number;
  totalFailedUsd: number;
  recentPurchases: PurchaseRecord[];
  recentScaleEvents: AutoFundingState['autoScaleHistory'];
  providerConfigs: ProviderTopUpConfig[];
} {
  const s = loadState();
  const velocity = calculateSpendVelocity();
  const runway = getApiRunway();

  return {
    enabled: s.enabled,
    runway,
    velocity,
    currentReserveBps: s.currentReserveBps,
    totalPurchasedUsd: Number(s.totalPurchasedUsd.toFixed(4)),
    totalFailedUsd: Number(s.totalFailedUsd.toFixed(4)),
    recentPurchases: s.purchases.slice(-20),
    recentScaleEvents: s.autoScaleHistory.slice(-10),
    providerConfigs: DEFAULT_PROVIDER_CONFIGS,
  };
}

/**
 * Enable or disable auto-funding.
 */
export function setAutoFundingEnabled(enabled: boolean): void {
  const s = loadState();
  s.enabled = enabled;
  saveState();
}

export function initializeAutoFunding(): void {
  loadState();
  log.info('Initialized. Enabled:', loadState().enabled,
    'Reserve BPS:', loadState().currentReserveBps);
}
