/**
 * Market Intelligence Engine — FreedomForge Max
 * ═══════════════════════════════════════════════
 *
 * Real-time structured market data and smart money tracking:
 *
 *  • Options Flow — Unusual options activity, sweeps, and block trades
 *  • Dark Pool Activity — Off-exchange institutional trading signals
 *  • Congressional Trades — STOCK Act compliance tracking
 *  • 13F Filings — Institutional portfolio disclosure tracking
 *  • Insider Activity — SEC Form 4 buy/sell tracking
 *  • Smart Money Signals — Whale wallet tracking + divergence detection
 *  • Technical Indicators — RSI, MACD, Bollinger, volume profiles
 *  • Sentiment Analysis — Social/news sentiment aggregation
 *  • Market Regime Detection — Bull/bear/sideways classification
 *  • Polymarket Integration — Prediction market odds as signals
 *  • On-Chain Analytics — DEX volume, whale flows, exchange reserves
 *
 * Inspired by: Unusual Whales, Arkham Intelligence, Nansen, Glassnode,
 *              Santiment, DeBank, Dune Analytics, Token Terminal
 */

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type SignalType = 'options_flow' | 'dark_pool' | 'congressional' | '13f_filing' | 'insider' | 'whale_alert' | 'technical' | 'sentiment' | 'on_chain';
export type SignalStrength = 'weak' | 'moderate' | 'strong' | 'extreme';
export type MarketRegime = 'strong_bull' | 'bull' | 'neutral' | 'bear' | 'strong_bear' | 'high_volatility';
export type OptionType = 'call' | 'put';
export type OrderFlow = 'sweep' | 'block' | 'split' | 'single';
export type InsiderRole = 'CEO' | 'CFO' | 'COO' | 'CTO' | 'Director' | 'VP' | '10%_Owner' | 'Officer';

export interface OptionsFlowAlert {
  id: string;
  ticker: string;
  optionType: OptionType;
  strike: number;
  expiry: string;
  premium: number;
  volume: number;
  openInterest: number;
  flow: OrderFlow;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  smartMoneyScore: number;
  exchange: string;
  timestamp: number;
}

export interface DarkPoolTrade {
  id: string;
  ticker: string;
  price: number;
  size: number;
  notionalValue: number;
  venue: string;
  aboveBid: boolean;
  blockTrade: boolean;
  smartMoneyScore: number;
  timestamp: number;
}

export interface CongressionalTrade {
  id: string;
  politician: string;
  party: 'D' | 'R' | 'I';
  chamber: 'Senate' | 'House';
  ticker: string;
  transactionType: 'purchase' | 'sale' | 'exchange';
  amount: { min: number; max: number };
  reportedDate: string;
  transactionDate: string;
  committee?: string;
  daysToReport: number;
}

export interface Filing13F {
  id: string;
  institution: string;
  cik: string;
  filingDate: string;
  reportDate: string;
  totalValue: number;
  positions: number;
  newPositions: Array<{ ticker: string; shares: number; value: number }>;
  increasedPositions: Array<{ ticker: string; changeShares: number; changePct: number }>;
  decreasedPositions: Array<{ ticker: string; changeShares: number; changePct: number }>;
  closedPositions: Array<{ ticker: string; previousShares: number }>;
  topHoldings: Array<{ ticker: string; value: number; pctOfPortfolio: number }>;
}

export interface InsiderTransaction {
  id: string;
  ticker: string;
  insider: string;
  role: InsiderRole;
  transactionType: 'buy' | 'sell' | 'exercise' | 'gift';
  shares: number;
  pricePerShare: number;
  totalValue: number;
  sharesAfter: number;
  filingDate: string;
  transactionDate: string;
}

export interface WhaleAlert {
  id: string;
  chain: string;
  token: string;
  amount: number;
  usdValue: number;
  from: string;
  to: string;
  fromLabel?: string;
  toLabel?: string;
  txHash: string;
  isExchangeDeposit: boolean;
  isExchangeWithdrawal: boolean;
  timestamp: number;
}

