#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.up.railway.app').replace(/\/$/, '');
const LOOKBACK_HOURS = Math.min(8760, Math.max(1, Number(process.env.POLICY_LOOKBACK_HOURS || 168)));
const AUTO_REDEPLOY = String(process.env.POLICY_AUTO_REDEPLOY || 'true').toLowerCase() === 'true';
const SELF_FUNDING_MODE = String(process.env.SELF_FUNDING_MODE || 'true').toLowerCase() !== 'false';
const POLICY_OVERRIDE_MIN_PAYOUT = String(process.env.POLICY_OVERRIDE_MIN_PAYOUT || 'false').toLowerCase() === 'true';
const TRADE_VENUE_AUTO_POLICY_ENABLED = String(process.env.TRADE_VENUE_AUTO_POLICY_ENABLED || 'true').toLowerCase() !== 'false';
const TRADE_VENUE_MIN_SAMPLES = Math.max(1, Number(process.env.TRADE_VENUE_MIN_SAMPLES || 5));
const TRADE_VENUE_STATE_FILE = process.env.TRADE_VENUE_STATE_FILE || 'data/venue-performance-state.json';
const PAYOUT_MIN_USD = Math.max(1, Number(process.env.PAYOUT_MIN_USD || process.env.MIN_PAYOUT_USD || 50));
const PAYOUT_ENFORCE_BASE_NATIVE_ONLY = String(process.env.PAYOUT_ENFORCE_BASE_NATIVE_ONLY || 'true').toLowerCase() !== 'false';
const SINGLE_PAYOUT_RECIPIENT = (process.env.SINGLE_PAYOUT_RECIPIENT || '0x507d286480dDf20A18D2a218C84A81227A92F619').trim();
const INTELLIGENCE_EDGE_FOCUS_MODE = String(process.env.INTELLIGENCE_EDGE_FOCUS_MODE || 'true').toLowerCase() !== 'false';
const COLLAB_EDGE_ROUNDS = Math.max(1, Number(process.env.COLLAB_EDGE_ROUNDS || 3));
const COLLAB_EDGE_MIN_ROUNDS = Math.max(2, Number(process.env.COLLAB_EDGE_MIN_ROUNDS || 4));
const DISTRIBUTION_MIN_OVERFLOW_ETH_SAFE = String(process.env.DISTRIBUTION_MIN_OVERFLOW_ETH_SAFE || '0.01').trim();
const SELF_FUNDING_BALANCE_TARGET_ETH_SAFE = String(process.env.SELF_FUNDING_BALANCE_TARGET_ETH_SAFE || '0.08').trim();
const SELF_FUNDING_CRITICAL_BALANCE_ETH_SAFE = String(process.env.SELF_FUNDING_CRITICAL_BALANCE_ETH_SAFE || '0.04').trim();

const RAILWAY_TOKEN = process.env.RAILWAY_TOKEN || '';
const RAILWAY_PROJECT_ID = process.env.RAILWAY_PROJECT_ID || '';
const RAILWAY_SERVICE_ID = process.env.RAILWAY_SERVICE_ID || '';
const RAILWAY_ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID || '';

const RAILWAY_GQL = 'https://backboard.railway.app/graphql/v2';

function required(name, value) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function upsertEnvVar(key, value) {
  if (!RAILWAY_TOKEN) throw new Error('Missing RAILWAY_TOKEN');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(RAILWAY_GQL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RAILWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'mutation UpsertVariable($input: VariableUpsertInput!) { variableUpsert(input: $input) }',
        variables: {
          input: {
            projectId: RAILWAY_PROJECT_ID,
            environmentId: RAILWAY_ENVIRONMENT_ID,
            serviceId: RAILWAY_SERVICE_ID,
            name: key,
            value: String(value),
          },
        },
      }),
      signal: controller.signal,
    });
  } finally { clearTimeout(timer); }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Railway env upsert failed for ${key}: HTTP ${response.status} ${body}`);
  }
  const json = await response.json().catch(() => null);
  if (json?.errors?.length) {
    throw new Error(`Railway env upsert failed for ${key}: ${json.errors[0]?.message}`);
  }
}

async function tryRedeployLatestProduction() {
  if (!RAILWAY_TOKEN) throw new Error('Missing RAILWAY_TOKEN');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(RAILWAY_GQL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RAILWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'mutation ServiceInstanceDeploy($serviceId: String!, $environmentId: String!) { serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId) }',
        variables: {
          serviceId: RAILWAY_SERVICE_ID,
          environmentId: RAILWAY_ENVIRONMENT_ID,
        },
      }),
      signal: controller.signal,
    });
  } finally { clearTimeout(timer); }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Railway redeploy failed: HTTP ${response.status} ${body}`);
  }
  const json = await response.json().catch(() => null);
  if (json?.errors?.length) {
    throw new Error(`Railway redeploy failed: ${json.errors[0]?.message}`);
  }
  console.log('Redeploy requested via Railway API.');
}

