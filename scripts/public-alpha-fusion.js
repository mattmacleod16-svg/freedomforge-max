#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const STATE_FILE = process.env.PUBLIC_ALPHA_STATE_FILE || 'data/public-alpha-state.json';
const HISTORY_LIMIT = Math.max(24, Math.min(24 * 60, Number(process.env.PUBLIC_ALPHA_HISTORY_LIMIT || 24 * 21)));
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.PUBLIC_ALPHA_TIMEOUT_MS || 12000));
const ALERT_WEBHOOK_URL = (process.env.ALERT_WEBHOOK_URL || '').trim();
const WEBHOOK_ON_EACH_RUN = String(process.env.PUBLIC_ALPHA_WEBHOOK_EACH_RUN || 'false').toLowerCase() === 'true';
const WORMHOLE_ENABLED = String(process.env.WORMHOLE_ENABLED || 'true').toLowerCase() !== 'false';
const WORMHOLE_SCAN_URL = (
  process.env.WORMHOLE_SCAN_URL ||
  'https://api.wormholescan.io/api/v1/last-txs?numRows=50'
).trim();

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function avg(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function loadState(absPath) {
  if (!fs.existsSync(absPath)) {
    return { updatedAt: 0, history: [], last: null };
  }
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return { updatedAt: 0, history: [], last: null };
  }
}

function saveState(absPath, state) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(state, null, 2));
}

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'freedomforge-max/1.0',
        ...headers,
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFearGreed() {
  try {
    const payload = await fetchJson('https://api.alternative.me/fng/?limit=1&format=json');
    const value = Number(payload?.data?.[0]?.value);
    if (!Number.isFinite(value)) {
      return { value: null, sentiment: 'unknown', signal: 'fng_unavailable' };
    }
    const sentiment = value < 30 ? 'fear' : value > 65 ? 'greed' : 'neutral';
    return { value, sentiment, signal: sentiment === 'fear' ? 'fng_fear' : sentiment === 'greed' ? 'fng_greed' : 'fng_neutral' };
  } catch {
    return { value: null, sentiment: 'unknown', signal: 'fng_error' };
  }
}

async function fetchMomentum() {
  const symbols = ['BTCUSDT', 'ETHUSDT'];
  const result = {};

  for (const symbol of symbols) {
    try {
      const ticker = await fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
      const changePct = Number(ticker?.priceChangePercent);
      const volume = Number(ticker?.quoteVolume);
      result[symbol] = {
        changePct: Number.isFinite(changePct) ? changePct : 0,
        quoteVolume: Number.isFinite(volume) ? volume : 0,
      };
    } catch {
      result[symbol] = { changePct: 0, quoteVolume: 0, unavailable: true };
    }
  }

  const btc = Number(result.BTCUSDT?.changePct || 0);
  const eth = Number(result.ETHUSDT?.changePct || 0);
  const composite = avg([btc, eth]);
  const signal = composite >= 2 ? 'momentum_up' : composite <= -2 ? 'momentum_down' : 'momentum_flat';

  return {
    btc24hPct: Number(btc.toFixed(3)),
    eth24hPct: Number(eth.toFixed(3)),
    composite24hPct: Number(composite.toFixed(3)),
    signal,
  };
}

async function fetchTrending() {
  try {
    const payload = await fetchJson('https://api.coingecko.com/api/v3/search/trending');
    const items = Array.isArray(payload?.coins) ? payload.coins.slice(0, 10) : [];

    const aiHits = items.filter((row) => {
      const text = `${row?.item?.name || ''} ${row?.item?.symbol || ''}`.toLowerCase();
      return /(ai|agent|gpu|compute|inference|l2)/.test(text);
    }).length;

    const top = items.slice(0, 5).map((row) => String(row?.item?.symbol || row?.item?.name || '').toUpperCase()).filter(Boolean);
    return {
      top,
      aiHits,
      signal: aiHits >= 2 ? 'ai_narrative_hot' : aiHits === 1 ? 'ai_narrative_present' : 'ai_narrative_cool',
    };
  } catch {
    return { top: [], aiHits: 0, signal: 'trending_error' };
  }
}

