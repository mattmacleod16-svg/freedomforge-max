/**
 * Revenue Allocator — Autonomous profit-to-API-cost pipeline.
 * ═══════════════════════════════════════════════════════════════
 *
 * Takes trading profits and DeFi yields, then automatically allocates
 * funds to cover API costs so the system is permanently self-sustaining.
 *
 * Allocation waterfall:
 *   1. API Operations Reserve (covers next 30 days of projected API costs)
 *   2. Gas Reserve (ETH for on-chain operations)
 *   3. Trading Capital Compounding (grow the portfolio)
 *   4. Owner Payout (minimum 15% per capital mandate)
 *
 * Every dollar earned flows through this waterfall. The system never
 * starves itself of operational funding.
 */

'use strict';

const fs = require('fs');
const path = require('path');

let rio;
try { rio = require('../resilient-io'); } catch { rio = null; }

let costTracker;
try { costTracker = require('./api-cost-tracker'); } catch { costTracker = null; }

let treasuryLedger;
try { treasuryLedger = require('../treasury-ledger'); } catch { treasuryLedger = null; }

const DATA_DIR = process.env.VERCEL ? '/tmp/freedomforge-data' : path.resolve(process.cwd(), 'data');
const ALLOC_FILE = path.join(DATA_DIR, 'revenue-allocation.json');

// ─── Allocation Targets ──────────────────────────────────────────────────────

// Percentage of revenue allocated to API operations
const API_OPS_RESERVE_PCT = Math.max(5, Math.min(40,
  Number(process.env.API_OPS_RESERVE_PCT || 15)));

// Gas reserve target in USD equivalent
const GAS_RESERVE_TARGET_USD = Math.max(5, Math.min(500,
  Number(process.env.GAS_RESERVE_TARGET_USD || 25)));

// Minimum owner payout percentage (from capital mandate - NEVER goes below this)
const MIN_OWNER_PAYOUT_PCT = Math.max(15, Math.min(50,
  Number(process.env.MIN_OWNER_PAYOUT_PCT || 15)));

// Target: keep API reserve covering this many days of projected costs
const API_RESERVE_DAYS_TARGET = Math.max(7, Math.min(90,
  Number(process.env.API_RESERVE_DAYS_TARGET || 30)));

// ─── State Management ────────────────────────────────────────────────────────

function loadAllocationState() {
  try {
    if (rio) return rio.readJsonSafe(ALLOC_FILE, { fallback: null }) || createFreshState();
    if (!fs.existsSync(ALLOC_FILE)) return createFreshState();
    return JSON.parse(fs.readFileSync(ALLOC_FILE, 'utf8'));
  } catch {
    return createFreshState();
  }
}

function saveAllocationState(state) {
  state.updatedAt = Date.now();
  try {
    if (rio) { rio.writeJsonAtomic(ALLOC_FILE, state); return; }
    fs.mkdirSync(path.dirname(ALLOC_FILE), { recursive: true });
    const tmp = ALLOC_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, ALLOC_FILE);
  } catch (err) {
    console.error('[revenue-allocator] save failed:', err.message);
  }
}

