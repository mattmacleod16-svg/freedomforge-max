/**
 * Polygon (PoS) Chain Client
 * Pure-fetch Ethereum JSON-RPC client for Polygon PoS mainnet & testnet.
 * EVM-compatible: uses standard eth_* RPC methods.
 * Covers: balance, block info, tx status, contract call.
 * Reference: 0xPolygon/polygon-sdk, Ethereum JSON-RPC spec
 */

export type PolygonNetwork = 'mainnet' | 'amoy' | 'zkevm-mainnet' | 'zkevm-cardona';

export interface PolygonBalance {
  address: string;
  balanceWei: string;
  balanceMATIC: number;
}

export interface PolygonBlockInfo {
  blockNumber: number;
  blockHash: string;
  parentHash: string;
  timestamp: number;
  gasUsed: string;
  gasLimit: string;
  txCount: number;
  miner: string;
}

export interface PolygonTxReceipt {
  txHash: string;
  blockNumber: number | null;
  status: 'success' | 'failed' | 'pending';
  gasUsed: string;
  from: string;
  to: string | null;
  contractAddress: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RPC_ENDPOINTS: Record<PolygonNetwork, string> = {
  mainnet: 'https://polygon-rpc.com',
  amoy: 'https://rpc-amoy.polygon.technology',
  'zkevm-mainnet': 'https://zkevm-rpc.com',
  'zkevm-cardona': 'https://rpc.cardona.zkevm-rpc.com',
};

const FETCH_TIMEOUT_MS = 15_000;
let _rpcId = 1;

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function rpcCall(
  network: PolygonNetwork,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const id = _rpcId++;
  try {
    const response = await fetch(RPC_ENDPOINTS[network], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.error) return null;
    return data.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}

function hexToDecimal(hex: string): string {
  try {
    return BigInt(hex).toString(10);
  } catch {
    return '0';
  }
}

function weiToMATIC(weiHex: string): number {
  try {
    return Number(BigInt(weiHex)) / 1e18;
  } catch {
    return 0;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getPolygonBalance(
  address: string,
  network: PolygonNetwork = 'mainnet',
): Promise<PolygonBalance | null> {
  const balanceHex = await rpcCall(network, 'eth_getBalance', [address, 'latest']) as string | null;
  if (!balanceHex) return null;

  return {
    address,
    balanceWei: hexToDecimal(balanceHex),
    balanceMATIC: weiToMATIC(balanceHex),
  };
}

export async function getPolygonBlockNumber(
  network: PolygonNetwork = 'mainnet',
): Promise<number | null> {
  const result = await rpcCall(network, 'eth_blockNumber', []) as string | null;
  return result ? parseInt(result, 16) : null;
}

export async function getPolygonBlockInfo(
  blockTag: 'latest' | 'pending' | number = 'latest',
  network: PolygonNetwork = 'mainnet',
): Promise<PolygonBlockInfo | null> {
  const tag = typeof blockTag === 'number' ? `0x${blockTag.toString(16)}` : blockTag;
  const result = await rpcCall(network, 'eth_getBlockByNumber', [tag, false]) as Record<string, unknown> | null;
  if (!result) return null;

  return {
    blockNumber: parseInt(String(result.number ?? '0x0'), 16),
    blockHash: String(result.hash ?? ''),
    parentHash: String(result.parentHash ?? ''),
    timestamp: parseInt(String(result.timestamp ?? '0x0'), 16),
    gasUsed: hexToDecimal(String(result.gasUsed ?? '0x0')),
    gasLimit: hexToDecimal(String(result.gasLimit ?? '0x0')),
    txCount: Array.isArray(result.transactions) ? result.transactions.length : 0,
    miner: String(result.miner ?? ''),
  };
}

export async function getPolygonTxReceipt(
  txHash: string,
  network: PolygonNetwork = 'mainnet',
): Promise<PolygonTxReceipt | null> {
  const result = await rpcCall(network, 'eth_getTransactionReceipt', [txHash]) as Record<string, unknown> | null;
  if (!result) return { txHash, blockNumber: null, status: 'pending', gasUsed: '0', from: '', to: null, contractAddress: null };

  return {
    txHash,
    blockNumber: result.blockNumber ? parseInt(String(result.blockNumber), 16) : null,
    status: result.status === '0x1' ? 'success' : 'failed',
    gasUsed: hexToDecimal(String(result.gasUsed ?? '0x0')),
    from: String(result.from ?? ''),
    to: result.to ? String(result.to) : null,
    contractAddress: result.contractAddress ? String(result.contractAddress) : null,
  };
}

export async function callPolygonContract(options: {
  to: string;
  data: string; // ABI-encoded call data
  from?: string;
  network?: PolygonNetwork;
}): Promise<string | null> {
  const { to, data, from, network = 'mainnet' } = options;
  const callObj: Record<string, string> = { to, data };
  if (from) callObj.from = from;
  return await rpcCall(network, 'eth_call', [callObj, 'latest']) as string | null;
}

export async function getPolygonGasPrice(
  network: PolygonNetwork = 'mainnet',
): Promise<{ gasPriceGwei: number; maxPriorityFeeGwei: number } | null> {
  const [gasPrice, maxFee] = await Promise.all([
    rpcCall(network, 'eth_gasPrice', []) as Promise<string | null>,
    rpcCall(network, 'eth_maxPriorityFeePerGas', []) as Promise<string | null>,
  ]);
  if (!gasPrice) return null;
  return {
    gasPriceGwei: Number(BigInt(gasPrice)) / 1e9,
    maxPriorityFeeGwei: maxFee ? Number(BigInt(maxFee)) / 1e9 : 0,
  };
}

export async function getPolygonNetworkHealth(
  network: PolygonNetwork = 'mainnet',
): Promise<{ healthy: boolean; blockNumber: number | null; chainId: string | null }> {
  const [blockNumber, chainId] = await Promise.all([
    getPolygonBlockNumber(network),
    rpcCall(network, 'eth_chainId', []).then((r) => r ? String(r) : null),
  ]);
  return {
    healthy: blockNumber !== null,
    blockNumber,
    chainId: chainId ?? null,
  };
}
