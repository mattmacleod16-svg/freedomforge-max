/**
 * Cross-Chain Bridge Protocols — FreedomForge Max
 * ══════════════════════════════════════════════════
 *
 * Universal cross-chain messaging and token bridge infrastructure:
 *
 *  • Wormhole — Guardian-based VAA messaging across 30+ chains
 *  • LayerZero — Ultra-light node omnichain messaging + OFT standard
 *  • Hyperlane — Permissionless interchain messaging + ISM
 *  • Axelar — GMP (General Message Passing) with Cosmos gateway
 *  • deBridge — Cross-chain liquidity with DLN (Deswap Liquidity Network)
 *  • Across Protocol — Intent-based bridging with optimistic verification
 *  • Stargate — Unified liquidity pools for instant finality transfers
 *  • Squid Router — Cross-chain swap + bridge aggregation
 *  • Circle CCTP — Native USDC cross-chain via burn-and-mint
 *  • Multichain Routing — Best-path selection across all bridge providers
 *
 * Inspired by: Wormhole, LayerZero, Hyperlane, Axelar, Across, Stargate
 */

import { createHash } from 'crypto';

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type BridgeProvider = 'wormhole' | 'layerzero' | 'hyperlane' | 'axelar' | 'debridge' | 'across' | 'stargate' | 'squid' | 'cctp';
export type ChainEcosystem = 'evm' | 'solana' | 'cosmos' | 'sui' | 'aptos' | 'near' | 'sei' | 'stellar' | 'algorand' | 'bitcoin';
export type MessageStatus = 'submitted' | 'signed' | 'relayed' | 'delivered' | 'failed' | 'timed_out';
export type VerificationModel = 'guardian' | 'oracle_relayer' | 'ism' | 'validator_set' | 'optimistic' | 'burn_mint';

export interface SupportedChain {
  chainId: number | string;
  name: string;
  ecosystem: ChainEcosystem;
  wormholeChainId?: number;
  lzChainId?: number;
  hyperlaneMailbox?: string;
  axelarGateway?: string;
  nativeToken: string;
  blockTimeMs: number;
  finality: string;
  bridgeProviders: BridgeProvider[];
}

export interface CrossChainMessage {
  id: string;
  provider: BridgeProvider;
  sourceChain: string;
  destChain: string;
  sender: string;
  receiver: string;
  payload: string;
  nonce: number;
  status: MessageStatus;
  verification: VerificationModel;
  fee: number;
  sentAt: number;
  deliveredAt?: number;
  txHash?: string;
  destTxHash?: string;
}

export interface WormholeVAA {
  version: number;
  guardianSetIndex: number;
  signatures: number;
  timestamp: number;
  nonce: number;
  emitterChain: number;
  emitterAddress: string;
  sequence: bigint;
  consistencyLevel: number;
  payload: string;
  hash: string;
}

export interface LayerZeroPacket {
  srcEid: number;
  sender: string;
  dstEid: number;
  receiver: string;
  guid: string;
  message: string;
  options: string;
  nativeFee: number;
  lzTokenFee: number;
}

export interface HyperlaneDispatch {
  messageId: string;
  origin: number;
  sender: string;
  destination: number;
  recipient: string;
  body: string;
  ismAddress: string;
  hookAddress?: string;
  fee: number;
}

export interface TokenBridgeTransfer {
  id: string;
  provider: BridgeProvider;
  sourceChain: string;
  destChain: string;
  token: string;
  wrappedToken?: string;
  amount: number;
  sender: string;
  recipient: string;
  fee: number;
  slippage: number;
  estimatedTimeMs: number;
  status: MessageStatus;
  sentAt: number;
  completedAt?: number;
}

export interface OFTTransfer {
  guid: string;
  srcEid: number;
  dstEid: number;
  token: string;
  amountSent: number;
  amountReceived: number;
  sender: string;
  receiver: string;
  composeMsg?: string;
  fee: number;
}

export interface NTTTransfer {
  messageId: string;
  sourceChain: string;
  destChain: string;
  token: string;
  amount: number;
  sender: string;
  recipient: string;
  mode: 'locking' | 'burning';
  rateLimited: boolean;
  inboundLimit?: number;
  outboundLimit?: number;
}

