/**
 * Restaking & Liquid Staking Protocol — FreedomForge Max
 * ════════════════════════════════════════════════════════
 *
 * Shared security and yield-maximizing staking infrastructure:
 *
 *  • EigenLayer — Restaking ETH/LSTs to secure AVSs (Actively Validated Services)
 *  • Lido — stETH liquid staking with validator decentralization
 *  • Ether.fi — eETH native restaking with EigenPod management
 *  • Rocket Pool — rETH permissionless node operator staking
 *  • Symbiotic — Flexible restaking with customizable slashing
 *  • Jito — Solana MEV-aware liquid staking (jitoSOL)
 *  • Marinade — Solana stake pool (mSOL) with algorithmic delegation
 *  • Karak — Multi-asset restaking (ETH, stables, L2 tokens)
 *  • Kelp DAO — rsETH restaked liquid token
 *  • Renzo — ezETH liquid restaking aggregator
 *  • Puffer Finance — pufETH anti-slashing restaking
 *  • Swell — swETH liquid staking + rswETH restaking
 *
 * Inspired by: EigenLayer, Lido, Ether.fi, Symbiotic, Jito, Rocket Pool
 */

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type StakingProtocol = 'eigenlayer' | 'lido' | 'etherfi' | 'rocketpool' | 'symbiotic' | 'jito' | 'marinade' | 'karak' | 'kelp' | 'renzo' | 'puffer' | 'swell';
export type AVSCategory = 'oracle' | 'bridge' | 'rollup' | 'da_layer' | 'coprocessor' | 'interop' | 'keeper' | 'sequencer';
export type SlashingCondition = 'double_sign' | 'downtime' | 'invalid_state' | 'censorship' | 'custom';
export type StakingChain = 'ethereum' | 'solana' | 'cosmos';

export interface LiquidStakingToken {
  symbol: string;
  protocol: StakingProtocol;
  chain: StakingChain;
  underlyingAsset: string;
  exchangeRate: number;
  totalStaked: number;
  totalSupply: number;
  apr: number;
  validatorCount: number;
  withdrawalDelay: string;
  isRestakeable: boolean;
}

export interface RestakingPosition {
  id: string;
  account: string;
  protocol: StakingProtocol;
  asset: string;
  liquidToken: string;
  amount: number;
  liquidTokenAmount: number;
  restaked: boolean;
  avs: string[];
  rewardsEarned: number;
  slashingRisk: number;
  stakedAt: number;
}

export interface AVS {
  id: string;
  name: string;
  category: AVSCategory;
  description: string;
  chain: StakingChain;
  totalRestaked: number;
  operatorCount: number;
  rewardRate: number;
  slashingConditions: SlashingCondition[];
  minOperatorStake: number;
  tvl: number;
  active: boolean;
  launchedAt: number;
}

export interface Operator {
  id: string;
  address: string;
  name: string;
  totalDelegated: number;
  selfStake: number;
  delegators: number;
  avsList: string[];
  commission: number;
  performanceScore: number;
  slashingHistory: Array<{ avsId: string; amount: number; reason: SlashingCondition; timestamp: number }>;
  registeredAt: number;
}

export interface WithdrawalRequest {
  id: string;
  account: string;
  protocol: StakingProtocol;
  asset: string;
  amount: number;
  status: 'pending' | 'ready' | 'completed';
  requestedAt: number;
  readyAt: number;
  completedAt?: number;
}

export interface SlashingEvent {
  id: string;
  operator: string;
  avs: string;
  condition: SlashingCondition;
  amountSlashed: number;
  evidence: string;
  timestamp: number;
}

/* ─── Liquid Staking Token Registry ───────────────────────────────────────── */

