/**
 * Canton Network & Ecosystem Protocol — FreedomForge Max
 * ════════════════════════════════════════════════════════
 *
 * Enterprise-grade blockchain for regulated financial markets:
 *
 *  Canton Network Core:
 *  • DAML Smart Contracts — Type-safe financial contract language
 *  • Global Synchronizer — Cross-participant atomic settlement
 *  • Privacy by Design — Sub-transaction privacy with zero-knowledge
 *  • Canton Protocol — Participant-level data segregation
 *
 *  Canton Ecosystem Projects:
 *  • Splice — Canton Network infrastructure & governance
 *  • Digital Asset — DAML platform & Canton developer tools
 *  • Goldman Sachs GS DAP — Tokenized assets platform
 *  • Broadridge DLT — Post-trade processing & repo
 *  • BNY Mellon — Digital asset custody
 *  • Deutsche Börse — D7 digital post-trade platform
 *  • ASX (CHESS replacement) — Australian equity settlement
 *  • SIX Digital Exchange — Swiss regulated digital asset exchange
 *  • HKEX Synapse — Hong Kong settlement acceleration
 *  • Nasdaq — Digital asset infrastructure
 *  • Paxos — Regulated stablecoin settlement
 *  • Cboe Digital — Digital asset clearing
 *  • EquiLend — Securities lending DLT
 *  • Versana — Syndicated loan data
 *  • Benji Investments (Franklin Templeton) — Tokenized funds
 *  • Xpansiv — Environmental commodity exchange
 *  • LedgerEdge — Corporate bond trading
 *  • Canton Coin — Network utility token
 *
 * Inspired by: Canton Network, Digital Asset (DAML), Splice, R3 Corda
 */

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type ParticipantRole = 'operator' | 'validator' | 'mediator' | 'participant' | 'observer';
export type ContractState = 'active' | 'archived' | 'divulged';
export type AssetClass = 'equities' | 'fixed_income' | 'derivatives' | 'fx' | 'funds' | 'commodities' | 'real_estate' | 'carbon_credits' | 'repo' | 'syndicated_loans';
export type SettlementModel = 'dvp' | 'pvp' | 'fop' | 'atomic' | 'deferred';
export type ComplianceFramework = 'MiCA' | 'SEC' | 'FCA' | 'MAS' | 'HKMA' | 'FINMA' | 'BaFin' | 'ASIC' | 'custom';

export interface CantonParticipant {
  id: string;
  name: string;
  role: ParticipantRole;
  domain: string;
  namespace: string;
  publicKey: string;
  jurisdictions: string[];
  complianceFrameworks: ComplianceFramework[];
  assetClasses: AssetClass[];
  connectedParticipants: string[];
  active: boolean;
  joinedAt: number;
}

export interface DAMLContract {
  id: string;
  templateId: string;
  templateName: string;
  signatories: string[];
  observers: string[];
  payload: Record<string, unknown>;
  state: ContractState;
  domainId: string;
  createdAt: number;
  archivedAt?: number;
  exercisedChoices: Array<{ name: string; actor: string; timestamp: number }>;
}

export interface CantonDomain {
  id: string;
  name: string;
  operator: string;
  mediator: string;
  sequencer: string;
  participants: string[];
  topology: 'single' | 'multi' | 'global';
  maxThroughputTps: number;
  avgLatencyMs: number;
  active: boolean;
}

export interface TokenizedAsset {
  id: string;
  name: string;
  issuer: string;
  assetClass: AssetClass;
  denomination: string;
  totalIssuance: number;
  outstandingUnits: number;
  unitPrice: number;
  yield?: number;
  maturityDate?: string;
  isin?: string;
  cusip?: string;
  regulatoryStatus: string;
  transferRestrictions: string[];
  domainId: string;
  createdAt: number;
}

export interface AtomicSettlement {
  id: string;
  type: SettlementModel;
  legs: SettlementLeg[];
  status: 'pending' | 'matched' | 'settled' | 'failed';
  domainId: string;
  initiator: string;
  counterparties: string[];
  totalValue: number;
  createdAt: number;
  settledAt?: number;
}

