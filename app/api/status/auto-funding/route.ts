import { NextResponse } from 'next/server';
import { getAutoFundingDashboard } from '@/lib/intelligence/apiCreditAutoFunder';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const dashboard = getAutoFundingDashboard();
    return NextResponse.json(dashboard);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'auto-funding status failed' },
      { status: 500 }
    );
  }
}
