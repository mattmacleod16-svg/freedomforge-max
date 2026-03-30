/**
 * GET /api/phases — Phase status, Polygonscan tracker, revenue router state
 */

import { NextResponse } from 'next/server';
import { getTxStatus, getTokenTransfers } from '@/lib/blockchain/polygonscan';
import { getGoalProgress, getRecentAllocations, getRouterState } from '@/lib/funding/revenue-router';
import { verifySessionToken } from '@/lib/auth/session';
import { cookies } from 'next/headers';

const TRACKED_TX_HASHES = (process.env.TRACKED_TX_HASHES || '').split(',').filter(Boolean);
const POLYGON_WALLET    = process.env.POLYGON_WALLET_ADDRESS || '';

// Phase definitions (driven by env or defaults)
const PHASES = [
  {
    id: 1,
    name: 'Phase 1 — Day 1',
    description: 'Confirm tx hash on Polygonscan; first yield accrual visible in dashboard',
    milestones: [
      { id: 'tx_confirmed', label: 'Transaction confirmed on Polygonscan' },
      { id: 'yield_visible', label: 'First yield accrual visible in dashboard' },
    ],
    daysRange: '0–1',
  },
  {
    id: 2,
    name: 'Phase 2 — Week 1',
    description: 'Monitor autonomous payouts; route first revenue to F-150 bumper sale acceleration',
    milestones: [
      { id: 'first_payout', label: 'First autonomous payout executed' },
      { id: 'f150_funded', label: 'F-150 Bumper Fund receiving allocation' },
    ],
    daysRange: '2–7',
  },
  {
    id: 3,
    name: 'Phase 3 — Ongoing',
    description: 'Engine self-optimizes quarterly; feed truck flip profits back into standby',
    milestones: [
      { id: 'quarterly_opt', label: 'Quarterly optimization executed' },
      { id: 'compounding', label: 'Truck flip profits reinvested into standby capital' },
    ],
    daysRange: 'Ongoing',
  },
];

export async function GET() {
  // Auth check
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('ff_session')?.value ?? cookieStore.get('session')?.value ?? '';
  const session = sessionCookie ? verifySessionToken(sessionCookie) : null;
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch tx statuses in parallel
  const txStatuses = await Promise.all(
    TRACKED_TX_HASHES.map((hash) => getTxStatus(hash))
  );

  // Yield accruals (token transfers to wallet)
  let yieldAccruals: Awaited<ReturnType<typeof getTokenTransfers>> = [];
  if (POLYGON_WALLET) {
    try {
      yieldAccruals = await getTokenTransfers(POLYGON_WALLET, 0, 10);
    } catch { /* best-effort */ }
  }

  // Revenue router
  const goals       = getGoalProgress();
  const allocations = getRecentAllocations(10);
  const routerState = getRouterState();

  // Derive phase completion status
  const txConfirmed   = txStatuses.some((t) => t.status === 'confirmed' && t.confirmations >= 12);
  const yieldVisible  = yieldAccruals.length > 0;
  const f150Goal      = goals.find((g) => g.id === 'f150-bumper');
  const f150Funded    = (f150Goal?.currentUsd ?? 0) > 0;
  const standbyGoal   = goals.find((g) => g.id === 'standby-capital');
  const firstPayout   = (standbyGoal?.currentUsd ?? 0) > 0 || allocations.length > 0;

  const phaseStatuses = [
    {
      ...PHASES[0],
      milestones: [
        { id: 'tx_confirmed', label: 'Transaction confirmed on Polygonscan', done: txConfirmed },
        { id: 'yield_visible', label: 'First yield accrual visible in dashboard', done: yieldVisible },
      ],
      complete: txConfirmed && yieldVisible,
    },
    {
      ...PHASES[1],
      milestones: [
        { id: 'first_payout', label: 'First autonomous payout executed', done: firstPayout },
        { id: 'f150_funded', label: 'F-150 Bumper Fund receiving allocation', done: f150Funded },
      ],
      complete: firstPayout && f150Funded,
    },
    {
      ...PHASES[2],
      milestones: [
        { id: 'quarterly_opt', label: 'Quarterly optimization executed', done: false },
        { id: 'compounding', label: 'Truck flip profits reinvested into standby capital', done: (standbyGoal?.currentUsd ?? 0) >= (standbyGoal?.targetUsd ?? 1) * 0.5 },
      ],
      complete: false,
    },
  ];

  // Determine active phase
  const activePhase = phaseStatuses.find((p) => !p.complete)?.id ?? 3;

  return NextResponse.json({
    phases: phaseStatuses,
    activePhase,
    txStatuses,
    yieldAccruals: yieldAccruals.slice(0, 5),
    goals,
    recentAllocations: allocations,
    totalRouted: routerState.totalRouted,
    riskRegister: [
      { risk: 'Regulatory', level: 'Low', mitigation: 'Read-only Coinbase link + fully on-chain tx' },
      { risk: 'Geopolitical / Technical', level: 'Low', mitigation: 'Circuit breakers auto-pause on anomaly' },
      { risk: 'Display Lag', level: 'Low', mitigation: 'Rounded 90M normal in aggregated view — command resolves to exact tokens' },
    ],
    updatedAt: new Date().toISOString(),
  });
}
