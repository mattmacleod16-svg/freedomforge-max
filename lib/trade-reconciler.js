/**
 * Trade Reconciler — Closes open trades by fetching current prices.
 *
 * This is the MISSING LINK in the trading pipeline. Without this,
 * every trade stays "open" forever with outcome=null, making win-rate
 * stuck at 0% and P&L tracking useless.
 *
 * Runs as part of the master orchestrator cycle (Phase 5b):
 *   1. Loads all unclosed trades from the journal
 *   2. Groups by venue/asset
 *   3. Fetches current price per asset (one API call per asset)
 *   4. Applies auto-close rules:
 *      - Market orders: close after MAX_HOLD_MINUTES (default 60)
 *      - Take profit: close if P&L > TP threshold
 *      - Stop loss: close if P&L < SL threshold
 *   5. Records outcome via tradeJournal.recordOutcome()
 *   6. Updates risk manager exposure
 *
 * Usage:
 *   const reconciler = require('../lib/trade-reconciler');
 *   const result = await reconciler.reconcileOpenTrades();
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

let tradeJournal, riskManager, rio;
try { tradeJournal = require('./trade-journal'); } catch { tradeJournal = null; }
try { riskManager = require('./risk-manager'); } catch { riskManager = null; }
try { rio = require('./resilient-io'); } catch { rio = null; }

// ─── Configuration ───────────────────────────────────────────────────────────

const MAX_HOLD_MINUTES = Math.max(5, parseInt(process.env.TRADE_MAX_HOLD_MINUTES || '60', 10));
const AUTO_CLOSE_AFTER_MS = MAX_HOLD_MINUTES * 60 * 1000;
const SL_PERCENT = -(Math.abs(parseFloat(process.env.TRADE_SL_PERCENT || '2.0')));  // -2% default
const TP_PERCENT = Math.abs(parseFloat(process.env.TRADE_TP_PERCENT || '3.0'));       // +3% default
const RECONCILE_MAX_BATCH = Math.max(5, parseInt(process.env.RECONCILE_MAX_BATCH || '100', 10));

// ─── Price Fetching ──────────────────────────────────────────────────────────

/**
 * Fetch current price for an asset from CoinGecko or Kraken public APIs.
 * Falls back gracefully to avoid API key dependencies.
 */
async function fetchCurrentPrice(asset) {
  // Map common asset names to API identifiers
  const assetMap = {
    BTC: { coingecko: 'bitcoin', krakenPair: 'XXBTZUSD' },
    ETH: { coingecko: 'ethereum', krakenPair: 'XETHZUSD' },
    SOL: { coingecko: 'solana', krakenPair: 'SOLUSD' },
    XRP: { coingecko: 'ripple', krakenPair: 'XXRPZUSD' },
    ADA: { coingecko: 'cardano', krakenPair: 'ADAUSD' },
    DOT: { coingecko: 'polkadot', krakenPair: 'DOTUSD' },
    AVAX: { coingecko: 'avalanche-2', krakenPair: 'AVAXUSD' },
    LINK: { coingecko: 'chainlink', krakenPair: 'LINKUSD' },
    MATIC: { coingecko: 'matic-network', krakenPair: 'MATICUSD' },
    DOGE: { coingecko: 'dogecoin', krakenPair: 'XDGUSD' },
    ATOM: { coingecko: 'cosmos', krakenPair: 'ATOMUSD' },
    UNI: { coingecko: 'uniswap', krakenPair: 'UNIUSD' },
    OP: { coingecko: 'optimism', krakenPair: 'OPUSD' },
    TRUMP: { coingecko: 'official-trump', krakenPair: 'TRUMPUSD' },
    ARB: { coingecko: 'arbitrum', krakenPair: 'ARBUSD' },
    NEAR: { coingecko: 'near', krakenPair: 'NEARUSD' },
    FIL: { coingecko: 'filecoin', krakenPair: 'FILUSD' },
    APT: { coingecko: 'aptos', krakenPair: 'APTUSD' },
    SUI: { coingecko: 'sui', krakenPair: 'SUIUSD' },
    PEPE: { coingecko: 'pepe', krakenPair: 'PEPEUSD' },
    WIF: { coingecko: 'dogwifcoin', krakenPair: 'WIFUSD' },
    BONK: { coingecko: 'bonk', krakenPair: 'BONKUSD' },
    INJ: { coingecko: 'injective-protocol', krakenPair: 'INJUSD' },
    TIA: { coingecko: 'celestia', krakenPair: 'TIAUSD' },
    SEI: { coingecko: 'sei-network', krakenPair: 'SEIUSD' },
    RENDER: { coingecko: 'render-token', krakenPair: 'RENDERUSD' },
    FET: { coingecko: 'fetch-ai', krakenPair: 'FETUSD' },
    AAVE: { coingecko: 'aave', krakenPair: 'AAVEUSD' },
    MKR: { coingecko: 'maker', krakenPair: 'MKRUSD' },
    LDO: { coingecko: 'lido-dao', krakenPair: 'LDOUSD' },
  };

  const info = assetMap[asset.toUpperCase()];
  if (!info) return null;

  // Try Kraken public API first (no auth needed, fast)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${info.krakenPair}`, { signal: controller.signal });
      const data = await res.json();
      if (data.result) {
        const key = Object.keys(data.result)[0];
        return parseFloat(data.result[key].c[0]); // c = last close
      }
    } finally { clearTimeout(timer); }
  } catch {}

  // Fallback: CoinGecko (no auth, rate-limited)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${info.coingecko}&vs_currencies=usd`, { signal: controller.signal });
      const data = await res.json();
      if (data[info.coingecko]?.usd) {
        return data[info.coingecko].usd;
      }
    } finally { clearTimeout(timer); }
  } catch {}

  return null;
}

