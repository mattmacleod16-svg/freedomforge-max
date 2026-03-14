/*
 * X growth automation runner
 *
 * Dry-run by default. Set X_DRY_RUN=false to actually post.
 *
 * Env:
 * - APP_BASE_URL (default production URL)
 * - X_AUTOMATION_SECRET (optional if API protected)
 * - X_DRY_RUN=true|false
 * - X_FORCE=true|false
 * - X_TREND_HINT (optional topic override)
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const baseUrl = (process.env.APP_BASE_URL || 'https://freedomforge-max.up.railway.app').replace(/\/$/, '');
const endpoint = `${baseUrl}/api/x/automation`;
const secret = process.env.X_AUTOMATION_SECRET || '';
const dryRun = String(process.env.X_DRY_RUN || 'true').toLowerCase() !== 'false';
const force = String(process.env.X_FORCE || 'false').toLowerCase() === 'true';
const trend = (process.env.X_TREND_HINT || '').trim();

async function main() {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (secret) {
    headers['x-x-automation-secret'] = secret;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ dryRun, force, trend: trend || undefined }),
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`X growth failed ${response.status}: ${JSON.stringify(payload)}`);
  }

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error('x-growth script failed:', error.message || error);
  process.exit(1);
});
