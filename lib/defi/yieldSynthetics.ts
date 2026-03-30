/**
 * Yield & Synthetic Assets Protocol — FreedomForge Max
 * ═════════════════════════════════════════════════════
 *
 * Advanced yield strategies and synthetic asset infrastructure:
 *
 *  • Ethena — USDe synthetic dollar with delta-neutral yield (sUSDe)
 *  • MakerDAO/Sky — DAI/USDS CDP lending, DSR, Spark Protocol
 *  • Synthetix V3 — Multi-collateral synths with perpetual futures
 *  • Yearn V3 — Automated vault strategies with tokenized positions
 *  • Morpho — Peer-to-peer lending optimization layer
 *  • Convex — Curve gauge boosting and yield aggregation
 *  • Aura — Balancer gauge boosting
 *  • Polymarket — Prediction market protocol (CLOB-based)
 *  • dYdX — Decentralized perpetual futures exchange
 *  • GMX V2 — Perp DEX with GLP liquidity model
 *  • Ondo Finance — Tokenized treasuries (OUSG, USDY)
 *  • Mountain Protocol — USDM yield-bearing stablecoin
 *  • Angle Protocol — Euro stablecoin (agEUR/EURA)
 *  • Frax — Algorithmic + collateralized stablecoins (FRAX, sFRAX, sfrxETH)
 *
 * Inspired by: Ethena, MakerDAO, Synthetix, Yearn, Polymarket, dYdX, GMX
 */

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type YieldProtocol = 'ethena' | 'maker' | 'synthetix' | 'yearn' | 'morpho' | 'convex' | 'aura' | 'polymarket' | 'dydx' | 'gmx' | 'ondo' | 'mountain' | 'angle' | 'frax';
export type StablecoinType = 'fiat_backed' | 'crypto_backed' | 'algorithmic' | 'delta_neutral' | 'rwa_backed' | 'hybrid';
export type VaultStrategy = 'lending' | 'liquidity_provision' | 'staking' | 'delta_neutral' | 'leveraged_staking' | 'basis_trade';
export type PerpSide = 'long' | 'short';

export interface SyntheticDollar {
  symbol: string;
  protocol: YieldProtocol;
  type: StablecoinType;
  peg: number;
  totalSupply: number;
  backingAssets: string[];
  yieldBearing: boolean;
  stakingAPY?: number;
  stakedSymbol?: string;
  collateralRatio: number;
  chain: string[];
}

export interface CDPPosition {
  id: string;
  owner: string;
  collateralAsset: string;
  collateralAmount: number;
  debtAsset: string;
  debtAmount: number;
  collateralRatio: number;
  liquidationPrice: number;
  stabilityFee: number;
  createdAt: number;
}

export interface YieldVault {
  id: string;
  protocol: YieldProtocol;
  name: string;
  asset: string;
  strategy: VaultStrategy;
  tvl: number;
  apy: number;
  apyBreakdown: { base: number; rewards: number; boost?: number };
  risk: 'low' | 'medium' | 'high';
  maxDeposit: number;
  totalDepositors: number;
  chain: string;
  active: boolean;
}

export interface PerpPosition {
  id: string;
  protocol: YieldProtocol;
  market: string;
  side: PerpSide;
  size: number;
  leverage: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  margin: number;
  unrealizedPnl: number;
  fundingAccrued: number;
  openedAt: number;
}

export interface PredictionMarket {
  id: string;
  question: string;
  category: string;
  outcomes: Array<{ name: string; price: number; shares: number }>;
  volume: number;
  liquidity: number;
  resolved: boolean;
  resolution?: string;
  expiresAt: number;
  createdAt: number;
}

export interface TokenizedRWA {
  id: string;
  symbol: string;
  protocol: YieldProtocol;
  underlyingAsset: string;
  apy: number;
  totalSupply: number;
  navPerToken: number;
  minInvestment: number;
  accreditedOnly: boolean;
  chain: string[];
}

/* ─── Stablecoin Registry ─────────────────────────────────────────────────── */

