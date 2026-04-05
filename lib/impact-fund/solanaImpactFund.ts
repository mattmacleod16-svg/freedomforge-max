/**
 * Solana On-Chain Impact Fund
 *
 * Manages the 501(c)(3) 10% impact allocation:
 * - Tracks revenue events and computes 10% allocation
 * - Records fund state with Solana transaction signatures
 * - Provides transparent reporting of allocations
 *
 * Uses Solana RPC for on-chain proof; falls back to local ledger if not configured.
 */

import fs from 'fs';
import path from 'path';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ImpactAllocation {
  id: string;
  revenueSourceId: string;
  grossAmountUsd: number;
  allocationUsd: number;        // 10% of gross
  allocationBps: number;        // basis points (1000 = 10%)
  solanaSignature: string | null;
  walletAddress: string | null;
  cause: string;
  status: 'pending' | 'confirmed' | 'failed';
  createdAt: number;
  confirmedAt: number | null;
}

export interface ImpactFundState {
  totalAllocatedUsd: number;
  totalConfirmedUsd: number;
  totalPendingUsd: number;
  allocationCount: number;
  walletAddress: string | null;
  allocations: ImpactAllocation[];
  lastUpdatedAt: number;
}

// ─── Config ─────────────────────────────────────────────────────────────────

const IMPACT_BPS = 1000; // 10% = 1000 basis points
const IMPACT_FUND_FILE = process.env.IMPACT_FUND_FILE
  || path.join(process.cwd(), 'data', 'impact-fund-state.json');
const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const IMPACT_WALLET = (process.env.SOLANA_IMPACT_WALLET || '').trim();

// ─── Persistence ─────────────────────────────────────────────────────────────

function loadState(): ImpactFundState {
  try {
    if (fs.existsSync(IMPACT_FUND_FILE)) {
      const raw = fs.readFileSync(IMPACT_FUND_FILE, 'utf8');
      return JSON.parse(raw) as ImpactFundState;
    }
  } catch { /* ignore */ }
  return {
    totalAllocatedUsd: 0,
    totalConfirmedUsd: 0,
    totalPendingUsd: 0,
    allocationCount: 0,
    walletAddress: IMPACT_WALLET || null,
    allocations: [],
    lastUpdatedAt: Date.now(),
  };
}

function saveState(state: ImpactFundState): void {
  try {
    const dir = path.dirname(IMPACT_FUND_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(IMPACT_FUND_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[impactFund] failed to save state', err);
  }
}

// ─── Solana Integration ──────────────────────────────────────────────────────

/**
 * Look up a Solana transaction signature on-chain.
 * Returns true if the transaction was confirmed.
 */
export async function verifySolanaTransaction(signature: string): Promise<boolean> {
  if (!signature) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(SOLANA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignatureStatuses',
        params: [[signature], { searchTransactionHistory: true }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json() as { result?: { value?: Array<{ confirmationStatus?: string } | null> } };
    const status = data.result?.value?.[0];
    return status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized';
  } catch {
    return false;
  }
}

/**
 * Get the SOL balance (in SOL) for the impact wallet.
 */
export async function getImpactWalletBalance(): Promise<number | null> {
  if (!IMPACT_WALLET) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(SOLANA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [IMPACT_WALLET],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json() as { result?: { value?: number } };
    const lamports = data.result?.value;
    if (typeof lamports !== 'number') return null;
    return lamports / 1e9; // lamports to SOL
  } catch {
    return null;
  }
}

// ─── Core Fund Operations ─────────────────────────────────────────────────────

/**
 * Record a new revenue event and compute the 10% impact allocation.
 */
export function recordRevenueAllocation(params: {
  revenueSourceId: string;
  grossAmountUsd: number;
  cause?: string;
  solanaSignature?: string;
}): ImpactAllocation {
  const state = loadState();
  const allocationUsd = (params.grossAmountUsd * IMPACT_BPS) / 10_000;

  const allocation: ImpactAllocation = {
    id: `impact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    revenueSourceId: params.revenueSourceId,
    grossAmountUsd: params.grossAmountUsd,
    allocationUsd,
    allocationBps: IMPACT_BPS,
    solanaSignature: params.solanaSignature || null,
    walletAddress: state.walletAddress,
    cause: params.cause || 'Forest Acres / Columbia SC Economic Mobility',
    status: params.solanaSignature ? 'confirmed' : 'pending',
    createdAt: Date.now(),
    confirmedAt: params.solanaSignature ? Date.now() : null,
  };

  state.allocations.unshift(allocation);
  if (state.allocations.length > 500) state.allocations = state.allocations.slice(0, 500);

  state.totalAllocatedUsd += allocationUsd;
  if (allocation.status === 'confirmed') {
    state.totalConfirmedUsd += allocationUsd;
  } else {
    state.totalPendingUsd += allocationUsd;
  }
  state.allocationCount++;
  state.lastUpdatedAt = Date.now();

  saveState(state);
  return allocation;
}

/**
 * Mark a pending allocation as confirmed with a Solana signature.
 */
export function confirmAllocation(allocationId: string, signature: string): ImpactAllocation | null {
  const state = loadState();
  const idx = state.allocations.findIndex((a) => a.id === allocationId);
  if (idx === -1) return null;

  const alloc = state.allocations[idx];
  if (alloc.status === 'pending') {
    state.totalPendingUsd = Math.max(0, state.totalPendingUsd - alloc.allocationUsd);
    state.totalConfirmedUsd += alloc.allocationUsd;
  }

  state.allocations[idx] = {
    ...alloc,
    status: 'confirmed',
    solanaSignature: signature,
    confirmedAt: Date.now(),
  };
  state.lastUpdatedAt = Date.now();
  saveState(state);
  return state.allocations[idx];
}

/**
 * Get the current impact fund summary.
 */
export function getImpactFundSummary(): ImpactFundState & { walletUrl: string | null } {
  const state = loadState();
  const walletUrl = state.walletAddress
    ? `https://solscan.io/account/${state.walletAddress}`
    : null;
  return { ...state, walletUrl };
}

/**
 * Get recent allocations for transparency reporting.
 */
export function getRecentAllocations(limit = 20): ImpactAllocation[] {
  const state = loadState();
  return state.allocations.slice(0, limit);
}
