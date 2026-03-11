import { runXGrowthAutomation } from '@/lib/social/xAutomation';

export const runtime = 'nodejs';

function isAuthorized(req: Request) {
  const expected = process.env.X_AUTOMATION_SECRET;
  if (!expected) return false; // deny when secret is not configured

  const headerSecret = req.headers.get('x-x-automation-secret');
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  return [headerSecret, bearer].some((item) => item && item === expected);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun;
    const trend = typeof body?.trend === 'string' ? body.trend : undefined;
    const force = body?.force === true;

    const result = await runXGrowthAutomation({
      dryRun: typeof dryRun === 'boolean' ? dryRun : undefined,
      trend,
      force,
    });

    return Response.json({ status: result.ok ? 'ok' : 'blocked', ...result });
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'x automation failed',
      },
      { status: 500 }
    );
  }
}