const STABLECOINS: SyntheticDollar[] = [
  { symbol: 'USDe', protocol: 'ethena', type: 'delta_neutral', peg: 1.0, totalSupply: 5_000_000_000, backingAssets: ['stETH', 'ETH', 'BTC'], yieldBearing: false, stakedSymbol: 'sUSDe', stakingAPY: 25.0, collateralRatio: 1.01, chain: ['ethereum', 'arbitrum', 'base'] },
  { symbol: 'sUSDe', protocol: 'ethena', type: 'delta_neutral', peg: 1.07, totalSupply: 2_500_000_000, backingAssets: ['USDe'], yieldBearing: true, stakingAPY: 25.0, collateralRatio: 1.07, chain: ['ethereum'] },
  { symbol: 'DAI', protocol: 'maker', type: 'crypto_backed', peg: 1.0, totalSupply: 5_300_000_000, backingAssets: ['ETH', 'WBTC', 'USDC', 'RWA'], yieldBearing: false, stakedSymbol: 'sDAI', stakingAPY: 8.0, collateralRatio: 1.50, chain: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'] },
  { symbol: 'USDS', protocol: 'maker', type: 'crypto_backed', peg: 1.0, totalSupply: 3_000_000_000, backingAssets: ['ETH', 'WBTC', 'USDC', 'RWA'], yieldBearing: true, stakingAPY: 6.5, collateralRatio: 1.50, chain: ['ethereum', 'base'] },
  { symbol: 'FRAX', protocol: 'frax', type: 'hybrid', peg: 1.0, totalSupply: 800_000_000, backingAssets: ['USDC', 'FXS', 'sFRAX'], yieldBearing: false, stakedSymbol: 'sFRAX', stakingAPY: 5.5, collateralRatio: 1.0, chain: ['ethereum', 'arbitrum', 'polygon'] },
  { symbol: 'sfrxETH', protocol: 'frax', type: 'hybrid', peg: 3380, totalSupply: 200_000, backingAssets: ['ETH'], yieldBearing: true, stakingAPY: 4.2, collateralRatio: 1.05, chain: ['ethereum'] },
  { symbol: 'EURA', protocol: 'angle', type: 'crypto_backed', peg: 1.085, totalSupply: 100_000_000, backingAssets: ['USDC', 'EUROC', 'ETH'], yieldBearing: false, collateralRatio: 1.20, chain: ['ethereum', 'polygon', 'arbitrum'] },
  { symbol: 'OUSG', protocol: 'ondo', type: 'rwa_backed', peg: 107.5, totalSupply: 200_000_000, backingAssets: ['US Treasuries'], yieldBearing: true, stakingAPY: 5.1, collateralRatio: 1.0, chain: ['ethereum'] },
  { symbol: 'USDY', protocol: 'ondo', type: 'rwa_backed', peg: 1.05, totalSupply: 500_000_000, backingAssets: ['US Treasuries', 'Bank Deposits'], yieldBearing: true, stakingAPY: 5.0, collateralRatio: 1.0, chain: ['ethereum', 'solana', 'mantle'] },
  { symbol: 'USDM', protocol: 'mountain', type: 'rwa_backed', peg: 1.0, totalSupply: 300_000_000, backingAssets: ['US T-Bills'], yieldBearing: true, stakingAPY: 5.0, collateralRatio: 1.0, chain: ['ethereum', 'base', 'arbitrum'] },
];

/* ─── Yield Vaults ────────────────────────────────────────────────────────── */

const YIELD_VAULTS: YieldVault[] = [
  // Ethena
  { id: 'ethena-susde', protocol: 'ethena', name: 'Ethena sUSDe Staking', asset: 'USDe', strategy: 'basis_trade', tvl: 2_500_000_000, apy: 25.0, apyBreakdown: { base: 15.0, rewards: 10.0 }, risk: 'medium', maxDeposit: 10_000_000, totalDepositors: 50_000, chain: 'ethereum', active: true },
  // Yearn
  { id: 'yearn-eth', protocol: 'yearn', name: 'Yearn ETH Vault', asset: 'ETH', strategy: 'leveraged_staking', tvl: 450_000_000, apy: 5.8, apyBreakdown: { base: 3.5, rewards: 2.3 }, risk: 'medium', maxDeposit: 5_000_000, totalDepositors: 15_000, chain: 'ethereum', active: true },
  { id: 'yearn-usdc', protocol: 'yearn', name: 'Yearn USDC Vault', asset: 'USDC', strategy: 'lending', tvl: 800_000_000, apy: 8.2, apyBreakdown: { base: 5.0, rewards: 3.2 }, risk: 'low', maxDeposit: 50_000_000, totalDepositors: 30_000, chain: 'ethereum', active: true },
  // Maker DSR
  { id: 'maker-sdai', protocol: 'maker', name: 'Maker DAI Savings Rate', asset: 'DAI', strategy: 'lending', tvl: 3_000_000_000, apy: 8.0, apyBreakdown: { base: 8.0, rewards: 0 }, risk: 'low', maxDeposit: 100_000_000, totalDepositors: 100_000, chain: 'ethereum', active: true },
  // Convex
  { id: 'convex-3pool', protocol: 'convex', name: 'Convex 3Pool', asset: '3CRV', strategy: 'liquidity_provision', tvl: 600_000_000, apy: 4.5, apyBreakdown: { base: 1.5, rewards: 1.5, boost: 1.5 }, risk: 'low', maxDeposit: 20_000_000, totalDepositors: 8_000, chain: 'ethereum', active: true },
  { id: 'convex-steth', protocol: 'convex', name: 'Convex stETH/ETH', asset: 'stETH/ETH', strategy: 'liquidity_provision', tvl: 900_000_000, apy: 5.5, apyBreakdown: { base: 2.0, rewards: 2.0, boost: 1.5 }, risk: 'low', maxDeposit: 30_000_000, totalDepositors: 12_000, chain: 'ethereum', active: true },
  // Morpho
  { id: 'morpho-eth-usdc', protocol: 'morpho', name: 'Morpho ETH/USDC', asset: 'ETH', strategy: 'lending', tvl: 1_200_000_000, apy: 4.0, apyBreakdown: { base: 3.5, rewards: 0.5 }, risk: 'low', maxDeposit: 50_000_000, totalDepositors: 20_000, chain: 'ethereum', active: true },
  // Aura
  { id: 'aura-wsteth-weth', protocol: 'aura', name: 'Aura wstETH/WETH', asset: 'wstETH/WETH', strategy: 'liquidity_provision', tvl: 400_000_000, apy: 6.2, apyBreakdown: { base: 2.5, rewards: 2.0, boost: 1.7 }, risk: 'low', maxDeposit: 15_000_000, totalDepositors: 5_000, chain: 'ethereum', active: true },
  // Ondo
  { id: 'ondo-ousg', protocol: 'ondo', name: 'Ondo US Treasuries (OUSG)', asset: 'USDC', strategy: 'lending', tvl: 200_000_000, apy: 5.1, apyBreakdown: { base: 5.1, rewards: 0 }, risk: 'low', maxDeposit: 50_000_000, totalDepositors: 500, chain: 'ethereum', active: true },
  // GMX
  { id: 'gmx-glp', protocol: 'gmx', name: 'GMX GLP', asset: 'ETH/BTC/USDC', strategy: 'liquidity_provision', tvl: 500_000_000, apy: 15.0, apyBreakdown: { base: 8.0, rewards: 7.0 }, risk: 'high', maxDeposit: 10_000_000, totalDepositors: 25_000, chain: 'arbitrum', active: true },
];

/* ─── Prediction Markets ──────────────────────────────────────────────────── */

const PREDICTION_MARKETS: PredictionMarket[] = [
  { id: 'poly-btc-100k', question: 'Will Bitcoin reach $100k by end of 2025?', category: 'Crypto', outcomes: [{ name: 'Yes', price: 0.72, shares: 5_000_000 }, { name: 'No', price: 0.28, shares: 2_000_000 }], volume: 25_000_000, liquidity: 8_000_000, resolved: false, expiresAt: Date.now() + 280 * 24 * 60 * 60 * 1000, createdAt: Date.now() - 90 * 24 * 60 * 60 * 1000 },
  { id: 'poly-eth-etf', question: 'Will Ethereum ETF net inflows exceed $10B in 2025?', category: 'Crypto', outcomes: [{ name: 'Yes', price: 0.55, shares: 3_000_000 }, { name: 'No', price: 0.45, shares: 2_500_000 }], volume: 12_000_000, liquidity: 4_000_000, resolved: false, expiresAt: Date.now() + 280 * 24 * 60 * 60 * 1000, createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000 },
  { id: 'poly-fed-rate', question: 'Will the Fed cut rates below 4% by June 2025?', category: 'Economics', outcomes: [{ name: 'Yes', price: 0.35, shares: 8_000_000 }, { name: 'No', price: 0.65, shares: 15_000_000 }], volume: 40_000_000, liquidity: 12_000_000, resolved: false, expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000, createdAt: Date.now() - 120 * 24 * 60 * 60 * 1000 },
  { id: 'poly-ai-agi', question: 'Will a major lab announce AGI by 2026?', category: 'Technology', outcomes: [{ name: 'Yes', price: 0.18, shares: 2_000_000 }, { name: 'No', price: 0.82, shares: 9_000_000 }], volume: 8_000_000, liquidity: 3_000_000, resolved: false, expiresAt: Date.now() + 650 * 24 * 60 * 60 * 1000, createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000 },
];

/* ─── Tokenized RWAs ──────────────────────────────────────────────────────── */

const TOKENIZED_RWAS: TokenizedRWA[] = [
  { id: 'ondo-ousg', symbol: 'OUSG', protocol: 'ondo', underlyingAsset: 'US Treasury Bonds', apy: 5.1, totalSupply: 200_000_000, navPerToken: 107.5, minInvestment: 100_000, accreditedOnly: true, chain: ['ethereum'] },
  { id: 'ondo-usdy', symbol: 'USDY', protocol: 'ondo', underlyingAsset: 'US Treasuries + Bank Deposits', apy: 5.0, totalSupply: 500_000_000, navPerToken: 1.05, minInvestment: 500, accreditedOnly: false, chain: ['ethereum', 'solana', 'mantle'] },
  { id: 'mountain-usdm', symbol: 'USDM', protocol: 'mountain', underlyingAsset: 'Short-term US T-Bills', apy: 5.0, totalSupply: 300_000_000, navPerToken: 1.0, minInvestment: 100, accreditedOnly: false, chain: ['ethereum', 'base', 'arbitrum'] },
];

/* ─── State ───────────────────────────────────────────────────────────────── */

const cdpPositions: Map<string, CDPPosition> = new Map();
const perpPositions: Map<string, PerpPosition> = new Map();

/* ─── CDP (MakerDAO-style) ────────────────────────────────────────────────── */

const COLLATERAL_PRICES: Record<string, number> = {
  ETH: 3200, WBTC: 68000, WSTETH: 3760, stETH: 3200, USDC: 1,
};
const MIN_COLLATERAL_RATIO = 1.5;

export function openCDP(input: {
  owner: string;
  collateralAsset: string;
  collateralAmount: number;
  debtAmount: number;
}): CDPPosition {
  const price = COLLATERAL_PRICES[input.collateralAsset] || 1;
  const collateralValue = input.collateralAmount * price;
  const ratio = collateralValue / input.debtAmount;

  if (ratio < MIN_COLLATERAL_RATIO) {
    throw new Error(`Collateral ratio ${ratio.toFixed(2)} below minimum ${MIN_COLLATERAL_RATIO}`);
  }

  const position: CDPPosition = {
    id: `cdp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    owner: input.owner,
    collateralAsset: input.collateralAsset,
    collateralAmount: input.collateralAmount,
    debtAsset: 'DAI',
    debtAmount: input.debtAmount,
    collateralRatio: ratio,
    liquidationPrice: (input.debtAmount * MIN_COLLATERAL_RATIO) / input.collateralAmount,
    stabilityFee: 0.05,
    createdAt: Date.now(),
  };

  cdpPositions.set(position.id, position);
  return position;
}

export function repayCDP(cdpId: string, amount: number): CDPPosition | null {
  const position = cdpPositions.get(cdpId);
  if (!position) return null;
  position.debtAmount = Math.max(0, position.debtAmount - amount);
  const price = COLLATERAL_PRICES[position.collateralAsset] || 1;
  position.collateralRatio = (position.collateralAmount * price) / Math.max(1, position.debtAmount);
  return position;
}

/* ─── Perpetual Futures ───────────────────────────────────────────────────── */

export function openPerpPosition(input: {
  protocol: YieldProtocol;
  market: string;
  side: PerpSide;
  margin: number;
  leverage: number;
}): PerpPosition {
  const baseAsset = input.market.split('-')[0];
  const entryPrice = COLLATERAL_PRICES[baseAsset] || 100;
  const size = input.margin * input.leverage / entryPrice;
  const liquidationPct = 1 / input.leverage;
  const liquidationPrice = input.side === 'long'
    ? entryPrice * (1 - liquidationPct * 0.9)
    : entryPrice * (1 + liquidationPct * 0.9);

  const position: PerpPosition = {
    id: `perp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    protocol: input.protocol,
    market: input.market,
    side: input.side,
    size,
    leverage: input.leverage,
    entryPrice,
    markPrice: entryPrice,
    liquidationPrice,
    margin: input.margin,
    unrealizedPnl: 0,
    fundingAccrued: 0,
    openedAt: Date.now(),
  };

  perpPositions.set(position.id, position);
  return position;
}

export function closePerpPosition(positionId: string, closePrice: number): { pnl: number; roi: number } | null {
  const position = perpPositions.get(positionId);
  if (!position) return null;

  const priceDiff = closePrice - position.entryPrice;
  const pnl = position.side === 'long'
    ? position.size * priceDiff
    : position.size * -priceDiff;

  const roi = pnl / position.margin;
  perpPositions.delete(positionId);
  return { pnl, roi };
}

/* ─── Registry Queries ────────────────────────────────────────────────────── */

export function getStablecoins(): SyntheticDollar[] { return [...STABLECOINS]; }
export function getStablecoin(symbol: string): SyntheticDollar | null { return STABLECOINS.find((s) => s.symbol === symbol) || null; }
export function getYieldVaults(): YieldVault[] { return [...YIELD_VAULTS]; }
export function getVaultsByProtocol(protocol: YieldProtocol): YieldVault[] { return YIELD_VAULTS.filter((v) => v.protocol === protocol); }
export function getBestYieldVaults(minAPY: number = 5, limit: number = 10): YieldVault[] { return YIELD_VAULTS.filter((v) => v.apy >= minAPY && v.active).sort((a, b) => b.apy - a.apy).slice(0, limit); }
export function getPredictionMarkets(): PredictionMarket[] { return [...PREDICTION_MARKETS]; }
export function getTokenizedRWAs(): TokenizedRWA[] { return [...TOKENIZED_RWAS]; }

/* ─── Protocol Summary ────────────────────────────────────────────────────── */

export function getYieldSyntheticsSummary() {
  return {
    name: 'FreedomForge Yield & Synthetic Assets',
    version: '1.0.0',
    inspired_by: ['Ethena', 'MakerDAO/Sky', 'Synthetix', 'Yearn V3', 'Morpho', 'Convex', 'Aura', 'Polymarket', 'dYdX', 'GMX', 'Ondo', 'Mountain', 'Angle', 'Frax'],
    stablecoins: {
      total: STABLECOINS.length,
      totalSupply: STABLECOINS.reduce((s, c) => s + c.totalSupply, 0),
      byType: {
        delta_neutral: STABLECOINS.filter((s) => s.type === 'delta_neutral').length,
        crypto_backed: STABLECOINS.filter((s) => s.type === 'crypto_backed').length,
        rwa_backed: STABLECOINS.filter((s) => s.type === 'rwa_backed').length,
        hybrid: STABLECOINS.filter((s) => s.type === 'hybrid').length,
      },
      yieldBearing: STABLECOINS.filter((s) => s.yieldBearing).map((s) => ({ symbol: s.symbol, apy: s.stakingAPY })),
    },
    vaults: {
      total: YIELD_VAULTS.length,
      totalTVL: YIELD_VAULTS.reduce((s, v) => s + v.tvl, 0),
      avgAPY: YIELD_VAULTS.reduce((s, v) => s + v.apy, 0) / YIELD_VAULTS.length,
      topVaults: YIELD_VAULTS.sort((a, b) => b.apy - a.apy).slice(0, 3).map((v) => ({ name: v.name, apy: v.apy, tvl: v.tvl })),
    },
    predictionMarkets: {
      total: PREDICTION_MARKETS.length,
      totalVolume: PREDICTION_MARKETS.reduce((s, m) => s + m.volume, 0),
      categories: [...new Set(PREDICTION_MARKETS.map((m) => m.category))],
    },
    rwa: {
      total: TOKENIZED_RWAS.length,
      totalSupply: TOKENIZED_RWAS.reduce((s, r) => s + r.totalSupply, 0),
    },
    features: [
      '10 stablecoins (delta-neutral, crypto-backed, RWA-backed, hybrid)',
      '10 yield vaults across 8 protocols (Ethena, Yearn, Maker, Convex, Morpho, Aura, Ondo, GMX)',
      'MakerDAO CDP engine with collateral management',
      'Perpetual futures (dYdX, GMX) with leverage up to 50x',
      'Polymarket-style prediction markets',
      'Tokenized real-world assets (US Treasuries via Ondo, Mountain)',
      'Ethena USDe/sUSDe delta-neutral yield (25% APY)',
      'Convex/Aura gauge boosting for Curve/Balancer LPs',
      'Morpho peer-to-peer lending optimization',
      'Frax hybrid algorithmic stablecoins + sfrxETH',
    ],
  };
}
