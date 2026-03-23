/**
 * API Credit Monitor & Self-Funding Ledger
 *
 * Tracks per-provider AI API spend, checks credit balances where providers
 * expose them, alerts when running low, and reserves revenue to keep the
 * lights on.
 *
 * Flow:
 *   1.  Every model query logs (provider, tokens, estimated cost) here.
 *   2.  Periodically checks provider balances (OpenAI, OpenRouter).
 *   3.  Fires Discord alerts when balance < threshold.
 *   4.  Exposes `getApiCreditReserveBps()` so the distribution engine can
 *       withhold a slice of revenue for API re-funding.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

// ── Types ──────────────────────────────────────────────────────────────────

interface ProviderSpend {
  totalTokens: number;
  totalCostUsd: number;
  queriesSinceReset: number;
  lastQueryAt: number;
}

interface ProviderBalance {
  balanceUsd: number | null;          // null = could not retrieve
  lastCheckedAt: number;
  error?: string;
}

interface CreditLedger {
  version: 2;
  startedAt: number;
  spend: Record<string, ProviderSpend>;
  balances: Record<string, ProviderBalance>;
  totalSpendUsd: number;
  reservedUsd: number;                // running total set aside from revenue
  lastAlertAt: number;
}

// ── Cost table (USD per 1 K tokens, approximations) ────────────────────────

const COST_PER_1K: Record<string, { input: number; output: number }> = {
  'grok':       { input: 0.005,  output: 0.015 },
  'openai':     { input: 0.00015, output: 0.0006 },  // gpt-4o-mini
  'anthropic':  { input: 0.003,  output: 0.015 },    // claude-3.5-sonnet
  'perplexity': { input: 0.003,  output: 0.015 },    // sonar-pro
  'openrouter': { input: 0.00015, output: 0.0006 },
  'groq':       { input: 0.00059, output: 0.00079 },
  'gemini':     { input: 0.000075, output: 0.0003 },
  'mistral':    { input: 0.002,  output: 0.006 },
  'cerebras':   { input: 0.0006, output: 0.0006 },
  'nvidia':     { input: 0.00054, output: 0.00054 },
  'huggingface': { input: 0.0001, output: 0.0001 },
  'clawd':      { input: 0, output: 0 },  // self-hosted
  'ollama-local': { input: 0, output: 0 },
};

// ── Singleton state ────────────────────────────────────────────────────────

let ledger: CreditLedger | null = null;
let dirty = false;

function ledgerPath(): string {
  return resolve(
    process.cwd(),
    process.env.API_CREDIT_LEDGER_FILE || 'data/api-credit-ledger.json'
  );
}

function loadLedger(): CreditLedger {
  if (ledger) return ledger;
  try {
    const raw = readFileSync(ledgerPath(), 'utf-8');
    ledger = JSON.parse(raw) as CreditLedger;
  } catch {
    ledger = {
      version: 2,
      startedAt: Date.now(),
      spend: {},
      balances: {},
      totalSpendUsd: 0,
      reservedUsd: 0,
      lastAlertAt: 0,
    };
  }
  return ledger;
}

function saveLedger(): void {
  if (!dirty || !ledger) return;
  try {
    const p = ledgerPath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(ledger, null, 2));
    dirty = false;
  } catch (err) {
    console.error('[api-credit] Failed to persist ledger:', err);
  }
}

// Debounced save — writes at most once every 30 s
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveLedger();
    saveTimer = null;
  }, 30_000);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Log a model query's cost.  Call this after every AI response.
 */
