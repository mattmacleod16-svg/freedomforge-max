/**
 * Injective Chain Client
 * Pure-fetch REST client for the Injective Protocol.
 * Covers: bank balances, spot/derivative markets, orderbooks, account portfolio.
 * No SDK dependency — uses Injective public REST API directly.
 * Reference: InjectiveLabs/injective-helix-demo exchange composables
 */

export type InjectiveNetwork = 'mainnet' | 'testnet';

export interface InjectiveBalance {
  denom: string;
  amount: string;
}

export interface InjectiveSpotMarket {
  marketId: string;
  ticker: string;
  baseDenom: string;
  quoteDenom: string;
  makerFeeRate: string;
  takerFeeRate: string;
  minPriceTickSize: string;
  minQuantityTickSize: string;
  status: 'active' | 'paused' | 'demolished';
}

export interface InjectiveOrderbookLevel {
  price: string;
  quantity: string;
}

export interface InjectiveOrderbook {
  marketId: string;
  buys: InjectiveOrderbookLevel[];
  sells: InjectiveOrderbookLevel[];
  sequence: number;
  timestamp: number;
}

export interface InjectiveDerivativeMarket {
  marketId: string;
  ticker: string;
  quoteDenom: string;
  initialMarginRatio: string;
  maintenanceMarginRatio: string;
  makerFeeRate: string;
  takerFeeRate: string;
  status: 'active' | 'paused' | 'demolished';
  isPerpetual: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REST_ENDPOINTS: Record<InjectiveNetwork, string> = {
  mainnet: 'https://sentry.exchange.grpc-web.injective.network',
  testnet: 'https://testnet.sentry.exchange.grpc-web.injective.network',
};

const FETCH_TIMEOUT_MS = 15_000;

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function restGet(
  network: InjectiveNetwork,
  path: string,
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${REST_ENDPOINTS[network]}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json() as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getInjectiveBalances(
  address: string,
  network: InjectiveNetwork = 'mainnet',
): Promise<InjectiveBalance[]> {
  const data = await restGet(network, `/api/exchange/portfolio/v2/portfolio?accountAddress=${address}`);
  const subaccount = (data?.portfolio as Record<string, unknown> | undefined)?.subaccounts;
  if (!Array.isArray(subaccount) || subaccount.length === 0) {
    // Fallback: cosmos bank balances
    const bankData = await restGet(network, `/cosmos/bank/v1beta1/balances/${address}`);
    const balances = bankData?.balances as InjectiveBalance[] | undefined;
    return balances ?? [];
  }
  const availableBalances = (subaccount[0] as Record<string, unknown>)?.availableBalances;
  return Array.isArray(availableBalances)
    ? (availableBalances as Array<{ denom: string; totalBalance: string }>).map((b) => ({
        denom: b.denom,
        amount: b.totalBalance,
      }))
    : [];
}

export async function getInjectiveSpotMarkets(
  network: InjectiveNetwork = 'mainnet',
): Promise<InjectiveSpotMarket[]> {
  const data = await restGet(network, '/api/exchange/spot/v2/markets?marketStatus=active');
  const markets = data?.markets as Record<string, unknown>[] | undefined;
  if (!Array.isArray(markets)) return [];

  return markets.slice(0, 50).map((m) => ({
    marketId: String(m.marketId ?? ''),
    ticker: String(m.ticker ?? ''),
    baseDenom: String(m.baseDenom ?? ''),
    quoteDenom: String(m.quoteDenom ?? ''),
    makerFeeRate: String(m.makerFeeRate ?? '0'),
    takerFeeRate: String(m.takerFeeRate ?? '0'),
    minPriceTickSize: String(m.minPriceTickSize ?? '0'),
    minQuantityTickSize: String(m.minQuantityTickSize ?? '0'),
    status: (m.marketStatus as InjectiveSpotMarket['status']) ?? 'active',
  }));
}

export async function getInjectiveOrderbook(
  marketId: string,
  network: InjectiveNetwork = 'mainnet',
): Promise<InjectiveOrderbook | null> {
  const data = await restGet(network, `/api/exchange/spot/v2/orderbooks?marketId=${marketId}`);
  const book = (data?.orderbooks as Record<string, unknown>[] | undefined)?.[0] as Record<string, unknown> | undefined;
  if (!book) return null;

  const orderbook = book.orderbook as Record<string, unknown> | undefined;
  if (!orderbook) return null;

  const mapLevel = (l: Record<string, unknown>): InjectiveOrderbookLevel => ({
    price: String(l.price ?? '0'),
    quantity: String(l.quantity ?? '0'),
  });

  return {
    marketId,
    buys: Array.isArray(orderbook.buys) ? (orderbook.buys as Record<string, unknown>[]).map(mapLevel) : [],
    sells: Array.isArray(orderbook.sells) ? (orderbook.sells as Record<string, unknown>[]).map(mapLevel) : [],
    sequence: Number(orderbook.sequence ?? 0),
    timestamp: Number(orderbook.timestamp ?? 0),
  };
}

export async function getInjectiveDerivativeMarkets(
  network: InjectiveNetwork = 'mainnet',
): Promise<InjectiveDerivativeMarket[]> {
  const data = await restGet(network, '/api/exchange/derivative/v2/markets?marketStatus=active');
  const markets = data?.markets as Record<string, unknown>[] | undefined;
  if (!Array.isArray(markets)) return [];

  return markets.slice(0, 30).map((m) => ({
    marketId: String(m.marketId ?? ''),
    ticker: String(m.ticker ?? ''),
    quoteDenom: String(m.quoteDenom ?? ''),
    initialMarginRatio: String(m.initialMarginRatio ?? '0'),
    maintenanceMarginRatio: String(m.maintenanceMarginRatio ?? '0'),
    makerFeeRate: String(m.makerFeeRate ?? '0'),
    takerFeeRate: String(m.takerFeeRate ?? '0'),
    status: (m.marketStatus as InjectiveDerivativeMarket['status']) ?? 'active',
    isPerpetual: Boolean((m as Record<string, unknown>).isPerpetual ?? m.perpetualMarketInfo),
  }));
}

export async function getInjectiveNetworkHealth(
  network: InjectiveNetwork = 'mainnet',
): Promise<{ healthy: boolean; chainId: string; latestBlockHeight: number }> {
  const data = await restGet(network, '/cosmos/base/tendermint/v1beta1/blocks/latest');
  const header = (data?.block as Record<string, unknown> | undefined)?.header as Record<string, unknown> | undefined;

  return {
    healthy: header !== undefined,
    chainId: String(header?.chain_id ?? ''),
    latestBlockHeight: Number(header?.height ?? 0),
  };
}
