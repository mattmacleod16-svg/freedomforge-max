#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const appBaseUrl = (process.env.APP_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'https://freedomforge-max.up.railway.app').replace(/\/$/, '');
const distributionBaseUrl = process.env.DISTRIBUTION_URL || `${appBaseUrl}/api/alchemy/wallet/distribute`;
const healthUrl = process.env.HEALTH_URL || `${appBaseUrl}/api/alchemy/health`;
const tradeLoopNetwork = (process.env.TRADE_LOOP_NETWORK || '').trim();
const shard = Math.max(0, parseInt(process.env.BOT_SHARD_INDEX || '0', 10));
const shards = Math.max(1, parseInt(process.env.BOT_SHARDS || '1', 10));
const botIdPrefix = (process.env.BOT_ID || `live-${shard}`).trim();

const configuredInterval = parseInt(process.env.TRADE_LOOP_INTERVAL_MS || '1000', 10);
const intervalMs = Number.isFinite(configuredInterval) ? Math.max(1000, configuredInterval) : 1000;
const maxAdaptiveIntervalMs = Math.max(intervalMs, parseInt(process.env.TRADE_LOOP_MAX_INTERVAL_MS || '10000', 10));
const skipBackoffFactorRaw = Number(process.env.TRADE_LOOP_SKIP_BACKOFF_FACTOR || 1.35);
const skipBackoffFactor = Number.isFinite(skipBackoffFactorRaw) ? Math.max(1.05, Math.min(5.0, skipBackoffFactorRaw)) : 1.35;
const successCooldownMs = Math.max(intervalMs, parseInt(process.env.TRADE_LOOP_SUCCESS_COOLDOWN_MS || '8000', 10));
const jitterMs = Math.max(0, parseInt(process.env.TRADE_LOOP_JITTER_MS || '200', 10));
const shardPhaseMs = Math.max(0, parseInt(process.env.TRADE_LOOP_SHARD_PHASE_MS || '300', 10));
const healthEvery = Math.max(1, parseInt(process.env.TRADE_LOOP_HEALTH_EVERY || '30', 10));
const requestTimeoutMs = Math.max(1000, parseInt(process.env.TRADE_LOOP_REQUEST_TIMEOUT_MS || '12000', 10));
const profitGuardEnabled = String(process.env.TRADE_LOOP_PROFIT_GUARD_ENABLED || 'true').toLowerCase() !== 'false';
const profitGuardLookbackHours = Math.max(1, parseInt(process.env.TRADE_LOOP_PROFIT_GUARD_LOOKBACK_HOURS || '2', 10));
const profitGuardMinNetEth = Math.max(0.0001, Math.min(1.0, Number(process.env.TRADE_LOOP_PROFIT_GUARD_MIN_NET_ETH || '0.001')));
const profitGuardMinSuccessRate = Math.max(0.1, Math.min(1.0, Number(process.env.TRADE_LOOP_PROFIT_GUARD_MIN_SUCCESS_RATE || '0.8')));
const profitGuardMinAttempts = Math.max(1, parseInt(process.env.TRADE_LOOP_PROFIT_GUARD_MIN_ATTEMPTS || '3', 10));
const profitGuardLogLimit = Math.max(200, parseInt(process.env.TRADE_LOOP_PROFIT_GUARD_LOG_LIMIT || '1500', 10));

let running = true;
let tick = 0;
let failures = 0;
let skipStreak = 0;
let successCooldownUntil = 0;

function parseBigIntSafe(value) {
  try {
    if (value === undefined || value === null || value === '') return BigInt(0);
    return BigInt(String(value));
  } catch {
    return BigInt(0);
  }
}

function weiToEthNumber(wei) {
  const base = BigInt('1000000000000000000');
  const whole = Number(wei / base);
  const frac = Number(wei % base) / 1e18;
  return whole + frac;
}

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
    const headers = {
      'User-Agent': 'freedomforge-max/trade-loop',
    };
    if (process.env.ALERT_SECRET && isTrustedUrl(url)) {
      headers['x-api-secret'] = process.env.ALERT_SECRET;
    }
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers,
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

// Only send auth secret to trusted origins (prevent leak to misconfigured URLs)
function isTrustedUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch { return false; }
}

