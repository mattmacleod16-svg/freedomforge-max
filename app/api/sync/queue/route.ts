import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { getQueuedRequests, removeFromQueue, updateQueuedRequest } from '@/lib/db/offlineQueue';

/**
 * POST /api/sync/queue
 * Replay offline queue — re-execute failed mutations that were queued during network outage.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify session
    const jar = await cookies();
    const token = jar.get('ff_session')?.value;
    if (!token) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const session = verifySessionToken(token);
    if (!session) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // Get all queued requests
    const queued = await getQueuedRequests();

    const successful: string[] = [];
    const failed: { id: string; endpoint: string; reason: string }[] = [];

    // Replay each queued request
    for (const req of queued) {
      try {
        if (req.attemptCount >= req.maxAttempts) {
          // Too many attempts, give up
          await removeFromQueue(req.id);
          failed.push({
            id: req.id,
            endpoint: req.endpoint,
            reason: `Max attempts (${req.maxAttempts}) exceeded`,
          });
          continue;
        }

        // Re-execute with fresh session auth
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
        const host = process.env.NEXTAUTH_URL || `${protocol}://localhost:3000`;
        
        const res = await fetch(`${host}${req.endpoint}`, {
          method: req.method,
          headers: {
            'Content-Type': 'application/json',
            Cookie: `ff_session=${token}`,
          },
          body: req.method !== 'GET' ? JSON.stringify(req.payload) : undefined,
        });

        if (res.ok) {
          // Success — remove from queue
          await removeFromQueue(req.id);
          successful.push(req.id);
        } else {
          // Retry-able error — increment attempt count
          await updateQueuedRequest(req.id, {
            attemptCount: req.attemptCount + 1,
            lastError: `HTTP ${res.status}`,
          });
          failed.push({
            id: req.id,
            endpoint: req.endpoint,
            reason: `HTTP ${res.status} (attempt ${req.attemptCount + 1}/${req.maxAttempts})`,
          });
        }
      } catch (err) {
        // Network error or timeout — retry
        await updateQueuedRequest(req.id, {
          attemptCount: req.attemptCount + 1,
          lastError: err instanceof Error ? err.message : 'Unknown error',
        });
        failed.push({
          id: req.id,
          endpoint: req.endpoint,
          reason: err instanceof Error ? err.message : 'Network error',
        });
      }
    }

    return NextResponse.json({
      status: 'ok',
      successful,
      failed,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { status: 'error', error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 }
    );
  }
}
