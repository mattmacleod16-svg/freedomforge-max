import { getEnsembleDiagnostics } from '@/lib/intelligence/ensembleDiagnostics';
import { runEnsembleAutoPolicy } from '@/lib/intelligence/ensembleAutoPolicy';
import { getChampionPolicySnapshot } from '@/lib/intelligence/championPolicy';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.max(100, Math.min(5000, Number(url.searchParams.get('limit') || '800')));
    const diagnostics = await getEnsembleDiagnostics(limit);

    return Response.json(
      {
        status: 'ok',
        diagnostics,
        policy: getChampionPolicySnapshot(),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'ensemble policy status failed',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(100, Math.min(5000, Number(body?.limit || '800')));
    const regime = (body?.regime || 'unknown') as 'risk_on' | 'risk_off' | 'neutral' | 'unknown';

    const result = await runEnsembleAutoPolicy({
      limit,
      regime,
    });

    return Response.json(
      {
        status: 'ok',
        result,
        policy: getChampionPolicySnapshot(),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'ensemble policy tuning failed',
      },
      { status: 500 }
    );
  }
}
