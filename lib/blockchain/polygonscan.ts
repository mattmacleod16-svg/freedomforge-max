/**
 * Polygonscan Client — On-Chain Transaction Tracker
 * ═══════════════════════════════════════════════════
 *
 * Uses Etherscan API V2 (chainId=137 for Polygon).
 * Get a free key at: https://etherscan.io/register
 */

const ETHERSCAN_V2  = 'https://api.etherscan.io/v2/api';
const POLYGON_CHAIN = '137';
const API_KEY       = process.env.POLYGONSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || '';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TxStatus {
  hash: string;
  status: 'pending' | 'confirmed' | 'failed' | 'not_found';
  confirmations: number;
  blockNumber: number | null;
  gasUsed: number | null;
  from: string | null;
  to: string | null;
  value: string | null;
  timestamp: number | null;
  error?: string;
}

export interface TokenTransfer {
  hash: string;
  blockNumber: number;
  timestamp: number;
  from: string;
  to: string;
  tokenSymbol: string;
  tokenName: string;
  contractAddress: string;
  value: string;
  decimals: number;
  valueFormatted: number;
}

export interface YieldAccrual {
  protocol: string;
  asset: string;
  amount: number;
  usdValue: number;
  timestamp: number;
  txHash: string;
}

// ─── API Helper ───────────────────────────────────────────────────────────────

async function polygonscan<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({
    chainid: POLYGON_CHAIN,
    ...params,
    apikey: API_KEY,
  });
  const res = await fetch(`${ETHERSCAN_V2}?${qs}`, {
    headers: { 'Accept': 'application/json' },
    next: { revalidate: 10 },
  });
  if (!res.ok) throw new Error(`Polygonscan ${res.status}: ${res.statusText}`);
  const data = await res.json() as { status: string; message: string; result: T };
  if (data.status === '0' && data.message !== 'No transactions found') {
    throw new Error(`Polygonscan error: ${data.message}`);
  }
  return data.result;
}

// ─── Transaction Status ───────────────────────────────────────────────────────

/** Get full confirmation status for a transaction hash */
export async function getTxStatus(hash: string): Promise<TxStatus> {
  try {
    // Get receipt for confirmation count
    const receipt = await polygonscan<{
      status: string;
      blockNumber: string;
      gasUsed: string;
      from: string;
      to: string;
    } | null>({
      module: 'transaction',
      action: 'gettxreceiptstatus',
      txhash: hash,
    });

    if (!receipt) {
      return { hash, status: 'not_found', confirmations: 0, blockNumber: null, gasUsed: null, from: null, to: null, value: null, timestamp: null };
    }

    // Get current block for confirmation count
    const currentBlock = await polygonscan<string>({
      module: 'proxy',
      action: 'eth_blockNumber',
    });

    const txDetail = await polygonscan<{
      blockNumber: string;
      from: string;
      to: string;
      value: string;
      timeStamp?: string;
    } | null>({
      module: 'proxy',
      action: 'eth_getTransactionByHash',
      txhash: hash,
    });

    const blockNum = txDetail?.blockNumber ? parseInt(txDetail.blockNumber, 16) : null;
    const currentBlockNum = parseInt(currentBlock, 16);
    const confirmations = blockNum ? Math.max(0, currentBlockNum - blockNum) : 0;

    return {
      hash,
      status: receipt.status === '1' ? 'confirmed' : receipt.status === '0' ? 'failed' : 'pending',
      confirmations,
      blockNumber: blockNum,
      gasUsed: receipt.gasUsed ? parseInt(receipt.gasUsed) : null,
      from: txDetail?.from ?? null,
      to: txDetail?.to ?? null,
      value: txDetail?.value ?? null,
      timestamp: txDetail?.timeStamp ? parseInt(txDetail.timeStamp) * 1000 : null,
    };
  } catch (err) {
    return {
      hash,
      status: 'not_found',
      confirmations: 0,
      blockNumber: null,
      gasUsed: null,
      from: null,
      to: null,
      value: null,
      timestamp: null,
      error: String(err),
    };
  }
}

/** Get ERC-20 token transfers for a wallet (yield accruals) */
export async function getTokenTransfers(
  address: string,
  startBlock = 0,
  limit = 20,
): Promise<TokenTransfer[]> {
  const raw = await polygonscan<Array<{
    hash: string;
    blockNumber: string;
    timeStamp: string;
    from: string;
    to: string;
    tokenSymbol: string;
    tokenName: string;
    contractAddress: string;
    value: string;
    tokenDecimal: string;
  }>>({
    module: 'account',
    action: 'tokentx',
    address,
    startblock: String(startBlock),
    endblock: '99999999',
    page: '1',
    offset: String(limit),
    sort: 'desc',
  });

  if (!Array.isArray(raw)) return [];

  return raw.map((t) => {
    const decimals = parseInt(t.tokenDecimal) || 18;
    const valueFormatted = parseFloat(t.value) / Math.pow(10, decimals);
    return {
      hash: t.hash,
      blockNumber: parseInt(t.blockNumber),
      timestamp: parseInt(t.timeStamp) * 1000,
      from: t.from,
      to: t.to.toLowerCase(),
      tokenSymbol: t.tokenSymbol,
      tokenName: t.tokenName,
      contractAddress: t.contractAddress,
      value: t.value,
      decimals,
      valueFormatted,
    };
  });
}

/** Detect yield accrual events (inbound transfers to wallet from known DeFi protocols) */
export async function detectYieldAccruals(
  walletAddress: string,
  knownProtocols: Record<string, string> = {},
): Promise<YieldAccrual[]> {
  const transfers = await getTokenTransfers(walletAddress, 0, 50);
  const wallet = walletAddress.toLowerCase();

  return transfers
    .filter((t) => t.to === wallet)
    .map((t) => ({
      protocol: knownProtocols[t.contractAddress.toLowerCase()] ?? 'Unknown Protocol',
      asset: t.tokenSymbol,
      amount: t.valueFormatted,
      usdValue: 0, // enriched by caller if needed
      timestamp: t.timestamp,
      txHash: t.hash,
    }));
}

/** Get native MATIC balance for a wallet */
export async function getMaticBalance(address: string): Promise<number> {
  const wei = await polygonscan<string>({
    module: 'account',
    action: 'balance',
    address,
    tag: 'latest',
  });
  return parseFloat(wei) / 1e18;
}
