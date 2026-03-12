#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.vercel.app').replace(/\/$/, '');
const ENABLED = String(process.env.RECOVERY_CONTROLLER_ENABLED || 'true').toLowerCase() !== 'false';
const WINDOW_HOURS = Math.max(1, Number(process.env.RECOVERY_WINDOW_HOURS || 2));
const LOG_LIMIT = Math.max(200, Number(process.env.RECOVERY_LOG_LIMIT || 3000));
const POSITIVE_WINDOWS_REQUIRED = Math.max(1, Number(process.env.RECOVERY_POSITIVE_WINDOWS_REQUIRED || 3));
const MIN_NET_ETH = Math.max(0.0001, Math.min(1.0, Number(process.env.RECOVERY_MIN_NET_ETH || 0.002)));
const MIN_SUCCESS_RATE = Math.max(0.1, Math.min(1.0, Number(process.env.RECOVERY_MIN_SUCCESS_RATE || 0.85)));
const MIN_ATTEMPTS = Math.max(1, Number(process.env.RECOVERY_MIN_ATTEMPTS || 3));
const AUTO_REDEPLOY = String(process.env.RECOVERY_AUTO_REDEPLOY || 'true').toLowerCase() === 'true';
const STATE_FILE = process.env.RECOVERY_STATE_FILE || 'data/recovery-controller-state.json';

const VERCEL_TOKEN = process.env.VERCEL_TOKEN || '';
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || '';
const VERCEL_PROJECT_SLUG = process.env.VERCEL_PROJECT_SLUG || 'freedomforge-max';
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || '';

function parseBigIntSafe(value) {
  try {
    if (value === undefined || value === null || value === '') return BigInt(0);
    return BigInt(String(value));
  } catch {
    return BigInt(0);
  }
}

function weiToEthNumber(wei) {
  const base = BigInt('1000000000000000000');
  const whole = Number(wei / base);
  const frac = Number(wei % base) / 1e18;
  return whole + frac;
}

function loadState(absPath) {
  if (!fs.existsSync(absPath)) {
    return { mode: 'safe', positiveStreak: 0, lastUpdatedAt: 0 };
  }
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return { mode: 'safe', positiveStreak: 0, lastUpdatedAt: 0 };
  }
}

let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

function saveState(absPath, state) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  if (rio) { rio.writeJsonAtomic(absPath, state); }
  else { fs.writeFileSync(absPath, JSON.stringify(state, null, 2)); }
}

async function fetchJson(pathname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${APP_BASE_URL}${pathname}`, {
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${pathname}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function summarizeWindow(logs) {
  const cutoff = Date.now() - WINDOW_HOURS * 60 * 60 * 1000;
  let transferSuccess = 0;
  let transferFailed = 0;
  let payoutsWei = BigInt(0);
  let topupsWei = BigInt(0);

  for (const row of logs) {
    const ts = Date.parse(row?.time || '');
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const type = row?.type;
    const payload = row?.payload || {};

    if (type === 'transfer') {
      transferSuccess += 1;
      payoutsWei += parseBigIntSafe(payload.amount);
    }
    if (type === 'transfer_failed') transferFailed += 1;
    if (type === 'gas_topup') {
      const amountEth = Number(payload.amount || 0) || 0;
      topupsWei += BigInt(Math.floor(amountEth * 1e18));
    }
  }

  const attempts = transferSuccess + transferFailed;
  const successRate = attempts > 0 ? transferSuccess / attempts : 1;
  const netEth = weiToEthNumber(payoutsWei - topupsWei);
  const isPositive = attempts >= MIN_ATTEMPTS && successRate >= MIN_SUCCESS_RATE && netEth >= MIN_NET_ETH;

  return {
    attempts,
    transferSuccess,
    transferFailed,
    successRate,
    netEth,
    isPositive,
  };
}

function hasVercelCli() {
  const result = spawnSync('vercel', ['--version'], { stdio: 'pipe', encoding: 'utf8' });
  return result.status === 0;
}

function runVercel(args) {
  const result = spawnSync('vercel', args, { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    throw new Error(`vercel ${args.join(' ')} failed: ${stderr || stdout || 'unknown error'}`);
  }
}

function vercelApiUrl(pathname) {
  const base = `https://api.vercel.com${pathname}`;
  if (!VERCEL_TEAM_ID) return base;
  const joiner = pathname.includes('?') ? '&' : '?';
  return `${base}${joiner}teamId=${encodeURIComponent(VERCEL_TEAM_ID)}`;
}

function candidateProjectRefs() {
  const refs = [VERCEL_PROJECT_ID, VERCEL_PROJECT_SLUG]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return [...new Set(refs)];
}

async function upsertEnvVar(key, value) {
  if (!VERCEL_TOKEN && hasVercelCli()) {
    const args = ['env', 'add', key, 'production', '--value', value, '--force', '--yes'];
    if (VERCEL_TEAM_ID) args.push('--scope', VERCEL_TEAM_ID);
    runVercel(args);
    return;
  }

  let lastError = null;
  for (const projectRef of candidateProjectRefs()) {
    const url = vercelApiUrl(`/v10/projects/${encodeURIComponent(projectRef)}/env?upsert=true`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${VERCEL_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key,
          value,
          type: 'encrypted',
          target: ['production'],
        }),
        signal: controller.signal,
      });
    } finally { clearTimeout(timer); }

    if (response.ok) return;
    const body = await response.text().catch(() => '');
    lastError = `project=${projectRef} status=${response.status} body=${body}`;
    if (response.status !== 404) break;
  }

  throw new Error(`Vercel env upsert failed for ${key}: ${lastError || 'unknown error'}`);
}