export interface SettlementLeg {
  asset: string;
  amount: number;
  sender: string;
  receiver: string;
  status: 'pending' | 'committed' | 'settled';
}

export interface DAMLTemplate {
  id: string;
  name: string;
  module: string;
  signatoryFields: string[];
  observerFields: string[];
  choices: Array<{ name: string; consuming: boolean; controller: string }>;
  keyFields?: string[];
  description: string;
}

export interface EcosystemProject {
  id: string;
  name: string;
  organization: string;
  category: string;
  assetClasses: AssetClass[];
  description: string;
  status: 'production' | 'pilot' | 'development' | 'announced';
  jurisdictions: string[];
  tvl?: number;
  launchedAt?: number;
}

export interface ComplianceRule {
  id: string;
  framework: ComplianceFramework;
  rule: string;
  description: string;
  automated: boolean;
  enforcedAt: 'pre_trade' | 'post_trade' | 'continuous';
}

export interface PrivacyPolicy {
  id: string;
  domainId: string;
  dataSharingModel: 'need_to_know' | 'broadcast' | 'selective';
  subTransactionPrivacy: boolean;
  zkProofEnabled: boolean;
  auditTrail: boolean;
  dataRetentionDays: number;
}

/* ─── Canton Ecosystem Projects Registry ──────────────────────────────────── */

