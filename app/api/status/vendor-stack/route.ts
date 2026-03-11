import { getVendorStackStatus } from '@/lib/intelligence/vendorStack';
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const summary = await getVendorStackStatus();
    return Response.json(
      {
        status: 'ok',
        ...summary,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'vendor stack status failed',
      },
      { status: 500 }
    );
  }
}
