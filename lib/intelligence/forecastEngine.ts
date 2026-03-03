import fs from 'fs';
import path from 'path';
import { logEvent } from '@/lib/logger';
import {
  type MarketFeaturePoint,
  type MarketRegime,
  getLatestMarketSnapshot,
  getMarketFeatureHistory,
} from '@/lib/intelligence/marketFeatureStore';

interface ForecastRecord {
  id: string;
  createdAt: number;
  targetAt: number;
  horizonHours: number;
  question: string;
  probability: number;
  confidence: number;
  regime: MarketRegime;
  signals: string[];
  referencePrice: number;
  resolved: boolean;
  outcome?: 0 | 1;
  resolvedAt?: number;
  brierScore?: number;
}

interface ForecastState {
  records: ForecastRecord[];
  updatedAt: number;
}

const DATA_DIR = process.env.VERCEL ? '/tmp/freedomforge-data' : path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'forecast-state.json');
const MAX_RECORDS = Math.max(500, Number(process.env.FORECAST_MAX_RECORDS || 5000));
const DEFAULT_HORIZON_HOURS = Math.max(1, Number(process.env.FORECAST_DEFAULT_HOURS || 24));
const FORECAST_REFRESH_COOLDOWN_MS = Math.max(15 * 60 * 1000, Number(process.env.FORECAST_REFRESH_COOLDOWN_MS || 60 * 60 * 1000));

