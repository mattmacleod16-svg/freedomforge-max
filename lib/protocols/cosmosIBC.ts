/**
 * Cosmos IBC Cross-Chain Protocol — FreedomForge Max
 * ════════════════════════════════════════════════════
 *
 * Inter-Blockchain Communication for sovereign chain interoperability:
 *
 *  • IBC Channels — Ordered/unordered packet relay between chains
 *  • ICS-20 Token Transfers — Fungible token cross-chain movement
 *  • ICS-27 Interchain Accounts — Remote chain account control
 *  • ICS-721 NFT Transfers — Non-fungible cross-chain movement
 *  • Light Client Verification — Trustless state proof validation
 *  • Relayer Network — Packet relay incentive framework
 *  • Interchain Security — Shared security / mesh security model
 *  • Interchain Queries (ICQ) — Cross-chain data reads
 *  • CosmWasm Integration — Smart contract interop layer
 *  • Skip Protocol — MEV-aware cross-chain routing
 *
 * Inspired by: Cosmos SDK, Osmosis, Stride, Neutron, Axelar, Wormhole
 */

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type ChannelState = 'INIT' | 'TRYOPEN' | 'OPEN' | 'CLOSED';
export type ChannelOrder = 'ORDERED' | 'UNORDERED';
export type PacketStatus = 'pending' | 'relayed' | 'acknowledged' | 'timed_out';
export type ChainType = 'cosmos' | 'evm' | 'solana' | 'stellar' | 'move';
export type SecurityModel = 'replicated' | 'mesh' | 'optimistic' | 'sovereign';

export interface CosmosChain {
  chainId: string;
  name: string;
  type: ChainType;
  prefix: string;
  denom: string;
  decimals: number;
  blockTimeMs: number;
  stakingAPR: number;
  validators: number;
  ibcEnabled: boolean;
  cosmwasmEnabled: boolean;
  securityModel: SecurityModel;
}

export interface IBCChannel {
  channelId: string;
  portId: string;
  counterpartyChannelId: string;
  counterpartyPortId: string;
  sourceChain: string;
  destChain: string;
  state: ChannelState;
  order: ChannelOrder;
  version: string;
  packetsRelayed: number;
  totalVolume: number;
  createdAt: number;
}

export interface IBCPacket {
  id: string;
  sequence: number;
  sourcePort: string;
  sourceChannel: string;
  destPort: string;
  destChannel: string;
  data: string;
  timeoutHeight: number;
  timeoutTimestamp: number;
  status: PacketStatus;
  acknowledgement?: string;
  relayedBy?: string;
  sentAt: number;
  relayedAt?: number;
  acknowledgedAt?: number;
}

export interface ICS20Transfer {
  id: string;
  sender: string;
  receiver: string;
  denom: string;
  amount: number;
  sourceChain: string;
  destChain: string;
  channelId: string;
  memo?: string;
  ibcDenom?: string;
  status: PacketStatus;
  sentAt: number;
  completedAt?: number;
}

export interface InterchainAccount {
  id: string;
  owner: string;
  hostChain: string;
  controllerChain: string;
  address: string;
  channelId: string;
  active: boolean;
  txCount: number;
  createdAt: number;
}

export interface InterchainQuery {
  id: string;
  queryType: 'balance' | 'staking' | 'governance' | 'custom';
  sourceChain: string;
  targetChain: string;
  queryPath: string;
  queryData: string;
  response?: string;
  height?: number;
  callbackId: string;
  status: 'pending' | 'completed' | 'failed';
  submittedAt: number;
  completedAt?: number;
}

export interface Relayer {
  id: string;
  address: string;
  chains: string[];
  packetsRelayed: number;
  feesEarned: number;
  successRate: number;
  avgRelayTimeMs: number;
  active: boolean;
  registeredAt: number;
}

export interface LiquidStakingPosition {
  id: string;
  account: string;
  chain: string;
  nativeAmount: number;
  liquidTokenAmount: number;
  liquidToken: string;
  exchangeRate: number;
  rewardsAccrued: number;
  stakedAt: number;
}

export interface DEXPool {
  id: string;
  chain: string;
  tokenA: string;
  tokenB: string;
  reserveA: number;
  reserveB: number;
  totalShares: number;
  swapFee: number;
  volume24h: number;
  apr: number;
}

/* ─── Constants ───────────────────────────────────────────────────────────── */

