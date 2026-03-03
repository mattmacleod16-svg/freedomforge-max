export const runtime = 'nodejs';

type Emotion = 'neutral' | 'positive' | 'concerned' | 'urgent';

type TtsRequest = {
  text: string;
  emotion?: Emotion;
  voiceId?: string;
  modelId?: string;
};

function inferEmotion(text: string): Emotion {
  const source = text.toLowerCase();
  if (/urgent|asap|immediately|critical|panic/.test(source)) return 'urgent';
  if (/worried|concern|risk|error|fail|issue/.test(source)) return 'concerned';
  if (/great|awesome|good|thanks|love|win/.test(source)) return 'positive';
  return 'neutral';
}

function resolveVoiceSettings(emotion: Emotion) {
  if (emotion === 'urgent') {
    return { stability: 0.24, similarity_boost: 0.78, style: 0.82, use_speaker_boost: true };
  }
  if (emotion === 'concerned') {
    return { stability: 0.62, similarity_boost: 0.7, style: 0.36, use_speaker_boost: true };
  }
  if (emotion === 'positive') {
    return { stability: 0.42, similarity_boost: 0.74, style: 0.68, use_speaker_boost: true };
  }
  return { stability: 0.56, similarity_boost: 0.72, style: 0.3, use_speaker_boost: true };
}

export async function GET() {
  return Response.json({
    status: 'ok',
    provider: 'elevenlabs',
    configured: Boolean(process.env.ELEVENLABS_API_KEY),
    defaultVoiceId: process.env.ELEVENLABS_VOICE_ID || null,
    defaultModelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5',
    supportedEmotions: ['neutral', 'positive', 'concerned', 'urgent'],
  });
}

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'ELEVENLABS_API_KEY is not configured' },
      { status: 503 }
    );
  }

  try {
    const body = (await req.json()) as TtsRequest;
    const text = (body?.text || '').trim();
    if (!text) {
      return Response.json({ error: 'text is required' }, { status: 400 });
    }

    const emotion: Emotion = body.emotion || inferEmotion(text);
    const voiceId = body.voiceId || process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
    const modelId = body.modelId || process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';

    const voiceSettings = resolveVoiceSettings(emotion);
    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: voiceSettings,
      }),
    });

    if (!upstream.ok) {
      const details = await upstream.text().catch(() => 'upstream error');
      return Response.json(
        { error: `ElevenLabs request failed (${upstream.status})`, details },
        { status: 502 }
      );
    }

    const audioBuffer = await upstream.arrayBuffer();
    return new Response(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'x-tts-provider': 'elevenlabs',
        'x-tts-emotion': emotion,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'tts failed' },
      { status: 500 }
    );
  }
}
