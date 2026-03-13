/**
 * Autonomous Funding Coordinator — The self-sustaining engine.
 * ═══════════════════════════════════════════════════════════════
 *
 * This is the brain that makes FreedomForge financially autonomous.
 * It coordinates revenue generation, cost tracking, and allocation
 * so the system never needs external funding for API operations.
 *
 * Revenue Streams (all feed into the self-funding loop):
 *   1. Crypto Trading Profits   → Coinbase, Kraken spot engines
 *   2. DeFi Yield Harvesting    → Aave, Compound, Uniswap, Kamino, etc.
 *   3. Arbitrage Profits        → Cross-venue price differences
 *   4. Prediction Market Gains  → Polymarket, Kalshi
 *   5. Staking Rewards          → MultiversX, Solana staking
 *
 * API Consumers (all costs tracked and funded from revenue):
 *   - AI: Grok, OpenAI, Anthropic, Gemini, Groq, Mistral, Cerebras, NVIDIA, OpenRouter, HuggingFace
 *   - Blockchain: Alchemy, Solana RPC, MultiversX API, Zora
 *   - Data: Tavily, CoinGecko, Polymarket data
 *   - Trading: Coinbase, Kraken, Alpaca, IBKR, Kalshi fees
 *   - Finance: Plaid
 *   - Social: X/Twitter, Discord
 *   - Infra: Vercel, gas costs
 *
 * The coordinator runs periodic cycles:
 *   1. Measure API costs since last cycle
 *   2. Check revenue generated since last cycle
 *   3. Route revenue through the allocation waterfall
 *   4. Adjust model routing based on budget (synergy engine)
 *   5. Report self-funding health status
 */

'use strict';

const fs = require('fs');
const path = require('path');

let rio;
try { rio = require('../resilient-io'); } catch { rio = null; }

const costTracker = require('./api-cost-tracker');
const revenueAllocator = require('./revenue-allocator');
const synergyEngine = require('./model-synergy-engine');

let treasuryLedger;
try { treasuryLedger = require('../treasury-ledger'); } catch { treasuryLedger = null; }

let capitalMandate;
try { capitalMandate = require('../capital-mandate'); } catch { capitalMandate = null; }

const DATA_DIR = process.env.VERCEL ? '/tmp/freedomforge-data' : path.resolve(process.cwd(), 'data');
const COORDINATOR_FILE = path.join(DATA_DIR, 'funding-coordinator-state.json');

// ─── State Management ────────────────────────────────────────────────────────

function loadState() {
  try {
    if (rio) return rio.readJsonSafe(COORDINATOR_FILE, { fallback: null }) || createFreshState();
    if (!fs.existsSync(COORDINATOR_FILE)) return createFreshState();
    return JSON.parse(fs.readFileSync(COORDINATOR_FILE, 'utf8'));
  } catch {
    return createFreshState();
  }
}

function saveState(state) {
  state.updatedAt = Date.now();
  try {
    if (rio) { rio.writeJsonAtomic(COORDINATOR_FILE, state); return; }
    fs.mkdirSync(path.dirname(COORDINATOR_FILE), { recursive: true });
    const tmp = COORDINATOR_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, COORDINATOR_FILE);
  } catch (err) {
    console.error('[funding-coordinator] save failed:', err.message);
  }
}

