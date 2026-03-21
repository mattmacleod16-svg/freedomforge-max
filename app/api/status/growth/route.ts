import { getGrowthSummary, getSupportedLanguages, getGrowthMetrics } from '@/lib/intelligence/limitlessGrowth';
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const [summary, languages, metrics] = await Promise.all([
      Promise.resolve(getGrowthSummary()),
      Promise.resolve(getSupportedLanguages()),
      Promise.resolve(getGrowthMetrics()),
    ]);

    return Response.json(
      {
        status: 'ok',
        growth: {
          summary,
          supportedLanguages: languages.length,
          metrics,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Growth status failed' },
      { status: 500 },
    );
  }
}
