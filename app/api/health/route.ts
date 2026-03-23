/**
 * GET /api/health — Railway healthcheck + operational readiness endpoint.
 *
 * Returns 200 when the app is fully operational.
 * Returns 503 when required configuration is missing (Railway will restart the pod).
 *
 * Designed to be fast: no outbound network calls, no DB queries.
 */
export const runtime = 'nodejs';

const BOOT_TIME = Date.now();

/** Variables that MUST be present for the app to function. */
const REQUIRED = [
  'DASHBOARD_SESSION_SECRET',
  'DASHBOARD_USER',
  'DASHBOARD_PASS',
];

/** At least one AI provider key must be present for chat to work. */
const AI_PROVIDERS = [
  'OPENROUTER_API_KEY',
  'OPEN_ROUTER_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'CLAUDE_API_KEY',
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'MISTRAL_API_KEY',
  'GROK_API_KEY',
];

export async function GET() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  const hasAI = AI_PROVIDERS.some((k) => !!process.env[k]);
  const ready = missing.length === 0 && hasAI;

  const body = {
    ok: ready,
    ts: Date.now(),
    uptimeMs: Date.now() - BOOT_TIME,
    env: process.env.RAILWAY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'unknown',
    ...(ready
      ? {}
      : {
          issues: [
            ...missing.map((k) => `missing required env: ${k}`),
            ...(!hasAI ? ['no AI provider key configured'] : []),
          ],
        }),
  };

  return new Response(JSON.stringify(body), {
    status: ready ? 200 : 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
