/**
 * Cross-Asset Regime Correlation Engine — FreedomForge
 * ═══════════════════════════════════════════════════════════════════════════
 * Uses ETH, SOL, and XRP regime data to produce a BTC sizing confidence
 * multiplier. The insight: when the majority of altcoins are in the same
 * regime as BTC, that regime is MORE reliable. When they diverge, it signals
 * uncertainty — size down.
 *
 * Logic:
 *   1. Fetch regime data for all 4 assets (BTC, ETH, SOL, XRP)
 *   2. Compute regime consensus score — how many alts agree with BTC?
 *   3. Compute volatility correlation — are alts amplifying or dampening?
 *   4. Output a multiplier [0.5, 1.3] applied to BTC position sizing
 *   5. Detect "lead/lag" — ETH often leads BTC by 1-3 candles
 *
 * Integration:
 *   import { crossAssetMultiplier } from './cross-asset-regime';
 *   const mult = await crossAssetMultiplier({ btcRegime, altRegimes });
 *   const finalSize = kellySize * mult;
 *
 * State persisted to data/cross-asset-state.json
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let log;
try { const { createLogger } = require('./logger'); log = createLogger('cross-asset'); }
catch { log = { info: console.log, warn: console.warn, error: console.error, debug() {} }; }

const STATE_FILE = path.resolve(process.cwd(), 'data/cross-asset-state.json');

// ── Regime alignment scoring ───────────────────────────────────────────────────
// Maps regime mode to a numeric signal direction for comparison
const REGIME_SCORE = {
  bullTrend:        +2,
  sideways:          0,
  bearTrend:        -2,
  highVolatility:   -1,
  extremeVolatility:-3,
};

// Weight of each alt in the consensus (ETH is closest to BTC, so highest weight)
const ALT_WEIGHTS = {
  ETH: 0.45,
  SOL: 0.30,
  XRP: 0.25,
};

// ── Lead/lag detection ─────────────────────────────────────────────────────────
// Stores the last N regime states per asset to detect ETH leading BTC
const LEAD_LAG_WINDOW = 6; // 6 hourly candles = 6 hours
let _regimeHistory = {}; // { ETH: [{mode, ts}, ...], BTC: [...] }

function recordRegime(asset, mode, ts = Date.now()) {
  if (!_regimeHistory[asset]) _regimeHistory[asset] = [];
  _regimeHistory[asset].push({ mode, ts });
  if (_regimeHistory[asset].length > LEAD_LAG_WINDOW * 3) {
    _regimeHistory[asset] = _regimeHistory[asset].slice(-LEAD_LAG_WINDOW * 3);
  }
}

// Detect if ETH transitioned to a new regime before BTC did
function detectLeadLag() {
  const ethHist = _regimeHistory['ETH'] || [];
  const btcHist = _regimeHistory['BTC'] || [];
  if (ethHist.length < 2 || btcHist.length < 2) return null;

  const latestEth = ethHist[ethHist.length - 1];
  const latestBtc = btcHist[btcHist.length - 1];

  // Check if ETH changed regime in last LEAD_LAG_WINDOW periods but BTC hasn't yet
  const recentEth = ethHist.slice(-LEAD_LAG_WINDOW);
  const firstEthMode = recentEth[0]?.mode;
  const lastEthMode  = recentEth[recentEth.length - 1]?.mode;
  const ethChanged   = firstEthMode !== lastEthMode;
  const btcUnchanged = latestBtc.mode === (btcHist.slice(-LEAD_LAG_WINDOW)[0]?.mode);

  if (ethChanged && btcUnchanged && lastEthMode !== latestBtc.mode) {
    return {
      detected: true,
      ethNewMode: lastEthMode,
      btcCurrentMode: latestBtc.mode,
      lagCandles: recentEth.filter(e => e.mode === lastEthMode).length,
      signal: REGIME_SCORE[lastEthMode] > REGIME_SCORE[latestBtc.mode] ? 'bullish_lead' : 'bearish_lead',
    };
  }
  return { detected: false };
}

// ── Consensus multiplier ────────────────────────────────────────────────────────
/**
 * Core function: given BTC's current regime and the altcoin regimes,
 * compute a sizing multiplier.
 *
 * @param {object} params
 * @param {object} params.btcRegime   - BTC regime object {mode, trend, volatility, confidence}
 * @param {object} params.altRegimes  - { ETH: regimeObj, SOL: regimeObj, XRP: regimeObj }
 * @returns {object} { multiplier, consensus, leadLag, details }
 */
