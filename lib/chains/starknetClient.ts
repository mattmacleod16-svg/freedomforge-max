/**
 * StarkNet Chain Client
 * Pure-fetch JSON-RPC client for the StarkNet network.
 * Covers: block info, balance, nonce, contract calls, tx status.
 * No SDK dependency — implements starknet_api_openrpc.json spec v0.10.2.
 * Reference: starkware-libs/starknet-specs
 */

export type StarknetNetwork = 'mainnet' | 'testnet' | 'devnet';

export interface StarknetBlockInfo {
  blockHash: string;
  blockNumber: number;
  parentHash: string;
  timestamp: number;
  sequencerAddress: string;
  l1GasPrice: { priceInFri: string; priceInWei: string };
  starknetVersion: string;
  txnCount: number;
}

export interface StarknetBalance {
  address: string;
  balanceHex: string;   // raw felt
  balanceDec: string;   // decimal string
}

export interface StarknetTxStatus {
  txHash: string;
  finalityStatus: 'RECEIVED' | 'REJECTED' | 'ACCEPTED_ON_L2' | 'ACCEPTED_ON_L1' | 'NOT_RECEIVED';
  executionStatus?: 'SUCCEEDED' | 'REVERTED';
  revertReason?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Standard Starknet ETH token address
const ETH_TOKEN_ADDRESS = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';

const RPC_ENDPOINTS: Record<StarknetNetwork, string> = {
  mainnet: 'https://starknet-mainnet.public.blastapi.io/rpc/v0_10',
  testnet: 'https://starknet-sepolia.public.blastapi.io/rpc/v0_10',
  devnet: 'http://localhost:5050/rpc',
};

const FETCH_TIMEOUT_MS = 15_000;
let _rpcId = 1;

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function rpcCall(
  network: StarknetNetwork,
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

function feltToDecimal(felt: string): string {
  try {
    return BigInt(felt).toString(10);
  } catch {
    return '0';
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getStarknetBlockNumber(
  network: StarknetNetwork = 'mainnet',
): Promise<number | null> {
  const result = await rpcCall(network, 'starknet_blockNumber', []);
  return result !== null ? Number(result) : null;
}

export async function getStarknetBlockInfo(
  blockTag: 'latest' | 'pending' | number = 'latest',
  network: StarknetNetwork = 'mainnet',
): Promise<StarknetBlockInfo | null> {
  const blockId = typeof blockTag === 'number' ? { block_number: blockTag } : blockTag;
  const result = await rpcCall(network, 'starknet_getBlockWithTxHashes', [blockId]) as Record<string, unknown> | null;
  if (!result) return null;

  const gasPrice = (result.l1_gas_price as Record<string, string> | undefined) ?? {};
  return {
    blockHash: String(result.block_hash ?? ''),
    blockNumber: Number(result.block_number ?? 0),
    parentHash: String(result.parent_hash ?? ''),
    timestamp: Number(result.timestamp ?? 0),
    sequencerAddress: String(result.sequencer_address ?? ''),
    l1GasPrice: {
      priceInFri: gasPrice.price_in_fri ?? '0',
      priceInWei: gasPrice.price_in_wei ?? '0',
    },
    starknetVersion: String(result.starknet_version ?? ''),
    txnCount: Array.isArray(result.transactions) ? result.transactions.length : 0,
  };
}

export async function getStarknetNonce(
  address: string,
  network: StarknetNetwork = 'mainnet',
): Promise<string | null> {
  const result = await rpcCall(network, 'starknet_getNonce', ['latest', address]) as string | null;
  return result ?? null;
}

export async function getStarknetETHBalance(
  address: string,
  network: StarknetNetwork = 'mainnet',
): Promise<StarknetBalance | null> {
  // Call balanceOf on the ETH ERC-20 contract
  const result = await rpcCall(network, 'starknet_call', [
    {
      contract_address: ETH_TOKEN_ADDRESS,
      entry_point_selector: '0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e', // balanceOf selector
      calldata: [address],
    },
    'latest',
  ]) as string[] | null;

  if (!Array.isArray(result) || result.length === 0) return null;
  const felt = result[0];
  return {
    address,
    balanceHex: felt,
    balanceDec: feltToDecimal(felt),
  };
}

export async function getStarknetTxStatus(
  txHash: string,
  network: StarknetNetwork = 'mainnet',
): Promise<StarknetTxStatus | null> {
  const result = await rpcCall(network, 'starknet_getTransactionStatus', [txHash]) as Record<string, unknown> | null;
  if (!result) return { txHash, finalityStatus: 'NOT_RECEIVED' };

  return {
    txHash,
    finalityStatus: (result.finality_status as StarknetTxStatus['finalityStatus']) ?? 'NOT_RECEIVED',
    executionStatus: result.execution_status as StarknetTxStatus['executionStatus'],
    revertReason: result.revert_reason as string | undefined,
  };
}

export async function getStarknetNetworkHealth(
  network: StarknetNetwork = 'mainnet',
): Promise<{ healthy: boolean; blockNumber: number | null; specVersion: string | null }> {
  const [blockNumber, specVersion] = await Promise.all([
    getStarknetBlockNumber(network),
    rpcCall(network, 'starknet_specVersion', []),
  ]);
  return {
    healthy: blockNumber !== null,
    blockNumber,
    specVersion: specVersion ? String(specVersion) : null,
  };
}
