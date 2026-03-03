import { getVendorStackStatus } from '@/lib/intelligence/vendorStack';

export const runtime = 'nodejs';

export async function GET() {
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
