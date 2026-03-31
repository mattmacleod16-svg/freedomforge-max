/**
 * Mining Pool Connectors — Live Data
 *
 * Supported:
 * - NiceHash (HMAC-SHA256 auth) — BTC/any algo
 * - ViaBTC (API key) — BTC/ETH/LTC/DOGE
 * - F2Pool (API key) — BTC + alts
 * - Geodnet Console (wallet address lookup) — GEOD token earnings
 * - Generic custom HTTP endpoint
 *
 * Env vars needed:
 *   NICEHASH_API_KEY, NICEHASH_API_SECRET, NICEHASH_ORG_ID
 *   VIABTC_API_KEY, VIABTC_ACCESS_KEY
 *   F2POOL_API_KEY, F2POOL_USERNAME
 *   GEODNET_WALLET_ADDRESS  (Polygon wallet receiving GEOD)
 */

import crypto from 'crypto';

/* ─── Types ──────────────────────────────────────────────────────────── */
export interface PoolLiveData {
  pool: string;
  coin: string;
  hashrate: number;     // raw H/s or score
  hashrateUnit: string; // TH/s, GH/s, etc.
  hashrate24h: number;
  workers: number;
  unpaidBalance: number;
  unpaidCoin: string;
  unpaidUsd: number;
  totalPaid: number;
  estimatedDailyUsd: number;
  estimatedDailyCoins: number;
  efficiency: number; // accepted/(accepted+rejected)
  status: 'connected' | 'error' | 'no_config';
  lastUpdated: string;
  error?: string;
}

/* ─── Helpers ────────────────────────────────────────────────────────── */

