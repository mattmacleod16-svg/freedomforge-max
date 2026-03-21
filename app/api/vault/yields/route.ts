import { NextResponse } from 'next/server';
import { getYieldIntelligence } from '@/lib/defi/yield-intelligence';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const cookie = req.headers.get('cookie') || '';
  const hasSession = cookie.includes('ff_session') || cookie.includes('ff_dashboard_session');
  const isLocalhost = req.headers.get('host')?.startsWith('localhost');

  if (!hasSession && !isLocalhost) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const intel = await getYieldIntelligence();
    return NextResponse.json(intel);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch yield data', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
