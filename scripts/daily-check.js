/*
 * Daily operational check (no extra infra required)
 *
 * Usage:
 *   APP_BASE_URL=https://freedomforge-max.vercel.app npm run daily-check
 *
 * Optional env:
 *   DAILY_MIN_TRANSFER_SUCCESS_RATE=0.80
 *   DAILY_MAX_TOPUP_ERRORS=0
 */

const baseUrl = (process.env.APP_BASE_URL || 'https://freedomforge-max.vercel.app').replace(/\/$/, '');
const minTransferSuccessRate = Number(process.env.DAILY_MIN_TRANSFER_SUCCESS_RATE || '0.80');
const maxTopupErrors = parseInt(process.env.DAILY_MAX_TOPUP_ERRORS || '0', 10);
const botId = `daily-${Date.now()}`;

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(url, body = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function statusLine(ok, label, details = '') {
  const marker = ok ? '✅' : '❌';
  return `${marker} ${label}${details ? ` — ${details}` : ''}`;
}

async function main() {
  const results = await Promise.allSettled([
    getJson(`${baseUrl}/api/alchemy/health`),
    postJson(`${baseUrl}/api/alchemy/wallet/distribute`, { shard: 0, shards: 1, botId }),
    getJson(`${baseUrl}/api/alchemy/wallet`),
    getJson(`${baseUrl}/api/alchemy/wallet/alerts`),
    getJson(`${baseUrl}/api/status/metrics?format=json`),
  ]);
  const [health, distribution, wallet, alert, metrics] = results.map(r => r.status === 'fulfilled' ? r.value : { status: 0, data: null });

  const transferSuccessRate = Number(metrics.data?.transferSuccessRate ?? 1);
  const topupErrors = Number(metrics.data?.topupErrorCount ?? 0);
  const walletBalanceWei = String(wallet.data?.balance || '0');

  const checks = [
    {
      label: 'Health endpoint',
      ok: health.status === 200 && health.data?.status === 'ok',
      details: `status=${health.status}`,
    },
    {
      label: 'Distribution endpoint',
      ok: distribution.status === 200,
      details: `status=${distribution.status}`,
    },
    {
      label: 'Wallet endpoint',
      ok: wallet.status === 200 && !!wallet.data?.address,
      details: `status=${wallet.status}, balanceWei=${walletBalanceWei}`,
    },
    {
      label: 'Metrics endpoint',
      ok: metrics.status === 200,
      details: `status=${metrics.status}`,
    },
    {
      label: 'Transfer success rate',
      ok: transferSuccessRate >= minTransferSuccessRate,
      details: `${(transferSuccessRate * 100).toFixed(1)}% (min ${(minTransferSuccessRate * 100).toFixed(1)}%)`,
    },
    {
      label: 'Topup error count',
      ok: topupErrors <= maxTopupErrors,
      details: `${topupErrors} (max ${maxTopupErrors})`,
    },
  ];

  console.log('=== FreedomForge Daily Check ===');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Bot ID: ${botId}`);
  console.log('');

  for (const check of checks) {
    console.log(statusLine(check.ok, check.label, check.details));
  }

  const latestAlertMsg = alert.data?.alert?.message;
  if (latestAlertMsg) {
    console.log(`\n⚠️ Latest alert: ${latestAlertMsg}`);
  }

  const allPassed = checks.every((c) => c.ok);
  console.log(`\nOverall: ${allPassed ? 'PASS ✅' : 'FAIL ❌'}`);

  if (!allPassed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('daily-check failed', error);
  process.exit(1);
});
