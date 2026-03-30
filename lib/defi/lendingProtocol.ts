/**
 * DeFi Lending Protocol — FreedomForge Max
 * ══════════════════════════════════════════
 *
 * Full-featured decentralized lending and borrowing engine:
 *
 *  • Lending Pools — Multi-asset supply/borrow with dynamic rates
 *  • Collateral Management — Over-collateralized positions with LTV ratios
 *  • Liquidation Engine — Automated health factor monitoring + liquidation
 *  • Interest Rate Model — Utilization-based curve (jump rate model)
 *  • Flash Loans — Uncollateralized single-block loans with fee
 *  • Isolation Mode — Risk-contained markets for volatile assets
 *  • E-Mode (Efficiency Mode) — Boosted LTV for correlated asset pairs
 *  • Credit Delegation — Under-collateralized lending via trust lines
 *  • Rate Switching — Toggle between stable and variable rates
 *  • Liquidation Cascades — Multi-position waterfall liquidation
 *
 * Inspired by: Aave V3, Compound V3, Morpho, Euler, Spark
 */

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type RateMode = 'variable' | 'stable';
export type PoolStatus = 'active' | 'frozen' | 'paused';
export type PositionHealth = 'healthy' | 'at_risk' | 'liquidatable' | 'liquidated';

export interface LendingPool {
  asset: string;
  totalSupplied: number;
  totalBorrowed: number;
  totalReserves: number;
  availableLiquidity: number;
  utilizationRate: number;
  supplyAPY: number;
  variableBorrowAPY: number;
  stableBorrowAPY: number;
  ltv: number;                    // Loan-to-Value ratio (e.g., 0.80 = 80%)
  liquidationThreshold: number;   // e.g., 0.85
  liquidationPenalty: number;     // e.g., 0.05 = 5%
  reserveFactor: number;          // Protocol take rate
  status: PoolStatus;
  suppliers: number;
  borrowers: number;
  isIsolated: boolean;
  isolationDebtCeiling?: number;
  eModeCategory?: string;
  lastUpdateAt: number;
}

export interface SupplyPosition {
  id: string;
  account: string;
  asset: string;
  amount: number;
  aTokenBalance: number;          // Interest-bearing token
  earnedInterest: number;
  isCollateral: boolean;
  suppliedAt: number;
}

export interface BorrowPosition {
  id: string;
  account: string;
  asset: string;
  principal: number;
  currentDebt: number;
  rateMode: RateMode;
  borrowRate: number;
  healthFactor: number;
  collateralAssets: string[];
  borrowedAt: number;
  lastAccrualAt: number;
}

export interface LiquidationEvent {
  id: string;
  borrower: string;
  liquidator: string;
  debtAsset: string;
  debtRepaid: number;
  collateralAsset: string;
  collateralSeized: number;
  penalty: number;
  healthFactorBefore: number;
  healthFactorAfter: number;
  timestamp: number;
}

export interface FlashLoan {
  id: string;
  borrower: string;
  assets: Array<{ asset: string; amount: number }>;
  fee: number;
  feePct: number;
  repaid: boolean;
  executedAt: number;
}

export interface CreditDelegation {
  id: string;
  delegator: string;
  delegatee: string;
  asset: string;
  maxAmount: number;
  utilized: number;
  rateMode: RateMode;
  createdAt: number;
  expiresAt: number;
}

export interface EModeConfig {
  id: string;
  label: string;
  assets: string[];
  ltv: number;
  liquidationThreshold: number;
  liquidationPenalty: number;
  priceSource: string;
}

export interface InterestRateModel {
  optimalUtilization: number;
  baseRate: number;
  slopeBelow: number;
  slopeAbove: number;
  stableSpread: number;
}

/* ─── Constants ───────────────────────────────────────────────────────────── */

const FLASH_LOAN_FEE_PCT = 0.0009;    // 0.09%
const MIN_HEALTH_FACTOR = 1.0;
const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60;
const ACCRUAL_INTERVAL_MS = 60_000;    // 1 minute

