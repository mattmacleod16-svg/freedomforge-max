import { collectMetricsSnapshot, buildPrometheusMetrics } from '@/lib/metrics';
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const asJson = url.searchParams.get('format') === 'json';

    if (asJson) {
      const snapshot = await collectMetricsSnapshot();
      return Response.json(
        {
          ...snapshot,
          walletBalanceWei: snapshot.walletBalanceWei.toString(),
          payoutsWei: snapshot.payoutsWei.toString(),
          withdrawalsWei: snapshot.withdrawalsWei.toString(),
          topupsWei: snapshot.topupsWei.toString(),
          estimatedRevenueInflowWei: snapshot.estimatedRevenueInflowWei.toString(),
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const metrics = await buildPrometheusMetrics();
    return new Response(metrics, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'metrics failed',
      },
      { status: 500 }
    );
  }
}
