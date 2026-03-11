import { getMemorySummary, recallMemories } from '@/lib/intelligence/memoryEngine';
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const query = (url.searchParams.get('query') || '').trim();
    const topK = Math.max(1, Math.min(20, Number(url.searchParams.get('topK') || '8')));

    const recalled = query ? recallMemories(query, { topK }) : [];

    return Response.json(
      {
        status: 'ok',
        summary: getMemorySummary(),
        recalled,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'memory status failed',
      },
      { status: 500 }
    );
  }
}
