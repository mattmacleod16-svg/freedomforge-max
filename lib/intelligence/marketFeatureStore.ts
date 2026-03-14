import fs from 'fs';
import path from 'path';

let rio: any;
try { rio = require('@/lib/resilient-io'); } catch { /* fallback to raw fs */ }

export type MarketRegime = 'risk_on' | 'risk_off' | 'neutral' | 'unknown';

export interface PredictionMarketContract {
  title: string;
  probability: number;
  riskContribution: number;
  volume: number;
  riskHits: number;
  bullishHits: number;
}

export interface PredictionMarketTopRiskContract {
  title: string;
  probability: number;
  riskContribution: number;
}

export interface MarketFeaturePoint {
  ts: number;
  btcUsd: number;
  btcChange24h: number;
  fearGreed: number | null;
  realizedVolatility: number;
  geopoliticalRisk: number;
  geopoliticalSignals: string[];
  geopoliticalHeadlines: string[];
  predictionMarketImpliedRisk: number;
  predictionMarketSignals: string[];
  predictionMarketTopContracts: PredictionMarketContract[];
  regime: MarketRegime;
  confidence: number;
  signals: string[];
}

interface MarketFeatureState {
  history: MarketFeaturePoint[];
  updatedAt: number;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
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
    if (rio) {
      rio.writeJsonAtomic(STATE_FILE, state);
    } else {
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    }
  } catch (err) { console.error('[marketFeatureStore] saveState failed:', err); }
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

function normalizePredictionMarketContracts(value: unknown): PredictionMarketContract[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        const match = entry.match(/^(.*)\s+\(p=([0-9.]+)\)$/);
        const title = (match?.[1] || entry).trim();
        const probability = clamp(Number(match?.[2] || 0), 0, 1);
        if (!title) return null;
        return {
          title,
          probability,
          riskContribution: 0,
          volume: 0,
          riskHits: 0,
          bullishHits: 0,
        } as PredictionMarketContract;
      }

      if (entry && typeof entry === 'object') {
        const row = entry as Partial<PredictionMarketContract>;
        const title = String(row.title || '').trim();
        if (!title) return null;
        return {
          title,
          probability: clamp(safeNumber(row.probability, 0), 0, 1),
          riskContribution: clamp(safeNumber(row.riskContribution, 0), 0, 1),
          volume: Math.max(0, safeNumber(row.volume, 0)),
          riskHits: Math.max(0, Math.floor(safeNumber(row.riskHits, 0))),
          bullishHits: Math.max(0, Math.floor(safeNumber(row.bullishHits, 0))),
        };
      }

      return null;
    })
    .filter((entry): entry is PredictionMarketContract => Boolean(entry));
}

function getTopRiskContracts(
  contracts: PredictionMarketContract[],
  limit = 3
): PredictionMarketTopRiskContract[] {
  if (!Array.isArray(contracts) || contracts.length === 0) return [];

  const safeLimit = Math.max(1, Math.min(10, Math.floor(limit)));

  return [...contracts]
    .sort((left, right) => right.riskContribution - left.riskContribution)
    .slice(0, safeLimit)
    .map((contract) => ({
      title: contract.title,
      probability: contract.probability,
      riskContribution: contract.riskContribution,
    }));
}

function countMatches(text: string, terms: string[]) {
  const lowered = text.toLowerCase();
  return terms.reduce((sum, term) => sum + (lowered.includes(term.toLowerCase()) ? 1 : 0), 0);
}

