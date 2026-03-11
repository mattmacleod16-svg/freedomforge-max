#!/usr/bin/env node
/**
 * ff-zombie-cleanup.js — Force-close trades with missing data (no entryPrice, no ts, exotic venues).
 * Run once to clear stale zombies, then the reconciler's safety valve handles future ones.
 */
const fs = require('fs');
const path = require('path');

let rio;
try { rio = require('../lib/resilient-io'); } catch { rio = null; }

const JOURNAL_PATH = path.resolve(__dirname, '..', 'data', 'trade-journal.json');

function main() {
  let release;
  try {
    release = rio ? rio.acquireLock(JOURNAL_PATH) : null;
  } catch (e) {
    console.error('[zombie-cleanup] Failed to acquire journal lock:', e.message);
    process.exit(1);
  }

  try {
    let journal;
    if (rio) {
      journal = rio.readJsonSafe(JOURNAL_PATH, { fallback: null });
    } else {
      journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'));
    }
    if (!journal) {
      console.error('[zombie-cleanup] Journal file unreadable or missing');
      return;
    }
    const trades = journal.trades || [];

    let cleaned = 0;
    const now = Date.now();

    for (const t of trades) {
      if (t.closedAt || t.outcome) continue; // already closed

      const isZombie =
        !t.entryPrice ||
        !Number.isFinite(t.ts) ||
        !t.ts;

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
      if (rio) { rio.writeJsonAtomic(JOURNAL_PATH, journal); }
      else {
        const tmp = JOURNAL_PATH + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(journal, null, 2));
        fs.renameSync(tmp, JOURNAL_PATH);
      }
      console.log(`\nCleaned ${cleaned} zombie trades.`);
    } else {
      console.log('No zombie trades found.');
    }
  } catch (e) {
    console.error('[zombie-cleanup] Error:', e.message);
    process.exit(1);
  } finally {
    if (release) release();
  }
}

main();
