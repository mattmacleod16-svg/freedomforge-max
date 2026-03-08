#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const enabled = String(process.env.HELP_BOTS_ENABLED || 'true').toLowerCase() !== 'false';
const adaptiveOrdering = String(process.env.HELP_BOTS_ADAPTIVE_ORDERING || 'true').toLowerCase() !== 'false';
const retryCount = Math.max(0, parseInt(process.env.HELP_BOTS_RETRY_COUNT || '1', 10));
const retryDelayMs = Math.max(250, parseInt(process.env.HELP_BOTS_RETRY_DELAY_MS || '1500', 10));
const enableDataScouts = String(process.env.HELP_BOTS_ENABLE_DATA_SCOUTS || 'true').toLowerCase() !== 'false';
const minDataScouts = Math.max(0, parseInt(process.env.HELP_BOTS_MIN_DATA_SCOUTS || '1', 10));
const maxDataScouts = Math.max(minDataScouts, parseInt(process.env.HELP_BOTS_MAX_DATA_SCOUTS || '3', 10));
const scoutEscalationStreak = Math.max(1, parseInt(process.env.HELP_BOTS_SCOUT_ESCALATION_STREAK || '2', 10));
const stateFile = process.env.HELP_BOTS_STATE_FILE || 'data/help-bots-state.json';

const baseHelpBots = [
  {
    name: 'health-guard-bot',
    command: 'node',
    args: ['scripts/self-heal.js'],
    successCriteria: 'self-heal exits 0 and service state is healthy',
    priority: 100,
  },
  {
    name: 'proof-bot',
    command: 'node',
    args: ['scripts/daily-agent-proof.js'],
    successCriteria: 'daily proof validates agent readiness signals',
    priority: 90,
  },
  {
    name: 'adaptation-bot',
    command: 'node',
    args: ['scripts/venue-engine.js'],
    successCriteria: 'venue engine executes and records adaptive route outcomes',
    priority: 80,
  },
  {
    name: 'alert-guard-bot',
    command: 'node',
    args: ['scripts/smoke-alert-guard.js'],
    successCriteria: 'alert policy remains failure-only for distributions',
    priority: 70,
  },
  {
    name: 'recipient-guard-bot',
    command: 'node',
    args: ['scripts/smoke-recipient-guard.js'],
    successCriteria: 'single-recipient payout guard remains enforced',
    priority: 60,
  },
];

function buildDataScoutBots(state) {
  if (!enableDataScouts) return [];

  const adaptationState = state?.bots?.['adaptation-bot'] || {};
  const streak = Number(adaptationState.consecutiveFailures || 0);
  const escalation = Math.floor(streak / scoutEscalationStreak);
  const scoutCount = Math.min(maxDataScouts, minDataScouts + escalation);
  const bots = [];

  for (let index = 1; index <= scoutCount; index += 1) {
    const isAlphaScout = index % 2 === 1;
    bots.push({
      name: isAlphaScout ? `data-scout-alpha-${index}` : `data-scout-geo-${index}`,
      command: 'node',
      args: [isAlphaScout ? 'scripts/public-alpha-fusion.js' : 'scripts/geopolitical-watch.js'],
      successCriteria: isAlphaScout
        ? 'alpha scout refreshes open-source and market data features'
        : 'geo scout refreshes geopolitical pressure signals',
      priority: 55 - index,
      envOverrides: {
        ALERT_WEBHOOK_URL: '',
        ALERT_MENTION: '',
        PUBLIC_ALPHA_WEBHOOK_EACH_RUN: 'false',
      },
    });
  }

  return bots;
}

function loadState() {
  const abs = path.resolve(process.cwd(), stateFile);
  if (!fs.existsSync(abs)) {
    return { path: abs, data: { runs: 0, bots: {}, updatedAt: 0 } };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return {
      path: abs,
      data: {
        runs: Number(parsed?.runs || 0),
        bots: parsed?.bots && typeof parsed.bots === 'object' ? parsed.bots : {},
        updatedAt: Number(parsed?.updatedAt || 0),
      },
    };
  } catch {
    return { path: abs, data: { runs: 0, bots: {}, updatedAt: 0 } };
  }
}

function saveState(abs, data) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(data, null, 2));
}

