#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const venue = String(process.env.TRADE_VENUE || 'polymarket').trim().toLowerCase();
const autoPriority = String(process.env.TRADE_VENUE_PRIORITY || 'polymarket,kraken,coinbase')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const autoFallbackOnSkip = String(process.env.TRADE_VENUE_AUTO_FALLBACK_ON_SKIP || 'true').toLowerCase() !== 'false';
const autoFallbackOnError = String(process.env.TRADE_VENUE_AUTO_FALLBACK_ON_ERROR || 'true').toLowerCase() !== 'false';
const autoFallbackOnGeoblock = String(process.env.TRADE_VENUE_AUTO_FALLBACK_ON_GEOBLOCK || 'true').toLowerCase() !== 'false';
const autoLearnEnabled = String(process.env.TRADE_VENUE_AUTO_LEARN || 'true').toLowerCase() !== 'false';
const minSamplesForScoring = Math.max(1, Number(process.env.TRADE_VENUE_MIN_SAMPLES || 5));
const performanceStateFile = process.env.TRADE_VENUE_STATE_FILE || 'data/venue-performance-state.json';
const circuitBreakerEnabled = String(process.env.TRADE_VENUE_CIRCUIT_BREAKER || 'true').toLowerCase() !== 'false';
const circuitBreakerThreshold = Math.max(2, parseInt(process.env.TRADE_VENUE_CIRCUIT_BREAKER_THRESHOLD || '3', 10));
const circuitBreakerCooldownBaseMs = Math.max(30000, parseInt(process.env.TRADE_VENUE_CIRCUIT_BREAKER_COOLDOWN_MS || '300000', 10));
const circuitBreakerMaxCooldownMs = Math.max(circuitBreakerCooldownBaseMs, parseInt(process.env.TRADE_VENUE_CIRCUIT_BREAKER_MAX_COOLDOWN_MS || '3600000', 10));
const staleSignalProtection = String(process.env.TRADE_VENUE_STALE_SIGNAL_PROTECTION || 'true').toLowerCase() !== 'false';
const staleSignalMaxAgeMs = Math.max(300000, parseInt(process.env.TRADE_VENUE_STALE_SIGNAL_MAX_AGE_MS || String(4 * 60 * 60 * 1000), 10));

function getSignalBusFreshness() {
  if (!staleSignalProtection) return { fresh: true };
  try {
    const bus = require('../lib/agent-signal-bus');
    const recent = bus.query({ type: 'intelligence_cycle', maxAgeMs: staleSignalMaxAgeMs });
    if (recent.length > 0) return { fresh: true, age: Date.now() - recent[0].publishedAt };
    return { fresh: false, reason: 'no recent intelligence_cycle signal' };
  } catch {
    return { fresh: true, reason: 'signal-bus unavailable, defaulting to fresh' };
  }
}

function getSignalBusConsensus() {
  try {
    const bus = require('../lib/agent-signal-bus');
    return {
      regime: bus.consensus('market_regime'),
      forecast: bus.query({ type: 'forecast', maxAgeMs: staleSignalMaxAgeMs }).slice(0, 3),
      summary: bus.summary(),
    };
  } catch {
    return null;
  }
}

const map = {
  polymarket: ['node', ['scripts/polymarket-clob-engine.js']],
  kraken: ['node', ['scripts/kraken-spot-engine.js']],
  coinbase: ['node', ['scripts/coinbase-spot-engine.js']],
  prediction: ['node', ['scripts/prediction-market-engine.js']],
  orchestrator: ['node', ['scripts/master-orchestrator.js']],
};

function loadPerformanceState() {
  const abs = path.resolve(process.cwd(), performanceStateFile);
  if (!fs.existsSync(abs)) return { path: abs, data: { venues: {}, updatedAt: 0 } };
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return {
      path: abs,
      data: {
        venues: parsed?.venues && typeof parsed.venues === 'object' ? parsed.venues : {},
        updatedAt: Number(parsed?.updatedAt || 0),
      },
    };
  } catch {
    return { path: abs, data: { venues: {}, updatedAt: 0 } };
  }
}

function savePerformanceState(abs, data) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (rio) { rio.writeJsonAtomic(abs, data); }
  else {
    const tmp = abs + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, abs);
  }
}