export interface BridgeRoute {
  provider: BridgeProvider;
  sourceChain: string;
  destChain: string;
  token: string;
  estimatedFee: number;
  estimatedTimeMs: number;
  maxAmount: number;
  liquidityDepth: number;
  securityScore: number;
}

export interface BridgeAggregatorQuote {
  routes: BridgeRoute[];
  bestRoute: BridgeRoute;
  amountIn: number;
  amountOut: number;
  totalFee: number;
  savingsVsWorst: number;
}

/* ─── Constants ───────────────────────────────────────────────────────────── */

const WORMHOLE_GUARDIAN_COUNT = 19;
const WORMHOLE_QUORUM = 13;
const LZ_DVN_THRESHOLD = 2;

/* ─── Chain Registry ──────────────────────────────────────────────────────── */

const SUPPORTED_CHAINS: SupportedChain[] = [
  { chainId: 1, name: 'Ethereum', ecosystem: 'evm', wormholeChainId: 2, lzChainId: 30101, nativeToken: 'ETH', blockTimeMs: 12000, finality: '~15 min (finalized)', bridgeProviders: ['wormhole', 'layerzero', 'hyperlane', 'axelar', 'across', 'stargate', 'cctp'] },
  { chainId: 8453, name: 'Base', ecosystem: 'evm', wormholeChainId: 30, lzChainId: 30184, nativeToken: 'ETH', blockTimeMs: 2000, finality: '~2 min', bridgeProviders: ['wormhole', 'layerzero', 'hyperlane', 'across', 'stargate', 'cctp'] },
  { chainId: 42161, name: 'Arbitrum', ecosystem: 'evm', wormholeChainId: 23, lzChainId: 30110, nativeToken: 'ETH', blockTimeMs: 250, finality: '~7 days (challenge)', bridgeProviders: ['wormhole', 'layerzero', 'hyperlane', 'axelar', 'across', 'stargate', 'cctp'] },
  { chainId: 10, name: 'Optimism', ecosystem: 'evm', wormholeChainId: 24, lzChainId: 30111, nativeToken: 'ETH', blockTimeMs: 2000, finality: '~7 days (challenge)', bridgeProviders: ['wormhole', 'layerzero', 'hyperlane', 'across', 'stargate', 'cctp'] },
  { chainId: 137, name: 'Polygon', ecosystem: 'evm', wormholeChainId: 5, lzChainId: 30109, nativeToken: 'MATIC', blockTimeMs: 2000, finality: '~30 min', bridgeProviders: ['wormhole', 'layerzero', 'hyperlane', 'axelar', 'stargate', 'cctp'] },
  { chainId: 43114, name: 'Avalanche', ecosystem: 'evm', wormholeChainId: 6, lzChainId: 30106, nativeToken: 'AVAX', blockTimeMs: 2000, finality: '~2 sec', bridgeProviders: ['wormhole', 'layerzero', 'hyperlane', 'axelar', 'stargate', 'cctp'] },
  { chainId: 56, name: 'BNB Chain', ecosystem: 'evm', wormholeChainId: 4, lzChainId: 30102, nativeToken: 'BNB', blockTimeMs: 3000, finality: '~15 sec', bridgeProviders: ['wormhole', 'layerzero', 'axelar', 'stargate'] },
  { chainId: 324, name: 'zkSync Era', ecosystem: 'evm', wormholeChainId: 0, lzChainId: 30165, nativeToken: 'ETH', blockTimeMs: 1000, finality: '~24 hrs (proof)', bridgeProviders: ['layerzero', 'hyperlane'] },
  { chainId: 59144, name: 'Linea', ecosystem: 'evm', wormholeChainId: 0, lzChainId: 30183, nativeToken: 'ETH', blockTimeMs: 12000, finality: '~8 hrs (proof)', bridgeProviders: ['layerzero', 'stargate'] },
  { chainId: 534352, name: 'Scroll', ecosystem: 'evm', wormholeChainId: 0, lzChainId: 30214, nativeToken: 'ETH', blockTimeMs: 3000, finality: '~4 hrs (proof)', bridgeProviders: ['layerzero'] },
  { chainId: 81457, name: 'Blast', ecosystem: 'evm', wormholeChainId: 36, lzChainId: 30243, nativeToken: 'ETH', blockTimeMs: 2000, finality: '~7 days', bridgeProviders: ['wormhole', 'layerzero'] },
  { chainId: 5000, name: 'Mantle', ecosystem: 'evm', wormholeChainId: 0, lzChainId: 30181, nativeToken: 'MNT', blockTimeMs: 2000, finality: '~7 days', bridgeProviders: ['layerzero', 'stargate'] },
  { chainId: 'solana', name: 'Solana', ecosystem: 'solana', wormholeChainId: 1, lzChainId: 30168, nativeToken: 'SOL', blockTimeMs: 400, finality: '~400ms', bridgeProviders: ['wormhole', 'layerzero', 'debridge'] },
  { chainId: 'sui', name: 'Sui', ecosystem: 'sui', wormholeChainId: 21, lzChainId: 30280, nativeToken: 'SUI', blockTimeMs: 500, finality: '~500ms', bridgeProviders: ['wormhole', 'layerzero'] },
  { chainId: 'aptos', name: 'Aptos', ecosystem: 'aptos', wormholeChainId: 22, lzChainId: 30126, nativeToken: 'APT', blockTimeMs: 1000, finality: '~1 sec', bridgeProviders: ['wormhole', 'layerzero'] },
  { chainId: 'near', name: 'NEAR', ecosystem: 'near', wormholeChainId: 15, lzChainId: 0, nativeToken: 'NEAR', blockTimeMs: 1000, finality: '~2 sec', bridgeProviders: ['wormhole'] },
  { chainId: 'sei', name: 'Sei', ecosystem: 'sei', wormholeChainId: 32, lzChainId: 30280, nativeToken: 'SEI', blockTimeMs: 400, finality: '~400ms', bridgeProviders: ['wormhole', 'layerzero', 'axelar'] },
  { chainId: 'injective', name: 'Injective', ecosystem: 'cosmos', wormholeChainId: 19, lzChainId: 0, nativeToken: 'INJ', blockTimeMs: 1500, finality: '~1.5 sec', bridgeProviders: ['wormhole', 'axelar'] },
  { chainId: 'osmosis', name: 'Osmosis', ecosystem: 'cosmos', wormholeChainId: 20, lzChainId: 0, nativeToken: 'OSMO', blockTimeMs: 6000, finality: '~6 sec', bridgeProviders: ['wormhole', 'axelar'] },
  { chainId: 'celestia', name: 'Celestia', ecosystem: 'cosmos', wormholeChainId: 0, lzChainId: 0, nativeToken: 'TIA', blockTimeMs: 12000, finality: '~12 sec', bridgeProviders: ['hyperlane'] },
  { chainId: 'algorand', name: 'Algorand', ecosystem: 'algorand', wormholeChainId: 8, lzChainId: 0, nativeToken: 'ALGO', blockTimeMs: 3300, finality: '~3.3 sec', bridgeProviders: ['wormhole'] },
  { chainId: 'bitcoin', name: 'Bitcoin', ecosystem: 'bitcoin', wormholeChainId: 0, lzChainId: 0, nativeToken: 'BTC', blockTimeMs: 600000, finality: '~60 min (6 conf)', bridgeProviders: [] },
];

