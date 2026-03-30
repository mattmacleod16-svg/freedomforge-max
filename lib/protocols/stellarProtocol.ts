/**
 * Stellar Protocol Integration — FreedomForge Max
 * ═══════════════════════════════════════════════════
 *
 * Inspired by the Stellar blockchain protocol and SHX (Stronghold) token:
 *
 *  • Stellar Consensus Protocol (SCP) — Federated Byzantine Agreement
 *  • SDEX — Built-in decentralized exchange with order books
 *  • Anchors — Fiat/crypto bridge abstraction
 *  • Asset Issuance — Native multi-asset support
 *  • Governance — On-chain proposal + voting framework
 *  • Staking Tiers — SHX-inspired tiered staking with fee rebates
 *  • Cross-Chain Bridges — Multi-network interop (Ethereum, Solana, XRP)
 *  • Energy Efficiency — 0.00022 kWh per transaction tracking
 *
 * Reference: https://stellar.expert/explorer/public/asset/SHX-GDSTRSHXHGJ7ZIVRBXEYE5Q74XUVCUSEKEBR7UCHEUUEK72N7I7KJ6JH-1
 */

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type AssetType = 'native' | 'credit_alphanum4' | 'credit_alphanum12';
export type OrderSide = 'buy' | 'sell';
export type ProposalStatus = 'active' | 'passed' | 'rejected' | 'executed';
export type StakingTier = 'bronze' | 'silver' | 'gold' | 'platinum';
export type BridgeNetwork = 'ethereum' | 'solana' | 'xrpl' | 'stellar';
export type AnchorStatus = 'active' | 'pending' | 'suspended';
export type TrustlineStatus = 'authorized' | 'pending' | 'frozen';

export interface StellarAsset {
  code: string;
  issuer: string;
  type: AssetType;
  domain?: string;
  totalSupply: number;
  circulatingSupply: number;
  holders: number;
  trustlines: number;
  description?: string;
  isCompliant: boolean;
  createdAt: number;
}

export interface Trustline {
  account: string;
  asset: StellarAsset;
  balance: number;
  limit: number;
  status: TrustlineStatus;
  createdAt: number;
}

export interface OrderBookEntry {
  id: string;
  side: OrderSide;
  price: number;
  amount: number;
  account: string;
  asset: string;
  counterAsset: string;
  passive: boolean;
  timestamp: number;
}

export interface Anchor {
  id: string;
  name: string;
  domain: string;
  assets: string[];
  status: AnchorStatus;
  fiatCurrencies: string[];
  region: string;
  complianceLevel: 'basic' | 'nacha' | 'iso20022' | 'full';
  throughputTps: number;
  createdAt: number;
}

export interface GovernanceProposal {
  id: string;
  title: string;
  description: string;
  proposer: string;
  status: ProposalStatus;
  votesFor: number;
  votesAgainst: number;
  quorumRequired: number;
  executionPayload?: string;
  createdAt: number;
  expiresAt: number;
}

export interface StakingPosition {
  account: string;
  amount: number;
  tier: StakingTier;
  feeRebatePct: number;
  governanceWeight: number;
  lockupDays: number;
  rewardsEarned: number;
  stakedAt: number;
}

export interface BridgeTransfer {
  id: string;
  sourceNetwork: BridgeNetwork;
  destNetwork: BridgeNetwork;
  asset: string;
  amount: number;
  sender: string;
  recipient: string;
  status: 'pending' | 'confirmed' | 'failed';
  txHash?: string;
  fee: number;
  initiatedAt: number;
  completedAt?: number;
}

export interface StellarTransaction {
  id: string;
  sourceAccount: string;
  operations: StellarOperation[];
  fee: number;
  energyKwh: number;
  memo?: string;
  timestamp: number;
  ledger: number;
}

export interface StellarOperation {
  type: 'payment' | 'create_account' | 'manage_sell_offer' | 'manage_buy_offer' | 'change_trust' | 'set_options' | 'path_payment';
  sourceAccount?: string;
  params: Record<string, unknown>;
}

export interface PathPayment {
  sourceAsset: string;
  destAsset: string;
  sendAmount: number;
  destMin: number;
  path: string[];
  hops: number;
}

/* ─── Constants ───────────────────────────────────────────────────────────── */

