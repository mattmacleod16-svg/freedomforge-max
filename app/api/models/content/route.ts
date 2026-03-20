/**
 * GET /api/models/content — Marketing content endpoint
 * Returns AI-model-focused marketing posts for social growth automation.
 * Query params:
 *   ?category=model-spotlight|capability-highlight|engagement|trending|educational
 *   ?random=true — return a single random post
 */

import { getAllMarketingContent, pickRandomPost, type ContentCategory } from '@/lib/social/aiModelMarketingContent';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get('category') as ContentCategory | null;
  const random = url.searchParams.get('random') === 'true';

  if (random) {
    const post = pickRandomPost(category || undefined);
    return Response.json({ post });
  }

  let posts = getAllMarketingContent();
  if (category) {
    posts = posts.filter((p) => p.category === category);
  }

  return Response.json({
    total: posts.length,
    posts,
  });
}