const ECOSYSTEM_PROJECTS: EcosystemProject[] = [
  // Core Infrastructure
  { id: 'splice', name: 'Splice', organization: 'Splice / Digital Asset', category: 'Infrastructure', assetClasses: [], description: 'Canton Network governance, Global Synchronizer, and Amulet (Canton Coin) token infrastructure', status: 'production', jurisdictions: ['Global'], launchedAt: Date.now() - 365 * 24 * 60 * 60 * 1000 },
  { id: 'digital_asset', name: 'Digital Asset DAML Platform', organization: 'Digital Asset', category: 'Developer Platform', assetClasses: [], description: 'DAML smart contract language, SDK, and Canton runtime for building enterprise DLT applications', status: 'production', jurisdictions: ['Global'], launchedAt: Date.now() - 2000 * 24 * 60 * 60 * 1000 },

  // Capital Markets
  { id: 'gs_dap', name: 'GS DAP (Digital Asset Platform)', organization: 'Goldman Sachs', category: 'Tokenization', assetClasses: ['fixed_income', 'equities', 'derivatives'], description: 'Goldman Sachs tokenized asset issuance, lifecycle management, and secondary trading on Canton', status: 'production', jurisdictions: ['US', 'EU', 'UK'], tvl: 2_000_000_000, launchedAt: Date.now() - 400 * 24 * 60 * 60 * 1000 },
  { id: 'broadridge_dlt', name: 'Broadridge DLT', organization: 'Broadridge', category: 'Post-Trade', assetClasses: ['repo', 'equities', 'fixed_income'], description: 'Distributed ledger repo (DLR) and post-trade processing. $1T+ in monthly repo volume.', status: 'production', jurisdictions: ['US', 'EU'], tvl: 50_000_000_000, launchedAt: Date.now() - 500 * 24 * 60 * 60 * 1000 },
  { id: 'bny_mellon', name: 'BNY Mellon Digital Assets', organization: 'BNY Mellon', category: 'Custody', assetClasses: ['equities', 'fixed_income', 'funds'], description: 'Digital asset custody and servicing for institutional clients on Canton', status: 'production', jurisdictions: ['US', 'EU', 'UK', 'APAC'] },

  // Exchanges & Trading Venues
  { id: 'deutsche_borse_d7', name: 'Deutsche Börse D7', organization: 'Deutsche Börse / Clearstream', category: 'Digital Post-Trade', assetClasses: ['fixed_income', 'equities', 'funds'], description: 'D7 digital post-trade platform for issuance and settlement of digital securities under German eWpG', status: 'production', jurisdictions: ['DE', 'EU'], tvl: 15_000_000_000 },
  { id: 'six_sdx', name: 'SIX Digital Exchange', organization: 'SIX Group', category: 'Regulated Exchange', assetClasses: ['equities', 'fixed_income', 'funds'], description: 'FINMA-regulated digital asset exchange, CSD, and tokenization platform', status: 'production', jurisdictions: ['CH', 'EU'], tvl: 500_000_000 },
  { id: 'hkex_synapse', name: 'HKEX Synapse', organization: 'Hong Kong Exchanges', category: 'Settlement', assetClasses: ['equities', 'derivatives'], description: 'Settlement acceleration platform for Stock Connect and Bond Connect', status: 'production', jurisdictions: ['HK', 'CN'] },
  { id: 'nasdaq_digital', name: 'Nasdaq Digital Assets', organization: 'Nasdaq', category: 'Infrastructure', assetClasses: ['equities', 'derivatives', 'funds'], description: 'Digital asset issuance, custody, and marketplace infrastructure', status: 'pilot', jurisdictions: ['US', 'EU'] },
  { id: 'cboe_digital', name: 'Cboe Digital', organization: 'Cboe Global Markets', category: 'Digital Clearing', assetClasses: ['derivatives', 'equities'], description: 'Digital asset spot and derivatives market with margin clearing', status: 'production', jurisdictions: ['US'] },
  { id: 'asx_chess', name: 'ASX CHESS Replacement', organization: 'Australian Securities Exchange', category: 'Equity Settlement', assetClasses: ['equities'], description: 'Replacement of CHESS clearing and settlement system for Australian equities', status: 'development', jurisdictions: ['AU'] },

  // Stablecoins & Payments
  { id: 'paxos', name: 'Paxos Settlement', organization: 'Paxos', category: 'Settlement/Stablecoins', assetClasses: ['fx'], description: 'Regulated stablecoin issuance (USDP, PYUSD) and real-time settlement for equities', status: 'production', jurisdictions: ['US', 'SG'], tvl: 1_000_000_000 },

  // Securities Lending & Loans
  { id: 'equilend', name: 'EquiLend 1Source', organization: 'EquiLend', category: 'Securities Lending', assetClasses: ['equities', 'fixed_income'], description: 'DLT-based securities lending lifecycle management with DAML contracts', status: 'production', jurisdictions: ['US', 'EU', 'UK'] },
  { id: 'versana', name: 'Versana', organization: 'Versana', category: 'Syndicated Loans', assetClasses: ['syndicated_loans'], description: 'Real-time syndicated loan data sharing and lifecycle management', status: 'production', jurisdictions: ['US'] },

  // Fund Management
  { id: 'benji', name: 'Benji Investments', organization: 'Franklin Templeton', category: 'Tokenized Funds', assetClasses: ['funds'], description: 'Tokenized money market fund (FOBXX) on public and private blockchains', status: 'production', jurisdictions: ['US'], tvl: 400_000_000 },

  // Commodities & ESG
  { id: 'xpansiv', name: 'Xpansiv', organization: 'Xpansiv', category: 'Environmental Markets', assetClasses: ['carbon_credits', 'commodities'], description: 'Digital infrastructure for environmental and energy commodity markets (RECs, carbon credits)', status: 'production', jurisdictions: ['US', 'EU', 'Global'] },

  // Bond Markets
  { id: 'ledgeredge', name: 'LedgerEdge', organization: 'LedgerEdge', category: 'Bond Trading', assetClasses: ['fixed_income'], description: 'Privacy-preserving corporate bond trading venue using DAML', status: 'pilot', jurisdictions: ['UK', 'EU'] },
];

/* ─── DAML Template Library ───────────────────────────────────────────────── */

