import fs from 'fs';
import path from 'path';
import { logEvent } from '@/lib/logger';

type XPostHistory = {
  id: string;
  text: string;
  postedAt: number;
  dryRun: boolean;
  success: boolean;
  error?: string;
};

type ProofMetrics = {
  lookbackHours: number;
  attempts: number;
  transferSuccess: number;
  transferFailed: number;
  successRatePct: number;
  payoutsEth: number;
  topupsEth: number;
  netEth: number;
};

type ProfitGate = {
  required: boolean;
  canPost: boolean;
  reason: string | null;
  minNetEth: number;
  minSuccessRate: number;
  minAttempts: number;
};

type XState = {
  history: XPostHistory[];
  updatedAt: number;
};

const DATA_DIR = process.env.VERCEL ? '/tmp/freedomforge-data' : path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'x-automation.json');
const MAX_HISTORY = 300;

type XOAuthTokenCache = {
  accessToken: string;
  expiresAt: number;
};

let oauthTokenCache: XOAuthTokenCache | null = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readState(): XState {
  try {
    ensureDataDir();
    if (!fs.existsSync(STATE_FILE)) {
      return { history: [], updatedAt: 0 };
    }
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<XState>;
    return {
      history: Array.isArray(parsed.history) ? parsed.history.slice(-MAX_HISTORY) : [],
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return { history: [], updatedAt: 0 };
  }
}

function writeState(state: XState) {
  try {
    ensureDataDir();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // best effort
  }
}

function now() {
  return Date.now();
}

function todayStartUtcTs() {
  const current = new Date();
  return Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate(), 0, 0, 0, 0);
}

function inferGrowthTheme() {
  const themes = [
    'text-first AI copilot updates',
    'live risk controls and protocol observability',
    'autonomy + memory + forecasting improvements',
    'wallet automation and reliability engineering',
  ];
  return themes[Math.floor(Math.random() * themes.length)];
}

function parseBigIntSafe(value: unknown) {
  try {
    if (value === undefined || value === null || value === '') return BigInt(0);
    return BigInt(String(value));
  } catch {
    return BigInt(0);
  }
}