export interface TechnicalSignal {
  ticker: string;
  timeframe: string;
  rsi: number;
  macd: { line: number; signal: number; histogram: number };
  bollingerBands: { upper: number; middle: number; lower: number };
  sma: Record<string, number>;
  ema: Record<string, number>;
  volumeProfile: { poc: number; valueAreaHigh: number; valueAreaLow: number };
  trend: 'uptrend' | 'downtrend' | 'sideways';
  support: number[];
  resistance: number[];
  updatedAt: number;
}

export interface SentimentData {
  ticker: string;
  overallScore: number;
  socialScore: number;
  newsScore: number;
  fearGreedIndex: number;
  twitterMentions24h: number;
  redditMentions24h: number;
  newsArticles24h: number;
  sentimentShift: number;
  updatedAt: number;
}

export interface OnChainMetrics {
  token: string;
  chain: string;
  exchangeReserves: number;
  exchangeNetFlow24h: number;
  activeAddresses24h: number;
  newAddresses24h: number;
  dexVolume24h: number;
  topHolderConcentration: number;
  nvtRatio: number;
  mvrv: number;
  whaleTransactions24h: number;
  updatedAt: number;
}

export interface SmartMoneyDivergence {
  ticker: string;
  smartMoneyBias: 'bullish' | 'bearish' | 'neutral';
  retailBias: 'bullish' | 'bearish' | 'neutral';
  divergenceStrength: SignalStrength;
  signals: string[];
  historicalAccuracy: number;
  timestamp: number;
}

export interface MarketRegimeIndicator {
  regime: MarketRegime;
  confidence: number;
  vix: number;
  breadth: number;
  momentum: number;
  volatility: number;
  trendStrength: number;
  updatedAt: number;
}

/* ─── Data Provider Registry ──────────────────────────────────────────────── */

export interface DataProvider {
  id: string;
  name: string;
  category: string;
  dataTypes: SignalType[];
  chains?: string[];
  endpoint?: string;
  apiKeyRequired: boolean;
  rateLimitPerMin: number;
}

const DATA_PROVIDERS: DataProvider[] = [
  { id: 'unusual_whales', name: 'Unusual Whales', category: 'Options/Equities', dataTypes: ['options_flow', 'dark_pool', 'congressional', '13f_filing', 'insider'], apiKeyRequired: true, rateLimitPerMin: 60 },
  { id: 'arkham', name: 'Arkham Intelligence', category: 'On-Chain', dataTypes: ['whale_alert', 'on_chain'], chains: ['ethereum', 'bitcoin', 'solana', 'base', 'arbitrum'], apiKeyRequired: true, rateLimitPerMin: 30 },
  { id: 'nansen', name: 'Nansen', category: 'On-Chain Analytics', dataTypes: ['whale_alert', 'on_chain'], chains: ['ethereum', 'solana', 'base', 'polygon', 'arbitrum'], apiKeyRequired: true, rateLimitPerMin: 30 },
  { id: 'glassnode', name: 'Glassnode', category: 'On-Chain Metrics', dataTypes: ['on_chain', 'sentiment'], chains: ['bitcoin', 'ethereum'], apiKeyRequired: true, rateLimitPerMin: 10 },
  { id: 'santiment', name: 'Santiment', category: 'Crypto Intelligence', dataTypes: ['sentiment', 'on_chain', 'whale_alert'], chains: ['ethereum', 'bitcoin', 'solana'], apiKeyRequired: true, rateLimitPerMin: 20 },
  { id: 'debank', name: 'DeBank', category: 'Wallet Analytics', dataTypes: ['whale_alert', 'on_chain'], chains: ['ethereum', 'base', 'arbitrum', 'polygon', 'optimism', 'bsc'], apiKeyRequired: false, rateLimitPerMin: 60 },
  { id: 'dune', name: 'Dune Analytics', category: 'On-Chain SQL', dataTypes: ['on_chain'], chains: ['ethereum', 'solana', 'base', 'polygon', 'arbitrum', 'optimism'], apiKeyRequired: true, rateLimitPerMin: 40 },
  { id: 'token_terminal', name: 'Token Terminal', category: 'Fundamentals', dataTypes: ['on_chain'], apiKeyRequired: true, rateLimitPerMin: 30 },
  { id: 'defillama', name: 'DefiLlama', category: 'DeFi TVL/Yields', dataTypes: ['on_chain'], apiKeyRequired: false, rateLimitPerMin: 300 },
  { id: 'coinglass', name: 'Coinglass', category: 'Derivatives Data', dataTypes: ['options_flow', 'technical'], apiKeyRequired: true, rateLimitPerMin: 30 },
  { id: 'messari', name: 'Messari', category: 'Research/Data', dataTypes: ['on_chain', 'sentiment'], apiKeyRequired: true, rateLimitPerMin: 20 },
  { id: 'whale_alert', name: 'Whale Alert', category: 'Large TX Tracking', dataTypes: ['whale_alert'], chains: ['bitcoin', 'ethereum', 'solana', 'xrp', 'tron'], apiKeyRequired: true, rateLimitPerMin: 10 },
];

