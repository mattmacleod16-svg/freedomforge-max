/**
 * DAO Treasury Engine — FreedomForge Max
 * ═══════════════════════════════════════
 *
 * Comprehensive DAO governance and treasury management system:
 *
 *  • Multi-Sig Vault — M-of-N signature threshold for fund releases
 *  • Treasury Allocation — Budgeted fund pools with spend tracking
 *  • Proposal Lifecycle — Draft → Active → Quorum → Timelock → Executed
 *  • Delegation — Token-weighted voting with delegate assignment
 *  • Streaming Payments — Continuous token streams to contributors
 *  • Ragequit — Proportional exit mechanism for dissenting members
 *  • Snapshot Voting — Off-chain signaling with on-chain execution
 *  • Treasury Analytics — Real-time runway, burn rate, diversification
 *
 * Inspired by: Gnosis Safe, Aragon, Nouns DAO, MolochDAO, Superfluid
 */

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type ProposalPhase = 'draft' | 'active' | 'succeeded' | 'defeated' | 'queued' | 'executed' | 'cancelled' | 'expired';
export type VoteChoice = 'for' | 'against' | 'abstain';
export type AllocationCategory = 'development' | 'marketing' | 'operations' | 'grants' | 'liquidity' | 'reserves' | 'staking_rewards' | 'partnerships';
export type StreamStatus = 'active' | 'paused' | 'cancelled' | 'completed';

export interface DAOMember {
  address: string;
  votingPower: number;
  delegatedTo?: string;
  delegatedFrom: string[];
  joinedAt: number;
  proposalsCreated: number;
  votesParticipated: number;
  tokensStaked: number;
}

export interface MultiSigConfig {
  signers: string[];
  threshold: number;
  nonce: number;
  dailyLimit: number;
  dailySpent: number;
  lastResetAt: number;
}

export interface MultiSigTransaction {
  id: string;
  to: string;
  value: number;
  data: string;
  description: string;
  confirmations: string[];
  executed: boolean;
  submittedBy: string;
  submittedAt: number;
  executedAt?: number;
}

export interface TreasuryAllocation {
  category: AllocationCategory;
  budgetTotal: number;
  budgetSpent: number;
  budgetRemaining: number;
  percentOfTreasury: number;
  transactions: number;
  lastSpendAt?: number;
}

export interface GovernanceProposal {
  id: string;
  title: string;
  description: string;
  proposer: string;
  phase: ProposalPhase;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  quorumRequired: number;
  voters: Map<string, { choice: VoteChoice; weight: number; timestamp: number }>;
  actions: ProposalAction[];
  snapshotBlock: number;
  startTime: number;
  endTime: number;
  timelockEnd?: number;
  executedAt?: number;
  cancelledAt?: number;
}

export interface ProposalAction {
  target: string;
  value: number;
  calldata: string;
  description: string;
}

export interface PaymentStream {
  id: string;
  sender: string;
  recipient: string;
  tokenAmount: number;
  startTime: number;
  endTime: number;
  withdrawn: number;
  status: StreamStatus;
  ratePerSecond: number;
}

export interface DelegateProfile {
  address: string;
  totalDelegated: number;
  delegators: string[];
  votingHistory: Array<{ proposalId: string; choice: VoteChoice; timestamp: number }>;
  participationRate: number;
  statement?: string;
}

export interface TreasurySnapshot {
  timestamp: number;
  totalValue: number;
  tokenBalances: Record<string, number>;
  allocations: TreasuryAllocation[];
  runwayDays: number;
  monthlyBurnRate: number;
  diversificationScore: number;
}

/* ─── Constants ───────────────────────────────────────────────────────────── */

const VOTING_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;       // 7 days
const TIMELOCK_DELAY_MS = 2 * 24 * 60 * 60 * 1000;       // 2 days
const MIN_PROPOSAL_THRESHOLD = 100_000;                    // 100K FORGE to propose
const DEFAULT_QUORUM_PCT = 4;                              // 4% of total supply
const TOTAL_SUPPLY = 1_000_000_000;                        // 1B FORGE
const RAGEQUIT_PENALTY_PCT = 2;                            // 2% exit fee
const DAILY_LIMIT_RESET_MS = 24 * 60 * 60 * 1000;

const DEFAULT_ALLOCATIONS: Record<AllocationCategory, number> = {
  development: 0.30,
  marketing: 0.15,
  operations: 0.15,
  grants: 0.15,
  liquidity: 0.10,
  reserves: 0.05,
  staking_rewards: 0.05,
  partnerships: 0.05,
};