const LST_REGISTRY: LiquidStakingToken[] = [
  // Ethereum LSTs
  { symbol: 'stETH', protocol: 'lido', chain: 'ethereum', underlyingAsset: 'ETH', exchangeRate: 1.0, totalStaked: 9_500_000, totalSupply: 9_500_000, apr: 3.3, validatorCount: 38, withdrawalDelay: '1-5 days', isRestakeable: true },
  { symbol: 'wstETH', protocol: 'lido', chain: 'ethereum', underlyingAsset: 'ETH', exchangeRate: 1.175, totalStaked: 7_200_000, totalSupply: 6_127_659, apr: 3.3, validatorCount: 38, withdrawalDelay: '1-5 days', isRestakeable: true },
  { symbol: 'eETH', protocol: 'etherfi', chain: 'ethereum', underlyingAsset: 'ETH', exchangeRate: 1.0, totalStaked: 2_100_000, totalSupply: 2_100_000, apr: 3.8, validatorCount: 200, withdrawalDelay: '7 days', isRestakeable: true },
  { symbol: 'weETH', protocol: 'etherfi', chain: 'ethereum', underlyingAsset: 'ETH', exchangeRate: 1.05, totalStaked: 2_100_000, totalSupply: 2_000_000, apr: 4.5, validatorCount: 200, withdrawalDelay: '7 days', isRestakeable: true },
  { symbol: 'rETH', protocol: 'rocketpool', chain: 'ethereum', underlyingAsset: 'ETH', exchangeRate: 1.12, totalStaked: 1_100_000, totalSupply: 982_143, apr: 3.1, validatorCount: 3700, withdrawalDelay: 'Variable', isRestakeable: true },
  { symbol: 'pufETH', protocol: 'puffer', chain: 'ethereum', underlyingAsset: 'ETH', exchangeRate: 1.02, totalStaked: 450_000, totalSupply: 441_176, apr: 3.9, validatorCount: 100, withdrawalDelay: '7 days', isRestakeable: true },
  { symbol: 'swETH', protocol: 'swell', chain: 'ethereum', underlyingAsset: 'ETH', exchangeRate: 1.04, totalStaked: 380_000, totalSupply: 365_385, apr: 3.5, validatorCount: 30, withdrawalDelay: '7 days', isRestakeable: true },
  { symbol: 'rsETH', protocol: 'kelp', chain: 'ethereum', underlyingAsset: 'ETH', exchangeRate: 1.06, totalStaked: 500_000, totalSupply: 471_698, apr: 4.2, validatorCount: 0, withdrawalDelay: '7 days', isRestakeable: true },
  { symbol: 'ezETH', protocol: 'renzo', chain: 'ethereum', underlyingAsset: 'ETH', exchangeRate: 1.03, totalStaked: 900_000, totalSupply: 873_786, apr: 4.0, validatorCount: 0, withdrawalDelay: '7 days', isRestakeable: true },
  // Solana LSTs
  { symbol: 'mSOL', protocol: 'marinade', chain: 'solana', underlyingAsset: 'SOL', exchangeRate: 1.21, totalStaked: 8_500_000, totalSupply: 7_024_793, apr: 7.2, validatorCount: 450, withdrawalDelay: '1-2 epochs (~3 days)', isRestakeable: false },
  { symbol: 'jitoSOL', protocol: 'jito', chain: 'solana', underlyingAsset: 'SOL', exchangeRate: 1.18, totalStaked: 14_000_000, totalSupply: 11_864_407, apr: 7.8, validatorCount: 200, withdrawalDelay: '1-2 epochs', isRestakeable: false },
];

/* ─── AVS Registry ────────────────────────────────────────────────────────── */

