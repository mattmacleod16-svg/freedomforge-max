#!/usr/bin/env node

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.vercel.app').replace(/\/$/, '');

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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

function formatEth(wei) {
  const value = Number(wei || 0) / 1e18;
  return `${value.toFixed(6)} ETH`;
}

function latestTransfer(logs) {
  return (logs || []).find((item) => item.type === 'transfer') || null;
}

function buildSummary({ wallet, logs, xStatus }) {
  const transfer = latestTransfer(logs?.logs || []);
  const guards = xStatus?.guards || {};
  const lines = [
    'FreedomForge morning summary',
    `Wallet: ${wallet?.address || 'n/a'}`,
    `Balance: ${formatEth(wallet?.balance)}`,
    `Recipient: ${(wallet?.recipients || [])[0] || 'n/a'}`,
  ];

  if (transfer) {
    lines.push(`Last payout: ${formatEth(transfer.payload?.amount)} -> ${transfer.payload?.to}`);
    lines.push(`Tx: ${transfer.payload?.txHash}`);
  } else {
    lines.push('Last payout: none logged');
  }

  lines.push(`X canPost: ${Boolean(guards.canPost)} | cooldownOk: ${Boolean(guards.cooldownOk)} | dailyLimitOk: ${Boolean(guards.dailyLimitOk)}`);
  lines.push(`As of: ${new Date().toISOString()}`);

  const body = lines.join('\n');
  const maxLength = Number(process.env.SMS_MAX_LEN || 1200);
  return body.length > maxLength ? `${body.slice(0, maxLength - 14)}\n...(trimmed)` : body;
}

async function sendSms(body) {
  const accountSid = required('TWILIO_ACCOUNT_SID');
  const authToken = required('TWILIO_AUTH_TOKEN');
  const from = required('TWILIO_FROM_NUMBER');
  const to = required('TWILIO_TO_NUMBER');

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const params = new URLSearchParams();
  params.set('To', to);
  params.set('From', from);
  params.set('Body', body);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Twilio send failed: HTTP ${response.status} ${text}`);
  }

  const payload = JSON.parse(text);
  console.log(`SMS accepted: sid=${payload.sid} status=${payload.status}`);
  return { sid: payload.sid, accountSid, authToken };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalStatus(status) {
  return ['delivered', 'failed', 'undelivered'].includes(status);
}

async function fetchTwilioMessageStatus({ accountSid, authToken, sid }) {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${sid}.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Twilio status check failed: HTTP ${response.status} ${text}`);
  }

  return JSON.parse(text);
}

async function waitForDeliveryStatus(params) {
  const timeoutMs = Number(process.env.SMS_DELIVERY_TIMEOUT_MS || 120000);
  const intervalMs = Number(process.env.SMS_DELIVERY_POLL_MS || 5000);
  const started = Date.now();
  let lastStatus = 'unknown';

  while (Date.now() - started <= timeoutMs) {
    const message = await fetchTwilioMessageStatus(params);
    const status = String(message.status || 'unknown').toLowerCase();
    lastStatus = status;
    console.log(`SMS delivery check: sid=${params.sid} status=${status}`);

    if (isTerminalStatus(status)) {
      if (status === 'delivered') {
        return;
      }
      const code = message.error_code || 'n/a';
      const error = message.error_message || 'n/a';
      throw new Error(`SMS delivery ${status}: sid=${params.sid} code=${code} message=${error}`);
    }

    await sleep(intervalMs);
  }

  throw new Error(`SMS delivery status timeout: sid=${params.sid} lastStatus=${lastStatus} timeoutMs=${timeoutMs}`);
}

async function main() {
  const [wallet, logs, xStatus] = await Promise.all([
    fetchJson('/api/alchemy/wallet'),
    fetchJson('/api/alchemy/wallet/logs?limit=30'),
    fetchJson('/api/status/x'),
  ]);

  const body = buildSummary({ wallet, logs, xStatus });
  const sendResult = await sendSms(body);
  await waitForDeliveryStatus(sendResult);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