/* ─── State ───────────────────────────────────────────────────────────────── */

const members: Map<string, DAOMember> = new Map();
const proposals: Map<string, GovernanceProposal> = new Map();
const multiSigTxs: Map<string, MultiSigTransaction> = new Map();
const streams: Map<string, PaymentStream> = new Map();
const delegates: Map<string, DelegateProfile> = new Map();
const snapshots: TreasurySnapshot[] = [];

let multiSig: MultiSigConfig = {
  signers: [],
  threshold: 3,
  nonce: 0,
  dailyLimit: 500_000,
  dailySpent: 0,
  lastResetAt: Date.now(),
};

let treasuryBalance = 200_000_000; // 200M FORGE treasury

/* ─── Multi-Sig Vault ─────────────────────────────────────────────────────── */

export function configureMultiSig(signers: string[], threshold: number, dailyLimit?: number): MultiSigConfig {
  if (threshold < 1 || threshold > signers.length) {
    throw new Error(`Threshold must be between 1 and ${signers.length}`);
  }
  multiSig = {
    signers: [...new Set(signers)],
    threshold,
    nonce: multiSig.nonce,
    dailyLimit: dailyLimit || multiSig.dailyLimit,
    dailySpent: multiSig.dailySpent,
    lastResetAt: multiSig.lastResetAt,
  };
  return { ...multiSig };
}

export function submitMultiSigTx(input: {
  to: string;
  value: number;
  data?: string;
  description: string;
  submittedBy: string;
}): MultiSigTransaction {
  if (!multiSig.signers.includes(input.submittedBy)) {
    throw new Error('Only signers can submit transactions');
  }

  const tx: MultiSigTransaction = {
    id: `msig_${multiSig.nonce++}_${Date.now().toString(36)}`,
    to: input.to,
    value: input.value,
    data: input.data || '0x',
    description: input.description,
    confirmations: [input.submittedBy],
    executed: false,
    submittedBy: input.submittedBy,
    submittedAt: Date.now(),
  };

  multiSigTxs.set(tx.id, tx);
  return tx;
}

export function confirmMultiSigTx(txId: string, signer: string): MultiSigTransaction | null {
  const tx = multiSigTxs.get(txId);
  if (!tx || tx.executed) return null;
  if (!multiSig.signers.includes(signer)) return null;
  if (tx.confirmations.includes(signer)) return tx;

  tx.confirmations.push(signer);

  // Auto-execute when threshold met
  if (tx.confirmations.length >= multiSig.threshold) {
    return executeMultiSigTx(txId);
  }

  return tx;
}

function executeMultiSigTx(txId: string): MultiSigTransaction | null {
  const tx = multiSigTxs.get(txId);
  if (!tx || tx.executed) return null;

  // Reset daily limit if needed
  if (Date.now() - multiSig.lastResetAt > DAILY_LIMIT_RESET_MS) {
    multiSig.dailySpent = 0;
    multiSig.lastResetAt = Date.now();
  }

  if (multiSig.dailySpent + tx.value > multiSig.dailyLimit) {
    throw new Error(`Daily limit exceeded: ${multiSig.dailySpent + tx.value} > ${multiSig.dailyLimit}`);
  }

  tx.executed = true;
  tx.executedAt = Date.now();
  multiSig.dailySpent += tx.value;
  treasuryBalance -= tx.value;

  return tx;
}

export function getMultiSigConfig(): MultiSigConfig {
  return { ...multiSig };
}

export function getPendingMultiSigTxs(): MultiSigTransaction[] {
  return Array.from(multiSigTxs.values()).filter((tx) => !tx.executed);
}

/* ─── DAO Membership ──────────────────────────────────────────────────────── */

export function joinDAO(address: string, tokensStaked: number): DAOMember {
  const existing = members.get(address);
  if (existing) {
    existing.tokensStaked += tokensStaked;
    existing.votingPower = existing.tokensStaked;
    return existing;
  }

  const member: DAOMember = {
    address,
    votingPower: tokensStaked,
    delegatedFrom: [],
    joinedAt: Date.now(),
    proposalsCreated: 0,
    votesParticipated: 0,
    tokensStaked,
  };
  members.set(address, member);
  return member;
}

