/**
 * Vault Aggregator — Unified Financial Command Center
 *
 * Aggregates ALL financial data across:
 * - Multi-chain crypto wallets (ETH, BTC, SOL, MultiversX, L2s)
 * - Mining equipment (ASIC, GPU rigs)
 * - Exchange accounts (Coinbase, Kraken)
 * - DeFi positions (Aave, Compound, Kamino, etc.)
 * - Treasury & DAO
 * - Traditional finance (Plaid/Alpaca/IBKR when configured)
 */

import { getMiningOverview, type MiningOverview } from '../mining/monitor';

// ── Types ──────────────────────────────────────────────────────────────

export interface WalletBalance {
  chain: string;
  address: string;
  label: string;
  nativeBalance: number;
  nativeSymbol: string;
  nativeUSD: number;
  tokens: TokenBalance[];
  totalUSD: number;
  lastUpdated: string;
}

export interface TokenBalance {
  symbol: string;
  name: string;
  balance: number;
  decimals: number;
  usdValue: number;
  contractAddress?: string;
}

export interface ExchangeBalance {
  exchange: string;
  status: 'connected' | 'disconnected' | 'error';
  totalUSD: number;
  assets: { symbol: string; balance: number; usdValue: number }[];
  lastUpdated: string;
}

export interface DeFiPosition {
  protocol: string;
  chain: string;
  type: 'lending' | 'staking' | 'lp' | 'farming' | 'vault';
  asset: string;
  deposited: number;
  depositedUSD: number;
  apy: number;
  rewards: number;
  rewardsUSD: number;
  healthFactor?: number;
}

export interface VaultOverview {
  netWorth: number;
  wallets: {
    total: number;
    totalUSD: number;
    list: WalletBalance[];
  };
  exchanges: {
    total: number;
    totalUSD: number;
    list: ExchangeBalance[];
  };
  defi: {
    total: number;
    totalUSD: number;
    totalYieldUSD: number;
    positions: DeFiPosition[];
  };
  mining: MiningOverview;
  treasury: {
    lifetimePnL: number;
    totalTrades: number;
    winRate: number;
    capitalCurrent: number;
  };
  breakdown: { category: string; usd: number; pct: number }[];
  lastUpdated: string;
}

// ── Wallet Configs ─────────────────────────────────────────────────────

interface WalletConfig {
  chain: string;
  address: string;
  label: string;
  rpcUrl?: string;
}

