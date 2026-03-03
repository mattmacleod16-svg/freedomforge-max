import { ingestExternalGroundTruth } from '@/lib/intelligence/autonomyDirector';

export const runtime = 'nodejs';

export async function GET() {
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

export async function POST() {
  return GET();
}
