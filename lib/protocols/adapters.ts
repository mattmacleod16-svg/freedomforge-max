export type ProtocolStatus = {
  protocol: string;
  enabled: boolean;
  healthy: boolean | null;
  latencyMs: number | null;
  details: string;
  metadata?: Record<string, unknown>;
};

type JsonRpcResponse = {
  result?: string;
  error?: { code?: number; message?: string };
};

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkZoraProtocol(): Promise<ProtocolStatus> {
  const rpcUrl = process.env.ZORA_RPC_URL?.trim();
  if (!rpcUrl) {
    return {
      protocol: 'zora',
      enabled: false,
      healthy: null,
      latencyMs: null,
      details: 'ZORA_RPC_URL is not configured',
    };
  }

  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(
      rpcUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      },
      9000
    );
    const data = (await response.json()) as JsonRpcResponse;

    if (!response.ok || data.error || !data.result) {
      return {
        protocol: 'zora',
        enabled: true,
        healthy: false,
        latencyMs: Date.now() - startedAt,
        details: data.error?.message || `RPC request failed (${response.status})`,
      };
    }

    return {
      protocol: 'zora',
      enabled: true,
      healthy: true,
      latencyMs: Date.now() - startedAt,
      details: 'RPC reachable',
      metadata: {
        latestBlockHex: data.result,
      },
    };
  } catch (error) {
    return {
      protocol: 'zora',
      enabled: true,
      healthy: false,
      latencyMs: Date.now() - startedAt,
      details: error instanceof Error ? error.message : 'Unknown Zora check error',
    };
  }
}

async function checkVvvProtocol(): Promise<ProtocolStatus> {
  const healthUrl = process.env.VVV_AI_HEALTH_URL?.trim();
  if (!healthUrl) {
    return {
      protocol: 'vvv',
      enabled: false,
      healthy: null,
      latencyMs: null,
      details: 'VVV_AI_HEALTH_URL is not configured',
    };
  }

  const startedAt = Date.now();
  try {
    const apiKey = process.env.VVV_AI_API_KEY?.trim();
    const headers: HeadersInit = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetchWithTimeout(
      healthUrl,
      {
        method: 'GET',
        headers,
      },
      9000
    );

    if (!response.ok) {
      return {
        protocol: 'vvv',
        enabled: true,
        healthy: false,
        latencyMs: Date.now() - startedAt,
        details: `Health endpoint returned ${response.status}`,
      };
    }

    return {
      protocol: 'vvv',
      enabled: true,
      healthy: true,
      latencyMs: Date.now() - startedAt,
      details: 'Health endpoint reachable',
      metadata: {
        endpoint: healthUrl,
      },
    };
  } catch (error) {
    return {
      protocol: 'vvv',
      enabled: true,
      healthy: false,
      latencyMs: Date.now() - startedAt,
      details: error instanceof Error ? error.message : 'Unknown VVV check error',
    };
  }
}

export async function getProtocolStatuses() {
  return Promise.all([checkZoraProtocol(), checkVvvProtocol()]);
}

export async function getProtocolSummary() {
  const protocols = await getProtocolStatuses();
  const enabled = protocols.filter((item) => item.enabled).length;
  const healthy = protocols.filter((item) => item.healthy === true).length;
  const unhealthy = protocols.filter((item) => item.healthy === false).length;
  return {
    enabled,
    healthy,
    unhealthy,
    protocols,
  };
}
