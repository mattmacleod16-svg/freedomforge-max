/**
 * Internet Computer Protocol (ICP) Chain Client
 * Pure-fetch REST client for the ICP HTTP gateway.
 * Covers: balance queries, canister status, subnet info, network topology.
 * No SDK dependency — uses the ICP HTTP gateway and dashboards API.
 * Reference: dfinity/agent-js
 */

export interface ICPBalance {
  principal: string;
  balanceE8s: string;  // ICP in 1e-8 units
  balanceICP: number;
}

export interface ICPCanisterStatus {
  canisterId: string;
  status: 'running' | 'stopping' | 'stopped' | 'unknown';
  memorySize: number; // bytes
  cycles: string;
  moduleHash: string | null;
}

export interface ICPSubnetInfo {
  subnetId: string;
  subnetType: string;
  nodeCount: number;
  canisterCount: number;
}

export interface ICPNetworkStats {
  totalNodes: number;
  totalSubnets: number;
  totalCanisters: number;
  totalTransactionsLastDay: number;
  totalBlocks: number;
  icp_supply: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// NNS ledger canister
const LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
// ICP public dashboard API
const DASHBOARD_API = 'https://ic-api.internetcomputer.org';
const HTTP_GATEWAY = 'https://icp-api.io';
const FETCH_TIMEOUT_MS = 15_000;

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function dashGet(path: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${DASHBOARD_API}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json() as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

async function gatewayGet(path: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${HTTP_GATEWAY}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json() as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getICPBalance(
  principal: string,
): Promise<ICPBalance | null> {
  // Query NNS ledger account_balance via HTTP query
  const data = await dashGet(`/api/v3/accounts/${principal}/balance`);
  if (!data) return null;

  const e8s = String(data.balance ?? data.e8s ?? '0');
  const icp = parseInt(e8s, 10) / 1e8;

  return {
    principal,
    balanceE8s: e8s,
    balanceICP: Number.isFinite(icp) ? icp : 0,
  };
}

export async function getICPNetworkStats(): Promise<ICPNetworkStats | null> {
  const data = await dashGet('/api/v3/metrics');
  if (!data) return null;

  return {
    totalNodes: Number(data.node_count ?? data.total_nodes ?? 0),
    totalSubnets: Number(data.subnet_count ?? data.total_subnets ?? 0),
    totalCanisters: Number(data.canister_count ?? 0),
    totalTransactionsLastDay: Number(data.icp_transactions_last_day ?? 0),
    totalBlocks: Number(data.finalized_block_height ?? data.total_blocks ?? 0),
    icp_supply: String(data.icp_supply ?? ''),
  };
}

export async function getICPSubnets(): Promise<ICPSubnetInfo[]> {
  const data = await dashGet('/api/v3/subnets');
  const subnets = (data?.data ?? data?.subnets) as Record<string, unknown>[] | undefined;
  if (!Array.isArray(subnets)) return [];

  return subnets.slice(0, 40).map((s) => ({
    subnetId: String(s.subnet_id ?? s.id ?? ''),
    subnetType: String(s.subnet_type ?? 'application'),
    nodeCount: Number(s.node_count ?? 0),
    canisterCount: Number(s.canister_count ?? 0),
  }));
}

export async function getICPCanisterStatus(
  canisterId: string,
): Promise<ICPCanisterStatus | null> {
  const data = await dashGet(`/api/v3/canisters/${canisterId}`);
  if (!data) return null;

  return {
    canisterId,
    status: (data.status as ICPCanisterStatus['status']) ?? 'unknown',
    memorySize: Number(data.memory_size_bytes ?? data.memory_size ?? 0),
    cycles: String(data.cycles ?? '0'),
    moduleHash: data.module_hash ? String(data.module_hash) : null,
  };
}

export async function getICPLatestBlocks(count = 5): Promise<Array<{
  blockHeight: number;
  blockHash: string;
  timestamp: number;
  txCount: number;
}>> {
  const data = await gatewayGet(`/api/v2/blocks?limit=${count}`);
  const blocks = (data?.data ?? data?.blocks) as Record<string, unknown>[] | undefined;
  if (!Array.isArray(blocks)) return [];

  return blocks.map((b) => ({
    blockHeight: Number(b.block_height ?? b.height ?? 0),
    blockHash: String(b.block_hash ?? b.hash ?? ''),
    timestamp: Number(b.timestamp ?? 0),
    txCount: Number(b.transaction_count ?? b.tx_count ?? 0),
  }));
}

export async function getICPNetworkHealth(): Promise<{
  healthy: boolean;
  totalNodes: number;
  totalSubnets: number;
  latestBlock: number;
}> {
  const stats = await getICPNetworkStats();
  const blocks = await getICPLatestBlocks(1);
  return {
    healthy: stats !== null,
    totalNodes: stats?.totalNodes ?? 0,
    totalSubnets: stats?.totalSubnets ?? 0,
    latestBlock: blocks[0]?.blockHeight ?? 0,
  };
}

export { LEDGER_CANISTER_ID };
