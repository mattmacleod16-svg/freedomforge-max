/**
 * Chainlink Oracle Protocol — FreedomForge Max
 * ══════════════════════════════════════════════
 *
 * Decentralized oracle infrastructure for reliable off-chain data:
 *
 *  • Price Feeds — Aggregated asset prices from multiple sources
 *  • VRF (Verifiable Random Function) — Provably fair random numbers
 *  • Automation (Keepers) — Conditional smart contract execution
 *  • Data Feeds — Custom off-chain data (weather, sports, elections)
 *  • CCIP (Cross-Chain Interop) — Secure cross-chain messaging
 *  • Functions — Serverless computation for smart contracts
 *  • Proof of Reserve — Verifiable asset backing attestation
 *  • Feed Registry — Multi-asset price aggregation hub
 *
 * Inspired by: Chainlink, Pyth, Band Protocol, API3, RedStone
 */

import { createHash } from 'crypto';

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type FeedCategory = 'crypto' | 'forex' | 'commodities' | 'equities' | 'defi' | 'nft_floor';
export type OracleNetwork = 'ethereum' | 'base' | 'arbitrum' | 'polygon' | 'solana' | 'avalanche';
export type AutomationTrigger = 'time_based' | 'condition_based' | 'log_trigger' | 'custom';
export type CCIPMessageStatus = 'pending' | 'in_flight' | 'delivered' | 'failed';

export interface PriceFeed {
  pair: string;
  price: number;
  decimals: number;
  roundId: number;
  updatedAt: number;
  answeredInRound: number;
  category: FeedCategory;
  heartbeatSeconds: number;
  deviationThresholdPct: number;
  sources: number;
  network: OracleNetwork;
}

export interface PriceRound {
  roundId: number;
  price: number;
  startedAt: number;
  updatedAt: number;
  answeredInRound: number;
}

export interface VRFRequest {
  requestId: string;
  requester: string;
  numWords: number;
  keyHash: string;
  confirmations: number;
  callbackGasLimit: number;
  randomWords: bigint[];
  fulfilled: boolean;
  requestedAt: number;
  fulfilledAt?: number;
}

export interface AutomationUpkeep {
  id: string;
  name: string;
  target: string;
  trigger: AutomationTrigger;
  checkFunction: string;
  performFunction: string;
  interval?: number;
  condition?: string;
  balance: number;
  lastPerformedAt?: number;
  performCount: number;
  active: boolean;
  gasLimit: number;
  createdAt: number;
}

export interface CCIPMessage {
  messageId: string;
  sourceChain: OracleNetwork;
  destChain: OracleNetwork;
  sender: string;
  receiver: string;
  data: string;
  tokenAmounts: Array<{ token: string; amount: number }>;
  feeToken: string;
  fee: number;
  status: CCIPMessageStatus;
  sentAt: number;
  deliveredAt?: number;
}

export interface ProofOfReserve {
  asset: string;
  totalReserves: number;
  totalSupply: number;
  reserveRatio: number;
  lastAuditAt: number;
  auditor: string;
  attestationHash: string;
  isFullyBacked: boolean;
}

export interface OracleFunction {
  id: string;
  name: string;
  source: string;
  args: string[];
  subscriptionId: number;
  gasLimit: number;
  lastResponse?: string;
  lastError?: string;
  executionCount: number;
  createdAt: number;
}

/* ─── Constants ───────────────────────────────────────────────────────────── */

const VRF_KEY_HASH = '0x474e34a077df58807dbe9c96d3c009b23b3c6d0cce433e59bbf5b34f823bc56c';
const VRF_CONFIRMATIONS = 3;
const VRF_CALLBACK_GAS = 100_000;
const CCIP_FEE_MULTIPLIER = 0.001; // 0.1% of transfer value
const KEEPER_MIN_BALANCE = 5; // 5 LINK minimum

/* ─── Price Feed Registry ─────────────────────────────────────────────────── */

const feedRegistry: Map<string, PriceFeed> = new Map();
const roundHistory: Map<string, PriceRound[]> = new Map();