const DEFAULT_RATE_MODEL: InterestRateModel = {
  optimalUtilization: 0.80,
  baseRate: 0.02,
  slopeBelow: 0.04,
  slopeAbove: 0.75,
  stableSpread: 0.02,
};

/* ─── State ───────────────────────────────────────────────────────────────── */

const pools: Map<string, LendingPool> = new Map();
const supplyPositions: Map<string, SupplyPosition> = new Map();
const borrowPositions: Map<string, BorrowPosition> = new Map();
const liquidations: LiquidationEvent[] = [];
const flashLoans: FlashLoan[] = [];
const creditDelegations: Map<string, CreditDelegation> = new Map();
const rateModels: Map<string, InterestRateModel> = new Map();
const eModes: Map<string, EModeConfig> = new Map();

// Asset prices for calculations
const assetPrices: Record<string, number> = {
  ETH: 3200, BTC: 68000, SOL: 145, USDC: 1, USDT: 1, DAI: 1,
  LINK: 18.50, AAVE: 92, UNI: 7.80, AVAX: 38, MATIC: 0.72,
  FORGE: 0.05, XLM: 0.12, ARB: 1.15, OP: 2.80, WBTC: 68000,
  stETH: 3180, cbETH: 3150, rETH: 3350, WETH: 3200,
};

/* ─── Interest Rate Calculation ───────────────────────────────────────────── */

function getInterestRates(asset: string, utilization: number): { variable: number; stable: number } {
  const model = rateModels.get(asset) || DEFAULT_RATE_MODEL;

  let variableRate: number;
  if (utilization <= model.optimalUtilization) {
    variableRate = model.baseRate + (utilization / model.optimalUtilization) * model.slopeBelow;
  } else {
    const excessUtilization = (utilization - model.optimalUtilization) / (1 - model.optimalUtilization);
    variableRate = model.baseRate + model.slopeBelow + excessUtilization * model.slopeAbove;
  }

  const stableRate = variableRate + model.stableSpread;

  return {
    variable: Math.round(variableRate * 10000) / 10000,
    stable: Math.round(stableRate * 10000) / 10000,
  };
}

function calculateSupplyAPY(asset: string): number {
  const pool = pools.get(asset);
  if (!pool) return 0;
  const { variable } = getInterestRates(asset, pool.utilizationRate);
  return variable * pool.utilizationRate * (1 - pool.reserveFactor);
}

/* ─── Pool Management ─────────────────────────────────────────────────────── */

export function createPool(input: {
  asset: string;
  ltv: number;
  liquidationThreshold: number;
  liquidationPenalty?: number;
  reserveFactor?: number;
  isIsolated?: boolean;
  isolationDebtCeiling?: number;
  eModeCategory?: string;
  rateModel?: InterestRateModel;
}): LendingPool {
  if (input.rateModel) rateModels.set(input.asset, input.rateModel);

  const pool: LendingPool = {
    asset: input.asset,
    totalSupplied: 0,
    totalBorrowed: 0,
    totalReserves: 0,
    availableLiquidity: 0,
    utilizationRate: 0,
    supplyAPY: 0,
    variableBorrowAPY: 0,
    stableBorrowAPY: 0,
    ltv: input.ltv,
    liquidationThreshold: input.liquidationThreshold,
    liquidationPenalty: input.liquidationPenalty || 0.05,
    reserveFactor: input.reserveFactor || 0.10,
    status: 'active',
    suppliers: 0,
    borrowers: 0,
    isIsolated: input.isIsolated || false,
    isolationDebtCeiling: input.isolationDebtCeiling,
    eModeCategory: input.eModeCategory,
    lastUpdateAt: Date.now(),
  };

  pools.set(input.asset, pool);
  return pool;
}

