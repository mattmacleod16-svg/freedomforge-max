import { PARTNER_ECOSYSTEM, getEcosystemStats, getLivePartners, getPartnersByPhase } from '@/lib/intelligence/partnerEcosystem';
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const stats = getEcosystemStats();
    const live = getLivePartners();
    const building = getPartnersByPhase('building');
    const planned = getPartnersByPhase('planned');

    return Response.json(
      {
        status: 'ok',
        partners: {
          stats,
          total: PARTNER_ECOSYSTEM.length,
          live: live.map((p) => ({ id: p.id, name: p.name, category: p.category, chain: p.chain })),
          building: building.map((p) => ({ id: p.id, name: p.name, category: p.category })),
          planned: planned.map((p) => ({ id: p.id, name: p.name, category: p.category })),
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Partner status failed' },
      { status: 500 },
    );
  }
}
