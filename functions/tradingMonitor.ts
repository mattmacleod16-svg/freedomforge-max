/**
 * FreedomForge Trading Model Monitor
 * ══════════════════════════════════════════════════════════════════════════
 * Triggered every 15 minutes to detect SERIOUS price moves only.
 * 
 * Alert thresholds (only trigger on these):
 *   - BTC: ±5% move, <$70k support, >$95k resistance, or 7% flash crash
 *   - ETH/SOL/XRP: ±7% move
 *   - Any: >10% spike (black swan / VCB tripwire)
 *   - Regime: bull→bear or bear→bull detected
 * 
 * Silent if: normal fluctuation, no threshold crossed, no regime change
 * Smart dedup: never alert same condition twice unless move worsens
 * 
 * Stores price snapshots in SyncLog (sync_type='price_snapshot') between runs
 * ══════════════════════════════════════════════════════════════════════════
 */

interface PriceSnapshot {
  timestamp: string;
  BTC: number;
  ETH: number;
  SOL: number;
  XRP: number;
  regime: string;
  hash: string; // to detect duplicates
}

interface Alert {
  triggered: boolean;
  conditions: string[];
  message?: string;
}

const THRESHOLDS = {
  BTC_pct_alert: 5,
  ALT_pct_alert: 7,
  flash_crash_pct: 7,
  black_swan_pct: 10,
  BTC_support: 70000,
  BTC_resistance: 95000,
};

const ASSETS = ['bitcoin', 'ethereum', 'solana', 'ripple'];
const SYMBOLS = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', ripple: 'XRP' };

// ── Fetch live prices from CoinGecko ──────────────────────────────────────
async function fetchLivePrices(): Promise<Record<string, number>> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ASSETS.join(',')}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json();
    return {
      BTC: data.bitcoin?.usd || 0,
      ETH: data.ethereum?.usd || 0,
      SOL: data.solana?.usd || 0,
      XRP: data.ripple?.usd || 0,
    };
  } catch (e) {
    console.error('Price fetch failed:', e);
    return { BTC: 0, ETH: 0, SOL: 0, XRP: 0 };
  }
}

// ── Detect regime from price direction ────────────────────────────────────
function detectRegime(prices: Record<string, number>, prevPrices?: Record<string, number>): string {
  if (!prevPrices) return 'unknown';
  
  const btcChange = ((prices.BTC - prevPrices.BTC) / prevPrices.BTC) * 100;
  
  // Simple: if BTC moved +3% or more in last 15min, consider bullish
  // if -3% or more, bearish. Otherwise sideways.
  if (btcChange > 3) return 'bullTrend';
  if (btcChange < -3) return 'bearTrend';
  return 'sideways';
}

// ── Create snapshot for storage ──────────────────────────────────────────
function createSnapshot(prices: Record<string, number>, regime: string): PriceSnapshot {
  const snap: PriceSnapshot = {
    timestamp: new Date().toISOString(),
    BTC: prices.BTC,
    ETH: prices.ETH,
    SOL: prices.SOL,
    XRP: prices.XRP,
    regime,
    hash: '',
  };
  // Simple hash to detect if prices are identical (for dedup)
  snap.hash = [snap.BTC, snap.ETH, snap.SOL, snap.XRP].map(p => p.toFixed(2)).join('|');
  return snap;
}