let initialized = false;
let state: ForecastState = {
  records: [],
  updatedAt: 0,
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function saveState() {
  try {
    ensureDataDir();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch {}
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function initializeForecastEngine() {
  if (initialized) return;
  initialized = true;

  try {
    ensureDataDir();
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ForecastState>;
      state = {
        records: Array.isArray(parsed.records) ? parsed.records.slice(-MAX_RECORDS) : [],
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      };
    } else {
      saveState();
    }
  } catch {
    saveState();
  }
}

function computeMarketProbability(point: MarketFeaturePoint) {
  const momentumScore = clamp((point.btcChange24h + 6) / 12);
  const fearGreedScore = point.fearGreed === null ? 0.5 : clamp(point.fearGreed / 100);
  const volatilityPenalty = clamp(point.realizedVolatility / 0.06);

  const regimeBias = point.regime === 'risk_on'
    ? 0.15
    : point.regime === 'risk_off'
      ? -0.15
      : 0;

  const probability = clamp(
    0.45 * momentumScore +
    0.35 * fearGreedScore +
    0.20 * (1 - volatilityPenalty) +
    regimeBias
  );

  const confidence = clamp(
    0.35 +
    (Math.abs(probability - 0.5) * 0.9) +
    (point.signals.length * 0.04)
  );

  return { probability, confidence };
}

function nextForecastId() {
  return `fc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function trimState() {
  if (state.records.length > MAX_RECORDS) {
    state.records = state.records.slice(-MAX_RECORDS);
  }
}

function latestUnresolvedByHorizon(horizonHours: number) {
  const unresolved = state.records
    .filter((record) => !record.resolved && record.horizonHours === horizonHours)
    .sort((a, b) => b.createdAt - a.createdAt);

  return unresolved[0] || null;
}

export async function ensureMarketForecast(horizonHours = DEFAULT_HORIZON_HOURS) {
  initializeForecastEngine();
  const latest = latestUnresolvedByHorizon(horizonHours);
  if (latest && (Date.now() - latest.createdAt) < FORECAST_REFRESH_COOLDOWN_MS) {
    return latest;
  }

  const snapshot = getLatestMarketSnapshot();
  if (!snapshot) return null;

  const scoring = computeMarketProbability(snapshot);
  const createdAt = Date.now();
  const record: ForecastRecord = {
    id: nextForecastId(),
    createdAt,
    targetAt: createdAt + (horizonHours * 60 * 60 * 1000),
    horizonHours,
    question: `BTC price will be higher in ${horizonHours}h`,
    probability: scoring.probability,
    confidence: scoring.confidence,
    regime: snapshot.regime,
    signals: snapshot.signals,
    referencePrice: snapshot.btcUsd,
    resolved: false,
  };

  state.records.push(record);
  trimState();
  state.updatedAt = Date.now();
  saveState();

  await logEvent('forecast_created', {
    id: record.id,
    probability: record.probability,
    confidence: record.confidence,
    horizonHours,
    regime: record.regime,
  });

  return record;
}

export async function resolveDueForecasts() {
  initializeForecastEngine();
  const latest = getLatestMarketSnapshot();
  if (!latest) return { resolved: 0, unresolved: state.records.filter((record) => !record.resolved).length };

  let resolvedCount = 0;
  const now = Date.now();

  for (const record of state.records) {
    if (record.resolved) continue;
    if (record.targetAt > now) continue;
    if (record.referencePrice <= 0 || latest.btcUsd <= 0) continue;

    const outcome: 0 | 1 = latest.btcUsd > record.referencePrice ? 1 : 0;
    const brierScore = (record.probability - outcome) ** 2;

    record.resolved = true;
    record.outcome = outcome;
    record.resolvedAt = now;
    record.brierScore = Number(brierScore.toFixed(6));
    resolvedCount += 1;
  }

  if (resolvedCount > 0) {
    state.updatedAt = now;
    saveState();
    await logEvent('forecast_resolved_batch', {
      resolved: resolvedCount,
      unresolved: state.records.filter((record) => !record.resolved).length,
    });
  }

  return {
    resolved: resolvedCount,
    unresolved: state.records.filter((record) => !record.resolved).length,
  };
}

function calibrationBuckets(resolved: ForecastRecord[]) {
  const buckets: Array<{ min: number; max: number; count: number; avgPred: number; empirical: number }> = [];

  for (let index = 0; index < 10; index += 1) {
    const min = index / 10;
    const max = (index + 1) / 10;
    const rows = resolved.filter((record) => record.probability >= min && record.probability < max);
    const count = rows.length;
    const avgPred = count > 0 ? average(rows.map((row) => row.probability)) : 0;
    const empirical = count > 0 ? average(rows.map((row) => row.outcome || 0)) : 0;
    buckets.push({ min, max, count, avgPred: Number(avgPred.toFixed(4)), empirical: Number(empirical.toFixed(4)) });
  }

  return buckets;
}

function meanAbsoluteCalibrationError(buckets: Array<{ count: number; avgPred: number; empirical: number }>) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (total === 0) return 0;

  const weighted = buckets.reduce((sum, bucket) => {
    if (bucket.count === 0) return sum;
    return sum + (Math.abs(bucket.avgPred - bucket.empirical) * bucket.count);
  }, 0);

  return weighted / total;
}

export function getForecastSummary() {
  initializeForecastEngine();

  const resolved = state.records.filter((record) => record.resolved && typeof record.brierScore === 'number');
  const unresolved = state.records.filter((record) => !record.resolved);
  const recentResolved = resolved.slice(-200);

  const avgBrier = recentResolved.length > 0
    ? average(recentResolved.map((record) => record.brierScore || 0))
    : null;

  const accuracy = recentResolved.length > 0
    ? average(recentResolved.map((record) => record.outcome === 1 ? (record.probability >= 0.5 ? 1 : 0) : (record.probability < 0.5 ? 1 : 0)))
    : null;

  const buckets = calibrationBuckets(recentResolved);
  const calibrationError = meanAbsoluteCalibrationError(buckets);

  return {
    updatedAt: state.updatedAt,
    total: state.records.length,
    resolved: resolved.length,
    unresolved: unresolved.length,
    averageBrierScore: avgBrier === null ? null : Number(avgBrier.toFixed(6)),
    directionalAccuracy: accuracy === null ? null : Number(accuracy.toFixed(4)),
    calibrationError: Number(calibrationError.toFixed(6)),
    latestForecast: unresolved.sort((a, b) => b.createdAt - a.createdAt)[0] || null,
    latestResolved: resolved.sort((a, b) => b.resolvedAt! - a.resolvedAt!)[0] || null,
    buckets,
  };
}

export function runForecastBacktest(horizonHours = DEFAULT_HORIZON_HOURS) {
  initializeForecastEngine();
  const history = getMarketFeatureHistory(24 * 30);
  if (history.length < 24) {
    return {
      horizonHours,
      samples: 0,
      averageBrierScore: null,
      directionalAccuracy: null,
      calibrationError: null,
      buckets: [],
    };
  }

  const horizonMs = horizonHours * 60 * 60 * 1000;
  const syntheticResolved: ForecastRecord[] = [];

  for (let index = 0; index < history.length; index += 1) {
    const point = history[index];
    const future = history.find((candidate, candidateIndex) => candidateIndex > index && candidate.ts >= point.ts + horizonMs);
    if (!future) continue;

    const scoring = computeMarketProbability(point);
    const outcome: 0 | 1 = future.btcUsd > point.btcUsd ? 1 : 0;
    const brierScore = (scoring.probability - outcome) ** 2;

    syntheticResolved.push({
      id: `bt_${index}`,
      createdAt: point.ts,
      targetAt: point.ts + horizonMs,
      horizonHours,
      question: 'backtest',
      probability: scoring.probability,
      confidence: scoring.confidence,
      regime: point.regime,
      signals: point.signals,
      referencePrice: point.btcUsd,
      resolved: true,
      outcome,
      resolvedAt: future.ts,
      brierScore,
    });
  }

  const avgBrier = syntheticResolved.length > 0
    ? average(syntheticResolved.map((record) => record.brierScore || 0))
    : null;

  const accuracy = syntheticResolved.length > 0
    ? average(syntheticResolved.map((record) => record.outcome === 1 ? (record.probability >= 0.5 ? 1 : 0) : (record.probability < 0.5 ? 1 : 0)))
    : null;

  const buckets = calibrationBuckets(syntheticResolved);
  const calibrationError = meanAbsoluteCalibrationError(buckets);

  return {
    horizonHours,
    samples: syntheticResolved.length,
    averageBrierScore: avgBrier === null ? null : Number(avgBrier.toFixed(6)),
    directionalAccuracy: accuracy === null ? null : Number(accuracy.toFixed(4)),
    calibrationError: Number(calibrationError.toFixed(6)),
    buckets,
  };
}
