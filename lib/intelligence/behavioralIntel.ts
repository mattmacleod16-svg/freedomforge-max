import type { MarketFeaturePoint } from '@/lib/intelligence/marketFeatureStore';

type MemoryHint = {
  reward?: number;
  riskScore?: number;
  tags?: string[];
};

export type BehavioralContext = {
  crowdPsychology: 'fearful' | 'greedy' | 'balanced' | 'unknown';
  cognitiveBiasRisk: Array<'herding' | 'recency' | 'overconfidence' | 'loss_aversion'>;
  culturalTiming: {
    utcDay: string;
    session: 'asia' | 'europe' | 'americas' | 'overlap';
    weekend: boolean;
  };
  guidance: string[];
  promptBlock: string;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function utcDayName(day: number) {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][day] || 'unknown';
}

function inferSession(hourUtc: number): BehavioralContext['culturalTiming']['session'] {
  if (hourUtc >= 7 && hourUtc <= 10) return 'overlap';
  if (hourUtc >= 11 && hourUtc <= 20) return 'americas';
  if (hourUtc >= 1 && hourUtc <= 7) return 'europe';
  return 'asia';
}

export function buildBehavioralContext(input: {
  userQuery: string;
  market?: MarketFeaturePoint | null;
  recalledMemories?: MemoryHint[];
}): BehavioralContext {
  const now = new Date();
  const day = utcDayName(now.getUTCDay());
  const hour = now.getUTCHours();
  const session = inferSession(hour);
  const weekend = now.getUTCDay() === 0 || now.getUTCDay() === 6;

  const fearGreed = input.market?.fearGreed;
  const volatility = clamp(input.market?.realizedVolatility ?? 0);

  let crowdPsychology: BehavioralContext['crowdPsychology'] = 'unknown';
  if (typeof fearGreed === 'number') {
    if (fearGreed <= 30) crowdPsychology = 'fearful';
    else if (fearGreed >= 70) crowdPsychology = 'greedy';
    else crowdPsychology = 'balanced';
  }

  const memoryRisk = input.recalledMemories && input.recalledMemories.length > 0
    ? input.recalledMemories.reduce((sum, item) => sum + (item.riskScore ?? 0.5), 0) / input.recalledMemories.length
    : 0.5;

  const memoryReward = input.recalledMemories && input.recalledMemories.length > 0
    ? input.recalledMemories.reduce((sum, item) => sum + (item.reward ?? 0.5), 0) / input.recalledMemories.length
    : 0.5;

  const biasRisk: BehavioralContext['cognitiveBiasRisk'] = [];
  if (crowdPsychology === 'greedy') biasRisk.push('overconfidence', 'herding');
  if (crowdPsychology === 'fearful') biasRisk.push('loss_aversion', 'herding');
  if (volatility > 0.02) biasRisk.push('recency');
  if (memoryReward > 0.78 && memoryRisk > 0.55) biasRisk.push('overconfidence');

  const uniqueBias = Array.from(new Set(biasRisk));

  const guidance: string[] = [
    `crowd_psychology=${crowdPsychology}`,
    `bias_watch=${uniqueBias.join(',') || 'none'}`,
    `session=${session};utc_day=${day};weekend=${weekend}`,
  ];

  if (crowdPsychology === 'greedy') {
    guidance.push('apply stricter entry quality and avoid chasing momentum without confirmation');
  }
  if (crowdPsychology === 'fearful') {
    guidance.push('prefer staged entries and emphasize downside protection before upside capture');
  }
  if (weekend) {
    guidance.push('weekend liquidity may be thinner; reduce size and require stronger conviction');
  }
  if (memoryRisk > 0.62) {
    guidance.push('recent memory risk elevated; tighten stop discipline and lower exposure');
  }

  const promptBlock = [
    '[behavioral and cultural intelligence]',
    ...guidance.map((line) => `- ${line}`),
  ].join('\n');

  return {
    crowdPsychology,
    cognitiveBiasRisk: uniqueBias,
    culturalTiming: {
      utcDay: day,
      session,
      weekend,
    },
    guidance,
    promptBlock,
  };
}