async function fetchJson(url: string, headers: Record<string, string> = {}, timeoutMs = 10_000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

/* ─── NiceHash ───────────────────────────────────────────────────────── */
/**
 * NiceHash uses HMAC-SHA256 signing:
 * message = apiKey + \0 + timestamp + \0 + nonce + \0 + \0 + orgId + \0 + \0 + method + \0 + path + \0 + \0 + queryStr
 * signature = HMAC-SHA256(apiSecret, message) as hex
 * header: X-Auth: apiKey:signature
 */
function nhSign(apiKey: string, apiSecret: string, orgId: string, method: string, path: string, queryStr = ''): Record<string, string> {
  const ts = Date.now().toString();
  const nonce = crypto.randomBytes(8).toString('hex');
  const msg = [apiKey, ts, nonce, '', orgId, '', '', method.toUpperCase(), path, '', queryStr || ''].join('\0');
  const sig = crypto.createHmac('sha256', apiSecret).update(msg).digest('hex');
  return {
    'X-Time': ts,
    'X-Nonce': nonce,
    'X-Organization-Id': orgId,
    'X-Auth': `${apiKey}:${sig}`,
  };
}

export async function fetchNiceHash(): Promise<PoolLiveData> {
  const apiKey    = process.env.NICEHASH_API_KEY;
  const apiSecret = process.env.NICEHASH_API_SECRET;
  const orgId     = process.env.NICEHASH_ORG_ID;
  const base      = 'https://api2.nicehash.com';

  const result: PoolLiveData = {
    pool: 'NiceHash', coin: 'BTC', hashrate: 0, hashrateUnit: 'TH/s',
    hashrate24h: 0, workers: 0, unpaidBalance: 0, unpaidCoin: 'BTC',
    unpaidUsd: 0, totalPaid: 0, estimatedDailyUsd: 0, estimatedDailyCoins: 0,
    efficiency: 0, status: 'no_config', lastUpdated: new Date().toISOString(),
  };

  if (!apiKey || !apiSecret || !orgId) return result;

  try {
    const rigsPath = '/main/api/v2/mining/rigs2';
    const rigsHeaders = nhSign(apiKey, apiSecret, orgId, 'GET', rigsPath);
    const rigs = await fetchJson(`${base}${rigsPath}`, rigsHeaders);

    const allRigs: any[] = rigs.miningRigs || [];
    let totalSpeedAccepted = 0;
    let totalSpeedRejected = 0;
    let onlineWorkers = 0;

    for (const rig of allRigs) {
      if (rig.rigPowerMode !== 'MINING') continue;
      onlineWorkers++;
      for (const device of (rig.devices || [])) {
        for (const speed of (device.speeds || [])) {
          totalSpeedAccepted += speed.speed || 0;
          totalSpeedRejected += speed.rejectedSpeed || 0;
        }
      }
    }

    // Fetch unpaid balance
    const walletPath = `/main/api/v2/mining/miningAddress`;
    const walletHeaders = nhSign(apiKey, apiSecret, orgId, 'GET', walletPath);
    const wallet = await fetchJson(`${base}${walletPath}`, walletHeaders).catch(() => null);
    const unpaidBtc = parseFloat(wallet?.miningAddress?.balance || '0');

    // Fetch BTC price for USD conversion
    const priceData = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd').catch(() => null);
    const btcUsd = priceData?.bitcoin?.usd || 65000;

    const totalMhs = totalSpeedAccepted; // NiceHash returns TH/s
    const total = totalSpeedAccepted + totalSpeedRejected;

    result.hashrate = totalMhs;
    result.hashrateUnit = 'TH/s';
    result.hashrate24h = totalMhs;
    result.workers = onlineWorkers;
    result.unpaidBalance = unpaidBtc;
    result.unpaidUsd = unpaidBtc * btcUsd;
    result.efficiency = total > 0 ? totalSpeedAccepted / total : 1;
    // Estimate: ~0.000001 BTC/TH/day in current difficulty
    result.estimatedDailyCoins = totalMhs * 0.000001;
    result.estimatedDailyUsd = result.estimatedDailyCoins * btcUsd;
    result.status = 'connected';
  } catch (e: any) {
    result.status = 'error';
    result.error = e.message;
  }
  return result;
}

/* ─── ViaBTC ──────────────────────────────────────────────────────────── */
export async function fetchViaBTC(): Promise<PoolLiveData> {
  const accessKey = process.env.VIABTC_ACCESS_KEY || process.env.VIABTC_API_KEY;
  const coin      = (process.env.VIABTC_COIN || 'BTC').toUpperCase();

  const result: PoolLiveData = {
    pool: 'ViaBTC', coin, hashrate: 0, hashrateUnit: 'TH/s',
    hashrate24h: 0, workers: 0, unpaidBalance: 0, unpaidCoin: coin,
    unpaidUsd: 0, totalPaid: 0, estimatedDailyUsd: 0, estimatedDailyCoins: 0,
    efficiency: 0, status: 'no_config', lastUpdated: new Date().toISOString(),
  };

  if (!accessKey) return result;

  try {
    const base = 'https://www.viabtc.com/res/openapi/v1';
    const headers = { 'X-API-KEY': accessKey };

    const [hashData, accountData] = await Promise.allSettled([
      fetchJson(`${base}/hashrate?coin=${coin}`, headers),
      fetchJson(`${base}/account?coin=${coin}`, headers),
    ]);

    if (hashData.status === 'fulfilled') {
      const h = hashData.value?.data || hashData.value;
      result.hashrate = parseFloat(h?.realtime || h?.hashrate || '0');
      result.hashrate24h = parseFloat(h?.['24h'] || h?.avg24h || '0');
      result.workers = parseInt(h?.workers || h?.worker_count || '0', 10);
      result.hashrateUnit = h?.unit || 'TH/s';
    }

    if (accountData.status === 'fulfilled') {
      const a = accountData.value?.data || accountData.value;
      result.unpaidBalance = parseFloat(a?.balance || a?.unpaid || '0');
      result.totalPaid = parseFloat(a?.paid_out || a?.total_paid || '0');
    }

    // USD conversion
    const coinId = coin === 'BTC' ? 'bitcoin' : coin === 'ETH' ? 'ethereum' : coin.toLowerCase();
    const priceData = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`).catch(() => null);
    const coinUsd = priceData?.[coinId]?.usd || 0;
    result.unpaidUsd = result.unpaidBalance * coinUsd;
    result.estimatedDailyCoins = result.hashrate * 0.000001; // placeholder — ViaBTC API provides est_income too
    result.estimatedDailyUsd = result.estimatedDailyCoins * coinUsd;
    result.efficiency = 0.98; // ViaBTC typically reports ~98%
    result.status = 'connected';
  } catch (e: any) {
    result.status = 'error';
    result.error = e.message;
  }
  return result;
}

/* ─── F2Pool ──────────────────────────────────────────────────────────── */
export async function fetchF2Pool(): Promise<PoolLiveData> {
  const apiKey   = process.env.F2POOL_API_KEY;
  const username = process.env.F2POOL_USERNAME;
  const coin     = (process.env.F2POOL_COIN || 'bitcoin').toLowerCase();

  const result: PoolLiveData = {
    pool: 'F2Pool', coin: coin.toUpperCase(), hashrate: 0, hashrateUnit: 'TH/s',
    hashrate24h: 0, workers: 0, unpaidBalance: 0, unpaidCoin: coin.toUpperCase(),
    unpaidUsd: 0, totalPaid: 0, estimatedDailyUsd: 0, estimatedDailyCoins: 0,
    efficiency: 0.98, status: 'no_config', lastUpdated: new Date().toISOString(),
  };

  if (!apiKey || !username) return result;

  try {
    const headers = { 'F2P-API-SECRET': apiKey };
    const data = await fetchJson(`https://api.f2pool.com/v2/${coin}/${username}`, headers);

    result.hashrate = data.hashes_last_hour?.h10 || data.hashrate || 0;
    result.hashrate24h = data.hashes_last_day?.h10 || data.hashrate_24h || 0;
    result.workers = data.workers_active || data.worker_count || 0;
    result.unpaidBalance = data.balance || 0;
    result.totalPaid = data.paid_out || 0;

    const coinId = coin === 'bitcoin' ? 'bitcoin' : coin === 'ethereum' ? 'ethereum' : coin;
    const priceData = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`).catch(() => null);
    const coinUsd = priceData?.[coinId]?.usd || 0;
    result.unpaidUsd = result.unpaidBalance * coinUsd;
    result.estimatedDailyCoins = data.estimated_today || 0;
    result.estimatedDailyUsd = result.estimatedDailyCoins * coinUsd;
    result.status = 'connected';
  } catch (e: any) {
    result.status = 'error';
    result.error = e.message;
  }
  return result;
}

/* ─── Geodnet ─────────────────────────────────────────────────────────── */
/**
 * Geodnet doesn't have a public REST API for earnings.
 * We track via:
 * 1. Polygon wallet balance of GEOD token contract
 * 2. Known daily base reward: 12 GEOD/day per triple-band miner
 * 3. GEOD price from CoinGecko
 */
export async function fetchGeodnet(): Promise<PoolLiveData> {
  const wallet = process.env.GEODNET_WALLET_ADDRESS; // Polygon address
  const GEOD_CONTRACT = '0x683b818f8c7DB1F8B5F1D781dbA9489dC0B21d16'; // GEOD on Polygon
  const MINERS = parseInt(process.env.GEODNET_MINER_COUNT || '3', 10); // 3× CM = 3 miners
  const BASE_DAILY_GEOD = 12; // per miner per day (base rate)

  const result: PoolLiveData = {
    pool: 'GEODNET', coin: 'GEOD', hashrate: MINERS, hashrateUnit: 'miners',
    hashrate24h: MINERS, workers: MINERS, unpaidBalance: 0, unpaidCoin: 'GEOD',
    unpaidUsd: 0, totalPaid: 0, estimatedDailyUsd: 0, estimatedDailyCoins: 0,
    efficiency: 1, status: 'no_config', lastUpdated: new Date().toISOString(),
  };

  try {
    // Get GEOD price
    const priceData = await fetchJson(
      'https://api.coingecko.com/api/v3/simple/price?ids=geodnet&vs_currencies=usd'
    ).catch(() => null);
    const geodUsd = priceData?.geodnet?.usd || 0.025; // fallback price

    // If wallet configured, query Polygon for GEOD balance
    if (wallet) {
      // Use Polygon RPC to get ERC-20 balance
      const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
      const balanceCall = {
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: GEOD_CONTRACT, data: `0x70a08231000000000000000000000000${wallet.replace('0x', '')}` }, 'latest'],
      };
      const rpcRes = await fetch(rpcUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(balanceCall),
      }).then(r => r.json()).catch(() => null);

      if (rpcRes?.result) {
        const raw = parseInt(rpcRes.result, 16);
        result.unpaidBalance = raw / 1e18;
      }
      result.status = 'connected';
    } else {
      result.status = 'connected'; // Show estimates even without wallet
    }

    // Daily estimate based on miner count × base rate
    result.estimatedDailyCoins = MINERS * BASE_DAILY_GEOD;
    result.estimatedDailyUsd = result.estimatedDailyCoins * geodUsd;
    result.unpaidUsd = result.unpaidBalance * geodUsd;
  } catch (e: any) {
    result.status = 'error';
    result.error = e.message;
    // Still provide estimates
    const geodUsd = 0.025;
    result.estimatedDailyCoins = MINERS * BASE_DAILY_GEOD;
    result.estimatedDailyUsd = result.estimatedDailyCoins * geodUsd;
  }
  return result;
}

/* ─── Aggregate All Pools ─────────────────────────────────────────────── */
export async function fetchAllPools(): Promise<{
  pools: PoolLiveData[];
  totalDailyUsd: number;
  totalUnpaidUsd: number;
  summary: string;
  lastUpdated: string;
}> {
  const [nicehash, viabtc, f2pool, geodnet] = await Promise.allSettled([
    fetchNiceHash(),
    fetchViaBTC(),
    fetchF2Pool(),
    fetchGeodnet(),
  ]);

  const pools = [
    nicehash.status === 'fulfilled' ? nicehash.value : null,
    viabtc.status === 'fulfilled' ? viabtc.value : null,
    f2pool.status === 'fulfilled' ? f2pool.value : null,
    geodnet.status === 'fulfilled' ? geodnet.value : null,
  ].filter(Boolean) as PoolLiveData[];

  // Only include actually connected pools
  const activePools = pools.filter(p => p.status === 'connected');

  const totalDailyUsd = activePools.reduce((s, p) => s + p.estimatedDailyUsd, 0);
  const totalUnpaidUsd = activePools.reduce((s, p) => s + p.unpaidUsd, 0);

  const connectedCount = activePools.length;
  const configuredCount = pools.filter(p => p.status !== 'no_config').length;

  return {
    pools,
    totalDailyUsd,
    totalUnpaidUsd,
    summary: connectedCount > 0
      ? `${connectedCount}/${configuredCount} pools connected · Est. $${totalDailyUsd.toFixed(2)}/day`
      : 'No pools configured — set API keys to enable live data',
    lastUpdated: new Date().toISOString(),
  };
}