/**
 * Batch-fetch prices for multiple assets.
 * Returns Map<asset, price>.
 */
async function fetchPrices(assets) {
  const prices = new Map();
  const unique = [...new Set(assets.map(a => a.toUpperCase()))];

  // Fetch prices in parallel via fetchCurrentPrice (Kraken → CoinGecko fallback)
  const krakenResults = await Promise.allSettled(
    unique.map(async (asset) => {
      const price = await fetchCurrentPrice(asset);
      return { asset, price };
    })
  );

  for (const result of krakenResults) {
    if (result.status === 'fulfilled' && result.value.price) {
      prices.set(result.value.asset, result.value.price);
    }
  }

  return prices;
}

// ─── Reconciliation Logic ────────────────────────────────────────────────────

/**
 * Reconcile all open trades — the core function.
 * Returns { closedCount, totalPnl, errors }.
 */
async function reconcileOpenTrades() {
  if (!tradeJournal) return { closedCount: 0, totalPnl: 0, errors: ['trade-journal not available'] };

  // Load the raw journal to get open trades (with locking if available)
  const fs = require('fs');
  const journalPath = tradeJournal.JOURNAL_FILE;
  let openTrades;

  // FIX C-3: Read journal under lock, then RELEASE before async network calls
  {
    const release = rio ? rio.acquireLock(journalPath) : null;
    try {
      let journal;
      if (rio) {
        journal = rio.readJsonSafe(journalPath, { fallback: { trades: [] } });
      } else {
        journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      }
      openTrades = (journal.trades || []).filter(t => !t.closedAt && !t.outcome);
    } catch {
      if (release) release();
      return { closedCount: 0, totalPnl: 0, errors: ['journal file unreadable'] };
    }
    if (release) release(); // Release lock BEFORE network calls
  }

  if (openTrades.length === 0) {
    return { closedCount: 0, totalPnl: 0, message: 'no open trades' };
  }

  // Get unique assets needing prices (NO lock held during network calls)
  const assets = [...new Set(openTrades.map(t => t.asset).filter(Boolean))];
  const prices = await fetchPrices(assets);

  let closedCount = 0;
  let totalPnl = 0;
  const errors = [];
  const closed = [];
  const zombieIds = [];  // FIX C-4: Track zombie IDs separately
  const now = Date.now();

  // Process up to RECONCILE_MAX_BATCH trades per cycle
  const toProcess = openTrades.slice(0, RECONCILE_MAX_BATCH);

  for (const trade of toProcess) {
    const currentPrice = prices.get(trade.asset?.toUpperCase());

    // ═══ ZOMBIE SAFETY VALVE ═══
    // Auto-close trades with missing data that can never be reconciled normally.
    // Prevents zombies from accumulating in the journal forever.
    const isZombie = !trade.entryPrice || !Number.isFinite(trade.ts || trade.entryTs);
    if (isZombie || (!currentPrice && !trade.entryPrice)) {
      try {
        zombieIds.push(trade.id);  // FIX C-4: Track zombie IDs, don't mutate in-memory
        closedCount++;
        closed.push({
          id: trade.id, asset: trade.asset, venue: trade.venue, side: trade.side,
          entryPrice: trade.entryPrice || 0, exitPrice: 0, pnl: 0, pnlPercent: 0,
          reason: 'zombie_safety_valve', holdMinutes: 0,
        });
      } catch (err) { console.error('[reconciler] zombie tracking error:', err?.message || err); }
      continue;
    }

    if (!currentPrice) {
      // Can't reconcile without current price — skip (not a zombie, just no price feed yet)
      continue;
    }

    // Calculate unrealized P&L
    const side = trade.side;
    const direction = side === 'buy' ? 1 : -1;
    // FIX M-8: Guard against division by zero on bad entry price
    if (!trade.entryPrice || !Number.isFinite(trade.entryPrice) || trade.entryPrice <= 0) {
      errors.push(`${trade.id}: invalid entryPrice ${trade.entryPrice}`);
      continue;
    }
    const pnlPercent = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100 * direction;
    const pnl = (trade.usdSize || 0) * pnlPercent / 100;
    const holdTimeMs = now - (trade.entryTs || trade.ts || now);  // FIX H-5: default to now if missing, not 0

    // Decision: should we close?
    let shouldClose = false;
    let closeReason = '';

    // Rule 1: Max hold time exceeded
    if (holdTimeMs > AUTO_CLOSE_AFTER_MS) {
      shouldClose = true;
      closeReason = `max_hold_time (${MAX_HOLD_MINUTES}min)`;
    }

    // Rule 2: Take profit
    if (pnlPercent >= TP_PERCENT) {
      shouldClose = true;
      closeReason = `take_profit (${pnlPercent.toFixed(2)}% >= ${TP_PERCENT}%)`;
    }

    // Rule 3: Stop loss
    if (pnlPercent <= SL_PERCENT) {
      shouldClose = true;
      closeReason = `stop_loss (${pnlPercent.toFixed(2)}% <= ${SL_PERCENT}%)`;
    }

    // Rule 4: Dry run trades — close immediately (they're simulated anyway)
    if (trade.dryRun) {
      shouldClose = true;
      closeReason = 'dry_run_auto_close';
    }

    if (!shouldClose) continue;

    // Close the trade
    try {
      const success = tradeJournal.recordOutcome(trade.id, {
        exitPrice: currentPrice,
        pnl: Math.round(pnl * 100) / 100,
        pnlPercent: Math.round(pnlPercent * 100) / 100,
        fees: trade.fees || 0,
      });

      if (success) {
        closedCount++;
        totalPnl += pnl;
        closed.push({
          id: trade.id,
          asset: trade.asset,
          venue: trade.venue,
          side: trade.side,
          entryPrice: trade.entryPrice,
          exitPrice: currentPrice,
          pnl: Math.round(pnl * 100) / 100,
          pnlPercent: Math.round(pnlPercent * 100) / 100,
          reason: closeReason,
          holdMinutes: Math.round(holdTimeMs / 60000),
        });

        // Update risk manager
        if (riskManager) {
          try {
            riskManager.recordPnl(Math.round(pnl * 100) / 100);
            if (trade.orderId) riskManager.closeExposure(trade.orderId);
          } catch (err) { console.error('[reconciler] risk manager update failed:', err?.message || err); }
        }
      }
    } catch (e) {
      errors.push(`${trade.id}: ${e.message}`);
    }
  }

  // FIX C-4: Flush zombies under a NEW lock, re-reading fresh journal
  // This avoids overwriting recordOutcome changes
  if (zombieIds.length > 0) {
    const zombieRelease = rio ? rio.acquireLock(journalPath) : null;
    try {
      let freshJournal;
      if (rio) {
        freshJournal = rio.readJsonSafe(journalPath, { fallback: { trades: [] } });
      } else {
        freshJournal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      }
      const zombieSet = new Set(zombieIds);
      const now = Date.now();
      for (const t of (freshJournal.trades || [])) {
        if (zombieSet.has(t.id)) {
          t.closedAt = new Date(now).toISOString();
          t.status = 'zombie';
          t.outcome = 'loss';
          t.pnl = 0;
          t.closeReason = 'zombie_safety_valve: missing data';
          t.exitPrice = t.entryPrice || 0;
        }
      }
      if (rio) { rio.writeJsonAtomic(journalPath, freshJournal); }
      else { fs.writeFileSync(journalPath, JSON.stringify(freshJournal, null, 2)); }
    } catch (err) { console.error('[reconciler] zombie cleanup write failed:', err?.message || err); }
    if (zombieRelease) zombieRelease();
  }

  return {
    closedCount,
    totalPnl: Math.round(totalPnl * 100) / 100,
    openRemaining: openTrades.length - closedCount,
    closed,
    errors: errors.length > 0 ? errors : undefined,
    pricesUsed: Object.fromEntries(prices),
    reconcileTs: new Date().toISOString(),
  };
}