const ENERGY_PER_TX_KWH = 0.00022;
const BASE_FEE_STROOPS = 100;
const STROOPS_PER_LUMEN = 10_000_000;
const TX_FINALITY_SECONDS = 4;
const MAX_OPERATIONS_PER_TX = 100;

const SHX_ASSET: StellarAsset = {
  code: 'SHX',
  issuer: 'GDSTRSHXHGJ7ZIVRBXEYE5Q74XUVCUSEKEBR7UCHEUUEK72N7I7KJ6JH',
  type: 'credit_alphanum4',
  domain: 'stronghold.co',
  totalSupply: 100_000_000_000,
  circulatingSupply: 5_370_000_000,
  holders: 0,
  trustlines: 0,
  description: 'Stronghold SHx — compliance-ready utility token bridging tokenized assets with conventional banking',
  isCompliant: true,
  createdAt: Date.now(),
};

const STAKING_TIERS: Record<StakingTier, { minAmount: number; feeRebatePct: number; governanceWeight: number; lockupDays: number }> = {
  bronze:   { minAmount: 10_000,     feeRebatePct: 5,  governanceWeight: 1,  lockupDays: 30 },
  silver:   { minAmount: 100_000,    feeRebatePct: 15, governanceWeight: 3,  lockupDays: 90 },
  gold:     { minAmount: 1_000_000,  feeRebatePct: 30, governanceWeight: 7,  lockupDays: 180 },
  platinum: { minAmount: 10_000_000, feeRebatePct: 50, governanceWeight: 15, lockupDays: 365 },
};

/* ─── SCP Consensus Simulator ─────────────────────────────────────────────── */

export interface QuorumSlice {
  validators: string[];
  threshold: number;
}

export interface ConsensusResult {
  agreed: boolean;
  round: number;
  votesFor: number;
  votesAgainst: number;
  finalityMs: number;
  energyKwh: number;
}

export function simulateConsensus(validators: string[], quorumThreshold: number): ConsensusResult {
  if (validators.length === 0) {
    return { agreed: false, round: 0, votesFor: 0, votesAgainst: 0, finalityMs: 0, energyKwh: 0 };
  }

  const threshold = Math.max(0.5, Math.min(1, quorumThreshold));
  const requiredVotes = Math.ceil(validators.length * threshold);

  // Simulate voting — deterministic based on validator count
  const votesFor = Math.min(validators.length, Math.ceil(validators.length * 0.85));
  const votesAgainst = validators.length - votesFor;
  const agreed = votesFor >= requiredVotes;
  const rounds = agreed ? 1 : Math.min(3, Math.ceil(requiredVotes / Math.max(1, votesFor)));

  return {
    agreed,
    round: rounds,
    votesFor,
    votesAgainst,
    finalityMs: TX_FINALITY_SECONDS * 1000 * rounds,
    energyKwh: ENERGY_PER_TX_KWH * validators.length,
  };
}

/* ─── SDEX Order Book ─────────────────────────────────────────────────────── */

const orderBooks: Map<string, OrderBookEntry[]> = new Map();

function getOrderBookKey(asset: string, counterAsset: string): string {
  return `${asset}/${counterAsset}`;
}