function weiToEthNumber(wei: bigint) {
  const whole = Number(wei / BigInt('1000000000000000000'));
  const frac = Number(wei % BigInt('1000000000000000000')) / 1e18;
  return whole + frac;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function getProofLookbackHours() {
  return Math.max(1, Number(process.env.X_PROOF_LOOKBACK_HOURS || 24));
}

function getProofLogLimit() {
  return Math.max(200, Number(process.env.X_PROOF_LOG_LIMIT || 2000));
}

function getPostStyle() {
  return String(process.env.X_POST_STYLE || 'proof').toLowerCase();
}

function isProfitGateRequired() {
  return String(process.env.X_POST_REQUIRE_PROFIT || 'true').toLowerCase() !== 'false';
}

function getProfitGateMinNetEth() {
  return Number(process.env.X_POST_MIN_NET_ETH || '0.002');
}

function getProfitGateMinSuccessRate() {
  return Number(process.env.X_POST_MIN_SUCCESS_RATE || '0.8');
}

function getProfitGateMinAttempts() {
  return Math.max(1, Number(process.env.X_POST_MIN_ATTEMPTS || '3'));
}

async function fetchJson(pathname: string) {
  const url = `${getBaseUrl()}${pathname}`;
  const response = await withTimeout(fetch(url), 10_000);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${pathname}`);
  }
  return response.json();
}

function summarizeProofMetrics(logs: any[]): ProofMetrics {
  const lookbackHours = getProofLookbackHours();
  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;

  let transferSuccess = 0;
  let transferFailed = 0;
  let payoutsWei = BigInt(0);
  let topupsWei = BigInt(0);

  for (const row of logs) {
    const ts = Date.parse(row?.time || '');
    if (!Number.isFinite(ts) || ts < cutoff) continue;

    const type = row?.type;
    const payload = row?.payload || {};

    if (type === 'transfer' || type === 'transfer_token') {
      transferSuccess += 1;
      payoutsWei += parseBigIntSafe(payload.amount);
    }
    if (type === 'transfer_failed' || type === 'transfer_token_failed') {
      transferFailed += 1;
    }
    if (type === 'gas_topup') {
      const amountEth = Number(payload.amount || 0) || 0;
      topupsWei += BigInt(Math.floor(amountEth * 1e18));
    }
  }

  const attempts = transferSuccess + transferFailed;
  const successRatePct = attempts > 0 ? Math.round((transferSuccess / attempts) * 100) : 100;
  const payoutsEth = weiToEthNumber(payoutsWei);
  const topupsEth = weiToEthNumber(topupsWei);
  const netEth = payoutsEth - topupsEth;

  return {
    lookbackHours,
    attempts,
    transferSuccess,
    transferFailed,
    successRatePct,
    payoutsEth,
    topupsEth,
    netEth,
  };
}

async function getProofMetrics(): Promise<ProofMetrics | null> {
  try {
    const payload = await fetchJson(`/api/alchemy/wallet/logs?limit=${getProofLogLimit()}`);
    const logs = Array.isArray(payload?.logs) ? payload.logs : [];
    return summarizeProofMetrics(logs);
  } catch {
    return null;
  }
}

function buildProofStylePost(input: {
  appUrl: string;
  metrics: ProofMetrics | null;
}) {
  const hashtags = ['#Polymarket', '#BuildInPublic', '#Automation'];
  const tags = hashtags.join(' ');

  if (!input.metrics || input.metrics.attempts === 0) {
    const fallback = `Built an autonomous prediction-market bot stack in one repo.\n\nOracle VM + systemd keeps it running even after laptop-off.\n\n${input.appUrl}\n${tags}`;
    return fallback.length <= 280 ? fallback : fallback.slice(0, 276) + '...';
  }

  const m = input.metrics;
  const lines = [
    `Closed laptop. Bot kept running.`,
    `${m.lookbackHours}h stats: ${m.transferSuccess}/${m.attempts} fills (${m.successRatePct}% success), net ${m.netEth.toFixed(4)} ETH.`,
    `Profit guard + recovery controller stayed active.`,
    `${input.appUrl}`,
    tags,
  ];

  const text = lines.join('\n');
  return text.length <= 280 ? text : text.slice(0, 276) + '...';
}

function buildPostText(input: {
  handle: string;
  appUrl: string;
  trend?: string;
}) {
  const theme = input.trend || inferGrowthTheme();
  const hashtags = ['#BuildInPublic', '#AI', '#Automation', '#TradingTech'];
  const selected = hashtags.sort(() => 0.5 - Math.random()).slice(0, 2).join(' ');
  const text = `Shipping another FreedomForge Max upgrade: ${theme}.\n\nAutonomous trading, self-evolving intelligence, and real-time ops controls are live.\n\n${input.appUrl}\n${selected}`;
  if (text.length <= 280) return text;
  return text.slice(0, 276) + '...';
}

function getCooldownMinutes() {
  return Math.max(10, Number(process.env.X_POST_COOLDOWN_MINUTES || 120));
}

function getDailyPostLimit() {
  return Math.max(1, Number(process.env.X_POST_DAILY_LIMIT || 3));
}

function getEnvValue(primary: string, fallback?: string) {
  return process.env[primary] || (fallback ? process.env[fallback] : '') || '';
}

function isXAutomationEnabled() {
  return String(process.env.X_AUTOMATION_ENABLED || 'false').toLowerCase() === 'true';
}

function isConfigured() {
  return Boolean(
    process.env.X_BEARER_TOKEN ||
      process.env.X_ACCESS_TOKEN ||
      (getEnvValue('X_REFRESH_TOKEN', 'REFRESH_TOKEN') && getEnvValue('X_CLIENT_ID', 'CLIENT_ID'))
  );
}

function getAuthTokenFromEnv() {
  return process.env.X_ACCESS_TOKEN || process.env.X_BEARER_TOKEN || '';
}

function getOAuthTokenUrl() {
  return process.env.X_OAUTH_TOKEN_URL || 'https://api.x.com/2/oauth2/token';
}

async function getOAuthUserAccessToken() {
  const clientId = getEnvValue('X_CLIENT_ID', 'CLIENT_ID');
  const refreshToken = getEnvValue('X_REFRESH_TOKEN', 'REFRESH_TOKEN');

  if (!clientId || !refreshToken) return '';

  const nowTs = Date.now();
  if (oauthTokenCache && oauthTokenCache.expiresAt > nowTs + 60_000) {
    return oauthTokenCache.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const clientSecret = getEnvValue('X_CLIENT_SECRET', 'CLIENT_SECRET');
  if (clientSecret) {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(getOAuthTokenUrl(), {
      method: 'POST',
      headers,
      body: body.toString(),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`X OAuth token refresh failed ${response.status}: ${JSON.stringify(payload)}`);
    }

    const accessToken = typeof payload?.access_token === 'string' ? payload.access_token : '';
    const expiresInSeconds = Number(payload?.expires_in || 3600);

    if (!accessToken) {
      throw new Error('X OAuth token refresh failed: missing access_token');
    }

    oauthTokenCache = {
      accessToken,
      expiresAt: nowTs + Math.max(300, expiresInSeconds) * 1000,
    };

    return accessToken;
  } finally {
    clearTimeout(timer);
  }
}

async function getAuthToken() {
  const staticToken = getAuthTokenFromEnv();
  if (staticToken) return staticToken;
  return getOAuthUserAccessToken();
}

function getBaseUrl() {
  return (process.env.APP_BASE_URL || 'https://freedomforge-max.vercel.app').replace(/\/$/, '');
}

function getHandle() {
  return process.env.X_HANDLE || '@Mac_man17';
}

function evaluateGuards(state: XState) {
  const cooldownMinutes = getCooldownMinutes();
  const dailyLimit = getDailyPostLimit();
  const successfulPosts = state.history.filter((item) => item.success && !item.dryRun);
  const lastSuccess = successfulPosts.slice(-1)[0] || null;
  const minutesSinceLast = lastSuccess ? (now() - lastSuccess.postedAt) / (60 * 1000) : Number.POSITIVE_INFINITY;
  const postsToday = successfulPosts.filter((item) => item.postedAt >= todayStartUtcTs()).length;

  const cooldownOk = minutesSinceLast >= cooldownMinutes;
  const dailyLimitOk = postsToday < dailyLimit;

  return {
    cooldownMinutes,
    dailyLimit,
    minutesSinceLast: Number.isFinite(minutesSinceLast) ? Number(minutesSinceLast.toFixed(2)) : null,
    postsToday,
    cooldownOk,
    dailyLimitOk,
    canPost: cooldownOk && dailyLimitOk,
  };
}

export function getXAutomationStatus() {
  const state = readState();
  const guards = evaluateGuards(state);
  const profitGate: Omit<ProfitGate, 'canPost' | 'reason'> = {
    required: isProfitGateRequired(),
    minNetEth: getProfitGateMinNetEth(),
    minSuccessRate: getProfitGateMinSuccessRate(),
    minAttempts: getProfitGateMinAttempts(),
  };

  return {
    enabled: isXAutomationEnabled(),
    configured: isConfigured(),
    handle: getHandle(),
    appUrl: getBaseUrl(),
    guards,
    profitGate,
    recent: state.history.slice(-10).reverse(),
    profileAutomationUrl: `https://x.com/settings`,
  };
}

