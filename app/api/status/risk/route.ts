import { getRiskStatusSummary } from '@/lib/intelligence/riskMonitor';
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const summary = await getRiskStatusSummary();
    return Response.json(
      {
        status: 'ok',
        risk: summary,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'risk status failed',
      },
      { status: 500 }
    );
  }
}