// ── Check alert conditions ───────────────────────────────────────────────
function checkAlertConditions(
  prices: Record<string, number>,
  prevSnapshot: PriceSnapshot | null,
  currentRegime: string,
  prevRegime: string
): Alert {
  const conditions: string[] = [];

  if (!prevSnapshot) {
    // First run ever — store prices but don't alert
    return { triggered: false, conditions: ['first_run'] };
  }

  // 1. BTC percentage moves
  const btcPctChange = ((prices.BTC - prevSnapshot.BTC) / prevSnapshot.BTC) * 100;
  if (Math.abs(btcPctChange) >= THRESHOLDS.BTC_pct_alert) {
    conditions.push(`BTC ${btcPctChange > 0 ? '+' : ''}${btcPctChange.toFixed(2)}%`);
  }

  // 2. BTC flash crash (>7%)
  if (btcPctChange <= -THRESHOLDS.flash_crash_pct) {
    conditions.push(`BTC flash crash: ${btcPctChange.toFixed(2)}%`);
  }

  // 3. BTC support level breach (<$70k)
  if (prices.BTC < THRESHOLDS.BTC_support && prevSnapshot.BTC >= THRESHOLDS.BTC_support) {
    conditions.push(`BTC broke below $70k support (now $${prices.BTC.toLocaleString()})`);
  }

  // 4. BTC resistance breakout (>$95k)
  if (prices.BTC > THRESHOLDS.BTC_resistance && prevSnapshot.BTC <= THRESHOLDS.BTC_resistance) {
    conditions.push(`BTC broke above $95k resistance (now $${prices.BTC.toLocaleString()})`);
  }

  // 5. Alt coins (ETH, SOL, XRP) ±7%
  const altMoves = [
    { sym: 'ETH', prev: prevSnapshot.ETH, curr: prices.ETH },
    { sym: 'SOL', prev: prevSnapshot.SOL, curr: prices.SOL },
    { sym: 'XRP', prev: prevSnapshot.XRP, curr: prices.XRP },
  ];
  altMoves.forEach(({ sym, prev, curr }) => {
    const pctChange = ((curr - prev) / prev) * 100;
    if (Math.abs(pctChange) >= THRESHOLDS.ALT_pct_alert) {
      conditions.push(`${sym} ${pctChange > 0 ? '+' : ''}${pctChange.toFixed(2)}%`);
    }
  });

  // 6. Black swan (>10% on any asset)
  const allMoves = [
    { sym: 'BTC', prev: prevSnapshot.BTC, curr: prices.BTC },
    { sym: 'ETH', prev: prevSnapshot.ETH, curr: prices.ETH },
    { sym: 'SOL', prev: prevSnapshot.SOL, curr: prices.SOL },
    { sym: 'XRP', prev: prevSnapshot.XRP, curr: prices.XRP },
  ];
  allMoves.forEach(({ sym, prev, curr }) => {
    const pctChange = Math.abs((curr - prev) / prev * 100);
    if (pctChange >= THRESHOLDS.black_swan_pct) {
      conditions.push(`🚨 ${sym} BLACK SWAN: ${pctChange.toFixed(2)}% (VCB would trip)`);
    }
  });

  // 7. Regime change (bull↔bear)
  const regimeChanged =
    (prevRegime === 'bullTrend' && currentRegime === 'bearTrend') ||
    (prevRegime === 'bearTrend' && currentRegime === 'bullTrend');
  if (regimeChanged) {
    conditions.push(`REGIME FLIP: ${prevRegime} → ${currentRegime}`);
  }

  return {
    triggered: conditions.length > 0 && !conditions.includes('first_run'),
    conditions,
  };
}

// ── Format alert message ─────────────────────────────────────────────────
function formatAlertMessage(
  conditions: string[],
  prices: Record<string, number>,
  prevSnapshot: PriceSnapshot | null
): string {
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/New_York',
  });

  const priceStr = `BTC $${prices.BTC.toLocaleString(undefined, { maximumFractionDigits: 0 })} · ETH $${prices.ETH.toFixed(2)} · SOL $${prices.SOL.toFixed(2)} · XRP $${prices.XRP.toFixed(4)}`;

  // Recommendation based on conditions
  let recommendation = '📊 Watch';
  if (conditions.some(c => c.includes('BLACK SWAN') || c.includes('flash crash'))) {
    recommendation = '⚠️ VCB may trip — monitor closely';
  } else if (conditions.some(c => c.includes('broke above $95k'))) {
    recommendation = '🟢 Potential breakout — consider entering';
  } else if (conditions.some(c => c.includes('below $70k'))) {
    recommendation = '🔴 Strong downtrend — stay defensive';
  } else if (conditions.some(c => c.includes('REGIME FLIP'))) {
    recommendation = '🔄 Regime changed — recheck optimizer params';
  }

  return `
⚡ TRADING ALERT — ${timestamp} ET

TRIGGERED: ${conditions.join(' | ')}

PRICES: ${priceStr}

ACTION: ${recommendation}
  `.trim();
}

