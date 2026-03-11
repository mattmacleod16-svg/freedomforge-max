import { getEnsembleDiagnostics } from '@/lib/intelligence/ensembleDiagnostics';
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const limit = Math.max(100, Math.min(5000, Number(url.searchParams.get('limit') || '600')));
    const diagnostics = await getEnsembleDiagnostics(limit);

    return Response.json(
      {
        status: 'ok',
        ensemble: diagnostics,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'ensemble diagnostics failed',
      },
      { status: 500 }
    );
  }
}