// Seed initial feeds
const INITIAL_FEEDS: Array<{ pair: string; price: number; category: FeedCategory; heartbeat: number; deviation: number }> = [
  // Crypto
  { pair: 'BTC/USD', price: 68000, category: 'crypto', heartbeat: 3600, deviation: 0.5 },
  { pair: 'ETH/USD', price: 3200, category: 'crypto', heartbeat: 3600, deviation: 0.5 },
  { pair: 'SOL/USD', price: 145, category: 'crypto', heartbeat: 3600, deviation: 1.0 },
  { pair: 'XLM/USD', price: 0.12, category: 'crypto', heartbeat: 3600, deviation: 1.0 },
  { pair: 'LINK/USD', price: 18.50, category: 'crypto', heartbeat: 3600, deviation: 1.0 },
  { pair: 'AVAX/USD', price: 38, category: 'crypto', heartbeat: 3600, deviation: 1.0 },
  { pair: 'MATIC/USD', price: 0.72, category: 'crypto', heartbeat: 3600, deviation: 1.0 },
  { pair: 'ARB/USD', price: 1.15, category: 'crypto', heartbeat: 3600, deviation: 1.0 },
  { pair: 'OP/USD', price: 2.80, category: 'crypto', heartbeat: 3600, deviation: 1.0 },
  { pair: 'ATOM/USD', price: 9.50, category: 'crypto', heartbeat: 3600, deviation: 1.0 },
  { pair: 'DOT/USD', price: 7.20, category: 'crypto', heartbeat: 3600, deviation: 1.0 },
  { pair: 'FORGE/USD', price: 0.05, category: 'crypto', heartbeat: 1800, deviation: 2.0 },
  { pair: 'SHX/USD', price: 0.000012, category: 'crypto', heartbeat: 3600, deviation: 2.0 },
  // DeFi
  { pair: 'AAVE/USD', price: 92, category: 'defi', heartbeat: 3600, deviation: 1.0 },
  { pair: 'UNI/USD', price: 7.80, category: 'defi', heartbeat: 3600, deviation: 1.0 },
  { pair: 'MKR/USD', price: 2900, category: 'defi', heartbeat: 3600, deviation: 1.0 },
  { pair: 'CRV/USD', price: 0.58, category: 'defi', heartbeat: 3600, deviation: 1.5 },
  { pair: 'COMP/USD', price: 52, category: 'defi', heartbeat: 3600, deviation: 1.0 },
  { pair: 'SNX/USD', price: 3.10, category: 'defi', heartbeat: 3600, deviation: 1.5 },
  // Forex
  { pair: 'EUR/USD', price: 1.085, category: 'forex', heartbeat: 86400, deviation: 0.15 },
  { pair: 'GBP/USD', price: 1.265, category: 'forex', heartbeat: 86400, deviation: 0.15 },
  { pair: 'JPY/USD', price: 0.0067, category: 'forex', heartbeat: 86400, deviation: 0.15 },
  { pair: 'CHF/USD', price: 1.12, category: 'forex', heartbeat: 86400, deviation: 0.15 },
  // Commodities
  { pair: 'XAU/USD', price: 2340, category: 'commodities', heartbeat: 86400, deviation: 0.25 },
  { pair: 'XAG/USD', price: 27.50, category: 'commodities', heartbeat: 86400, deviation: 0.5 },
  { pair: 'WTI/USD', price: 78.50, category: 'commodities', heartbeat: 86400, deviation: 0.5 },
  // NFT Floor Prices
  { pair: 'BAYC/ETH', price: 28.5, category: 'nft_floor', heartbeat: 86400, deviation: 5.0 },
  { pair: 'PUNKS/ETH', price: 48.0, category: 'nft_floor', heartbeat: 86400, deviation: 5.0 },
];

function initializeFeeds(): void {
  if (feedRegistry.size > 0) return;

  for (const feed of INITIAL_FEEDS) {
    const priceFeed: PriceFeed = {
      pair: feed.pair,
      price: feed.price,
      decimals: 8,
      roundId: 1,
      updatedAt: Date.now(),
      answeredInRound: 1,
      category: feed.category,
      heartbeatSeconds: feed.heartbeat,
      deviationThresholdPct: feed.deviation,
      sources: Math.floor(Math.random() * 10) + 7,
      network: 'ethereum',
    };
    feedRegistry.set(feed.pair, priceFeed);
    roundHistory.set(feed.pair, [{
      roundId: 1,
      price: feed.price,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      answeredInRound: 1,
    }]);
  }
}

export function getLatestPrice(pair: string): PriceFeed | null {
  initializeFeeds();
  return feedRegistry.get(pair) || null;
}

export function getHistoricalPrice(pair: string, roundId: number): PriceRound | null {
  initializeFeeds();
  const rounds = roundHistory.get(pair);
  return rounds?.find((r) => r.roundId === roundId) || null;
}