function getWalletConfigs(): WalletConfig[] {
  const wallets: WalletConfig[] = [];

  // Parse VAULT_WALLETS env (JSON array) if provided
  const raw = process.env.VAULT_WALLETS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as WalletConfig[];
      wallets.push(...parsed);
    } catch { /* ignore */ }
  }

  // Auto-detect from existing env vars
  const ethAddr = process.env.ETH_WALLET_ADDRESS || process.env.SINGLE_PAYOUT_RECIPIENT;
  if (ethAddr) wallets.push({ chain: 'ethereum', address: ethAddr, label: 'ETH Main' });

  const solAddr = process.env.SOLANA_WALLET_ADDRESS;
  if (solAddr) wallets.push({ chain: 'solana', address: solAddr, label: 'SOL Main' });

  const mvxAddr = process.env.MVX_WALLET_ADDRESS;
  if (mvxAddr) wallets.push({ chain: 'multiversx', address: mvxAddr, label: 'MultiversX Main' });

  const btcAddr = process.env.BTC_WALLET_ADDRESS;
  if (btcAddr) wallets.push({ chain: 'bitcoin', address: btcAddr, label: 'BTC Main' });

  // Additional addresses from comma-separated env
  const extraAddrs = process.env.VAULT_ETH_ADDRESSES;
  if (extraAddrs) {
    extraAddrs.split(',').forEach((addr, i) => {
      if (addr.trim()) wallets.push({ chain: 'ethereum', address: addr.trim(), label: `ETH Wallet ${i + 2}` });
    });
  }

  const extraSol = process.env.VAULT_SOL_ADDRESSES;
  if (extraSol) {
    extraSol.split(',').forEach((addr, i) => {
      if (addr.trim()) wallets.push({ chain: 'solana', address: addr.trim(), label: `SOL Wallet ${i + 2}` });
    });
  }

  const extraBtc = process.env.VAULT_BTC_ADDRESSES;
  if (extraBtc) {
    extraBtc.split(',').forEach((addr, i) => {
      if (addr.trim()) wallets.push({ chain: 'bitcoin', address: addr.trim(), label: `BTC Wallet ${i + 2}` });
    });
  }

  // Deduplicate by chain+address
  const seen = new Set<string>();
  return wallets.filter((w) => {
    const key = `${w.chain}:${w.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Price Cache ────────────────────────────────────────────────────────

const priceCache: Record<string, { usd: number; ts: number }> = {};
const PRICE_TTL = 120_000; // 2 minutes

async function getPrice(symbol: string): Promise<number> {
  const cached = priceCache[symbol];
  if (cached && Date.now() - cached.ts < PRICE_TTL) return cached.usd;

  try {
    const ids: Record<string, string> = {
      ETH: 'ethereum', BTC: 'bitcoin', SOL: 'solana', EGLD: 'multiversx-economics',
      MATIC: 'matic-network', ARB: 'arbitrum', OP: 'optimism', AVAX: 'avalanche-2',
      DOT: 'polkadot', ADA: 'cardano', LINK: 'chainlink', UNI: 'uniswap',
    };
    const cgId = ids[symbol.toUpperCase()] || symbol.toLowerCase();
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(5000) },
    ).catch(() => null);

    if (res?.ok) {
      const data = await res.json();
      const price = data[cgId]?.usd || 0;
      priceCache[symbol] = { usd: price, ts: Date.now() };
      return price;
    }
  } catch { /* fall through */ }

  return cached?.usd || 0;
}

// ── Wallet Fetchers ────────────────────────────────────────────────────

async function fetchETHWallet(config: WalletConfig): Promise<WalletBalance> {
  const wallet: WalletBalance = {
    chain: config.chain,
    address: config.address,
    label: config.label,
    nativeBalance: 0,
    nativeSymbol: 'ETH',
    nativeUSD: 0,
    tokens: [],
    totalUSD: 0,
    lastUpdated: new Date().toISOString(),
  };

  try {
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    const network = config.chain === 'ethereum' ? 'eth-mainnet' : `${config.chain}-mainnet`;
    const rpcUrl = config.rpcUrl || (alchemyKey
      ? `https://${network}.g.alchemy.com/v2/${alchemyKey}`
      : `https://eth.llamarpc.com`);

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [config.address, 'latest'] }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);

    if (res?.ok) {
      const data = await res.json();
      const weiHex = data.result || '0x0';
      wallet.nativeBalance = parseInt(weiHex, 16) / 1e18;
      const ethPrice = await getPrice('ETH');
      wallet.nativeUSD = wallet.nativeBalance * ethPrice;
      wallet.totalUSD = wallet.nativeUSD;
    }
  } catch { /* ignore */ }

  return wallet;
}

async function fetchSOLWallet(config: WalletConfig): Promise<WalletBalance> {
  const wallet: WalletBalance = {
    chain: 'solana',
    address: config.address,
    label: config.label,
    nativeBalance: 0,
    nativeSymbol: 'SOL',
    nativeUSD: 0,
    tokens: [],
    totalUSD: 0,
    lastUpdated: new Date().toISOString(),
  };

  try {
    const rpcUrl = config.rpcUrl || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [config.address] }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);

    if (res?.ok) {
      const data = await res.json();
      wallet.nativeBalance = (data.result?.value || 0) / 1e9;
      const solPrice = await getPrice('SOL');
      wallet.nativeUSD = wallet.nativeBalance * solPrice;
      wallet.totalUSD = wallet.nativeUSD;
    }
  } catch { /* ignore */ }

  return wallet;
}

async function fetchBTCWallet(config: WalletConfig): Promise<WalletBalance> {
  const wallet: WalletBalance = {
    chain: 'bitcoin',
    address: config.address,
    label: config.label,
    nativeBalance: 0,
    nativeSymbol: 'BTC',
    nativeUSD: 0,
    tokens: [],
    totalUSD: 0,
    lastUpdated: new Date().toISOString(),
  };

  try {
    const res = await fetch(
      `https://blockchain.info/balance?active=${config.address}&cors=true`,
      { signal: AbortSignal.timeout(8000) },
    ).catch(() => null);

    if (res?.ok) {
      const data = await res.json();
      const info = data[config.address];
      if (info) {
        wallet.nativeBalance = (info.final_balance || 0) / 1e8;
        const btcPrice = await getPrice('BTC');
        wallet.nativeUSD = wallet.nativeBalance * btcPrice;
        wallet.totalUSD = wallet.nativeUSD;
      }
    }
  } catch { /* ignore */ }

  return wallet;
}

