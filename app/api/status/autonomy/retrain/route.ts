import { triggerDriftRetraining } from '@/lib/intelligence/autonomyDirector';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === 'string' ? body.reason : 'manual';
    const result = await triggerDriftRetraining(reason);
    return Response.json({ status: 'ok', retrain: result });
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'retrain check failed',
      },
      { status: 500 }
    );
  }
}