/* ─── State ───────────────────────────────────────────────────────────────── */

const messages: Map<string, CrossChainMessage> = new Map();
const tokenTransfers: Map<string, TokenBridgeTransfer> = new Map();
const vaas: Map<string, WormholeVAA> = new Map();
const lzPackets: Map<string, LayerZeroPacket> = new Map();
const hyperlaneDispatches: Map<string, HyperlaneDispatch> = new Map();
const nttTransfers: Map<string, NTTTransfer> = new Map();

let messageNonce = 0;

/* ─── Chain Registry Queries ──────────────────────────────────────────────── */

export function getSupportedChains(): SupportedChain[] {
  return [...SUPPORTED_CHAINS];
}

export function getChainsByEcosystem(ecosystem: ChainEcosystem): SupportedChain[] {
  return SUPPORTED_CHAINS.filter((c) => c.ecosystem === ecosystem);
}

export function getChainsByBridge(provider: BridgeProvider): SupportedChain[] {
  return SUPPORTED_CHAINS.filter((c) => c.bridgeProviders.includes(provider));
}

export function getChain(nameOrId: string | number): SupportedChain | null {
  return SUPPORTED_CHAINS.find((c) => c.chainId === nameOrId || c.name.toLowerCase() === String(nameOrId).toLowerCase()) || null;
}

