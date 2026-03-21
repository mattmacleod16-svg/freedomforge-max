/* ═══════════════════════════════════════════════════════════════
   ViaBTC Mining Pool API Client
   ═══════════════════════════════════════════════════════════════

   Integrates with ViaBTC mining pool for:
   • Real-time hashrate monitoring
   • Worker status tracking
   • Earnings and payout history
   • Multi-coin support (BTC, ETH, LTC, etc.)

   Env: VIABTC_API_KEY, VIABTC_API_SECRET
   Docs: https://support.viabtc.com/hc/en-us/articles/900003200166
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'crypto';
import type { MiningStats } from './engine';

const BASE = 'https://www.viabtc.com/res/openapi/v1';

function creds() {
  const key = process.env.VIABTC_API_KEY;
  const secret = process.env.VIABTC_API_SECRET;
  return key && secret ? { key, secret } : null;
}

function signParams(params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  return crypto.createHmac('sha256', secret).update(sorted).digest('hex').toUpperCase();
}

async function viaFetch<T>(endpoint: string, extraParams: Record<string, string> = {}): Promise<T> {
  const c = creds();
  if (!c) throw new Error('ViaBTC API keys not configured');

  const params: Record<string, string> = {
    access_id: c.key,
    tonce: Date.now().toString(),
    ...extraParams,
  };

  const signature = signParams(params, c.secret);
  const qs = new URLSearchParams({ ...params, signature }).toString();

  const res = await fetch(`${BASE}${endpoint}?${qs}`, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) throw new Error(`ViaBTC HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 0 && data.code !== undefined) {
    throw new Error(data.message || `ViaBTC error ${data.code}`);
  }
  return (data.data ?? data) as T;
}

export interface ViaBTCHashrate {
  hashrate: string;
  hashrate_1h: string;
  hashrate_24h: string;
  unit: string;
}

export interface ViaBTCWorker {
  worker_name: string;
  hashrate: string;
  hashrate_1h: string;
  reject_rate: string;
  status: string;
  last_share_time: number;
}

export interface ViaBTCEarning {
  date: string;
  coin_type: string;
  pps_amount: string;
  pplns_amount: string;
  solo_amount: string;
  total_amount: string;
}

export const viabtcClient = {
  isConfigured: () => !!creds(),

  async getHashrate(coinType = 'btc'): Promise<ViaBTCHashrate> {
    return viaFetch<ViaBTCHashrate>('/hashrate', { coin_type: coinType });
  },

  async getWorkers(coinType = 'btc'): Promise<ViaBTCWorker[]> {
    const data = await viaFetch<ViaBTCWorker[] | { data: ViaBTCWorker[] }>('/worker', { coin_type: coinType });
    return Array.isArray(data) ? data : (data as { data: ViaBTCWorker[] }).data || [];
  },

  async getEarnings(coinType = 'btc'): Promise<ViaBTCEarning[]> {
    const data = await viaFetch<ViaBTCEarning[] | { data: ViaBTCEarning[] }>('/pool/earning/history', { coin_type: coinType });
    return Array.isArray(data) ? data : (data as { data: ViaBTCEarning[] }).data || [];
  },

  async getMiningStats(coinType = 'btc'): Promise<MiningStats> {
    try {
      const [hashrate, workers, earnings] = await Promise.allSettled([
        this.getHashrate(coinType),
        this.getWorkers(coinType),
        this.getEarnings(coinType),
      ]);

      const hr = hashrate.status === 'fulfilled' ? hashrate.value : null;
      const wk = workers.status === 'fulfilled' ? workers.value : [];
      const earn = earnings.status === 'fulfilled' ? earnings.value : [];

      const total24h = earn.length > 0 ? parseFloat(earn[0]?.total_amount || '0') : 0;
      const totalAll = earn.reduce((s, e) => s + parseFloat(e.total_amount || '0'), 0);

      return {
        hashrate: parseFloat(hr?.hashrate_24h || hr?.hashrate || '0'),
        hashrateUnit: hr?.unit || 'TH/s',
        workers: Array.isArray(wk) ? wk.length : 0,
        earnings24h: total24h,
        earningsTotal: totalAll,
        currency: coinType.toUpperCase(),
      };
    } catch {
      return { hashrate: 0, hashrateUnit: 'TH/s', workers: 0, earnings24h: 0, earningsTotal: 0, currency: coinType.toUpperCase() };
    }
  },
};
