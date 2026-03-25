/**
 * XRP Ledger Client
 * Pure-fetch JSON-RPC client for the XRP Ledger (rippled API).
 * Covers: account info, balance, payments, offer book, tx status.
 * No SDK dependency — uses rippled HTTP JSON-RPC directly.
 * Reference: XRPLF/xrpl.js & XRPLF/rippled
 */

export type XRPNetwork = 'mainnet' | 'testnet' | 'devnet';

export interface XRPAccountInfo {
  address: string;
  balance: string; // drops (1 XRP = 1_000_000 drops)
  balanceXRP: number;
  sequence: number;
  ownerCount: number;
  flags: number;
  ledgerIndex: number;
}

export interface XRPTxStatus {
  txHash: string;
  validated: boolean;
  resultCode: string; // e.g. "tesSUCCESS"
  fee: string; // drops
  ledgerIndex?: number;
  date?: number; // ripple epoch seconds
}

export interface XRPPaymentResult {
  txHash: string;
  accepted: boolean;
  resultCode: string;
  openLedgerCost: string; // drops
  validatedLedgerIndex: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RPC_ENDPOINTS: Record<XRPNetwork, string> = {
  mainnet: 'https://s1.ripple.com:51234',
  testnet: 'https://s.altnet.rippletest.net:51234',
  devnet: 'https://s.devnet.rippletest.net:51234',
};

const FETCH_TIMEOUT_MS = 15_000;

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function rpcCall(
  network: XRPNetwork,
  method: string,
  params: Record<string, unknown>[],
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(RPC_ENDPOINTS[network], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getXRPAccountInfo(
  address: string,
  network: XRPNetwork = 'mainnet',
): Promise<XRPAccountInfo | null> {
  const result = await rpcCall(network, 'account_info', [
    { account: address, ledger_index: 'validated' },
  ]) as Record<string, unknown> | null;

  const info = result?.account_data as Record<string, unknown> | undefined;
  if (!info) return null;

  const drops = String(info.Balance ?? '0');
  return {
    address,
    balance: drops,
    balanceXRP: parseInt(drops, 10) / 1_000_000,
    sequence: Number(info.Sequence ?? 0),
    ownerCount: Number(info.OwnerCount ?? 0),
    flags: Number(info.Flags ?? 0),
    ledgerIndex: Number((result as Record<string, unknown>).ledger_index ?? 0),
  };
}

export async function getXRPBalance(
  address: string,
  network: XRPNetwork = 'mainnet',
): Promise<number | null> {
  const info = await getXRPAccountInfo(address, network);
  return info ? info.balanceXRP : null;
}

export async function getXRPTxStatus(
  txHash: string,
  network: XRPNetwork = 'mainnet',
): Promise<XRPTxStatus | null> {
  const result = await rpcCall(network, 'tx', [
    { transaction: txHash, binary: false },
  ]) as Record<string, unknown> | null;

  if (!result) return null;
  const metaData = result.meta as Record<string, unknown> | undefined;

  return {
    txHash,
    validated: Boolean(result.validated),
    resultCode: String(metaData?.TransactionResult ?? result.status ?? 'unknown'),
    fee: String((result as Record<string, unknown>).Fee ?? '0'),
    ledgerIndex: result.ledger_index ? Number(result.ledger_index) : undefined,
    date: result.date ? Number(result.date) : undefined,
  };
}

export async function getLedgerInfo(
  network: XRPNetwork = 'mainnet',
): Promise<{ ledgerIndex: number; closeTime: number; txnCount: number } | null> {
  const result = await rpcCall(network, 'ledger', [
    { ledger_index: 'validated', transactions: false },
  ]) as Record<string, unknown> | null;

  const ledger = result?.ledger as Record<string, unknown> | undefined;
  if (!ledger) return null;

  return {
    ledgerIndex: Number(ledger.ledger_index ?? 0),
    closeTime: Number(ledger.close_time ?? 0),
    txnCount: Number(ledger.transaction_count ?? 0),
  };
}

export async function getXRPServerInfo(network: XRPNetwork = 'mainnet'): Promise<{
  buildVersion: string;
  networkId: number;
  ledgersCompleted: number;
} | null> {
  const result = await rpcCall(network, 'server_info', [{}]) as Record<string, unknown> | null;
  const info = (result?.info as Record<string, unknown>) ?? null;
  if (!info) return null;

  return {
    buildVersion: String(info.build_version ?? ''),
    networkId: Number(info.network_id ?? 0),
    ledgersCompleted: Number((info.complete_ledgers as string ?? '').split('-').pop() ?? '0') || 0,
  };
}