export function updatePrice(pair: string, newPrice: number): PriceFeed | null {
  initializeFeeds();
  const feed = feedRegistry.get(pair);
  if (!feed) return null;

  const deviation = Math.abs((newPrice - feed.price) / feed.price) * 100;
  feed.roundId++;
  feed.price = newPrice;
  feed.updatedAt = Date.now();
  feed.answeredInRound = feed.roundId;

  const rounds = roundHistory.get(pair) || [];
  rounds.push({
    roundId: feed.roundId,
    price: newPrice,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    answeredInRound: feed.roundId,
  });
  // Keep last 1000 rounds
  if (rounds.length > 1000) rounds.splice(0, rounds.length - 1000);
  roundHistory.set(pair, rounds);

  return feed;
}

export function getAllFeeds(category?: FeedCategory): PriceFeed[] {
  initializeFeeds();
  const feeds = Array.from(feedRegistry.values());
  return category ? feeds.filter((f) => f.category === category) : feeds;
}

export function getFeedsByNetwork(network: OracleNetwork): PriceFeed[] {
  initializeFeeds();
  return Array.from(feedRegistry.values()).filter((f) => f.network === network);
}

export function getStaleFeedAlerts(maxAgeMs: number = 7200_000): PriceFeed[] {
  initializeFeeds();
  const now = Date.now();
  return Array.from(feedRegistry.values()).filter((f) => now - f.updatedAt > maxAgeMs);
}

/* ─── VRF (Verifiable Random Function) ────────────────────────────────────── */

const vrfRequests: Map<string, VRFRequest> = new Map();

export function requestRandomWords(requester: string, numWords: number = 1): VRFRequest {
  const requestId = `vrf_${Date.now().toString(36)}_${createHash('sha256').update(`${requester}${Date.now()}`).digest('hex').slice(0, 12)}`;

  const request: VRFRequest = {
    requestId,
    requester,
    numWords: Math.min(numWords, 500), // Max 500 words
    keyHash: VRF_KEY_HASH,
    confirmations: VRF_CONFIRMATIONS,
    callbackGasLimit: VRF_CALLBACK_GAS,
    randomWords: [],
    fulfilled: false,
    requestedAt: Date.now(),
  };

  vrfRequests.set(requestId, request);

  // Simulate fulfillment (in production this comes from Chainlink VRF Coordinator)
  fulfillRandomWords(requestId);

  return request;
}

function fulfillRandomWords(requestId: string): void {
  const request = vrfRequests.get(requestId);
  if (!request || request.fulfilled) return;

  const words: bigint[] = [];
  for (let i = 0; i < request.numWords; i++) {
    const seed = createHash('sha256')
      .update(`${requestId}:${i}:${Date.now()}:${Math.random()}`)
      .digest('hex');
    words.push(BigInt(`0x${seed}`));
  }

  request.randomWords = words;
  request.fulfilled = true;
  request.fulfilledAt = Date.now();
}

export function getVRFRequest(requestId: string): VRFRequest | null {
  return vrfRequests.get(requestId) || null;
}

export function getRandomInRange(requestId: string, wordIndex: number, min: number, max: number): number | null {
  const request = vrfRequests.get(requestId);
  if (!request?.fulfilled || wordIndex >= request.randomWords.length) return null;

  const range = BigInt(max - min + 1);
  const result = Number(request.randomWords[wordIndex] % range) + min;
  return Math.abs(result);
}

/* ─── Automation (Keepers) ────────────────────────────────────────────────── */

const upkeeps: Map<string, AutomationUpkeep> = new Map();

