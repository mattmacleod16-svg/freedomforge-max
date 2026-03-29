/**
 * POST /api/tts
 *
 * Converts text to speech via ElevenLabs and streams back audio/mpeg.
 * Used by the chat UI to speak AI replies aloud.
 *
 * Body: { text: string, voiceId?: string }
 * Response: audio/mpeg binary stream
 */

import { synthesizeSpeech } from '@/lib/elevenlabs/tts-client';

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const text    = typeof b['text']    === 'string' ? b['text'].trim()    : '';
  const voiceId = typeof b['voiceId'] === 'string' ? b['voiceId']        : undefined;

  if (!text) {
    return Response.json({ error: 'text is required' }, { status: 400 });
  }

  try {
    const upstream = await synthesizeSpeech(text, voiceId);

    if (!upstream.ok) {
      return Response.json({ error: 'TTS synthesis failed' }, { status: upstream.status });
    }

    return new Response(upstream.body, {
      headers: {
        'Content-Type':  'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'TTS unavailable';
    return Response.json({ error: message }, { status: 502 });
  }
}