export async function generateXGrowthPost(trend?: string, precomputedMetrics?: ProofMetrics | null) {
  const style = getPostStyle();
  const appUrl = getBaseUrl();

  if (style === 'proof') {
    const metrics = precomputedMetrics !== undefined ? precomputedMetrics : await getProofMetrics();
    return buildProofStylePost({ appUrl, metrics });
  }

  return buildPostText({
    handle: getHandle(),
    appUrl,
    trend,
  });
}

async function postTweet(text: string) {
  const token = await getAuthToken();
  if (!token) {
    throw new Error('X token not configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch('https://api.x.com/2/tweets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`X API error ${response.status}: ${JSON.stringify(payload)}`);
    }

    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function evaluateProfitGate(metrics: ProofMetrics | null): ProfitGate {
  const required = isProfitGateRequired();
  const minNetEth = getProfitGateMinNetEth();
  const minSuccessRate = getProfitGateMinSuccessRate();
  const minAttempts = getProfitGateMinAttempts();

  if (!required) {
    return {
      required,
      canPost: true,
      reason: null,
      minNetEth,
      minSuccessRate,
      minAttempts,
    };
  }

  if (!metrics) {
    return {
      required,
      canPost: false,
      reason: 'profit metrics unavailable',
      minNetEth,
      minSuccessRate,
      minAttempts,
    };
  }

  if (metrics.attempts < minAttempts) {
    return {
      required,
      canPost: false,
      reason: `profit gate: attempts ${metrics.attempts} < ${minAttempts}`,
      minNetEth,
      minSuccessRate,
      minAttempts,
    };
  }

  if (metrics.netEth < minNetEth) {
    return {
      required,
      canPost: false,
      reason: `profit gate: net ${metrics.netEth.toFixed(6)} ETH < ${minNetEth}`,
      minNetEth,
      minSuccessRate,
      minAttempts,
    };
  }

  const successRate = metrics.successRatePct / 100;
  if (successRate < minSuccessRate) {
    return {
      required,
      canPost: false,
      reason: `profit gate: success rate ${successRate.toFixed(2)} < ${minSuccessRate}`,
      minNetEth,
      minSuccessRate,
      minAttempts,
    };
  }

  return {
    required,
    canPost: true,
    reason: null,
    minNetEth,
    minSuccessRate,
    minAttempts,
  };
}

export async function runXGrowthAutomation(options?: {
  dryRun?: boolean;
  trend?: string;
  force?: boolean;
}) {
  const state = readState();
  const dryRun = options?.dryRun ?? (String(process.env.X_DRY_RUN || 'true').toLowerCase() !== 'false');

  if (!isXAutomationEnabled()) {
    return {
      ok: false,
      posted: false,
      dryRun,
      reason: 'X automation disabled',
      text: '',
      guards: evaluateGuards(state),
    };
  }

  const style = getPostStyle();
  const needsMetrics = style === 'proof' || isProfitGateRequired();
  const proofMetrics = needsMetrics ? await getProofMetrics() : null;
  const generated = await generateXGrowthPost(options?.trend, proofMetrics);
  const guards = evaluateGuards(state);
  const profitGate = evaluateProfitGate(proofMetrics);

  if (!dryRun && !isConfigured()) {
    return {
      ok: false,
      posted: false,
      dryRun,
      reason: 'X token not configured',
      text: generated,
      guards,
      profitGate,
      proofMetrics,
    };
  }

  if (!profitGate.canPost) {
    return {
      ok: false,
      posted: false,
      dryRun,
      reason: profitGate.reason || 'profit gate blocked',
      text: generated,
      guards,
      profitGate,
      proofMetrics,
    };
  }

  if (!options?.force && !guards.canPost) {
    return {
      ok: false,
      posted: false,
      dryRun,
      reason: guards.cooldownOk ? 'daily limit reached' : 'cooldown active',
      text: generated,
      guards,
      profitGate,
      proofMetrics,
    };
  }

  let success = false;
  let errorMessage: string | undefined;
  let externalId: string | null = null;

  try {
    if (!dryRun) {
      const payload = await postTweet(generated);
      externalId = payload?.data?.id || null;
    }
    success = true;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'unknown x post error';
  }

  const entry: XPostHistory = {
    id: `x_${now()}_${Math.random().toString(36).slice(2, 8)}`,
    text: generated,
    postedAt: now(),
    dryRun,
    success,
    error: errorMessage,
  };

  const nextState: XState = {
    history: [...state.history, entry].slice(-MAX_HISTORY),
    updatedAt: now(),
  };
  writeState(nextState);

  await logEvent('x_growth_post', {
    success,
    dryRun,
    externalId,
    error: errorMessage,
    textLength: generated.length,
    handle: getHandle(),
    profitGate,
    proofMetrics,
  });

  return {
    ok: success,
    posted: success,
    dryRun,
    text: generated,
    externalId,
    guards,
    profitGate,
    proofMetrics,
    error: errorMessage,
  };
}
