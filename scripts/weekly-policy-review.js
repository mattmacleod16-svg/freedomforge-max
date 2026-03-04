#!/usr/bin/env node

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.vercel.app').replace(/\/$/, '');
const LOOKBACK_HOURS = Number(process.env.POLICY_LOOKBACK_HOURS || 168);
const AUTO_REDEPLOY = String(process.env.POLICY_AUTO_REDEPLOY || 'true').toLowerCase() === 'true';

const VERCEL_TOKEN = process.env.VERCEL_TOKEN || '';
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || '';
const VERCEL_PROJECT_SLUG = process.env.VERCEL_PROJECT_SLUG || 'freedomforge-max';
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || '';

function required(name, value) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
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
  const response = await fetch(`${APP_BASE_URL}${path}`, {
    headers: { 'content-type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed ${path}: HTTP ${response.status}`);
  }
  return response.json();
}

function computePolicy({ balanceEth, transferredEth }) {
  const generatedEth = balanceEth + transferredEth;

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

function vercelApiUrl(path) {
  const base = `https://api.vercel.com${path}`;
  if (!VERCEL_TEAM_ID) return base;
  const joiner = path.includes('?') ? '&' : '?';
  return `${base}${joiner}teamId=${encodeURIComponent(VERCEL_TEAM_ID)}`;
}

function candidateProjectRefs() {
  const refs = [VERCEL_PROJECT_ID, VERCEL_PROJECT_SLUG]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return [...new Set(refs)];
}

async function upsertEnvVar(key, value) {
  let lastError = null;
  for (const projectRef of candidateProjectRefs()) {
    const url = vercelApiUrl(`/v10/projects/${encodeURIComponent(projectRef)}/env?upsert=true`);
    const response = await fetch(url, {
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
    });

    if (response.ok) {
      return;
    }

    const body = await response.text().catch(() => '');
    lastError = `project=${projectRef} status=${response.status} body=${body}`;
    if (response.status !== 404) {
      break;
    }
  }

  throw new Error(`Vercel env upsert failed for ${key}: ${lastError || 'unknown error'}`);
}

async function tryRedeployLatestProduction() {
  let deployment = null;
  let lastError = null;

  for (const projectRef of candidateProjectRefs()) {
    const listUrl = vercelApiUrl(`/v6/deployments?projectId=${encodeURIComponent(projectRef)}&target=production&limit=1`);
    const listResponse = await fetch(listUrl, {
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!listResponse.ok) {
      const body = await listResponse.text().catch(() => '');
      lastError = `project=${projectRef} status=${listResponse.status} body=${body}`;
      if (listResponse.status === 404) {
        continue;
      }
      break;
    }

    const listPayload = await listResponse.json();
    deployment = (listPayload.deployments || [])[0] || null;
    if (deployment?.uid) {
      break;
    }
    lastError = `project=${projectRef} had no production deployment`; 
  }

  if (!deployment?.uid) {
    throw new Error(`No production deployment found to redeploy (${lastError || 'unknown'})`);
  }

  const redeployUrl = vercelApiUrl(`/v13/deployments/${deployment.uid}/redeploy`);
  const redeployResponse = await fetch(redeployUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ target: 'production' }),
  });

  if (!redeployResponse.ok) {
    const body = await redeployResponse.text().catch(() => '');
    throw new Error(`Redeploy failed: HTTP ${redeployResponse.status} ${body}`);
  }

  const payload = await redeployResponse.json();
  const url = payload?.url ? `https://${payload.url}` : 'n/a';
  console.log(`Redeploy requested: ${url}`);
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

async function main() {
  required('VERCEL_TOKEN', VERCEL_TOKEN);
  if (candidateProjectRefs().length === 0) {
    throw new Error('Missing both VERCEL_PROJECT_ID and VERCEL_PROJECT_SLUG');
  }

  const [wallet, walletLogs] = await Promise.all([
    fetchJson('/api/alchemy/wallet'),
    fetchJson('/api/alchemy/wallet/logs?limit=3000'),
  ]);

  const balanceEth = toEthNumber(wallet.balance);
  const transferredEth = sumTransfersWithinLookback(walletLogs.logs, LOOKBACK_HOURS);
  const policy = computePolicy({ balanceEth, transferredEth });
  const treasuryMaxReinvestBps = Math.min(9500, policy.reinvestBps + 500);

  console.log(`Weekly policy review: balance=${toEthString(wallet.balance)} ETH transferred_${LOOKBACK_HOURS}h=${transferredEth.toFixed(6)} ETH`);
  console.log(`Selected policy: reinvest=${policy.reinvestBps} minPayout=${policy.minPayoutEth} treasuryTarget=${policy.treasuryTargetEth}`);
  console.log(`Reason: ${policy.reason}`);

  await upsertEnvVar('SELF_SUSTAIN_REINVEST_BPS', String(policy.reinvestBps));
  await upsertEnvVar('TREASURY_MAX_REINVEST_BPS', String(treasuryMaxReinvestBps));
  await upsertEnvVar('TREASURY_TARGET_ETH', policy.treasuryTargetEth);
  await upsertEnvVar('MIN_PAYOUT_ETH', policy.minPayoutEth);

  console.log('Vercel production env updated for weekly policy tuning.');

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
