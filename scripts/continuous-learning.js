#!/usr/bin/env node

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.vercel.app').replace(/\/$/, '');
const AUTONOMY_ADMIN_KEY = (process.env.AUTONOMY_ADMIN_KEY || '').trim();
const FORECAST_HORIZONS = (process.env.CONTINUOUS_FORECAST_HORIZONS || '6,24,72')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value >= 1)
  .slice(0, 8);
const POLICY_LIMIT = Math.max(100, Math.min(5000, Number(process.env.CONTINUOUS_POLICY_LIMIT || 1800)));
const INGEST_MIN_INTERVAL_HOURS = Math.max(1, Number(process.env.CONTINUOUS_INGEST_MIN_INTERVAL_HOURS || 12));
const ENABLE_INGEST = String(process.env.CONTINUOUS_ENABLE_INGEST || 'true').toLowerCase() !== 'false';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function call(path, { method = 'GET', body, retries = 2 } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (AUTONOMY_ADMIN_KEY) {
    headers['x-autonomy-key'] = AUTONOMY_ADMIN_KEY;
  }

  let lastError = null;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const response = await fetch(`${APP_BASE_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { raw: text };
      }

      if (!response.ok) {
        throw new Error(`${path} failed: HTTP ${response.status} ${JSON.stringify(payload)}`);
      }

      return payload;
    } catch (error) {
      lastError = error;
      if (attempt <= retries) {
        await sleep(600 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function maybeIngestDeepData(report) {
  if (!ENABLE_INGEST) {
    report.steps.push({ name: 'ingest', status: 'skipped', reason: 'disabled' });
    return;
  }

  const status = await call('/api/ingest');
  const lastRunTime = Number(status?.lastRun?.time || 0);
  const ageMs = Date.now() - lastRunTime;
  const minIntervalMs = INGEST_MIN_INTERVAL_HOURS * 60 * 60 * 1000;

  if (lastRunTime > 0 && ageMs < minIntervalMs) {
    report.steps.push({
      name: 'ingest',
      status: 'skipped',
      reason: `fresh (${Math.round(ageMs / 60000)}m old)`,
    });
    return;
  }

  const result = await call('/api/ingest', { method: 'POST' });
  report.steps.push({
    name: 'ingest',
    status: 'ok',
    datasets: result?.result ? Object.keys(result.result) : [],
  });
}

function resolvePolicyRegime(autonomyStatus) {
  const regime = autonomyStatus?.market?.latest?.regime;
  if (regime === 'risk_on' || regime === 'risk_off' || regime === 'neutral') {
    return regime;
  }
  return 'unknown';
}

async function main() {
  const report = {
    ts: new Date().toISOString(),
    baseUrl: APP_BASE_URL,
    steps: [],
  };

  const autonomyStatus = await call('/api/status/autonomy');
  report.steps.push({
    name: 'autonomy-status',
    status: 'ok',
    marketRegime: autonomyStatus?.market?.latest?.regime || 'unknown',
    geopoliticalRisk: autonomyStatus?.market?.latest?.geopoliticalRisk ?? null,
  });

  for (const horizonHours of FORECAST_HORIZONS) {
    const forecast = await call('/api/status/autonomy/forecast', {
      method: 'POST',
      body: { horizonHours },
      retries: 1,
    });
    report.steps.push({
      name: `forecast-${horizonHours}h`,
      status: 'ok',
      unresolved: forecast?.forecast?.unresolved,
      avgBrier: forecast?.forecast?.averageBrierScore,
      decisionSignal: forecast?.decisionSignal,
    });
  }

  const regime = resolvePolicyRegime(autonomyStatus);
  const policy = await call('/api/status/ensemble/policy', {
    method: 'POST',
    body: { regime, limit: POLICY_LIMIT },
  });
  report.steps.push({
    name: 'ensemble-policy',
    status: 'ok',
    applied: Boolean(policy?.result?.applied),
    regime,
  });

  const groundTruth = await call('/api/status/autonomy/ground-truth', { method: 'POST' });
  report.steps.push({
    name: 'ground-truth',
    status: 'ok',
    ingested: Array.isArray(groundTruth?.ingested) ? groundTruth.ingested.length : 0,
  });

  const retrain = await call('/api/status/autonomy/retrain', {
    method: 'POST',
    body: { reason: 'continuous_learning_cycle' },
  });
  report.steps.push({
    name: 'retrain-check',
    status: 'ok',
    retrain: retrain?.retrain,
  });

  await maybeIngestDeepData(report);

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
