#!/usr/bin/env node

/**
 * Sentiment Analysis Agent — AI-powered market sentiment from news & X posts.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Collects headlines and social posts via Tavily search API, sends them to an
 * LLM (Grok or OpenAI) for structured sentiment scoring, then publishes typed
 * signals to the cross-agent signal bus so trading engines can incorporate
 * real-time market mood into position sizing and entry decisions.
 *
 * Designed to run as a systemd timer or cron job every 30 minutes.
 *
 * Env:
 *   SENTIMENT_AGENT_ENABLED  — 'true' to activate  (default: 'false')
 *   SENTIMENT_INTERVAL_SEC   — minimum seconds between runs (default: 1800)
 *   SENTIMENT_ASSETS         — comma-separated list  (default: 'BTC,ETH,SOL')
 *   SENTIMENT_SOURCES        — 'news,x'             (default: 'news,x')
 *   TAVILY_API_KEY           — required for web search
 *   GROK_API_KEY             — primary LLM
 *   OPENAI_API_KEY           — fallback LLM
 *
 * npm script:  "sentiment:agent": "node scripts/sentiment-agent.js"
 */

const path = require('path');
const { createLogger } = require('../lib/logger');
const logger = createLogger('sentiment-agent');

// ─── Dotenv (load .env.local first, then .env) ──────────────────────────────
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
  dotenv.config();
} catch { /* dotenv not installed — rely on environment */ }

// ─── Configuration ───────────────────────────────────────────────────────────

const ENABLED = String(process.env.SENTIMENT_AGENT_ENABLED || 'false').toLowerCase() === 'true';
const INTERVAL_SEC = Math.min(86400, Math.max(60, parseInt(process.env.SENTIMENT_INTERVAL_SEC || '1800', 10)));
const ASSETS = String(process.env.SENTIMENT_ASSETS || 'BTC,ETH,SOL')
  .split(',')
  .map((a) => a.trim().toUpperCase())
  .filter(Boolean);
const SOURCES = String(process.env.SENTIMENT_SOURCES || 'news,x')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const TAVILY_API_KEY = (process.env.TAVILY_API_KEY || '').trim();
const GROK_API_KEY = (process.env.GROK_API_KEY || '').trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();

const STATE_FILE = path.resolve(process.cwd(), 'data/sentiment-state.json');
const MAX_ANALYSES = 200;
const MAX_ERRORS = 50;
const SIGNAL_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// ─── Dependencies (resilient-io, signal bus) ─────────────────────────────────

let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

let bus;
try { bus = require('../lib/agent-signal-bus'); } catch { bus = null; }

// ─── State Management ────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  lastRunAt: 0,
  analyses: [],
  dailyRuns: 0,
  errors: [],
};

function loadState() {
  if (rio) {
    return rio.readJsonSafe(STATE_FILE, { fallback: { ...DEFAULT_STATE } });
  }
  const fs = require('fs');
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (err) {
    logger.error('state read failed', { error: err.message });
  }
  return { ...DEFAULT_STATE };
}

function saveState(state) {
  // Cap arrays to prevent unbounded growth
  if (state.analyses && state.analyses.length > MAX_ANALYSES) {
    state.analyses = state.analyses.slice(-MAX_ANALYSES);
  }
  if (state.errors && state.errors.length > MAX_ERRORS) {
    state.errors = state.errors.slice(-MAX_ERRORS);
  }

  if (rio) {
    rio.writeJsonAtomic(STATE_FILE, state);
    return;
  }
  const fs = require('fs');
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function recordError(state, context, message) {
  state.errors.push({
    ts: Date.now(),
    context: String(context),
    message: String(message).slice(0, 300),
  });
  if (state.errors.length > MAX_ERRORS) {
    state.errors = state.errors.slice(-MAX_ERRORS);
  }
}

// ─── HTTP Helper ─────────────────────────────────────────────────────────────

async function postJson(url, body, headers = {}, retryOpts = {}) {
  const fetchOpts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
  if (rio) {
    return rio.fetchJsonRetry(url, fetchOpts, { retries: 2, timeoutMs: 20000, ...retryOpts });
  }
  // Bare fallback
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { ...fetchOpts, signal: controller.signal });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { raw: text }; }
  } finally {
    clearTimeout(timer);
  }
}

// ─── Data Collection: Tavily Search ──────────────────────────────────────────

const TAVILY_URL = 'https://api.tavily.com/search';