async function fetchOpenSourceAgentPulse() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const query = encodeURIComponent(`(ai agent trading) pushed:>=${sevenDaysAgo}`);
    const payload = await fetchJson(`https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=10`, 12000, {
      Accept: 'application/vnd.github+json',
    });

    const items = Array.isArray(payload?.items) ? payload.items : [];
    const score = items.reduce((sum, repo) => sum + Math.min(1, Number(repo?.stargazers_count || 0) / 5000), 0);
    const normalized = clamp(score / Math.max(1, items.length), 0, 1);
    const top = items.slice(0, 3).map((repo) => String(repo?.full_name || '')).filter(Boolean);

    return {
      repoCount: items.length,
      innovationScore: Number(normalized.toFixed(4)),
      top,
      signal: normalized >= 0.35 ? 'oss_agent_heat_high' : normalized >= 0.15 ? 'oss_agent_heat_medium' : 'oss_agent_heat_low',
    };
  } catch {
    return { repoCount: 0, innovationScore: 0, top: [], signal: 'oss_agent_heat_error' };
  }
}

function normalizeWormholeRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.transactions)) return payload.transactions;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.txs)) return payload.txs;
  return [];
}

function safeLower(value) {
  return String(value || '').toLowerCase();
}

async function fetchWormholeSignal() {
  if (!WORMHOLE_ENABLED || !WORMHOLE_SCAN_URL) {
    return {
      enabled: false,
      txCount: 0,
      stableFlowScore: 0,
      riskFlowScore: 0,
      netRiskBias: 0,
      signal: 'wormhole_disabled',
      topRoutes: [],
    };
  }

  try {
    const payload = await fetchJson(WORMHOLE_SCAN_URL, 14000);
    const rows = normalizeWormholeRows(payload);
    if (rows.length === 0) {
      return {
        enabled: true,
        txCount: 0,
        stableFlowScore: 0,
        riskFlowScore: 0,
        netRiskBias: 0,
        signal: 'wormhole_no_rows',
        topRoutes: [],
      };
    }

    let stableFlow = 0;
    let riskFlow = 0;
    const routeCounter = new Map();

    for (const row of rows.slice(0, 80)) {
      const src = safeLower(row?.sourceChain || row?.emitterChain || row?.fromChain || row?.source_chain);
      const dst = safeLower(row?.targetChain || row?.destinationChain || row?.toChain || row?.target_chain);
      const token = safeLower(row?.tokenSymbol || row?.symbol || row?.token || row?.asset || row?.tokenChain);

      const routeKey = `${src || 'unknown'}->${dst || 'unknown'}`;
      routeCounter.set(routeKey, (routeCounter.get(routeKey) || 0) + 1);

      if (/(usdc|usdt|dai|frax)/.test(token)) stableFlow += 1;
      if (/(eth|weth|btc|wbtc|sol|avax|arb|op|matic)/.test(token)) riskFlow += 1;
    }

    const total = Math.max(1, stableFlow + riskFlow);
    const stableFlowScore = stableFlow / total;
    const riskFlowScore = riskFlow / total;
    const netRiskBias = riskFlowScore - stableFlowScore;

    const topRoutes = [...routeCounter.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([route, count]) => ({ route, count }));

    const signal = netRiskBias >= 0.15
      ? 'wormhole_risk_flow'
      : netRiskBias <= -0.15
        ? 'wormhole_stable_flow'
        : 'wormhole_balanced_flow';

    return {
      enabled: true,
      txCount: rows.length,
      stableFlowScore: Number(stableFlowScore.toFixed(4)),
      riskFlowScore: Number(riskFlowScore.toFixed(4)),
      netRiskBias: Number(netRiskBias.toFixed(4)),
      signal,
      topRoutes,
    };
  } catch {
    return {
      enabled: true,
      txCount: 0,
      stableFlowScore: 0,
      riskFlowScore: 0,
      netRiskBias: 0,
      signal: 'wormhole_error',
      topRoutes: [],
    };
  }
}

