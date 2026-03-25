// Subnet Router
// Maps query types to optimal Bittensor subnets.
// Used to select the most appropriate Corcel model variant for a given query.

import { KNOWN_SUBNETS } from './metagraph';

export type SubnetIntent =
  | 'text-generation'
  | 'search-augmented'
  | 'trading-signals'
  | 'creative'
  | 'data-retrieval'
  | 'general';

export interface SubnetRecommendation {
  netuid: number;
  subnetName: string;
  intent: SubnetIntent;
  corcelModel: string;    // Corcel model string to use
  confidence: number;     // 0-1
  rationale: string;
}

/**
 * Regex-based query classifier.
 * Returns the most specific matching intent, or 'general' as fallback.
 */
export function classifySubnetIntent(query: string): SubnetIntent {
  if (/(trade|stock|crypto|market|price|signal|portfolio|forex|futures|options|alpha|yield|apy|defi)/i.test(query)) {
    return 'trading-signals';
  }
  if (/(search|find|latest|current|news|recent|today|2024|2025|2026|lookup|who is|what is)/i.test(query)) {
    return 'search-augmented';
  }
  if (/(write|story|poem|creative|song|lyrics|fiction|imagine|generate|art)/i.test(query)) {
    return 'creative';
  }
  if (/(data|dataset|statistics|numbers|table|csv|raw|historical)/i.test(query)) {
    return 'data-retrieval';
  }
  if (/(explain|summarize|analyze|compare|describe|how to|what are)/i.test(query)) {
    return 'text-generation';
  }
  return 'general';
}

const SUBNET_RECOMMENDATIONS: Record<SubnetIntent, SubnetRecommendation> = {
  'trading-signals': {
    netuid: 8,
    subnetName: KNOWN_SUBNETS[8],
    intent: 'trading-signals',
    corcelModel: 'cortext-ultra',
    confidence: 0.9,
    rationale: 'Taoshi trading signals subnet specializes in market intelligence and quantitative signal generation',
  },
  'search-augmented': {
    netuid: 5,
    subnetName: KNOWN_SUBNETS[5],
    intent: 'search-augmented',
    corcelModel: 'cortext-ultra',
    confidence: 0.85,
    rationale: 'OpenKaito search subnet provides real-time web-augmented retrieval for current information queries',
  },
  creative: {
    netuid: 3,
    subnetName: KNOWN_SUBNETS[3],
    intent: 'creative',
    corcelModel: 'cortext-lite',
    confidence: 0.75,
    rationale: 'MyShell creative subnet is optimized for generative and expressive content production',
  },
  'data-retrieval': {
    netuid: 13,
    subnetName: KNOWN_SUBNETS[13],
    intent: 'data-retrieval',
    corcelModel: 'cortext-ultra',
    confidence: 0.8,
    rationale: 'Dataverse subnet specializes in structured dataset access and statistical data retrieval',
  },
  'text-generation': {
    netuid: 1,
    subnetName: KNOWN_SUBNETS[1],
    intent: 'text-generation',
    corcelModel: 'cortext-ultra',
    confidence: 0.85,
    rationale: 'Apex text generation subnet is the flagship LLM subnet for analytical and explanatory tasks',
  },
  general: {
    netuid: 18,
    subnetName: KNOWN_SUBNETS[18],
    intent: 'general',
    corcelModel: 'cortext-ultra',
    confidence: 0.7,
    rationale: "Corcel's multimodal subnet (netuid 18) provides balanced general-purpose inference via the Corcel gateway",
  },
};

/**
 * Returns the best SubnetRecommendation for the given intent.
 */
export function recommendSubnet(intent: SubnetIntent): SubnetRecommendation {
  return SUBNET_RECOMMENDATIONS[intent];
}

/**
 * Returns a short string for LLM context injection describing the selected subnet.
 * Example: "[Bittensor subnet 8 / taoshi-trading-signals selected for trading-signals query — collective miner consensus active]"
 */
export function getBittensorContext(query: string): string {
  const intent = classifySubnetIntent(query);
  const rec = recommendSubnet(intent);
  return `[Bittensor subnet ${rec.netuid} / ${rec.subnetName} selected for ${intent} query — collective miner consensus active]`;
}