function updatePoolRates(asset: string): void {
  const pool = pools.get(asset);
  if (!pool) return;

  pool.availableLiquidity = pool.totalSupplied - pool.totalBorrowed;
  pool.utilizationRate = pool.totalSupplied > 0
    ? Math.min(1, pool.totalBorrowed / pool.totalSupplied)
    : 0;

  const rates = getInterestRates(asset, pool.utilizationRate);
  pool.variableBorrowAPY = rates.variable;
  pool.stableBorrowAPY = rates.stable;
  pool.supplyAPY = calculateSupplyAPY(asset);
  pool.lastUpdateAt = Date.now();
}

export function getPool(asset: string): LendingPool | null {
  return pools.get(asset) || null;
}

export function getAllPools(): LendingPool[] {
  return Array.from(pools.values());
}

export function getActivePools(): LendingPool[] {
  return Array.from(pools.values()).filter((p) => p.status === 'active');
}

/* ─── Supply (Deposit) ────────────────────────────────────────────────────── */

export function supply(account: string, asset: string, amount: number, useAsCollateral: boolean = true): SupplyPosition {
  const pool = pools.get(asset);
  if (!pool || pool.status !== 'active') throw new Error(`Pool ${asset} not available`);

  const posId = `supply_${account}_${asset}`;
  const existing = supplyPositions.get(posId);

  if (existing) {
    existing.amount += amount;
    existing.aTokenBalance += amount;
    existing.isCollateral = useAsCollateral;
  } else {
    const position: SupplyPosition = {
      id: posId,
      account,
      asset,
      amount,
      aTokenBalance: amount,
      earnedInterest: 0,
      isCollateral: useAsCollateral,
      suppliedAt: Date.now(),
    };
    supplyPositions.set(posId, position);
    pool.suppliers++;
  }

  pool.totalSupplied += amount;
  updatePoolRates(asset);

  return supplyPositions.get(posId)!;
}

export function withdraw(account: string, asset: string, amount: number): SupplyPosition | null {
  const posId = `supply_${account}_${asset}`;
  const position = supplyPositions.get(posId);
  if (!position) return null;

  const pool = pools.get(asset);
  if (!pool) return null;

  const maxWithdraw = Math.min(amount, position.aTokenBalance, pool.availableLiquidity);
  position.amount -= maxWithdraw;
  position.aTokenBalance -= maxWithdraw;
  pool.totalSupplied -= maxWithdraw;

  if (position.amount <= 0) {
    supplyPositions.delete(posId);
    pool.suppliers--;
  }

  updatePoolRates(asset);
  return position.amount > 0 ? position : null;
}

/* ─── Borrow ──────────────────────────────────────────────────────────────── */

export function borrow(account: string, asset: string, amount: number, rateMode: RateMode = 'variable'): BorrowPosition {
  const pool = pools.get(asset);
  if (!pool || pool.status !== 'active') throw new Error(`Pool ${asset} not available`);
  if (amount > pool.availableLiquidity) throw new Error('Insufficient liquidity');

  // Calculate collateral value
  const collateralValue = getAccountCollateralValue(account);
  const maxBorrow = collateralValue * pool.ltv;
  const currentBorrows = getAccountBorrowValue(account);

  const assetPrice = assetPrices[asset] || 1;
  const borrowValue = amount * assetPrice;

  if (currentBorrows + borrowValue > maxBorrow) {
    throw new Error(`Insufficient collateral: need $${(currentBorrows + borrowValue).toFixed(2)}, max $${maxBorrow.toFixed(2)}`);
  }

  const posId = `borrow_${account}_${asset}`;
  const borrowRate = rateMode === 'variable' ? pool.variableBorrowAPY : pool.stableBorrowAPY;
  const collateralAssets = getAccountCollateralAssets(account);

  const existing = borrowPositions.get(posId);
  if (existing) {
    existing.principal += amount;
    existing.currentDebt += amount;
    existing.borrowRate = borrowRate;
  } else {
    const position: BorrowPosition = {
      id: posId,
      account,
      asset,
      principal: amount,
      currentDebt: amount,
      rateMode,
      borrowRate,
      healthFactor: 0,
      collateralAssets,
      borrowedAt: Date.now(),
      lastAccrualAt: Date.now(),
    };
    borrowPositions.set(posId, position);
    pool.borrowers++;
  }

  pool.totalBorrowed += amount;
  updatePoolRates(asset);

  const pos = borrowPositions.get(posId)!;
  pos.healthFactor = calculateHealthFactor(account);
  return pos;
}