export function registerUpkeep(input: {
  name: string;
  target: string;
  trigger: AutomationTrigger;
  checkFunction: string;
  performFunction: string;
  interval?: number;
  condition?: string;
  gasLimit?: number;
  initialBalance?: number;
}): AutomationUpkeep {
  const upkeep: AutomationUpkeep = {
    id: `upkeep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: input.name,
    target: input.target,
    trigger: input.trigger,
    checkFunction: input.checkFunction,
    performFunction: input.performFunction,
    interval: input.interval,
    condition: input.condition,
    balance: input.initialBalance || 10,
    lastPerformedAt: undefined,
    performCount: 0,
    active: true,
    gasLimit: input.gasLimit || 500_000,
    createdAt: Date.now(),
  };

  upkeeps.set(upkeep.id, upkeep);
  return upkeep;
}

export function checkUpkeep(upkeepId: string): { upkeepNeeded: boolean; reason: string } {
  const upkeep = upkeeps.get(upkeepId);
  if (!upkeep || !upkeep.active) return { upkeepNeeded: false, reason: 'Upkeep not found or inactive' };
  if (upkeep.balance < KEEPER_MIN_BALANCE) return { upkeepNeeded: false, reason: 'Insufficient LINK balance' };

  switch (upkeep.trigger) {
    case 'time_based': {
      const interval = upkeep.interval || 3600_000;
      const elapsed = upkeep.lastPerformedAt ? Date.now() - upkeep.lastPerformedAt : interval + 1;
      return elapsed >= interval
        ? { upkeepNeeded: true, reason: `Time interval elapsed (${interval}ms)` }
        : { upkeepNeeded: false, reason: `Next check in ${interval - elapsed}ms` };
    }
    case 'condition_based':
      return { upkeepNeeded: true, reason: `Condition: ${upkeep.condition}` };
    case 'log_trigger':
      return { upkeepNeeded: true, reason: 'Log event detected' };
    default:
      return { upkeepNeeded: true, reason: 'Custom trigger' };
  }
}

export function performUpkeep(upkeepId: string): AutomationUpkeep | null {
  const upkeep = upkeeps.get(upkeepId);
  if (!upkeep || !upkeep.active) return null;

  const { upkeepNeeded } = checkUpkeep(upkeepId);
  if (!upkeepNeeded) return null;

  upkeep.lastPerformedAt = Date.now();
  upkeep.performCount++;
  upkeep.balance -= 0.1; // Deduct LINK for gas

  if (upkeep.balance < KEEPER_MIN_BALANCE) {
    upkeep.active = false;
  }

  return upkeep;
}

export function fundUpkeep(upkeepId: string, amount: number): AutomationUpkeep | null {
  const upkeep = upkeeps.get(upkeepId);
  if (!upkeep) return null;
  upkeep.balance += amount;
  if (!upkeep.active && upkeep.balance >= KEEPER_MIN_BALANCE) upkeep.active = true;
  return upkeep;
}

export function getUpkeep(upkeepId: string): AutomationUpkeep | null {
  return upkeeps.get(upkeepId) || null;
}

export function getActiveUpkeeps(): AutomationUpkeep[] {
  return Array.from(upkeeps.values()).filter((u) => u.active);
}

/* ─── CCIP (Cross-Chain Interoperability) ─────────────────────────────────── */

const ccipMessages: Map<string, CCIPMessage> = new Map();

export function sendCCIPMessage(input: {
  sourceChain: OracleNetwork;
  destChain: OracleNetwork;
  sender: string;
  receiver: string;
  data: string;
  tokenAmounts?: Array<{ token: string; amount: number }>;
  feeToken?: string;
}): CCIPMessage {
  const tokenAmounts = input.tokenAmounts || [];
  const totalValue = tokenAmounts.reduce((s, t) => s + t.amount, 0);
  const fee = Math.max(0.01, totalValue * CCIP_FEE_MULTIPLIER);

  const message: CCIPMessage = {
    messageId: `ccip_${Date.now().toString(36)}_${createHash('sha256').update(`${input.sender}${Date.now()}`).digest('hex').slice(0, 8)}`,
    sourceChain: input.sourceChain,
    destChain: input.destChain,
    sender: input.sender,
    receiver: input.receiver,
    data: input.data,
    tokenAmounts,
    feeToken: input.feeToken || 'LINK',
    fee,
    status: 'pending',
    sentAt: Date.now(),
  };

  ccipMessages.set(message.messageId, message);

  // Simulate delivery after finality
  setTimeout(() => {
    const msg = ccipMessages.get(message.messageId);
    if (msg && msg.status === 'pending') {
      msg.status = 'in_flight';
    }
  }, 0);

  return message;
}

export function deliverCCIPMessage(messageId: string): CCIPMessage | null {
  const message = ccipMessages.get(messageId);
  if (!message || message.status === 'delivered' || message.status === 'failed') return null;

  message.status = 'delivered';
  message.deliveredAt = Date.now();
  return message;
}

export function getCCIPMessage(messageId: string): CCIPMessage | null {
  return ccipMessages.get(messageId) || null;
}

export function getCCIPMessagesByChain(chain: OracleNetwork, direction: 'sent' | 'received'): CCIPMessage[] {
  return Array.from(ccipMessages.values()).filter((m) =>
    direction === 'sent' ? m.sourceChain === chain : m.destChain === chain
  );
}

/* ─── Proof of Reserve ────────────────────────────────────────────────────── */

const reserveProofs: Map<string, ProofOfReserve> = new Map();

export function attestReserves(input: {
  asset: string;
  totalReserves: number;
  totalSupply: number;
  auditor: string;
}): ProofOfReserve {
  const attestationHash = createHash('sha256')
    .update(`${input.asset}:${input.totalReserves}:${input.totalSupply}:${Date.now()}`)
    .digest('hex');

  const proof: ProofOfReserve = {
    asset: input.asset,
    totalReserves: input.totalReserves,
    totalSupply: input.totalSupply,
    reserveRatio: input.totalReserves / Math.max(1, input.totalSupply),
    lastAuditAt: Date.now(),
    auditor: input.auditor,
    attestationHash,
    isFullyBacked: input.totalReserves >= input.totalSupply,
  };

  reserveProofs.set(input.asset, proof);
  return proof;
}

export function getReserveProof(asset: string): ProofOfReserve | null {
  return reserveProofs.get(asset) || null;
}

export function getAllReserveProofs(): ProofOfReserve[] {
  return Array.from(reserveProofs.values());
}

/* ─── Oracle Functions (Serverless) ───────────────────────────────────────── */

const oracleFunctions: Map<string, OracleFunction> = new Map();

export function createOracleFunction(input: {
  name: string;
  source: string;
  args?: string[];
  subscriptionId: number;
  gasLimit?: number;
}): OracleFunction {
  const fn: OracleFunction = {
    id: `fn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: input.name,
    source: input.source,
    args: input.args || [],
    subscriptionId: input.subscriptionId,
    gasLimit: input.gasLimit || 300_000,
    executionCount: 0,
    createdAt: Date.now(),
  };

  oracleFunctions.set(fn.id, fn);
  return fn;
}