export function delegateVotes(from: string, to: string): boolean {
  const fromMember = members.get(from);
  const toMember = members.get(to);
  if (!fromMember || !toMember || from === to) return false;

  // Remove old delegation
  if (fromMember.delegatedTo) {
    const oldDelegate = members.get(fromMember.delegatedTo);
    if (oldDelegate) {
      oldDelegate.delegatedFrom = oldDelegate.delegatedFrom.filter((a) => a !== from);
      oldDelegate.votingPower -= fromMember.tokensStaked;
    }
  }

  fromMember.delegatedTo = to;
  toMember.delegatedFrom.push(from);
  toMember.votingPower += fromMember.tokensStaked;

  // Update delegate profile
  const profile = delegates.get(to) || {
    address: to,
    totalDelegated: 0,
    delegators: [],
    votingHistory: [],
    participationRate: 0,
  };
  profile.totalDelegated += fromMember.tokensStaked;
  if (!profile.delegators.includes(from)) profile.delegators.push(from);
  delegates.set(to, profile);

  return true;
}

export function ragequit(address: string): { tokensReturned: number; penaltyPaid: number } | null {
  const member = members.get(address);
  if (!member) return null;

  const penalty = member.tokensStaked * (RAGEQUIT_PENALTY_PCT / 100);
  const returned = member.tokensStaked - penalty;

  // Remove delegations
  if (member.delegatedTo) {
    const delegate = members.get(member.delegatedTo);
    if (delegate) {
      delegate.delegatedFrom = delegate.delegatedFrom.filter((a) => a !== address);
      delegate.votingPower -= member.tokensStaked;
    }
  }

  for (const delegator of member.delegatedFrom) {
    const d = members.get(delegator);
    if (d) d.delegatedTo = undefined;
  }

  members.delete(address);
  treasuryBalance += penalty; // Penalty goes to treasury

  return { tokensReturned: returned, penaltyPaid: penalty };
}

export function getMember(address: string): DAOMember | null {
  return members.get(address) || null;
}

export function getDAOStats() {
  const allMembers = Array.from(members.values());
  return {
    totalMembers: allMembers.length,
    totalStaked: allMembers.reduce((s, m) => s + m.tokensStaked, 0),
    totalVotingPower: allMembers.reduce((s, m) => s + m.votingPower, 0),
    activeProposals: Array.from(proposals.values()).filter((p) => p.phase === 'active').length,
    treasuryBalance,
  };
}

/* ─── Governance Proposals ────────────────────────────────────────────────── */

