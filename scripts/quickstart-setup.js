#!/usr/bin/env node
/**
 * FreedomForge Quick-Start Setup
 * ═══════════════════════════════
 *
 * Helps new users configure their own FreedomForge instance in minutes.
 * Sets up wallet address, payout preferences, and recommended env vars.
 *
 * Usage:
 *   node scripts/quickstart-setup.js --wallet 0xYOUR_WALLET --payout-pct 25
 *
 * Options:
 *   --wallet          Owner wallet address (required)
 *   --payout-pct      Minimum owner payout % (default: 25, range: 25-50)
 *   --escalation-days Days between payout escalation bumps (default: 30)
 *   --escalation-pct  Payout % increase per escalation (default: 2)
 *   --reinvest-bps    Global reinvest BPS (default: 2000 = 20%)
 *   --dry-run         Print config without writing (default: false)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PAYOUT_STATE_FILE = path.join(DATA_DIR, 'payout-state.json');
const ENV_FILE = path.resolve(process.cwd(), '.env.local');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--wallet' && args[i + 1]) opts.wallet = args[++i];
    else if (arg === '--payout-pct' && args[i + 1]) opts.payoutPct = Number(args[++i]);
    else if (arg === '--escalation-days' && args[i + 1]) opts.escalationDays = Number(args[++i]);
    else if (arg === '--escalation-pct' && args[i + 1]) opts.escalationPct = Number(args[++i]);
    else if (arg === '--reinvest-bps' && args[i + 1]) opts.reinvestBps = Number(args[++i]);
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--help' || arg === '-h') { printUsage(); process.exit(0); }
  }
  return opts;
}

function printUsage() {
  console.log(`
FreedomForge Quick-Start Setup
==============================

Usage:
  node scripts/quickstart-setup.js --wallet 0xYOUR_WALLET [options]

Required:
  --wallet          Your EVM wallet address (0x...)

Options:
  --payout-pct      Minimum owner payout % (default: 25, range: 25-50)
  --escalation-days Days between payout escalation bumps (default: 30)
  --escalation-pct  Payout % increase per escalation (default: 2)
  --reinvest-bps    Global reinvest BPS (default: 2000 = 20%)
  --dry-run         Print config without writing

Example:
  node scripts/quickstart-setup.js --wallet 0xABC123... --payout-pct 30 --reinvest-bps 1800
`);
}

function validateWallet(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function main() {
  const opts = parseArgs();

  if (!opts.wallet) {
    console.error('Error: --wallet is required. Run with --help for usage.');
    process.exit(1);
  }
  if (!validateWallet(opts.wallet)) {
    console.error('Error: Invalid wallet address. Must be 0x followed by 40 hex characters.');
    process.exit(1);
  }

  const payoutPct = Math.max(25, Math.min(50, opts.payoutPct || 25));
  const escalationDays = Math.max(7, Math.min(180, opts.escalationDays || 30));
  const escalationPct = Math.max(1, Math.min(5, opts.escalationPct || 2));
  const reinvestBps = Math.max(1200, Math.min(5000, opts.reinvestBps || 2000));

  // Build payout state
  const payoutState = {
    payoutPct,
    payoutPctFloor: payoutPct,
    consecutiveProfitDays: 0,
    currentEscalationPct: 0,
    escalationEnabled: true,
    escalationRules: {
      profitStreakDaysForEscalation: escalationDays,
      escalationIncrementPct: escalationPct,
    },
    payoutHistory: [],
    wallet: opts.wallet,
    updatedAt: new Date().toISOString(),
  };

  // Build env overrides
  const envLines = [
    `# FreedomForge Quick-Start Config`,
    `# Generated: ${new Date().toISOString()}`,
    `# Owner: ${opts.wallet}`,
    ``,
    `# Owner payout`,
    `MIN_OWNER_PAYOUT_PCT=${payoutPct}`,
    ``,
    `# Reinvestment (lower = more to owner)`,
    `SELF_SUSTAIN_REINVEST_BPS=${reinvestBps}`,
    `SELF_SUSTAIN_REINVEST_BPS_ETH_MAINNET=${Math.min(reinvestBps + 500, 5000)}`,
    `SELF_SUSTAIN_REINVEST_BPS_OPT_MAINNET=${reinvestBps}`,
    `SELF_SUSTAIN_REINVEST_BPS_ARB_MAINNET=${reinvestBps}`,
    `SELF_SUSTAIN_REINVEST_BPS_POLYGON_MAINNET=${Math.max(reinvestBps - 500, 1200)}`,
    ``,
    `# Payout recipient`,
    `OWNER_WALLET=${opts.wallet}`,
  ];

  console.log('\n=== FreedomForge Quick-Start Configuration ===\n');
  console.log(`Wallet:           ${opts.wallet}`);
  console.log(`Payout Floor:     ${payoutPct}%`);
  console.log(`Escalation:       +${escalationPct}% every ${escalationDays} consecutive profit days`);
  console.log(`Reinvest BPS:     ${reinvestBps} (${(reinvestBps / 100).toFixed(0)}% reinvested)`);
  console.log(`Owner receives:   ${100 - reinvestBps / 100}% of post-reserve revenue\n`);

  // Escalation timeline preview
  console.log('Payout escalation timeline:');
  for (let i = 0; i <= 5; i++) {
    const days = i * escalationDays;
    const pct = payoutPct + i * escalationPct;
    const cappedPct = Math.min(pct, 50);
    console.log(`  Day ${String(days).padStart(4)}: ${cappedPct}%${cappedPct >= 50 ? ' (cap)' : ''}`);
  }
  console.log('');

  if (opts.dryRun) {
    console.log('[DRY RUN] Would write:\n');
    console.log(`--- ${PAYOUT_STATE_FILE} ---`);
    console.log(JSON.stringify(payoutState, null, 2));
    console.log(`\n--- .env.local additions ---`);
    console.log(envLines.join('\n'));
    return;
  }

  // Write payout state
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = PAYOUT_STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payoutState, null, 2));
  fs.renameSync(tmp, PAYOUT_STATE_FILE);
  console.log(`Wrote: ${PAYOUT_STATE_FILE}`);

  // Append to .env.local (don't overwrite existing)
  const envContent = '\n' + envLines.join('\n') + '\n';
  fs.appendFileSync(ENV_FILE, envContent);
  console.log(`Appended to: ${ENV_FILE}`);

  console.log('\nSetup complete! Your FreedomForge instance is configured for maximum owner payout.');
  console.log('Next steps:');
  console.log('  1. Add your exchange API keys to .env.local (COINBASE_API_KEY, KRAKEN_API_KEY, etc.)');
  console.log('  2. Fund your trading wallet with starting capital');
  console.log('  3. Deploy: npm run deploy (or push to your hosting platform)');
  console.log('  4. Monitor: check the /api/status endpoint for system health\n');
}

main();