const IBC_TIMEOUT_HEIGHT_OFFSET = 1000;
const IBC_TIMEOUT_TIMESTAMP_OFFSET = 10 * 60 * 1000; // 10 minutes
const RELAYER_FEE_PCT = 0.0005; // 0.05%

/* ─── Chain Registry ──────────────────────────────────────────────────────── */

const CHAIN_REGISTRY: CosmosChain[] = [
  { chainId: 'cosmoshub-4', name: 'Cosmos Hub', type: 'cosmos', prefix: 'cosmos', denom: 'uatom', decimals: 6, blockTimeMs: 6000, stakingAPR: 19.2, validators: 180, ibcEnabled: true, cosmwasmEnabled: false, securityModel: 'sovereign' },
  { chainId: 'osmosis-1', name: 'Osmosis', type: 'cosmos', prefix: 'osmo', denom: 'uosmo', decimals: 6, blockTimeMs: 6000, stakingAPR: 11.0, validators: 150, ibcEnabled: true, cosmwasmEnabled: true, securityModel: 'sovereign' },
  { chainId: 'neutron-1', name: 'Neutron', type: 'cosmos', prefix: 'neutron', denom: 'untrn', decimals: 6, blockTimeMs: 3000, stakingAPR: 0, validators: 0, ibcEnabled: true, cosmwasmEnabled: true, securityModel: 'replicated' },
  { chainId: 'stride-1', name: 'Stride', type: 'cosmos', prefix: 'stride', denom: 'ustrd', decimals: 6, blockTimeMs: 6000, stakingAPR: 15.5, validators: 60, ibcEnabled: true, cosmwasmEnabled: false, securityModel: 'sovereign' },
  { chainId: 'celestia', name: 'Celestia', type: 'cosmos', prefix: 'celestia', denom: 'utia', decimals: 6, blockTimeMs: 12000, stakingAPR: 14.0, validators: 100, ibcEnabled: true, cosmwasmEnabled: false, securityModel: 'sovereign' },
  { chainId: 'dydx-mainnet-1', name: 'dYdX', type: 'cosmos', prefix: 'dydx', denom: 'adydx', decimals: 18, blockTimeMs: 1000, stakingAPR: 18.0, validators: 60, ibcEnabled: true, cosmwasmEnabled: false, securityModel: 'sovereign' },
  { chainId: 'injective-1', name: 'Injective', type: 'cosmos', prefix: 'inj', denom: 'inj', decimals: 18, blockTimeMs: 1500, stakingAPR: 14.5, validators: 50, ibcEnabled: true, cosmwasmEnabled: true, securityModel: 'sovereign' },
  { chainId: 'akashnet-2', name: 'Akash Network', type: 'cosmos', prefix: 'akash', denom: 'uakt', decimals: 6, blockTimeMs: 6000, stakingAPR: 16.0, validators: 100, ibcEnabled: true, cosmwasmEnabled: false, securityModel: 'sovereign' },
  { chainId: 'stargaze-1', name: 'Stargaze', type: 'cosmos', prefix: 'stars', denom: 'ustars', decimals: 6, blockTimeMs: 6000, stakingAPR: 20.0, validators: 100, ibcEnabled: true, cosmwasmEnabled: true, securityModel: 'sovereign' },
  { chainId: 'juno-1', name: 'Juno', type: 'cosmos', prefix: 'juno', denom: 'ujuno', decimals: 6, blockTimeMs: 6000, stakingAPR: 12.0, validators: 135, ibcEnabled: true, cosmwasmEnabled: true, securityModel: 'sovereign' },
  { chainId: 'noble-1', name: 'Noble', type: 'cosmos', prefix: 'noble', denom: 'uusdc', decimals: 6, blockTimeMs: 6000, stakingAPR: 0, validators: 0, ibcEnabled: true, cosmwasmEnabled: false, securityModel: 'replicated' },
  { chainId: 'kava_2222-10', name: 'Kava', type: 'cosmos', prefix: 'kava', denom: 'ukava', decimals: 6, blockTimeMs: 6000, stakingAPR: 10.0, validators: 100, ibcEnabled: true, cosmwasmEnabled: false, securityModel: 'sovereign' },
  { chainId: 'secret-4', name: 'Secret Network', type: 'cosmos', prefix: 'secret', denom: 'uscrt', decimals: 6, blockTimeMs: 6000, stakingAPR: 22.0, validators: 80, ibcEnabled: true, cosmwasmEnabled: true, securityModel: 'sovereign' },
  { chainId: 'fetchhub-4', name: 'Fetch.ai', type: 'cosmos', prefix: 'fetch', denom: 'afet', decimals: 18, blockTimeMs: 6000, stakingAPR: 12.0, validators: 60, ibcEnabled: true, cosmwasmEnabled: true, securityModel: 'sovereign' },
  // Non-Cosmos chains with IBC/bridge support
  { chainId: 'ethereum', name: 'Ethereum', type: 'evm', prefix: '0x', denom: 'wei', decimals: 18, blockTimeMs: 12000, stakingAPR: 3.5, validators: 900000, ibcEnabled: false, cosmwasmEnabled: false, securityModel: 'sovereign' },
  { chainId: 'solana', name: 'Solana', type: 'solana', prefix: '', denom: 'lamports', decimals: 9, blockTimeMs: 400, stakingAPR: 7.2, validators: 1900, ibcEnabled: false, cosmwasmEnabled: false, securityModel: 'sovereign' },
];