function toEthString(weiLike) {
  const value = Number(weiLike || 0) / 1e18;
  return Number.isFinite(value) ? value.toFixed(6) : '0.000000';
}

function toEthNumber(weiLike) {
  const value = Number(weiLike || 0) / 1e18;
  return Number.isFinite(value) ? value : 0;
}

async function fetchJson(path) {
  const headers = { 'content-type': 'application/json' };
  if (process.env.ALERT_SECRET) headers['x-api-secret'] = process.env.ALERT_SECRET;
  const response = await fetch(`${APP_BASE_URL}${path}`, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`Failed ${path}: HTTP ${response.status}`);
  }
  return response.json();
}

function computePolicy({ balanceEth, transferredEth, marketRegime, geopoliticalRisk }) {
  const generatedEth = balanceEth + transferredEth;

  if (SELF_FUNDING_MODE) {
    if (marketRegime === 'risk_off' || geopoliticalRisk >= 0.6) {
      return {
        reinvestBps: 9800,
        minPayoutEth: '0.0002',
        treasuryTargetEth: '0.06',
        reason: 'Self-funding mission + risk-off regime: maximize retention and runway.',
      };
    }

    if (generatedEth < 0.20) {
      return {
        reinvestBps: 9600,
        minPayoutEth: '0.0002',
        treasuryTargetEth: '0.05',
        reason: 'Self-funding mission with limited recent generation: retain most profits for longevity.',
      };
    }

    return {
      reinvestBps: 9500,
      minPayoutEth: '0.0002',
      treasuryTargetEth: '0.05',
      reason: 'Self-funding mission with healthier generation: retain majority and distribute controlled overflow.',
    };
  }

  if (marketRegime === 'risk_off' || geopoliticalRisk >= 0.6) {
    return {
      reinvestBps: 9000,
      minPayoutEth: '0.03',
      treasuryTargetEth: '0.24',
      reason: 'Risk-off / elevated geopolitical stress detected; shift to maximum capital preservation and compounding.',
    };
  }

  if (generatedEth < 0.05) {
    return {
      reinvestBps: 9000,
      minPayoutEth: '0.03',
      treasuryTargetEth: '0.20',
      reason: 'Low recent generation; maximize compounding.',
    };
  }

  if (generatedEth < 0.20) {
    return {
      reinvestBps: 8750,
      minPayoutEth: '0.025',
      treasuryTargetEth: '0.20',
      reason: 'Moderate generation; keep compounding bias high.',
    };
  }

  return {
    reinvestBps: 8500,
    minPayoutEth: '0.02',
    treasuryTargetEth: '0.20',
    reason: 'Healthy generation; maintain strong reinvest with steady payout gate.',
  };
}

