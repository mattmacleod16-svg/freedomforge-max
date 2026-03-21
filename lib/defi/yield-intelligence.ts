/**
 * Yield Intelligence Engine
 *
 * Inspired by Nunchi's Yield Exchange (YEX) architecture:
 * - Aggregates real-time DeFi yield data across protocols and chains
 * - Tracks yield rate movements like price movements (yield-as-an-asset)
 * - Calculates yield spreads, volatility, and arbitrage opportunities
 * - Monitors funding rates across perpetual exchanges
 *
 * Data sources: DeFi Llama, on-chain protocol APIs, exchange funding rates
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface YieldMarket {
  protocol: string;
  chain: string;
  asset: string;
  pool: string;
  apy: number;           // Current APY %
  apy7d: number;         // 7-day average APY
  apy30d: number;        // 30-day average APY
  tvl: number;           // Total value locked (USD)
  change24h: number;     // APY change in last 24h (basis points)
  volatility: number;    // Yield volatility (std dev of daily APY)
  type: 'lending' | 'staking' | 'lp' | 'vault' | 'farming';
  risk: 'low' | 'medium' | 'high';
}

export interface FundingRate {
  exchange: string;
  pair: string;
  rate: number;          // Current funding rate %
  annualized: number;    // Annualized rate %
  nextFunding: string;   // ISO timestamp
  interval: string;      // '8h', '1h', etc.
  direction: 'long-pays' | 'short-pays';
}

export interface YieldSpread {
  asset: string;
  highProtocol: string;
  highChain: string;
  highApy: number;
  lowProtocol: string;
  lowChain: string;
  lowApy: number;
  spread: number;        // basis points
  opportunity: string;   // Description
}

export interface YieldIntelligence {
  topYields: YieldMarket[];
  stablecoinYields: YieldMarket[];
  fundingRates: FundingRate[];
  spreads: YieldSpread[];
  marketSummary: {
    avgDeFiYield: number;
    avgStablecoinYield: number;
    avgFundingRate: number;
    totalTVL: number;
    yieldTrend: 'rising' | 'falling' | 'stable';
  };
  lastUpdated: string;
}

// ── DeFi Llama Integration ─────────────────────────────────────────────

async function fetchTopYields(): Promise<YieldMarket[]> {
  try {
    const res = await fetch('https://yields.llama.fi/pools', {
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);

    if (!res?.ok) return [];

    const data = await res.json();
    const pools = (data.data || []) as Array<{
      pool: string;
      project: string;
      chain: string;
      symbol: string;
      tvlUsd: number;
      apy: number;
      apyMean30d: number;
      apyMean7d?: number;
      ilRisk: string;
      stablecoin: boolean;
      exposure: string;
    }>;

    // Filter to meaningful pools (TVL > $1M, APY > 0)
    const meaningful = pools
      .filter((p) => p.tvlUsd > 1_000_000 && p.apy > 0 && p.apy < 1000)
      .sort((a, b) => b.apy - a.apy)
      .slice(0, 50);

    return meaningful.map((p) => ({
      protocol: p.project,
      chain: p.chain,
      asset: p.symbol,
      pool: p.pool,
      apy: Math.round(p.apy * 100) / 100,
      apy7d: Math.round((p.apyMean7d || p.apy) * 100) / 100,
      apy30d: Math.round(p.apyMean30d * 100) / 100,
      tvl: Math.round(p.tvlUsd),
      change24h: Math.round((p.apy - p.apyMean30d) * 100), // approx bps change
      volatility: Math.round(Math.abs(p.apy - p.apyMean30d) * 10) / 10,
      type: p.ilRisk === 'no' ? ('lending' as const) : ('lp' as const),
      risk: p.apy > 50 ? ('high' as const) : p.apy > 15 ? ('medium' as const) : ('low' as const),
    }));
  } catch {
    return [];
  }
}

async function fetchStablecoinYields(): Promise<YieldMarket[]> {
  try {
    const res = await fetch('https://yields.llama.fi/pools', {
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);

    if (!res?.ok) return [];

    const data = await res.json();
    const pools = (data.data || []) as Array<{
      pool: string;
      project: string;
      chain: string;
      symbol: string;
      tvlUsd: number;
      apy: number;
      apyMean30d: number;
      apyMean7d?: number;
      stablecoin: boolean;
    }>;

    return pools
      .filter((p) => p.stablecoin && p.tvlUsd > 1_000_000 && p.apy > 0 && p.apy < 500)
      .sort((a, b) => b.apy - a.apy)
      .slice(0, 20)
      .map((p) => ({
        protocol: p.project,
        chain: p.chain,
        asset: p.symbol,
        pool: p.pool,
        apy: Math.round(p.apy * 100) / 100,
        apy7d: Math.round((p.apyMean7d || p.apy) * 100) / 100,
        apy30d: Math.round(p.apyMean30d * 100) / 100,
        tvl: Math.round(p.tvlUsd),
        change24h: Math.round((p.apy - p.apyMean30d) * 100),
        volatility: Math.round(Math.abs(p.apy - p.apyMean30d) * 10) / 10,
        type: 'lending' as const,
        risk: p.apy > 30 ? ('medium' as const) : ('low' as const),
      }));
  } catch {
    return [];
  }
}

// ── Funding Rates ──────────────────────────────────────────────────────

async function fetchFundingRates(): Promise<FundingRate[]> {
  const rates: FundingRate[] = [];

  // Fetch from CoinGlass (public endpoint) or fallback
  try {
    const res = await fetch('https://open-api.coinglass.com/public/v2/funding', {
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);

    if (res?.ok) {
      const data = await res.json();
      if (data.data) {
        for (const item of data.data.slice(0, 20)) {
          rates.push({
            exchange: item.exchangeName || 'Unknown',
            pair: item.symbol || 'BTC/USD',
            rate: parseFloat(item.rate || '0'),
            annualized: parseFloat(item.rate || '0') * 3 * 365,
            nextFunding: new Date(Date.now() + 8 * 3600000).toISOString(),
            interval: '8h',
            direction: parseFloat(item.rate || '0') > 0 ? 'long-pays' : 'short-pays',
          });
        }
      }
    }
  } catch { /* ignore */ }

  // If no data from API, provide major pairs as reference
  if (rates.length === 0) {
    const pairs = ['BTC-PERP', 'ETH-PERP', 'SOL-PERP', 'ARB-PERP', 'OP-PERP'];
    const exchanges = ['Binance', 'Bybit', 'Hyperliquid', 'dYdX'];
    for (const pair of pairs) {
      for (const exchange of exchanges) {
        rates.push({
          exchange,
          pair,
          rate: 0,
          annualized: 0,
          nextFunding: new Date(Date.now() + 8 * 3600000).toISOString(),
          interval: '8h',
          direction: 'long-pays',
        });
      }
    }
  }

  return rates;
}