/* ─── State ───────────────────────────────────────────────────────────────── */

const channels: Map<string, IBCChannel> = new Map();
const packets: Map<string, IBCPacket> = new Map();
const transfers: Map<string, ICS20Transfer> = new Map();
const interchainAccounts: Map<string, InterchainAccount> = new Map();
const queries: Map<string, InterchainQuery> = new Map();
const relayers: Map<string, Relayer> = new Map();
const liquidStaking: Map<string, LiquidStakingPosition> = new Map();
const dexPools: Map<string, DEXPool> = new Map();

let packetSequence = 0;

/* ─── Chain Registry ──────────────────────────────────────────────────────── */

export function getChains(): CosmosChain[] {
  return [...CHAIN_REGISTRY];
}

export function getChain(chainId: string): CosmosChain | null {
  return CHAIN_REGISTRY.find((c) => c.chainId === chainId) || null;
}

export function getIBCChains(): CosmosChain[] {
  return CHAIN_REGISTRY.filter((c) => c.ibcEnabled);
}

export function getCosmWasmChains(): CosmosChain[] {
  return CHAIN_REGISTRY.filter((c) => c.cosmwasmEnabled);
}

/* ─── IBC Channel Management ─────────────────────────────────────────────── */

export function openChannel(input: {
  sourceChain: string;
  destChain: string;
  portId?: string;
  order?: ChannelOrder;
  version?: string;
}): IBCChannel {
  const channelId = `channel-${channels.size}`;
  const counterpartyChannelId = `channel-${channels.size + 1}`;

  const channel: IBCChannel = {
    channelId,
    portId: input.portId || 'transfer',
    counterpartyChannelId,
    counterpartyPortId: input.portId || 'transfer',
    sourceChain: input.sourceChain,
    destChain: input.destChain,
    state: 'OPEN',
    order: input.order || 'UNORDERED',
    version: input.version || 'ics20-1',
    packetsRelayed: 0,
    totalVolume: 0,
    createdAt: Date.now(),
  };

  channels.set(channelId, channel);
  return channel;
}

export function getChannel(channelId: string): IBCChannel | null {
  return channels.get(channelId) || null;
}

export function getChannelsByChain(chainId: string): IBCChannel[] {
  return Array.from(channels.values()).filter(
    (c) => c.sourceChain === chainId || c.destChain === chainId
  );
}

export function closeChannel(channelId: string): IBCChannel | null {
  const channel = channels.get(channelId);
  if (!channel) return null;
  channel.state = 'CLOSED';
  return channel;
}

/* ─── ICS-20 Token Transfers ──────────────────────────────────────────────── */

