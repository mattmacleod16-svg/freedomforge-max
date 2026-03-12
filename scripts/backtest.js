#!/usr/bin/env node
// Add to package.json scripts: "backtest": "node scripts/backtest.js"

/**
 * Backtest CLI — Run historical backtests against the FreedomForge trading system.
 *
 * Usage:
 *   node scripts/backtest.js [options]
 *
 * Options:
 *   --asset BTC          Asset to backtest (default: BTC)
 *   --interval 1h        Candle interval (default: 1h)
 *   --start 2024-01-01   Start date (default: 6 months ago)
 *   --end 2025-01-01     End date (default: today)
 *   --capital 1000       Initial capital USD (default: 1000)
 *   --fees 0.001         Fee rate per trade (default: 0.001)
 *   --slippage 0.0005    Slippage rate (default: 0.0005)
 *   --walk-forward       Run walk-forward validation
 *   --train-pct 0.7      Train/test split for walk-forward (default: 0.7)
 *   --save               Save JSON report to data/backtest-results/
 *   --compare FILE       Compare against a saved JSON report
 *   --cache-clear        Clear the data cache and exit
 *   --cache-info         Show cache info and exit
 *   --help               Show help
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const { fetchHistoricalCandles, clearCache, getCacheInfo } = require('../lib/backtest/data-loader');
const { runBacktest, walkForwardValidation } = require('../lib/backtest/engine');
const { generateTextReport, generateJsonReport, compareReports } = require('../lib/backtest/report');

const TAG = '[backtest]';
const RESULTS_DIR = path.resolve(process.cwd(), 'data', 'backtest-results');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a Date as YYYY-MM-DD.
 * @param {Date} d
 * @returns {string}
 */
function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Compute a date N months ago from today.
 * @param {number} months
 * @returns {string} YYYY-MM-DD
 */
function monthsAgo(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return formatDate(d);
}

/**
 * Print usage text and exit.
 */
function printUsage() {
  console.log(`
Usage: node scripts/backtest.js [options]

Options:
  --asset BTC          Asset to backtest (default: BTC)
  --interval 1h        Candle interval (default: 1h)
  --start 2024-01-01   Start date (default: 6 months ago)
  --end 2025-01-01     End date (default: today)
  --capital 1000       Initial capital USD (default: 1000)
  --fees 0.001         Fee rate per trade (default: 0.001)
  --slippage 0.0005    Slippage rate (default: 0.0005)
  --walk-forward       Run walk-forward validation
  --train-pct 0.7      Train/test split for walk-forward (default: 0.7)
  --save               Save JSON report to data/backtest-results/
  --compare FILE       Compare against a saved JSON report
  --cache-clear        Clear the data cache and exit
  --cache-info         Show cache info and exit
  --help               Show help

Examples:
  node scripts/backtest.js --asset ETH --interval 4h --start 2024-01-01 --end 2024-12-31
  node scripts/backtest.js --asset BTC --walk-forward --save
  node scripts/backtest.js --compare data/backtest-results/BTC-1h-2024-01-01-2024-06-01-1700000000.json
  `.trim());
}

// ─── Argument Parsing ─────────────────────────────────────────────────────────

/**
 * Parse CLI arguments from process.argv.
 * Boolean flags do not consume the next token.
 * Value flags consume the next token as their value.
 *
 * @returns {object} Parsed options
 */