function getVenuePerf(state, name) {
  if (!state.venues[name]) {
    state.venues[name] = {
      attempts: 0,
      successes: 0,
      placed: 0,
      skipped: 0,
      errors: 0,
      geoblocked: 0,
      dryRuns: 0,
      lastOutcome: 'unknown',
      lastExitStatus: null,
      lastRunAt: 0,
    };
  }
  return state.venues[name];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function venueScore(perf) {
  const attempts = Math.max(1, Number(perf?.attempts || 0));
  const successRate = Number(perf?.successes || 0) / attempts;
  const placedRate = Number(perf?.placed || 0) / attempts;
  const errorRate = Number(perf?.errors || 0) / attempts;
  const skipRate = Number(perf?.skipped || 0) / attempts;
  const raw = 50 + 30 * placedRate + 20 * successRate - 30 * errorRate - 10 * skipRate;
  return Number(clamp(raw, 0, 100).toFixed(4));
}

function hasStatus(text, value) {
  return new RegExp(`"status"\\s*:\\s*"${value}"`, 'i').test(String(text || ''));
}

function hasHttpErrorStatus(text) {
  return /"status"\s*:\s*(4\d\d|5\d\d)\b/i.test(String(text || ''));
}

function hasGeoblockError(text) {
  return /trading restricted in your region|geoblock/i.test(String(text || ''));
}

function hasActionError(text) {
  return /"actions"\s*:\s*\[[\s\S]*?"status"\s*:\s*"error"/i.test(String(text || ''));
}

function hasErrorField(text) {
  return /"error"\s*:\s*"[^"]+"/i.test(String(text || ''));
}

function classifyRun(run) {
  const stdout = String(run?.stdout || '');
  const stderr = String(run?.stderr || '');
  const combined = `${stdout}\n${stderr}`;
  const statusCode = Number.isFinite(Number(run?.status)) ? Number(run.status) : 1;
  const skipped = hasStatus(stdout, 'skipped');
  const placed = hasStatus(stdout, 'placed');
  const dryRun = hasStatus(stdout, 'dry-run');
  const geoblocked = hasGeoblockError(combined);
  const hardFailure = hasHttpErrorStatus(combined) || hasActionError(combined) || hasErrorField(combined);

  let outcome = 'error';
  if (statusCode === 0 && geoblocked) outcome = 'geoblocked';
  else if (statusCode === 0 && skipped) outcome = 'skipped';
  else if (statusCode === 0 && placed && !hardFailure) outcome = 'placed';
  else if (statusCode === 0 && dryRun) outcome = 'dry-run';
  else if (statusCode === 0 && !hardFailure) outcome = 'success';

  return { skipped, placed, dryRun, geoblocked, hardFailure, outcome, statusCode };
}

function recordVenueRun(state, name, run) {
  const perf = getVenuePerf(state, name);
  const classification = classifyRun(run);

  perf.attempts += 1;
  if (classification.statusCode === 0) perf.successes += 1;
  if (classification.placed) perf.placed += 1;
  if (classification.skipped) perf.skipped += 1;
  if (classification.dryRun) perf.dryRuns += 1;
  if (classification.statusCode !== 0 || classification.hardFailure || classification.geoblocked) perf.errors += 1;
  if (classification.geoblocked) perf.geoblocked += 1;
  if (classification.statusCode !== 0 || classification.hardFailure || classification.geoblocked) {
    perf.consecutiveErrors = (perf.consecutiveErrors || 0) + 1;
  } else {
    perf.consecutiveErrors = 0;
  }
  perf.lastOutcome = classification.outcome;
  perf.lastExitStatus = classification.statusCode;
  perf.lastRunAt = Date.now();

  return classification;
}

function isCircuitBroken(state, name) {
  if (!circuitBreakerEnabled) return false;
  const perf = state.venues[name];
  if (!perf) return false;
  const consecutiveErrors = Number(perf.consecutiveErrors || 0);
  if (consecutiveErrors < circuitBreakerThreshold) return false;
  const lastRunAt = Number(perf.lastRunAt || 0);
  const cooldown = Math.min(
    circuitBreakerMaxCooldownMs,
    circuitBreakerCooldownBaseMs * Math.pow(2, Math.min(consecutiveErrors - circuitBreakerThreshold, 6))
  );
  const elapsed = Date.now() - lastRunAt;
  if (elapsed >= cooldown) return false;
  return true;
}

function isEnabledForVenue(name) {
  if (name === 'polymarket') return String(process.env.POLY_CLOB_ENABLED || 'false').toLowerCase() === 'true';
  if (name === 'kraken') return String(process.env.KRAKEN_ENABLED || 'false').toLowerCase() === 'true';
  if (name === 'coinbase') return String(process.env.COINBASE_ENABLED || 'false').toLowerCase() === 'true';
  if (name === 'prediction') return String(process.env.PRED_MARKET_ENABLED || 'false').toLowerCase() === 'true';
  if (name === 'orchestrator') return String(process.env.ORCHESTRATOR_ENABLED || 'false').toLowerCase() === 'true';
  return false;
}

function runVenue(name) {
  if (!map[name]) {
    return { status: 0, stdout: '', stderr: `unsupported venue ${name}` };
  }

  const [command, args] = map[name];
  const result = spawnSync(command, args, {
    env: process.env,
    encoding: 'utf8',
    timeout: 120000,
  });

  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '').replace(/(key|secret|password|token|authorization)\s*[:=]\s*\S+/gi, '$1=***');
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout,
    stderr,
  };
}

function isSkippedOutput(text) {
  return /"status"\s*:\s*"skipped"/i.test(String(text || ''));
}

function buildFallbackCandidates(primaryVenue) {
  const seen = new Set();
  const ordered = [];
  const push = (name) => {
    if (!map[name] || seen.has(name)) return;
    seen.add(name);
    ordered.push(name);
  };
  push(primaryVenue);
  for (const candidate of autoPriority) push(candidate);
  for (const candidate of Object.keys(map)) push(candidate);
  return ordered;
}

