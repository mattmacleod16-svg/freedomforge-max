#!/usr/bin/env node
/**
 * NEXUS Brain Cycle Runner
 * Runs every 5 minutes via Railway cron.
 * Fetches real market microstructure data and publishes to signal bus.
 */

const dotenv = require('dotenv');
const path   = require('path');
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

async function main() {
  try {
    const nexus = require('../lib/nexus-brain');
    console.log('[NEXUS] Starting cycle...');
    const result = await nexus.runNexusCycle();
    if (!result) { console.error('[NEXUS] Cycle returned null'); process.exit(1); }
    
    const top = result.signals.filter(s => s.side !== 'neutral' && s.confidence > 0.60).sort((a,b) => b.confidence - a.confidence);
    console.log(`[NEXUS] Cycle complete in ${result.cycleMs}ms`);
    console.log(`[NEXUS] Fear & Greed: ${result.fearGreed.value} (${result.fearGreed.label})`);
    console.log(`[NEXUS] BTC dominance: ${result.macro.btcDominance?.toFixed(1)}%`);
    console.log(`[NEXUS] High-conviction signals (${top.length}):`);
    top.slice(0, 5).forEach(s => {
      console.log(`  ${s.asset} ${s.side.toUpperCase()} | conf:${(s.confidence*100).toFixed(1)}% | ${s.thesis}`);
    });
    process.exit(0);
  } catch (e) {
    console.error('[NEXUS] FATAL:', e.message, e.stack);
    process.exit(1);
  }
}
main();
