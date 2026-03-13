/**
 * Autonomous Funding Status API
 * GET /api/status/funding — Returns self-funding health, costs, revenue, model synergy
 * POST /api/status/funding — Trigger a funding coordination cycle
 */

import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

// Dynamic imports to avoid build issues with CommonJS modules
async function getFundingCoordinator() {
  return require('@/lib/funding/autonomous-funding-coordinator');
}

async function getModelOrchestrator() {
  const { getAvailableModels } = await import('@/lib/models/modelOrchestrator');
  return { getAvailableModels };
}

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const coordinator = await getFundingCoordinator();
    const { getAvailableModels } = await getModelOrchestrator();
    const availableModels = getAvailableModels();
    const status = coordinator.getFundingStatus(availableModels);

    return Response.json({
      ok: true,
      ...status,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Funding status check failed',
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const coordinator = await getFundingCoordinator();
    const cycleResult = coordinator.runFundingCycle();

    return Response.json({
      ok: true,
      cycle: cycleResult,
      message: 'Funding coordination cycle completed',
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Funding cycle failed',
      },
      { status: 500 },
    );
  }
}
