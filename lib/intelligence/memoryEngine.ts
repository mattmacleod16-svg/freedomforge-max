import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

let rio: any;
try { rio = require('@/lib/resilient-io'); } catch { /* fallback to raw fs */ }

export interface MemoryEpisode {
  id: string;
  ts: number;
  query: string;
  responseSummary: string;
  regime: 'risk_on' | 'risk_off' | 'neutral' | 'unknown';
  reward: number;
  confidence: number;
  riskScore: number;
  forecastProbability: number;
  forecastBrier: number;
  tags: string[];
  sources: string[];
  embedding: number[];
}

interface MemoryState {
  episodes: MemoryEpisode[];
  updatedAt: number;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'episodic-memory.json');
const MAX_EPISODES = Math.max(500, Number(process.env.MEMORY_MAX_EPISODES || 6000));
const VECTOR_DIM = 96;

let initialized = false;
let state: MemoryState = {
  episodes: [],
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
  } catch (err) { console.error('[memoryEngine] saveState failed:', err); }
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string) {
  return normalize(text)
    .split(' ')
    .filter((token) => token.length > 1);
}

function hashText(text: string) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function embed(text: string) {
  const out = new Array<number>(VECTOR_DIM).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return out;

  tokens.forEach((token, index) => {
    const digest = createHash('sha1').update(`${token}:${index % 19}`).digest();
    const slot = digest[0] % VECTOR_DIM;
    const sign = (digest[1] & 1) === 0 ? 1 : -1;
    const magnitude = (digest[2] / 255) + 0.45;
    out[slot] += sign * magnitude;
  });

  const norm = Math.sqrt(out.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return out;
  return out.map((value) => value / norm);
}

function cosine(a: number[], b: number[]) {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let index = 0; index < len; index += 1) {
    dot += a[index] * b[index];
    na += a[index] * a[index];
    nb += b[index] * b[index];
  }
  if (na === 0 || nb === 0) return 0;
  return clamp(dot / (Math.sqrt(na) * Math.sqrt(nb)));
}

function recencyScore(ts: number) {
  const ageDays = Math.max(0, (Date.now() - ts) / (24 * 60 * 60 * 1000));
  const halfLifeDays = Math.max(1, Number(process.env.MEMORY_RECENCY_HALF_LIFE_DAYS || 14));
  return clamp(Math.exp(-Math.log(2) * (ageDays / halfLifeDays)));
}

function deriveTags(input: { query: string; regime: MemoryEpisode['regime']; reward: number; riskScore: number }) {
  const tags: string[] = [input.regime];
  const q = input.query.toLowerCase();

  if (/prediction|market|polymarket/i.test(q)) tags.push('prediction');
  if (/budget|finance|cashflow|revenue/i.test(q)) tags.push('finance');
  if (/risk|safety|guardrail/i.test(q)) tags.push('risk');
  if (input.reward > 0.75) tags.push('high_reward');
  if (input.riskScore > 0.65) tags.push('high_risk');

  return Array.from(new Set(tags));
}

export function initializeMemoryEngine() {
  if (initialized) return;
  initialized = true;

  try {
    ensureDataDir();
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<MemoryState>;
      state = {
        episodes: Array.isArray(parsed.episodes) ? parsed.episodes.slice(-MAX_EPISODES) : [],
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      };
    } else {
      saveState();
    }
  } catch {
    saveState();
  }
}

export function rememberEpisode(input: {
  query: string;
  responseSummary: string;
  regime: MemoryEpisode['regime'];
  reward: number;
  confidence: number;
  riskScore: number;
  forecastProbability: number;
  forecastBrier: number;
  sources?: string[];
  tags?: string[];
}) {
  initializeMemoryEngine();

  const mergedTags = Array.from(new Set([...(input.tags || []), ...deriveTags(input)]));
  const textForEmbedding = `${input.query}\n${input.responseSummary}\n${mergedTags.join(' ')}`;

  const episode: MemoryEpisode = {
    id: `mem_${Date.now()}_${hashText(textForEmbedding)}`,
    ts: Date.now(),
    query: input.query,
    responseSummary: input.responseSummary.slice(0, 700),
    regime: input.regime,
    reward: clamp(input.reward),
    confidence: clamp(input.confidence),
    riskScore: clamp(input.riskScore),
    forecastProbability: clamp(input.forecastProbability),
    forecastBrier: clamp(input.forecastBrier),
    tags: mergedTags,
    sources: (input.sources || []).slice(0, 12),
    embedding: embed(textForEmbedding),
  };

  state.episodes.push(episode);
  if (state.episodes.length > MAX_EPISODES) {
    state.episodes = state.episodes.slice(-MAX_EPISODES);
  }
  state.updatedAt = Date.now();
  saveState();

  return episode;
}

export function recallMemories(query: string, options?: { topK?: number; regime?: MemoryEpisode['regime'] }) {
  initializeMemoryEngine();

  const topK = Math.max(1, Math.min(20, options?.topK || 6));
  const qVec = embed(query);
  const q = normalize(query);
  const qTerms = tokenize(q);

  const scored = state.episodes
    .filter((episode) => (options?.regime ? episode.regime === options.regime : true))
    .map((episode) => {
      const semantic = cosine(qVec, episode.embedding);
      const lexical = qTerms.length === 0
        ? 0
        : qTerms.reduce((sum, term) => sum + (normalize(episode.query).includes(term) ? 1 : 0), 0) / qTerms.length;
      const recency = recencyScore(episode.ts);
      const performance = clamp(episode.reward * 0.7 + (1 - episode.riskScore) * 0.3);

      const score = (semantic * 0.46) + (lexical * 0.22) + (recency * 0.16) + (performance * 0.16);
      return { episode, score };
    })
    .filter((item) => item.score >= 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map((item) => ({
    id: item.episode.id,
    query: item.episode.query,
    responseSummary: item.episode.responseSummary,
    regime: item.episode.regime,
    reward: item.episode.reward,
    confidence: item.episode.confidence,
    riskScore: item.episode.riskScore,
    tags: item.episode.tags,
    relevance: Number(item.score.toFixed(4)),
    ts: item.episode.ts,
  }));
}

export function getMemorySummary() {
  initializeMemoryEngine();
  const latest = state.episodes.slice(-200);

  const avgReward = latest.length > 0
    ? latest.reduce((sum, item) => sum + item.reward, 0) / latest.length
    : 0;

  const avgRisk = latest.length > 0
    ? latest.reduce((sum, item) => sum + item.riskScore, 0) / latest.length
    : 0;

  const byRegime = latest.reduce(
    (acc, item) => {
      acc[item.regime] += 1;
      return acc;
    },
    { risk_on: 0, risk_off: 0, neutral: 0, unknown: 0 }
  );

  return {
    totalEpisodes: state.episodes.length,
    recentEpisodes: latest.length,
    averageReward: Number(avgReward.toFixed(4)),
    averageRisk: Number(avgRisk.toFixed(4)),
    byRegime,
    updatedAt: state.updatedAt,
  };
}
