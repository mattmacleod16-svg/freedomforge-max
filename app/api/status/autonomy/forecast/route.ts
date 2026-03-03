import {
  ensureMarketForecast,
  getForecastSummary,
  resolveDueForecasts,
  runForecastBacktest,
} from '@/lib/intelligence/forecastEngine';
import { maybeRefreshMarketFeatureStore } from '@/lib/intelligence/marketFeatureStore';

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
      await ensureMarketForecast(horizonHours);
      await resolveDueForecasts();
    }

    return Response.json(
      {
        status: 'ok',
        forecast: getForecastSummary(),
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
  try {
    await maybeRefreshMarketFeatureStore();
    const body = await req.json().catch(() => ({}));
    const horizonHours = Math.max(1, Number(body?.horizonHours || '24'));

    await ensureMarketForecast(horizonHours);
    await resolveDueForecasts();

    return Response.json({
      status: 'ok',
      forecast: getForecastSummary(),
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