function crossAssetMultiplier(params = {}) {
  const { btcRegime, altRegimes = {} } = params;

  if (!btcRegime) return { multiplier: 1.0, consensus: 0, details: { reason: 'no_btc_regime' } };

  const btcScore = REGIME_SCORE[btcRegime.mode] ?? 0;

  // Record for lead/lag detection
  recordRegime('BTC', btcRegime.mode);

  let weightedConsensus = 0;
  let totalWeight = 0;
  const altDetails = {};
  let allBearish = true;
  let anyExtreme = false;

  for (const [alt, weight] of Object.entries(ALT_WEIGHTS)) {
    const altRegime = altRegimes[alt];
    if (!altRegime) continue;

    recordRegime(alt, altRegime.mode);

    const altScore = REGIME_SCORE[altRegime.mode] ?? 0;
    const agreement = 1 - Math.abs(btcScore - altScore) / 4; // normalized to [0,1]

    weightedConsensus += agreement * weight;
    totalWeight       += weight;

    if (altRegime.mode !== 'bearTrend' && altRegime.mode !== 'extremeVolatility') allBearish = false;
    if (altRegime.mode === 'extremeVolatility') anyExtreme = true;

    altDetails[alt] = {
      mode:      altRegime.mode,
      score:     altScore,
      agreement: parseFloat(agreement.toFixed(3)),
      weight,
    };
  }

  const normalizedConsensus = totalWeight > 0 ? weightedConsensus / totalWeight : 0.5;

  // Lead/lag signal
  const leadLag = detectLeadLag();

  // ── Compute final multiplier ────────────────────────────────────────────────
  // Base: consensus maps [0, 1] → [0.55, 1.25]
  let multiplier = 0.55 + normalizedConsensus * 0.70;

  // If ETH is leading BTC into a new regime, apply a signal-aware adjustment
  if (leadLag?.detected) {
    if (leadLag.signal === 'bullish_lead') multiplier *= 1.10;  // ETH turning bull before BTC → size up
    if (leadLag.signal === 'bearish_lead') multiplier *= 0.75;  // ETH turning bear before BTC → size down early
    log.info(`Lead/lag detected: ETH→${leadLag.ethNewMode} (${leadLag.lagCandles} candles ahead of BTC)`);
  }

  // Black swan protection: if ANY alt is in extreme volatility, cap multiplier hard
  if (anyExtreme) {
    multiplier = Math.min(multiplier, 0.50);
    log.warn('Extreme volatility detected in alt — sizing capped at 0.5x');
  }

  // Full alt consensus in bearTrend = strongly bearish confirmation
  if (allBearish && btcScore <= 0) {
    multiplier *= 0.80; // even more conservative
    log.info('Full alt bear consensus — applying 0.8x bear confirmation multiplier');
  }

  // BTC extremely bullish + all alts confirming = scale up
  if (btcRegime.mode === 'bullTrend' && normalizedConsensus > 0.85) {
    multiplier = Math.min(1.30, multiplier * 1.05);
  }

  // Final clamp
  multiplier = Math.max(0.40, Math.min(1.30, multiplier));
  multiplier = parseFloat(multiplier.toFixed(4));

  const result = {
    multiplier,
    consensus: parseFloat(normalizedConsensus.toFixed(4)),
    btcMode:   btcRegime.mode,
    leadLag,
    altDetails,
    anyExtreme,
    allBearish,
  };

  log.info(`Cross-asset multiplier: ${multiplier}x | consensus=${normalizedConsensus.toFixed(2)} | BTC=${btcRegime.mode}`);
  persistState(result);
  return result;
}

// ── Persistence ───────────────────────────────────────────────────────────────
function persistState(data) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const existing = fs.existsSync(STATE_FILE)
      ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
      : { history: [] };
    existing.latest    = { ...data, ts: Date.now() };
    existing.history   = [{ ...data, ts: Date.now() }, ...(existing.history || [])].slice(0, 48);
    fs.writeFileSync(STATE_FILE, JSON.stringify(existing, null, 2));
  } catch {}
}

function getCrossAssetState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {}
  return null;
}

module.exports = {
  crossAssetMultiplier,
  detectLeadLag,
  recordRegime,
  getCrossAssetState,
  REGIME_SCORE,
  ALT_WEIGHTS,
};