export function submitOrder(order: Omit<OrderBookEntry, 'id' | 'timestamp'>): OrderBookEntry {
  const entry: OrderBookEntry = {
    ...order,
    id: `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
  };

  const key = getOrderBookKey(order.asset, order.counterAsset);
  const book = orderBooks.get(key) || [];

  // Check for matching orders (unless passive)
  if (!order.passive) {
    const matchSide = order.side === 'buy' ? 'sell' : 'buy';
    const matchIdx = book.findIndex((existing) => {
      if (existing.side !== matchSide) return false;
      if (order.side === 'buy') return existing.price <= order.price;
      return existing.price >= order.price;
    });

    if (matchIdx >= 0) {
      const matched = book[matchIdx];
      const fillAmount = Math.min(entry.amount, matched.amount);
      matched.amount -= fillAmount;
      entry.amount -= fillAmount;
      if (matched.amount <= 0) book.splice(matchIdx, 1);
    }
  }

  if (entry.amount > 0) {
    book.push(entry);
    book.sort((a, b) => (a.side === 'sell' ? a.price - b.price : b.price - a.price));
  }

  orderBooks.set(key, book);
  return entry;
}

export function getOrderBook(asset: string, counterAsset: string): { bids: OrderBookEntry[]; asks: OrderBookEntry[] } {
  const key = getOrderBookKey(asset, counterAsset);
  const book = orderBooks.get(key) || [];
  return {
    bids: book.filter((o) => o.side === 'buy').sort((a, b) => b.price - a.price),
    asks: book.filter((o) => o.side === 'sell').sort((a, b) => a.price - b.price),
  };
}

export function getSpread(asset: string, counterAsset: string): number | null {
  const { bids, asks } = getOrderBook(asset, counterAsset);
  if (bids.length === 0 || asks.length === 0) return null;
  return asks[0].price - bids[0].price;
}

export function clearOrderBook(asset: string, counterAsset: string): void {
  const key = getOrderBookKey(asset, counterAsset);
  orderBooks.delete(key);
}

/* ─── Path Payment Router ─────────────────────────────────────────────────── */

const EXCHANGE_RATES: Record<string, number> = {
  'XLM/USD': 0.12,
  'SHX/XLM': 0.0001,
  'SHX/USD': 0.000012,
  'ETH/USD': 3200,
  'BTC/USD': 68000,
  'USDC/USD': 1.0,
  'FORGE/USD': 0.05,
};

export function findPaymentPath(sourceAsset: string, destAsset: string, amount: number): PathPayment | null {
  const directKey = `${sourceAsset}/${destAsset}`;
  const directRate = EXCHANGE_RATES[directKey];

  if (directRate) {
    return {
      sourceAsset,
      destAsset,
      sendAmount: amount,
      destMin: amount * directRate * 0.995, // 0.5% slippage
      path: [],
      hops: 0,
    };
  }

  // Try one-hop via XLM
  const toXlm = EXCHANGE_RATES[`${sourceAsset}/XLM`] || (EXCHANGE_RATES[`XLM/${sourceAsset}`] ? 1 / EXCHANGE_RATES[`XLM/${sourceAsset}`] : 0);
  const fromXlm = EXCHANGE_RATES[`XLM/${destAsset}`] || (EXCHANGE_RATES[`${destAsset}/XLM`] ? 1 / EXCHANGE_RATES[`${destAsset}/XLM`] : 0);

  if (toXlm > 0 && fromXlm > 0) {
    const destAmount = amount * toXlm * fromXlm;
    return {
      sourceAsset,
      destAsset,
      sendAmount: amount,
      destMin: destAmount * 0.99, // 1% slippage for multi-hop
      path: ['XLM'],
      hops: 1,
    };
  }

  // Try two-hop via XLM → USD
  const toUsd = EXCHANGE_RATES[`${sourceAsset}/USD`];
  const fromUsd = EXCHANGE_RATES[`USD/${destAsset}`] || (EXCHANGE_RATES[`${destAsset}/USD`] ? 1 / EXCHANGE_RATES[`${destAsset}/USD`] : 0);

  if (toUsd && fromUsd > 0) {
    return {
      sourceAsset,
      destAsset,
      sendAmount: amount,
      destMin: amount * toUsd * fromUsd * 0.985,
      path: ['USD'],
      hops: 1,
    };
  }

  return null;
}

/* ─── Staking Engine ──────────────────────────────────────────────────────── */

const stakingPositions: Map<string, StakingPosition> = new Map();

export function calculateStakingTier(amount: number): StakingTier {
  if (amount >= STAKING_TIERS.platinum.minAmount) return 'platinum';
  if (amount >= STAKING_TIERS.gold.minAmount) return 'gold';
  if (amount >= STAKING_TIERS.silver.minAmount) return 'silver';
  return 'bronze';
}

export function stake(account: string, amount: number): StakingPosition {
  const tier = calculateStakingTier(amount);
  const config = STAKING_TIERS[tier];

  const existing = stakingPositions.get(account);
  const totalAmount = (existing?.amount || 0) + amount;
  const newTier = calculateStakingTier(totalAmount);
  const newConfig = STAKING_TIERS[newTier];

  const position: StakingPosition = {
    account,
    amount: totalAmount,
    tier: newTier,
    feeRebatePct: newConfig.feeRebatePct,
    governanceWeight: newConfig.governanceWeight,
    lockupDays: newConfig.lockupDays,
    rewardsEarned: existing?.rewardsEarned || 0,
    stakedAt: existing?.stakedAt || Date.now(),
  };

  stakingPositions.set(account, position);
  return position;
}

export function getStakingPosition(account: string): StakingPosition | null {
  return stakingPositions.get(account) || null;
}

export function calculateRewards(position: StakingPosition, daysElapsed: number): number {
  const annualRate = position.tier === 'platinum' ? 0.12
    : position.tier === 'gold' ? 0.08
    : position.tier === 'silver' ? 0.05
    : 0.03;

  return position.amount * annualRate * (daysElapsed / 365);
}

export function getStakingTierInfo(): Record<StakingTier, typeof STAKING_TIERS[StakingTier]> {
  return { ...STAKING_TIERS };
}

/* ─── Governance Engine ───────────────────────────────────────────────────── */

const proposals: Map<string, GovernanceProposal> = new Map();

export function createProposal(input: {
  title: string;
  description: string;
  proposer: string;
  quorumRequired?: number;
  durationDays?: number;
}): GovernanceProposal {
  const proposal: GovernanceProposal = {
    id: `prop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    title: input.title,
    description: input.description,
    proposer: input.proposer,
    status: 'active',
    votesFor: 0,
    votesAgainst: 0,
    quorumRequired: input.quorumRequired || 1000,
    createdAt: Date.now(),
    expiresAt: Date.now() + (input.durationDays || 7) * 24 * 60 * 60 * 1000,
  };

  proposals.set(proposal.id, proposal);
  return proposal;
}