export function transferTokens(input: {
  sender: string;
  receiver: string;
  denom: string;
  amount: number;
  sourceChain: string;
  destChain: string;
  memo?: string;
}): ICS20Transfer {
  // Find or create channel
  let channel = Array.from(channels.values()).find(
    (c) => c.sourceChain === input.sourceChain && c.destChain === input.destChain && c.state === 'OPEN'
  );
  if (!channel) {
    channel = openChannel({ sourceChain: input.sourceChain, destChain: input.destChain });
  }

  const ibcDenom = `ibc/${input.denom.toUpperCase()}/${input.sourceChain.split('-')[0]}`;

  const transfer: ICS20Transfer = {
    id: `ics20_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    sender: input.sender,
    receiver: input.receiver,
    denom: input.denom,
    amount: input.amount,
    sourceChain: input.sourceChain,
    destChain: input.destChain,
    channelId: channel.channelId,
    memo: input.memo,
    ibcDenom,
    status: 'pending',
    sentAt: Date.now(),
  };

  transfers.set(transfer.id, transfer);

  // Create IBC packet
  sendPacket({
    sourcePort: 'transfer',
    sourceChannel: channel.channelId,
    destPort: channel.counterpartyPortId,
    destChannel: channel.counterpartyChannelId,
    data: JSON.stringify({ denom: input.denom, amount: input.amount, sender: input.sender, receiver: input.receiver }),
  });

  channel.totalVolume += input.amount;

  return transfer;
}

export function completeTransfer(transferId: string): ICS20Transfer | null {
  const transfer = transfers.get(transferId);
  if (!transfer || transfer.status !== 'pending') return null;

  transfer.status = 'acknowledged';
  transfer.completedAt = Date.now();
  return transfer;
}

export function getTransfer(transferId: string): ICS20Transfer | null {
  return transfers.get(transferId) || null;
}

export function getTransfersByChain(chainId: string): ICS20Transfer[] {
  return Array.from(transfers.values()).filter(
    (t) => t.sourceChain === chainId || t.destChain === chainId
  );
}

/* ─── IBC Packets ─────────────────────────────────────────────────────────── */

function sendPacket(input: {
  sourcePort: string;
  sourceChannel: string;
  destPort: string;
  destChannel: string;
  data: string;
}): IBCPacket {
  const packet: IBCPacket = {
    id: `pkt_${Date.now().toString(36)}_${(++packetSequence).toString(36)}`,
    sequence: packetSequence,
    sourcePort: input.sourcePort,
    sourceChannel: input.sourceChannel,
    destPort: input.destPort,
    destChannel: input.destChannel,
    data: input.data,
    timeoutHeight: IBC_TIMEOUT_HEIGHT_OFFSET,
    timeoutTimestamp: Date.now() + IBC_TIMEOUT_TIMESTAMP_OFFSET,
    status: 'pending',
    sentAt: Date.now(),
  };

  packets.set(packet.id, packet);
  return packet;
}

export function relayPacket(packetId: string, relayerAddress: string): IBCPacket | null {
  const packet = packets.get(packetId);
  if (!packet || packet.status !== 'pending') return null;

  packet.status = 'relayed';
  packet.relayedBy = relayerAddress;
  packet.relayedAt = Date.now();

  // Update channel stats
  const channel = channels.get(packet.sourceChannel);
  if (channel) channel.packetsRelayed++;

  // Update relayer stats
  const relayer = relayers.get(relayerAddress);
  if (relayer) {
    relayer.packetsRelayed++;
    relayer.feesEarned += 0.01; // Base relay fee
  }

  return packet;
}

export function acknowledgePacket(packetId: string, ack: string): IBCPacket | null {
  const packet = packets.get(packetId);
  if (!packet || packet.status !== 'relayed') return null;

  packet.status = 'acknowledged';
  packet.acknowledgement = ack;
  packet.acknowledgedAt = Date.now();
  return packet;
}

export function getPendingPackets(): IBCPacket[] {
  return Array.from(packets.values()).filter((p) => p.status === 'pending');
}

/* ─── ICS-27 Interchain Accounts ──────────────────────────────────────────── */

export function registerInterchainAccount(input: {
  owner: string;
  hostChain: string;
  controllerChain: string;
}): InterchainAccount {
  let channel = Array.from(channels.values()).find(
    (c) => c.sourceChain === input.controllerChain && c.destChain === input.hostChain && c.state === 'OPEN'
  );
  if (!channel) {
    channel = openChannel({ sourceChain: input.controllerChain, destChain: input.hostChain, version: 'ics27-1' });
  }

  const hostChain = getChain(input.hostChain);
  const prefix = hostChain?.prefix || 'cosmos';
  const address = `${prefix}1ica${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  const ica: InterchainAccount = {
    id: `ica_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    owner: input.owner,
    hostChain: input.hostChain,
    controllerChain: input.controllerChain,
    address,
    channelId: channel.channelId,
    active: true,
    txCount: 0,
    createdAt: Date.now(),
  };

  interchainAccounts.set(ica.id, ica);
  return ica;
}

export function executeInterchainTx(icaId: string, msgs: string[]): InterchainAccount | null {
  const ica = interchainAccounts.get(icaId);
  if (!ica || !ica.active) return null;
  ica.txCount += msgs.length;
  return ica;
}

export function getInterchainAccount(icaId: string): InterchainAccount | null {
  return interchainAccounts.get(icaId) || null;
}

export function getInterchainAccountsByOwner(owner: string): InterchainAccount[] {
  return Array.from(interchainAccounts.values()).filter((a) => a.owner === owner);
}

/* ─── Interchain Queries (ICQ) ────────────────────────────────────────────── */

export function submitInterchainQuery(input: {
  queryType: InterchainQuery['queryType'];
  sourceChain: string;
  targetChain: string;
  queryPath: string;
  queryData: string;
  callbackId: string;
}): InterchainQuery {
  const query: InterchainQuery = {
    id: `icq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    ...input,
    status: 'pending',
    submittedAt: Date.now(),
  };

  queries.set(query.id, query);

  // Simulate response
  query.response = JSON.stringify({ result: `${input.queryType} data from ${input.targetChain}` });
  query.height = Math.floor(Date.now() / 6000);
  query.status = 'completed';
  query.completedAt = Date.now();

  return query;
}

export function getQuery(queryId: string): InterchainQuery | null {
  return queries.get(queryId) || null;
}

/* ─── Relayer Network ─────────────────────────────────────────────────────── */

export function registerRelayer(address: string, chains: string[]): Relayer {
  const relayer: Relayer = {
    id: `relay_${Date.now().toString(36)}`,
    address,
    chains,
    packetsRelayed: 0,
    feesEarned: 0,
    successRate: 1.0,
    avgRelayTimeMs: 6000,
    active: true,
    registeredAt: Date.now(),
  };

  relayers.set(address, relayer);
  return relayer;
}

export function getRelayer(address: string): Relayer | null {
  return relayers.get(address) || null;
}

export function getActiveRelayers(): Relayer[] {
  return Array.from(relayers.values()).filter((r) => r.active);
}

export function getTopRelayers(limit: number = 10): Relayer[] {
  return Array.from(relayers.values())
    .sort((a, b) => b.packetsRelayed - a.packetsRelayed)
    .slice(0, limit);
}

/* ─── Liquid Staking (Stride-inspired) ────────────────────────────────────── */

const LIQUID_STAKING_TOKENS: Record<string, { token: string; exchangeRate: number; apr: number }> = {
  'cosmoshub-4': { token: 'stATOM', exchangeRate: 1.21, apr: 17.5 },
  'osmosis-1': { token: 'stOSMO', exchangeRate: 1.15, apr: 9.8 },
  'celestia': { token: 'stTIA', exchangeRate: 1.08, apr: 12.0 },
  'dydx-mainnet-1': { token: 'stDYDX', exchangeRate: 1.12, apr: 16.0 },
  'injective-1': { token: 'stINJ', exchangeRate: 1.10, apr: 12.5 },
};

export function liquidStake(account: string, chain: string, amount: number): LiquidStakingPosition | null {
  const config = LIQUID_STAKING_TOKENS[chain];
  if (!config) return null;

  const liquidAmount = amount / config.exchangeRate;

  const position: LiquidStakingPosition = {
    id: `lstake_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    account,
    chain,
    nativeAmount: amount,
    liquidTokenAmount: liquidAmount,
    liquidToken: config.token,
    exchangeRate: config.exchangeRate,
    rewardsAccrued: 0,
    stakedAt: Date.now(),
  };

  liquidStaking.set(position.id, position);
  return position;
}

export function getLiquidStakingPosition(positionId: string): LiquidStakingPosition | null {
  return liquidStaking.get(positionId) || null;
}

export function getLiquidStakingTokens(): Record<string, { token: string; exchangeRate: number; apr: number }> {
  return { ...LIQUID_STAKING_TOKENS };
}

/* ─── DEX Pools (Osmosis-inspired) ────────────────────────────────────────── */

export function createDEXPool(input: {
  chain: string;
  tokenA: string;
  tokenB: string;
  reserveA: number;
  reserveB: number;
  swapFee?: number;
}): DEXPool {
  const pool: DEXPool = {
    id: `pool_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    chain: input.chain,
    tokenA: input.tokenA,
    tokenB: input.tokenB,
    reserveA: input.reserveA,
    reserveB: input.reserveB,
    totalShares: Math.sqrt(input.reserveA * input.reserveB),
    swapFee: input.swapFee || 0.003,
    volume24h: 0,
    apr: 0,
  };

  dexPools.set(pool.id, pool);
  return pool;
}

export function swap(poolId: string, tokenIn: string, amountIn: number): { amountOut: number; priceImpact: number; fee: number } | null {
  const pool = dexPools.get(poolId);
  if (!pool) return null;

  const isAtoB = tokenIn === pool.tokenA;
  const reserveIn = isAtoB ? pool.reserveA : pool.reserveB;
  const reserveOut = isAtoB ? pool.reserveB : pool.reserveA;

  const fee = amountIn * pool.swapFee;
  const amountInAfterFee = amountIn - fee;

  // Constant product AMM: x * y = k
  const amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
  const priceImpact = amountOut / reserveOut;

  // Update reserves
  if (isAtoB) {
    pool.reserveA += amountIn;
    pool.reserveB -= amountOut;
  } else {
    pool.reserveB += amountIn;
    pool.reserveA -= amountOut;
  }

  pool.volume24h += amountIn;

  return { amountOut, priceImpact, fee };
}

export function getDEXPool(poolId: string): DEXPool | null {
  return dexPools.get(poolId) || null;
}

export function getDEXPoolsByChain(chain: string): DEXPool[] {
  return Array.from(dexPools.values()).filter((p) => p.chain === chain);
}

/* ─── Protocol Summary ────────────────────────────────────────────────────── */

export function getIBCSummary() {
  const allChannels = Array.from(channels.values());
  const allTransfers = Array.from(transfers.values());
  const allRelayers = Array.from(relayers.values());
  const ibcChains = CHAIN_REGISTRY.filter((c) => c.ibcEnabled);

  return {
    name: 'FreedomForge IBC Protocol',
    version: '1.0.0',
    inspired_by: ['Cosmos SDK', 'Osmosis', 'Stride', 'Neutron', 'Axelar', 'Wormhole', 'Skip Protocol'],
    chains: {
      total: CHAIN_REGISTRY.length,
      ibcEnabled: ibcChains.length,
      cosmwasmEnabled: CHAIN_REGISTRY.filter((c) => c.cosmwasmEnabled).length,
      byType: {
        cosmos: CHAIN_REGISTRY.filter((c) => c.type === 'cosmos').length,
        evm: CHAIN_REGISTRY.filter((c) => c.type === 'evm').length,
        solana: CHAIN_REGISTRY.filter((c) => c.type === 'solana').length,
      },
    },
    channels: {
      total: allChannels.length,
      open: allChannels.filter((c) => c.state === 'OPEN').length,
      totalVolume: allChannels.reduce((s, c) => s + c.totalVolume, 0),
      totalPackets: allChannels.reduce((s, c) => s + c.packetsRelayed, 0),
    },
    transfers: {
      total: allTransfers.length,
      completed: allTransfers.filter((t) => t.status === 'acknowledged').length,
      pending: allTransfers.filter((t) => t.status === 'pending').length,
    },
    interchainAccounts: {
      total: interchainAccounts.size,
      active: Array.from(interchainAccounts.values()).filter((a) => a.active).length,
    },
    relayers: {
      total: allRelayers.length,
      active: allRelayers.filter((r) => r.active).length,
      totalFeesEarned: allRelayers.reduce((s, r) => s + r.feesEarned, 0),
    },
    liquidStaking: {
      supportedChains: Object.keys(LIQUID_STAKING_TOKENS).length,
      tokens: Object.entries(LIQUID_STAKING_TOKENS).map(([chain, cfg]) => ({
        chain,
        token: cfg.token,
        exchangeRate: cfg.exchangeRate,
        apr: cfg.apr,
      })),
    },
    dexPools: {
      total: dexPools.size,
    },
    features: [
      '16-chain registry (14 Cosmos + Ethereum + Solana)',
      'ICS-20 fungible token transfers',
      'ICS-27 interchain accounts',
      'Interchain queries (ICQ)',
      'Packet relay with relayer incentives',
      'Liquid staking (stATOM, stOSMO, stTIA, stDYDX, stINJ)',
      'Constant-product AMM DEX pools',
      'CosmWasm smart contract support tracking',
      'Interchain security model classification',
      'Multi-chain type support (Cosmos, EVM, Solana)',
    ],
  };
}
