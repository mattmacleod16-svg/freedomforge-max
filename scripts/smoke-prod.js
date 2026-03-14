/*
 * Production smoke test for payout runtime.
 *
 * Usage:
 *   APP_BASE_URL=https://freedomforge-max.up.railway.app npm run smoke:prod
 */

const baseUrl = (process.env.APP_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'https://freedomforge-max.up.railway.app').replace(/\/$/, '');
const shard = process.env.SMOKE_SHARD || '0';
const shards = process.env.SMOKE_SHARDS || '1';
const botId = process.env.SMOKE_BOT_ID || `smoke-${Date.now()}`;

async function getJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: response.status, data };
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.ALERT_SECRET ? { 'x-api-secret': process.env.ALERT_SECRET } : {}) },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: response.status, data };
}

async function main() {
  const health = await getJson(`${baseUrl}/api/alchemy/health`);
  const distribution = await postJson(
    `${baseUrl}/api/alchemy/wallet/distribute`,
    { shard: parseInt(shard, 10), shards: parseInt(shards, 10), botId }
  );
  const wallet = await getJson(`${baseUrl}/api/alchemy/wallet`);

  const output = {
    baseUrl,
    botId,
    healthStatus: health.status,
    healthBody: health.data,
    distributionStatus: distribution.status,
    distributionBody: distribution.data,
    walletStatus: wallet.status,
    walletSummary: {
      address: wallet.data?.address || null,
      balanceWei: wallet.data?.balance || null,
      recipientsCount: Array.isArray(wallet.data?.recipients) ? wallet.data.recipients.length : null,
      generated: wallet.data?.generated ?? null,
    },
  };

  console.log(JSON.stringify(output, null, 2));

  if (health.status !== 200 || distribution.status >= 400 || wallet.status !== 200) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('smoke:prod failed', error);
  process.exit(1);
});
