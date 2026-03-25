// Bittensor Metagraph Client
// Queries taostats.io for subnet and neuron data without requiring Substrate WebSocket or sr25519 signing.
// Used for subnet health monitoring and miner discovery — actual inference goes through Corcel gateway.

export interface BittensorSubnet {
  netuid: number;
  name: string;           // human label (community-maintained, not on-chain)
  neuronCount: number;
  emissionRate: number;   // TAO per block
  activeMiners: number;
  avgIncentive: number;   // 0-1
  isHealthy: boolean;     // avgIncentive > 0.3 && activeMiners > 5
}

export interface BittensorNeuron {
  uid: number;
  netuid: number;
  hotkey: string;
  stake: number;
  incentive: number;    // 0-1
  trust: number;        // 0-1
  consensus: number;    // 0-1
  active: boolean;
  axonIp?: string;
  axonPort?: number;
}

// Community-maintained subnet name map (not on-chain)
export const KNOWN_SUBNETS: Record<number, string> = {
  1: 'apex-text-generation',
  3: 'myshell-creative',
  5: 'openkaito-search',
  8: 'taoshi-trading-signals',
  13: 'dataverse-data',
  18: 'cortex-multimodal',     // Corcel's subnet
  21: 'filetao-storage',
  22: 'meta-general-reasoning',
  25: 'hivemind-collective',
  37: 'fine-tuning',
};

const TAOSTATS_BASE = 'https://taostats.io/api/v1';
const FETCH_TIMEOUT_MS = 15_000;

function createTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(FETCH_TIMEOUT_MS);
}

interface TaostatsSubnetResponse {
  netuid?: number;
  neuron_count?: number;
  emission?: number;
  active_miners?: number;
  avg_incentive?: number;
  [key: string]: unknown;
}

interface TaostatsNeuronResponse {
  uid?: number;
  netuid?: number;
  hotkey?: string;
  stake?: number;
  incentive?: number;
  trust?: number;
  consensus?: number;
  active?: boolean;
  axon_ip?: string;
  axon_port?: number;
  [key: string]: unknown;
}

/**
 * Fetches subnet info from taostats.io for the given netuid.
 * Returns null on 404 or any network/parse error.
 */
export async function getSubnetInfo(netuid: number): Promise<BittensorSubnet | null> {
  try {
    const response = await fetch(`${TAOSTATS_BASE}/subnet/${netuid}`, {
      signal: createTimeoutSignal(),
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as TaostatsSubnetResponse;

    const neuronCount = Number(data.neuron_count ?? 0);
    const emissionRate = Number(data.emission ?? 0);
    const activeMiners = Number(data.active_miners ?? 0);
    const avgIncentive = Number(data.avg_incentive ?? 0);

    return {
      netuid,
      name: KNOWN_SUBNETS[netuid] ?? `subnet-${netuid}`,
      neuronCount,
      emissionRate,
      activeMiners,
      avgIncentive,
      isHealthy: avgIncentive > 0.3 && activeMiners > 5,
    };
  } catch {
    return null;
  }
}

/**
 * Fetches top miners for a subnet, sorted by incentive descending.
 * Returns [] on any network/parse error.
 */
export async function getTopMiners(netuid: number, limit = 10): Promise<BittensorNeuron[]> {
  try {
    const url = `${TAOSTATS_BASE}/subnet/${netuid}/neurons?limit=${limit}&sort=incentive&order=desc`;
    const response = await fetch(url, {
      signal: createTimeoutSignal(),
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as TaostatsNeuronResponse[] | { neurons?: TaostatsNeuronResponse[] };

    const neurons: TaostatsNeuronResponse[] = Array.isArray(data)
      ? data
      : (data.neurons ?? []);

    return neurons.map((n) => ({
      uid: Number(n.uid ?? 0),
      netuid: Number(n.netuid ?? netuid),
      hotkey: String(n.hotkey ?? ''),
      stake: Number(n.stake ?? 0),
      incentive: Number(n.incentive ?? 0),
      trust: Number(n.trust ?? 0),
      consensus: Number(n.consensus ?? 0),
      active: Boolean(n.active ?? false),
      ...(n.axon_ip != null ? { axonIp: String(n.axon_ip) } : {}),
      ...(n.axon_port != null ? { axonPort: Number(n.axon_port) } : {}),
    }));
  } catch {
    return [];
  }
}

/**
 * Checks whether a subnet is healthy (avgIncentive > 0.3 && activeMiners > 5).
 * Returns false on any error.
 */
export async function checkSubnetHealth(netuid: number): Promise<boolean> {
  const subnet = await getSubnetInfo(netuid);
  return subnet?.isHealthy ?? false;
}
