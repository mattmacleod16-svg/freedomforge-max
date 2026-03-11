#!/usr/bin/env node

const baseUrl = process.env.APP_BASE_URL || 'https://freedomforge-max.vercel.app';
const adminKey = process.env.AUTONOMY_ADMIN_KEY || '';

async function call(path, method = 'POST', body) {
  const headers = { 'Content-Type': 'application/json' };
  if (adminKey) headers['x-autonomy-key'] = adminKey;
  if (process.env.ALERT_SECRET) headers['x-api-secret'] = process.env.ALERT_SECRET;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res;
  let text;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    text = await res.text();
  } finally {
    clearTimeout(timer);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`${path} failed with ${res.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function main() {
  console.log(`Autonomy maintenance against ${baseUrl}`);

  const groundTruth = await call('/api/status/autonomy/ground-truth', 'POST');
  const retrain = await call('/api/status/autonomy/retrain', 'POST', { reason: 'scheduled_maintenance' });
  const status = await call('/api/status/autonomy', 'GET');

  console.log(
    JSON.stringify(
      {
        groundTruthIngested: groundTruth?.ingested?.length || 0,
        retrain,
        approvalMode: status?.autonomy?.governance?.approvalPolicy?.mode,
        recentConfidence: status?.autonomy?.recentConfidence,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('Autonomy maintenance failed:', err.message || err);
  process.exit(1);
});
