/**
 * Mining Equipment Monitor
 *
 * Connects to ASIC miners, GPU rigs, and mining pool APIs to provide
 * unified hashrate, temperature, power, and profitability data.
 *
 * Supported integrations:
 * - ASIC miners via CGMiner/BMMiner API (Antminer, Whatsminer, etc.)
 * - Mining pools via HTTP APIs (F2Pool, Braiins/Slush, Antpool, NiceHash, ViaBTC)
 * - GPU rigs via monitoring endpoints
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface MinerDevice {
  id: string;
  name: string;
  type: 'asic' | 'gpu' | 'fpga';
  model: string;
  ip?: string;
  pool?: string;
  algorithm: string;
  hashrate: number;        // H/s
  hashrateUnit: string;    // 'TH/s', 'GH/s', 'MH/s'
  hashrateNormalized: number; // Always in H/s for aggregation
  temperature: number;     // °C (max board/chip temp)
  fanSpeed: number;        // RPM or %
  power: number;           // Watts
  efficiency: number;      // J/TH or J/GH
  uptime: number;          // seconds
  accepted: number;        // accepted shares
  rejected: number;        // rejected shares
  rejectRate: number;      // %
  status: 'online' | 'offline' | 'warning' | 'error';
  lastSeen: string;        // ISO timestamp
  errors: string[];
}

export interface MiningPool {
  id: string;
  name: string;
  url: string;
  algorithm: string;
  coin: string;
  hashrate24h: number;
  workers: number;
  unpaidBalance: number;
  totalPaid: number;
  estimatedDaily: number;  // USD
  lastBlock?: string;
  status: 'connected' | 'disconnected' | 'unknown';
}

export interface MiningOverview {
  totalHashrate: number;
  totalHashrateUnit: string;
  totalPower: number;       // Watts
  totalDevices: number;
  onlineDevices: number;
  avgTemperature: number;
  totalEfficiency: number;  // J/TH
  estimatedDailyUSD: number;
  estimatedMonthlyUSD: number;
  electricityCostDaily: number;
  profitDaily: number;
  devices: MinerDevice[];
  pools: MiningPool[];
  lastUpdated: string;
}

// ── Config ─────────────────────────────────────────────────────────────

interface MinerConfig {
  id: string;
  name: string;
  type: 'asic' | 'gpu' | 'fpga';
  model: string;
  ip: string;
  port: number;
  algorithm: string;
}

interface PoolConfig {
  id: string;
  name: string;
  provider: 'f2pool' | 'braiins' | 'antpool' | 'nicehash' | 'viabtc' | 'custom';
  apiKey?: string;
  coin: string;
  account?: string;
  url?: string;
}

function getMinerConfigs(): MinerConfig[] {
  const raw = process.env.MINING_DEVICES;
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function getPoolConfigs(): PoolConfig[] {
  const raw = process.env.MINING_POOLS;
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

const ELECTRICITY_RATE = parseFloat(process.env.ELECTRICITY_RATE_KWH || '0.10'); // $/kWh

// ── Hashrate Helpers ───────────────────────────────────────────────────

function formatHashrate(hs: number): { value: number; unit: string } {
  if (hs >= 1e15) return { value: hs / 1e15, unit: 'PH/s' };
  if (hs >= 1e12) return { value: hs / 1e12, unit: 'TH/s' };
  if (hs >= 1e9) return { value: hs / 1e9, unit: 'GH/s' };
  if (hs >= 1e6) return { value: hs / 1e6, unit: 'MH/s' };
  if (hs >= 1e3) return { value: hs / 1e3, unit: 'KH/s' };
  return { value: hs, unit: 'H/s' };
}

// ── ASIC Miner Query (CGMiner API) ────────────────────────────────────

async function queryASIC(config: MinerConfig): Promise<MinerDevice> {
  const device: MinerDevice = {
    id: config.id,
    name: config.name,
    type: config.type,
    model: config.model,
    ip: config.ip,
    algorithm: config.algorithm,
    hashrate: 0,
    hashrateUnit: 'TH/s',
    hashrateNormalized: 0,
    temperature: 0,
    fanSpeed: 0,
    power: 0,
    efficiency: 0,
    uptime: 0,
    accepted: 0,
    rejected: 0,
    rejectRate: 0,
    status: 'offline',
    lastSeen: new Date().toISOString(),
    errors: [],
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    // CGMiner API uses TCP JSON — we'll try HTTP endpoint first (many modern miners expose this)
    const res = await fetch(`http://${config.ip}:${config.port}/api/v1/status`, {
      signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timeout);

    if (res?.ok) {
      const data = await res.json();
      device.hashrate = data.hashrate || data.hash_rate || 0;
      device.hashrateNormalized = device.hashrate * 1e12; // Assume TH/s for ASICs
      device.temperature = data.temperature || data.temp || 0;
      device.fanSpeed = data.fan_speed || data.fan || 0;
      device.power = data.power || data.wattage || 0;
      device.uptime = data.uptime || 0;
      device.accepted = data.accepted || 0;
      device.rejected = data.rejected || 0;
      device.rejectRate = device.accepted > 0 ? (device.rejected / (device.accepted + device.rejected)) * 100 : 0;
      device.efficiency = device.hashrate > 0 ? device.power / device.hashrate : 0;
      device.status = 'online';

      const { value, unit } = formatHashrate(device.hashrateNormalized);
      device.hashrate = value;
      device.hashrateUnit = unit;
    } else {
      device.status = 'offline';
      device.errors.push('Miner unreachable');
    }
  } catch (err) {
    device.status = 'offline';
    device.errors.push(err instanceof Error ? err.message : 'Connection failed');
  }

  return device;
}

// ── Pool API Query ─────────────────────────────────────────────────────

async function queryPool(config: PoolConfig): Promise<MiningPool> {
  const pool: MiningPool = {
    id: config.id,
    name: config.name,
    url: config.url || '',
    algorithm: 'SHA-256',
    coin: config.coin,
    hashrate24h: 0,
    workers: 0,
    unpaidBalance: 0,
    totalPaid: 0,
    estimatedDaily: 0,
    status: 'unknown',
  };

  try {
    let apiUrl = '';

    switch (config.provider) {
      case 'f2pool':
        apiUrl = `https://api.f2pool.com/v2/${config.coin.toLowerCase()}/user/${config.account}`;
        break;
      case 'braiins':
        apiUrl = `https://pool.braiins.com/accounts/profile/json/${config.coin.toLowerCase()}`;
        break;
      case 'nicehash':
        apiUrl = `https://api2.nicehash.com/main/api/v2/mining/rigs2`;
        break;
      case 'antpool':
        apiUrl = `https://antpool.com/api/account.htm?coin=${config.coin}`;
        break;
      case 'viabtc':
        apiUrl = `https://www.viabtc.com/res/openapi/v1/hashrate?coin=${config.coin}`;
        break;
      case 'custom':
        apiUrl = config.url || '';
        break;
    }

    if (!apiUrl) {
      pool.status = 'disconnected';
      return pool;
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(apiUrl, { headers, signal: controller.signal }).catch(() => null);
    clearTimeout(timeout);

    if (res?.ok) {
      const data = await res.json();
      pool.hashrate24h = data.hashrate_24h || data.hashrate || data.speed_24h || 0;
      pool.workers = data.workers || data.worker_count || 0;
      pool.unpaidBalance = data.unpaid_balance || data.balance || 0;
      pool.totalPaid = data.total_paid || data.paid || 0;
      pool.estimatedDaily = data.estimated_daily || data.est_daily_earnings || 0;
      pool.status = 'connected';
    } else {
      pool.status = 'disconnected';
    }
  } catch {
    pool.status = 'disconnected';
  }

  return pool;
}

// ── Main Export ─────────────────────────────────────────────────────────

export async function getMiningOverview(): Promise<MiningOverview> {
  const minerConfigs = getMinerConfigs();
  const poolConfigs = getPoolConfigs();

  const [devices, pools] = await Promise.all([
    Promise.all(minerConfigs.map(queryASIC)),
    Promise.all(poolConfigs.map(queryPool)),
  ]);

  const online = devices.filter((d) => d.status === 'online');
  const totalHashrateHs = online.reduce((sum, d) => sum + d.hashrateNormalized, 0);
  const totalPower = online.reduce((sum, d) => sum + d.power, 0);
  const avgTemp = online.length > 0
    ? online.reduce((sum, d) => sum + d.temperature, 0) / online.length
    : 0;

  const { value: hrValue, unit: hrUnit } = formatHashrate(totalHashrateHs);
  const electricityCostDaily = (totalPower / 1000) * 24 * ELECTRICITY_RATE;
  const estimatedDailyUSD = pools.reduce((sum, p) => sum + p.estimatedDaily, 0);

  return {
    totalHashrate: hrValue,
    totalHashrateUnit: hrUnit,
    totalPower,
    totalDevices: devices.length,
    onlineDevices: online.length,
    avgTemperature: Math.round(avgTemp * 10) / 10,
    totalEfficiency: totalHashrateHs > 0 ? totalPower / (totalHashrateHs / 1e12) : 0,
    estimatedDailyUSD,
    estimatedMonthlyUSD: estimatedDailyUSD * 30,
    electricityCostDaily,
    profitDaily: estimatedDailyUSD - electricityCostDaily,
    devices,
    pools,
    lastUpdated: new Date().toISOString(),
  };
}