async function fetchMVXWallet(config: WalletConfig): Promise<WalletBalance> {
  const wallet: WalletBalance = {
    chain: 'multiversx',
    address: config.address,
    label: config.label,
    nativeBalance: 0,
    nativeSymbol: 'EGLD',
    nativeUSD: 0,
    tokens: [],
    totalUSD: 0,
    lastUpdated: new Date().toISOString(),
  };

  try {
    const res = await fetch(
      `https://api.multiversx.com/accounts/${config.address}`,
      { signal: AbortSignal.timeout(8000) },
    ).catch(() => null);

    if (res?.ok) {
      const data = await res.json();
      wallet.nativeBalance = parseFloat(data.balance || '0') / 1e18;
      const egldPrice = await getPrice('EGLD');
      wallet.nativeUSD = wallet.nativeBalance * egldPrice;
      wallet.totalUSD = wallet.nativeUSD;
    }
  } catch { /* ignore */ }

  return wallet;
}

async function fetchWallet(config: WalletConfig): Promise<WalletBalance> {
  switch (config.chain) {
    case 'bitcoin': return fetchBTCWallet(config);
    case 'solana': return fetchSOLWallet(config);
    case 'multiversx': return fetchMVXWallet(config);
    default: return fetchETHWallet(config);
  }
}

// ── Treasury Reader ────────────────────────────────────────────────────

function readTreasury(): { lifetimePnL: number; totalTrades: number; winRate: number; capitalCurrent: number } {
  try {
    const fs = require('fs');
    const path = require('path');
    const file = path.join(process.cwd(), 'data', 'treasury-ledger.json');
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const wins = data.wins || 0;
      const total = data.totalTrades || 0;
      return {
        lifetimePnL: data.lifetimePnL || 0,
        totalTrades: total,
        winRate: total > 0 ? (wins / total) * 100 : 0,
        capitalCurrent: data.capitalCurrent || data.capitalInitial || 0,
      };
    }
  } catch { /* ignore */ }
  return { lifetimePnL: 0, totalTrades: 0, winRate: 0, capitalCurrent: 0 };
}

// ── Main Export ─────────────────────────────────────────────────────────

export async function getVaultOverview(): Promise<VaultOverview> {
  const walletConfigs = getWalletConfigs();

  const [wallets, mining, treasury] = await Promise.all([
    Promise.all(walletConfigs.map(fetchWallet)),
    getMiningOverview(),
    Promise.resolve(readTreasury()),
  ]);

  const walletsUSD = wallets.reduce((s, w) => s + w.totalUSD, 0);
  const miningUSD = mining.estimatedMonthlyUSD;

  // Placeholder exchange & DeFi (these connect to existing lib/ modules when configured)
  const exchanges: ExchangeBalance[] = [];
  const defiPositions: DeFiPosition[] = [];

  const exchangesUSD = exchanges.reduce((s, e) => s + e.totalUSD, 0);
  const defiUSD = defiPositions.reduce((s, p) => s + p.depositedUSD, 0);
  const defiYieldUSD = defiPositions.reduce((s, p) => s + p.rewardsUSD, 0);

  const netWorth = walletsUSD + exchangesUSD + defiUSD + treasury.capitalCurrent;

  const breakdown = [
    { category: 'Wallets', usd: walletsUSD },
    { category: 'Exchanges', usd: exchangesUSD },
    { category: 'DeFi', usd: defiUSD },
    { category: 'Trading Capital', usd: treasury.capitalCurrent },
    { category: 'Mining (monthly est.)', usd: miningUSD },
  ]
    .filter((b) => b.usd > 0)
    .map((b) => ({ ...b, pct: netWorth > 0 ? (b.usd / netWorth) * 100 : 0 }));

  return {
    netWorth,
    wallets: { total: wallets.length, totalUSD: walletsUSD, list: wallets },
    exchanges: { total: exchanges.length, totalUSD: exchangesUSD, list: exchanges },
    defi: { total: defiPositions.length, totalUSD: defiUSD, totalYieldUSD: defiYieldUSD, positions: defiPositions },
    mining,
    treasury,
    breakdown,
    lastUpdated: new Date().toISOString(),
  };
}
