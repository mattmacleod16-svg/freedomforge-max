import { getXAutomationStatus } from '@/lib/social/xAutomation';

export const runtime = 'nodejs';

export async function GET() {
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
