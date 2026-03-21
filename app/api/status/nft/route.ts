import { getDigitalAssetsSummary, getAllCollections, getActiveListings } from '@/lib/nft/digitalAssetsEngine';
import { requireAuth } from '@/lib/auth/apiGuard';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  try {
    const [summary, collections, listings] = await Promise.all([
      Promise.resolve(getDigitalAssetsSummary()),
      Promise.resolve(getAllCollections()),
      Promise.resolve(getActiveListings()),
    ]);

    return Response.json(
      {
        status: 'ok',
        nft: {
          summary,
          collections,
          activeListings: listings,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { status: 'error', error: error instanceof Error ? error.message : 'NFT status failed' },
      { status: 500 },
    );
  }
}