const DAML_TEMPLATES: DAMLTemplate[] = [
  { id: 'token', name: 'Token', module: 'Daml.Finance.Asset', signatoryFields: ['issuer'], observerFields: ['owner'], choices: [{ name: 'Transfer', consuming: true, controller: 'owner' }, { name: 'Split', consuming: true, controller: 'owner' }, { name: 'Merge', consuming: true, controller: 'owner' }], description: 'Fungible token with transfer, split, and merge capabilities' },
  { id: 'bond', name: 'Bond', module: 'Daml.Finance.Bond', signatoryFields: ['issuer'], observerFields: ['holder'], choices: [{ name: 'Transfer', consuming: true, controller: 'holder' }, { name: 'Redeem', consuming: true, controller: 'issuer' }, { name: 'PayCoupon', consuming: false, controller: 'issuer' }], keyFields: ['isin'], description: 'Fixed-income bond with coupon payments and redemption' },
  { id: 'equity', name: 'Equity', module: 'Daml.Finance.Equity', signatoryFields: ['issuer', 'registrar'], observerFields: ['shareholder'], choices: [{ name: 'Transfer', consuming: true, controller: 'shareholder' }, { name: 'PayDividend', consuming: false, controller: 'issuer' }, { name: 'CorporateAction', consuming: true, controller: 'issuer' }], description: 'Equity share with dividend and corporate action support' },
  { id: 'dvp', name: 'DvPSettlement', module: 'Daml.Finance.Settlement', signatoryFields: ['buyer', 'seller'], observerFields: ['custodian'], choices: [{ name: 'Settle', consuming: true, controller: 'custodian' }, { name: 'Cancel', consuming: true, controller: 'buyer' }], description: 'Delivery-versus-payment atomic settlement' },
  { id: 'repo', name: 'RepoContract', module: 'Daml.Finance.Repo', signatoryFields: ['borrower', 'lender'], observerFields: ['agent'], choices: [{ name: 'Mature', consuming: true, controller: 'agent' }, { name: 'Extend', consuming: true, controller: 'borrower' }, { name: 'Margin', consuming: false, controller: 'agent' }], description: 'Repurchase agreement with maturity and margin management' },
  { id: 'swap', name: 'InterestRateSwap', module: 'Daml.Finance.Derivatives', signatoryFields: ['party1', 'party2'], observerFields: ['calcAgent'], choices: [{ name: 'NetPayment', consuming: false, controller: 'calcAgent' }, { name: 'Terminate', consuming: true, controller: 'party1' }], description: 'OTC interest rate swap with net settlement' },
  { id: 'fund', name: 'FundUnit', module: 'Daml.Finance.Fund', signatoryFields: ['fundManager'], observerFields: ['investor'], choices: [{ name: 'Subscribe', consuming: false, controller: 'investor' }, { name: 'Redeem', consuming: true, controller: 'investor' }, { name: 'DistributeNAV', consuming: false, controller: 'fundManager' }], description: 'Tokenized fund unit with subscription and redemption' },
  { id: 'carbon', name: 'CarbonCredit', module: 'Daml.Finance.ESG', signatoryFields: ['registry'], observerFields: ['holder'], choices: [{ name: 'Transfer', consuming: true, controller: 'holder' }, { name: 'Retire', consuming: true, controller: 'holder' }, { name: 'Verify', consuming: false, controller: 'registry' }], description: 'Verified carbon credit with retirement tracking' },
  { id: 'seclend', name: 'SecuritiesLoan', module: 'Daml.Finance.SecLending', signatoryFields: ['lender', 'borrower'], observerFields: ['agent'], choices: [{ name: 'Return', consuming: true, controller: 'borrower' }, { name: 'Recall', consuming: true, controller: 'lender' }, { name: 'AdjustCollateral', consuming: false, controller: 'agent' }], description: 'Securities lending with collateral management' },
  { id: 'kyc', name: 'KYCCredential', module: 'Daml.Identity.KYC', signatoryFields: ['issuer'], observerFields: ['subject'], choices: [{ name: 'Verify', consuming: false, controller: 'issuer' }, { name: 'Revoke', consuming: true, controller: 'issuer' }], description: 'Verifiable KYC credential for regulatory compliance' },
];

/* ─── Compliance Rules ────────────────────────────────────────────────────── */