/* ─── Wormhole ────────────────────────────────────────────────────────────── */

export function wormholeSendMessage(input: {
  sourceChain: string;
  destChain: string;
  sender: string;
  receiver: string;
  payload: string;
}): { message: CrossChainMessage; vaa: WormholeVAA } {
  const nonce = ++messageNonce;
  const hash = createHash('sha256').update(`${input.sender}:${nonce}:${Date.now()}`).digest('hex');

  const vaa: WormholeVAA = {
    version: 1,
    guardianSetIndex: 4,
    signatures: WORMHOLE_QUORUM,
    timestamp: Math.floor(Date.now() / 1000),
    nonce,
    emitterChain: SUPPORTED_CHAINS.find((c) => c.name === input.sourceChain)?.wormholeChainId || 0,
    emitterAddress: input.sender,
    sequence: BigInt(nonce),
    consistencyLevel: 15,
    payload: input.payload,
    hash,
  };

  const message: CrossChainMessage = {
    id: `wh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    provider: 'wormhole',
    sourceChain: input.sourceChain,
    destChain: input.destChain,
    sender: input.sender,
    receiver: input.receiver,
    payload: input.payload,
    nonce,
    status: 'signed',
    verification: 'guardian',
    fee: 0.0001,
    sentAt: Date.now(),
    txHash: `0x${hash.slice(0, 64)}`,
  };

  vaas.set(hash, vaa);
  messages.set(message.id, message);
  return { message, vaa };
}

export function wormholeNTTTransfer(input: {
  sourceChain: string;
  destChain: string;
  token: string;
  amount: number;
  sender: string;
  recipient: string;
  mode?: 'locking' | 'burning';
}): NTTTransfer {
  const transfer: NTTTransfer = {
    messageId: `ntt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    sourceChain: input.sourceChain,
    destChain: input.destChain,
    token: input.token,
    amount: input.amount,
    sender: input.sender,
    recipient: input.recipient,
    mode: input.mode || 'burning',
    rateLimited: input.amount > 1_000_000,
    inboundLimit: 10_000_000,
    outboundLimit: 10_000_000,
  };

  nttTransfers.set(transfer.messageId, transfer);
  return transfer;
}

export function getVAA(hash: string): WormholeVAA | null {
  return vaas.get(hash) || null;
}

/* ─── LayerZero ───────────────────────────────────────────────────────────── */