/**
 * Get summary of open trade exposure.
 */
function getOpenExposure() {
  if (!tradeJournal) return { count: 0, totalUsd: 0 };

  try {
    let journal;
    if (rio) {
      journal = rio.readJsonSafe(tradeJournal.JOURNAL_FILE, { fallback: { trades: [] } });
    } else {
      const fs = require('fs');
      journal = JSON.parse(fs.readFileSync(tradeJournal.JOURNAL_FILE, 'utf8'));
    }
    const open = (journal.trades || []).filter(t => !t.closedAt && !t.outcome);
    const totalUsd = open.reduce((s, t) => s + (t.usdSize || 0), 0);
    const byAsset = {};
    for (const t of open) {
      const a = t.asset || 'unknown';
      if (!byAsset[a]) byAsset[a] = { count: 0, usd: 0 };
      byAsset[a].count++;
      byAsset[a].usd += t.usdSize || 0;
    }
    return { count: open.length, totalUsd: Math.round(totalUsd * 100) / 100, byAsset };
  } catch {
    return { count: 0, totalUsd: 0 };
  }
}

module.exports = {
  reconcileOpenTrades,
  fetchCurrentPrice,
  fetchPrices,
  getOpenExposure,
  AUTO_CLOSE_AFTER_MS,
  SL_PERCENT,
  TP_PERCENT,
};
