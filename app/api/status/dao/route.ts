import { getDAOSummary, getActiveProposals, getActiveStreams, getTopDelegates } from '@/lib/dao/treasuryEngine';
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const [summary, proposals, streams, delegates] = await Promise.all([
      Promise.resolve(getDAOSummary()),
      Promise.resolve(getActiveProposals()),
      Promise.resolve(getActiveStreams()),
      Promise.resolve(getTopDelegates(5)),
    ]);

    return Response.json(
      {
        status: 'ok',
        dao: {
          summary,
          activeProposals: proposals,
          activeStreams: streams,
          topDelegates: delegates,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { status: 'error', error: error instanceof Error ? error.message : 'DAO status failed' },
      { status: 500 },
    );
  }
}