async function tryRedeployLatestProduction() {
  if (!VERCEL_TOKEN && hasVercelCli()) {
    const args = ['--prod', '--yes'];
    if (VERCEL_TEAM_ID) args.push('--scope', VERCEL_TEAM_ID);
    runVercel(args);
    return;
  }

  let deployment = null;
  for (const projectRef of candidateProjectRefs()) {
    const listUrl = vercelApiUrl(`/v6/deployments?projectId=${encodeURIComponent(projectRef)}&target=production&limit=1`);
    const listController = new AbortController();
    const listTimer = setTimeout(() => listController.abort(), 15000);
    let listResponse;
    try {
      listResponse = await fetch(listUrl, {
        headers: {
          Authorization: `Bearer ${VERCEL_TOKEN}`,
          'Content-Type': 'application/json',
        },
        signal: listController.signal,
      });
    } finally { clearTimeout(listTimer); }
    if (!listResponse.ok) continue;
    const listPayload = await listResponse.json();
    deployment = (listPayload.deployments || [])[0] || null;
    if (deployment?.uid) break;
  }

  if (!deployment?.uid) throw new Error('No production deployment found to redeploy');

  const redeployUrl = vercelApiUrl(`/v13/deployments/${deployment.uid}/redeploy`);
  const redeployController = new AbortController();
  const redeployTimer = setTimeout(() => redeployController.abort(), 15000);
  let redeployResponse;
  try {
    redeployResponse = await fetch(redeployUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target: 'production' }),
      signal: redeployController.signal,
    });
  } finally { clearTimeout(redeployTimer); }

  if (!redeployResponse.ok) {
    const body = await redeployResponse.text().catch(() => '');
    throw new Error(`Redeploy failed: HTTP ${redeployResponse.status} ${body}`);
  }
}

function profileForMode(mode) {
  if (mode === 'phase2-conservative') {
    return {
      POLY_CLOB_ENABLED: 'false',
      POLY_CLOB_DRY_RUN: 'true',
      CONVERSION_ENGINE_ENABLED: 'false',
      CONVERSION_ENGINE_DRY_RUN: 'true',
      MIN_PAYOUT_ETH_POLYGON_MAINNET: '5',
      MIN_PAYOUT_GAS_MULTIPLIER_POLYGON_MAINNET: '60',
      GAS_RESERVE_ETH_POLYGON_MAINNET: '20',
      GAS_TOPUP_THRESHOLD_POLYGON_MAINNET: '20',
      GAS_TOPUP_AMOUNT_POLYGON_MAINNET: '0',
      SELF_SUSTAIN_REINVEST_BPS_POLYGON_MAINNET: '9800',
    };
  }

  return {
    POLY_CLOB_ENABLED: 'false',
    POLY_CLOB_DRY_RUN: 'true',
    CONVERSION_ENGINE_ENABLED: 'false',
    CONVERSION_ENGINE_DRY_RUN: 'true',
    MIN_PAYOUT_ETH_POLYGON_MAINNET: '10',
    MIN_PAYOUT_GAS_MULTIPLIER_POLYGON_MAINNET: '100',
    GAS_RESERVE_ETH_POLYGON_MAINNET: '100',
    GAS_TOPUP_THRESHOLD_POLYGON_MAINNET: '100',
    GAS_TOPUP_AMOUNT_POLYGON_MAINNET: '0',
    SELF_SUSTAIN_REINVEST_BPS_POLYGON_MAINNET: '9800',
  };
}

async function applyMode(mode) {
  const updates = profileForMode(mode);
  for (const [key, value] of Object.entries(updates)) {
    await upsertEnvVar(key, value);
  }
  if (AUTO_REDEPLOY) {
    try {
      await tryRedeployLatestProduction();
    } catch (error) {
      console.warn(`recovery-controller redeploy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function main() {
  if (!ENABLED) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'RECOVERY_CONTROLLER_ENABLED=false' }, null, 2));
    return;
  }

  const logsPayload = await fetchJson(`/api/alchemy/wallet/logs?limit=${LOG_LIMIT}`);
  const logs = Array.isArray(logsPayload?.logs) ? logsPayload.logs : [];
  const window = summarizeWindow(logs);

  const statePath = path.resolve(process.cwd(), STATE_FILE);
  const state = loadState(statePath);

  const nextPositiveStreak = window.isPositive ? state.positiveStreak + 1 : 0;
  let nextMode = 'safe';
  if (nextPositiveStreak >= POSITIVE_WINDOWS_REQUIRED) {
    nextMode = 'phase2-conservative';
  }

  let changed = false;
  if (nextMode !== state.mode) {
    await applyMode(nextMode);
    changed = true;
  }

  const nextState = {
    mode: nextMode,
    positiveStreak: nextPositiveStreak,
    lastUpdatedAt: Date.now(),
    lastWindow: {
      ...window,
      ts: new Date().toISOString(),
    },
  };

  saveState(statePath, nextState);

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        changed,
        fromMode: state.mode,
        toMode: nextMode,
        positiveStreak: nextPositiveStreak,
        requiredPositiveStreak: POSITIVE_WINDOWS_REQUIRED,
        window,
        stateFile: STATE_FILE,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