/**
 * Fetch recent news headlines for a cryptocurrency asset via Tavily.
 * @param {string} asset — e.g. 'BTC'
 * @returns {Promise<string[]>} — array of headline/snippet strings
 */
async function fetchNewsHeadlines(asset) {
  if (!TAVILY_API_KEY) return [];
  try {
    const data = await postJson(TAVILY_URL, {
      api_key: TAVILY_API_KEY,
      query: `${asset} cryptocurrency market news`,
      search_depth: 'basic',
      max_results: 10,
      include_answer: false,
    });

    const results = Array.isArray(data.results) ? data.results : [];
    return results
      .map((r) => {
        const title = (r.title || '').trim();
        const snippet = (r.content || r.snippet || '').trim();
        if (!title && !snippet) return null;
        return title ? `${title}: ${snippet}`.slice(0, 500) : snippet.slice(0, 500);
      })
      .filter(Boolean);
  } catch (err) {
    logger.warn(`news fetch failed for ${asset}`, { error: err.message || err });
    return [];
  }
}

/**
 * Fetch recent X (Twitter) sentiment for a cryptocurrency asset via Tavily.
 * @param {string} asset — e.g. 'BTC'
 * @returns {Promise<string[]>} — array of post text strings
 */
async function fetchXSentiment(asset) {
  if (!TAVILY_API_KEY) return [];
  try {
    const data = await postJson(TAVILY_URL, {
      api_key: TAVILY_API_KEY,
      query: `${asset} crypto site:x.com OR site:twitter.com`,
      search_depth: 'basic',
      max_results: 10,
      include_answer: false,
    });

    const results = Array.isArray(data.results) ? data.results : [];
    return results
      .map((r) => {
        const text = (r.content || r.snippet || r.title || '').trim();
        return text ? text.slice(0, 500) : null;
      })
      .filter(Boolean);
  } catch (err) {
    logger.warn(`X/Twitter fetch failed for ${asset}`, { error: err.message || err });
    return [];
  }
}

/**
 * Fetch recent earnings/report data for equity symbols via Tavily.
 * Only used when Alpaca equities integration is enabled.
 * @param {string} symbol — e.g. 'AAPL'
 * @returns {Promise<string[]>}
 */
async function fetchEarningsData(symbol) {
  if (!TAVILY_API_KEY) return [];
  try {
    const data = await postJson(TAVILY_URL, {
      api_key: TAVILY_API_KEY,
      query: `${symbol} earnings report quarterly results`,
      search_depth: 'basic',
      max_results: 5,
      include_answer: false,
    });

    const results = Array.isArray(data.results) ? data.results : [];
    return results
      .map((r) => {
        const title = (r.title || '').trim();
        const snippet = (r.content || r.snippet || '').trim();
        if (!title && !snippet) return null;
        return title ? `${title}: ${snippet}`.slice(0, 500) : snippet.slice(0, 500);
      })
      .filter(Boolean);
  } catch (err) {
    logger.warn(`earnings fetch failed for ${symbol}`, { error: err.message || err });
    return [];
  }
}

// ─── LLM Analysis ────────────────────────────────────────────────────────────

/**
 * Build the sentiment analysis prompt for the LLM.
 * @param {string} asset
 * @param {string} compiledText — all headlines and posts joined
 * @returns {string}
 */
function buildPrompt(asset, compiledText) {
  return [
    `Analyze the sentiment of the following market data for ${asset}.`,
    'Rate the overall sentiment from -1.0 (extremely bearish) to +1.0 (extremely bullish).',
    'Also identify the top 3 themes and any significant risk factors.',
    '',
    'Headlines and posts:',
    compiledText,
    '',
    'Respond in JSON: { "sentiment": 0.3, "confidence": 0.7, "themes": ["...", "..."], "risks": ["..."], "summary": "..." }',
  ].join('\n');
}

