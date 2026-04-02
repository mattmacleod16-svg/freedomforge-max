/* ═══════════════════════════════════════════════════════════════════════════
   FreedomForge Enterprise — Status API
   Returns status of all enterprise system connections
   ═══════════════════════════════════════════════════════════════════════════ */

import { NextResponse } from 'next/server';
import { enterprise } from '@/lib/enterprise';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    // Initialize if not already done
    await enterprise.initialize();

    // Refresh status
    const status = await enterprise.refreshStatus();
    const summary = enterprise.getSummary();

    return NextResponse.json({
      status: 'ok',
      timestamp: Date.now(),
      enterprise: {
        overall: summary.overallStatus,
        connectedSystems: summary.connectedSystems,
        totalSystems: summary.totalSystems,
        lastUpdated: summary.lastUpdated.toISOString(),
        connectors: {
          apriso: status.apriso ? {
            status: status.apriso.status,
            latencyMs: status.apriso.latencyMs,
            lastCheck: status.apriso.lastCheck.toISOString(),
            error: status.apriso.errorMessage,
          } : null,
          oracle: status.oracle ? {
            status: status.oracle.status,
            latencyMs: status.oracle.latencyMs,
            lastCheck: status.oracle.lastCheck.toISOString(),
            error: status.oracle.errorMessage,
          } : null,
          windchill: status.windchill ? {
            status: status.windchill.status,
            latencyMs: status.windchill.latencyMs,
            lastCheck: status.windchill.lastCheck.toISOString(),
            error: status.windchill.errorMessage,
          } : null,
          nextgenPlm: status.nextgenPlm ? {
            status: status.nextgenPlm.status,
            latencyMs: status.nextgenPlm.latencyMs,
            lastCheck: status.nextgenPlm.lastCheck.toISOString(),
            error: status.nextgenPlm.errorMessage,
          } : null,
        },
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        timestamp: Date.now(),
        error: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
