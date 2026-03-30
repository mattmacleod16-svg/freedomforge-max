/**
 * FreedomForge ElevenLabs — TTS Client
 *
 * Server-side client for ElevenLabs text-to-speech synthesis.
 * Uses eleven_multilingual_v2 for natural, expressive speech across languages.
 */

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

// Adam voice — neutral, clear, works well for AI assistant responses
const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB';
const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';

export async function synthesizeSpeech(
  text: string,
  voiceId: string = DEFAULT_VOICE_ID,
): Promise<Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');

  return fetch(`${ELEVENLABS_API}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key':   apiKey,
      'Content-Type': 'application/json',
      'Accept':       'audio/mpeg',
    },
    body: JSON.stringify({
      text:           text.slice(0, 5000),
      model_id:       DEFAULT_MODEL_ID,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
}
