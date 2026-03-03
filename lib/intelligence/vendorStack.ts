type VendorId =
  | 'acorns'
  | 'signalstack'
  | 'tickeron'
  | 'trendspider'
  | 'blackboxstocks'
  | 'forexfury'
  | 'capitaliseai'
  | 'equbot'
  | 'kensho'
  | 'acuity'
  | 'threecommas'
  | 'optionsai'
  | 'kavout';

type VendorDefinition = {
  id: VendorId;
  label: string;
  benefits: string[];
  strategyHooks: string[];
};

type VendorStatus = {
  id: VendorId;
  label: string;
  enabled: boolean;
  healthy: boolean | null;
  latencyMs: number | null;
  details: string;
  benefits: string[];
  strategyHooks: string[];
};

const VENDOR_DEFINITIONS: VendorDefinition[] = [
  {
    id: 'acorns',
    label: 'Acorns-style accumulation',
    benefits: ['automated recurring contributions', 'micro-allocation discipline', 'long-horizon compounding'],
    strategyHooks: ['dca', 'cash-sweep-thresholds', 'risk-budgeted portfolio drift checks'],
  },
  {
    id: 'signalstack',
    label: 'SignalStack-style routing',
    benefits: ['signal-to-execution bridge', 'automation reliability', 'latency-aware routing'],
    strategyHooks: ['event-driven triggers', 'deduplicated signal queue', 'execution acknowledgement tracking'],
  },
  {
    id: 'tickeron',
    label: 'Tickeron-style AI patterns',
    benefits: ['pattern recognition', 'signal confidence overlays', 'scenario scoring'],
    strategyHooks: ['pattern confirmation gates', 'confidence-threshold entries', 'regime-conditioned filters'],
  },
  {
    id: 'trendspider',
    label: 'TrendSpider-style technical automation',
    benefits: ['multi-timeframe trend mapping', 'automated level detection', 'alert-to-action handoff'],
    strategyHooks: ['trendline breaks', 'volatility compression breakouts', 'support/resistance risk framing'],
  },
  {
    id: 'blackboxstocks',
    label: 'BlackBox-style flow monitoring',
    benefits: ['options/volume anomaly awareness', 'momentum scanner awareness', 'intraday event responsiveness'],
    strategyHooks: ['unusual-volume alerts', 'flow-confirmed entries', 'session-based stop tightening'],
  },
  {
    id: 'forexfury',
    label: 'Forex Fury-style rule automation',
    benefits: ['rules-first execution', 'time-window constraints', 'strict stop/take controls'],
    strategyHooks: ['session windows', 'max-drawdown guards', 'loss-streak throttle'],
  },
  {
    id: 'capitaliseai',
    label: 'Capitalise.ai-style natural language automation',
    benefits: ['plain-language strategy templates', 'if/then execution logic', 'condition automation'],
    strategyHooks: ['nl-to-rule translation', 'trigger graph evaluation', 'human-readable audit logs'],
  },
  {
    id: 'equbot',
    label: 'EquBot-style AI allocation',
    benefits: ['data-driven portfolio weighting', 'factor-based rotation', 'adaptive rebalance timing'],
    strategyHooks: ['factor exposure checks', 'allocation optimization', 'rebalance cooldown controls'],
  },
  {
    id: 'kensho',
    label: 'Kensho-style event intelligence',
    benefits: ['macro/event impact analysis', 'cross-asset context', 'scenario comparison'],
    strategyHooks: ['event risk calendar', 'cross-market correlation overlays', 'shock-response playbooks'],
  },
  {
    id: 'acuity',
    label: 'Acuity-style news/sentiment',
    benefits: ['real-time sentiment cues', 'news shock detection', 'headline-driven risk moderation'],
    strategyHooks: ['sentiment regime flag', 'headline risk pause', 'confidence haircut on negative drift'],
  },
  {
    id: 'threecommas',
    label: '3Commas-style bot controls',
    benefits: ['multi-bot orchestration', 'smart order logic', 'portfolio-level safeguards'],
    strategyHooks: ['bot-level caps', 'take-profit laddering', 'global kill-switch and cooldown'],
  },
  {
    id: 'optionsai',
    label: 'OptionsAI-style defined-risk structures',
    benefits: ['defined-risk options framing', 'payout profile clarity', 'volatility-aware structures'],
    strategyHooks: ['defined-risk template selection', 'max-loss budgeting', 'expiration-aware risk decay'],
  },
  {
    id: 'kavout',
    label: 'Kavout-style ranking signals',
    benefits: ['AI ranking overlays', 'multi-factor scoring', 'selection prioritization'],
    strategyHooks: ['rank-threshold watchlists', 'score momentum checks', 'degradation-based exits'],
  },
];

function toEnvPrefix(id: VendorId) {
  return id.toUpperCase();
}

async function fetchWithTimeout(url: string, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'User-Agent': 'freedomforge-max/1.0' },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkVendor(definition: VendorDefinition): Promise<VendorStatus> {
  const prefix = toEnvPrefix(definition.id);
  const enabled = String(process.env[`${prefix}_ENABLED`] || 'false').toLowerCase() === 'true';
  const healthUrl = process.env[`${prefix}_HEALTH_URL`];

  if (!enabled) {
    return {
      ...definition,
      enabled: false,
      healthy: null,
      latencyMs: null,
      details: `${definition.label} disabled`,
    };
  }

  if (!healthUrl) {
    return {
      ...definition,
      enabled: true,
      healthy: null,
      latencyMs: null,
      details: `${definition.label} enabled (no health URL configured)`,
    };
  }

  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(healthUrl);
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        ...definition,
        enabled: true,
        healthy: false,
        latencyMs,
        details: `Health check failed (${response.status})`,
      };
    }

    return {
      ...definition,
      enabled: true,
      healthy: true,
      latencyMs,
      details: 'Health endpoint reachable',
    };
  } catch (error) {
    return {
      ...definition,
      enabled: true,
      healthy: false,
      latencyMs: Date.now() - startedAt,
      details: error instanceof Error ? error.message : 'health check failed',
    };
  }
}

export async function getVendorStackStatus() {
  const vendors = await Promise.all(VENDOR_DEFINITIONS.map((item) => checkVendor(item)));
  const enabled = vendors.filter((item) => item.enabled).length;
  const healthy = vendors.filter((item) => item.healthy === true).length;
  const unhealthy = vendors.filter((item) => item.healthy === false).length;

  const beneficialCapabilities = Array.from(
    new Set(vendors.flatMap((item) => [...item.benefits, ...item.strategyHooks]))
  );

  return {
    enabled,
    healthy,
    unhealthy,
    vendors,
    beneficialCapabilities,
  };
}

export function buildVendorStrategyContext() {
  const textFirst = {
    mode: 'text-first',
    policy: [
      'Prioritize typed prompts/responses for clarity and auditability',
      'Use voice only when explicitly requested by user',
      'Keep automation summaries concise and reviewable in text',
    ],
  };

  const topBenefits = VENDOR_DEFINITIONS.flatMap((item) => item.benefits).slice(0, 18);
  const topHooks = VENDOR_DEFINITIONS.flatMap((item) => item.strategyHooks).slice(0, 22);

  return {
    textFirst,
    topBenefits,
    topHooks,
  };
}
