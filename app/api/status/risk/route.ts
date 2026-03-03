import { getRiskStatusSummary } from '@/lib/intelligence/riskMonitor';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const summary = await getRiskStatusSummary();
    return Response.json(
      {
        status: 'ok',
        risk: summary,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'risk status failed',
      },
      { status: 500 }
    );
  }
}
