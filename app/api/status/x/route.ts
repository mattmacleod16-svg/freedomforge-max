import { getXAutomationStatus } from '@/lib/social/xAutomation';
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    return Response.json(
      {
        status: 'ok',
        ...getXAutomationStatus(),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'x status failed',
      },
      { status: 500 }
    );
  }
}