function parseArgs() {
  const args = process.argv.slice(2);

  const booleanFlags = new Set([
    '--walk-forward',
    '--save',
    '--cache-clear',
    '--cache-info',
    '--help',
  ]);

  const opts = {
    asset: 'BTC',
    interval: '1h',
    start: monthsAgo(6),
    end: formatDate(new Date()),
    capital: 1000,
    fees: 0.001,
    slippage: 0.0005,
    walkForward: false,
    trainPct: 0.7,
    save: false,
    compare: null,
    cacheClear: false,
    cacheInfo: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--help':
        opts.help = true;
        break;
      case '--cache-clear':
        opts.cacheClear = true;
        break;
      case '--cache-info':
        opts.cacheInfo = true;
        break;
      case '--walk-forward':
        opts.walkForward = true;
        break;
      case '--save':
        opts.save = true;
        break;
      case '--asset':
        if (next && !next.startsWith('--')) { opts.asset = next.toUpperCase(); i++; }
        break;
      case '--interval':
        if (next && !next.startsWith('--')) { opts.interval = next; i++; }
        break;
      case '--start':
        if (next && !next.startsWith('--')) { opts.start = next; i++; }
        break;
      case '--end':
        if (next && !next.startsWith('--')) { opts.end = next; i++; }
        break;
      case '--capital':
        if (next && !next.startsWith('--')) { opts.capital = Number(next); i++; }
        break;
      case '--fees':
        if (next && !next.startsWith('--')) { opts.fees = Number(next); i++; }
        break;
      case '--slippage':
        if (next && !next.startsWith('--')) { opts.slippage = Number(next); i++; }
        break;
      case '--train-pct':
        if (next && !next.startsWith('--')) { opts.trainPct = Number(next); i++; }
        break;
      case '--compare':
        if (next && !next.startsWith('--')) { opts.compare = next; i++; }
        break;
      default:
        console.warn(`${TAG} Unknown argument: ${arg}`);
        break;
    }
  }

  return opts;
}

// ─── Report Saving ────────────────────────────────────────────────────────────

/**
 * Save a JSON report to the backtest-results directory.
 * @param {object} jsonReport
 * @param {object} opts - { asset, interval, start, end }
 * @returns {string} Saved file path
 */
function saveJsonReport(jsonReport, { asset, interval, start, end }) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const timestamp = Date.now();
  const filename = `${asset}-${interval}-${start}-${end}-${timestamp}.json`;
  const filePath = path.join(RESULTS_DIR, filename);

  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(jsonReport, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);

  return filePath;
}

/**
 * Load a JSON report from disk for comparison.
 * @param {string} filePath
 * @returns {object}
 */