const AVS_REGISTRY: AVS[] = [
  { id: 'eigenda', name: 'EigenDA', category: 'da_layer', description: 'Data availability layer secured by restaked ETH', chain: 'ethereum', totalRestaked: 3_500_000, operatorCount: 250, rewardRate: 0.04, slashingConditions: ['invalid_state', 'downtime'], minOperatorStake: 32, tvl: 11_200_000_000, active: true, launchedAt: Date.now() - 180 * 24 * 60 * 60 * 1000 },
  { id: 'brevis', name: 'Brevis', category: 'coprocessor', description: 'ZK coprocessor for smart contracts', chain: 'ethereum', totalRestaked: 200_000, operatorCount: 50, rewardRate: 0.06, slashingConditions: ['invalid_state'], minOperatorStake: 1, tvl: 640_000_000, active: true, launchedAt: Date.now() - 120 * 24 * 60 * 60 * 1000 },
  { id: 'witnesschain', name: 'Witness Chain', category: 'oracle', description: 'Decentralized watchtower network', chain: 'ethereum', totalRestaked: 300_000, operatorCount: 80, rewardRate: 0.05, slashingConditions: ['downtime', 'censorship'], minOperatorStake: 5, tvl: 960_000_000, active: true, launchedAt: Date.now() - 90 * 24 * 60 * 60 * 1000 },
  { id: 'eoracle', name: 'eOracle', category: 'oracle', description: 'Ethereum-native oracle secured by restakers', chain: 'ethereum', totalRestaked: 250_000, operatorCount: 120, rewardRate: 0.045, slashingConditions: ['invalid_state', 'double_sign'], minOperatorStake: 3, tvl: 800_000_000, active: true, launchedAt: Date.now() - 100 * 24 * 60 * 60 * 1000 },
  { id: 'altlayer', name: 'AltLayer MACH', category: 'rollup', description: 'Fast finality layer for rollups', chain: 'ethereum', totalRestaked: 500_000, operatorCount: 70, rewardRate: 0.055, slashingConditions: ['invalid_state', 'double_sign'], minOperatorStake: 10, tvl: 1_600_000_000, active: true, launchedAt: Date.now() - 150 * 24 * 60 * 60 * 1000 },
  { id: 'omni', name: 'Omni Network', category: 'interop', description: 'Cross-rollup messaging protocol', chain: 'ethereum', totalRestaked: 400_000, operatorCount: 60, rewardRate: 0.05, slashingConditions: ['invalid_state', 'censorship'], minOperatorStake: 5, tvl: 1_280_000_000, active: true, launchedAt: Date.now() - 60 * 24 * 60 * 60 * 1000 },
  { id: 'lagrange', name: 'Lagrange', category: 'coprocessor', description: 'ZK MapReduce coprocessor for cross-chain proofs', chain: 'ethereum', totalRestaked: 180_000, operatorCount: 40, rewardRate: 0.065, slashingConditions: ['invalid_state'], minOperatorStake: 1, tvl: 576_000_000, active: true, launchedAt: Date.now() - 80 * 24 * 60 * 60 * 1000 },
  { id: 'hyperlane_avs', name: 'Hyperlane AVS', category: 'bridge', description: 'Interchain messaging security module', chain: 'ethereum', totalRestaked: 350_000, operatorCount: 55, rewardRate: 0.048, slashingConditions: ['invalid_state', 'double_sign'], minOperatorStake: 5, tvl: 1_120_000_000, active: true, launchedAt: Date.now() - 70 * 24 * 60 * 60 * 1000 },
  { id: 'automata', name: 'Automata', category: 'coprocessor', description: 'TEE-based multi-prover AVS', chain: 'ethereum', totalRestaked: 150_000, operatorCount: 35, rewardRate: 0.07, slashingConditions: ['invalid_state'], minOperatorStake: 1, tvl: 480_000_000, active: true, launchedAt: Date.now() - 50 * 24 * 60 * 60 * 1000 },
  { id: 'espresso', name: 'Espresso', category: 'sequencer', description: 'Shared sequencer for rollups', chain: 'ethereum', totalRestaked: 600_000, operatorCount: 90, rewardRate: 0.052, slashingConditions: ['censorship', 'downtime'], minOperatorStake: 10, tvl: 1_920_000_000, active: true, launchedAt: Date.now() - 40 * 24 * 60 * 60 * 1000 },
];

/* ─── State ───────────────────────────────────────────────────────────────── */

const positions: Map<string, RestakingPosition> = new Map();
const operators: Map<string, Operator> = new Map();
const withdrawals: Map<string, WithdrawalRequest> = new Map();
const slashings: SlashingEvent[] = [];

/* ─── Liquid Staking ──────────────────────────────────────────────────────── */

export function getLSTRegistry(): LiquidStakingToken[] {
  return [...LST_REGISTRY];
}

export function getLSTBySymbol(symbol: string): LiquidStakingToken | null {
  return LST_REGISTRY.find((t) => t.symbol === symbol) || null;
}

export function getLSTsByChain(chain: StakingChain): LiquidStakingToken[] {
  return LST_REGISTRY.filter((t) => t.chain === chain);
}

export function getLSTsByProtocol(protocol: StakingProtocol): LiquidStakingToken[] {
  return LST_REGISTRY.filter((t) => t.protocol === protocol);
}

