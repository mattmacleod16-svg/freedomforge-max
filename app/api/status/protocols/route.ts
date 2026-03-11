import { getProtocolSummary } from '@/lib/protocols/adapters';
import { getAgentProtocolStatuses } from '@/lib/protocols/agentProtocols';
import { getVendorStackStatus } from '@/lib/intelligence/vendorStack';
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const [summary, agentProtocols, vendorStack] = await Promise.all([
      getProtocolSummary(),
      getAgentProtocolStatuses(),
      getVendorStackStatus(),
    ]);

    const vendorProtocols = vendorStack.vendors.map((item) => ({
      protocol: `vendor:${item.id}`,
      enabled: item.enabled,
      healthy: item.healthy,
      latencyMs: item.latencyMs,
      details: item.details,
      metadata: {
        label: item.label,
        benefits: item.benefits,
      },
    }));

    const protocols = [...summary.protocols, ...agentProtocols, ...vendorProtocols];
    const enabled = protocols.filter((item) => item.enabled).length;
    const healthy = protocols.filter((item) => item.healthy === true).length;
    const unhealthy = protocols.filter((item) => item.healthy === false).length;

    return Response.json(
      {
        status: 'ok',
        enabled,
        healthy,
        unhealthy,
        protocols,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'protocol status failed',
      },
      { status: 500 }
    );
  }
}
