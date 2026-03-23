import { getCreditDashboard, apiCreditTick } from '@/lib/intelligence/apiCreditMonitor';
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    // Refresh balances on each dashboard hit (at most once per hour internally)
    await apiCreditTick();

    const dashboard = getCreditDashboard();
    return Response.json(
      { status: 'ok', ...dashboard },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'api credit status failed',
      },
      { status: 500 }
    );
  }
}
