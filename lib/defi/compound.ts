/**
 * Compound V3 REST Client — DeFi Market Intelligence
 * ════════════════════════════════════════════════════
 *
 * Public REST client for Compound V3 (Comet) protocol data.
 * Base URL: https://v3-api.compound.finance
 *
 * All endpoints are public — no auth required for market data.
 */

const BASE_URL = (process.env.COMPOUND_V3_API_URL || 'https://v3-api.compound.finance').replace(/\/$/, '');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompoundMarket {
  /** Comet contract address */
  cometAddress: string;
  /** Chain ID (e.g. 1 for Ethereum mainnet, 8453 for Base) */
  chainId: number;
  /** Human-readable chain name */
  chainName: string;
  /** Base asset symbol (e.g. "USDC", "ETH") */
  baseAssetSymbol: string;
  /** Base asset contract address */
  baseAssetAddress: string;
  /** Net supply APY (annualized, as decimal — e.g. 0.045 = 4.5%) */
  supplyApy: number;
  /** Net borrow APY (annualized, as decimal) */
  borrowApy: number;
  /** Total supply in USD */
  totalSupplyUsd: number;
  /** Total borrow in USD */
  totalBorrowUsd: number;
  /** Total reserves in USD */
  totalReservesUsd: number;
  /** Utilization rate (0–1) */
  utilization: number;
  /** Whether the market is currently paused */
  isPaused: boolean;
}

export interface CompoundCollateral {
  symbol: string;
  address: string;
  /** Collateral factor (0–1) */
  collateralFactor: number;
  /** Liquidation factor (0–1) */
  liquidationFactor: number;
  /** Supply cap in base units */
  supplyCap: string;
}

export interface CompoundMarketDetail extends CompoundMarket {
  collateralAssets: CompoundCollateral[];
  /** Minimum borrow (in base asset units) */
  baseBorrowMin: string;
  /** Base tracking supply speed */
  baseTrackingSupplySpeed: string;
  /** Base tracking borrow speed */
  baseTrackingBorrowSpeed: string;
}

export interface CompoundPosition {
  walletAddress: string;
  cometAddress: string;
  chainId: number;
  /** Supplied base asset balance (in base units) */
  supplyBalance: string;
  /** Borrow balance (in base units) */
  borrowBalance: string;
  /** Borrow capacity (in USD) */
  borrowCapacityUsd: number;
  /** Liquidation threshold (in USD) */
  liquidationThresholdUsd: number;
  /** Current position value in USD */
  positionValueUsd: number;
  /** Health factor (>1 = safe, <1 = liquidatable) */
  healthFactor: number;
}

// ─── HTTP Helper ──────────────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Compound V3 GET ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Market Data ──────────────────────────────────────────────────────────────

/** Fetch all Compound V3 markets across all chains */
export async function getMarkets(): Promise<CompoundMarket[]> {
  const data = await get<{ markets: CompoundMarket[] }>('/markets');
  return data.markets ?? [];
}

/** Fetch Compound V3 markets on Ethereum mainnet (chainId 1) */
export async function getEthMarkets(): Promise<CompoundMarket[]> {
  const markets = await getMarkets();
  return markets.filter((m) => m.chainId === 1);
}

/** Fetch Base chain markets (chainId 8453) */
export async function getBaseMarkets(): Promise<CompoundMarket[]> {
  const markets = await getMarkets();
  return markets.filter((m) => m.chainId === 8453);
}

/** Fetch detailed info for a specific Comet market */
export async function getMarketDetail(
  chainId: number,
  cometAddress: string,
): Promise<CompoundMarketDetail> {
  return get<CompoundMarketDetail>(
    `/markets/${chainId}/${cometAddress.toLowerCase()}`,
  );
}

/** Get markets sorted by supply APY descending (best yield first) */
export async function getTopYieldMarkets(limit = 5): Promise<CompoundMarket[]> {
  const markets = await getMarkets();
  return markets
    .filter((m) => !m.isPaused && m.supplyApy > 0)
    .sort((a, b) => b.supplyApy - a.supplyApy)
    .slice(0, limit);
}

// ─── Position Data ────────────────────────────────────────────────────────────

/**
 * Fetch a wallet's Compound V3 position across all markets.
 * Returns an empty array if the wallet has no open positions.
 */
export async function getPosition(walletAddress: string): Promise<CompoundPosition[]> {
  const data = await get<{ positions: CompoundPosition[] }>(
    `/accounts/${walletAddress.toLowerCase()}`,
  );
  return data.positions ?? [];
}

/**
 * Fetch a wallet's position in a specific Comet market.
 */
export async function getMarketPosition(
  walletAddress: string,
  chainId: number,
  cometAddress: string,
): Promise<CompoundPosition | null> {
  const positions = await getPosition(walletAddress);
  return (
    positions.find(
      (p) =>
        p.chainId === chainId &&
        p.cometAddress.toLowerCase() === cometAddress.toLowerCase(),
    ) ?? null
  );
}