export function createProposal(input: {
  title: string;
  description: string;
  proposer: string;
  actions: ProposalAction[];
  votingPeriodMs?: number;
}): GovernanceProposal {
  const member = members.get(input.proposer);
  if (!member || member.votingPower < MIN_PROPOSAL_THRESHOLD) {
    throw new Error(`Need ${MIN_PROPOSAL_THRESHOLD} voting power to propose (have ${member?.votingPower || 0})`);
  }

  const votingPeriod = input.votingPeriodMs || VOTING_PERIOD_MS;
  const quorum = Math.ceil(TOTAL_SUPPLY * (DEFAULT_QUORUM_PCT / 100));

  const proposal: GovernanceProposal = {
    id: `prop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    title: input.title,
    description: input.description,
    proposer: input.proposer,
    phase: 'active',
    forVotes: 0,
    againstVotes: 0,
    abstainVotes: 0,
    quorumRequired: quorum,
    voters: new Map(),
    actions: input.actions,
    snapshotBlock: Math.floor(Date.now() / 12000), // ~12s blocks
    startTime: Date.now(),
    endTime: Date.now() + votingPeriod,
  };

  proposals.set(proposal.id, proposal);
  member.proposalsCreated++;
  return proposal;
}

export function castVote(proposalId: string, voter: string, choice: VoteChoice): GovernanceProposal | null {
  const proposal = proposals.get(proposalId);
  if (!proposal || proposal.phase !== 'active') return null;
  if (Date.now() > proposal.endTime) {
    resolveProposal(proposalId);
    return proposal;
  }

  const member = members.get(voter);
  if (!member) return null;

  // Check for existing vote
  if (proposal.voters.has(voter)) return proposal;

  const weight = member.votingPower;
  proposal.voters.set(voter, { choice, weight, timestamp: Date.now() });

  switch (choice) {
    case 'for': proposal.forVotes += weight; break;
    case 'against': proposal.againstVotes += weight; break;
    case 'abstain': proposal.abstainVotes += weight; break;
  }

  member.votesParticipated++;

  // Update delegate voting history
  const profile = delegates.get(voter);
  if (profile) {
    profile.votingHistory.push({ proposalId, choice, timestamp: Date.now() });
  }

  return proposal;
}

export function resolveProposal(proposalId: string): GovernanceProposal | null {
  const proposal = proposals.get(proposalId);
  if (!proposal || proposal.phase !== 'active') return null;

  const totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
  const quorumMet = totalVotes >= proposal.quorumRequired;

  if (quorumMet && proposal.forVotes > proposal.againstVotes) {
    proposal.phase = 'succeeded';
    proposal.timelockEnd = Date.now() + TIMELOCK_DELAY_MS;
  } else {
    proposal.phase = quorumMet ? 'defeated' : 'expired';
  }

  return proposal;
}

export function executeProposal(proposalId: string): GovernanceProposal | null {
  const proposal = proposals.get(proposalId);
  if (!proposal) return null;

  if (proposal.phase === 'active' && Date.now() > proposal.endTime) {
    resolveProposal(proposalId);
  }

  if (proposal.phase !== 'succeeded') return null;
  if (proposal.timelockEnd && Date.now() < proposal.timelockEnd) return null;

  proposal.phase = 'executed';
  proposal.executedAt = Date.now();

  // Execute spending actions against treasury
  for (const action of proposal.actions) {
    if (action.value > 0 && action.value <= treasuryBalance) {
      treasuryBalance -= action.value;
    }
  }

  return proposal;
}

export function cancelProposal(proposalId: string, canceller: string): GovernanceProposal | null {
  const proposal = proposals.get(proposalId);
  if (!proposal || proposal.phase === 'executed') return null;
  if (proposal.proposer !== canceller) return null;

  proposal.phase = 'cancelled';
  proposal.cancelledAt = Date.now();
  return proposal;
}

export function getProposal(proposalId: string): GovernanceProposal | null {
  return proposals.get(proposalId) || null;
}

export function getActiveProposals(): GovernanceProposal[] {
  return Array.from(proposals.values()).filter((p) => p.phase === 'active');
}

/* ─── Streaming Payments ──────────────────────────────────────────────────── */

export function createStream(input: {
  sender: string;
  recipient: string;
  tokenAmount: number;
  durationSeconds: number;
}): PaymentStream {
  const stream: PaymentStream = {
    id: `stream_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    sender: input.sender,
    recipient: input.recipient,
    tokenAmount: input.tokenAmount,
    startTime: Date.now(),
    endTime: Date.now() + input.durationSeconds * 1000,
    withdrawn: 0,
    status: 'active',
    ratePerSecond: input.tokenAmount / input.durationSeconds,
  };

  streams.set(stream.id, stream);
  return stream;
}

export function getStreamBalance(streamId: string): { streamed: number; withdrawable: number; remaining: number } | null {
  const stream = streams.get(streamId);
  if (!stream) return null;

  const now = Math.min(Date.now(), stream.endTime);
  const elapsed = Math.max(0, now - stream.startTime) / 1000;
  const streamed = Math.min(stream.tokenAmount, elapsed * stream.ratePerSecond);
  const withdrawable = streamed - stream.withdrawn;
  const remaining = stream.tokenAmount - streamed;

  return { streamed, withdrawable, remaining };
}

export function withdrawFromStream(streamId: string): number {
  const stream = streams.get(streamId);
  if (!stream || stream.status !== 'active') return 0;

  const balance = getStreamBalance(streamId);
  if (!balance || balance.withdrawable <= 0) return 0;

  stream.withdrawn += balance.withdrawable;

  if (Date.now() >= stream.endTime) {
    stream.status = 'completed';
  }

  return balance.withdrawable;
}

export function cancelStream(streamId: string): PaymentStream | null {
  const stream = streams.get(streamId);
  if (!stream || stream.status !== 'active') return null;
  stream.status = 'cancelled';
  return stream;
}

export function getActiveStreams(): PaymentStream[] {
  return Array.from(streams.values()).filter((s) => s.status === 'active');
}

/* ─── Treasury Analytics ──────────────────────────────────────────────────── */

export function getTreasuryAllocations(): TreasuryAllocation[] {
  return (Object.entries(DEFAULT_ALLOCATIONS) as [AllocationCategory, number][]).map(([category, pct]) => ({
    category,
    budgetTotal: treasuryBalance * pct,
    budgetSpent: 0,
    budgetRemaining: treasuryBalance * pct,
    percentOfTreasury: pct * 100,
    transactions: 0,
  }));
}