function scoreAndDecide(features) {
  const signals = [];

  const momentumUp = features.momentum.composite24hPct >= 1.8 ? 1 : 0;
  const momentumDown = features.momentum.composite24hPct <= -1.8 ? 1 : 0;

  if (momentumUp) signals.push('momentum_up');
  if (momentumDown) signals.push('momentum_down');
  if (features.trending.aiHits >= 2) signals.push('ai_narrative_hot');
  if (features.fearGreed.value !== null && features.fearGreed.value < 30) signals.push('fear_regime');
  if (features.fearGreed.value !== null && features.fearGreed.value > 65) signals.push('greed_regime');
  if (features.oss.innovationScore >= 0.35) signals.push('oss_agent_heat_high');
  if (features.wormhole.signal === 'wormhole_risk_flow') signals.push('wormhole_risk_flow');
  if (features.wormhole.signal === 'wormhole_stable_flow') signals.push('wormhole_stable_flow');

  let riskOnScore = 0;
  let riskOffScore = 0;

  riskOnScore += clamp((features.momentum.composite24hPct + 4) / 8, 0, 1) * 0.40;
  riskOnScore += clamp(features.oss.innovationScore, 0, 1) * 0.20;
  riskOnScore += clamp(features.trending.aiHits / 4, 0, 1) * 0.20;
  riskOnScore += (features.fearGreed.value !== null ? clamp((features.fearGreed.value - 35) / 35, 0, 1) : 0.5) * 0.20;
  riskOnScore += clamp((features.wormhole.netRiskBias + 1) / 2, 0, 1) * 0.15;

  riskOffScore += clamp((-features.momentum.composite24hPct + 4) / 8, 0, 1) * 0.40;
  riskOffScore += (features.fearGreed.value !== null ? clamp((35 - features.fearGreed.value) / 35, 0, 1) : 0.5) * 0.35;
  riskOffScore += (features.trending.signal === 'trending_error' ? 0.1 : 0) + (features.momentum.signal === 'momentum_down' ? 0.15 : 0);
  riskOffScore += clamp((1 - features.wormhole.netRiskBias) / 2, 0, 1) * 0.10;

  const delta = riskOnScore - riskOffScore;
  const confidence = clamp(Math.abs(delta) * 1.4, 0.35, 0.92);

  let regime = 'neutral';
  if (delta >= 0.12) regime = 'risk_on';
  else if (delta <= -0.12) regime = 'risk_off';

  return {
    regime,
    confidence: Number(confidence.toFixed(4)),
    riskOnScore: Number(riskOnScore.toFixed(4)),
    riskOffScore: Number(riskOffScore.toFixed(4)),
    signals,
  };
}

async function notifyWebhook(message) {
  if (!ALERT_WEBHOOK_URL) return;
  await fetch(ALERT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message, text: message }),
  }).catch(() => {});
}

async function main() {
  const [fearGreed, momentum, trending, oss, wormhole] = await Promise.all([
    fetchFearGreed(),
    fetchMomentum(),
    fetchTrending(),
    fetchOpenSourceAgentPulse(),
    fetchWormholeSignal(),
  ]);

  const features = { fearGreed, momentum, trending, oss, wormhole };
  const decision = scoreAndDecide(features);

  const ts = new Date().toISOString();
  const point = {
    ts,
    ...features,
    ...decision,
  };

  const absState = path.resolve(process.cwd(), STATE_FILE);
  const state = loadState(absState);
  state.updatedAt = Date.now();
  state.last = point;
  state.history = [...(Array.isArray(state.history) ? state.history : []), point].slice(-HISTORY_LIMIT);
  saveState(absState, state);

  const summary = {
    ts,
    status: 'ok',
    regime: decision.regime,
    confidence: decision.confidence,
    riskOnScore: decision.riskOnScore,
    riskOffScore: decision.riskOffScore,
    signals: decision.signals,
    features: {
      fearGreed: fearGreed.value,
      momentum24hPct: momentum.composite24hPct,
      aiTrendingHits: trending.aiHits,
      ossInnovation: oss.innovationScore,
      wormholeBias: wormhole.netRiskBias,
      wormholeSignal: wormhole.signal,
      topTrending: trending.top,
      topAgentRepos: oss.top,
      topWormholeRoutes: wormhole.topRoutes,
    },
    stateFile: STATE_FILE,
  };

  if (WEBHOOK_ON_EACH_RUN && ALERT_WEBHOOK_URL) {
    const message = `🧠 Public Alpha Fusion: regime=${summary.regime} confidence=${summary.confidence} momentum24h=${summary.features.momentum24hPct}% fng=${summary.features.fearGreed ?? 'n/a'} aiHits=${summary.features.aiTrendingHits} oss=${summary.features.ossInnovation} wormhole=${summary.features.wormholeSignal}`;
    await notifyWebhook(message);
  }

  console.log(JSON.stringify(summary, null, 2));

  // Publish alpha findings to cross-agent signal bus
  try {
    const bus = require('../lib/agent-signal-bus');
    bus.publish({
      type: 'alpha_regime',
      source: 'public-alpha-fusion',
      confidence: summary.confidence,
      payload: {
        regime: summary.regime,
        riskOnScore: summary.riskOnScore,
        riskOffScore: summary.riskOffScore,
        fearGreed: summary.features.fearGreed,
        momentum24hPct: summary.features.momentum24hPct,
      },
    });
    bus.publish({
      type: 'oss_innovation',
      source: 'public-alpha-fusion',
      confidence: Math.min(1, summary.features.ossInnovation + 0.3),
      payload: { score: summary.features.ossInnovation, topRepos: summary.features.topAgentRepos },
    });
  } catch (busErr) {
    // signal-bus unavailable -- non-fatal
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
