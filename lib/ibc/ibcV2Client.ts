/**
 * IBC v2 Client — Inter-Blockchain Communication Protocol v2
 *
 * Provides cross-chain transfer and messaging capabilities for the
 * FreedomForge impact fund using the IBC v2 protocol (Cosmos ecosystem).
 *
 * Supports: Cosmos Hub, Osmosis, and IBC-compatible chains.
 * Used for routing impact fund allocations across chains.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface IBCChannel {
  channelId: string;
  counterpartyChannelId: string;
  sourceChain: string;
  destChain: string;
  portId: string;
  state: 'OPEN' | 'CLOSED' | 'INIT' | 'TRYOPEN';
  ordering: 'ORDERED' | 'UNORDERED';
}

export interface IBCTransfer {
  id: string;
  sourceChain: string;
  destChain: string;
  channelId: string;
  sender: string;
  receiver: string;
  denom: string;
  amount: string;
  sequence: number;
  timeout: number;
  txHash: string | null;
  status: 'pending' | 'sent' | 'received' | 'timeout' | 'failed';
  createdAt: number;
  updatedAt: number;
}

export interface IBCChainConfig {
  chainId: string;
  name: string;
  rpcUrl: string;
  restUrl: string;
  denom: string;
  prefix: string;
  decimals: number;
}

// ─── Chain Registry ──────────────────────────────────────────────────────────

export const IBC_CHAINS: IBCChainConfig[] = [
  {
    chainId: 'cosmoshub-4',
    name: 'Cosmos Hub',
    rpcUrl: process.env.COSMOS_RPC_URL || 'https://rpc.cosmos.network',
    restUrl: 'https://api.cosmos.network',
    denom: 'uatom',
    prefix: 'cosmos',
    decimals: 6,
  },
  {
    chainId: 'osmosis-1',
    name: 'Osmosis',
    rpcUrl: 'https://rpc.osmosis.zone',
    restUrl: 'https://lcd.osmosis.zone',
    denom: 'uosmo',
    prefix: 'osmo',
    decimals: 6,
  },
  {
    chainId: 'noble-1',
    name: 'Noble (USDC)',
    rpcUrl: 'https://noble-rpc.polkachu.com',
    restUrl: 'https://noble-api.polkachu.com',
    denom: 'uusdc',
    prefix: 'noble',
    decimals: 6,
  },
];

// Well-known IBC channels for impact fund routing
export const KNOWN_CHANNELS: IBCChannel[] = [
  {
    channelId: 'channel-0',
    counterpartyChannelId: 'channel-141',
    sourceChain: 'cosmoshub-4',
    destChain: 'osmosis-1',
    portId: 'transfer',
    state: 'OPEN',
    ordering: 'UNORDERED',
  },
  {
    channelId: 'channel-750',
    counterpartyChannelId: 'channel-0',
    sourceChain: 'osmosis-1',
    destChain: 'noble-1',
    portId: 'transfer',
    state: 'OPEN',
    ordering: 'UNORDERED',
  },
];

// ─── IBC v2 Client ───────────────────────────────────────────────────────────

export class IBCv2Client {
  private transfers: IBCTransfer[] = [];

  constructor(private config: { defaultChain?: string } = {}) {}

  /**
   * Get the list of open IBC channels for the impact fund.
   */
  getChannels(sourceChain?: string): IBCChannel[] {
    if (sourceChain) {
      return KNOWN_CHANNELS.filter((c) => c.sourceChain === sourceChain);
    }
    return KNOWN_CHANNELS;
  }

  /**
   * Get chain configuration by chain ID.
   */
  getChain(chainId: string): IBCChainConfig | null {
    return IBC_CHAINS.find((c) => c.chainId === chainId) ?? null;
  }

  /**
   * Query the on-chain IBC channel status via REST API.
   */
  async queryChannelStatus(sourceChain: string, channelId: string): Promise<IBCChannel | null> {
    const chain = this.getChain(sourceChain);
    if (!chain) return null;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(
        `${chain.restUrl}/ibc/core/channel/v1/channels/${channelId}/ports/transfer`,
        { signal: controller.signal }
      );
      clearTimeout(timer);
      if (!res.ok) return null;

      const data = await res.json() as {
        channel?: { state?: string; ordering?: string; counterparty?: { channel_id?: string } }
      };

      const ch = data.channel;
      if (!ch) return null;

      const VALID_STATES: IBCChannel['state'][] = ['OPEN', 'CLOSED', 'INIT', 'TRYOPEN'];
      const VALID_ORDERINGS: IBCChannel['ordering'][] = ['ORDERED', 'UNORDERED'];

      const rawState = ch.state?.toUpperCase();
      const rawOrdering = ch.ordering?.toUpperCase();

      const state: IBCChannel['state'] = VALID_STATES.includes(rawState as IBCChannel['state'])
        ? (rawState as IBCChannel['state'])
        : 'OPEN';
      const ordering: IBCChannel['ordering'] = VALID_ORDERINGS.includes(rawOrdering as IBCChannel['ordering'])
        ? (rawOrdering as IBCChannel['ordering'])
        : 'UNORDERED';

      return {
        channelId,
        counterpartyChannelId: ch.counterparty?.channel_id || '',
        sourceChain,
        destChain: '', // resolved from counterparty
        portId: 'transfer',
        state,
        ordering,
      };
    } catch {
      return null;
    }
  }

  /**
   * Initiate an IBC transfer (returns a tracked transfer object).
   * In production this would sign and broadcast a MsgTransfer tx.
   */
  initiateTransfer(params: {
    sourceChain: string;
    destChain: string;
    sender: string;
    receiver: string;
    denom: string;
    amount: string;
    memo?: string;
  }): IBCTransfer {
    const channel = KNOWN_CHANNELS.find(
      (c) => c.sourceChain === params.sourceChain && c.destChain === params.destChain
    );

    const transfer: IBCTransfer = {
      id: `ibc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sourceChain: params.sourceChain,
      destChain: params.destChain,
      channelId: channel?.channelId || 'channel-0',
      sender: params.sender,
      receiver: params.receiver,
      denom: params.denom,
      amount: params.amount,
      sequence: this.transfers.length + 1,
      timeout: Date.now() + 10 * 60 * 1000, // 10 minute timeout
      txHash: null,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.transfers.push(transfer);
    return transfer;
  }

  /**
   * Get all tracked transfers.
   */
  getTransfers(): IBCTransfer[] {
    return [...this.transfers];
  }

  /**
   * Check the status of a pending transfer.
   */
  async checkTransferStatus(transferId: string): Promise<IBCTransfer | null> {
    const transfer = this.transfers.find((t) => t.id === transferId);
    if (!transfer) return null;

    if (transfer.status === 'pending' && Date.now() > transfer.timeout) {
      transfer.status = 'timeout';
      transfer.updatedAt = Date.now();
    }

    return transfer;
  }

  /**
   * Get a summary of the IBC routing capabilities.
   */
  getSummary(): {
    supportedChains: string[];
    openChannels: number;
    pendingTransfers: number;
    completedTransfers: number;
  } {
    return {
      supportedChains: IBC_CHAINS.map((c) => c.name),
      openChannels: KNOWN_CHANNELS.filter((c) => c.state === 'OPEN').length,
      pendingTransfers: this.transfers.filter((t) => t.status === 'pending').length,
      completedTransfers: this.transfers.filter((t) => t.status === 'received').length,
    };
  }
}

// Singleton instance
let _ibcClient: IBCv2Client | null = null;
export function getIBCv2Client(): IBCv2Client {
  if (!_ibcClient) {
    _ibcClient = new IBCv2Client();
  }
  return _ibcClient;
}