export function stake(input: {
  account: string;
  protocol: StakingProtocol;
  amount: number;
  restakeToAVS?: string[];
}): RestakingPosition {
  const lst = LST_REGISTRY.find((t) => t.protocol === input.protocol);
  if (!lst) throw new Error(`Protocol ${input.protocol} not found`);

  const liquidAmount = input.amount / lst.exchangeRate;

  const position: RestakingPosition = {
    id: `pos_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    account: input.account,
    protocol: input.protocol,
    asset: lst.underlyingAsset,
    liquidToken: lst.symbol,
    amount: input.amount,
    liquidTokenAmount: liquidAmount,
    restaked: (input.restakeToAVS?.length || 0) > 0,
    avs: input.restakeToAVS || [],
    rewardsEarned: 0,
    slashingRisk: (input.restakeToAVS?.length || 0) * 0.005,
    stakedAt: Date.now(),
  };

  positions.set(position.id, position);
  return position;
}

export function restakeToAVS(positionId: string, avsId: string): RestakingPosition | null {
  const position = positions.get(positionId);
  if (!position) return null;

  const avs = AVS_REGISTRY.find((a) => a.id === avsId);
  if (!avs || !avs.active) return null;

  if (!position.avs.includes(avsId)) {
    position.avs.push(avsId);
    position.restaked = true;
    position.slashingRisk = position.avs.length * 0.005;
    avs.totalRestaked += position.amount;
  }

  return position;
}

export function unstakeFromAVS(positionId: string, avsId: string): RestakingPosition | null {
  const position = positions.get(positionId);
  if (!position) return null;

  position.avs = position.avs.filter((a) => a !== avsId);
  position.restaked = position.avs.length > 0;
  position.slashingRisk = position.avs.length * 0.005;

  return position;
}

export function getPosition(positionId: string): RestakingPosition | null {
  return positions.get(positionId) || null;
}

export function getPositionsByAccount(account: string): RestakingPosition[] {
  return Array.from(positions.values()).filter((p) => p.account === account);
}

/* ─── Withdrawal Queue ────────────────────────────────────────────────────── */

export function requestWithdrawal(positionId: string): WithdrawalRequest | null {
  const position = positions.get(positionId);
  if (!position) return null;

  const delayMs = position.protocol === 'lido' ? 3 * 24 * 60 * 60 * 1000
    : position.protocol === 'etherfi' ? 7 * 24 * 60 * 60 * 1000
    : position.protocol === 'rocketpool' ? 7 * 24 * 60 * 60 * 1000
    : position.restaked ? 7 * 24 * 60 * 60 * 1000
    : 1 * 24 * 60 * 60 * 1000;

  const request: WithdrawalRequest = {
    id: `wd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    account: position.account,
    protocol: position.protocol,
    asset: position.asset,
    amount: position.amount,
    status: 'pending',
    requestedAt: Date.now(),
    readyAt: Date.now() + delayMs,
  };

  withdrawals.set(request.id, request);
  return request;
}

export function claimWithdrawal(withdrawalId: string): WithdrawalRequest | null {
  const request = withdrawals.get(withdrawalId);
  if (!request || request.status === 'completed') return null;
  if (Date.now() < request.readyAt) return null;

  request.status = 'completed';
  request.completedAt = Date.now();
  return request;
}

/* ─── AVS Management ──────────────────────────────────────────────────────── */

export function getAVSRegistry(): AVS[] {
  return [...AVS_REGISTRY];
}

export function getAVS(avsId: string): AVS | null {
  return AVS_REGISTRY.find((a) => a.id === avsId) || null;
}

export function getAVSByCategory(category: AVSCategory): AVS[] {
  return AVS_REGISTRY.filter((a) => a.category === category);
}

export function getTopAVSByTVL(limit: number = 5): AVS[] {
  return [...AVS_REGISTRY].sort((a, b) => b.tvl - a.tvl).slice(0, limit);
}

/* ─── Operator Management ─────────────────────────────────────────────────── */

export function registerOperator(input: {
  address: string;
  name: string;
  selfStake: number;
  commission: number;
}): Operator {
  const operator: Operator = {
    id: `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    address: input.address,
    name: input.name,
    totalDelegated: input.selfStake,
    selfStake: input.selfStake,
    delegators: 0,
    avsList: [],
    commission: Math.min(input.commission, 0.15),
    performanceScore: 1.0,
    slashingHistory: [],
    registeredAt: Date.now(),
  };

  operators.set(operator.id, operator);
  return operator;
}

export function delegateToOperator(operatorId: string, amount: number): Operator | null {
  const operator = operators.get(operatorId);
  if (!operator) return null;

  operator.totalDelegated += amount;
  operator.delegators++;
  return operator;
}

export function registerOperatorToAVS(operatorId: string, avsId: string): Operator | null {
  const operator = operators.get(operatorId);
  if (!operator) return null;

  const avs = AVS_REGISTRY.find((a) => a.id === avsId);
  if (!avs || !avs.active) return null;

  if (operator.selfStake < avs.minOperatorStake) {
    throw new Error(`Minimum stake for ${avs.name}: ${avs.minOperatorStake} ETH`);
  }

  if (!operator.avsList.includes(avsId)) {
    operator.avsList.push(avsId);
    avs.operatorCount++;
  }

  return operator;
}

export function getOperator(operatorId: string): Operator | null {
  return operators.get(operatorId) || null;
}

export function getTopOperators(limit: number = 10): Operator[] {
  return Array.from(operators.values())
    .sort((a, b) => b.totalDelegated - a.totalDelegated)
    .slice(0, limit);
}

/* ─── Slashing ────────────────────────────────────────────────────────────── */

export function reportSlashing(input: {
  operator: string;
  avs: string;
  condition: SlashingCondition;
  amountSlashed: number;
  evidence: string;
}): SlashingEvent {
  const event: SlashingEvent = {
    id: `slash_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    ...input,
    timestamp: Date.now(),
  };

  slashings.push(event);

  // Update operator
  for (const [, op] of operators) {
    if (op.address === input.operator) {
      op.totalDelegated -= input.amountSlashed;
      op.performanceScore *= 0.9;
      op.slashingHistory.push({
        avsId: input.avs,
        amount: input.amountSlashed,
        reason: input.condition,
        timestamp: Date.now(),
      });
    }
  }

  return event;
}

