/**
 * NonKyc.io Trading Client — Privacy-First Exchange Integration
 * ══════════════════════════════════════════════════════════════
 *
 * REST client for NonKyc.io API v2.
 * Authentication: HTTP Basic Auth (base64(apiKey:apiSecret))
 * Base URL: https://api.nonkyc.io/api/v2
 */

const BASE_URL = (process.env.NONKYC_BASE_URL || 'https://api.nonkyc.io/api/v2').replace(/\/$/, '');
const API_KEY    = process.env.NONKYC_API_KEY    || '';
const API_SECRET = process.env.NONKYC_API_SECRET || '';

export const configured = !!(API_KEY && API_SECRET);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NonKycBalance {
  currency: string;
  available: string;
  held: string;
}

export interface NonKycMarket {
  id: string;
  base_currency: string;
  quote_currency: string;
  min_order_size: string;
  max_order_size: string;
  price_precision: number;
  amount_precision: number;
  status: 'active' | 'inactive';
}

export interface NonKycOrderbookEntry {
  price: string;
  amount: string;
}

export interface NonKycOrderbook {
  market: string;
  bids: NonKycOrderbookEntry[];
  asks: NonKycOrderbookEntry[];
  timestamp: number;
}

export interface NonKycOrder {
  id: string;
  market: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price: string;
  amount: string;
  filled: string;
  remaining: string;
  status: 'open' | 'filled' | 'partial' | 'cancelled';
  created_at: number;
}

export interface NonKycCreateOrderParams {
  market: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  amount: string;
  price?: string; // required for limit orders
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function authHeader(): string {
  const encoded = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');
  return `Basic ${encoded}`;
}

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

async function get<T>(path: string, auth = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = authHeader();

  const res = await fetch(`${BASE_URL}${path}`, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`NonKyc GET ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`NonKyc POST ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader(),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`NonKyc DELETE ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Public Endpoints ─────────────────────────────────────────────────────────

/** Fetch all available markets */
export async function getMarkets(): Promise<NonKycMarket[]> {
  return get<NonKycMarket[]>('/market/getall');
}

/** Fetch orderbook for a market (e.g. "BTC_USDT") */
export async function getOrderbook(market: string, depth = 20): Promise<NonKycOrderbook> {
  return get<NonKycOrderbook>(`/market/getorderbook?market=${encodeURIComponent(market)}&depth=${depth}`);
}

// ─── Authenticated Endpoints ──────────────────────────────────────────────────

/** Fetch all account balances (non-zero) */
export async function getBalances(): Promise<NonKycBalance[]> {
  return get<NonKycBalance[]>('/user/getbalances', true);
}

/** Fetch balance for a single currency */
export async function getBalance(currency: string): Promise<NonKycBalance> {
  return get<NonKycBalance>(`/user/getbalance?currency=${encodeURIComponent(currency)}`, true);
}

/** Place a new order */
export async function createOrder(params: NonKycCreateOrderParams): Promise<NonKycOrder> {
  return post<NonKycOrder>('/order/create', params);
}

/** Cancel an open order by ID */
export async function cancelOrder(orderId: string): Promise<{ success: boolean; id: string }> {
  return del<{ success: boolean; id: string }>(`/order/cancel/${encodeURIComponent(orderId)}`);
}

/** Get status of a specific order */
export async function getOrder(orderId: string): Promise<NonKycOrder> {
  return get<NonKycOrder>(`/order/get/${encodeURIComponent(orderId)}`, true);
}

/** List open orders, optionally filtered by market */
export async function getOpenOrders(market?: string): Promise<NonKycOrder[]> {
  const path = market
    ? `/order/getopenorders?market=${encodeURIComponent(market)}`
    : '/order/getopenorders';
  return get<NonKycOrder[]>(path, true);
}