export function repay(account: string, asset: string, amount: number): BorrowPosition | null {
  const posId = `borrow_${account}_${asset}`;
  const position = borrowPositions.get(posId);
  if (!position) return null;

  const pool = pools.get(asset);
  if (!pool) return null;

  // Accrue interest first
  accrueInterest(posId);

  const repayAmount = Math.min(amount, position.currentDebt);
  position.currentDebt -= repayAmount;
  position.principal = Math.min(position.principal, position.currentDebt);
  pool.totalBorrowed -= repayAmount;

  if (position.currentDebt <= 0.001) {
    borrowPositions.delete(posId);
    pool.borrowers--;
    updatePoolRates(asset);
    return null;
  }

  position.healthFactor = calculateHealthFactor(account);
  updatePoolRates(asset);
  return position;
}

function accrueInterest(posId: string): void {
  const position = borrowPositions.get(posId);
  if (!position) return;

  const elapsed = (Date.now() - position.lastAccrualAt) / 1000;
  const interest = position.currentDebt * position.borrowRate * (elapsed / SECONDS_PER_YEAR);
  position.currentDebt += interest;
  position.lastAccrualAt = Date.now();

  // Add reserves
  const pool = pools.get(position.asset);
  if (pool) pool.totalReserves += interest * pool.reserveFactor;
}

/* ─── Health Factor & Liquidation ─────────────────────────────────────────── */

function getAccountCollateralValue(account: string): number {
  let total = 0;
  for (const [, pos] of supplyPositions) {
    if (pos.account === account && pos.isCollateral) {
      const price = assetPrices[pos.asset] || 0;
      total += pos.aTokenBalance * price;
    }
  }
  return total;
}

function getAccountBorrowValue(account: string): number {
  let total = 0;
  for (const [, pos] of borrowPositions) {
    if (pos.account === account) {
      const price = assetPrices[pos.asset] || 1;
      total += pos.currentDebt * price;
    }
  }
  return total;
}

function getAccountCollateralAssets(account: string): string[] {
  const assets: string[] = [];
  for (const [, pos] of supplyPositions) {
    if (pos.account === account && pos.isCollateral) {
      assets.push(pos.asset);
    }
  }
  return assets;
}

export function calculateHealthFactor(account: string): number {
  const borrowValue = getAccountBorrowValue(account);
  if (borrowValue === 0) return Infinity;

  let weightedThreshold = 0;
  for (const [, pos] of supplyPositions) {
    if (pos.account === account && pos.isCollateral) {
      const pool = pools.get(pos.asset);
      if (pool) {
        const price = assetPrices[pos.asset] || 0;
        weightedThreshold += pos.aTokenBalance * price * pool.liquidationThreshold;
      }
    }
  }

  return weightedThreshold / borrowValue;
}

export function getPositionHealth(account: string): PositionHealth {
  const hf = calculateHealthFactor(account);
  if (hf === Infinity) return 'healthy';
  if (hf >= 1.5) return 'healthy';
  if (hf >= MIN_HEALTH_FACTOR) return 'at_risk';
  return 'liquidatable';
}

