import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/apiGuard';
import { getYieldIntelligence } from '@/lib/defi/yield-intelligence';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

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