export function layerZeroSend(input: {
  sourceChain: string;
  destChain: string;
  sender: string;
  receiver: string;
  message: string;
  options?: string;
}): { crossChainMsg: CrossChainMessage; packet: LayerZeroPacket } {
  const srcChain = SUPPORTED_CHAINS.find((c) => c.name === input.sourceChain);
  const dstChain = SUPPORTED_CHAINS.find((c) => c.name === input.destChain);

  const guid = createHash('sha256').update(`${input.sender}:${input.receiver}:${Date.now()}`).digest('hex');

  const packet: LayerZeroPacket = {
    srcEid: srcChain?.lzChainId || 0,
    sender: input.sender,
    dstEid: dstChain?.lzChainId || 0,
    receiver: input.receiver,
    guid,
    message: input.message,
    options: input.options || '0x',
    nativeFee: 0.005,
    lzTokenFee: 0,
  };

  const crossChainMsg: CrossChainMessage = {
    id: `lz_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    provider: 'layerzero',
    sourceChain: input.sourceChain,
    destChain: input.destChain,
    sender: input.sender,
    receiver: input.receiver,
    payload: input.message,
    nonce: ++messageNonce,
    status: 'submitted',
    verification: 'oracle_relayer',
    fee: packet.nativeFee,
    sentAt: Date.now(),
  };

  lzPackets.set(guid, packet);
  messages.set(crossChainMsg.id, crossChainMsg);
  return { crossChainMsg, packet };
}

export function layerZeroOFTSend(input: {
  sourceChain: string;
  destChain: string;
  token: string;
  amount: number;
  sender: string;
  receiver: string;
  composeMsg?: string;
}): OFTTransfer {
  const srcChain = SUPPORTED_CHAINS.find((c) => c.name === input.sourceChain);
  const dstChain = SUPPORTED_CHAINS.find((c) => c.name === input.destChain);
  const fee = input.amount * 0.0001;

  const transfer: OFTTransfer = {
    guid: createHash('sha256').update(`oft:${input.sender}:${Date.now()}`).digest('hex'),
    srcEid: srcChain?.lzChainId || 0,
    dstEid: dstChain?.lzChainId || 0,
    token: input.token,
    amountSent: input.amount,
    amountReceived: input.amount - fee,
    sender: input.sender,
    receiver: input.receiver,
    composeMsg: input.composeMsg,
    fee,
  };

  return transfer;
}

/* ─── Hyperlane ───────────────────────────────────────────────────────────── */

export function hyperlaneSend(input: {
  sourceChain: string;
  destChain: string;
  sender: string;
  recipient: string;
  body: string;
  ismAddress?: string;
}): { crossChainMsg: CrossChainMessage; dispatch: HyperlaneDispatch } {
  const srcChain = SUPPORTED_CHAINS.find((c) => c.name === input.sourceChain);
  const dstChain = SUPPORTED_CHAINS.find((c) => c.name === input.destChain);
  const messageId = createHash('sha256').update(`hl:${input.sender}:${Date.now()}`).digest('hex');

  const dispatch: HyperlaneDispatch = {
    messageId,
    origin: typeof srcChain?.chainId === 'number' ? srcChain.chainId : 0,
    sender: input.sender,
    destination: typeof dstChain?.chainId === 'number' ? dstChain.chainId : 0,
    recipient: input.recipient,
    body: input.body,
    ismAddress: input.ismAddress || '0x0000000000000000000000000000000000000001',
    fee: 0.003,
  };

  const crossChainMsg: CrossChainMessage = {
    id: `hl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    provider: 'hyperlane',
    sourceChain: input.sourceChain,
    destChain: input.destChain,
    sender: input.sender,
    receiver: input.recipient,
    payload: input.body,
    nonce: ++messageNonce,
    status: 'submitted',
    verification: 'ism',
    fee: dispatch.fee,
    sentAt: Date.now(),
  };

  hyperlaneDispatches.set(messageId, dispatch);
  messages.set(crossChainMsg.id, crossChainMsg);
  return { crossChainMsg, dispatch };
}

/* ─── Axelar GMP ──────────────────────────────────────────────────────────── */

export function axelarGMP(input: {
  sourceChain: string;
  destChain: string;
  sender: string;
  contractAddress: string;
  payload: string;
  gasValue?: number;
}): CrossChainMessage {
  const message: CrossChainMessage = {
    id: `axl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    provider: 'axelar',
    sourceChain: input.sourceChain,
    destChain: input.destChain,
    sender: input.sender,
    receiver: input.contractAddress,
    payload: input.payload,
    nonce: ++messageNonce,
    status: 'submitted',
    verification: 'validator_set',
    fee: input.gasValue || 0.01,
    sentAt: Date.now(),
  };

  messages.set(message.id, message);
  return message;
}

/* ─── Circle CCTP ─────────────────────────────────────────────────────────── */

export function cctpTransfer(input: {
  sourceChain: string;
  destChain: string;
  amount: number;
  sender: string;
  recipient: string;
}): TokenBridgeTransfer {
  const transfer: TokenBridgeTransfer = {
    id: `cctp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    provider: 'cctp',
    sourceChain: input.sourceChain,
    destChain: input.destChain,
    token: 'USDC',
    amount: input.amount,
    sender: input.sender,
    recipient: input.recipient,
    fee: 0,
    slippage: 0,
    estimatedTimeMs: 900_000,
    status: 'submitted',
    sentAt: Date.now(),
  };

  tokenTransfers.set(transfer.id, transfer);
  return transfer;
}

/* ─── Token Bridge Transfer (Generic) ─────────────────────────────────────── */

