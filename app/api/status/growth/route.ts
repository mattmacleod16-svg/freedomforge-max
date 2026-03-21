import { getGrowthSummary, getSupportedLanguages, getGrowthMetrics, detectLanguage } from '@/lib/intelligence/limitlessGrowth';
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

    const scriptGroups = languages.reduce((acc: Record<string, number>, l) => {
      acc[l.script] = (acc[l.script] || 0) + 1;
      return acc;
    }, {});

    return Response.json(
      {
        status: 'ok',
        growth: {
          summary,
          supportedLanguages: languages.length,
          scriptBreakdown: scriptGroups,
          languages: languages.map((l) => ({ code: l.code, name: l.name, script: l.script })),
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

export async function POST(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const { text } = await req.json();
    if (!text || typeof text !== 'string') {
      return Response.json({ status: 'error', error: 'text field required' }, { status: 400 });
    }
    const detected = detectLanguage(text);
    return Response.json({ status: 'ok', detected });
  } catch (error) {
    return Response.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Detection failed' },
      { status: 500 },
    );
  }
}