export function recordApiSpend(
  provider: string,
  inputTokens: number,
  outputTokens: number
): void {
  const l = loadLedger();
  const key = provider.toLowerCase();
  if (!l.spend[key]) {
    l.spend[key] = { totalTokens: 0, totalCostUsd: 0, queriesSinceReset: 0, lastQueryAt: 0 };
  }

  const rates = COST_PER_1K[key] || { input: 0.002, output: 0.006 };
  const cost = (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;

  l.spend[key].totalTokens += inputTokens + outputTokens;
  l.spend[key].totalCostUsd += cost;
  l.spend[key].queriesSinceReset += 1;
  l.spend[key].lastQueryAt = Date.now();

  l.totalSpendUsd += cost;
  dirty = true;
  scheduleSave();
}

/**
 * Get cumulative spend by provider and overall.
 */
export function getSpendSummary(): { byProvider: Record<string, ProviderSpend>; totalUsd: number } {
  const l = loadLedger();
  return { byProvider: { ...l.spend }, totalUsd: l.totalSpendUsd };
}

/**
 * Returns the BPS to withhold from revenue distribution for API credit reserves.
 */
export function getApiCreditReserveBps(): number {
  const raw = parseInt(process.env.API_CREDIT_RESERVE_BPS || '500', 10);
  return Math.max(0, Math.min(2000, raw)); // cap at 20 %
}

/**
 * Record that revenue was set aside for API credits.
 */
export function recordReservedRevenue(usdAmount: number): void {
  const l = loadLedger();
  l.reservedUsd += usdAmount;
  dirty = true;
  scheduleSave();
}

/**
 * Get net API runway: reserved - spent.
 */
export function getApiRunway(): { reservedUsd: number; spentUsd: number; remainingUsd: number } {
  const l = loadLedger();
  return {
    reservedUsd: l.reservedUsd,
    spentUsd: l.totalSpendUsd,
    remainingUsd: Math.max(0, l.reservedUsd - l.totalSpendUsd),
  };
}

// ── Balance checks (providers that expose credit/usage endpoints) ──────────

const BALANCE_CHECK_INTERVAL = 3600_000; // 1 h

async function checkOpenAIBalance(): Promise<number | null> {
  // OpenAI doesn't have a public balance endpoint for project API keys.
  // We return null; cost tracking via recordApiSpend is the source of truth.
  return null;
}

async function checkOpenRouterBalance(): Promise<number | null> {
  const key = process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY;
  if (!key) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    // OpenRouter returns { data: { label, usage, limit, is_free_tier, rate_limit } }
    const limit = data?.data?.limit ?? null;
    const usage = data?.data?.usage ?? 0;
    if (limit === null) return null;   // unlimited key
    return Math.max(0, limit - usage);
  } catch {
    return null;
  }
}

async function checkAnthropicBalance(): Promise<number | null> {
  // Anthropic doesn't expose a public balance endpoint.
  return null;
}

async function checkPerplexityBalance(): Promise<number | null> {
  // Perplexity doesn't have a public balance/usage endpoint.
  return null;
}

/**
 * Refresh all provider balances (best-effort).  Non-blocking.
 */
export async function refreshProviderBalances(): Promise<Record<string, ProviderBalance>> {
  const l = loadLedger();
  const now = Date.now();

  const checks: [string, () => Promise<number | null>][] = [
    ['openai', checkOpenAIBalance],
    ['openrouter', checkOpenRouterBalance],
    ['anthropic', checkAnthropicBalance],
    ['perplexity', checkPerplexityBalance],
  ];

  await Promise.allSettled(
    checks.map(async ([name, fn]) => {
      const existing = l.balances[name];
      if (existing && (now - existing.lastCheckedAt) < BALANCE_CHECK_INTERVAL) return;
      try {
        const bal = await fn();
        l.balances[name] = { balanceUsd: bal, lastCheckedAt: now };
      } catch (err) {
        l.balances[name] = {
          balanceUsd: null,
          lastCheckedAt: now,
          error: err instanceof Error ? err.message : 'unknown',
        };
      }
    })
  );

  dirty = true;
  scheduleSave();
  return { ...l.balances };
}

// ── Alerting ───────────────────────────────────────────────────────────────

const ALERT_COOLDOWN = 3600_000; // at most one alert per hour

