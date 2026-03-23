#!/usr/bin/env node
/**
 * API Key Validator — checks connectivity for all configured AI providers.
 * Usage: node scripts/validate-api-keys.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });
require('dotenv').config();

const TIMEOUT_MS = 15_000;

function env(...keys) {
  for (const k of keys) {
    if (process.env[k]) return process.env[k];
  }
  return '';
}

async function check(name, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - start;
    console.log(`  ✓ ${name.padEnd(16)} ${ms}ms  ${result}`);
    return true;
  } catch (err) {
    const ms = Date.now() - start;
    console.log(`  ✗ ${name.padEnd(16)} ${ms}ms  ${err.message}`);
    return false;
  }
}

async function fetchJSON(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function checkOpenAICompat(name, key, endpoint, model) {
  const data = await fetchJSON(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
  });
  const text = data.choices?.[0]?.message?.content || '';
  return `model=${model} response="${text.slice(0, 40)}"`;
}

async function main() {
  console.log('\n🔍 FreedomForge Max — API Key Validator\n');

  const checks = [];

  // Grok
  const grokKey = env('GROK_API_KEY');
  if (grokKey) {
    checks.push(check('Grok', () =>
      checkOpenAICompat('grok', grokKey,
        env('GROK_ENDPOINT') || 'https://api.x.ai/v1/chat/completions',
        env('GROK_MODEL') || 'grok-beta')));
  }

  // OpenAI
  const openaiKey = env('OPENAI_API_KEY');
  if (openaiKey) {
    checks.push(check('OpenAI', () =>
      checkOpenAICompat('openai', openaiKey,
        env('OPENAI_ENDPOINT') || 'https://api.openai.com/v1/chat/completions',
        env('OPENAI_MODEL') || 'gpt-4o-mini')));
  }

  // Anthropic
  const anthropicKey = env('ANTHROPIC_API_KEY', 'CLAUDE_API_KEY');
  if (anthropicKey) {
    checks.push(check('Anthropic', async () => {
      const data = await fetchJSON(
        env('ANTHROPIC_ENDPOINT') || 'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: env('ANTHROPIC_MODEL') || 'claude-3-5-sonnet-latest',
            max_tokens: 5,
            messages: [{ role: 'user', content: 'ping' }],
          }),
        });
      const text = data.content?.[0]?.text || '';
      return `model=${env('ANTHROPIC_MODEL') || 'claude-3-5-sonnet-latest'} response="${text.slice(0, 40)}"`;
    }));
  }

  // OpenRouter
  const orKey = env('OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY');
  if (orKey) {
    checks.push(check('OpenRouter', () =>
      checkOpenAICompat('openrouter', orKey,
        env('OPENROUTER_ENDPOINT') || 'https://openrouter.ai/api/v1/chat/completions',
        env('OPENROUTER_MODEL') || 'openai/gpt-4o-mini')));
  }

  // Perplexity
  const pplxKey = env('PERPLEXITY_API_KEY', 'PPLX_API_KEY');
  if (pplxKey) {
    checks.push(check('Perplexity', () =>
      checkOpenAICompat('perplexity', pplxKey,
        env('PERPLEXITY_ENDPOINT') || 'https://api.perplexity.ai/chat/completions',
        env('PERPLEXITY_MODEL') || 'sonar-pro')));
  }

  // Groq
  const groqKey = env('GROQ_API_KEY', 'GROC_API_KEY');
  if (groqKey) {
    checks.push(check('Groq', () =>
      checkOpenAICompat('groq', groqKey,
        env('GROQ_ENDPOINT', 'GROC_ENDPOINT') || 'https://api.groq.com/openai/v1/chat/completions',
        env('GROQ_MODEL', 'GROC_MODEL') || 'llama-3.3-70b-versatile')));
  }

  // Gemini
  const geminiKey = env('GEMINI_API_KEY', 'GOOGLE_GEMINI_API_KEY');
  if (geminiKey) {
    const model = env('GEMINI_MODEL') || 'gemini-2.0-flash';
    const base = env('GEMINI_ENDPOINT') || 'https://generativelanguage.googleapis.com/v1beta/models';
    checks.push(check('Gemini', async () => {
      const data = await fetchJSON(`${base}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 5 },
        }),
      });
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return `model=${model} response="${text.slice(0, 40)}"`;
    }));
  }

  // Mistral
  const mistralKey = env('MISTRAL_API_KEY', 'MISTRALAI_API_KEY');
  if (mistralKey) {
    checks.push(check('Mistral', () =>
      checkOpenAICompat('mistral', mistralKey,
        env('MISTRAL_ENDPOINT') || 'https://api.mistral.ai/v1/chat/completions',
        env('MISTRAL_MODEL', 'MISTRALAI_MODEL') || 'mistral-large-latest')));
  }

  // Cerebras
  const cerebrasKey = env('CEREBRAS_API_KEY');
  if (cerebrasKey) {
    checks.push(check('Cerebras', () =>
      checkOpenAICompat('cerebras', cerebrasKey,
        env('CEREBRAS_ENDPOINT') || 'https://api.cerebras.ai/v1/chat/completions',
        env('CEREBRAS_MODEL') || 'llama-3.3-70b')));
  }

  // NVIDIA
  const nvidiaKey = env('NVIDIA_API_KEY', 'NIM_API_KEY');
  if (nvidiaKey) {
    checks.push(check('NVIDIA', () =>
      checkOpenAICompat('nvidia', nvidiaKey,
        env('NVIDIA_ENDPOINT', 'NIM_ENDPOINT') || 'https://integrate.api.nvidia.com/v1/chat/completions',
        env('NVIDIA_MODEL', 'NIM_MODEL') || 'meta/llama-3.1-70b-instruct')));
  }

  if (checks.length === 0) {
    console.log('  No API keys configured. Add keys to .env.local and retry.\n');
    process.exit(1);
  }

  const results = await Promise.all(checks);
  const passed = results.filter(Boolean).length;
  const total = results.length;

  console.log(`\n  ${passed}/${total} providers connected successfully.\n`);

  if (passed === 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
