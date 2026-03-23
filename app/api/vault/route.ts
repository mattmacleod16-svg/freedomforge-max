import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/apiGuard';
import { getVaultOverview } from '@/lib/vault/aggregator';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

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
