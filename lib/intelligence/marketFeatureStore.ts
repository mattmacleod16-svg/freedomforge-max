import fs from 'fs';
import path from 'path';

export type MarketRegime = 'risk_on' | 'risk_off' | 'neutral' | 'unknown';

export interface MarketFeaturePoint {
  ts: number;
  btcUsd: number;
  btcChange24h: number;
  fearGreed: number | null;
  realizedVolatility: number;
  regime: MarketRegime;
  confidence: number;
  signals: string[];
}

interface MarketFeatureState {
  history: MarketFeaturePoint[];
  updatedAt: number;
}

const DATA_DIR = process.env.VERCEL ? '/tmp/freedomforge-data' : path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'market-features.json');
const MAX_POINTS = Math.max(96, Number(process.env.MARKET_FEATURE_MAX_POINTS || 24 * 14));

let initialized = false;
let state: MarketFeatureState = {
  history: [],
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

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function safeNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 12000): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'freedomforge-max/1.0',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function computeRealizedVolatility() {
  const recent = state.history.slice(-24);
  if (recent.length < 6) return 0;

  const returns: number[] = [];
  for (let index = 1; index < recent.length; index += 1) {
    const prev = recent[index - 1].btcUsd;
    const next = recent[index].btcUsd;
    if (prev > 0 && next > 0) {
      returns.push(Math.log(next / prev));
    }
  }

  if (returns.length < 5) return 0;
  const mean = avg(returns);
  const variance = avg(returns.map((value) => (value - mean) ** 2));
  return Math.sqrt(Math.max(0, variance));
}

function classifyRegime(input: {
  btcChange24h: number;
  fearGreed: number | null;
  realizedVolatility: number;
}): { regime: MarketRegime; confidence: number; signals: string[] } {
  const { btcChange24h, fearGreed, realizedVolatility } = input;
  const signals: string[] = [];

  if (btcChange24h <= -4) signals.push('btc_drop');
  if (btcChange24h >= 2) signals.push('btc_momentum');
  if (fearGreed !== null && fearGreed < 35) signals.push('fear_high');
  if (fearGreed !== null && fearGreed > 62) signals.push('greed_high');
  if (realizedVolatility > 0.03) signals.push('volatility_high');
  if (realizedVolatility < 0.015) signals.push('volatility_low');

  const riskOffScore =
    (btcChange24h <= -4 ? 0.38 : 0) +
    (fearGreed !== null && fearGreed < 35 ? 0.34 : 0) +
    (realizedVolatility > 0.03 ? 0.28 : 0);

  const riskOnScore =
    (btcChange24h >= 2 ? 0.38 : 0) +
    (fearGreed !== null && fearGreed > 62 ? 0.34 : 0) +
    (realizedVolatility < 0.015 ? 0.28 : 0);

  if (riskOffScore >= 0.55 && riskOffScore > riskOnScore + 0.1) {
    return { regime: 'risk_off', confidence: clamp(riskOffScore), signals };
  }

  if (riskOnScore >= 0.55 && riskOnScore > riskOffScore + 0.1) {
    return { regime: 'risk_on', confidence: clamp(riskOnScore), signals };
  }

  const uncertainty = Math.abs(riskOnScore - riskOffScore);
  return { regime: 'neutral', confidence: clamp(0.5 - uncertainty + 0.25), signals };
}

export function initializeMarketFeatureStore() {
  if (initialized) return;
  initialized = true;

  try {
    ensureDataDir();
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<MarketFeatureState>;
      state = {
        history: Array.isArray(parsed.history) ? parsed.history.slice(-MAX_POINTS) : [],
        updatedAt: safeNumber(parsed.updatedAt, 0),
      };
    } else {
      saveState();
    }
  } catch {
    saveState();
  }
}

export async function updateMarketFeatureStore() {
  initializeMarketFeatureStore();

  let btcUsd = 0;
  let btcChange24h = 0;
  let fearGreed: number | null = null;

  try {
    const btcRaw = await fetchJsonWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true');
    const btc = btcRaw as { bitcoin?: { usd?: number; usd_24h_change?: number } };
    btcUsd = safeNumber(btc?.bitcoin?.usd, 0);
    btcChange24h = safeNumber(btc?.bitcoin?.usd_24h_change, 0);
  } catch {}

  try {
    const fngRaw = await fetchJsonWithTimeout('https://api.alternative.me/fng/?limit=1&format=json');
    const fng = fngRaw as { data?: Array<{ value?: string }> };
    const parsed = Number(fng?.data?.[0]?.value || '');
    fearGreed = Number.isFinite(parsed) ? parsed : null;
  } catch {}

  if (btcUsd <= 0) {
    const latest = getLatestMarketSnapshot();
    if (latest) {
      return latest;
    }
    return null;
  }

  const provisionalPoint: MarketFeaturePoint = {
    ts: Date.now(),
    btcUsd,
    btcChange24h,
    fearGreed,
    realizedVolatility: computeRealizedVolatility(),
    regime: 'unknown',
    confidence: 0,
    signals: [],
  };

  const nextHistory = [...state.history, provisionalPoint].slice(-MAX_POINTS);
  state.history = nextHistory;

  const realizedVolatility = computeRealizedVolatility();
  const regime = classifyRegime({
    btcChange24h,
    fearGreed,
    realizedVolatility,
  });

  const finalPoint: MarketFeaturePoint = {
    ...provisionalPoint,
    realizedVolatility,
    regime: regime.regime,
    confidence: regime.confidence,
    signals: regime.signals,
  };

  state.history[state.history.length - 1] = finalPoint;
  state.updatedAt = Date.now();
  saveState();
  return finalPoint;
}

export async function maybeRefreshMarketFeatureStore() {
  initializeMarketFeatureStore();
  const maxAgeMs = Math.max(60_000, Number(process.env.MARKET_REFRESH_MAX_AGE_MS || 30 * 60 * 1000));
  const isStale = (Date.now() - state.updatedAt) > maxAgeMs;

  if (state.history.length === 0 || isStale) {
    try {
      await updateMarketFeatureStore();
    } catch {}
  }

  return getLatestMarketSnapshot();
}

export function getLatestMarketSnapshot() {
  initializeMarketFeatureStore();
  if (state.history.length === 0) return null;
  return state.history[state.history.length - 1];
}

export function getMarketFeatureHistory(limit = MAX_POINTS) {
  initializeMarketFeatureStore();
  const safeLimit = Math.max(1, Math.min(MAX_POINTS, limit));
  return state.history.slice(-safeLimit);
}

export function getMarketIntelligenceSummary() {
  initializeMarketFeatureStore();

  const latest = getLatestMarketSnapshot();
  const recent = state.history.slice(-48);
  const avgConfidence = avg(recent.map((point) => point.confidence));

  return {
    available: Boolean(latest),
    updatedAt: state.updatedAt || null,
    samples: state.history.length,
    avgConfidence: Number(avgConfidence.toFixed(4)),
    latest,
  };
}
