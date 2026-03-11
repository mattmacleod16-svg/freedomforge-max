import { ingestExternalGroundTruth } from '@/lib/intelligence/autonomyDirector';
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  // H4 FIX: Ground-truth ingestion writes to autonomy state — require auth to prevent data poisoning
  const denied = await requireAuth(req);
  if (denied) return denied;
  try {
    const result = await ingestExternalGroundTruth();
    return Response.json({ status: 'ok', ...result });
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'ground-truth ingest failed',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  // FIX HIGH #4: Auth guard on ground-truth ingestion (data poisoning vector)
  const denied = await requireAuth(req);
  if (denied) return denied;
  return GET(req);
}
