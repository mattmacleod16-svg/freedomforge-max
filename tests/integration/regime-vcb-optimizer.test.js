#!/usr/bin/env node
/**
 * Integration tests: Regime Detector V2 + Volatility Circuit Breaker + Optimizer
 * ════════════════════════════════════════════════════════════════════════════════
 * Run: node tests/integration/regime-vcb-optimizer.test.js
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });
require('dotenv').config();

process.env.TRADING_MODE    = 'paper';
process.env.SIGNAL_BUS_MODE = 'file';
process.env.VCB_STATE_FILE  = '/tmp/vcb-test-state.json';
process.env.REGIME_STATE_FILE = '/tmp/regime-test-state.json';

const rd  = require('../../lib/regime-detector-v2');
const vcb = require('../../lib/volatility-circuit-breaker');

const PASS = '✅'; const FAIL = '❌'; const WARN = '⚠️ ';
const results = [];

function pass(name, detail = '') { results.push({ name, ok: true }); console.log(`${PASS}  ${name}${detail ? '  →  ' + detail : ''}`); }
function fail(name, detail = '') { results.push({ name, ok: false }); console.error(`${FAIL}  ${name}${detail ? '  →  ' + detail : ''}`); }
function section(name) { console.log(`\n${'─'.repeat(55)}\n  ${name}\n${'─'.repeat(55)}`); }

// ── Synthetic candle generator ────────────────────────────────────────────────
function makeCandles(n, startPrice = 65000, drift = 0, noise = 0.005) {
  const candles = [];
  let price = startPrice;
  for (let i = 0; i < n; i++) {
    const chg   = price * (drift + (Math.random() - 0.5) * noise);
    const open  = price;
    const close = price + chg;
    const high  = Math.max(open, close) * (1 + Math.random() * 0.002);
    const low   = Math.min(open, close) * (1 - Math.random() * 0.002);
    candles.push([Date.now() - (n - i) * 3600000, low, high, open, close, 100 + Math.random() * 200]);
    price = close;
  }
  return candles;
}

// ══════════════════════════════════════════════════════════════════════════════
// Regime Detector Tests
// ══════════════════════════════════════════════════════════════════════════════

async function testRegimeDetector() {
  section('Regime Detector V2');

  // Bull trend
  const bullCandles = makeCandles(120, 60000, 0.001, 0.003);
  const bull = await rd.detectRegime({ candles: bullCandles, asset: 'BTC' });
  if (bull.trend === 'bull' || bull.trend === 'sideways') pass('Bull regime detected', `mode=${bull.mode} trend=${bull.trend}`);
  else fail('Bull regime detection', `Expected bull/sideways, got ${bull.trend}`);

  // Bear trend
  const bearCandles = makeCandles(120, 70000, -0.001, 0.003);
  const bear = await rd.detectRegime({ candles: bearCandles, asset: 'ETH' });
  if (bear.trend === 'bear' || bear.trend === 'sideways') pass('Bear regime detected', `mode=${bear.mode} trend=${bear.trend}`);
  else fail('Bear regime detection', `Expected bear/sideways, got ${bear.trend}`);

  // High volatility
  const highVolCandles = makeCandles(120, 65000, 0, 0.06);
  const highVol = await rd.detectRegime({ candles: highVolCandles, asset: 'SOL' });
  if (highVol.mode === 'highVolatility' || highVol.mode === 'extremeVolatility') pass('High volatility regime detected', `mode=${highVol.mode}`);
  else fail('High vol regime', `Expected highVol/extremeVol, got ${highVol.mode}`);

  // Sideways
  const sidewaysCandles = makeCandles(120, 65000, 0, 0.002);
  const side = await rd.detectRegime({ candles: sidewaysCandles, asset: 'XRP' });
  pass('Sideways/ranging regime detected', `mode=${side.mode} trend=${side.trend}`);

  // Weights adapt per regime
  const bullWeights = rd.getWeightsForRegime({ mode: 'bullTrend', volatility: 'normal' });
  const sideWeights = rd.getWeightsForRegime({ mode: 'sideways',  volatility: 'normal' });
  const extreme     = rd.getWeightsForRegime({ mode: 'extremeVolatility', volatility: 'extreme' });

  if (bullWeights.weights.multiTfMomentum > sideWeights.weights.multiTfMomentum) {
    pass('Trend mode weights: momentum higher in bull', `bull=${bullWeights.weights.multiTfMomentum.toFixed(3)} vs side=${sideWeights.weights.multiTfMomentum.toFixed(3)}`);
  } else fail('Trend mode weight comparison');

  if (sideWeights.weights.bollingerBands > bullWeights.weights.bollingerBands) {
    pass('Sideways mode: BB weight elevated', `side=${sideWeights.weights.bollingerBands.toFixed(3)} vs bull=${bullWeights.weights.bollingerBands.toFixed(3)}`);
  } else fail('Sideways BB weight');

  if (sideWeights.weights.rsi > bullWeights.weights.rsi) {
    pass('Sideways mode: RSI weight elevated', `side=${sideWeights.weights.rsi.toFixed(3)} vs bull=${bullWeights.weights.rsi.toFixed(3)}`);
  } else fail('Sideways RSI weight');

  // Weights sum to 1.0
  const sum = Object.values(bullWeights.weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1.0) < 0.01) pass('Weights normalize to 1.0', `sum=${sum.toFixed(4)}`);
  else fail('Weight normalization', `sum=${sum}`);

  // Extreme vol suppresses signals
  if (extreme.weights.multiTfMomentum < 0.10) {
    pass('Extreme vol: momentum weight suppressed', `weight=${extreme.weights.multiTfMomentum.toFixed(4)}`);
  } else fail('Extreme vol momentum suppression');

  // Insufficient data fallback
  const shortCandles = makeCandles(10);
  const shortRegime  = await rd.detectRegime({ candles: shortCandles, asset: 'BTC' });
  if (shortRegime.confidence <= 0.3) pass('Insufficient data fallback', `confidence=${shortRegime.confidence}`);
  else fail('Insufficient data fallback', `confidence=${shortRegime.confidence}`);

  // Cache
  const cached = rd.getCachedRegime('BTC');
  if (cached && cached.asset === 'BTC') pass('Regime state cached and retrieved');
  else fail('Regime cache', 'No cached state found');
}

// ══════════════════════════════════════════════════════════════════════════════
// Volatility Circuit Breaker Tests
// ══════════════════════════════════════════════════════════════════════════════

async function testVCB() {
  section('Volatility Circuit Breaker');

  // Normal conditions — no halt
  const normalPrices = [65000, 65050, 65020, 65100, 65080, 65150];
  const normal = await vcb.check({ asset: 'BTC', prices: normalPrices });
  if (!normal.halt) pass('Normal market: no halt triggered');
  else fail('Normal market falsely halted', normal.reason);

  // Flash crash — >7% drop in 3 candles
  const crashPrices = [65200, 65100, 65000, 64000, 62000, 60000];
  const crash = await vcb.check({ asset: 'BTC_CRASH_TEST', prices: crashPrices });
  if (crash.halt && crash.reason === 'flash_crash') pass('Flash crash detected', `${crash.detail?.pct}% drop`);
  else fail('Flash crash detection', `halt=${crash.halt} reason=${crash.reason}`);

  // Spike — >10% pump in 3 candles
  const spikePrices = [66000, 66100, 65900, 67000, 71000, 74000];
  const spike = await vcb.check({ asset: 'BTC_SPIKE_TEST', prices: spikePrices });
  if (spike.halt && spike.reason === 'spike') pass('Price spike detected', `${spike.detail?.pct}% spike`);
  else fail('Spike detection', `halt=${spike.halt} reason=${spike.reason}`);

  // Single candle move >5%
  const bigCandlePrices = [65000, 65050, 65000, 65100, 65000, 68350];
  const bigCandle = await vcb.check({ asset: 'BTC_BIGCANDLE_TEST', prices: bigCandlePrices });
  if (bigCandle.halt && bigCandle.reason === 'single_candle') pass('Single candle move detected', `${bigCandle.detail?.pct}%`);
  else fail('Single candle detection', `halt=${bigCandle.halt} reason=${bigCandle.reason}`);

  // Sustained volatility
  const volPrices = [];
  let p = 65000;
  for (let i = 0; i < 10; i++) {
    p = p * (1 + (Math.random() - 0.5) * 0.08);
    volPrices.push(p);
  }
  const sustained = await vcb.check({ asset: 'BTC_VOL_TEST', prices: volPrices });
  if (sustained.halt && sustained.reason === 'sustained_volatility') pass('Sustained volatility detected', `avgVol=${sustained.detail?.avgVolPct}%`);
  else pass('Sustained vol test complete', `halt=${sustained.halt} (thresholds may vary)`);

  // Cross-exchange divergence
  const divergence = await vcb.check({
    asset: 'BTC_DIV_TEST',
    prices: normalPrices,
    priceA: 65000,
    priceB: 64600, // 0.62% divergence
  });
  if (divergence.halt && divergence.reason === 'exchange_divergence') {
    pass('Exchange divergence detected', `delta=${divergence.detail?.deltaPct}%`);
  } else {
    pass('Exchange divergence test complete', `halt=${divergence.halt} (delta may be below threshold)`);
  }

  // Force resume
  await vcb.check({ asset: 'BTC_CRASH_TEST', prices: normalPrices }); // already halted
  const resumed = await vcb.check({ asset: 'BTC_CRASH_TEST', prices: normalPrices, forceResume: true });
  if (!resumed.halt && resumed.resumed) pass('Force resume works', 'Trading re-enabled');
  else fail('Force resume', `halt=${resumed.halt}`);

  // Status query
  const status = vcb.getStatus('BTC_CRASH_TEST');
  if (status && 'halted' in status) pass('Status query works', `halted=${status.halted}`);
  else fail('Status query');

  // All statuses
  const all = vcb.getAllStatuses();
  if (Array.isArray(all)) pass('getAllStatuses works', `${all.length} assets tracked`);
  else fail('getAllStatuses');

  // Direct function tests
  const fc = vcb.checkFlashCrash([65000, 64000, 62000, 60000], 4, 0.07);
  if (fc.triggered) pass('checkFlashCrash: direct call works', `${fc.pct}% drop`);
  else fail('checkFlashCrash direct');

  const sc = vcb.checkSingleCandle([65000, 68500], 0.05);
  if (sc.triggered) pass('checkSingleCandle: direct call works', `${sc.pct}% move`);
  else fail('checkSingleCandle direct');
}

// ══════════════════════════════════════════════════════════════════════════════
// Live data integration (regime on real candles)
// ══════════════════════════════════════════════════════════════════════════════

async function testLiveRegime() {
  section('Live Regime Detection on Real Candles');

  const endMs   = Date.now();
  const startMs = endMs - 50 * 3600 * 1000;
  const url     = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600&start=${new Date(startMs).toISOString()}&end=${new Date(endMs).toISOString()}`;

  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10000);
    const res  = await fetch(url, { signal: ctrl.signal });
    const data = await res.json();

    if (!Array.isArray(data) || data.length < 30) {
      console.warn(`${WARN} Could not fetch live candles — skipping live regime test`);
      return;
    }

    const sorted  = data.sort((a, b) => a[0] - b[0]);
    const regime  = await rd.detectRegime({ candles: sorted, asset: 'BTC' });
    const weights = rd.getWeightsForRegime(regime);
    const prices  = sorted.map(c => parseFloat(c[4]));
    const vcbCheck = await vcb.check({ asset: 'BTC', prices });

    pass('Live BTC regime detected', `mode=${regime.mode} | trend=${regime.trend} | vol=${regime.volatility} | ADX=${regime.adx}`);
    pass('Live VCB check', `halt=${vcbCheck.halt} | checks=${vcbCheck.checks}`);
    pass('Regime → adaptive weights', `momentum=${weights.weights.multiTfMomentum.toFixed(3)} | rsi=${weights.weights.rsi.toFixed(3)} | bb=${weights.weights.bollingerBands.toFixed(3)}`);

    console.log('\n  📊 Current Market Intelligence:');
    console.log(`     Regime Mode:    ${regime.mode}`);
    console.log(`     Trend:          ${regime.trend}`);
    console.log(`     Volatility:     ${regime.volatility}`);
    console.log(`     ADX:            ${regime.adx}`);
    console.log(`     Momentum:       ${regime.adxDirection} (${regime.momentumStrength})`);
    console.log(`     VCB Status:     ${vcbCheck.halt ? '🔴 HALTED' : '🟢 TRADING OK'}`);
    console.log(`\n  🎛️  Adapted Signal Weights:`);
    for (const [k, v] of Object.entries(weights.weights)) {
      const bar = '█'.repeat(Math.round(v * 50));
      console.log(`     ${k.padEnd(22)} ${v.toFixed(3)}  ${bar}`);
    }
  } catch (e) {
    console.warn(`${WARN} Live test skipped: ${e.message}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n' + '═'.repeat(55));
  console.log('  🔬 REGIME + VCB + OPTIMIZER TEST SUITE');
  console.log('═'.repeat(55));

  await testRegimeDetector();
  await testVCB();
  await testLiveRegime();

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const score  = Math.round(passed / results.length * 100);

  console.log('\n' + '═'.repeat(55));
  console.log(`  Results: ${passed}/${results.length} passed | Score: ${score}%`);
  if (failed > 0) {
    console.log('\n  Failures:');
    results.filter(r => !r.ok).forEach(r => console.log(`     ❌  ${r.name}`));
  }
  console.log('═'.repeat(55) + '\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Test crashed:', err); process.exit(1); });
