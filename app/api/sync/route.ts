/**
 * GET /api/sync — Pull missing deltas + device status.
 * POST /api/sync — Push deltas from a device and receive missing deltas.
 * PUT /api/sync — Register/update a device.
 * DELETE /api/sync — Remove a device.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/apiGuard';
import {
  registerDevice,
  removeDevice,
  pushDeltas,
  pullDeltas,
  getResolvedState,
  getSyncSummary,
  type DevicePlatform,
  type SyncDelta,
  type VectorClock,
} from '@/lib/sync/syncEngine';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const deviceId = url.searchParams.get('deviceId');
  const full = url.searchParams.get('full') === 'true';

  // If full refresh requested, return entire resolved state
  if (full) {
    return NextResponse.json(getResolvedState());
  }

  // If deviceId provided, pull missing deltas
  if (deviceId) {
    const clockParam = url.searchParams.get('clock');
    const clientClock: VectorClock = clockParam ? JSON.parse(clockParam) : {};
    return NextResponse.json(pullDeltas(deviceId, clientClock));
  }

  // Default: return sync summary
  return NextResponse.json(getSyncSummary());
}

export async function POST(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  const body = await req.json();
  const { deviceId, deltas, clock } = body as {
    deviceId: string;
    deltas: SyncDelta[];
    clock: VectorClock;
  };

  if (!deviceId || !Array.isArray(deltas) || !clock) {
    return NextResponse.json({ error: 'Missing deviceId, deltas, or clock' }, { status: 400 });
  }

  const result = pushDeltas(deviceId, deltas, clock);
  return NextResponse.json(result);
}

export async function PUT(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  const body = await req.json();
  const { deviceId, name, platform, userAgent } = body as {
    deviceId: string;
    name: string;
    platform: DevicePlatform;
    userAgent?: string;
  };

  if (!deviceId || !name || !platform) {
    return NextResponse.json({ error: 'Missing deviceId, name, or platform' }, { status: 400 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const device = registerDevice({ deviceId, name, platform, userAgent, ip });
  return NextResponse.json({ status: 'registered', device });
}

export async function DELETE(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const deviceId = url.searchParams.get('deviceId');

  if (!deviceId) {
    return NextResponse.json({ error: 'Missing deviceId' }, { status: 400 });
  }

  const removed = removeDevice(deviceId);
  return NextResponse.json({ status: removed ? 'removed' : 'not_found' });
}