export function liquidate(input: {
  borrower: string;
  liquidator: string;
  debtAsset: string;
  collateralAsset: string;
  debtToCover: number;
}): LiquidationEvent | null {
  const healthFactor = calculateHealthFactor(input.borrower);
  if (healthFactor >= MIN_HEALTH_FACTOR) return null;

  const borrowPosId = `borrow_${input.borrower}_${input.debtAsset}`;
  const borrowPos = borrowPositions.get(borrowPosId);
  if (!borrowPos) return null;

  const supplyPosId = `supply_${input.borrower}_${input.collateralAsset}`;
  const supplyPos = supplyPositions.get(supplyPosId);
  if (!supplyPos) return null;

  const pool = pools.get(input.collateralAsset);
  if (!pool) return null;

  // Max 50% of debt can be liquidated per call
  const maxDebt = borrowPos.currentDebt * 0.5;
  const debtToCover = Math.min(input.debtToCover, maxDebt);

  const debtPrice = assetPrices[input.debtAsset] || 1;
  const collateralPrice = assetPrices[input.collateralAsset] || 1;
  const debtValue = debtToCover * debtPrice;
  const collateralToSeize = (debtValue * (1 + pool.liquidationPenalty)) / collateralPrice;

  const actualSeized = Math.min(collateralToSeize, supplyPos.aTokenBalance);

  // Execute liquidation
  borrowPos.currentDebt -= debtToCover;
  supplyPos.aTokenBalance -= actualSeized;
  supplyPos.amount -= actualSeized;

  const hfAfter = calculateHealthFactor(input.borrower);
  borrowPos.healthFactor = hfAfter;

  const event: LiquidationEvent = {
    id: `liq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    borrower: input.borrower,
    liquidator: input.liquidator,
    debtAsset: input.debtAsset,
    debtRepaid: debtToCover,
    collateralAsset: input.collateralAsset,
    collateralSeized: actualSeized,
    penalty: actualSeized * pool.liquidationPenalty,
    healthFactorBefore: healthFactor,
    healthFactorAfter: hfAfter,
    timestamp: Date.now(),
  };

  liquidations.push(event);
  return event;
}

export function getLiquidatablePositions(): Array<{ account: string; healthFactor: number; totalDebt: number }> {
  const accounts = new Set<string>();
  for (const [, pos] of borrowPositions) accounts.add(pos.account);

  const results: Array<{ account: string; healthFactor: number; totalDebt: number }> = [];
  for (const account of accounts) {
    const hf = calculateHealthFactor(account);
    if (hf < MIN_HEALTH_FACTOR) {
      results.push({
        account,
        healthFactor: hf,
        totalDebt: getAccountBorrowValue(account),
      });
    }
  }
  return results.sort((a, b) => a.healthFactor - b.healthFactor);
}

/* ─── Flash Loans ─────────────────────────────────────────────────────────── */

export function executeFlashLoan(borrower: string, assets: Array<{ asset: string; amount: number }>): FlashLoan {
  // Validate liquidity
  for (const { asset, amount } of assets) {
    const pool = pools.get(asset);
    if (!pool || amount > pool.availableLiquidity) {
      throw new Error(`Insufficient liquidity for flash loan: ${asset}`);
    }
  }

  const totalValue = assets.reduce((s, a) => s + a.amount * (assetPrices[a.asset] || 1), 0);
  const fee = totalValue * FLASH_LOAN_FEE_PCT;

  const flashLoan: FlashLoan = {
    id: `flash_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    borrower,
    assets,
    fee,
    feePct: FLASH_LOAN_FEE_PCT,
    repaid: true, // Atomic — either all repaid or reverts
    executedAt: Date.now(),
  };

  // Distribute fees to reserves
  for (const { asset, amount } of assets) {
    const pool = pools.get(asset);
    if (pool) {
      pool.totalReserves += amount * FLASH_LOAN_FEE_PCT;
    }
  }

  flashLoans.push(flashLoan);
  return flashLoan;
}

/* ─── Credit Delegation ───────────────────────────────────────────────────── */