export function getSlashingEvents(): SlashingEvent[] {
  return [...slashings];
}

/* ─── Reward Calculation ──────────────────────────────────────────────────── */

export function calculateRewards(positionId: string, daysElapsed: number): number {
  const position = positions.get(positionId);
  if (!position) return 0;

  const lst = LST_REGISTRY.find((t) => t.protocol === position.protocol);
  const baseAPR = lst?.apr || 3.0;

  // Add AVS rewards
  let avsBonus = 0;
  for (const avsId of position.avs) {
    const avs = AVS_REGISTRY.find((a) => a.id === avsId);
    if (avs) avsBonus += avs.rewardRate;
  }

  const totalAPR = (baseAPR / 100) + avsBonus;
  return position.amount * totalAPR * (daysElapsed / 365);
}

/* ─── Protocol Summary ────────────────────────────────────────────────────── */

export function getRestakingSummary() {
  const allPositions = Array.from(positions.values());
  const totalStaked = allPositions.reduce((s, p) => s + p.amount, 0);
  const totalRestaked = allPositions.filter((p) => p.restaked).reduce((s, p) => s + p.amount, 0);

  return {
    name: 'FreedomForge Restaking Protocol',
    version: '1.0.0',
    inspired_by: ['EigenLayer', 'Lido', 'Ether.fi', 'Rocket Pool', 'Symbiotic', 'Jito', 'Marinade', 'Karak', 'Kelp DAO', 'Renzo', 'Puffer', 'Swell'],
    liquidStaking: {
      tokens: LST_REGISTRY.length,
      ethereum: getLSTsByChain('ethereum').length,
      solana: getLSTsByChain('solana').length,
      topByTVL: LST_REGISTRY.sort((a, b) => b.totalStaked - a.totalStaked).slice(0, 5).map((t) => ({
        symbol: t.symbol,
        protocol: t.protocol,
        totalStaked: t.totalStaked,
        apr: t.apr,
      })),
    },
    restaking: {
      avs: AVS_REGISTRY.length,
      avsCategories: [...new Set(AVS_REGISTRY.map((a) => a.category))],
      totalTVL: AVS_REGISTRY.reduce((s, a) => s + a.tvl, 0),
      totalOperators: AVS_REGISTRY.reduce((s, a) => s + a.operatorCount, 0),
      topAVS: getTopAVSByTVL(3).map((a) => ({ name: a.name, category: a.category, tvl: a.tvl })),
    },
    positions: {
      total: allPositions.length,
      totalStaked,
      totalRestaked,
      restakeRatio: totalStaked > 0 ? totalRestaked / totalStaked : 0,
    },
    operators: {
      registered: operators.size,
    },
    slashing: {
      events: slashings.length,
      totalSlashed: slashings.reduce((s, e) => s + e.amountSlashed, 0),
    },
    features: [
      '11 liquid staking tokens across Ethereum & Solana',
      '10 AVS (Actively Validated Services) with EigenLayer restaking',
      'Multi-protocol staking (Lido, Ether.fi, Rocket Pool, Jito, Marinade)',
      'AVS delegation with reward compounding',
      'Operator registration and performance scoring',
      'Slashing detection and enforcement',
      'Withdrawal queue with protocol-specific delays',
      'MEV-aware staking (Jito)',
      'Permissionless node operation (Rocket Pool)',
      'Restaking aggregation (Kelp, Renzo, Puffer)',
    ],
  };
}
