/**
 * Data Ingestion API
 * POST /api/ingest - manually trigger full dataset ingestion
 * GET /api/ingest/status - check last ingestion status
 */

import { requireAuth } from '@/lib/auth/apiGuard';
import { runFullDataIngestionPipeline } from '@/lib/ingestion/dataLoader';

let lastRun: { time: number; result: any } | null = null;

export const runtime = 'nodejs';

export async function GET() {
  return Response.json({ lastRun });
}

export async function POST(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;
  try {
    const result = await runFullDataIngestionPipeline();
    lastRun = { time: Date.now(), result };
    return Response.json({ status: 'ok', result });
  } catch (error) {
    return Response.json(
      { status: 'error', error: error instanceof Error ? error.message : 'failed' },
      { status: 500 }
    );
  }
}
