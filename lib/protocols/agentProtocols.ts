type ProtocolKind = 'mcp' | 'acp' | 'a2a' | 'aui';

type HealthStatus = {
  protocol: ProtocolKind;
  enabled: boolean;
  healthy: boolean | null;
  latencyMs: number | null;
  details: string;
  metadata?: Record<string, unknown>;
};

type Envelope<T> = {
  id: string;
  protocol: ProtocolKind;
  ts: number;
  payload: T;
};

type ModelContextPayload = {
  query: string;
  sources: string[];
  memoryHints?: string[];
  marketRegime?: string;
};

type AgentCommunicationPayload = {
  from: string;
  to: string;
  intent: string;
  priority: 'low' | 'normal' | 'high';
  body: string;
};

type AgentToAgentPayload = {
  senderAgent: string;
  receiverAgent: string;
  task: string;
  constraints?: string[];
};

type AgentUserInteractionPayload = {
  userMessage: string;
  assistantMessage?: string;
  inferredEmotion: 'neutral' | 'positive' | 'concerned' | 'urgent';
};

function nextId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function inferEmotion(text: string): AgentUserInteractionPayload['inferredEmotion'] {
  const source = text.toLowerCase();
  if (/urgent|asap|immediately|critical|panic/.test(source)) return 'urgent';
  if (/worried|concern|risk|error|fail|issue/.test(source)) return 'concerned';
  if (/great|awesome|good|thanks|love|win/.test(source)) return 'positive';
  return 'neutral';
}

async function fetchWithTimeout(url: string, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'User-Agent': 'freedomforge-max/1.0' },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkProtocolHealth(config: {
  protocol: ProtocolKind;
  enabledFlag?: string;
  healthUrl?: string;
  defaultEnabled?: boolean;
}): Promise<HealthStatus> {
  const enabled = config.enabledFlag
    ? String(config.enabledFlag).toLowerCase() === 'true'
    : Boolean(config.defaultEnabled);

  if (!enabled) {
    return {
      protocol: config.protocol,
      enabled: false,
      healthy: null,
      latencyMs: null,
      details: `${config.protocol.toUpperCase()} disabled`,
    };
  }

  if (!config.healthUrl) {
    return {
      protocol: config.protocol,
      enabled: true,
      healthy: null,
      latencyMs: null,
      details: `${config.protocol.toUpperCase()} enabled (no health URL configured)`,
    };
  }

  const started = Date.now();
  try {
    const res = await fetchWithTimeout(config.healthUrl, 9000);
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return {
        protocol: config.protocol,
        enabled: true,
        healthy: false,
        latencyMs,
        details: `Health check failed (${res.status})`,
      };
    }
    return {
      protocol: config.protocol,
      enabled: true,
      healthy: true,
      latencyMs,
      details: 'Health endpoint reachable',
    };
  } catch (error) {
    return {
      protocol: config.protocol,
      enabled: true,
      healthy: false,
      latencyMs: Date.now() - started,
      details: error instanceof Error ? error.message : 'health check failed',
    };
  }
}

export function buildModelContextPacket(payload: ModelContextPayload): Envelope<ModelContextPayload> {
  return {
    id: nextId('mcp'),
    protocol: 'mcp',
    ts: Date.now(),
    payload,
  };
}

export function buildAgentCommunicationPacket(payload: AgentCommunicationPayload): Envelope<AgentCommunicationPayload> {
  return {
    id: nextId('acp'),
    protocol: 'acp',
    ts: Date.now(),
    payload,
  };
}

export function buildAgentToAgentPacket(payload: AgentToAgentPayload): Envelope<AgentToAgentPayload> {
  return {
    id: nextId('a2a'),
    protocol: 'a2a',
    ts: Date.now(),
    payload,
  };
}

export function buildAgentUserInteractionPacket(payload: Omit<AgentUserInteractionPayload, 'inferredEmotion'> & { inferredEmotion?: AgentUserInteractionPayload['inferredEmotion'] }): Envelope<AgentUserInteractionPayload> {
  return {
    id: nextId('aui'),
    protocol: 'aui',
    ts: Date.now(),
    payload: {
      ...payload,
      inferredEmotion: payload.inferredEmotion || inferEmotion(payload.userMessage),
    },
  };
}

export async function getAgentProtocolStatuses(): Promise<HealthStatus[]> {
  return Promise.all([
    checkProtocolHealth({
      protocol: 'mcp',
      enabledFlag: process.env.MCP_ENABLED,
      healthUrl: process.env.MCP_HEALTH_URL,
      defaultEnabled: true,
    }),
    checkProtocolHealth({
      protocol: 'acp',
      enabledFlag: process.env.ACP_ENABLED,
      healthUrl: process.env.ACP_HEALTH_URL,
      defaultEnabled: true,
    }),
    checkProtocolHealth({
      protocol: 'a2a',
      enabledFlag: process.env.A2A_ENABLED,
      healthUrl: process.env.A2A_HEALTH_URL,
      defaultEnabled: true,
    }),
    checkProtocolHealth({
      protocol: 'aui',
      enabledFlag: process.env.AUI_ENABLED,
      healthUrl: process.env.AUI_HEALTH_URL,
      defaultEnabled: true,
    }),
  ]);
}
