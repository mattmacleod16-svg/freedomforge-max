#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.vercel.app').replace(/\/$/, '');
const ALERT_URL = process.env.ALERT_WEBHOOK_URL || '';
const ALERT_MENTION = (process.env.ALERT_MENTION || '').trim();
const LOOKBACK_HOURS = Math.max(1, parseInt(process.env.KPI_LOOKBACK_HOURS || '24', 10));
const LOG_LIMIT = Math.max(100, parseInt(process.env.KPI_LOG_LIMIT || '2500', 10));

function parseBigIntSafe(value) {
  try {
    if (value === undefined || value === null || value === '') return BigInt(0);
    return BigInt(String(value));
  } catch {
    return BigInt(0);
  }
}

function formatWeiAsEth(wei) {
  const negative = wei < 0;
  const abs = negative ? -wei : wei;
  const base = BigInt('1000000000000000000');
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '');
  const result = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return negative ? `-${result}` : result;
}

function isDiscordWebhook(url) {
  return /discord(?:app)?\.com\/api\/webhooks\//i.test(url);
}

function withMention(message) {
  if (!ALERT_MENTION || !isDiscordWebhook(ALERT_URL)) return message;
  return `${ALERT_MENTION} ${message}`;
}

async function sendAlert(message) {
  if (!ALERT_URL) {
    console.log(message);
    return;
  }
  const payload = withMention(message);
  const body = JSON.stringify({ content: payload, text: payload });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(ALERT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok || res.status < 500) return;
      } finally { clearTimeout(timer); }
    } catch {}
    if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
  }
}

async function fetchJson(pathname) {
  const response = await fetch(`${APP_BASE_URL}${pathname}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed ${pathname}: HTTP ${response.status}`);
  }
  return response.json();
}

function aggregateTransfers(logs, lookbackHours) {
  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
  const result = {
    transferWei: BigInt(0),
    transferCount: 0,
    skippedThreshold: 0,
    skippedReserve: 0,
  };

  for (const entry of logs || []) {
    const ts = Date.parse(entry?.time || '');
    if (!Number.isFinite(ts) || ts < cutoff) continue;

    if (entry?.type === 'transfer') {
      result.transferCount += 1;
      result.transferWei += parseBigIntSafe(entry?.payload?.amount);
    }

    if (entry?.type === 'distribution_skipped_threshold') {
      result.skippedThreshold += 1;
    }

    if (entry?.type === 'distribution_skipped_native_gas_reserve') {
      result.skippedReserve += 1;
    }
  }

  return result;
}

function summarizeForecast(forecastPayload) {
  const forecast = forecastPayload?.forecast || {};
  const decisionSignal = forecastPayload?.decisionSignal || {};
  return {
    avgBrier: forecast.averageBrierScore,
    directionalAccuracy: forecast.directionalAccuracy,
    calibrationError: forecast.calibrationError,
    weightedProbability: decisionSignal.weightedProbability,
    weightedConfidence: decisionSignal.weightedConfidence,
    edge: decisionSignal.edge,
    shockRisk: decisionSignal.shockRisk,
    horizons: Array.isArray(decisionSignal.horizons) ? decisionSignal.horizons : [],
    notes: Array.isArray(decisionSignal.notes) ? decisionSignal.notes : [],
  };
}

function formatTopPredictionContracts(contracts) {
  if (!Array.isArray(contracts) || contracts.length === 0) return 'n/a';

  const abbreviateTitle = (value, max = 42) => {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return 'unknown';
    return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
  };

  return contracts
    .slice(0, 2)
    .map((contract) => {
      if (typeof contract === 'string') return contract;
      const title = String(contract?.title || '').trim();
      if (!title) return null;
      const probability = Number.isFinite(Number(contract?.probability))
        ? Number(contract.probability).toFixed(2)
        : 'n/a';
      const risk = Number.isFinite(Number(contract?.riskContribution))
        ? Number(contract.riskContribution).toFixed(3)
        : 'n/a';
      return `${abbreviateTitle(title)} p=${probability} r=${risk}`;
    })
    .filter(Boolean)
    .join(' | ') || 'n/a';
}

function resolveTopContractsForReport(market) {
  if (Array.isArray(market?.topRiskContracts) && market.topRiskContracts.length > 0) {
    return market.topRiskContracts;
  }
  return market?.predictionMarketTopContracts;
}

function buildMessage(input) {
  const {
    status,
    wallet,
    transfer,
    autonomy,
    forecast,
  } = input;

  const market = autonomy?.market?.latest || {};
  const models = Array.isArray(status?.models) ? status.models.join(', ') : 'unknown';

  const lines = [
    `📈 Daily 24h KPI Report`,
    `Window: last ${LOOKBACK_HOURS}h`,
    `System ready: ${Boolean(status?.ready)} | models=${models}`,
    `Wallet: ${wallet?.address || 'n/a'}`,
    `Balance: ${formatWeiAsEth(parseBigIntSafe(wallet?.balance || '0'))} ETH`,
    `Payouts 24h: count=${transfer.transferCount} sent=${formatWeiAsEth(transfer.transferWei)} ETH`,
    `Skips 24h: threshold=${transfer.skippedThreshold} reserve=${transfer.skippedReserve}`,
    `Market: regime=${market.regime || 'unknown'} conf=${market.confidence ?? 'n/a'} geoRisk=${market.geopoliticalRisk ?? 'n/a'}`,
    `PM: risk=${market.predictionMarketImpliedRisk ?? 'n/a'} sig=${(market.predictionMarketSignals || []).join(', ') || 'none'} top=${formatTopPredictionContracts(resolveTopContractsForReport(market))}`,
    `Forecast: p=${forecast.weightedProbability ?? 'n/a'} c=${forecast.weightedConfidence ?? 'n/a'} edge=${forecast.edge ?? 'n/a'} shock=${forecast.shockRisk ?? 'n/a'} horizons=${(forecast.horizons || []).join(',') || 'n/a'}`,
    `Calibration: brier=${forecast.avgBrier ?? 'n/a'} accuracy=${forecast.directionalAccuracy ?? 'n/a'} calErr=${forecast.calibrationError ?? 'n/a'}`,
    `Signals: ${(market.signals || []).join(', ') || 'none'} | forecastNotes=${(forecast.notes || []).join(', ') || 'none'}`,
  ];

  return lines.join('\n');
}

async function main() {
  const [status, wallet, logsPayload, autonomy, forecastPayload] = await Promise.all([
    fetchJson('/api/status'),
    fetchJson('/api/alchemy/wallet'),
    fetchJson(`/api/alchemy/wallet/logs?limit=${LOG_LIMIT}`),
    fetchJson('/api/status/autonomy'),
    fetchJson('/api/status/autonomy/forecast?create=true&horizonHours=24'),
  ]);

  const transfer = aggregateTransfers(logsPayload?.logs || [], LOOKBACK_HOURS);
  const forecast = summarizeForecast(forecastPayload);
  const message = buildMessage({ status, wallet, transfer, autonomy, forecast });

  await sendAlert(message);
  console.log('daily-kpi-report: sent');
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`daily-kpi-report failed: ${message}`);
  try {
    await sendAlert(`❌ Daily KPI report failed: ${message}`);
  } catch {}
  process.exit(1);
});