export function bridgeTokens(input: {
  provider: BridgeProvider;
  sourceChain: string;
  destChain: string;
  token: string;
  amount: number;
  sender: string;
  recipient: string;
}): TokenBridgeTransfer {
  const feeMap: Record<BridgeProvider, number> = {
    wormhole: 0.0001, layerzero: 0.0005, hyperlane: 0.0003,
    axelar: 0.001, debridge: 0.0008, across: 0.0006,
    stargate: 0.0006, squid: 0.001, cctp: 0,
  };
  const timeMap: Record<BridgeProvider, number> = {
    wormhole: 900_000, layerzero: 120_000, hyperlane: 60_000,
    axelar: 180_000, debridge: 60_000, across: 30_000,
    stargate: 15_000, squid: 120_000, cctp: 900_000,
  };

  const fee = input.amount * (feeMap[input.provider] || 0.001);

  const transfer: TokenBridgeTransfer = {
    id: `bridge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    provider: input.provider,
    sourceChain: input.sourceChain,
    destChain: input.destChain,
    token: input.token,
    amount: input.amount,
    sender: input.sender,
    recipient: input.recipient,
    fee,
    slippage: 0.003,
    estimatedTimeMs: timeMap[input.provider] || 120_000,
    status: 'submitted',
    sentAt: Date.now(),
  };

  tokenTransfers.set(transfer.id, transfer);
  return transfer;
}

export function completeTransfer(transferId: string): TokenBridgeTransfer | null {
  const transfer = tokenTransfers.get(transferId);
  if (!transfer || transfer.status === 'delivered') return null;
  transfer.status = 'delivered';
  transfer.completedAt = Date.now();
  return transfer;
}

/* ─── Bridge Aggregator ───────────────────────────────────────────────────── */

export function getBridgeQuote(input: {
  sourceChain: string;
  destChain: string;
  token: string;
  amount: number;
}): BridgeAggregatorQuote {
  const srcChain = SUPPORTED_CHAINS.find((c) => c.name === input.sourceChain);
  const dstChain = SUPPORTED_CHAINS.find((c) => c.name === input.destChain);

  const commonProviders = (srcChain?.bridgeProviders || []).filter(
    (p) => (dstChain?.bridgeProviders || []).includes(p)
  );

  const feeRates: Record<BridgeProvider, number> = {
    wormhole: 0.0001, layerzero: 0.0005, hyperlane: 0.0003,
    axelar: 0.001, debridge: 0.0008, across: 0.0004,
    stargate: 0.0006, squid: 0.001, cctp: 0,
  };
  const speedMs: Record<BridgeProvider, number> = {
    wormhole: 900_000, layerzero: 120_000, hyperlane: 60_000,
    axelar: 180_000, debridge: 60_000, across: 30_000,
    stargate: 15_000, squid: 120_000, cctp: 900_000,
  };
  const securityScores: Record<BridgeProvider, number> = {
    wormhole: 95, layerzero: 90, hyperlane: 88,
    axelar: 87, debridge: 82, across: 85,
    stargate: 86, squid: 80, cctp: 98,
  };

  const routes: BridgeRoute[] = commonProviders.map((provider) => ({
    provider,
    sourceChain: input.sourceChain,
    destChain: input.destChain,
    token: input.token,
    estimatedFee: input.amount * (feeRates[provider] || 0.001),
    estimatedTimeMs: speedMs[provider] || 120_000,
    maxAmount: 10_000_000,
    liquidityDepth: Math.random() * 50_000_000,
    securityScore: securityScores[provider] || 80,
  }));

  // Sort by fee (lowest first), then security
  routes.sort((a, b) => a.estimatedFee - b.estimatedFee || b.securityScore - a.securityScore);

  const bestRoute = routes[0] || {
    provider: 'wormhole' as BridgeProvider,
    sourceChain: input.sourceChain,
    destChain: input.destChain,
    token: input.token,
    estimatedFee: input.amount * 0.001,
    estimatedTimeMs: 120_000,
    maxAmount: 10_000_000,
    liquidityDepth: 0,
    securityScore: 80,
  };

  const worstFee = routes.length > 0 ? routes[routes.length - 1].estimatedFee : bestRoute.estimatedFee;

  return {
    routes,
    bestRoute,
    amountIn: input.amount,
    amountOut: input.amount - bestRoute.estimatedFee,
    totalFee: bestRoute.estimatedFee,
    savingsVsWorst: worstFee - bestRoute.estimatedFee,
  };
}

/* ─── Message Delivery ────────────────────────────────────────────────────── */

export function deliverMessage(messageId: string): CrossChainMessage | null {
  const msg = messages.get(messageId);
  if (!msg || msg.status === 'delivered') return null;
  msg.status = 'delivered';
  msg.deliveredAt = Date.now();
  msg.destTxHash = `0x${createHash('sha256').update(`dest:${messageId}`).digest('hex').slice(0, 64)}`;
  return msg;
}

export function getMessage(messageId: string): CrossChainMessage | null {
  return messages.get(messageId) || null;
}

export function getMessagesByProvider(provider: BridgeProvider): CrossChainMessage[] {
  return Array.from(messages.values()).filter((m) => m.provider === provider);
}

export function getTransfer(transferId: string): TokenBridgeTransfer | null {
  return tokenTransfers.get(transferId) || null;
}

/* ─── Protocol Summary ────────────────────────────────────────────────────── */

export function getCrossChainSummary() {
  const allMessages = Array.from(messages.values());
  const allTransfers = Array.from(tokenTransfers.values());

  return {
    name: 'FreedomForge Cross-Chain Bridge Network',
    version: '1.0.0',
    inspired_by: ['Wormhole', 'LayerZero', 'Hyperlane', 'Axelar', 'Across', 'Stargate', 'Circle CCTP', 'deBridge', 'Squid Router'],
    chains: {
      total: SUPPORTED_CHAINS.length,
      byEcosystem: {
        evm: getChainsByEcosystem('evm').length,
        solana: getChainsByEcosystem('solana').length,
        cosmos: getChainsByEcosystem('cosmos').length,
        sui: getChainsByEcosystem('sui').length,
        aptos: getChainsByEcosystem('aptos').length,
        near: getChainsByEcosystem('near').length,
        bitcoin: getChainsByEcosystem('bitcoin').length,
      },
    },
    providers: {
      wormhole: { chains: getChainsByBridge('wormhole').length, guardians: WORMHOLE_GUARDIAN_COUNT, quorum: WORMHOLE_QUORUM, features: ['VAA messaging', 'NTT (Native Token Transfers)', 'Token Bridge', 'NFT Bridge', 'Queries'] },
      layerzero: { chains: getChainsByBridge('layerzero').length, features: ['OFT (Omnichain Fungible Token)', 'ONFT', 'Composed messaging', 'DVN verification'] },
      hyperlane: { chains: getChainsByBridge('hyperlane').length, features: ['Permissionless deployment', 'Interchain Security Modules (ISM)', 'Warp Routes', 'Hooks'] },
      axelar: { chains: getChainsByBridge('axelar').length, features: ['General Message Passing (GMP)', 'Cosmos gateway', 'Interchain Token Service'] },
      across: { chains: getChainsByBridge('across').length, features: ['Intent-based bridging', 'Optimistic verification', 'Fast fills'] },
      stargate: { chains: getChainsByBridge('stargate').length, features: ['Unified liquidity', 'Instant finality', 'Delta algorithm'] },
      cctp: { chains: getChainsByBridge('cctp').length, features: ['Native USDC burn-and-mint', 'Zero slippage', 'Circle attestation'] },
    },
    messages: {
      total: allMessages.length,
      delivered: allMessages.filter((m) => m.status === 'delivered').length,
      pending: allMessages.filter((m) => m.status === 'submitted' || m.status === 'signed').length,
    },
    transfers: {
      total: allTransfers.length,
      completed: allTransfers.filter((t) => t.status === 'delivered').length,
    },
    features: [
      '22 chains across 8 ecosystems (EVM, Solana, Cosmos, Sui, Aptos, NEAR, Sei, Bitcoin)',
      '9 bridge providers with best-route aggregation',
      'Wormhole VAA guardian messaging + NTT',
      'LayerZero OFT omnichain token standard + composed messaging',
      'Hyperlane permissionless ISM + warp routes',
      'Axelar General Message Passing with Cosmos gateway',
      'Circle CCTP native USDC burn-and-mint',
      'Across intent-based fast bridging',
      'Stargate unified liquidity with instant finality',
      'Multi-provider quote aggregation with security scoring',
    ],
  };
}