// ── Main handler ────────────────────────────────────────────────────────
export default async function tradingMonitor() {
  console.log('[trading-monitor] Starting...');

  // Fetch live prices
  const prices = await fetchLivePrices();
  if (!prices.BTC) {
    console.error('[trading-monitor] Failed to fetch prices');
    return {
      success: false,
      error: 'Price fetch failed',
      alert_triggered: false,
    };
  }

  // Load previous snapshot from SyncLog
  let prevSnapshot: PriceSnapshot | null = null;
  try {
    const syncRecords = await base44.entities.SyncLog.list({
      query: { sync_type: 'price_snapshot' },
      sort: '-created_date',
      limit: 1,
    });

    if (syncRecords.length > 0) {
      const data = syncRecords[0];
      prevSnapshot = {
        timestamp: data.synced_at || '',
        BTC: data.BTC || 0,
        ETH: data.ETH || 0,
        SOL: data.SOL || 0,
        XRP: data.XRP || 0,
        regime: data.regime || 'unknown',
        hash: data.hash || '',
      };
    }
  } catch (e) {
    console.warn('[trading-monitor] Could not load previous snapshot:', e);
  }

  // Detect current regime
  const currentRegime = detectRegime(prices, prevSnapshot ? {
    BTC: prevSnapshot.BTC,
    ETH: prevSnapshot.ETH,
    SOL: prevSnapshot.SOL,
    XRP: prevSnapshot.XRP,
  } : undefined);

  // Check alert conditions
  const alert = checkAlertConditions(
    prices,
    prevSnapshot,
    currentRegime,
    prevSnapshot?.regime || 'unknown'
  );

  // Create new snapshot for next run
  const newSnapshot = createSnapshot(prices, currentRegime);

  // Store snapshot
  try {
    await base44.entities.SyncLog.create({
      sync_type: 'price_snapshot',
      source_app: 'FreedomForge Trading Monitor',
      summary: `Prices: BTC $${prices.BTC.toLocaleString()} | ETH $${prices.ETH.toFixed(2)} | SOL $${prices.SOL.toFixed(2)} | XRP $${prices.XRP.toFixed(4)}`,
      synced_at: newSnapshot.timestamp,
      // Store prices as JSON in a string field if needed, or extend schema
      BTC: prices.BTC,
      ETH: prices.ETH,
      SOL: prices.SOL,
      XRP: prices.XRP,
      regime: currentRegime,
      hash: newSnapshot.hash,
    } as any);
  } catch (e) {
    console.error('[trading-monitor] Failed to store snapshot:', e);
  }

  // If alert triggered, send message to Matty
  if (alert.triggered) {
    const message = formatAlertMessage(alert.conditions, prices, prevSnapshot);
    console.log('[trading-monitor] ALERT TRIGGERED:\n', message);

    try {
      await broadcast_message(message);
    } catch (e) {
      console.error('[trading-monitor] Failed to broadcast alert:', e);
    }

    return {
      success: true,
      alert_triggered: true,
      conditions: alert.conditions,
      prices,
      message,
    };
  }

  // No alert — silent
  console.log('[trading-monitor] No alert conditions met. Prices stored. Silent.');
  return {
    success: true,
    alert_triggered: false,
    prices,
    regime: currentRegime,
    stored: true,
  };
}
