/* ═══════════════════════════════════════════════════════════════
   Kraken REST API Client
   ═══════════════════════════════════════════════════════════════

   HMAC-SHA512 + SHA256 nonce-based authentication for:
   • Balance queries
   • Market/limit order placement with optional stop-loss
   • Ticker lookups (public)

   Env: KRAKEN_API_KEY, KRAKEN_API_SECRET
   Docs: https://docs.kraken.com/api/
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'crypto';
import type { TradeOrder, TradeResult } from './engine';

const BASE = 'https://api.kraken.com';

function creds() {
  const key = process.env.KRAKEN_API_KEY;
  const secret = process.env.KRAKEN_API_SECRET;
  return key && secret ? { key, secret } : null;
}

function signRequest(path: string, postData: string, secret: string, nonce: string): string {
  const sha256 = crypto.createHash('sha256').update(nonce + postData).digest();
  return crypto.createHmac('sha512', Buffer.from(secret, 'base64'))
    .update(Buffer.concat([Buffer.from(path), sha256]))
    .digest('base64');
}

async function kPublic<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  const data = await res.json();
  if (data.error?.length) throw new Error(data.error[0]);
  return data.result as T;
}

async function kPrivate<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const c = creds();
  if (!c) throw new Error('Kraken API keys not configured');

  const nonce = (Date.now() * 1000).toString();
  const body = new URLSearchParams({ nonce, ...params }).toString();
  const sig = signRequest(path, body, c.secret, nonce);

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'API-Key': c.key,
      'API-Sign': sig,
    },
    body,
  });

  const data = await res.json();
  if (data.error?.length) throw new Error(data.error[0]);
  return data.result as T;
}

const PAIR_MAP: Record<string, string> = {
  BTCUSD: 'XXBTZUSD', ETHUSD: 'XETHZUSD', XRPUSD: 'XXRPZUSD', DOGEUSD: 'XDGUSD',
  SOLUSD: 'SOLUSD', ADAUSD: 'ADAUSD', AVAXUSD: 'AVAXUSD', LINKUSD: 'LINKUSD',
  DOTUSD: 'DOTUSD', MATICUSD: 'MATICUSD', SHIBUSD: 'SHIBUSD', UNIUSD: 'UNIUSD',
  AAVEUSD: 'AAVEUSD', ARBUSD: 'ARBUSD', OPUSD: 'OPUSD',
};

function krakenPair(symbol: string): string {
  const clean = symbol.toUpperCase().replace(/[-\/]/g, '');
  return PAIR_MAP[clean] || clean;
}

export const krakenClient = {
  isConfigured: () => !!creds(),

  async getBalance(): Promise<Record<string, string>> {
    return kPrivate<Record<string, string>>('/0/private/Balance');
  },

  async getTicker(symbol: string): Promise<{ price: number; bid: number; ask: number }> {
    const pair = krakenPair(symbol);
    const data = await kPublic<Record<string, { c: string[]; b: string[]; a: string[] }>>(`/0/public/Ticker?pair=${pair}`);
    const key = Object.keys(data)[0];
    if (!key) throw new Error(`No ticker for ${symbol}`);
    const t = data[key];
    return { price: parseFloat(t.c[0]), bid: parseFloat(t.b[0]), ask: parseFloat(t.a[0]) };
  },

  async placeOrder(order: TradeOrder): Promise<TradeResult> {
    const pair = krakenPair(order.symbol);
    const params: Record<string, string> = {
      pair,
      type: order.side,
      ordertype: order.type,
      volume: String(order.amount),
    };
    if (order.type === 'limit' && order.price) params.price = String(order.price);
    if (order.stopLoss) {
      params['close[ordertype]'] = 'stop-loss';
      params['close[price]'] = String(order.stopLoss);
    }

    const data = await kPrivate<{ descr: { order: string }; txid: string[] }>('/0/private/AddOrder', params);
    return {
      id: data.txid?.[0] || `kraken-${Date.now()}`,
      exchange: 'kraken', symbol: order.symbol, side: order.side,
      type: order.type, amount: order.amount, price: order.price || 0,
      status: 'pending', timestamp: Date.now(), mode: 'live',
    };
  },

  async getOpenOrders(): Promise<Record<string, unknown>> {
    return kPrivate<Record<string, unknown>>('/0/private/OpenOrders');
  },
};