function createFreshState() {
  return {
    // Cycle tracking
    lastCycleAt: 0,
    cycleCount: 0,
    lastRevenueProcessedUsd: 0,

    // Self-funding status
    selfFundingActive: false,
    selfFundingStreak: 0,        // Consecutive days of self-funding
    longestStreak: 0,
    firstSelfFundedAt: null,

    // Revenue tracking per source
    revenueSources: {
      trading: { lifetimeUsd: 0, last24hUsd: 0, lastUpdated: 0 },
      defi_yield: { lifetimeUsd: 0, last24hUsd: 0, lastUpdated: 0 },
      arbitrage: { lifetimeUsd: 0, last24hUsd: 0, lastUpdated: 0 },
      predictions: { lifetimeUsd: 0, last24hUsd: 0, lastUpdated: 0 },
      staking: { lifetimeUsd: 0, last24hUsd: 0, lastUpdated: 0 },
    },

    // Model routing mode
    budgetMode: 'balanced', // 'aggressive' | 'balanced' | 'conservative'

    // Health history
    healthHistory: [],

    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ─── Revenue Processing ─────────────────────────────────────────────────────

/**
 * Process new revenue from any source through the funding pipeline.
 * This is the main entry point called by trading engines, DeFi harvester, etc.
 */
function processRevenue(amountUsd, source = 'trading', meta = {}) {
  if (!amountUsd || amountUsd <= 0) return null;

  const state = loadState();

  // Track by source
  if (!state.revenueSources[source]) {
    state.revenueSources[source] = { lifetimeUsd: 0, last24hUsd: 0, lastUpdated: 0 };
  }
  state.revenueSources[source].lifetimeUsd = Number(
    (state.revenueSources[source].lifetimeUsd + amountUsd).toFixed(4)
  );
  state.revenueSources[source].last24hUsd = Number(
    (state.revenueSources[source].last24hUsd + amountUsd).toFixed(4)
  );
  state.revenueSources[source].lastUpdated = Date.now();

  state.lastRevenueProcessedUsd = amountUsd;

  // Route through the allocation waterfall
  const allocation = revenueAllocator.allocateRevenue(amountUsd, source);

  // Record the API cost debit from the allocation
  if (allocation && allocation.toApiOps > 0) {
    costTracker.recordApiCall('funding_allocation', 0, { note: 'Revenue allocated to API ops' });
  }

  saveState(state);

  return {
    amountUsd,
    source,
    allocation,
    selfFundingActive: state.selfFundingActive,
  };
}

/**
 * Record revenue from a closed trade.
 * Called by the master-orchestrator or trade-reconciler after each profitable trade.
 */
function processTradeRevenue(pnlUsd, venue = 'unknown') {
  if (pnlUsd <= 0) return null;

  // Also track exchange fees as costs
  const feeRate = {
    coinbase: 0.006,
    kraken: 0.004,
    alpaca: 0,
    ibkr: 0.0005,
    kalshi: 0.07,
  }[venue] || 0.005;

  // Approximate trade volume from PnL (assume 2% average return)
  const estimatedVolume = pnlUsd / 0.02;
  const estimatedFees = estimatedVolume * feeRate;

  if (estimatedFees > 0) {
    costTracker.recordApiCall(venue, estimatedVolume, { type: 'trade_fee' });
  }

  return processRevenue(pnlUsd, 'trading', { venue });
}

/**
 * Record revenue from DeFi yield harvesting.
 */
function processDeFiYield(yieldUsd, protocol = 'unknown') {
  return processRevenue(yieldUsd, 'defi_yield', { protocol });
}

/**
 * Record revenue from arbitrage.
 */
function processArbRevenue(profitUsd, pair = 'unknown') {
  return processRevenue(profitUsd, 'arbitrage', { pair });
}

/**
 * Record revenue from prediction markets.
 */
function processPredictionRevenue(profitUsd, market = 'unknown') {
  return processRevenue(profitUsd, 'predictions', { market });
}

/**
 * Record revenue from staking rewards.
 */
function processStakingReward(rewardUsd, chain = 'unknown') {
  return processRevenue(rewardUsd, 'staking', { chain });
}

// ─── Funding Cycle ───────────────────────────────────────────────────────────

/**
 * Run a full funding coordination cycle.
 * Should be called periodically (every 5-15 minutes) by the master orchestrator.
 */
function runFundingCycle() {
  const state = loadState();
  state.cycleCount += 1;
  state.lastCycleAt = Date.now();

  // Get current status from all subsystems
  const costSummary = costTracker.getCostSummary();
  const allocationStatus = revenueAllocator.getAllocationStatus();

  // Determine budget mode based on reserve health
  if (allocationStatus.apiReserveDaysCovered >= 21) {
    state.budgetMode = 'balanced';
  } else if (allocationStatus.apiReserveDaysCovered >= 7) {
    state.budgetMode = 'balanced';
  } else if (allocationStatus.apiReserveDaysCovered >= 3) {
    state.budgetMode = 'conservative';
  } else {
    state.budgetMode = 'conservative';
  }

  // Update self-funding status
  const prevSelfFunding = state.selfFundingActive;
  state.selfFundingActive = allocationStatus.selfFundingActive;

  if (state.selfFundingActive) {
    if (!state.firstSelfFundedAt) state.firstSelfFundedAt = Date.now();
    state.selfFundingStreak += 1;
    if (state.selfFundingStreak > state.longestStreak) {
      state.longestStreak = state.selfFundingStreak;
    }
  } else {
    state.selfFundingStreak = 0;
  }

  // Debit today's API costs from the operations reserve
  if (costSummary.todayCostUsd > 0) {
    revenueAllocator.debitApiCosts(costSummary.todayCostUsd);
  }

  // Reset 24h revenue counters daily
  const today = new Date().toISOString().slice(0, 10);
  for (const source of Object.values(state.revenueSources)) {
    if (source.lastUpdated > 0) {
      const lastDate = new Date(source.lastUpdated).toISOString().slice(0, 10);
      if (lastDate !== today) {
        source.last24hUsd = 0;
      }
    }
  }

  // Record health snapshot
  state.healthHistory.push({
    ts: Date.now(),
    selfFunding: state.selfFundingActive,
    reserveDays: allocationStatus.apiReserveDaysCovered,
    todayCost: costSummary.todayCostUsd,
    budgetMode: state.budgetMode,
  });
  if (state.healthHistory.length > 168) { // ~1 week at 1/hr
    state.healthHistory = state.healthHistory.slice(-168);
  }

  saveState(state);

  return {
    cycle: state.cycleCount,
    selfFundingActive: state.selfFundingActive,
    selfFundingStreak: state.selfFundingStreak,
    budgetMode: state.budgetMode,
    apiReserveDaysCovered: allocationStatus.apiReserveDaysCovered,
    todayCostUsd: costSummary.todayCostUsd,
    withinBudget: costSummary.withinDailyBudget,
  };
}

// ─── Status API ──────────────────────────────────────────────────────────────

/**
 * Get comprehensive self-funding status for dashboard/API.
 */
function getFundingStatus(availableModels = []) {
  const state = loadState();
  const costSummary = costTracker.getCostSummary();
  const allocationStatus = revenueAllocator.getAllocationStatus();
  const synergyStatus = synergyEngine.getSynergyStatus(availableModels);

  // Calculate total 24h revenue
  const total24hRevenue = Object.values(state.revenueSources)
    .reduce((sum, s) => sum + (s.last24hUsd || 0), 0);
  const totalLifetimeRevenue = Object.values(state.revenueSources)
    .reduce((sum, s) => sum + (s.lifetimeUsd || 0), 0);

  // Self-funding ratio (revenue vs costs)
  const selfFundingRatio = costSummary.avgDailyCost > 0
    ? Number((total24hRevenue / costSummary.avgDailyCost).toFixed(2))
    : 0;

  return {
    // Top-level status
    selfFundingActive: state.selfFundingActive,
    selfFundingRatio,
    selfFundingStreak: state.selfFundingStreak,
    longestStreak: state.longestStreak,
    firstSelfFundedAt: state.firstSelfFundedAt,
    budgetMode: state.budgetMode,

    // Revenue
    revenue: {
      total24hUsd: Number(total24hRevenue.toFixed(4)),
      totalLifetimeUsd: Number(totalLifetimeRevenue.toFixed(4)),
      sources: state.revenueSources,
    },

    // Costs
    costs: {
      todayUsd: costSummary.todayCostUsd,
      monthUsd: costSummary.monthCostUsd,
      avgDailyUsd: costSummary.avgDailyCost,
      projectedMonthlyUsd: costSummary.projectedMonthlyCost,
      withinDailyBudget: costSummary.withinDailyBudget,
      withinMonthlyBudget: costSummary.withinMonthlyBudget,
      topProviders: costSummary.providerRanking.slice(0, 5),
      categoryBreakdown: costSummary.categoryBreakdown,
    },

    // Reserves
    reserves: {
      apiOpsUsd: allocationStatus.apiOpsReserveUsd,
      apiOpsTargetUsd: allocationStatus.apiReserveTargetUsd,
      apiOpsDaysCovered: allocationStatus.apiReserveDaysCovered,
      apiOpsHealthPct: allocationStatus.apiReserveHealthPct,
      gasUsd: allocationStatus.gasReserveUsd,
      gasTargetUsd: allocationStatus.gasReserveTargetUsd,
      gasFunded: allocationStatus.gasReserveFunded,
    },

    // Allocation flow
    allocation: {
      lifetimeToApiOpsUsd: allocationStatus.lifetimeToApiOpsUsd,
      lifetimeToGasUsd: allocationStatus.lifetimeToGasUsd,
      lifetimeToCompoundingUsd: allocationStatus.lifetimeToCompoundingUsd,
      lifetimeToOwnerUsd: allocationStatus.lifetimeToOwnerUsd,
      config: allocationStatus.config,
      recentAllocations: allocationStatus.recentAllocations,
    },

    // Model synergy
    synergy: {
      synergyScore: synergyStatus.synergyScore,
      modelCount: synergyStatus.modelCount,
      availableModels: synergyStatus.availableModels,
      patterns: synergyStatus.patterns,
      taskRouting: synergyStatus.taskRouting,
      performanceStats: synergyStatus.performanceStats,
    },

    // Cycle info
    cycle: {
      count: state.cycleCount,
      lastAt: state.lastCycleAt,
    },

    updatedAt: state.updatedAt,
  };
}

module.exports = {
  // Revenue processing
  processRevenue,
  processTradeRevenue,
  processDeFiYield,
  processArbRevenue,
  processPredictionRevenue,
  processStakingReward,

  // Coordination
  runFundingCycle,

  // Status
  getFundingStatus,

  // Re-exports for convenience
  recordApiCall: costTracker.recordApiCall,
  getCostSummary: costTracker.getCostSummary,
  getOptimalModelRoute: synergyEngine.getOptimalRoute,
  classifyTask: synergyEngine.classifyTask,
  getSynergyStatus: synergyEngine.getSynergyStatus,
  recordModelPerformance: synergyEngine.recordModelPerformance,
};