function orderAutoCandidates(baseCandidates, performance) {
  if (!autoLearnEnabled) return baseCandidates;

  const index = new Map(baseCandidates.map((value, idx) => [value, idx]));
  const measured = [];
  const unmeasured = [];

  for (const candidate of baseCandidates) {
    const perf = performance.venues[candidate];
    const attempts = Number(perf?.attempts || 0);
    if (attempts >= minSamplesForScoring) {
      measured.push({
        venue: candidate,
        score: venueScore(perf),
      });
    } else {
      unmeasured.push(candidate);
    }
  }

  measured.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (index.get(a.venue) || 0) - (index.get(b.venue) || 0);
  });

  return [...measured.map((row) => row.venue), ...unmeasured];
}

if (venue === 'auto') {
  const freshness = getSignalBusFreshness();
  if (!freshness.fresh) {
    console.log(JSON.stringify({
      status: 'skipped',
      reason: `stale intelligence data: ${freshness.reason}`,
      staleSignalProtection: true,
    }, null, 2));
    process.exit(0);
  }

  const performance = loadPerformanceState();
  const baseCandidates = [...new Set(autoPriority)].filter((name) => map[name]);
  const candidates = orderAutoCandidates(baseCandidates, performance.data);
  const tried = [];
  const scorecard = {};

  for (const name of baseCandidates) {
    const perf = performance.data.venues[name];
    if (!perf) continue;
    scorecard[name] = {
      attempts: perf.attempts,
      successes: perf.successes,
      placed: perf.placed,
      skipped: perf.skipped,
      errors: perf.errors,
      score: venueScore(perf),
    };
  }

  for (const candidate of candidates) {
    if (!isEnabledForVenue(candidate)) {
      tried.push({ venue: candidate, result: 'disabled' });
      continue;
    }

    if (isCircuitBroken(performance.data, candidate)) {
      tried.push({ venue: candidate, result: 'circuit-broken' });
      continue;
    }

    const run = runVenue(candidate);
    const classification = recordVenueRun(performance.data, candidate, run);
    performance.data.updatedAt = Date.now();
    savePerformanceState(performance.path, performance.data);

    tried.push({ venue: candidate, exitStatus: run.status, skipped: classification.skipped, outcome: classification.outcome });

    if (classification.geoblocked && autoFallbackOnGeoblock) {
      continue;
    }

    if ((run.status !== 0 || classification.hardFailure) && autoFallbackOnError) {
      continue;
    }

    if (classification.skipped && autoFallbackOnSkip) {
      continue;
    }

    process.exit(0);
  }

  console.log(JSON.stringify({
    status: 'skipped',
    reason: 'auto venue selection exhausted candidates',
    orderedCandidates: candidates,
    scorecard,
    tried,
    signalBus: getSignalBusConsensus(),
  }, null, 2));
  process.exit(0);
}

if (!map[venue]) {
  console.log(JSON.stringify({
    status: 'skipped',
    reason: `unsupported TRADE_VENUE=${venue}`,
    supported: Object.keys(map),
  }, null, 2));
  process.exit(0);
}

const result = runVenue(venue);
const performance = loadPerformanceState();
const firstRun = recordVenueRun(performance.data, venue, result);
performance.data.updatedAt = Date.now();
savePerformanceState(performance.path, performance.data);

const shouldTryFallback =
  (firstRun.geoblocked && autoFallbackOnGeoblock) ||
  ((result.status !== 0 || firstRun.hardFailure) && autoFallbackOnError) ||
  (firstRun.skipped && autoFallbackOnSkip);

if (!shouldTryFallback) {
  process.exit(result.status);
}

const fallbackCandidates = buildFallbackCandidates(venue).slice(1);
const tried = [{ venue, exitStatus: result.status, skipped: firstRun.skipped, outcome: firstRun.outcome }];

for (const candidate of fallbackCandidates) {
  if (!isEnabledForVenue(candidate)) {
    tried.push({ venue: candidate, result: 'disabled' });
    continue;
  }

  if (isCircuitBroken(performance.data, candidate)) {
    tried.push({ venue: candidate, result: 'circuit-broken' });
    continue;
  }

  const run = runVenue(candidate);
  const classification = recordVenueRun(performance.data, candidate, run);
  performance.data.updatedAt = Date.now();
  savePerformanceState(performance.path, performance.data);

  tried.push({ venue: candidate, exitStatus: run.status, skipped: classification.skipped, outcome: classification.outcome });

  if (classification.geoblocked && autoFallbackOnGeoblock) {
    continue;
  }

  if ((run.status !== 0 || classification.hardFailure) && autoFallbackOnError) {
    continue;
  }

  if (classification.skipped && autoFallbackOnSkip) {
    continue;
  }

  process.exit(0);
}

console.log(JSON.stringify({
  status: 'skipped',
  reason: 'primary venue and fallbacks exhausted candidates',
  primaryVenue: venue,
  tried,
}, null, 2));
process.exit(0);