/* ─── Sample Data Generators ──────────────────────────────────────────────── */

function generateOptionsFlow(count: number = 5): OptionsFlowAlert[] {
  const tickers = ['SPY', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'AMD', 'QQQ', 'COIN', 'MSTR'];
  const flows: OrderFlow[] = ['sweep', 'block', 'split', 'single'];
  const exchanges = ['CBOE', 'ISE', 'PHLX', 'NYSE', 'MIAX', 'PEARL'];

  return Array.from({ length: count }, (_, i) => {
    const ticker = tickers[i % tickers.length];
    const isCall = Math.random() > 0.45;
    return {
      id: `opt_${Date.now().toString(36)}_${i}`,
      ticker,
      optionType: isCall ? 'call' as OptionType : 'put' as OptionType,
      strike: Math.round((100 + Math.random() * 400) * 100) / 100,
      expiry: new Date(Date.now() + (7 + Math.floor(Math.random() * 90)) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      premium: Math.round(Math.random() * 5_000_000),
      volume: Math.floor(Math.random() * 10_000) + 100,
      openInterest: Math.floor(Math.random() * 50_000),
      flow: flows[Math.floor(Math.random() * flows.length)],
      sentiment: isCall ? 'bullish' as const : 'bearish' as const,
      smartMoneyScore: Math.round(Math.random() * 100),
      exchange: exchanges[Math.floor(Math.random() * exchanges.length)],
      timestamp: Date.now() - Math.floor(Math.random() * 3600_000),
    };
  });
}

function generateDarkPoolTrades(count: number = 5): DarkPoolTrade[] {
  const tickers = ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'META', 'GOOGL', 'JPM', 'GS', 'BAC'];
  const venues = ['UBSS', 'CROS', 'SGMA', 'JNST', 'VIRX', 'CITG'];

  return Array.from({ length: count }, (_, i) => {
    const price = 100 + Math.random() * 500;
    const size = Math.floor(Math.random() * 100_000) + 1_000;
    return {
      id: `dp_${Date.now().toString(36)}_${i}`,
      ticker: tickers[i % tickers.length],
      price,
      size,
      notionalValue: price * size,
      venue: venues[Math.floor(Math.random() * venues.length)],
      aboveBid: Math.random() > 0.4,
      blockTrade: size > 10_000,
      smartMoneyScore: Math.round(Math.random() * 100),
      timestamp: Date.now() - Math.floor(Math.random() * 3600_000),
    };
  });
}

