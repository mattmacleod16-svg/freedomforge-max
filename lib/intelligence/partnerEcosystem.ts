/**
 * Partner Ecosystem Registry — FreedomForge Max.
 * ════════════════════════════════════════════════
 *
 * Tracks all blockchain, DeFi, DePIN, AI infrastructure, and data partners
 * that FreedomForge can integrate with for maximum global reach.
 *
 * Used by:
 *  - Skills matrix for domain capability mapping
 *  - Token marketing for partnership announcements
 *  - Model orchestrator for compute routing decisions
 *  - Trading engine for venue selection
 */

export type PartnerCategory =
  | 'blockchain'
  | 'defi'
  | 'depin'
  | 'ai-compute'
  | 'data'
  | 'trading'
  | 'payments'
  | 'identity'
  | 'investigative';

export type IntegrationPhase = 'live' | 'building' | 'planned' | 'researching';

export interface Partner {
  id: string;
  name: string;
  category: PartnerCategory;
  description: string;
  website: string;
  chain?: string;
  token?: string;
  phase: IntegrationPhase;
  priority: number;  // 0 = highest
  capabilities: string[];
  forgeIntegration: string;  // How it connects to FreedomForge
}

export const PARTNER_ECOSYSTEM: Partner[] = [
  // ─── Blockchain Infrastructure ──────────────────────────────────────
  {
    id: 'alchemy',
    name: 'Alchemy',
    category: 'blockchain',
    description: 'Multi-chain RPC and SDK for EVM blockchain operations',
    website: 'https://www.alchemy.com',
    chain: 'Ethereum, Base, Polygon, Arbitrum, Optimism',
    phase: 'live',
    priority: 0,
    capabilities: ['rpc', 'nft-api', 'token-api', 'webhooks', 'gas-estimation'],
    forgeIntegration: 'Core wallet operations, balance tracking, revenue distribution',
  },
  {
    id: 'helius',
    name: 'Helius',
    category: 'blockchain',
    description: 'Solana #1 RPC and API platform with LaserStream and Sender',
    website: 'https://www.helius.dev',
    chain: 'Solana',
    phase: 'planned',
    priority: 0,
    capabilities: ['rpc', 'grpc-streaming', 'ultra-low-latency-tx', 'staked-connections', 'webhooks'],
    forgeIntegration: 'Solana trading execution, real-time block streaming, $FORGE SPL bridge',
  },
  {
    id: 'multiversx',
    name: 'MultiversX',
    category: 'blockchain',
    description: 'Internet-scale blockchain with ESDT tokens and Sovereign Chains',
    website: 'https://multiversx.com',
    chain: 'MultiversX',
    token: 'EGLD',
    phase: 'live',
    priority: 1,
    capabilities: ['esdt-tokens', 'sovereign-chains', 'space-vm', 'smart-contracts'],
    forgeIntegration: 'Existing MultiversX client, $FORGE ESDT deployment planned',
  },

  // ─── DeFi Protocols ─────────────────────────────────────────────────
  {
    id: 'world-liberty-financial',
    name: 'World Liberty Financial',
    category: 'defi',
    description: 'DeFi + TradFi bridge with USD1 stablecoin, WLFI lending, and AgentPay SDK',
    website: 'https://worldlibertyfinancial.com',
    chain: 'Ethereum, BSC, Solana',
    token: 'WLFI',
    phase: 'researching',
    priority: 0,
    capabilities: ['agentpay-sdk', 'stablecoin', 'lending', 'governance', 'cross-chain'],
    forgeIntegration: 'AgentPay SDK for autonomous agent payments with policy enforcement',
  },
  {
    id: 'based-one',
    name: 'Based.one',
    category: 'trading',
    description: 'Trade everything, spend everywhere. Terminal + prediction markets + Visa card on Hyperliquid',
    website: 'https://based.one',
    chain: 'Hyperliquid',
    phase: 'researching',
    priority: 1,
    capabilities: ['trading-terminal', 'prediction-markets', 'visa-card', 'affiliates'],
    forgeIntegration: 'Prediction market data feed, Hyperliquid trading venue, fiat off-ramp via card',
  },
  {
    id: 'polymarket',
    name: 'Polymarket',
    category: 'trading',
    description: 'Leading prediction market platform with CLOB',
    website: 'https://polymarket.com',
    chain: 'Polygon',
    phase: 'live',
    priority: 0,
    capabilities: ['prediction-markets', 'clob', 'market-data', 'gamma-api'],
    forgeIntegration: 'Core prediction market trading, forecast calibration data',
  },

  // ─── DePIN Infrastructure ───────────────────────────────────────────
  {
    id: 'geodnet',
    name: 'GEODNET',
    category: 'depin',
    description: 'World largest RTK network (19K+ stations). DePIN geospatial data.',
    website: 'https://geodnet.com',
    token: 'GEOD',
    phase: 'researching',
    priority: 2,
    capabilities: ['rtk-positioning', 'geospatial-data', 'atmospheric-data', 'depin-mining'],
    forgeIntegration: 'Geospatial data feed for risk monitoring, supply chain intelligence',
  },
  {
    id: 'aethir',
    name: 'Aethir',
    category: 'ai-compute',
    description: 'Decentralized GPU compute for enterprise AI workloads',
    website: 'https://aethir.com',
    token: 'ATH',
    phase: 'planned',
    priority: 1,
    capabilities: ['gpu-compute', 'ai-inference', 'decentralized-cloud', 'enterprise-grade'],
    forgeIntegration: 'Decentralized inference fallback when centralized providers are expensive/down',
  },
  {
    id: 'akash',
    name: 'Akash Network',
    category: 'ai-compute',
    description: 'Decentralized cloud marketplace — alternative to centralized clouds',
    website: 'https://akash.network',
    token: 'AKT',
    phase: 'planned',
    priority: 1,
    capabilities: ['cloud-marketplace', 'gpu-compute', 'cpu-compute', 'storage'],
    forgeIntegration: 'Cost-optimized compute for batch ML training and non-latency-critical inference',
  },
  {
    id: 'render',
    name: 'Render Network',
    category: 'ai-compute',
    description: 'Distributed GPU compute for AI and 3D rendering at scale',
    website: 'https://rendernetwork.com',
    token: 'RENDER',
    phase: 'researching',
    priority: 2,
    capabilities: ['gpu-rendering', 'ai-compute', 'distributed-processing'],
    forgeIntegration: 'Heavy compute tasks: model fine-tuning, large-scale backtesting',
  },

  // ─── AI Infrastructure ──────────────────────────────────────────────
  {
    id: 'nvidia',
    name: 'NVIDIA',
    category: 'ai-compute',
    description: 'GPU infrastructure, NIM inference, NemoClaw local AI, Vera platform',
    website: 'https://nvidianews.nvidia.com',
    phase: 'live',
    priority: 0,
    capabilities: ['nim-inference', 'nemoclaw', 'gpu-cloud', 'rtx-local', 'tensorrt'],
    forgeIntegration: 'NVIDIA NIM model provider (live), NemoClaw local deployment target',
  },

  // ─── Data & Intelligence ────────────────────────────────────────────
  {
    id: 'occrp',
    name: 'OCCRP',
    category: 'investigative',
    description: 'International investigative journalism with Aleph Pro data platform',
    website: 'https://www.occrp.org',
    phase: 'researching',
    priority: 2,
    capabilities: ['open-source-investigation', 'data-connections', 'sanctions-tracking', 'forensics'],
    forgeIntegration: 'Investigation methodology for anomaly detection, on-chain forensics, compliance',
  },

  // ─── Identity & Standards ───────────────────────────────────────────
  {
    id: 'erc8004',
    name: 'ERC-8004 Agent Identity',
    category: 'identity',
    description: 'Verifiable on-chain identities for AI agents (2026 standard)',
    website: 'https://eips.ethereum.org',
    chain: 'Ethereum, BNB Chain',
    phase: 'researching',
    priority: 1,
    capabilities: ['agent-identity', 'verifiable-credentials', 'on-chain-identity'],
    forgeIntegration: 'On-chain verifiable identity for FreedomForge autonomous agents',
  },

  // ─── Payments ───────────────────────────────────────────────────────
  {
    id: 'xrp-healthcare',
    name: 'XRP Healthcare',
    category: 'payments',
    description: 'AI-driven healthcare on XRP Ledger with HIPAA-grade wallet',
    website: 'https://xrphealthcare.com',
    chain: 'XRP Ledger',
    token: 'XRPH',
    phase: 'researching',
    priority: 3,
    capabilities: ['hipaa-compliance', 'healthcare-payments', 'xrp-integration'],
    forgeIntegration: 'Compliance-first token design patterns, healthcare data intelligence domain',
  },
];

// ─── Query Functions ──────────────────────────────────────────────────────────

export function getPartnersByCategory(category: PartnerCategory): Partner[] {
  return PARTNER_ECOSYSTEM.filter((p) => p.category === category);
}

export function getPartnersByPhase(phase: IntegrationPhase): Partner[] {
  return PARTNER_ECOSYSTEM.filter((p) => p.phase === phase);
}

export function getLivePartners(): Partner[] {
  return PARTNER_ECOSYSTEM.filter((p) => p.phase === 'live');
}

export function getEcosystemStats() {
  const byCategory: Record<string, number> = {};
  const byPhase: Record<string, number> = {};

  for (const p of PARTNER_ECOSYSTEM) {
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    byPhase[p.phase] = (byPhase[p.phase] || 0) + 1;
  }

  return {
    totalPartners: PARTNER_ECOSYSTEM.length,
    byCategory,
    byPhase,
    liveIntegrations: PARTNER_ECOSYSTEM.filter((p) => p.phase === 'live').length,
    totalCapabilities: new Set(PARTNER_ECOSYSTEM.flatMap((p) => p.capabilities)).size,
    chains: [...new Set(PARTNER_ECOSYSTEM.filter((p) => p.chain).map((p) => p.chain))],
  };
}