function getBotState(state, name) {
  if (!state.bots[name]) {
    state.bots[name] = {
      attempts: 0,
      successes: 0,
      failures: 0,
      consecutiveFailures: 0,
      successRate: 1,
      lastStatus: null,
      lastError: null,
      lastRunAt: 0,
    };
  }
  return state.bots[name];
}

function rankBots(bots, state) {
  if (!adaptiveOrdering) {
    return [...bots].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  return [...bots].sort((left, right) => {
    const ls = getBotState(state, left.name);
    const rs = getBotState(state, right.name);
    const lScore = (left.priority || 0) + ls.successRate * 25 - ls.consecutiveFailures * 10;
    const rScore = (right.priority || 0) + rs.successRate * 25 - rs.consecutiveFailures * 10;
    return rScore - lScore;
  });
}

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // intentional blocking delay for sync orchestration
  }
}

function runBot(bot) {
  let lastStatus = 1;
  let lastError = '';

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const run = spawnSync(bot.command, bot.args, {
      env: {
        ...process.env,
        ...(bot.envOverrides || {}),
      },
      encoding: 'utf8',
    });

    const stdout = String(run.stdout || '');
    const stderr = String(run.stderr || '');
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);

    const status = typeof run.status === 'number' ? run.status : 1;
    lastStatus = status;
    lastError = stderr.trim() || stdout.trim() || '';

    if (status === 0) {
      return {
        bot: bot.name,
        status,
        ok: true,
        attemptsUsed: attempt + 1,
        successCriteria: bot.successCriteria,
      };
    }

    if (attempt < retryCount) {
      sleepMs(retryDelayMs);
    }
  }

  return {
    bot: bot.name,
    status: lastStatus,
    ok: false,
    attemptsUsed: retryCount + 1,
    successCriteria: bot.successCriteria,
    error: lastError.slice(0, 300),
  };
}

function updateBotState(state, result) {
  const botState = getBotState(state, result.bot);
  botState.attempts += 1;
  if (result.ok) {
    botState.successes += 1;
    botState.consecutiveFailures = 0;
    botState.lastError = null;
  } else {
    botState.failures += 1;
    botState.consecutiveFailures += 1;
    botState.lastError = result.error || `exit=${result.status}`;
  }
  botState.successRate = botState.attempts > 0 ? Number((botState.successes / botState.attempts).toFixed(4)) : 0;
  botState.lastStatus = result.status;
  botState.lastRunAt = Date.now();
}

function main() {
  if (!enabled) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'HELP_BOTS_ENABLED=false' }, null, 2));
    return;
  }

  const memory = loadState();
  const helpBots = [...baseHelpBots, ...buildDataScoutBots(memory.data)];
  const orderedBots = rankBots(helpBots, memory.data);
  const startedAt = Date.now();
  const results = orderedBots.map(runBot);
  results.forEach((result) => updateBotState(memory.data, result));

  memory.data.runs += 1;
  memory.data.updatedAt = Date.now();
  saveState(memory.path, memory.data);

  const successful = results.filter((item) => item.ok).length;
  const failed = results.length - successful;

  // Publish orchestrator health to cross-agent signal bus
  try {
    const bus = require('../lib/agent-signal-bus');
    bus.publish({
      type: 'orchestrator_health',
      source: 'help-bots-orchestrator',
      confidence: successful / Math.max(1, results.length),
      payload: {
        successful,
        failed,
        totalBots: results.length,
        dataScoutsActive: results.filter((r) => r.bot.startsWith('data-scout-')).length,
      },
    });
  } catch (busErr) {
    // signal bus unavailable — non-fatal
  }

  console.log(JSON.stringify({
    status: failed > 0 ? 'warn' : 'ok',
    checklist: {
      taskBrief: 'health + proof + adaptation + safety guards',
      successCriteriaDefined: true,
      retriesEnabled: retryCount > 0,
      adaptiveOrdering,
      dataScoutsEnabled: enableDataScouts,
      persistentState: memory.path,
    },
    helperBots: results,
    executionOrder: orderedBots.map((bot) => bot.name),
    successful,
    failed,
    durationMs: Date.now() - startedAt,
  }, null, 2));

  if (successful === 0) {
    process.exit(1);
  }
}

main();
