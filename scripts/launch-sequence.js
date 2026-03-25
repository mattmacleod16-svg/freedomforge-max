#!/usr/bin/env node
/**
 * launch-sequence.js
 * ═══════════════════════════════════════════════════════════════════
 * Coordinated FreedomForge Max launch orchestrator.
 *
 * Executes the full public launch in the correct order:
 *   1.  Verify all environments are healthy (sync:all)
 *   2.  Deploy 5 TaskMasters (taskmasters:deploy)
 *   3.  Report token launch status across all chains (token:verify)
 *   4.  Package the marketing kit (marketing:package)
 *   5.  Trigger X/Twitter automation post (dry-run by default)
 *   6.  Send Discord launch announcement
 *   7.  Print full launch report
 *
 * Usage:
 *   node scripts/launch-sequence.js          # dry-run (safe)
 *   node scripts/launch-sequence.js --live   # real X post + Discord
 *   npm run launch:sequence
 *   npm run launch:sequence:live
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const IS_LIVE   = process.argv.includes('--live');
const ABORT_ON_UNHEALTHY = process.argv.includes('--strict');

const APP_BASE_URL = (
  process.env.APP_BASE_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : 'https://freedomforge.one')
).replace(/\/$/, '');

const TIMEOUT_MS = 8000;
const ts = () => new Date().toISOString();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function banner(text) {
  const line = '═'.repeat(62);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(line);
}

function step(n, total, label) {
  console.log(`\n[${ts()}] Step ${n}/${total}: ${label}`);
}

function runScript(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    timeout: 120_000,
  });
  return result.status === 0;
}

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ─── Step functions ───────────────────────────────────────────────────────────

async function stepSyncCheck() {
  const healthy = runScript(path.resolve(process.cwd(), 'scripts/sync-all-environments.js'));
  if (!healthy && ABORT_ON_UNHEALTHY) {
    console.error('\n❌ Environment sync check failed. Aborting launch (--strict mode).');
    process.exit(1);
  }
  return healthy;
}

function stepTaskmasters() {
  return runScript(path.resolve(process.cwd(), 'scripts/deploy-taskmasters.js'));
}

function stepTokenVerify() {
  return runScript(path.resolve(process.cwd(), 'scripts/verify-token-launch.js'));
}

function stepMarketingKit() {
  const kitScript = path.resolve(process.cwd(), 'scripts/package-marketing-kit.js');
  const { existsSync } = require('fs');
  if (!existsSync(kitScript)) {
    console.log('  ⚠️  Marketing kit script not found — skipping');
    return false;
  }
  return runScript(kitScript);
}

async function stepXAutomation() {
  const secret = process.env.X_AUTOMATION_SECRET || process.env.ALERT_SECRET;
  const dryRun = !IS_LIVE;

  console.log(`  Mode: ${dryRun ? 'DRY-RUN (no actual post)' : '🔴 LIVE — posting to X'}`);

  try {
    const res = await fetchWithTimeout(`${APP_BASE_URL}/api/x/automation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'x-api-secret': secret } : {}),
      },
      body: JSON.stringify({
        dryRun,
        context: 'launch_announcement',
        trendHint: 'AI financial freedom autonomous intelligence',
      }),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      console.log(`  ✅ X automation ${dryRun ? '(dry-run)' : 'LIVE'} — ${JSON.stringify(data).slice(0, 100)}`);
      return true;
    } else {
      console.log(`  ⚠️  X automation HTTP ${res.status} — may need X API keys configured`);
      return false;
    }
  } catch (err) {
    console.log(`  ⚠️  X automation unreachable: ${err.message}`);
    return false;
  }
}

async function stepDiscordAnnounce(results) {
  const webhook = process.env.ALERT_WEBHOOK_URL || process.env.DISCORD_ALERT_WEBHOOK;
  if (!webhook) {
    console.log('  ⚠️  ALERT_WEBHOOK_URL not set — skipping Discord announcement');
    return false;
  }
  if (!IS_LIVE) {
    console.log('  ℹ️  Dry-run mode — Discord announcement skipped (use --live to send)');
    return false;
  }

  const statusLines = Object.entries(results)
    .map(([k, v]) => `• ${k}: ${v ? '✅' : '⚠️'}`)
    .join('\n');

  const body = {
    embeds: [{
      title: '🚀 FreedomForge Max — Launch Sequence Complete',
      color: 3066993, // green
      description: `The world's first open-source Autonomous Intelligence Stack is live.`,
      fields: [
        { name: 'Live URL', value: APP_BASE_URL, inline: true },
        { name: 'Step Results', value: statusLines, inline: false },
        { name: 'Chains', value: 'Ethereum • Base • Solana • MultiversX + 9 more', inline: false },
      ],
      timestamp: ts(),
      footer: { text: 'FreedomForge Max · launch-sequence' },
    }],
  };

  try {
    await fetchWithTimeout(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    console.log('  ✅ Discord launch announcement sent');
    return true;
  } catch (err) {
    console.log(`  ⚠️  Discord send failed: ${err.message}`);
    return false;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  banner('FreedomForge Max — Launch Sequence');
  console.log(`  Target  : ${APP_BASE_URL}`);
  console.log(`  Mode    : ${IS_LIVE ? '🔴 LIVE' : '🟡 DRY-RUN (pass --live to go live)'}`);
  console.log(`  Date    : ${ts()}`);

  const STEPS = 7;
  const results = {};

  step(1, STEPS, 'Environment Sync Check');
  results.sync = await stepSyncCheck();

  step(2, STEPS, 'Deploy TaskMasters');
  results.taskmasters = stepTaskmasters();

  step(3, STEPS, 'Token Launch Status');
  results.token = stepTokenVerify();

  step(4, STEPS, 'Package Marketing Kit');
  results.marketing = stepMarketingKit();

  step(5, STEPS, `X/Twitter Automation${IS_LIVE ? ' (LIVE)' : ' (dry-run)'}`);
  results.x_automation = await stepXAutomation();

  step(6, STEPS, `Discord Launch Announcement${IS_LIVE ? ' (LIVE)' : ' (dry-run)'}`);
  results.discord = await stepDiscordAnnounce(results);

  step(7, STEPS, 'Launch Report');

  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;

  banner(`Launch Report — ${passed}/${total} steps completed`);
  for (const [k, v] of Object.entries(results)) {
    console.log(`  ${v ? '✅' : '⚠️ '} ${k}`);
  }

  console.log('\n  Live URLs:');
  console.log(`    App      : ${APP_BASE_URL}`);
  console.log(`    Advisor  : ${APP_BASE_URL}/advisor`);
  console.log(`    Dashboard: ${APP_BASE_URL}/dashboard`);
  console.log(`    Token    : ${APP_BASE_URL}/token`);
  console.log(`    Health   : ${APP_BASE_URL}/api/health`);

  console.log('\n  Next Steps:');
  console.log('    1. Set WALLET_PRIVATE_KEY + ALCHEMY_API_KEY');
  console.log('    2. npm run contract:deploy:sepolia    (testnet first)');
  console.log('    3. npm run contract:deploy:ethereum   (mainnet)');
  console.log('    4. npm run launch:multichain:live     (Solana + MultiversX)');
  console.log('    5. npm run launch:sequence:live       (go fully live)');
  console.log('═'.repeat(62));

  process.exit(passed < total * 0.5 ? 1 : 0);
})();
