import {
  ensureMarketForecast,
  ensureForecastEnsemble,
  getForecastDecisionSignal,
  getForecastSummary,
  resolveDueForecasts,
  runForecastBacktest,
} from '@/lib/intelligence/forecastEngine';
import { maybeRefreshMarketFeatureStore } from '@/lib/intelligence/marketFeatureStore';
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    await maybeRefreshMarketFeatureStore();
    await resolveDueForecasts();

    const url = new URL(req.url);
    const create = url.searchParams.get('create') === 'true';
    const horizonHours = Math.max(1, Number(url.searchParams.get('horizonHours') || '24'));
    const includeBacktest = url.searchParams.get('backtest') === 'true';

    if (create) {
      // H2 FIX: Forecast creation triggers expensive LLM calls — require auth to prevent cost abuse
      const denied = await requireAuth(req);
      if (denied) return denied;
      await ensureForecastEnsemble();
      await ensureMarketForecast(horizonHours);
      await resolveDueForecasts();
    }

    return Response.json(
      {
        status: 'ok',
        forecast: getForecastSummary(),
        decisionSignal: getForecastDecisionSignal(),
        backtest: includeBacktest ? runForecastBacktest(horizonHours) : undefined,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'forecast status failed',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  // FIX HIGH #4: Auth guard on forecast creation (cost abuse vector)
  const denied = await requireAuth(req);
  if (denied) return denied;
  try {
    await maybeRefreshMarketFeatureStore();
    const body = await req.json().catch(() => ({}));
    const horizonHours = Math.max(1, Number(body?.horizonHours || '24'));

    await ensureForecastEnsemble();
    await ensureMarketForecast(horizonHours);
    await resolveDueForecasts();

    return Response.json({
      status: 'ok',
      forecast: getForecastSummary(),
      decisionSignal: getForecastDecisionSignal(),
      backtest: runForecastBacktest(horizonHours),
    });
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'forecast update failed',
      },
      { status: 500 }
    );
  }
}