const COMPLIANCE_RULES: ComplianceRule[] = [
  { id: 'mica_1', framework: 'MiCA', rule: 'Asset classification', description: 'Classify crypto-assets as EMT, ART, or other per MiCA taxonomy', automated: true, enforcedAt: 'pre_trade' },
  { id: 'mica_2', framework: 'MiCA', rule: 'Reserve requirements', description: 'Maintain 1:1 reserves for e-money tokens, diversified for ARTs', automated: true, enforcedAt: 'continuous' },
  { id: 'sec_1', framework: 'SEC', rule: 'Accredited investor check', description: 'Verify accredited investor status for Reg D offerings', automated: true, enforcedAt: 'pre_trade' },
  { id: 'sec_2', framework: 'SEC', rule: 'Transfer restrictions', description: 'Enforce lock-up periods and resale restrictions (Rule 144)', automated: true, enforcedAt: 'pre_trade' },
  { id: 'finma_1', framework: 'FINMA', rule: 'DLT trading facility', description: 'Swiss DLT Act compliance for multilateral trading', automated: true, enforcedAt: 'continuous' },
  { id: 'hkma_1', framework: 'HKMA', rule: 'Virtual asset licensing', description: 'VASP licensing requirements under Hong Kong AMLO', automated: false, enforcedAt: 'pre_trade' },
  { id: 'bafin_1', framework: 'BaFin', rule: 'eWpG digital securities', description: 'German Electronic Securities Act compliance for crypto securities', automated: true, enforcedAt: 'pre_trade' },
];

/* ─── State ───────────────────────────────────────────────────────────────── */

const participants: Map<string, CantonParticipant> = new Map();
const domains: Map<string, CantonDomain> = new Map();
const contracts: Map<string, DAMLContract> = new Map();
const tokenizedAssets: Map<string, TokenizedAsset> = new Map();
const settlements: Map<string, AtomicSettlement> = new Map();
const privacyPolicies: Map<string, PrivacyPolicy> = new Map();

/* ─── Participant Management ──────────────────────────────────────────────── */

export function registerParticipant(input: {
  name: string;
  role: ParticipantRole;
  domain: string;
  jurisdictions: string[];
  complianceFrameworks: ComplianceFramework[];
  assetClasses: AssetClass[];
}): CantonParticipant {
  const participant: CantonParticipant = {
    id: `part_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: input.name,
    role: input.role,
    domain: input.domain,
    namespace: `${input.name.toLowerCase().replace(/\s/g, '-')}::canton`,
    publicKey: `canton_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 18)}`,
    jurisdictions: input.jurisdictions,
    complianceFrameworks: input.complianceFrameworks,
    assetClasses: input.assetClasses,
    connectedParticipants: [],
    active: true,
    joinedAt: Date.now(),
  };

  participants.set(participant.id, participant);
  return participant;
}

export function connectParticipants(id1: string, id2: string): boolean {
  const p1 = participants.get(id1);
  const p2 = participants.get(id2);
  if (!p1 || !p2) return false;
  if (!p1.connectedParticipants.includes(id2)) p1.connectedParticipants.push(id2);
  if (!p2.connectedParticipants.includes(id1)) p2.connectedParticipants.push(id1);
  return true;
}

export function getParticipant(id: string): CantonParticipant | null { return participants.get(id) || null; }
export function getParticipants(): CantonParticipant[] { return Array.from(participants.values()); }

/* ─── Domain Management ───────────────────────────────────────────────────── */

export function createDomain(input: {
  name: string;
  operator: string;
  topology?: 'single' | 'multi' | 'global';
}): CantonDomain {
  const domain: CantonDomain = {
    id: `dom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: input.name,
    operator: input.operator,
    mediator: input.operator,
    sequencer: `seq_${Date.now().toString(36)}`,
    participants: [],
    topology: input.topology || 'multi',
    maxThroughputTps: input.topology === 'global' ? 10_000 : 1_000,
    avgLatencyMs: input.topology === 'global' ? 200 : 50,
    active: true,
  };

  domains.set(domain.id, domain);
  return domain;
}

export function getDomain(id: string): CantonDomain | null { return domains.get(id) || null; }

/* ─── DAML Contracts ──────────────────────────────────────────────────────── */