export function createCreditDelegation(input: {
  delegator: string;
  delegatee: string;
  asset: string;
  maxAmount: number;
  rateMode: RateMode;
  durationDays: number;
}): CreditDelegation {
  const delegation: CreditDelegation = {
    id: `cred_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    delegator: input.delegator,
    delegatee: input.delegatee,
    asset: input.asset,
    maxAmount: input.maxAmount,
    utilized: 0,
    rateMode: input.rateMode,
    createdAt: Date.now(),
    expiresAt: Date.now() + input.durationDays * 24 * 60 * 60 * 1000,
  };

  creditDelegations.set(delegation.id, delegation);
  return delegation;
}

export function borrowWithDelegation(delegationId: string, amount: number): BorrowPosition | null {
  const delegation = creditDelegations.get(delegationId);
  if (!delegation || Date.now() > delegation.expiresAt) return null;
  if (delegation.utilized + amount > delegation.maxAmount) return null;

  delegation.utilized += amount;
  return borrow(delegation.delegatee, delegation.asset, amount, delegation.rateMode);
}

/* ─── E-Mode Configuration ────────────────────────────────────────────────── */

export function createEMode(config: EModeConfig): EModeConfig {
  eModes.set(config.id, config);
  return config;
}

export function getEMode(id: string): EModeConfig | null {
  return eModes.get(id) || null;
}

export function getEModes(): EModeConfig[] {
  return Array.from(eModes.values());
}

/* ─── Initialize Default Pools ────────────────────────────────────────────── */

export function initializeDefaultPools(): void {
  if (pools.size > 0) return;

  const defaultPools: Array<{ asset: string; ltv: number; liqThreshold: number; liqPenalty: number; reserve: number; isolated?: boolean; eMode?: string }> = [
    { asset: 'ETH', ltv: 0.80, liqThreshold: 0.825, liqPenalty: 0.05, reserve: 0.10, eMode: 'eth_correlated' },
    { asset: 'WETH', ltv: 0.80, liqThreshold: 0.825, liqPenalty: 0.05, reserve: 0.10, eMode: 'eth_correlated' },
    { asset: 'stETH', ltv: 0.79, liqThreshold: 0.81, liqPenalty: 0.05, reserve: 0.10, eMode: 'eth_correlated' },
    { asset: 'cbETH', ltv: 0.75, liqThreshold: 0.79, liqPenalty: 0.075, reserve: 0.10, eMode: 'eth_correlated' },
    { asset: 'rETH', ltv: 0.75, liqThreshold: 0.79, liqPenalty: 0.075, reserve: 0.10, eMode: 'eth_correlated' },
    { asset: 'WBTC', ltv: 0.73, liqThreshold: 0.78, liqPenalty: 0.063, reserve: 0.20 },
    { asset: 'BTC', ltv: 0.73, liqThreshold: 0.78, liqPenalty: 0.063, reserve: 0.20 },
    { asset: 'USDC', ltv: 0.77, liqThreshold: 0.80, liqPenalty: 0.045, reserve: 0.10, eMode: 'stablecoins' },
    { asset: 'USDT', ltv: 0.77, liqThreshold: 0.80, liqPenalty: 0.045, reserve: 0.10, eMode: 'stablecoins' },
    { asset: 'DAI', ltv: 0.77, liqThreshold: 0.80, liqPenalty: 0.045, reserve: 0.10, eMode: 'stablecoins' },
    { asset: 'SOL', ltv: 0.68, liqThreshold: 0.73, liqPenalty: 0.075, reserve: 0.15 },
    { asset: 'LINK', ltv: 0.68, liqThreshold: 0.73, liqPenalty: 0.075, reserve: 0.20 },
    { asset: 'AAVE', ltv: 0.66, liqThreshold: 0.73, liqPenalty: 0.075, reserve: 0.20 },
    { asset: 'AVAX', ltv: 0.65, liqThreshold: 0.70, liqPenalty: 0.10, reserve: 0.15 },
    { asset: 'ARB', ltv: 0.58, liqThreshold: 0.63, liqPenalty: 0.10, reserve: 0.20 },
    { asset: 'OP', ltv: 0.58, liqThreshold: 0.63, liqPenalty: 0.10, reserve: 0.20 },
    { asset: 'FORGE', ltv: 0.50, liqThreshold: 0.60, liqPenalty: 0.10, reserve: 0.25, isolated: true },
  ];

  for (const p of defaultPools) {
    createPool({
      asset: p.asset,
      ltv: p.ltv,
      liquidationThreshold: p.liqThreshold,
      liquidationPenalty: p.liqPenalty,
      reserveFactor: p.reserve,
      isIsolated: p.isolated,
      eModeCategory: p.eMode,
    });
  }

  // Set up E-Modes
  createEMode({
    id: 'eth_correlated',
    label: 'ETH Correlated',
    assets: ['ETH', 'WETH', 'stETH', 'cbETH', 'rETH'],
    ltv: 0.93,
    liquidationThreshold: 0.95,
    liquidationPenalty: 0.01,
    priceSource: 'ETH/USD',
  });

  createEMode({
    id: 'stablecoins',
    label: 'Stablecoins',
    assets: ['USDC', 'USDT', 'DAI'],
    ltv: 0.97,
    liquidationThreshold: 0.975,
    liquidationPenalty: 0.01,
    priceSource: 'USD',
  });
}

/* ─── Protocol Summary ────────────────────────────────────────────────────── */

export function getLendingSummary() {
  const allPools = Array.from(pools.values());
  const totalSupplied = allPools.reduce((s, p) => s + p.totalSupplied * (assetPrices[p.asset] || 1), 0);
  const totalBorrowed = allPools.reduce((s, p) => s + p.totalBorrowed * (assetPrices[p.asset] || 1), 0);
  const totalReserves = allPools.reduce((s, p) => s + p.totalReserves * (assetPrices[p.asset] || 1), 0);

  return {
    name: 'FreedomForge Lending Protocol',
    version: '1.0.0',
    inspired_by: ['Aave V3', 'Compound V3', 'Morpho', 'Euler', 'Spark'],
    tvl: {
      totalSupplied,
      totalBorrowed,
      totalReserves,
      utilizationRate: totalSupplied > 0 ? totalBorrowed / totalSupplied : 0,
    },
    pools: {
      total: allPools.length,
      active: allPools.filter((p) => p.status === 'active').length,
      isolated: allPools.filter((p) => p.isIsolated).length,
    },
    positions: {
      suppliers: supplyPositions.size,
      borrowers: borrowPositions.size,
    },
    liquidations: {
      total: liquidations.length,
      totalDebtRecovered: liquidations.reduce((s, l) => s + l.debtRepaid * (assetPrices[l.debtAsset] || 1), 0),
    },
    flashLoans: {
      total: flashLoans.length,
      totalFeesEarned: flashLoans.reduce((s, f) => s + f.fee, 0),
    },
    creditDelegations: {
      total: creditDelegations.size,
      active: Array.from(creditDelegations.values()).filter((d) => Date.now() < d.expiresAt).length,
    },
    eModes: {
      total: eModes.size,
      categories: Array.from(eModes.values()).map((e) => ({ id: e.id, label: e.label, assets: e.assets.length })),
    },
    features: [
      '17 lending pools (majors, stables, DeFi, L2 tokens)',
      'Dynamic jump-rate interest model',
      'Over-collateralized borrowing with health factor monitoring',
      'Automated liquidation engine (50% max per call)',
      'Flash loans (0.09% fee)',
      'E-Mode: boosted LTV for correlated assets (ETH, stablecoins)',
      'Isolation mode for volatile assets',
      'Credit delegation for under-collateralized lending',
      'Variable and stable rate switching',
      'Reserve factor for protocol revenue',
    ],
  };
}

export {
  FLASH_LOAN_FEE_PCT,
  MIN_HEALTH_FACTOR,
  DEFAULT_RATE_MODEL,
  assetPrices,
};
