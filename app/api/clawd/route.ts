import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function isAuthorized(req: Request) {
  const secret = process.env.CLAWD_API_SECRET;
  if (!secret) return true;

  const headerSecret = req.headers.get('x-clawd-secret') || '';
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';

  return headerSecret === secret || bearer === secret;
}

async function runClawdHttpQuery(prompt: string) {
  const endpoint = process.env.CLAWD_HTTP_ENDPOINT;
  if (!endpoint) {
    throw new Error('CLAWD_HTTP_ENDPOINT is not configured');
  }

  const timeoutMs = Math.max(1000, Math.min(120000, Number(process.env.CLAWD_TIMEOUT_MS || '25000')));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.CLAWD_HTTP_TOKEN
          ? {
              Authorization: `Bearer ${process.env.CLAWD_HTTP_TOKEN}`,
              'X-API-Key': process.env.CLAWD_HTTP_TOKEN,
            }
          : {}),
      },
      body: JSON.stringify({
        prompt,
        command: prompt,
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: { response?: string; output?: string; error?: string } = {};
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { response: text };
    }

    if (!response.ok) {
      throw new Error(payload.error || `clawd http backend status ${response.status}`);
    }

    return String(payload.response || payload.output || '').trim();
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ status: 'error', error: 'unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const prompt = String(body?.prompt || '').trim();
    if (!prompt) {
      return Response.json({ status: 'error', error: 'prompt is required' }, { status: 400 });
    }

    const response = await runClawdHttpQuery(prompt);
    return Response.json(
      {
        status: 'ok',
        model: 'clawd',
        response,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'clawd query failed',
      },
      { status: 500 }
    );
  }
}