function sumTransfersWithinLookback(logs, lookbackHours) {
  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
  return (logs || []).reduce((sum, entry) => {
    if (!entry || entry.type !== 'transfer') return sum;
    const ts = Date.parse(entry.time || '');
    if (!Number.isFinite(ts) || ts < cutoff) return sum;
    return sum + toEthNumber(entry.payload?.amount);
  }, 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function scoreVenue(perf) {
  const attempts = Math.max(1, Number(perf?.attempts || 0));
  const successRate = Number(perf?.successes || 0) / attempts;
  const placedRate = Number(perf?.placed || 0) / attempts;
  const errorRate = Number(perf?.errors || 0) / attempts;
  const skipRate = Number(perf?.skipped || 0) / attempts;
  const raw = 50 + 30 * placedRate + 20 * successRate - 30 * errorRate - 10 * skipRate;
  return Number(clamp(raw, 0, 100).toFixed(4));
}

function deriveVenuePolicy() {
  const abs = path.resolve(process.cwd(), TRADE_VENUE_STATE_FILE);
  if (!fs.existsSync(abs)) {
    return {
      enabled: false,
      reason: `state file not found: ${TRADE_VENUE_STATE_FILE}`,
      selectedVenue: null,
      priority: null,
      scorecard: {},
    };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return {
      enabled: false,
      reason: `state file unreadable: ${TRADE_VENUE_STATE_FILE}`,
      selectedVenue: null,
      priority: null,
      scorecard: {},
    };
  }

  const venues = parsed?.venues && typeof parsed.venues === 'object' ? parsed.venues : {};
  const candidates = Object.entries(venues)
    .map(([name, perf]) => ({
      name,
      attempts: Number(perf?.attempts || 0),
      score: scoreVenue(perf),
      perf,
    }))
    .filter((row) => row.name);

  if (candidates.length === 0) {
    return {
      enabled: false,
      reason: 'no venue stats in state file',
      selectedVenue: null,
      priority: null,
      scorecard: {},
    };
  }

  const scorecard = Object.fromEntries(candidates.map((row) => [row.name, {
    attempts: row.attempts,
    score: row.score,
    placed: Number(row.perf?.placed || 0),
    skipped: Number(row.perf?.skipped || 0),
    errors: Number(row.perf?.errors || 0),
  }]));

  const ranked = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.attempts - a.attempts;
  });

  const mature = ranked.filter((row) => row.attempts >= TRADE_VENUE_MIN_SAMPLES);
  const ordered = mature.length > 0
    ? [...mature, ...ranked.filter((row) => row.attempts < TRADE_VENUE_MIN_SAMPLES)]
    : ranked;

  const selected = ordered[0]?.name || null;
  const priority = ordered.map((row) => row.name).join(',');

  return {
    enabled: true,
    reason: mature.length > 0 ? 'using mature scored venues' : 'insufficient mature samples; using best available score',
    selectedVenue: selected,
    priority,
    scorecard,
  };
}

