#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const appBaseUrl = (process.env.APP_BASE_URL || 'https://freedomforge-max.vercel.app').replace(/\/$/, '');
const distributionBaseUrl = process.env.DISTRIBUTION_URL || `${appBaseUrl}/api/alchemy/wallet/distribute`;
const healthUrl = process.env.HEALTH_URL || `${appBaseUrl}/api/alchemy/health`;
const shard = Math.max(0, parseInt(process.env.BOT_SHARD_INDEX || '0', 10));
const shards = Math.max(1, parseInt(process.env.BOT_SHARDS || '1', 10));
const botIdPrefix = (process.env.BOT_ID || `live-${shard}`).trim();

const configuredInterval = parseInt(process.env.TRADE_LOOP_INTERVAL_MS || '1000', 10);
const intervalMs = Number.isFinite(configuredInterval) ? Math.max(1000, configuredInterval) : 1000;
const maxAdaptiveIntervalMs = Math.max(intervalMs, parseInt(process.env.TRADE_LOOP_MAX_INTERVAL_MS || '10000', 10));
const skipBackoffFactorRaw = Number(process.env.TRADE_LOOP_SKIP_BACKOFF_FACTOR || 1.35);
const skipBackoffFactor = Number.isFinite(skipBackoffFactorRaw) ? Math.max(1, Math.min(3, skipBackoffFactorRaw)) : 1.35;
const successCooldownMs = Math.max(intervalMs, parseInt(process.env.TRADE_LOOP_SUCCESS_COOLDOWN_MS || '8000', 10));
const jitterMs = Math.max(0, parseInt(process.env.TRADE_LOOP_JITTER_MS || '200', 10));
const shardPhaseMs = Math.max(0, parseInt(process.env.TRADE_LOOP_SHARD_PHASE_MS || '300', 10));
const healthEvery = Math.max(1, parseInt(process.env.TRADE_LOOP_HEALTH_EVERY || '30', 10));
const requestTimeoutMs = Math.max(1000, parseInt(process.env.TRADE_LOOP_REQUEST_TIMEOUT_MS || '12000', 10));

let running = true;
let tick = 0;
let failures = 0;
let skipStreak = 0;
let successCooldownUntil = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(signalMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), signalMs);
  return { controller, timeout };
}

async function getJson(url) {
  const { controller, timeout } = withTimeout(requestTimeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'freedomforge-max/trade-loop',
      },
    });

    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${JSON.stringify(payload).slice(0, 220)}`);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeResult(payload) {
  const results = payload?.results;
  if (!results) return 'skip(no-transfer)';
  const hashes = Object.values(results).filter(Boolean);
  if (!hashes.length) return 'skip(empty-results)';
  return `tx=${hashes.join(',')}`;
}

function getAdaptiveInterval() {
  if (skipStreak <= 0) return intervalMs;
  const computed = Math.round(intervalMs * Math.pow(skipBackoffFactor, Math.min(skipStreak, 10)));
  return Math.min(maxAdaptiveIntervalMs, Math.max(intervalMs, computed));
}

async function doHealthCheck() {
  const payload = await getJson(healthUrl);
  if (payload?.status !== 'ok') {
    throw new Error(`unexpected health payload: ${JSON.stringify(payload).slice(0, 180)}`);
  }
}

async function doDistribution() {
  const botId = `${botIdPrefix}-${Date.now()}`;
  const url = `${distributionBaseUrl}?shard=${encodeURIComponent(String(shard))}&shards=${encodeURIComponent(String(shards))}&botId=${encodeURIComponent(botId)}`;
  const payload = await getJson(url);
  return { botId, payload };
}

async function loop() {
  console.log(`[trade-loop] start interval=${intervalMs}ms max_interval=${maxAdaptiveIntervalMs}ms backoff=${skipBackoffFactor} success_cooldown=${successCooldownMs}ms jitter=${jitterMs}ms shard=${shard}/${shards} app=${appBaseUrl}`);

  if (shard > 0 && shardPhaseMs > 0) {
    const startDelay = shard * shardPhaseMs;
    console.log(`[trade-loop] shard phase delay ${startDelay}ms`);
    await sleep(startDelay);
  }

  while (running) {
    const started = Date.now();
    tick += 1;

    try {
      if (tick % healthEvery === 1) {
        await doHealthCheck();
      }

      const { botId, payload } = await doDistribution();
      const summary = summarizeResult(payload);
      if (summary.startsWith('skip(')) {
        skipStreak += 1;
      } else {
        skipStreak = 0;
        successCooldownUntil = Date.now() + successCooldownMs;
      }
      failures = 0;
      console.log(`[trade-loop] ${new Date().toISOString()} tick=${tick} botId=${botId} ${summary} skip_streak=${skipStreak}`);
    } catch (error) {
      failures += 1;
      skipStreak = Math.min(skipStreak + 1, 10);
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[trade-loop] ${new Date().toISOString()} tick=${tick} failure=${failures} error=${message}`);
    }

    const targetInterval = getAdaptiveInterval();
    const elapsed = Date.now() - started;
    const cooldownWait = Math.max(0, successCooldownUntil - Date.now());
    if (tick % 10 === 0 || skipStreak > 0) {
      console.log(`[trade-loop] interval target=${targetInterval}ms elapsed=${elapsed}ms cooldown_wait=${cooldownWait}ms`);
    }
    const jitterWait = jitterMs > 0 ? Math.floor(Math.random() * (jitterMs + 1)) : 0;
    const waitMs = Math.max(0, targetInterval - elapsed, cooldownWait) + jitterWait;
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }
}

process.on('SIGINT', () => {
  running = false;
  console.log('[trade-loop] received SIGINT, exiting...');
});

process.on('SIGTERM', () => {
  running = false;
  console.log('[trade-loop] received SIGTERM, exiting...');
});

loop().catch((error) => {
  console.error('[trade-loop] fatal', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
