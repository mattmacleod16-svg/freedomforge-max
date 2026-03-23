/**
 * GET /api/health — Railway healthcheck endpoint (no auth required)
 */
export const runtime = 'nodejs';

export async function GET() {
  return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
