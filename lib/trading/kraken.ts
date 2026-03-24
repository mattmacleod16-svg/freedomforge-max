import crypto from 'crypto';

const API_KEY = process.env.KRAKEN_API_KEY || '';
const API_SECRET = process.env.KRAKEN_API_SECRET || '';
const BASE_URL = (process.env.KRAKEN_BASE_URL || 'https://api.kraken.com').replace(/\/$/, '');

const configured = !!(API_KEY && API_SECRET);

async function fetchKrakenPrivate(pathname: string, fields: Record<string, string> = {}) {
  const nonce = String(Date.now() * 1000);
  const body = new URLSearchParams({ nonce, ...fields }).toString();

  const sha256 = crypto.createHash('sha256').update(nonce + body).digest();
  const hmac = crypto.createHmac('sha512', Buffer.from(API_SECRET, 'base64'));
  hmac.update(Buffer.concat([Buffer.from(pathname), sha256]));
  const signature = hmac.digest('base64');

  const res = await fetch(`${BASE_URL}${pathname}`, {
    method: 'POST',
    headers: {
      'API-Key': API_KEY,
      'API-Sign': signature,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Kraken HTTP ${res.status}`);
  }
  if (Array.isArray(json?.error) && json.error.length > 0) {
    throw new Error(json.error.join(', '));
  }
  return json?.result || {};
}

export const krakenClient = {
  isConfigured: () => configured,

  async placeOrder(_order: { symbol: string; side: string; type: string; amount: number; price?: number }) {
    if (!configured) throw new Error('Kraken not configured — set KRAKEN_API_KEY and KRAKEN_API_SECRET');
    throw new Error('Kraken placeOrder not implemented in API mode');
  },

  async getBalance(): Promise<Record<string, string>> {
    if (!configured) throw new Error('Kraken not configured — set KRAKEN_API_KEY and KRAKEN_API_SECRET');
    const result = await fetchKrakenPrivate('/0/private/Balance');
    const out: Record<string, string> = {};
    for (const [asset, amount] of Object.entries(result)) {
      out[String(asset)] = String(amount);
    }
    return out;
  },
};