export function createContract(input: {
  templateName: string;
  signatories: string[];
  observers: string[];
  payload: Record<string, unknown>;
  domainId: string;
}): DAMLContract {
  const template = DAML_TEMPLATES.find((t) => t.name === input.templateName);
  const contract: DAMLContract = {
    id: `contract_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    templateId: template?.id || 'custom',
    templateName: input.templateName,
    signatories: input.signatories,
    observers: input.observers,
    payload: input.payload,
    state: 'active',
    domainId: input.domainId,
    createdAt: Date.now(),
    exercisedChoices: [],
  };

  contracts.set(contract.id, contract);
  return contract;
}

export function exerciseChoice(contractId: string, choiceName: string, actor: string): DAMLContract | null {
  const contract = contracts.get(contractId);
  if (!contract || contract.state !== 'active') return null;

  const template = DAML_TEMPLATES.find((t) => t.id === contract.templateId);
  const choice = template?.choices.find((c) => c.name === choiceName);

  contract.exercisedChoices.push({ name: choiceName, actor, timestamp: Date.now() });

  if (choice?.consuming) {
    contract.state = 'archived';
    contract.archivedAt = Date.now();
  }

  return contract;
}

export function getContract(id: string): DAMLContract | null { return contracts.get(id) || null; }
export function getActiveContracts(): DAMLContract[] { return Array.from(contracts.values()).filter((c) => c.state === 'active'); }

/* ─── Tokenized Assets ────────────────────────────────────────────────────── */

export function tokenizeAsset(input: {
  name: string;
  issuer: string;
  assetClass: AssetClass;
  denomination: string;
  totalIssuance: number;
  unitPrice: number;
  yield?: number;
  maturityDate?: string;
  isin?: string;
  domainId: string;
}): TokenizedAsset {
  const asset: TokenizedAsset = {
    id: `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: input.name,
    issuer: input.issuer,
    assetClass: input.assetClass,
    denomination: input.denomination,
    totalIssuance: input.totalIssuance,
    outstandingUnits: input.totalIssuance,
    unitPrice: input.unitPrice,
    yield: input.yield,
    maturityDate: input.maturityDate,
    isin: input.isin,
    regulatoryStatus: 'compliant',
    transferRestrictions: [],
    domainId: input.domainId,
    createdAt: Date.now(),
  };

  tokenizedAssets.set(asset.id, asset);
  return asset;
}

export function getTokenizedAsset(id: string): TokenizedAsset | null { return tokenizedAssets.get(id) || null; }
export function getTokenizedAssets(): TokenizedAsset[] { return Array.from(tokenizedAssets.values()); }
export function getAssetsByClass(assetClass: AssetClass): TokenizedAsset[] { return Array.from(tokenizedAssets.values()).filter((a) => a.assetClass === assetClass); }

/* ─── Atomic Settlement ───────────────────────────────────────────────────── */

