import { NextResponse } from 'next/server';
import { getSynergyDashboard } from '@/lib/intelligence/modelSynergyEngine';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const dashboard = getSynergyDashboard();
    return NextResponse.json(dashboard);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'model synergy status failed' },
      { status: 500 }
    );
  }
}
