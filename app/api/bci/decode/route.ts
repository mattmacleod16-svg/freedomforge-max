/**
 * POST /api/bci/decode
 *
 * Accepts an array of BCISignal objects (from one or more device adapters),
 * runs them through the FusionEngine, and returns a BCIDecodeResult.
 *
 * Request body: { signals: BCISignal[] }
 * Response:     BCIDecodeResult
 */

import { fuseBCISignals } from '@/lib/deviceforge/fusion-engine';
import { BCISignal } from '@/lib/types';

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    !Array.isArray((body as { signals?: unknown }).signals)
  ) {
    return Response.json(
      { error: 'Request body must be { signals: BCISignal[] }' },
      { status: 400 },
    );
  }

  const signals = (body as { signals: unknown[] }).signals;

  // Validate each signal has required shape
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
