import crypto from 'crypto';

type CoinbaseAccount = { currency: string; available_balance: { value: string } };

type CdpAccount = {
  currency?: string;
  available_balance?: { value?: string };
  available_balance_value?: string;
  available_value?: string;
};

const API_KEY = process.env.COINBASE_API_KEY || '';
const API_SECRET = process.env.COINBASE_API_SECRET || '';
const API_PASSPHRASE = process.env.COINBASE_API_PASSPHRASE || '';
const EXCHANGE_BASE_URL = (process.env.COINBASE_BASE_URL || 'https://api.exchange.coinbase.com').replace(/\/$/, '');
const CDP_BASE_URL = (process.env.COINBASE_CDP_BASE_URL || 'https://api.coinbase.com').replace(/\/$/, '');

const isCdpKey = API_KEY.includes('organizations/') && API_SECRET.includes('PRIVATE KEY');
const configured = !!(API_KEY && API_SECRET);

function nowTs() {
  return (Date.now() / 1000).toFixed(3);
}

function signExchangeRequest(timestamp: string, method: string, requestPath: string, body = '') {
  const prehash = `${timestamp}${method}${requestPath}${body}`;
  const key = Buffer.from(API_SECRET, 'base64');
  return crypto.createHmac('sha256', key).update(prehash).digest('base64');
}

function toBase64Url(input: string | Buffer) {
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return raw
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createCdpJwt(method: string, requestPath: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'ES256',
    typ: 'JWT',
    kid: API_KEY,
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  const payload = {
    iss: 'cdp',
    sub: API_KEY,
    nbf: now,
    exp: now + 120,
    uri: `${String(method || 'GET').toUpperCase()} api.coinbase.com${requestPath}`,
  };

  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`;
  const privateKeyPem = API_SECRET.includes('\\n') ? API_SECRET.replace(/\\n/g, '\n') : API_SECRET;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  });

  return `${signingInput}.${toBase64Url(signature)}`;
}

async function fetchJson(url: string, init: RequestInit = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const message = typeof parsed === 'string' ? parsed : (parsed?.message || parsed?.error || `HTTP ${res.status}`);
    throw new Error(`Coinbase API error: ${message}`);
  }
  return parsed;
}

async function getAccountsFromExchange(): Promise<CoinbaseAccount[]> {
  if (!API_PASSPHRASE) {
    throw new Error('Coinbase Exchange requires COINBASE_API_PASSPHRASE');
  }

  const requestPath = '/accounts';
  const timestamp = nowTs();
  const signature = signExchangeRequest(timestamp, 'GET', requestPath);

  const data = await fetchJson(`${EXCHANGE_BASE_URL}${requestPath}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'CB-ACCESS-KEY': API_KEY,
      'CB-ACCESS-SIGN': signature,
      'CB-ACCESS-TIMESTAMP': timestamp,
      'CB-ACCESS-PASSPHRASE': API_PASSPHRASE,
    },
  });

  const rows = Array.isArray(data) ? data : [];
  return rows.map((acct: any) => ({
    currency: String(acct.currency || ''),
    available_balance: { value: String(acct.available || acct.balance || '0') },
  }));
}

async function getAccountsFromCdp(): Promise<CoinbaseAccount[]> {
  const requestPath = '/api/v3/brokerage/accounts';
  const token = createCdpJwt('GET', requestPath);

  const data = await fetchJson(`${CDP_BASE_URL}${requestPath}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const rows: CdpAccount[] = Array.isArray(data?.accounts) ? data.accounts : [];
  return rows.map((acct) => ({
    currency: String(acct.currency || ''),
    available_balance: {
      value: String(
        acct.available_balance?.value
        || acct.available_balance_value
        || acct.available_value
        || '0'
      ),
    },
  }));
}

export const coinbaseClient = {
  isConfigured: () => configured,

  async placeOrder(_order: { symbol: string; side: string; type: string; amount: number; price?: number }) {
    if (!configured) throw new Error('Coinbase not configured — set COINBASE_API_KEY and COINBASE_API_SECRET');
    throw new Error('Coinbase placeOrder not implemented in API mode');
  },

  async getAccounts(): Promise<CoinbaseAccount[]> {
    if (!configured) throw new Error('Coinbase not configured — set COINBASE_API_KEY and COINBASE_API_SECRET');
    if (isCdpKey) {
      return getAccountsFromCdp();
    }
    return getAccountsFromExchange();
  },
};
