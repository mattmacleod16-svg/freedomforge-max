import { NextResponse } from 'next/server';
import { getWatchdogReport } from '@/lib/intelligence/watchdog';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const report = await getWatchdogReport();
    return NextResponse.json(report);
  } catch (error) {
    console.error('Watchdog error:', error);
    return NextResponse.json(
      { error: 'Watchdog intelligence temporarily unavailable' },
      { status: 500 }
    );
  }
}