async function postJson(url, body = {}) {
  const { controller, timeout } = withTimeout(requestTimeoutMs);
  try {
    const headers = {
      'User-Agent': 'freedomforge-max/trade-loop',
      'Content-Type': 'application/json',
    };
    if (process.env.ALERT_SECRET && isTrustedUrl(url)) {
      headers['x-api-secret'] = process.env.ALERT_SECRET;
    }
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify(body),
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
  const url = tradeLoopNetwork
    ? `${healthUrl}${healthUrl.includes('?') ? '&' : '?'}network=${encodeURIComponent(tradeLoopNetwork)}`
    : healthUrl;
  const payload = await getJson(url);
  if (payload?.status !== 'ok') {
    throw new Error(`unexpected health payload: ${JSON.stringify(payload).slice(0, 180)}`);
  }
}

async function doDistribution() {
  const botId = `${botIdPrefix}-${Date.now()}`;
  let url = distributionBaseUrl;
  if (tradeLoopNetwork) {
    url += `${url.includes('?') ? '&' : '?'}network=${encodeURIComponent(tradeLoopNetwork)}`;
  }
  // Use POST to prevent CSRF — distribute is a mutation endpoint
  const payload = await postJson(url, {
    shard: shard,
    shards: shards,
    botId: botId,
  });
  return { botId, payload };
}

async function shouldBlockForProfitGuard() {
  if (!profitGuardEnabled) return { blocked: false };

  let payload;
  try {
    payload = await getJson(`${appBaseUrl}/api/alchemy/wallet/logs?limit=${profitGuardLogLimit}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[trade-loop] profit-guard warning: log fetch failed (${message}); defaulting to no-block`);
    return { blocked: false };
  }

  const logs = Array.isArray(payload?.logs) ? payload.logs : [];
  const cutoff = Date.now() - profitGuardLookbackHours * 60 * 60 * 1000;

  let transferSuccess = 0;
  let transferFailed = 0;
  let payoutsWei = BigInt(0);
  let topupsWei = BigInt(0);

  for (const row of logs) {
    const ts = Date.parse(row?.time || '');
    if (!Number.isFinite(ts) || ts < cutoff) continue;

    const type = row?.type;
    const itemPayload = row?.payload || {};

    if (type === 'transfer') {
      transferSuccess += 1;
      payoutsWei += parseBigIntSafe(itemPayload.amount);
    }
    if (type === 'transfer_failed') transferFailed += 1;

    if (type === 'gas_topup') {
      const amountEth = Number(itemPayload.amount || 0) || 0;
      topupsWei += BigInt(Math.floor(amountEth * 1e18));
    }
  }

  const attempts = transferSuccess + transferFailed;
  if (attempts < profitGuardMinAttempts) {
    return {
      blocked: false,
      reason: `min-attempts-not-met (${attempts}/${profitGuardMinAttempts})`,
    };
  }

  const successRate = attempts > 0 ? transferSuccess / attempts : 1;
  const netEth = weiToEthNumber(payoutsWei - topupsWei);
  const blocked = successRate < profitGuardMinSuccessRate || netEth < profitGuardMinNetEth;

  return {
    blocked,
    reason: blocked
      ? `profit-guard-block successRate=${(successRate * 100).toFixed(1)}% netEth=${netEth.toFixed(6)} thresholds(rate>=${profitGuardMinSuccessRate}, net>=${profitGuardMinNetEth})`
      : `profit-guard-pass successRate=${(successRate * 100).toFixed(1)}% netEth=${netEth.toFixed(6)}`,
  };
}

async function loop() {
  console.log(`[trade-loop] start interval=${intervalMs}ms max_interval=${maxAdaptiveIntervalMs}ms backoff=${skipBackoffFactor} success_cooldown=${successCooldownMs}ms jitter=${jitterMs}ms shard=${shard}/${shards} network=${tradeLoopNetwork || 'default'} app=${appBaseUrl}`);

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

      const guard = await shouldBlockForProfitGuard();
      if (guard.blocked) {
        skipStreak += 1;
        failures = 0;
        console.warn(`[trade-loop] ${new Date().toISOString()} tick=${tick} ${guard.reason} skip_streak=${skipStreak}`);
        const targetInterval = getAdaptiveInterval();
        const elapsed = Date.now() - started;
        const jitterWait = jitterMs > 0 ? Math.floor(Math.random() * (jitterMs + 1)) : 0;
        const waitMs = Math.max(0, targetInterval - elapsed) + jitterWait;
        if (waitMs > 0) await sleep(waitMs);
        continue;
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

process.on('unhandledRejection', (reason) => {
  console.error('[trade-loop] unhandled rejection:', reason instanceof Error ? reason.message : String(reason));
});

loop().catch((error) => {
  console.error('[trade-loop] fatal', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
