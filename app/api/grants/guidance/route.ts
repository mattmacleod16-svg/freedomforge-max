/**
 * Grant Guidance API
 * POST /api/grants/guidance — get AI application guidance for a specific grant
 */
import { NextResponse } from 'next/server';
import { getGrantGuidance } from '@/lib/grant-navigator/grokGrantClient';
import type { Grant } from '@/lib/grant-navigator/grokGrantClient';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json() as { grant?: Grant; applicantContext?: string };
    const { grant, applicantContext } = body;

    if (!grant?.id || !grant?.title) {
      return NextResponse.json({ error: 'grant object required' }, { status: 400 });
    }

    const guidance = await getGrantGuidance(
      grant,
      applicantContext || 'A community organization in South Carolina focused on economic development.',
    );

    return NextResponse.json({ guidance });
  } catch (err) {
    console.error('[api/grants/guidance] error', err);
    return NextResponse.json({ error: 'Failed to generate guidance' }, { status: 500 });
  }
}