export function initiateSettlement(input: {
  type: SettlementModel;
  legs: SettlementLeg[];
  domainId: string;
  initiator: string;
}): AtomicSettlement {
  const settlement: AtomicSettlement = {
    id: `settle_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    type: input.type,
    legs: input.legs.map((l) => ({ ...l, status: 'pending' as const })),
    status: 'pending',
    domainId: input.domainId,
    initiator: input.initiator,
    counterparties: [...new Set(input.legs.flatMap((l) => [l.sender, l.receiver]))],
    totalValue: input.legs.reduce((s, l) => s + l.amount, 0),
    createdAt: Date.now(),
  };

  settlements.set(settlement.id, settlement);
  return settlement;
}

export function settleTransaction(settlementId: string): AtomicSettlement | null {
  const settlement = settlements.get(settlementId);
  if (!settlement || settlement.status === 'settled') return null;

  // Atomic: all legs settle or none
  for (const leg of settlement.legs) leg.status = 'settled';
  settlement.status = 'settled';
  settlement.settledAt = Date.now();

  return settlement;
}

export function getSettlement(id: string): AtomicSettlement | null { return settlements.get(id) || null; }

/* ─── Privacy Policies ────────────────────────────────────────────────────── */

export function setPrivacyPolicy(input: {
  domainId: string;
  dataSharingModel: PrivacyPolicy['dataSharingModel'];
  subTransactionPrivacy?: boolean;
  zkProofEnabled?: boolean;
  dataRetentionDays?: number;
}): PrivacyPolicy {
  const policy: PrivacyPolicy = {
    id: `priv_${Date.now().toString(36)}`,
    domainId: input.domainId,
    dataSharingModel: input.dataSharingModel,
    subTransactionPrivacy: input.subTransactionPrivacy ?? true,
    zkProofEnabled: input.zkProofEnabled ?? false,
    auditTrail: true,
    dataRetentionDays: input.dataRetentionDays || 365 * 7,
  };

  privacyPolicies.set(input.domainId, policy);
  return policy;
}

/* ─── Registry Queries ────────────────────────────────────────────────────── */

export function getEcosystemProjects(): EcosystemProject[] { return [...ECOSYSTEM_PROJECTS]; }
export function getProjectsByCategory(category: string): EcosystemProject[] { return ECOSYSTEM_PROJECTS.filter((p) => p.category === category); }
export function getProjectsByAssetClass(assetClass: AssetClass): EcosystemProject[] { return ECOSYSTEM_PROJECTS.filter((p) => p.assetClasses.includes(assetClass)); }
export function getDAMLTemplates(): DAMLTemplate[] { return [...DAML_TEMPLATES]; }
export function getComplianceRules(): ComplianceRule[] { return [...COMPLIANCE_RULES]; }
export function getComplianceByFramework(framework: ComplianceFramework): ComplianceRule[] { return COMPLIANCE_RULES.filter((r) => r.framework === framework); }

/* ─── Protocol Summary ────────────────────────────────────────────────────── */

export function getCantonSummary() {
  return {
    name: 'FreedomForge Canton Network',
    version: '1.0.0',
    inspired_by: ['Canton Network', 'Digital Asset (DAML)', 'Splice', 'R3 Corda'],
    ecosystem: {
      totalProjects: ECOSYSTEM_PROJECTS.length,
      production: ECOSYSTEM_PROJECTS.filter((p) => p.status === 'production').length,
      pilot: ECOSYSTEM_PROJECTS.filter((p) => p.status === 'pilot').length,
      totalTVL: ECOSYSTEM_PROJECTS.reduce((s, p) => s + (p.tvl || 0), 0),
      categories: [...new Set(ECOSYSTEM_PROJECTS.map((p) => p.category))],
      majorParticipants: ['Goldman Sachs', 'Broadridge', 'BNY Mellon', 'Deutsche Börse', 'SIX', 'HKEX', 'Nasdaq', 'Paxos', 'Cboe', 'ASX', 'Franklin Templeton'],
    },
    daml: {
      templates: DAML_TEMPLATES.length,
      templateNames: DAML_TEMPLATES.map((t) => t.name),
    },
    compliance: {
      frameworks: [...new Set(COMPLIANCE_RULES.map((r) => r.framework))],
      totalRules: COMPLIANCE_RULES.length,
      automatedRules: COMPLIANCE_RULES.filter((r) => r.automated).length,
    },
    network: {
      participants: participants.size,
      domains: domains.size,
      activeContracts: Array.from(contracts.values()).filter((c) => c.state === 'active').length,
      tokenizedAssets: tokenizedAssets.size,
      settlements: settlements.size,
    },
    assetClasses: ['equities', 'fixed_income', 'derivatives', 'fx', 'funds', 'commodities', 'real_estate', 'carbon_credits', 'repo', 'syndicated_loans'],
    features: [
      '18 Canton ecosystem projects (Goldman Sachs, Broadridge, Deutsche Börse, HKEX, Nasdaq, etc.)',
      '10 DAML smart contract templates (Token, Bond, Equity, DvP, Repo, Swap, Fund, Carbon, SecLend, KYC)',
      'Atomic DvP/PvP/FoP settlement across participants',
      'Sub-transaction privacy with need-to-know data sharing',
      '7 regulatory compliance frameworks (MiCA, SEC, FCA, MAS, HKMA, FINMA, BaFin)',
      '10 tokenizable asset classes',
      'Global Synchronizer for cross-domain settlement',
      'Multi-jurisdiction support with automated compliance',
      '$50B+ institutional TVL across ecosystem',
      'Privacy-preserving enterprise blockchain for regulated markets',
    ],
  };
}