export function vote(proposalId: string, voter: string, inFavor: boolean, weight: number = 1): GovernanceProposal | null {
  const proposal = proposals.get(proposalId);
  if (!proposal || proposal.status !== 'active') return null;

  if (inFavor) {
    proposal.votesFor += weight;
  } else {
    proposal.votesAgainst += weight;
  }

  // Check quorum and resolve
  const totalVotes = proposal.votesFor + proposal.votesAgainst;
  if (totalVotes >= proposal.quorumRequired) {
    proposal.status = proposal.votesFor > proposal.votesAgainst ? 'passed' : 'rejected';
  }

  if (Date.now() > proposal.expiresAt && proposal.status === 'active') {
    proposal.status = totalVotes >= proposal.quorumRequired
      ? (proposal.votesFor > proposal.votesAgainst ? 'passed' : 'rejected')
      : 'rejected';
  }

  return proposal;
}

export function getProposal(proposalId: string): GovernanceProposal | null {
  return proposals.get(proposalId) || null;
}

export function getActiveProposals(): GovernanceProposal[] {
  return Array.from(proposals.values()).filter((p) => p.status === 'active');
}

/* ─── Anchor Registry ─────────────────────────────────────────────────────── */

const ANCHORS: Anchor[] = [
  {
    id: 'stronghold',
    name: 'Stronghold',
    domain: 'stronghold.co',
    assets: ['SHX', 'USD'],
    status: 'active',
    fiatCurrencies: ['USD'],
    region: 'US',
    complianceLevel: 'nacha',
    throughputTps: 1000,
    createdAt: Date.now(),
  },
  {
    id: 'circle',
    name: 'Circle',
    domain: 'circle.com',
    assets: ['USDC'],
    status: 'active',
    fiatCurrencies: ['USD', 'EUR'],
    region: 'Global',
    complianceLevel: 'iso20022',
    throughputTps: 5000,
    createdAt: Date.now(),
  },
  {
    id: 'freedomforge',
    name: 'FreedomForge',
    domain: 'freedomforge.one',
    assets: ['FORGE'],
    status: 'active',
    fiatCurrencies: ['USD'],
    region: 'Global',
    complianceLevel: 'full',
    throughputTps: 2000,
    createdAt: Date.now(),
  },
];

export function getAnchors(): Anchor[] {
  return [...ANCHORS];
}

export function getAnchorByDomain(domain: string): Anchor | undefined {
  return ANCHORS.find((a) => a.domain === domain);
}

export function getAnchorsByCompliance(level: Anchor['complianceLevel']): Anchor[] {
  const levels: Anchor['complianceLevel'][] = ['basic', 'nacha', 'iso20022', 'full'];
  const minIndex = levels.indexOf(level);
  return ANCHORS.filter((a) => levels.indexOf(a.complianceLevel) >= minIndex);
}

/* ─── Cross-Chain Bridge ──────────────────────────────────────────────────── */

const bridgeTransfers: BridgeTransfer[] = [];

const BRIDGE_FEES: Record<BridgeNetwork, number> = {
  stellar: 0.001,
  ethereum: 0.005,
  solana: 0.002,
  xrpl: 0.0015,
};