export async function checkAndAlert(): Promise<void> {
  const l = loadLedger();
  const now = Date.now();
  if (now - l.lastAlertAt < ALERT_COOLDOWN) return;

  const threshold = parseFloat(process.env.API_CREDIT_ALERT_THRESHOLD_USD || '5.00');
  const runway = getApiRunway();

  // Alert conditions:
  // 1. Internal runway is low (reserved - spent < threshold)
  // 2. OpenRouter balance is low (if available)
  const alerts: string[] = [];

  if (runway.remainingUsd < threshold && runway.reservedUsd > 0) {
    alerts.push(
      `API credit runway low: $${runway.remainingUsd.toFixed(2)} remaining ` +
      `(reserved $${runway.reservedUsd.toFixed(2)}, spent $${runway.spentUsd.toFixed(2)})`
    );
  }

  const orBalance = l.balances['openrouter'];
  if (orBalance?.balanceUsd !== null && orBalance?.balanceUsd !== undefined && orBalance.balanceUsd < threshold) {
    alerts.push(`OpenRouter credit balance low: $${orBalance.balanceUsd.toFixed(2)} remaining`);
  }

  if (alerts.length === 0) return;

  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('[api-credit] Low balance alert but no ALERT_WEBHOOK_URL:', alerts.join('; '));
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const mention = process.env.ALERT_MENTION || '';
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `${mention} **API Credit Alert**\n${alerts.join('\n')}`.trim(),
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    l.lastAlertAt = now;
    dirty = true;
    scheduleSave();
  } catch (err) {
    console.error('[api-credit] Failed to send alert:', err);
  }
}

// ── Periodic tick — call from your main loop or cron ───────────────────────

export async function apiCreditTick(): Promise<void> {
  await refreshProviderBalances();
  await checkAndAlert();
}

// ── Dashboard summary ──────────────────────────────────────────────────────

export function getCreditDashboard(): {
  spend: Record<string, ProviderSpend>;
  balances: Record<string, ProviderBalance>;
  runway: { reservedUsd: number; spentUsd: number; remainingUsd: number };
  reserveBps: number;
} {
  const l = loadLedger();
  return {
    spend: { ...l.spend },
    balances: { ...l.balances },
    runway: getApiRunway(),
    reserveBps: getApiCreditReserveBps(),
  };
 * API Credit Monitor
 * Tracks per-provider AI query spend for cost monitoring and self-funding loop.
 */

interface SpendRecord {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  timestamp: number;
}

// Per-model cost estimates (USD per 1M tokens, input/output)
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  default: { input: 0.50, output: 1.50 },
};

function estimateCost(modelName: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_COSTS[modelName] ?? MODEL_COSTS.default;
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

const spendLog: SpendRecord[] = [];
let totalSpendUsd = 0;

/**
 * Record API spend for a completed model query.
 * Called by modelOrchestrator after each successful response.
 */
export function recordApiSpend(
  modelName: string,
  inputTokens: number,
  outputTokens: number
): void {
  const estimatedCostUsd = estimateCost(modelName, inputTokens, outputTokens);
  const record: SpendRecord = {
    modelName,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    timestamp: Date.now(),
  };
  spendLog.push(record);
  totalSpendUsd += estimatedCostUsd;
}

/**
 * Get total estimated spend since process start.
 */
export function getTotalSpendUsd(): number {
  return totalSpendUsd;
}

/**
 * Get recent spend records (last N entries).
 */
export function getRecentSpend(limit = 100): SpendRecord[] {
  return spendLog.slice(-limit);
}

/**
 * Get spend summary grouped by model.
 */
export function getSpendByModel(): Record<string, { calls: number; totalCostUsd: number }> {
  const summary: Record<string, { calls: number; totalCostUsd: number }> = {};
  for (const record of spendLog) {
    if (!summary[record.modelName]) {
      summary[record.modelName] = { calls: 0, totalCostUsd: 0 };
    }
    summary[record.modelName].calls++;
    summary[record.modelName].totalCostUsd += record.estimatedCostUsd;
  }
  return summary;
}
