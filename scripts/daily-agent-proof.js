/*
 * Daily proof-of-operation check for agent intelligence loop.
 *
 * Usage:
 *   APP_BASE_URL=https://freedomforge-max.vercel.app npm run daily-agent-proof
 */

const baseUrl = (process.env.APP_BASE_URL || 'https://freedomforge-max.vercel.app').replace(/\/$/, '');

async function getJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: response.status, data };
}

function formatCheck(ok, label, details) {
  return `${ok ? '✅' : '❌'} ${label}${details ? ` — ${details}` : ''}`;
}

function eventName(entry) {
  return entry?.type || entry?.event || 'unknown';
}

async function main() {
  const [status, wallet] = await Promise.all([
    getJson(`${baseUrl}/api/status`),
    getJson(`${baseUrl}/api/alchemy/wallet`),
  ]);

  const chat = await getJson(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'Give a concise 24h directional prediction for BTC and ETH with confidence and risk controls.',
      }),
    });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const logs = await getJson(`${baseUrl}/api/alchemy/wallet/logs?limit=300`);

  const logList = Array.isArray(logs.data?.logs) ? logs.data.logs : [];
  const recentEventNames = logList.slice(-25).map(eventName);
  const hasDecisionEvents = recentEventNames.some((name) => /ensemble_decision|xai_decision|autonomy_decision/.test(name));
  const hasForecastEvents = recentEventNames.some((name) => /forecast_created/.test(name));

  const modelsUsed = Array.isArray(chat.data?.metadata?.models_used) ? chat.data.metadata.models_used : [];
  const routingProfile = chat.data?.metadata?.routing_profile || {};

  const checks = [
    {
      label: 'Status ready',
      ok: status.status === 200 && status.data?.ready === true,
      details: `status=${status.status}`,
    },
    {
      label: 'Wallet configured',
      ok: wallet.status === 200 && !!wallet.data?.address,
      details: `status=${wallet.status}, recipients=${Array.isArray(wallet.data?.recipients) ? wallet.data.recipients.length : 0}`,
    },
    {
      label: 'Prediction chat responds',
      ok: chat.status === 200 && typeof chat.data?.reply === 'string' && chat.data.reply.length > 30,
      details: `status=${chat.status}, models=${modelsUsed.join(',') || 'none'}`,
    },
    {
      label: 'Routing profile emitted',
      ok: !!routingProfile.mode,
      details: `mode=${routingProfile.mode || 'none'}, escalated=${String(!!routingProfile.escalated)}`,
    },
    {
      label: 'Recent decision events present',
      ok: hasDecisionEvents,
      details: hasDecisionEvents ? 'decision events found' : 'no recent decision events',
    },
    {
      label: 'Recent forecast events present',
      ok: hasForecastEvents,
      details: hasForecastEvents ? 'forecast events found' : 'no recent forecast events',
    },
  ];

  console.log('=== FreedomForge Daily Agent Proof ===');
  console.log(`Base URL: ${baseUrl}`);
  console.log('');
  checks.forEach((check) => console.log(formatCheck(check.ok, check.label, check.details)));

  console.log('');
  console.log(`Recent events (last 8): ${logList.slice(-8).map(eventName).join(', ') || 'none'}`);
  console.log(`Prediction preview: ${(chat.data?.reply || '').slice(0, 160).replace(/\n+/g, ' ')}`);

  const passed = checks.every((check) => check.ok);
  console.log(`\nOverall: ${passed ? 'PASS ✅' : 'FAIL ❌'}`);
  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('daily-agent-proof failed', error);
  process.exit(1);
});