export function initiateBridgeTransfer(input: {
  sourceNetwork: BridgeNetwork;
  destNetwork: BridgeNetwork;
  asset: string;
  amount: number;
  sender: string;
  recipient: string;
}): BridgeTransfer {
  const fee = input.amount * (BRIDGE_FEES[input.sourceNetwork] + BRIDGE_FEES[input.destNetwork]);

  const transfer: BridgeTransfer = {
    id: `bridge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    ...input,
    status: 'pending',
    fee: Number(fee.toFixed(6)),
    initiatedAt: Date.now(),
  };

  bridgeTransfers.push(transfer);
  return transfer;
}

export function confirmBridgeTransfer(transferId: string, txHash: string): BridgeTransfer | null {
  const transfer = bridgeTransfers.find((t) => t.id === transferId);
  if (!transfer || transfer.status !== 'pending') return null;

  transfer.status = 'confirmed';
  transfer.txHash = txHash;
  transfer.completedAt = Date.now();
  return transfer;
}

export function getBridgeTransfer(transferId: string): BridgeTransfer | null {
  return bridgeTransfers.find((t) => t.id === transferId) || null;
}

export function estimateBridgeFee(sourceNetwork: BridgeNetwork, destNetwork: BridgeNetwork, amount: number): number {
  return Number((amount * (BRIDGE_FEES[sourceNetwork] + BRIDGE_FEES[destNetwork])).toFixed(6));
}

/* ─── Transaction Builder ─────────────────────────────────────────────────── */

export function buildTransaction(input: {
  sourceAccount: string;
  operations: StellarOperation[];
  memo?: string;
}): StellarTransaction {
  if (input.operations.length > MAX_OPERATIONS_PER_TX) {
    throw new Error(`Max ${MAX_OPERATIONS_PER_TX} operations per transaction`);
  }

  const fee = (BASE_FEE_STROOPS * input.operations.length) / STROOPS_PER_LUMEN;

  return {
    id: `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    sourceAccount: input.sourceAccount,
    operations: input.operations,
    fee,
    energyKwh: ENERGY_PER_TX_KWH,
    memo: input.memo,
    timestamp: Date.now(),
    ledger: Math.floor(Date.now() / (TX_FINALITY_SECONDS * 1000)),
  };
}

export function estimateEnergy(transactionCount: number): { kwh: number; comparedToVisa: string } {
  const kwh = transactionCount * ENERGY_PER_TX_KWH;
  const visaKwhPerTx = 0.003;
  const ratio = (kwh / (transactionCount * visaKwhPerTx)) * 100;
  return {
    kwh,
    comparedToVisa: `${ratio.toFixed(1)}% of Visa's energy per transaction`,
  };
}

/* ─── Protocol Summary ────────────────────────────────────────────────────── */

export function getProtocolSummary() {
  return {
    name: 'FreedomForge Stellar Protocol',
    version: '1.0.0',
    network: 'stellar',
    consensus: 'SCP (Stellar Consensus Protocol)',
    txFinalitySeconds: TX_FINALITY_SECONDS,
    energyPerTxKwh: ENERGY_PER_TX_KWH,
    baseFeeStroops: BASE_FEE_STROOPS,
    maxOpsPerTx: MAX_OPERATIONS_PER_TX,
    referenceAsset: SHX_ASSET,
    stakingTiers: STAKING_TIERS,
    bridgeNetworks: Object.keys(BRIDGE_FEES) as BridgeNetwork[],
    anchors: ANCHORS.map((a) => ({ name: a.name, domain: a.domain, compliance: a.complianceLevel })),
    features: [
      'SCP federated Byzantine agreement consensus',
      'Built-in SDEX decentralized exchange',
      'Multi-hop path payments',
      'Anchor-based fiat/crypto bridging',
      'On-chain governance with weighted voting',
      'Tiered staking with fee rebates',
      'Cross-chain bridges (Ethereum, Solana, XRPL)',
      'ISO 20022 compliance support',
      'NACHA ACH integration',
      '0.00022 kWh per transaction energy efficiency',
    ],
  };
}

export { SHX_ASSET, STAKING_TIERS, ENERGY_PER_TX_KWH, TX_FINALITY_SECONDS, BASE_FEE_STROOPS, MAX_OPERATIONS_PER_TX };
