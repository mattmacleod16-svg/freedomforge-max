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
const healthEvery = Math.max(1, parseInt(process.env.TRADE_LOOP_HEALTH_EVERY || '30', 10));
const requestTimeoutMs = Math.max(1000, parseInt(process.env.TRADE_LOOP_REQUEST_TIMEOUT_MS || '12000', 10));

let running = true;
let tick = 0;
let failures = 0;

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
  console.log(`[trade-loop] start interval=${intervalMs}ms shard=${shard}/${shards} app=${appBaseUrl}`);

  while (running) {
    const started = Date.now();
    tick += 1;

    try {
      if (tick % healthEvery === 1) {
        await doHealthCheck();
      }

      const { botId, payload } = await doDistribution();
      failures = 0;
      console.log(`[trade-loop] ${new Date().toISOString()} tick=${tick} botId=${botId} ${summarizeResult(payload)}`);
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[trade-loop] ${new Date().toISOString()} tick=${tick} failure=${failures} error=${message}`);
    }

    const elapsed = Date.now() - started;
    const waitMs = Math.max(0, intervalMs - elapsed);
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