function loadJsonReport(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Comparison file not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  return JSON.parse(raw);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async function main() {
  try {
    const opts = parseArgs();

    // ── Help ──
    if (opts.help) {
      printUsage();
      process.exit(0);
    }

    // ── Cache management ──
    if (opts.cacheClear) {
      const result = clearCache();
      console.log(`${TAG} Cache cleared. Removed ${result.removed} file(s).`);
      if (result.errors.length > 0) {
        console.warn(`${TAG} Errors:`, result.errors);
      }
      process.exit(0);
    }

    if (opts.cacheInfo) {
      const info = getCacheInfo();
      if (info.length === 0) {
        console.log(`${TAG} Cache is empty.`);
      } else {
        console.log(`${TAG} Cached files:`);
        for (const entry of info) {
          console.log(`  ${entry.file}  (${entry.sizeKB})`);
        }
        console.log(`${TAG} Total: ${info.length} file(s)`);
      }
      process.exit(0);
    }

    // ── Validate numeric options ──
    if (!Number.isFinite(opts.capital) || opts.capital <= 0) {
      console.error(`${TAG} Invalid --capital value. Must be a positive number.`);
      process.exit(1);
    }
    if (!Number.isFinite(opts.fees) || opts.fees < 0) {
      console.error(`${TAG} Invalid --fees value. Must be a non-negative number.`);
      process.exit(1);
    }
    if (!Number.isFinite(opts.slippage) || opts.slippage < 0) {
      console.error(`${TAG} Invalid --slippage value. Must be a non-negative number.`);
      process.exit(1);
    }
    if (!Number.isFinite(opts.trainPct) || opts.trainPct <= 0 || opts.trainPct >= 1) {
      console.error(`${TAG} Invalid --train-pct value. Must be between 0 and 1 (exclusive).`);
      process.exit(1);
    }

    // ── Fetch historical candles ──
    console.log(`${TAG} Fetching candles for ${opts.asset} ${opts.interval} (${opts.start} -> ${opts.end})...`);

    const candles = await fetchHistoricalCandles({
      asset: opts.asset,
      interval: opts.interval,
      startDate: opts.start,
      endDate: opts.end,
    });

    if (!candles || candles.length === 0) {
      console.error(`${TAG} No candle data returned. Check your asset, interval, and date range.`);
      process.exit(1);
    }

    console.log(`${TAG} Loaded ${candles.length} candles for ${opts.asset} ${opts.interval} (${opts.start} -> ${opts.end})`);

    // ── Backtest parameters ──
    const backtestOpts = {
      candles,
      initialCapital: opts.capital,
      fees: opts.fees,
      slippage: opts.slippage,
    };

    const reportMeta = {
      asset: opts.asset,
      interval: opts.interval,
      startDate: opts.start,
      endDate: opts.end,
    };

    let result;

    // ── Walk-forward validation ──
    if (opts.walkForward) {
      console.log(`${TAG} Running walk-forward validation (trainPct=${opts.trainPct})...`);

      const wfResult = await walkForwardValidation(candles, backtestOpts, {
        trainPct: opts.trainPct,
      });

      console.log('\n' + '='.repeat(60));
      console.log('  WALK-FORWARD VALIDATION RESULTS');
      console.log('='.repeat(60));

      // Train report
      if (wfResult.train) {
        console.log('\n--- TRAIN SET ---');
        console.log(generateTextReport(wfResult.train, reportMeta));
      }

      // Test report
      if (wfResult.test) {
        console.log('\n--- TEST SET ---');
        console.log(generateTextReport(wfResult.test, reportMeta));
      }

      // Overfit indicator
      if (wfResult.overfit !== undefined) {
        console.log(`\nOverfit score: ${wfResult.overfit}`);
        if (wfResult.overfit > 0.5) {
          console.warn(`${TAG} WARNING: High overfit score detected. Test performance significantly lags training.`);
        }
      }

      // Use the test result as the primary result for saving
      result = wfResult.test || wfResult.train;
    } else {
      // ── Standard single-pass backtest ──
      console.log(`${TAG} Running backtest (capital=$${opts.capital}, fees=${opts.fees}, slippage=${opts.slippage})...`);

      result = await runBacktest(backtestOpts);
    }

    if (!result) {
      console.error(`${TAG} Backtest returned no result.`);
      process.exit(1);
    }

    // ── Print text report ──
    if (!opts.walkForward) {
      const textReport = generateTextReport(result, reportMeta);
      console.log('\n' + textReport);
    }

    // ── Save JSON report ──
    if (opts.save) {
      const jsonReport = generateJsonReport(result, reportMeta);
      const savedPath = saveJsonReport(jsonReport, {
        asset: opts.asset,
        interval: opts.interval,
        start: opts.start,
        end: opts.end,
      });
      console.log(`${TAG} Report saved to ${savedPath}`);
    }

    // ── Compare against previous report ──
    if (opts.compare) {
      console.log(`${TAG} Loading comparison report: ${opts.compare}`);
      const previousReport = loadJsonReport(opts.compare);
      const currentReport = generateJsonReport(result, reportMeta);
      const comparison = compareReports(currentReport, previousReport);

      console.log('\n' + '='.repeat(60));
      console.log('  REPORT COMPARISON');
      console.log('='.repeat(60));

      if (typeof comparison === 'string') {
        console.log(comparison);
      } else {
        console.log(JSON.stringify(comparison, null, 2));
      }
    }

    console.log(`\n${TAG} Done.`);
  } catch (err) {
    console.error(`${TAG} Fatal error: ${err.message}`);
    if (err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
})();
