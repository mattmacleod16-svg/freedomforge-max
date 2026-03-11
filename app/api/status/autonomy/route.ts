import { requireAuth } from '@/lib/auth/apiGuard';
import {
  getAutonomySnapshot,
  updateApprovalPolicy,
} from '@/lib/intelligence/autonomyDirector';
import { getMarketIntelligenceSummary, maybeRefreshMarketFeatureStore } from '@/lib/intelligence/marketFeatureStore';
import { ensureMarketForecast, getForecastSummary, resolveDueForecasts, runForecastBacktest } from '@/lib/intelligence/forecastEngine';
import { getChampionPolicySnapshot } from '@/lib/intelligence/championPolicy';
import { getProtocolSummary } from '@/lib/protocols/adapters';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    await maybeRefreshMarketFeatureStore();
    await resolveDueForecasts();
    await ensureMarketForecast();

    const url = new URL(req.url);
    const includeBacktest = url.searchParams.get('backtest') === 'true';
    const horizonHours = Math.max(1, Number(url.searchParams.get('horizonHours') || '24'));
    const protocols = await getProtocolSummary();

    return Response.json(
      {
        status: 'ok',
        autonomy: getAutonomySnapshot(),
        market: getMarketIntelligenceSummary(),
        forecast: getForecastSummary(),
        modelPolicy: getChampionPolicySnapshot(),
        protocols,
        backtest: includeBacktest ? runForecastBacktest(horizonHours) : undefined,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'autonomy status failed',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    if (body?.action === 'forecast') {
      const horizonHours = Math.max(1, Number(body?.horizonHours || '24'));
      await ensureMarketForecast(horizonHours);
      await resolveDueForecasts();
      return Response.json({
        status: 'ok',
        forecast: getForecastSummary(),
        modelPolicy: getChampionPolicySnapshot(),
        backtest: runForecastBacktest(horizonHours),
      });
    }

    const policy = updateApprovalPolicy({
      mode: body?.mode,
      autoApproveMinConfidence: Number(body?.autoApproveMinConfidence),
      maxRiskForAutoApprove: Number(body?.maxRiskForAutoApprove),
      alwaysEscalateOnEthicsFlags: body?.alwaysEscalateOnEthicsFlags,
    });

    return Response.json({ status: 'ok', policy });
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'policy update failed',
      },
      { status: 500 }
    );
  }
}
