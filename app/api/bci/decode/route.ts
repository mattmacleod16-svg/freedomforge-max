/**
 * POST /api/bci/decode
 *
 * Accepts two payload shapes:
 *
 *   1. High-level:  { rawSignals: RawBCIData, userId?: string, profile?: UserProfile }
 *      → Uses bciAdapter.decodeIntent() + guardian watchAndProtect()
 *
 *   2. Low-level:   { signals: BCISignal[] }
 *      → Direct FusionEngine path (original implementation)
 *
 * Response: BCIDecodeResult | IntentVector
 */

import { fuseBCISignals } from '@/lib/deviceforge/fusion-engine';
import { bciAdapter }     from '@/lib/deviceforge/hybrid-bci-adapter';
import { GuardianManager } from '@/lib/guardians/guardian-manager';
import { BCISignal, RawBCIData, UserProfile } from '@/lib/types';

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;

  // ── Path 1: high-level rawSignals payload ──────────────────────────────────
  if ('rawSignals' in b) {
    const rawSignals = b['rawSignals'] as RawBCIData;
    const userId     = typeof b['userId'] === 'string' ? b['userId'] : 'anonymous';
    const profile    = (b['profile'] ?? undefined) as UserProfile | undefined;

    const intent = await bciAdapter.decodeIntent(rawSignals, profile);

    // Run guardian watch asynchronously — do not block the response
    GuardianManager.getGuardian(userId).watchAndProtect(rawSignals).catch(() => {});

    return Response.json({ success: true, intent });
  }

  // ── Path 2: low-level signals array payload ────────────────────────────────
  if (!Array.isArray(b['signals'])) {
    return Response.json(
      { error: 'Request body must be { rawSignals: RawBCIData } or { signals: BCISignal[] }' },
      { status: 400 },
    );
  }

  const signals = b['signals'] as unknown[];

  const valid = signals.every(
    s =>
      typeof s === 'object' &&
      s !== null &&
      typeof (s as BCISignal).deviceType === 'string' &&
      Array.isArray((s as BCISignal).channels) &&
      typeof (s as BCISignal).confidence === 'number' &&
      typeof (s as BCISignal).timestampMs === 'number',
  );

  if (!valid) {
    return Response.json(
      {
        error:
          'Each signal must have: deviceType (string), channels (number[]), confidence (number), timestampMs (number)',
      },
      { status: 422 },
    );
  }

  const result = fuseBCISignals(signals as BCISignal[]);
  return Response.json(result);
}
