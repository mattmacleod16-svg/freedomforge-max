#!/usr/bin/env node
/**
 * ff-zombie-cleanup.js — Force-close trades with missing data (no entryPrice, no ts, exotic venues).
 * Run once to clear stale zombies, then the reconciler's safety valve handles future ones.
 */
const fs = require('fs');
const path = require('path');

const JOURNAL_PATH = path.resolve(__dirname, '..', 'data', 'trade-journal.json');

function main() {
  const raw = fs.readFileSync(JOURNAL_PATH, 'utf8');
  const journal = JSON.parse(raw);
  const trades = journal.trades || [];

  let cleaned = 0;
  const now = Date.now();

  for (const t of trades) {
    if (t.closedAt || t.outcome) continue; // already closed

    const isZombie =
      !t.entryPrice ||
      !Number.isFinite(t.ts) ||
      !t.ts ||
      t.venue === 'coinbase_futures' ||
      t.venue === 'kraken_event';

    if (isZombie) {
      t.closedAt = now;
      t.outcome = t.pnl > 0 ? 'win' : (t.pnl < 0 ? 'loss' : 'loss');
      t.pnl = t.pnl || 0;
      t.closeReason = 'zombie-cleanup: missing data';
      t.exitPrice = t.entryPrice || 0;
      cleaned++;
      console.log(`  Closed zombie: ${t.asset} ${t.side} venue=${t.venue} entry=${t.entryPrice || 'NONE'}`);
    }
  }

  if (cleaned > 0) {
    fs.writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, 2));
    console.log(`\nCleaned ${cleaned} zombie trades.`);
  } else {
    console.log('No zombie trades found.');
  }
}

main();
