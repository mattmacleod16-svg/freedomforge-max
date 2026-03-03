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

type XState = {
  history: XPostHistory[];
  updatedAt: number;
};

const DATA_DIR = process.env.VERCEL ? '/tmp/freedomforge-data' : path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'x-automation.json');
const MAX_HISTORY = 300;

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

function buildPostText(input: {
  handle: string;
  appUrl: string;
  trend?: string;
}) {
  const theme = input.trend || inferGrowthTheme();
  const hashtags = ['#BuildInPublic', '#AI', '#Automation', '#TradingTech'];
  const selected = hashtags.sort(() => 0.5 - Math.random()).slice(0, 2).join(' ');
  const text = `Shipping another FreedomForge Max upgrade: ${theme}.\n\nText-first UX, optional emotion-aware voice, and autonomous ops controls are live.\n\n${input.appUrl}\n${selected}`;
  if (text.length <= 280) return text;
  return text.slice(0, 276) + '...';
}

function getCooldownMinutes() {
  return Math.max(10, Number(process.env.X_POST_COOLDOWN_MINUTES || 120));
}

function getDailyPostLimit() {
  return Math.max(1, Number(process.env.X_POST_DAILY_LIMIT || 3));
}

function isConfigured() {
  return Boolean(process.env.X_BEARER_TOKEN || process.env.X_ACCESS_TOKEN);
}

function getAuthToken() {
  return process.env.X_ACCESS_TOKEN || process.env.X_BEARER_TOKEN || '';
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

  return {
    configured: isConfigured(),
    handle: getHandle(),
    appUrl: getBaseUrl(),
    guards,
    recent: state.history.slice(-10).reverse(),
    profileAutomationUrl: `https://x.com/settings`,
  };
}

export function generateXGrowthPost(trend?: string) {
  return buildPostText({
    handle: getHandle(),
    appUrl: getBaseUrl(),
    trend,
  });
}

async function postTweet(text: string) {
  const token = getAuthToken();
  const response = await fetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`X API error ${response.status}: ${JSON.stringify(payload)}`);
  }

  return payload;
}

export async function runXGrowthAutomation(options?: {
  dryRun?: boolean;
  trend?: string;
  force?: boolean;
}) {
  const state = readState();
  const dryRun = options?.dryRun ?? (String(process.env.X_DRY_RUN || 'true').toLowerCase() !== 'false');
  const generated = generateXGrowthPost(options?.trend);
  const guards = evaluateGuards(state);

  if (!dryRun && !isConfigured()) {
    return {
      ok: false,
      posted: false,
      dryRun,
      reason: 'X token not configured',
      text: generated,
      guards,
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
  });

  return {
    ok: success,
    posted: success,
    dryRun,
    text: generated,
    externalId,
    guards,
    error: errorMessage,
  };
}
