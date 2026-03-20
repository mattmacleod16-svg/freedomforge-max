/**
 * GET /api/status/integrity — Run integrity check on all critical state files.
 * POST /api/status/integrity — Rebuild the integrity manifest (force refresh).
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/apiGuard';
import { verifyIntegrity, buildManifest } from '@/lib/security/integrityGuard';

export async function GET(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  const result = verifyIntegrity();
  return NextResponse.json({
    status: result.valid ? 'ok' : 'tamper_detected',
    ...result,
    checkedAt: new Date().toISOString(),
  });
}

export async function POST(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  const manifest = buildManifest();
  return NextResponse.json({
    status: 'manifest_rebuilt',
    files: Object.keys(manifest.entries).length,
    signedAt: new Date(manifest.signedAt).toISOString(),
  });
}