async function main() {
  if (!RAILWAY_TOKEN) {
    throw new Error('Missing RAILWAY_TOKEN');
  }

  const [wallet, walletLogs, autonomyStatus] = await Promise.all([
    fetchJson('/api/alchemy/wallet'),
    fetchJson('/api/alchemy/wallet/logs?limit=3000'),
    fetchJson('/api/status/autonomy').catch(() => ({})),
  ]);

  const balanceEth = toEthNumber(wallet.balance);
  const transferredEth = sumTransfersWithinLookback(walletLogs.logs, LOOKBACK_HOURS);
  const marketRegime = autonomyStatus?.market?.latest?.regime || 'unknown';
  const geopoliticalRisk = Number(autonomyStatus?.market?.latest?.geopoliticalRisk || 0);
  const policy = computePolicy({ balanceEth, transferredEth, marketRegime, geopoliticalRisk });
  const treasuryMaxReinvestBps = Math.min(9500, policy.reinvestBps + 500);
  const venuePolicy = TRADE_VENUE_AUTO_POLICY_ENABLED ? deriveVenuePolicy() : { enabled: false, reason: 'disabled', scorecard: {} };

  console.log(`Weekly policy review: balance=${toEthString(wallet.balance)} ETH transferred_${LOOKBACK_HOURS}h=${transferredEth.toFixed(6)} ETH`);
  console.log(`Market context: regime=${marketRegime} geopoliticalRisk=${geopoliticalRisk.toFixed(3)}`);
  console.log(`Selected policy: reinvest=${policy.reinvestBps} minPayout=${policy.minPayoutEth} treasuryTarget=${policy.treasuryTargetEth}`);
  console.log(`Reason: ${policy.reason}`);
  console.log(`Policy mode: self_funding=${SELF_FUNDING_MODE} override_min_payout=${POLICY_OVERRIDE_MIN_PAYOUT}`);
  if (TRADE_VENUE_AUTO_POLICY_ENABLED) {
    console.log(`Venue policy: enabled=${venuePolicy.enabled} reason=${venuePolicy.reason}`);
    if (venuePolicy.enabled) {
      console.log(`Venue policy selected=${venuePolicy.selectedVenue} priority=${venuePolicy.priority}`);
    }
  }
  console.log(`Payout policy: minUsd=${PAYOUT_MIN_USD} enforceBaseNativeOnly=${PAYOUT_ENFORCE_BASE_NATIVE_ONLY}`);
  console.log(`Payout recipient: single=${SINGLE_PAYOUT_RECIPIENT}`);
  console.log(`Safety controls: minOverflowEth=${DISTRIBUTION_MIN_OVERFLOW_ETH_SAFE} selfFundingTarget=${SELF_FUNDING_BALANCE_TARGET_ETH_SAFE} critical=${SELF_FUNDING_CRITICAL_BALANCE_ETH_SAFE}`);
  console.log(`Intelligence focus: edgeMode=${INTELLIGENCE_EDGE_FOCUS_MODE} collabEdgeRounds=${COLLAB_EDGE_ROUNDS} minCollabRounds=${COLLAB_EDGE_MIN_ROUNDS}`);

  await upsertEnvVar('SELF_SUSTAIN_REINVEST_BPS', String(policy.reinvestBps));
  await upsertEnvVar('TREASURY_MAX_REINVEST_BPS', String(treasuryMaxReinvestBps));
  await upsertEnvVar('TREASURY_TARGET_ETH', policy.treasuryTargetEth);
  if (POLICY_OVERRIDE_MIN_PAYOUT) {
    await upsertEnvVar('MIN_PAYOUT_ETH', policy.minPayoutEth);
  }
  await upsertEnvVar('PAYOUT_MIN_USD', String(PAYOUT_MIN_USD));
  await upsertEnvVar('MIN_PAYOUT_USD', String(PAYOUT_MIN_USD));
  await upsertEnvVar('PAYOUT_ALLOW_TOKEN', 'false');
  await upsertEnvVar('PAYOUT_ENFORCE_BASE_NATIVE_ONLY', PAYOUT_ENFORCE_BASE_NATIVE_ONLY ? 'true' : 'false');
  await upsertEnvVar('ENFORCE_SINGLE_PAYOUT_RECIPIENT', 'true');
  await upsertEnvVar('SINGLE_PAYOUT_RECIPIENT', SINGLE_PAYOUT_RECIPIENT);
  await upsertEnvVar('REVENUE_RECIPIENTS', SINGLE_PAYOUT_RECIPIENT);
  await upsertEnvVar('DISTRIBUTION_MIN_OVERFLOW_ETH', DISTRIBUTION_MIN_OVERFLOW_ETH_SAFE);
  await upsertEnvVar('SELF_FUNDING_MODE', 'true');
  await upsertEnvVar('SELF_FUNDING_PAUSE_OVERFLOW_ON_CRITICAL', 'true');
  await upsertEnvVar('SELF_FUNDING_BALANCE_TARGET_ETH', SELF_FUNDING_BALANCE_TARGET_ETH_SAFE);
  await upsertEnvVar('SELF_FUNDING_CRITICAL_BALANCE_ETH', SELF_FUNDING_CRITICAL_BALANCE_ETH_SAFE);
  await upsertEnvVar('SELF_FUNDING_REINVEST_BPS_BELOW_TARGET', '9800');
  await upsertEnvVar('SELF_FUNDING_REINVEST_BPS_ABOVE_TARGET', String(Math.max(9500, policy.reinvestBps)));
  await upsertEnvVar('SELF_FUNDING_CRITICAL_REINVEST_BPS', '9900');
  await upsertEnvVar('ALERT_ON_SUCCESS', 'false');
  await upsertEnvVar('SELF_HEAL_NOTIFY_OK', 'false');
  await upsertEnvVar('ALCHEMY_NETWORK', 'base-mainnet');
  if (INTELLIGENCE_EDGE_FOCUS_MODE) {
    await upsertEnvVar('INTELLIGENCE_EDGE_FOCUS_MODE', 'true');
    await upsertEnvVar('COLLAB_EDGE_ROUNDS', String(COLLAB_EDGE_ROUNDS));
    await upsertEnvVar('COLLAB_EDGE_MIN_ROUNDS', String(COLLAB_EDGE_MIN_ROUNDS));
  }
  if (TRADE_VENUE_AUTO_POLICY_ENABLED && venuePolicy.enabled && venuePolicy.selectedVenue) {
    await upsertEnvVar('TRADE_VENUE', 'auto');
    await upsertEnvVar('TRADE_VENUE_PRIORITY', venuePolicy.priority);
    await upsertEnvVar('TRADE_VENUE_AUTO_LEARN', 'true');
    await upsertEnvVar('TRADE_VENUE_MIN_SAMPLES', String(TRADE_VENUE_MIN_SAMPLES));
    await upsertEnvVar('TRADE_VENUE_AUTO_FALLBACK_ON_SKIP', 'true');
  }

  console.log('Railway production env updated for weekly policy tuning.');

  if (AUTO_REDEPLOY) {
    try {
      await tryRedeployLatestProduction();
    } catch (error) {
      console.warn(`Policy updated, but auto-redeploy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