async function fetchGeopoliticalRiskSignal() {
  const enabled = String(process.env.GEOPOLITICAL_FEED_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) {
    return { risk: 0, signals: ['geo_feed_disabled'], headlines: [] as string[] };
  }

  const query =
    process.env.GEOPOLITICAL_QUERY ||
    '(russia OR ukraine OR taiwan OR china OR iran OR israel OR sanctions OR oil shock OR shipping disruption OR central bank emergency)';
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&maxrecords=25&format=json&sort=DateDesc`;

  try {
    const payload = (await fetchJsonWithTimeout(url, 12000)) as { articles?: Array<{ title?: string }> };
    const titles = (payload.articles || [])
      .map((article) => String(article?.title || '').trim())
      .filter(Boolean)
      .slice(0, 25);

    if (titles.length === 0) {
      return { risk: 0, signals: ['geo_feed_no_articles'], headlines: [] as string[] };
    }

    const corpus = titles.join(' | ');
    const conflictHits = countMatches(corpus, ['conflict', 'war', 'missile', 'attack', 'invasion', 'troops']);
    const escalationHits = countMatches(corpus, ['escalation', 'nuclear', 'sanctions', 'blockade', 'retaliation']);
    const disruptionHits = countMatches(corpus, ['oil', 'strait', 'shipping', 'red sea', 'supply chain', 'embargo']);
    const deescalationHits = countMatches(corpus, ['ceasefire', 'talks', 'agreement', 'de-escalation', 'truce']);

    const rawRisk =
      conflictHits * 0.08 +
      escalationHits * 0.12 +
      disruptionHits * 0.10 -
      deescalationHits * 0.06;
    const risk = clamp(rawRisk, 0, 1);

    const signals: string[] = [];
    if (conflictHits >= 2) signals.push('geo_conflict');
    if (escalationHits >= 2) signals.push('geo_escalation');
    if (disruptionHits >= 1) signals.push('geo_supply_risk');
    if (deescalationHits >= 2) signals.push('geo_deescalation');
    if (risk >= 0.65) signals.push('geo_risk_high');
    if (risk >= 0.35 && risk < 0.65) signals.push('geo_risk_medium');

    return {
      risk,
      signals,
      headlines: titles.slice(0, 4),
    };
  } catch {
    return { risk: 0, signals: ['geo_feed_error'], headlines: [] as string[] };
  }
}

function parseProbability(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed > 1) return clamp(parsed / 100, 0, 1);
  return clamp(parsed, 0, 1);
}

function parseOutcomeProbability(market: any): number | null {
  const directKeys = ['probability', 'yesPrice', 'lastPrice', 'price', 'bestBid', 'bestAsk'];
  for (const key of directKeys) {
    const p = parseProbability(market?.[key]);
    if (p !== null) return p;
  }

  const outcomePricesRaw = market?.outcomePrices;
  if (Array.isArray(outcomePricesRaw) && outcomePricesRaw.length > 0) {
    const parsed = parseProbability(outcomePricesRaw[0]);
    if (parsed !== null) return parsed;
  }

  if (typeof outcomePricesRaw === 'string') {
    try {
      const arr = JSON.parse(outcomePricesRaw);
      if (Array.isArray(arr) && arr.length > 0) {
        const parsed = parseProbability(arr[0]);
        if (parsed !== null) return parsed;
      }
    } catch { /* invalid JSON in outcomePrices — skip */ }
  }

  return null;
}

async function fetchPredictionMarketSignal() {
  const enabled = String(process.env.PREDICTION_MARKET_FEED_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) {
    return { impliedRisk: 0, signals: ['pm_feed_disabled'], topContracts: [] as PredictionMarketContract[] };
  }

  const limit = Math.max(20, Math.min(150, Number(process.env.PREDICTION_MARKET_LIMIT || 80)));
  const endpoint = process.env.PREDICTION_MARKET_ENDPOINT || `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=${limit}`;

  try {
    const payload = await fetchJsonWithTimeout(endpoint, 12000);
    const markets = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as any)?.markets)
        ? (payload as any).markets
        : [];

    if (markets.length === 0) {
      return { impliedRisk: 0, signals: ['pm_no_markets'], topContracts: [] as PredictionMarketContract[] };
    }

    const riskKeywords = ['war', 'recession', 'default', 'crisis', 'emergency', 'attack', 'conflict', 'rate hike', 'inflation', 'sanctions'];
    const bullishKeywords = ['approval', 'cut rates', 'ceasefire', 'deal', 'growth', 'soft landing'];

    const scored = markets
      .map((market: any) => {
        const title = String(market?.question || market?.title || market?.name || '').trim();
        const probability = parseOutcomeProbability(market);
        const volume = Number(market?.volumeNum || market?.volume || 0);
        if (!title || probability === null) return null;

        const riskHits = countMatches(title, riskKeywords);
        const bullishHits = countMatches(title, bullishKeywords);
        const relevance = clamp((riskHits * 0.7 + bullishHits * 0.4) / 2, 0, 1);
        const confidenceWeight = clamp((Math.abs(probability - 0.5) * 2) * 0.75 + Math.min(1, volume / 500000) * 0.25);

        const riskTilt = riskHits > bullishHits ? probability : (1 - probability) * 0.4;
        const riskScore = clamp(riskTilt * confidenceWeight * Math.max(0.25, relevance));

        return { title, probability, volume, riskScore, riskHits, bullishHits };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.riskScore - a.riskScore)
      .slice(0, 12);

    if (scored.length === 0) {
      return { impliedRisk: 0, signals: ['pm_unscored'], topContracts: [] as PredictionMarketContract[] };
    }

    const impliedRisk = clamp(scored.reduce((sum: number, row: any) => sum + row.riskScore, 0) / Math.max(1, scored.length) * 1.8);
    const highRiskContracts = scored.filter((row: any) => row.riskScore >= 0.35).length;
    const signals: string[] = [];
    if (impliedRisk >= 0.65) signals.push('pm_risk_high');
    if (impliedRisk >= 0.4 && impliedRisk < 0.65) signals.push('pm_risk_medium');
    if (highRiskContracts >= 3) signals.push('pm_clustered_tail_risk');
    if (scored.some((row: any) => row.riskHits >= 2)) signals.push('pm_macro_event_focus');

    return {
      impliedRisk,
      signals,
      topContracts: scored.slice(0, 4).map((row: any) => ({
        title: row.title,
        probability: Number(row.probability.toFixed(4)),
        riskContribution: Number(row.riskScore.toFixed(6)),
        volume: Math.max(0, Number(row.volume) || 0),
        riskHits: Math.max(0, Number(row.riskHits) || 0),
        bullishHits: Math.max(0, Number(row.bullishHits) || 0),
      })),
    };
  } catch {
    return { impliedRisk: 0, signals: ['pm_feed_error'], topContracts: [] as PredictionMarketContract[] };
  }
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
  geopoliticalRisk: number;
  geopoliticalSignals: string[];
  predictionMarketImpliedRisk: number;
  predictionMarketSignals: string[];
}): { regime: MarketRegime; confidence: number; signals: string[] } {
  const {
    btcChange24h,
    fearGreed,
    realizedVolatility,
    geopoliticalRisk,
    geopoliticalSignals,
    predictionMarketImpliedRisk,
    predictionMarketSignals,
  } = input;
  const signals: string[] = [...geopoliticalSignals, ...predictionMarketSignals];

  if (btcChange24h <= -4) signals.push('btc_drop');
  if (btcChange24h >= 2) signals.push('btc_momentum');
  if (fearGreed !== null && fearGreed < 35) signals.push('fear_high');
  if (fearGreed !== null && fearGreed > 62) signals.push('greed_high');
  if (realizedVolatility > 0.03) signals.push('volatility_high');
  if (realizedVolatility < 0.015) signals.push('volatility_low');

  const riskOffScore =
    (btcChange24h <= -4 ? 0.38 : 0) +
    (fearGreed !== null && fearGreed < 35 ? 0.34 : 0) +
    (realizedVolatility > 0.03 ? 0.28 : 0) +
    Math.min(0.32, geopoliticalRisk * 0.32) +
    Math.min(0.26, predictionMarketImpliedRisk * 0.26);

  const riskOnScore =
    (btcChange24h >= 2 ? 0.38 : 0) +
    (fearGreed !== null && fearGreed > 62 ? 0.34 : 0) +
    (realizedVolatility < 0.015 ? 0.28 : 0) +
    (predictionMarketImpliedRisk < 0.3 ? 0.08 : 0);

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
        history: Array.isArray(parsed.history)
          ? parsed.history.slice(-MAX_POINTS).map((point: any) => ({
            ...point,
            predictionMarketTopContracts: normalizePredictionMarketContracts(point?.predictionMarketTopContracts),
          }))
          : [],
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
  } catch (err) { console.error('[marketFeatureStore] CoinGecko fetch failed:', err); }

  try {
    const fngRaw = await fetchJsonWithTimeout('https://api.alternative.me/fng/?limit=1&format=json');
    const fng = fngRaw as { data?: Array<{ value?: string }> };
    const parsed = Number(fng?.data?.[0]?.value || '');
    fearGreed = Number.isFinite(parsed) ? parsed : null;
  } catch (err) { console.error('[marketFeatureStore] FNG fetch failed:', err); }

  if (btcUsd <= 0) {
    const latest = getLatestMarketSnapshot();
    if (latest) {
      if (typeof latest.geopoliticalRisk !== 'number' || !Array.isArray(latest.geopoliticalSignals)) {
        const migrated: MarketFeaturePoint = {
          ...latest,
          geopoliticalRisk: typeof latest.geopoliticalRisk === 'number' ? latest.geopoliticalRisk : 0,
          geopoliticalSignals: Array.isArray(latest.geopoliticalSignals) ? latest.geopoliticalSignals : ['geo_backfill_default'],
          geopoliticalHeadlines: Array.isArray(latest.geopoliticalHeadlines) ? latest.geopoliticalHeadlines : [],
          predictionMarketImpliedRisk: typeof latest.predictionMarketImpliedRisk === 'number' ? latest.predictionMarketImpliedRisk : 0,
          predictionMarketSignals: Array.isArray(latest.predictionMarketSignals) ? latest.predictionMarketSignals : [],
          predictionMarketTopContracts: normalizePredictionMarketContracts(latest.predictionMarketTopContracts),
        };
        state.history[state.history.length - 1] = migrated;
        saveState();
        return migrated;
      }
      if (!Array.isArray(latest.predictionMarketTopContracts) || typeof latest.predictionMarketTopContracts[0] === 'string') {
        const migrated: MarketFeaturePoint = {
          ...latest,
          predictionMarketImpliedRisk: typeof latest.predictionMarketImpliedRisk === 'number' ? latest.predictionMarketImpliedRisk : 0,
          predictionMarketSignals: Array.isArray(latest.predictionMarketSignals) ? latest.predictionMarketSignals : [],
          predictionMarketTopContracts: normalizePredictionMarketContracts(latest.predictionMarketTopContracts),
        };
        state.history[state.history.length - 1] = migrated;
        saveState();
        return migrated;
      }
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
    geopoliticalRisk: 0,
    geopoliticalSignals: [],
    geopoliticalHeadlines: [],
    predictionMarketImpliedRisk: 0,
    predictionMarketSignals: [],
    predictionMarketTopContracts: [],
    regime: 'unknown',
    confidence: 0,
    signals: [],
  };

  const nextHistory = [...state.history, provisionalPoint].slice(-MAX_POINTS);
  state.history = nextHistory;

  const realizedVolatility = computeRealizedVolatility();
  const geo = await fetchGeopoliticalRiskSignal();
  const predictionMarket = await fetchPredictionMarketSignal();
  const regime = classifyRegime({
    btcChange24h,
    fearGreed,
    realizedVolatility,
    geopoliticalRisk: geo.risk,
    geopoliticalSignals: geo.signals,
    predictionMarketImpliedRisk: predictionMarket.impliedRisk,
    predictionMarketSignals: predictionMarket.signals,
  });

  const finalPoint: MarketFeaturePoint = {
    ...provisionalPoint,
    realizedVolatility,
    geopoliticalRisk: geo.risk,
    geopoliticalSignals: geo.signals,
    geopoliticalHeadlines: geo.headlines,
    predictionMarketImpliedRisk: predictionMarket.impliedRisk,
    predictionMarketSignals: predictionMarket.signals,
    predictionMarketTopContracts: predictionMarket.topContracts,
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
  const latest = getLatestMarketSnapshot();
  const missingGeoFields = !latest || typeof latest.geopoliticalRisk !== 'number' || !Array.isArray(latest.geopoliticalSignals);
  const missingPredictionFields =
    !latest ||
    typeof latest.predictionMarketImpliedRisk !== 'number' ||
    !Array.isArray(latest.predictionMarketSignals) ||
    !Array.isArray(latest.predictionMarketTopContracts);
  const isStale = (Date.now() - state.updatedAt) > maxAgeMs || missingGeoFields || missingPredictionFields;

  if (state.history.length === 0 || isStale) {
    try {
      await updateMarketFeatureStore();
    } catch (err) { console.error('[marketFeatureStore] refresh failed:', err); }
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
  const latestWithTopRisk = latest
    ? {
      ...latest,
      topRiskContracts: getTopRiskContracts(latest.predictionMarketTopContracts),
    }
    : null;

  return {
    available: Boolean(latestWithTopRisk),
    updatedAt: state.updatedAt || null,
    samples: state.history.length,
    avgConfidence: Number(avgConfidence.toFixed(4)),
    latest: latestWithTopRisk,
  };
}
