/**
 * Mining Pool Poller
 *
 * Fetches live data from all configured mining pools and writes to:
 *   data/mining-state.json
 *
 * Run as: npx tsx scripts/mining-poller.ts
 * Called by: nightly optimizer + empire API (on demand)
 */

import { fetchAllPools } from '../lib/mining/pools';
import fs from 'fs';
import path from 'path';

const STATE_FILE = path.resolve(process.cwd(), 'data/mining-state.json');

async function main() {
  console.log('[mining-poller] Fetching pool data...');
  
  try {
    const result = await fetchAllPools();
    
    // Write state
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...result, ts: Date.now() }, null, 2));
    
    console.log(`[mining-poller] ✓ ${result.summary}`);
    for (const pool of result.pools) {
      if (pool.status === 'connected') {
        console.log(`  ${pool.pool}: $${pool.estimatedDailyUsd.toFixed(2)}/day · ${pool.workers} workers · ${pool.unpaidUsd.toFixed(2)} USD unpaid`);
      } else if (pool.status === 'no_config') {
        console.log(`  ${pool.pool}: no API keys configured`);
      } else {
        console.log(`  ${pool.pool}: ERROR — ${pool.error}`);
      }
    }
  } catch (e) {
    console.error('[mining-poller] Fatal:', e);
  }
}

main();