// ── Yield Spreads ──────────────────────────────────────────────────────

function calculateSpreads(yields: YieldMarket[]): YieldSpread[] {
  const byAsset = new Map<string, YieldMarket[]>();
  for (const y of yields) {
    const key = y.asset.split('-')[0].toUpperCase();
    if (!byAsset.has(key)) byAsset.set(key, []);
    byAsset.get(key)!.push(y);
  }

  const spreads: YieldSpread[] = [];
  for (const [asset, markets] of byAsset) {
    if (markets.length < 2) continue;
    const sorted = markets.sort((a, b) => b.apy - a.apy);
    const high = sorted[0];
    const low = sorted[sorted.length - 1];
    const spread = Math.round((high.apy - low.apy) * 100);

    if (spread > 50) {
      spreads.push({
        asset,
        highProtocol: high.protocol,
        highChain: high.chain,
        highApy: high.apy,
        lowProtocol: low.protocol,
        lowChain: low.chain,
        lowApy: low.apy,
        spread,
        opportunity: `Borrow on ${low.protocol} (${low.chain}) at ${low.apy.toFixed(1)}%, lend on ${high.protocol} (${high.chain}) at ${high.apy.toFixed(1)}% → ${(spread / 100).toFixed(1)}% spread`,
      });
    }
  }

  return spreads.sort((a, b) => b.spread - a.spread).slice(0, 10);
}

// ── Main Export ─────────────────────────────────────────────────────────

export async function getYieldIntelligence(): Promise<YieldIntelligence> {
  const [topYields, stablecoinYields, fundingRates] = await Promise.all([
    fetchTopYields(),
    fetchStablecoinYields(),
    fetchFundingRates(),
  ]);

  const spreads = calculateSpreads([...topYields, ...stablecoinYields]);

  const avgDeFi = topYields.length > 0
    ? topYields.reduce((s, y) => s + y.apy, 0) / topYields.length
    : 0;
  const avgStable = stablecoinYields.length > 0
    ? stablecoinYields.reduce((s, y) => s + y.apy, 0) / stablecoinYields.length
    : 0;
  const avgFunding = fundingRates.length > 0
    ? fundingRates.reduce((s, r) => s + r.annualized, 0) / fundingRates.length
    : 0;
  const totalTVL = topYields.reduce((s, y) => s + y.tvl, 0);

  const avgChange = topYields.length > 0
    ? topYields.reduce((s, y) => s + y.change24h, 0) / topYields.length
    : 0;
  const yieldTrend: 'rising' | 'falling' | 'stable' =
    avgChange > 20 ? 'rising' : avgChange < -20 ? 'falling' : 'stable';

  return {
    topYields: topYields.slice(0, 20),
    stablecoinYields: stablecoinYields.slice(0, 10),
    fundingRates: fundingRates.slice(0, 20),
    spreads,
    marketSummary: {
      avgDeFiYield: Math.round(avgDeFi * 100) / 100,
      avgStablecoinYield: Math.round(avgStable * 100) / 100,
      avgFundingRate: Math.round(avgFunding * 100) / 100,
      totalTVL,
      yieldTrend,
    },
    lastUpdated: new Date().toISOString(),
  };
}