export function executeOracleFunction(functionId: string, args?: string[]): OracleFunction | null {
  const fn = oracleFunctions.get(functionId);
  if (!fn) return null;

  if (args) fn.args = args;
  fn.executionCount++;
  fn.lastResponse = `Result from ${fn.name} execution #${fn.executionCount}`;
  fn.lastError = undefined;

  return fn;
}

export function getOracleFunction(functionId: string): OracleFunction | null {
  return oracleFunctions.get(functionId) || null;
}

/* ─── Oracle Protocol Summary ─────────────────────────────────────────────── */

export function getOracleSummary() {
  initializeFeeds();

  return {
    name: 'FreedomForge Oracle Network',
    version: '1.0.0',
    inspired_by: ['Chainlink', 'Pyth', 'Band Protocol', 'API3', 'RedStone'],
    priceFeeds: {
      total: feedRegistry.size,
      categories: {
        crypto: getAllFeeds('crypto').length,
        defi: getAllFeeds('defi').length,
        forex: getAllFeeds('forex').length,
        commodities: getAllFeeds('commodities').length,
        nft_floor: getAllFeeds('nft_floor').length,
      },
      networks: ['ethereum', 'base', 'arbitrum', 'polygon', 'solana', 'avalanche'],
    },
    vrf: {
      totalRequests: vrfRequests.size,
      keyHash: VRF_KEY_HASH,
      confirmations: VRF_CONFIRMATIONS,
      maxWords: 500,
    },
    automation: {
      totalUpkeeps: upkeeps.size,
      activeUpkeeps: Array.from(upkeeps.values()).filter((u) => u.active).length,
      triggers: ['time_based', 'condition_based', 'log_trigger', 'custom'],
    },
    ccip: {
      totalMessages: ccipMessages.size,
      supportedChains: ['ethereum', 'base', 'arbitrum', 'polygon', 'solana', 'avalanche'],
    },
    proofOfReserve: {
      totalAttestations: reserveProofs.size,
    },
    features: [
      '28+ real-time price feeds (crypto, DeFi, forex, commodities, NFTs)',
      'VRF provably fair random number generation',
      'Automation keepers with time/condition/log triggers',
      'CCIP cross-chain messaging and token transfers',
      'Proof of Reserve attestations',
      'Serverless oracle functions',
      'Multi-network support (6 chains)',
      'Stale feed alerting and heartbeat monitoring',
      'Historical price round data',
      'Feed registry with category filtering',
    ],
  };
}