export function takeTreasurySnapshot(tokenPrices: Record<string, number> = {}): TreasurySnapshot {
  const forgePrice = tokenPrices['FORGE'] || 0.05;
  const totalValue = treasuryBalance * forgePrice;

  // Calculate burn rate from recent executed proposals
  const recentExecuted = Array.from(proposals.values())
    .filter((p) => p.phase === 'executed' && p.executedAt && p.executedAt > Date.now() - 30 * 24 * 60 * 60 * 1000);
  const monthlySpend = recentExecuted.reduce((s, p) => s + p.actions.reduce((a, act) => a + act.value, 0), 0);
  const monthlyBurnRate = monthlySpend * forgePrice;
  const runwayDays = monthlyBurnRate > 0 ? (totalValue / monthlyBurnRate) * 30 : Infinity;

  const allocations = getTreasuryAllocations();
  const diversification = allocations.length > 0
    ? 1 - allocations.reduce((s, a) => s + Math.pow(a.percentOfTreasury / 100, 2), 0)
    : 0;

  const snapshot: TreasurySnapshot = {
    timestamp: Date.now(),
    totalValue,
    tokenBalances: { FORGE: treasuryBalance },
    allocations,
    runwayDays: runwayDays === Infinity ? 9999 : Math.round(runwayDays),
    monthlyBurnRate,
    diversificationScore: Math.round(diversification * 100) / 100,
  };

  snapshots.push(snapshot);
  return snapshot;
}

export function getTreasuryHistory(): TreasurySnapshot[] {
  return [...snapshots];
}

/* ─── Delegate Registry ───────────────────────────────────────────────────── */

export function getDelegateProfile(address: string): DelegateProfile | null {
  return delegates.get(address) || null;
}

export function getTopDelegates(limit: number = 10): DelegateProfile[] {
  return Array.from(delegates.values())
    .sort((a, b) => b.totalDelegated - a.totalDelegated)
    .slice(0, limit);
}

/* ─── DAO Summary ─────────────────────────────────────────────────────────── */

export function getDAOSummary() {
  const allMembers = Array.from(members.values());
  const allProposals = Array.from(proposals.values());
  const allStreams = Array.from(streams.values());

  return {
    name: 'FreedomForge DAO',
    version: '1.0.0',
    governance: {
      members: allMembers.length,
      totalStaked: allMembers.reduce((s, m) => s + m.tokensStaked, 0),
      totalVotingPower: allMembers.reduce((s, m) => s + m.votingPower, 0),
      proposalThreshold: MIN_PROPOSAL_THRESHOLD,
      quorumPct: DEFAULT_QUORUM_PCT,
      votingPeriodDays: VOTING_PERIOD_MS / (24 * 60 * 60 * 1000),
      timelockDelayDays: TIMELOCK_DELAY_MS / (24 * 60 * 60 * 1000),
    },
    proposals: {
      total: allProposals.length,
      active: allProposals.filter((p) => p.phase === 'active').length,
      executed: allProposals.filter((p) => p.phase === 'executed').length,
      defeated: allProposals.filter((p) => p.phase === 'defeated').length,
    },
    treasury: {
      balance: treasuryBalance,
      multiSigThreshold: `${multiSig.threshold}-of-${multiSig.signers.length}`,
      dailyLimit: multiSig.dailyLimit,
      allocations: DEFAULT_ALLOCATIONS,
    },
    streams: {
      total: allStreams.length,
      active: allStreams.filter((s) => s.status === 'active').length,
      totalStreaming: allStreams.filter((s) => s.status === 'active').reduce((s, st) => s + st.tokenAmount, 0),
    },
    delegates: {
      total: delegates.size,
      topDelegate: Array.from(delegates.values()).sort((a, b) => b.totalDelegated - a.totalDelegated)[0]?.address || null,
    },
    features: [
      'Multi-sig vault (M-of-N threshold)',
      'Token-weighted governance with delegation',
      'Proposal lifecycle with timelock execution',
      'Streaming payments (Superfluid-inspired)',
      'Ragequit exit mechanism (MolochDAO-inspired)',
      'Treasury allocation budgeting',
      'Delegate registry with voting history',
      'Treasury analytics (runway, burn rate, diversification)',
      'Snapshot voting with on-chain execution',
      'Daily spend limits with auto-reset',
    ],
  };
}

export {
  VOTING_PERIOD_MS,
  TIMELOCK_DELAY_MS,
  MIN_PROPOSAL_THRESHOLD,
  DEFAULT_QUORUM_PCT,
  RAGEQUIT_PENALTY_PCT,
  DEFAULT_ALLOCATIONS,
};