/**
 * Call the best available LLM (Grok first, then OpenAI fallback) with the
 * sentiment prompt.  Returns the raw text response.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function callLLM(prompt) {
  // Try Grok (X.AI) first
  if (GROK_API_KEY) {
    try {
      const data = await postJson(
        'https://api.x.ai/v1/chat/completions',
        {
          model: 'grok-3-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.4,
          max_tokens: 800,
        },
        { Authorization: `Bearer ${GROK_API_KEY}` },
        { retries: 1, timeoutMs: 30000 },
      );
      const text = data?.choices?.[0]?.message?.content;
      if (text && text.length > 10) return text;
    } catch (err) {
      logger.warn('Grok LLM call failed', { error: err.message || err });
    }
  }

  // Fallback to OpenAI
  if (OPENAI_API_KEY) {
    try {
      const data = await postJson(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.4,
          max_tokens: 800,
        },
        { Authorization: `Bearer ${OPENAI_API_KEY}` },
        { retries: 1, timeoutMs: 30000 },
      );
      const text = data?.choices?.[0]?.message?.content;
      if (text && text.length > 10) return text;
    } catch (err) {
      logger.warn('OpenAI LLM call failed', { error: err.message || err });
    }
  }

  throw new Error('No LLM available — both GROK_API_KEY and OPENAI_API_KEY missing or failed');
}

/**
 * Parse the LLM JSON response and validate the fields.
 * Handles both raw JSON and JSON wrapped in markdown code fences.
 * @param {string} raw — LLM response text
 * @returns {{ sentiment: number, confidence: number, themes: string[], risks: string[], summary: string }}
 */
function parseLLMResponse(raw) {
  // Strip markdown code fences if present
  let jsonStr = raw.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  // Find the first { ... } block
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('No JSON object found in LLM response');
  }
  jsonStr = jsonStr.slice(start, end + 1);

  const parsed = JSON.parse(jsonStr);

  // Validate and clamp sentiment to [-1, 1]
  let sentiment = Number(parsed.sentiment);
  if (isNaN(sentiment)) sentiment = 0;
  sentiment = Math.max(-1, Math.min(1, sentiment));

  // Validate confidence to [0, 1]
  let confidence = Number(parsed.confidence);
  if (isNaN(confidence) || confidence < 0 || confidence > 1) confidence = 0.5;

  return {
    sentiment,
    confidence,
    themes: Array.isArray(parsed.themes) ? parsed.themes.map(String).slice(0, 5) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.map(String).slice(0, 5) : [],
    summary: String(parsed.summary || '').slice(0, 500),
  };
}

// ─── Signal Publishing ───────────────────────────────────────────────────────

/**
 * Publish per-asset sentiment signal and return the result.
 */
function publishAssetSignal(asset, analysis, sourceCount) {
  if (!bus) return null;

  const direction = analysis.sentiment > 0.2
    ? 'bullish'
    : analysis.sentiment < -0.2
      ? 'bearish'
      : 'neutral';

  return bus.publish({
    type: 'sentiment',
    source: 'sentiment-agent',
    confidence: analysis.confidence,
    payload: {
      asset,
      sentiment: analysis.sentiment,
      direction,
      themes: analysis.themes,
      risks: analysis.risks,
      summary: analysis.summary,
      sources: sourceCount,
    },
    ttlMs: SIGNAL_TTL_MS,
  });
}

/**
 * Publish aggregate market regime signal.
 */
function publishMarketRegime(avgSentiment, avgConfidence) {
  if (!bus) return null;

  const regime = avgSentiment > 0.2
    ? 'risk_on'
    : avgSentiment < -0.2
      ? 'risk_off'
      : 'neutral';

  return bus.publish({
    type: 'market_regime',
    source: 'sentiment-agent',
    confidence: avgConfidence,
    payload: { regime, avgSentiment: Number(avgSentiment.toFixed(4)) },
    ttlMs: SIGNAL_TTL_MS,
  });
}

// ─── Main Flow ───────────────────────────────────────────────────────────────

async function analyzeAsset(asset) {
  const collected = [];
  let sourceCount = 0;

  // Collect data from enabled sources
  if (SOURCES.includes('news')) {
    const headlines = await fetchNewsHeadlines(asset);
    collected.push(...headlines);
    sourceCount += headlines.length;
  }

  if (SOURCES.includes('x')) {
    const xPosts = await fetchXSentiment(asset);
    collected.push(...xPosts);
    sourceCount += xPosts.length;
  }

  if (SOURCES.includes('earnings')) {
    const earnings = await fetchEarningsData(asset);
    collected.push(...earnings);
    sourceCount += earnings.length;
  }

  if (collected.length === 0) {
    logger.warn(`No data collected for ${asset} — skipping LLM analysis`);
    return null;
  }

  // Truncate total compiled text to avoid token limits (~12k chars max)
  const compiledText = collected
    .map((text, i) => `${i + 1}. ${text}`)
    .join('\n')
    .slice(0, 12000);

  const prompt = buildPrompt(asset, compiledText);
  const rawResponse = await callLLM(prompt);
  const analysis = parseLLMResponse(rawResponse);

  return { ...analysis, sourceCount };
}

