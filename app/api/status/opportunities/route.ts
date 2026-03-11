import { getAdaptiveOpportunityPlan } from '@/lib/intelligence/opportunityEngine';
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const query = (url.searchParams.get('query') || '').trim();

    const plan = getAdaptiveOpportunityPlan(query || undefined);

    return Response.json(
      {
        status: 'ok',
        plan,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'opportunity status failed',
      },
      { status: 500 }
    );
  }
}
