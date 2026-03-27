/**
 * FreedomForge OnchainStockForge — Client
 *
 * Interacts with the CompanyLauncher.sol smart contract to launch and query
 * tokenized companies (equity tokens / Real World Assets).
 *
 * Reads RPC_URL from environment; all secrets stay server-side.
 */

import { StockLaunchParams, OnchainCompanyInfo } from '@/lib/types';

// ─── ABI (minimal — only the functions we call) ───────────────────────────────

const COMPANY_LAUNCHER_ABI = [
  {
    name: 'launchCompany',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'name',             type: 'string'  },
      { name: 'symbol',           type: 'string'  },
      { name: 'totalShares',      type: 'uint256' },
      { name: 'pricePerShareWei', type: 'uint256' },
    ],
    outputs: [{ name: 'companyToken', type: 'address' }],
  },
  {
    name: 'getCompany',
    type: 'function',
    stateMutability: 'view',
    inputs:  [{ name: 'tokenAddress', type: 'address' }],
    outputs: [
      { name: 'companyName',      type: 'string'  },
      { name: 'ticker',           type: 'string'  },
      { name: 'totalShares',      type: 'uint256' },
      { name: 'pricePerShareWei', type: 'uint256' },
      { name: 'owner',            type: 'address' },
      { name: 'launchedAt',       type: 'uint256' },
    ],
  },
];

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
  const rpcUrl     = process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? '';
  const contractAddress = process.env.COMPANY_LAUNCHER_ADDRESS ?? '';
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY ?? '';

  if (!rpcUrl) throw new Error('OnchainStockForge: RPC_URL is not set');

  return { rpcUrl, contractAddress, privateKey };
}

// ─── Low-level JSON-RPC helpers ───────────────────────────────────────────────

async function jsonRpc(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  if (!res.ok) {
    throw new Error(`JSON-RPC HTTP error: ${res.status}`);
  }

  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`JSON-RPC error: ${json.error.message}`);
  return json.result;
}

/** ABI-encode a uint256 value (left-padded to 32 bytes, hex). */
function encodeUint256(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

/** ABI-encode a string (offset + length + data, padded). */
function encodeString(value: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  const len = encodeUint256(BigInt(bytes.length));
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
  return len + padded;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Launch a new tokenized company on-chain.
 * Returns the transaction hash.
 *
 * Note: In production, wire this to ethers.js or viem for proper signing.
 * This implementation uses raw JSON-RPC for zero-dependency operation.
 */
export async function launchCompany(params: StockLaunchParams): Promise<string> {
  const { rpcUrl, contractAddress, privateKey } = getConfig();

  if (!contractAddress) throw new Error('OnchainStockForge: COMPANY_LAUNCHER_ADDRESS not set');
  if (!privateKey)      throw new Error('OnchainStockForge: DEPLOYER_PRIVATE_KEY not set');

  // Build calldata: launchCompany(string,string,uint256,uint256)
  // Selector = keccak256("launchCompany(string,string,uint256,uint256)")[0:4]
  const selector = '0x9a8cd321'; // pre-computed selector

  const nameOffset   = encodeUint256(BigInt(128)); // 4 dynamic params → offset for name starts at 128
  const symbolOffset = encodeUint256(BigInt(0));   // will be filled after encoding name
  const totalShares  = encodeUint256(BigInt(params.totalShares));
  const priceWei     = encodeUint256(params.pricePerShareWei);
  const nameEncoded   = encodeString(params.companyName);
  const symbolEncoded = encodeString(params.ticker);

  // Proper dynamic encoding: offsets are relative to start of params block
  const nameOff   = 4 * 32; // 4 fixed slots × 32 bytes
  const symbolOff = nameOff + 32 + Math.ceil(params.companyName.length / 32) * 32;

  const data =
    selector +
    encodeUint256(BigInt(nameOff)) +
    encodeUint256(BigInt(symbolOff)) +
    totalShares +
    priceWei +
    nameEncoded +
    symbolEncoded;

  // eth_sendTransaction (requires unlocked account or middleware signing)
  const txHash = await jsonRpc(rpcUrl, 'eth_sendTransaction', [
    {
      from: '0x0000000000000000000000000000000000000000', // replaced by wallet middleware
      to:   contractAddress,
      data,
      gas: '0x' + (500_000).toString(16),
    },
  ]) as string;

  return txHash;
}

/**
 * Query on-chain company info by token contract address.
 */
export async function getCompanyInfo(tokenAddress: string): Promise<OnchainCompanyInfo> {
  const { rpcUrl, contractAddress } = getConfig();
  if (!contractAddress) throw new Error('OnchainStockForge: COMPANY_LAUNCHER_ADDRESS not set');

  // getCompany(address) selector
  const selector = '0x34009890';
  const encodedAddr = tokenAddress.replace('0x', '').padStart(64, '0');
  const data = selector + encodedAddr;

  const result = await jsonRpc(rpcUrl, 'eth_call', [
    { to: contractAddress, data },
    'latest',
  ]) as string;

  // Basic ABI decode — in production use ethers.js Interface.decodeFunctionResult
  // Return a placeholder until full ABI decoding is wired in
  return {
    contractAddress: tokenAddress,
    companyName:     '(decode pending)',
    ticker:          '???',
    totalShares:     0,
    pricePerShareWei: BigInt(0),
    owner:           '0x',
    launchedAt:      0,
  };
}

export { COMPANY_LAUNCHER_ABI };
