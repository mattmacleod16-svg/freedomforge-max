/* ═══════════════════════════════════════════════════════════════
   Coinbase Advanced Trade API Client
   ═══════════════════════════════════════════════════════════════

   HMAC-SHA256 authenticated REST client for:
   • Account balance queries
   • Market/limit order placement
   • Ticker price lookups

   Env: COINBASE_API_KEY, COINBASE_API_SECRET
   Docs: https://docs.cdp.coinbase.com/advanced-trade/docs
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'crypto';
import type { TradeOrder, TradeResult } from './engine';

const BASE = 'https://api.coinbase.com';

function creds() {
  const key = process.env.COINBASE_API_KEY;
  const secret = process.env.COINBASE_API_SECRET;
  return key && secret ? { key, secret } : null;
}

function sign(secret: string, ts: string, method: string, path: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(ts + method + path + body).digest('hex');
}

async function cbFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const c = creds();
  if (!c) throw new Error('Coinbase API keys not configured');

  const ts = Math.floor(Date.now() / 1000).toString();
  const bodyStr = body ? JSON.stringify(body) : '';
  const sig = sign(c.secret, ts, method.toUpperCase(), path, bodyStr);

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'CB-ACCESS-KEY': c.key,
      'CB-ACCESS-SIGN': sig,
      'CB-ACCESS-TIMESTAMP': ts,
    },
    body: body ? bodyStr : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as Record<string, string>)?.message || `Coinbase HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const BASE_CURRENCIES = ['BTC','ETH','SOL','DOGE','XRP','ADA','AVAX','LINK','DOT','MATIC','SHIB','UNI','AAVE','ARB','OP'];

function normalizePair(symbol: string): string {
  if (symbol.includes('-')) return symbol.toUpperCase();
  const upper = symbol.toUpperCase();
  for (const b of BASE_CURRENCIES) {
    if (upper.startsWith(b)) return `${b}-${upper.slice(b.length)}`;
  }
  return upper;
}

type CbAccount = {
  uuid: string;
  name: string;
  currency: string;
  available_balance: { value: string; currency: string };
};

export const coinbaseClient = {
  isConfigured: () => !!creds(),

  async getAccounts(): Promise<CbAccount[]> {
    const data = await cbFetch<{ accounts: CbAccount[] }>('GET', '/api/v3/brokerage/accounts');
    return data.accounts ?? [];
  },

  async getTicker(symbol: string): Promise<{ price: number; bid: number; ask: number }> {
    const pid = normalizePair(symbol);
    const data = await cbFetch<{ trades: { price: string }[] }>('GET', `/api/v3/brokerage/products/${pid}/ticker?limit=1`);
    const p = data.trades?.[0] ? parseFloat(data.trades[0].price) : 0;
    return { price: p, bid: p * 0.9995, ask: p * 1.0005 };
  },

  async placeOrder(order: TradeOrder): Promise<TradeResult> {
    const pid = normalizePair(order.symbol);
    const clientId = `ff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const cfg: Record<string, unknown> = {};
    if (order.type === 'market') {
      cfg.market_market_ioc = order.side === 'buy'
        ? { quote_size: String(order.amount) }
        : { base_size: String(order.amount) };
    } else {
      cfg.limit_limit_gtc = { base_size: String(order.amount), limit_price: String(order.price) };
    }

    type CbOrderRes = {
      success: boolean;
      order_id?: string;
      success_response?: { order_id: string };
      error_response?: { error: string; message: string };
    };

    const data = await cbFetch<CbOrderRes>('POST', '/api/v3/brokerage/orders', {
      client_order_id: clientId,
      product_id: pid,
      side: order.side.toUpperCase(),
      order_configuration: cfg,
    });

    if (!data.success && data.error_response) {
      return {
        id: clientId, exchange: 'coinbase', symbol: order.symbol,
        side: order.side, type: order.type, amount: order.amount,
        price: order.price || 0, status: 'rejected', timestamp: Date.now(),
        mode: 'live', reason: data.error_response.message,
      };
    }

    return {
      id: data.success_response?.order_id || data.order_id || clientId,
      exchange: 'coinbase', symbol: order.symbol, side: order.side,
      type: order.type, amount: order.amount, price: order.price || 0,
      status: 'pending', timestamp: Date.now(), mode: 'live',
    };
  },
};