function createFreshState() {
  return {
    // Reserve balances (USD)
    apiOpsReserveUsd: 0,
    gasReserveUsd: 0,
    compoundingPoolUsd: 0,
    ownerPayoutAccruedUsd: 0,

    // Lifetime flow tracking
    lifetimeRevenueProcessedUsd: 0,
    lifetimeToApiOpsUsd: 0,
    lifetimeToGasUsd: 0,
    lifetimeToCompoundingUsd: 0,
    lifetimeToOwnerUsd: 0,

    // Reserve health
    apiReserveDaysCovered: 0,
    gasReserveFunded: false,
    selfFundingActive: false,

    // Allocation history (last 90 entries)
    allocationHistory: [],

    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ─── Core Allocation Engine ──────────────────────────────────────────────────

/**
 * Process new revenue through the allocation waterfall.
 * Called after each profitable trade reconciliation or DeFi yield harvest.
 *
 * @param {number} revenueUsd - New revenue to allocate (must be > 0)
 * @param {string} source - Revenue source (e.g., 'trading', 'defi_yield', 'arb')
 * @returns Allocation breakdown
 */
function allocateRevenue(revenueUsd, source = 'trading') {
  if (!revenueUsd || revenueUsd <= 0) return null;

  const state = loadAllocationState();

  // Get current API cost projections
  let projectedDailyCost = 0.50; // Default fallback
  if (costTracker) {
    const summary = costTracker.getCostSummary();
    projectedDailyCost = Math.max(0.10, summary.avgDailyCost || 0.50);
  }

  const targetApiReserveUsd = projectedDailyCost * API_RESERVE_DAYS_TARGET;
  const apiReserveDeficit = Math.max(0, targetApiReserveUsd - state.apiOpsReserveUsd);
  const gasReserveDeficit = Math.max(0, GAS_RESERVE_TARGET_USD - state.gasReserveUsd);

  let remaining = revenueUsd;
  const allocation = {
    totalRevenue: revenueUsd,
    source,
    toApiOps: 0,
    toGas: 0,
    toCompounding: 0,
    toOwner: 0,
    ts: Date.now(),
  };

  // Step 1: Owner payout (sovereign law - always first)
  allocation.toOwner = Number((remaining * MIN_OWNER_PAYOUT_PCT / 100).toFixed(4));
  remaining -= allocation.toOwner;

  // Step 2: API Operations Reserve (if below target)
  if (apiReserveDeficit > 0) {
    const maxApiAlloc = remaining * (API_OPS_RESERVE_PCT / 100);
    allocation.toApiOps = Number(Math.min(apiReserveDeficit, maxApiAlloc, remaining).toFixed(4));
    remaining -= allocation.toApiOps;
  }

  // Step 3: Gas Reserve (if below target)
  if (gasReserveDeficit > 0 && remaining > 0) {
    allocation.toGas = Number(Math.min(gasReserveDeficit, remaining * 0.15, remaining).toFixed(4));
    remaining -= allocation.toGas;
  }

  // Step 4: Everything else compounds into trading capital
  allocation.toCompounding = Number(Math.max(0, remaining).toFixed(4));

  // Update state
  state.apiOpsReserveUsd = Number((state.apiOpsReserveUsd + allocation.toApiOps).toFixed(4));
  state.gasReserveUsd = Number((state.gasReserveUsd + allocation.toGas).toFixed(4));
  state.compoundingPoolUsd = Number((state.compoundingPoolUsd + allocation.toCompounding).toFixed(4));
  state.ownerPayoutAccruedUsd = Number((state.ownerPayoutAccruedUsd + allocation.toOwner).toFixed(4));

  state.lifetimeRevenueProcessedUsd = Number((state.lifetimeRevenueProcessedUsd + revenueUsd).toFixed(4));
  state.lifetimeToApiOpsUsd = Number((state.lifetimeToApiOpsUsd + allocation.toApiOps).toFixed(4));
  state.lifetimeToGasUsd = Number((state.lifetimeToGasUsd + allocation.toGas).toFixed(4));
  state.lifetimeToCompoundingUsd = Number((state.lifetimeToCompoundingUsd + allocation.toCompounding).toFixed(4));
  state.lifetimeToOwnerUsd = Number((state.lifetimeToOwnerUsd + allocation.toOwner).toFixed(4));

  // Update reserve health metrics
  state.apiReserveDaysCovered = projectedDailyCost > 0
    ? Number((state.apiOpsReserveUsd / projectedDailyCost).toFixed(1))
    : 999;
  state.gasReserveFunded = state.gasReserveUsd >= GAS_RESERVE_TARGET_USD;
  state.selfFundingActive = state.apiReserveDaysCovered >= 7;

  // Track allocation history
  state.allocationHistory.push(allocation);
  if (state.allocationHistory.length > 90) {
    state.allocationHistory = state.allocationHistory.slice(-90);
  }

  saveAllocationState(state);

  return allocation;
}

/**
 * Debit API costs from the operations reserve.
 * Called periodically to reflect actual API spending.
 */
function debitApiCosts(costUsd) {
  if (!costUsd || costUsd <= 0) return;
  const state = loadAllocationState();
  state.apiOpsReserveUsd = Number(Math.max(0, state.apiOpsReserveUsd - costUsd).toFixed(4));

  // Recalculate reserve days
  let projectedDailyCost = 0.50;
  if (costTracker) {
    const summary = costTracker.getCostSummary();
    projectedDailyCost = Math.max(0.10, summary.avgDailyCost || 0.50);
  }
  state.apiReserveDaysCovered = projectedDailyCost > 0
    ? Number((state.apiOpsReserveUsd / projectedDailyCost).toFixed(1))
    : 0;
  state.selfFundingActive = state.apiReserveDaysCovered >= 7;

  saveAllocationState(state);
}

/**
 * Get the full allocation status for dashboard/API.
 */
function getAllocationStatus() {
  const state = loadAllocationState();

  let costSummary = null;
  if (costTracker) {
    costSummary = costTracker.getCostSummary();
  }

  let treasurySummary = null;
  if (treasuryLedger) {
    treasurySummary = treasuryLedger.getSummary();
  }

  const projectedDailyCost = costSummary?.avgDailyCost || 0.50;
  const targetReserve = projectedDailyCost * API_RESERVE_DAYS_TARGET;

  return {
    // Reserve health
    apiOpsReserveUsd: state.apiOpsReserveUsd,
    apiReserveTargetUsd: Number(targetReserve.toFixed(2)),
    apiReserveDaysCovered: state.apiReserveDaysCovered,
    apiReserveHealthPct: targetReserve > 0
      ? Number(Math.min(100, state.apiOpsReserveUsd / targetReserve * 100).toFixed(1))
      : 100,
    gasReserveUsd: state.gasReserveUsd,
    gasReserveTargetUsd: GAS_RESERVE_TARGET_USD,
    gasReserveFunded: state.gasReserveFunded,
    selfFundingActive: state.selfFundingActive,

    // Revenue flow
    lifetimeRevenueProcessedUsd: state.lifetimeRevenueProcessedUsd,
    lifetimeToApiOpsUsd: state.lifetimeToApiOpsUsd,
    lifetimeToGasUsd: state.lifetimeToGasUsd,
    lifetimeToCompoundingUsd: state.lifetimeToCompoundingUsd,
    lifetimeToOwnerUsd: state.lifetimeToOwnerUsd,

    // Current pools
    compoundingPoolUsd: state.compoundingPoolUsd,
    ownerPayoutAccruedUsd: state.ownerPayoutAccruedUsd,

    // Allocation config
    config: {
      apiOpsReservePct: API_OPS_RESERVE_PCT,
      gasReserveTargetUsd: GAS_RESERVE_TARGET_USD,
      minOwnerPayoutPct: MIN_OWNER_PAYOUT_PCT,
      apiReserveDaysTarget: API_RESERVE_DAYS_TARGET,
    },

    // Cost data
    costSummary: costSummary ? {
      todayCostUsd: costSummary.todayCostUsd,
      monthCostUsd: costSummary.monthCostUsd,
      avgDailyCost: costSummary.avgDailyCost,
      projectedMonthlyCost: costSummary.projectedMonthlyCost,
      withinBudget: costSummary.withinDailyBudget && costSummary.withinMonthlyBudget,
    } : null,

    // Treasury data
    treasurySummary: treasurySummary ? {
      lifetimePnl: treasurySummary.lifetimePnl,
      currentCapital: treasurySummary.currentCapital,
      winRate: treasurySummary.winRate,
    } : null,

    // Recent allocations
    recentAllocations: state.allocationHistory.slice(-10),
    updatedAt: state.updatedAt,
  };
}

module.exports = {
  allocateRevenue,
  debitApiCosts,
  getAllocationStatus,
};