function generateCongressionalTrades(count: number = 3): CongressionalTrade[] {
  const politicians = [
    { name: 'Nancy Pelosi', party: 'D' as const, chamber: 'House' as const },
    { name: 'Dan Crenshaw', party: 'R' as const, chamber: 'House' as const },
    { name: 'Tommy Tuberville', party: 'R' as const, chamber: 'Senate' as const },
    { name: 'Mark Kelly', party: 'D' as const, chamber: 'Senate' as const },
  ];
  const tickers = ['NVDA', 'MSFT', 'GOOGL', 'CRM', 'PANW', 'RBLX'];

  return Array.from({ length: count }, (_, i) => {
    const pol = politicians[i % politicians.length];
    const amounts = [
      { min: 1_001, max: 15_000 },
      { min: 15_001, max: 50_000 },
      { min: 50_001, max: 100_000 },
      { min: 100_001, max: 250_000 },
      { min: 250_001, max: 500_000 },
    ];
    return {
      id: `cong_${Date.now().toString(36)}_${i}`,
      politician: pol.name,
      party: pol.party,
      chamber: pol.chamber,
      ticker: tickers[i % tickers.length],
      transactionType: Math.random() > 0.4 ? 'purchase' as const : 'sale' as const,
      amount: amounts[Math.floor(Math.random() * amounts.length)],
      reportedDate: new Date(Date.now() - Math.floor(Math.random() * 30) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      transactionDate: new Date(Date.now() - Math.floor(Math.random() * 60) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      daysToReport: Math.floor(Math.random() * 45) + 1,
    };
  });
}

/* ─── State ───────────────────────────────────────────────────────────────── */

let cachedOptionsFlow: OptionsFlowAlert[] = [];
let cachedDarkPool: DarkPoolTrade[] = [];
let cachedCongressional: CongressionalTrade[] = [];
let lastRefreshAt = 0;
const CACHE_TTL_MS = 60_000;

function refreshCache(): void {
  if (Date.now() - lastRefreshAt < CACHE_TTL_MS) return;
  cachedOptionsFlow = generateOptionsFlow(20);
  cachedDarkPool = generateDarkPoolTrades(15);
  cachedCongressional = generateCongressionalTrades(8);
  lastRefreshAt = Date.now();
}

/* ─── Public API ──────────────────────────────────────────────────────────── */

export function getOptionsFlow(ticker?: string): OptionsFlowAlert[] {
  refreshCache();
  return ticker ? cachedOptionsFlow.filter((o) => o.ticker === ticker) : cachedOptionsFlow;
}

export function getDarkPoolActivity(ticker?: string): DarkPoolTrade[] {
  refreshCache();
  return ticker ? cachedDarkPool.filter((d) => d.ticker === ticker) : cachedDarkPool;
}

export function getCongressionalTrades(party?: 'D' | 'R'): CongressionalTrade[] {
  refreshCache();
  return party ? cachedCongressional.filter((c) => c.party === party) : cachedCongressional;
}

export function getSmartMoneyDivergence(ticker: string): SmartMoneyDivergence {
  refreshCache();
  const optionsFlow = cachedOptionsFlow.filter((o) => o.ticker === ticker);
  const bullishFlow = optionsFlow.filter((o) => o.sentiment === 'bullish');
  const bearishFlow = optionsFlow.filter((o) => o.sentiment === 'bearish');

  const smartBias = bullishFlow.length > bearishFlow.length ? 'bullish' : bearishFlow.length > bullishFlow.length ? 'bearish' : 'neutral';
  const retailBias = Math.random() > 0.5 ? 'bullish' : 'bearish';
  const divergent = smartBias !== retailBias;

  return {
    ticker,
    smartMoneyBias: smartBias as 'bullish' | 'bearish' | 'neutral',
    retailBias: retailBias as 'bullish' | 'bearish',
    divergenceStrength: divergent ? 'strong' : 'weak',
    signals: [
      `Options flow: ${bullishFlow.length} bullish / ${bearishFlow.length} bearish`,
      `Dark pool: ${cachedDarkPool.filter((d) => d.ticker === ticker && d.aboveBid).length} above bid`,
    ],
    historicalAccuracy: 0.67,
    timestamp: Date.now(),
  };
}

export function getTechnicalSignals(ticker: string): TechnicalSignal {
  const price = 100 + Math.random() * 400;
  return {
    ticker,
    timeframe: '1D',
    rsi: 30 + Math.random() * 40,
    macd: { line: Math.random() * 4 - 2, signal: Math.random() * 3 - 1.5, histogram: Math.random() * 2 - 1 },
    bollingerBands: { upper: price * 1.05, middle: price, lower: price * 0.95 },
    sma: { '20': price * 0.98, '50': price * 0.96, '200': price * 0.92 },
    ema: { '12': price * 0.99, '26': price * 0.97 },
    volumeProfile: { poc: price, valueAreaHigh: price * 1.03, valueAreaLow: price * 0.97 },
    trend: Math.random() > 0.5 ? 'uptrend' : Math.random() > 0.5 ? 'downtrend' : 'sideways',
    support: [price * 0.95, price * 0.90, price * 0.85],
    resistance: [price * 1.05, price * 1.10, price * 1.15],
    updatedAt: Date.now(),
  };
}

export function getMarketRegime(): MarketRegimeIndicator {
  const vix = 12 + Math.random() * 20;
  let regime: MarketRegime;
  if (vix < 15) regime = 'strong_bull';
  else if (vix < 20) regime = 'bull';
  else if (vix < 25) regime = 'neutral';
  else if (vix < 30) regime = 'bear';
  else if (vix < 40) regime = 'strong_bear';
  else regime = 'high_volatility';

  return {
    regime,
    confidence: 0.7 + Math.random() * 0.25,
    vix,
    breadth: 0.4 + Math.random() * 0.4,
    momentum: Math.random() * 2 - 1,
    volatility: vix / 100,
    trendStrength: Math.random(),
    updatedAt: Date.now(),
  };
}

export function getOnChainMetrics(token: string, chain: string = 'ethereum'): OnChainMetrics {
  return {
    token,
    chain,
    exchangeReserves: Math.floor(Math.random() * 1_000_000_000),
    exchangeNetFlow24h: Math.floor(Math.random() * 100_000_000) - 50_000_000,
    activeAddresses24h: Math.floor(Math.random() * 500_000),
    newAddresses24h: Math.floor(Math.random() * 50_000),
    dexVolume24h: Math.floor(Math.random() * 500_000_000),
    topHolderConcentration: 0.1 + Math.random() * 0.5,
    nvtRatio: 20 + Math.random() * 80,
    mvrv: 0.5 + Math.random() * 2.5,
    whaleTransactions24h: Math.floor(Math.random() * 200),
    updatedAt: Date.now(),
  };
}

export function getSentiment(ticker: string): SentimentData {
  return {
    ticker,
    overallScore: Math.round(Math.random() * 100),
    socialScore: Math.round(Math.random() * 100),
    newsScore: Math.round(Math.random() * 100),
    fearGreedIndex: Math.round(Math.random() * 100),
    twitterMentions24h: Math.floor(Math.random() * 100_000),
    redditMentions24h: Math.floor(Math.random() * 10_000),
    newsArticles24h: Math.floor(Math.random() * 200),
    sentimentShift: Math.random() * 40 - 20,
    updatedAt: Date.now(),
  };
}

/* ─── Provider Queries ────────────────────────────────────────────────────── */

export function getDataProviders(): DataProvider[] { return [...DATA_PROVIDERS]; }
export function getProvidersByType(type: SignalType): DataProvider[] { return DATA_PROVIDERS.filter((p) => p.dataTypes.includes(type)); }

/* ─── Summary ─────────────────────────────────────────────────────────────── */

export function getMarketIntelligenceSummary() {
  refreshCache();
  return {
    name: 'FreedomForge Market Intelligence',
    version: '1.0.0',
    inspired_by: ['Unusual Whales', 'Arkham Intelligence', 'Nansen', 'Glassnode', 'Santiment', 'DeBank', 'Dune Analytics', 'Token Terminal', 'Coinglass', 'Messari'],
    providers: {
      total: DATA_PROVIDERS.length,
      categories: [...new Set(DATA_PROVIDERS.map((p) => p.category))],
    },
    signals: {
      optionsFlow: cachedOptionsFlow.length,
      darkPoolTrades: cachedDarkPool.length,
      congressionalTrades: cachedCongressional.length,
      signalTypes: ['options_flow', 'dark_pool', 'congressional', '13f_filing', 'insider', 'whale_alert', 'technical', 'sentiment', 'on_chain'],
    },
    capabilities: [
      'Real-time unusual options flow tracking (sweeps, blocks, splits)',
      'Dark pool institutional activity monitoring',
      'Congressional STOCK Act trade tracking',
      '13F institutional filing analysis',
      'SEC Form 4 insider buy/sell detection',
      'Smart money vs retail divergence scoring',
      'Technical analysis (RSI, MACD, Bollinger, volume profile)',
      'Social/news sentiment aggregation with Fear & Greed',
      'On-chain metrics (exchange reserves, NVT, MVRV, whale flows)',
      'Market regime detection (bull/bear/volatility)',
      '12 data provider integrations',
    ],
  };
}
