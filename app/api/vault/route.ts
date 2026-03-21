import { NextResponse } from 'next/server';
import { getVaultOverview } from '@/lib/vault/aggregator';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Auth check — reuse session cookie
  const cookie = req.headers.get('cookie') || '';
  const hasSession = cookie.includes('ff_session') || cookie.includes('ff_dashboard_session');
  const isLocalhost = req.headers.get('host')?.startsWith('localhost');

  if (!hasSession && !isLocalhost) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const overview = await getVaultOverview();
    return NextResponse.json(overview);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch vault data', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