async function main() {
  const startMs = Date.now();

  // Gate: enabled check
  if (!ENABLED) {
    process.stdout.write(JSON.stringify({
      status: 'disabled',
      message: 'Set SENTIMENT_AGENT_ENABLED=true to activate',
      ts: new Date().toISOString(),
    }) + '\n');
    return;
  }

  // Gate: API key check
  if (!TAVILY_API_KEY) {
    logger.error('TAVILY_API_KEY is required');
    process.exit(1);
  }
  if (!GROK_API_KEY && !OPENAI_API_KEY) {
    logger.error('At least one LLM key required (GROK_API_KEY or OPENAI_API_KEY)');
    process.exit(1);
  }

  // Load state and check interval
  const state = loadState();
  const elapsed = (Date.now() - (state.lastRunAt || 0)) / 1000;

  if (elapsed < INTERVAL_SEC) {
    const waitSec = Math.ceil(INTERVAL_SEC - elapsed);
    process.stdout.write(JSON.stringify({
      status: 'skipped',
      reason: 'interval',
      nextRunInSec: waitSec,
      lastRunAt: new Date(state.lastRunAt).toISOString(),
      ts: new Date().toISOString(),
    }) + '\n');
    return;
  }

  logger.info(`Analyzing ${ASSETS.length} assets: ${ASSETS.join(', ')} | sources: ${SOURCES.join(', ')}`);

  const results = [];
  let totalSentiment = 0;
  let totalConfidence = 0;
  let successCount = 0;

  // Analyze each asset sequentially to respect rate limits
  for (const asset of ASSETS) {
    try {
      const result = await analyzeAsset(asset);
      if (!result) continue;

      // Publish per-asset signal
      publishAssetSignal(asset, result, result.sourceCount);

      // Record in state
      state.analyses.push({
        asset,
        sentiment: result.sentiment,
        confidence: result.confidence,
        themes: result.themes,
        risks: result.risks,
        sources: result.sourceCount,
        ts: Date.now(),
      });

      results.push({ asset, ...result });
      totalSentiment += result.sentiment;
      totalConfidence += result.confidence;
      successCount++;

      logger.info(`${asset}: sentiment=${result.sentiment.toFixed(3)} confidence=${result.confidence.toFixed(2)} sources=${result.sourceCount} themes=${result.themes.join(', ')}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`${asset} analysis failed: ${message}`);
      recordError(state, `analyze:${asset}`, message);
    }
  }

  // Publish aggregate market regime if we have data
  if (successCount > 0) {
    const avgSentiment = totalSentiment / successCount;
    const avgConfidence = totalConfidence / successCount;
    publishMarketRegime(avgSentiment, avgConfidence);
  }

  // Update state
  state.lastRunAt = Date.now();
  state.dailyRuns = (state.dailyRuns || 0) + 1;

  // Reset daily counter at midnight
  const lastDate = new Date(state.lastRunAt).toDateString();
  const today = new Date().toDateString();
  if (lastDate !== today) {
    state.dailyRuns = 1;
  }

  saveState(state);

  // Output structured status to stdout
  const durationMs = Date.now() - startMs;
  const output = {
    status: 'ok',
    assetsAnalyzed: successCount,
    assetsTotal: ASSETS.length,
    avgSentiment: successCount > 0 ? Number((totalSentiment / successCount).toFixed(4)) : null,
    avgConfidence: successCount > 0 ? Number((totalConfidence / successCount).toFixed(4)) : null,
    regime: successCount > 0
      ? (totalSentiment / successCount > 0.2 ? 'risk_on' : totalSentiment / successCount < -0.2 ? 'risk_off' : 'neutral')
      : null,
    results: results.map((r) => ({
      asset: r.asset,
      sentiment: r.sentiment,
      confidence: r.confidence,
      direction: r.sentiment > 0.2 ? 'bullish' : r.sentiment < -0.2 ? 'bearish' : 'neutral',
      themes: r.themes,
      sources: r.sourceCount,
    })),
    signalBus: bus ? 'published' : 'unavailable',
    durationMs,
    ts: new Date().toISOString(),
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.fatal(`fatal: ${message}`);

  // Attempt to record the error in state
  try {
    const state = loadState();
    recordError(state, 'main', message);
    saveState(state);
  } catch { /* state write failed — non-fatal */ }

  process.exit(1);
});
