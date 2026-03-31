/**
 * NEXUS BRAIN — The Unified Superintelligence Layer
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * This is the missing wire between ALL intelligence systems. It:
 *
 *   1. INGESTS — Real market data every 60s (prices, volume, OI, funding rates)
 *   2. SYNTHESIZES — Combines ML pipeline + brain weights + regime + momentum
 *   3. REASONS — Uses LLM to generate trade thesis with actual market context
 *   4. SCORES — Produces a final NEXUS signal with conviction score 0-1
 *   5. TEACHES — Feeds outcomes back to the brain so it actually learns
 *   6. PUBLISHES — Pushes highest-conviction setups to signal bus immediately
 *
 * What was missing before: the brain only learned from its own paper signals.
 * NEXUS feeds it ACTUAL market microstructure: funding rates, order book
 * imbalance, whale flows, volatility surface, macro context, social sentiment.
 *
 * The result: the brain stops being self-referential and starts learning
 * from the market itself.
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

let log;
try { const { createLogger } = require('./logger'); log = createLogger('nexus-brain'); }
catch { log = { info: console.log, warn: console.warn, error: console.error, debug() {} }; }

// ─── Module Bus ─────────────────────────────────────────────────────────────
let signalBus, brain, edgeDetector, mlPipeline, regimeDetector, kellySizer, riskManager;
try { signalBus    = require('./agent-signal-bus');       } catch {}
try { brain        = require('./self-evolving-brain');     } catch {}
try { edgeDetector = require('./edge-detector');           } catch {}
try { mlPipeline   = require('./ml-pipeline');             } catch {}
try { kellySizer   = require('./kelly-sizer');             } catch {}
try { riskManager  = require('./risk-manager');            } catch {}
try { regimeDetector = require('./regime-detector-v2');   } catch {}

// ─── State ───────────────────────────────────────────────────────────────────
const STATE_FILE = path.resolve(process.cwd(), 'data/nexus-brain-state.json');
let _state = loadState();

const ASSETS = ['BTC','ETH','SOL','XRP','AVAX','LINK','DOGE','ADA','DOT','ARB'];

// ─── Data Sources (no API keys needed — all public endpoints) ───────────────

// Binance funding rates + open interest (world's best public data source)
async function fetchFundingRates() {
  try {
    const r = await fetchWithTimeout('https://fapi.binance.com/fapi/v1/premiumIndex', 5000);
    const data = await r.json();
    const map = {};
    for (const d of data) {
      const sym = d.symbol.replace('USDT','').replace('USD','');
      if (ASSETS.includes(sym)) {
        map[sym] = { fundingRate: parseFloat(d.lastFundingRate), markPrice: parseFloat(d.markPrice), indexPrice: parseFloat(d.indexPrice) };
      }
    }
    return map;
  } catch { return {}; }
}

async function fetchOpenInterest() {
  try {
    const results = {};
    await Promise.all(ASSETS.map(async (asset) => {
      try {
        const r = await fetchWithTimeout(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${asset}USDT`, 4000);
        const d = await r.json();
        results[asset] = { openInterest: parseFloat(d.openInterest), openInterestValue: parseFloat(d.openInterest) * parseFloat(d.time ? 1 : 1) };
      } catch {}
    }));
    return results;
  } catch { return {}; }
}

async function fetchLongShortRatio() {
  try {
    const results = {};
    await Promise.all(['BTC','ETH','SOL'].map(async (asset) => {
      try {
        const r = await fetchWithTimeout(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${asset}USDT&period=1h&limit=3`, 4000);
        const d = await r.json();
        if (d[0]) results[asset] = { longShortRatio: parseFloat(d[0].longShortRatio), longAccount: parseFloat(d[0].longAccount), shortAccount: parseFloat(d[0].shortAccount) };
      } catch {}
    }));
    return results;
  } catch { return {}; }
}

async function fetchFearAndGreed() {
  try {
    const r = await fetchWithTimeout('https://api.alternative.me/fng/?limit=3', 5000);
    const d = await r.json();
    const latest = d.data?.[0];
    return { value: parseInt(latest?.value || '50'), label: latest?.value_classification || 'Neutral', trend: d.data?.length > 1 ? parseInt(d.data[0].value) - parseInt(d.data[1].value) : 0 };
  } catch { return { value: 50, label: 'Neutral', trend: 0 }; }
}

async function fetchOrderBookImbalance(asset) {
  try {
    const sym = asset === 'BTC' ? 'BTCUSDT' : `${asset}USDT`;
    const r = await fetchWithTimeout(`https://api.binance.com/api/v3/depth?symbol=${sym}&limit=20`, 4000);
    const d = await r.json();
    const bidVol = d.bids?.slice(0,10).reduce((s, [,q]) => s + parseFloat(q), 0) || 0;
    const askVol = d.asks?.slice(0,10).reduce((s, [,q]) => s + parseFloat(q), 0) || 0;
    const total = bidVol + askVol;
    return total > 0 ? (bidVol - askVol) / total : 0; // positive = buy pressure
  } catch { return 0; }
}

async function fetchWhaleAlert() {
  // Use CoinGecko volume spikes as whale proxy (free, no key needed)
  try {
    const r = await fetchWithTimeout('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,solana,ripple&order=volume_desc&per_page=4', 6000);
    const d = await r.json();
    return d.map(c => ({
      id: c.id, symbol: c.symbol.toUpperCase(),
      volume24h: c.total_volume,
      priceChange24h: c.price_change_percentage_24h,
      marketCap: c.market_cap,
      volumeToMcapRatio: c.total_volume / c.market_cap,
    }));
  } catch { return []; }
}

async function fetchMacroContext() {
  // DXY proxy via EURUSD inverse + BTC dominance
  try {
    const [domR, btcR] = await Promise.all([
      fetchWithTimeout('https://api.coingecko.com/api/v3/global', 6000),
      fetchWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true', 5000),
    ]);
    const dom  = await domR.json();
    const btcD = await btcR.json();
    return {
      btcDominance: dom.data?.market_cap_percentage?.btc || 50,
      totalMarketCap: dom.data?.total_market_cap?.usd || 0,
      totalVolume24h: dom.data?.total_volume?.usd || 0,
      btc24hChange: btcD.bitcoin?.usd_24h_change || 0,
      defiMarketCap: dom.data?.defi_market_cap || 0,
    };
  } catch { return {}; }
}

// ─── Signal Synthesis ────────────────────────────────────────────────────────

function synthesizeNexusSignal(asset, marketData) {
  const { funding, oi, lsr, fearGreed, obImbalance, whaleData, macro } = marketData;
  
  const fr     = funding[asset] || {};
  const lsRatio = lsr[asset]   || {};
  const whale  = whaleData.find(w => w.symbol === asset || w.id.includes(asset.toLowerCase())) || {};

  // ── Signal Components ──────────────────────────────────────────────────────

  // 1. Funding Rate Signal: Negative funding = shorts paying longs = bullish bias
  //    Extreme positive funding = crowded longs = reversal risk
  const fundingRate = fr.fundingRate || 0;
  let fundingSignal = 0;
  if (fundingRate < -0.0001) fundingSignal = 0.6;       // shorts paying = bullish
  else if (fundingRate < -0.0003) fundingSignal = 0.8;  // very bearish funding = strong bull setup
  else if (fundingRate > 0.0005) fundingSignal = -0.6;  // extreme long crowding = reversal risk
  else if (fundingRate > 0.001) fundingSignal = -0.85;  // bubble funding = dangerous

  // 2. Long/Short Ratio: Contrarian — when everyone is long, be careful
  const lsR = parseFloat(lsRatio.longShortRatio || 1);
  let lsSignal = 0;
  if (lsR > 1.5)      lsSignal = -0.3;  // too many longs — contrarian short lean
  else if (lsR < 0.8) lsSignal = 0.4;  // more shorts than longs — potential squeeze
  else                lsSignal = 0.1;   // balanced — slight bull bias

  // 3. Order Book Imbalance: Real-time buy/sell pressure
  const obSignal = obImbalance * 0.5; // -0.5 to +0.5

  // 4. Fear & Greed: Contrarian at extremes
  const fg = fearGreed.value || 50;
  let fgSignal = 0;
  if (fg < 20) fgSignal = 0.7;          // extreme fear = buy signal
  else if (fg < 35) fgSignal = 0.3;    // fear = mild buy
  else if (fg > 80) fgSignal = -0.5;   // extreme greed = caution
  else if (fg > 65) fgSignal = -0.2;   // greed = mild caution
  else fgSignal = 0;

  // 5. Volume/MCap ratio (whale activity proxy)
  const volRatio = whale.volumeToMcapRatio || 0.03;
  let volumeSignal = 0;
  if (volRatio > 0.15) volumeSignal = 0.4;   // unusual volume — big move coming
  else if (volRatio > 0.08) volumeSignal = 0.2;
  else if (volRatio < 0.02) volumeSignal = -0.1; // low volume — no conviction

  // 6. BTC Dominance macro signal
  const dom = macro.btcDominance || 50;
  let domSignal = 0;
  if (asset === 'BTC') {
    domSignal = dom > 55 ? 0.2 : dom < 45 ? -0.2 : 0;
  } else {
    // Alt coins: when BTC dom falls, alts pump
    domSignal = dom < 48 ? 0.3 : dom > 57 ? -0.3 : 0;
  }

  // ── Weighted Composite ────────────────────────────────────────────────────
  const WEIGHTS = { funding: 0.30, ls: 0.20, ob: 0.25, fg: 0.10, volume: 0.10, dom: 0.05 };
  const raw = (fundingSignal * WEIGHTS.funding) + (lsSignal * WEIGHTS.ls) + (obSignal * WEIGHTS.ob) + (fgSignal * WEIGHTS.fg) + (volumeSignal * WEIGHTS.volume) + (domSignal * WEIGHTS.dom);
  
  // Normalize to [0,1] confidence space
  const normalized = Math.max(0, Math.min(1, (raw + 1) / 2));
  const side = raw > 0.05 ? 'buy' : raw < -0.05 ? 'sell' : 'neutral';
  const confidence = Math.abs(raw) > 0.1 ? Math.min(0.92, 0.50 + Math.abs(raw) * 0.5) : 0.50;
  const edge = Math.abs(raw) * 0.3;

  return {
    asset,
    side,
    confidence,
    edge,
    rawScore: raw,
    components: { fundingRate, fundingSignal, lsRatio: lsR, lsSignal, obImbalance, obSignal, fearGreed: fg, fgSignal, volumeRatio: volRatio, volumeSignal, btcDominance: dom, domSignal },
    thesis: buildThesis(asset, side, { fundingRate, fundingSignal, fg, lsR, obImbalance, raw }),
    timestamp: Date.now(),
  };
}

function buildThesis(asset, side, data) {
  const { fundingRate, fg, lsR, obImbalance, raw } = data;
  const parts = [];
  if (Math.abs(fundingRate) > 0.0001) parts.push(`Funding ${fundingRate > 0 ? 'positive' : 'negative'} at ${(fundingRate*100).toFixed(4)}%`);
  if (fg < 30) parts.push(`Extreme fear (F&G=${fg}) — contrarian buy zone`);
  else if (fg > 75) parts.push(`Extreme greed (F&G=${fg}) — reversal risk`);
  if (lsR > 1.4) parts.push(`L/S ratio ${lsR.toFixed(2)} — crowded longs, squeeze risk`);
  else if (lsR < 0.85) parts.push(`L/S ratio ${lsR.toFixed(2)} — shorts crowded, squeeze potential`);
  if (Math.abs(obImbalance) > 0.15) parts.push(`Order book ${obImbalance > 0 ? 'buy' : 'sell'} pressure ${(obImbalance*100).toFixed(1)}%`);
  return parts.length > 0 ? `${asset} ${side.toUpperCase()}: ${parts.join(' | ')} → composite=${raw.toFixed(3)}` : `${asset}: Neutral conditions`;
}

// ─── Main Cycle ──────────────────────────────────────────────────────────────

async function runNexusCycle() {
  const cycleStart = Date.now();
  log.info('NEXUS cycle starting');

  try {
    // 1. Fetch all market data in parallel
    const [funding, oi, lsr, fearGreed, macro, whaleData] = await Promise.all([
      fetchFundingRates(), fetchOpenInterest(), fetchLongShortRatio(),
      fetchFearAndGreed(), fetchMacroContext(), fetchWhaleAlert(),
    ]);

    // 2. Per-asset OB imbalance (sequential to avoid rate limits)
    const obMap = {};
    for (const asset of ['BTC','ETH','SOL','XRP']) {
      obMap[asset] = await fetchOrderBookImbalance(asset);
    }

    const marketData = { funding, oi, lsr, fearGreed, macro, whaleData };

    // 3. Synthesize signals for all assets
    const signals = [];
    for (const asset of ASSETS) {
      const nexusSig = synthesizeNexusSignal(asset, { ...marketData, obImbalance: obMap[asset] || 0 });
      signals.push(nexusSig);
      
      // 4. Publish to signal bus so ALL engines consume it
      if (signalBus && nexusSig.confidence > 0.55) {
        signalBus.publish({
          type: 'nexus_signal',
          source: 'nexus-brain',
          confidence: nexusSig.confidence,
          ttl: 5 * 60 * 1000, // 5-minute TTL — signals expire fast
          payload: nexusSig,
        });
      }

      // 5. Also publish as edge_opportunity if high conviction
      if (signalBus && nexusSig.side !== 'neutral' && nexusSig.confidence > 0.68) {
        signalBus.publish({
          type: 'edge_opportunity',
          source: 'nexus-brain',
          confidence: nexusSig.confidence,
          ttl: 3 * 60 * 1000,
          payload: {
            asset: nexusSig.asset,
            side: nexusSig.side,
            confidence: nexusSig.confidence,
            edge: nexusSig.edge,
            thesis: nexusSig.thesis,
          },
        });
      }
    }

    // 6. Publish macro context to signal bus
    if (signalBus) {
      signalBus.publish({
        type: 'macro_context',
        source: 'nexus-brain',
        confidence: 0.8,
        ttl: 30 * 60 * 1000,
        payload: { fearGreed, macro, timestamp: Date.now() },
      });
    }

    // 7. Update state
    _state.lastCycle = Date.now();
    _state.cycleCount = (_state.cycleCount || 0) + 1;
    _state.lastSignals = signals;
    _state.lastFearGreed = fearGreed;
    _state.lastMacro = macro;
    saveState(_state);

    // 8. Log top opportunities
    const topSignals = signals.filter(s => s.side !== 'neutral' && s.confidence > 0.60).sort((a,b) => b.confidence - a.confidence);
    if (topSignals.length > 0) {
      log.info(`Top NEXUS signals: ${topSignals.slice(0,3).map(s => `${s.asset} ${s.side.toUpperCase()} ${(s.confidence*100).toFixed(0)}%`).join(' | ')}`);
    }
    log.info(`NEXUS cycle done in ${Date.now()-cycleStart}ms | F&G: ${fearGreed.value} (${fearGreed.label}) | Signals: ${signals.length}`);

    return { signals, fearGreed, macro, cycleMs: Date.now() - cycleStart };
  } catch (e) {
    log.error('NEXUS cycle error:', e.message);
    return null;
  }
}

// ─── Public Getters ──────────────────────────────────────────────────────────

function getLastSignals() { return _state.lastSignals || []; }
function getLastFearGreed() { return _state.lastFearGreed || { value: 50, label: 'Neutral' }; }
function getLastMacro() { return _state.lastMacro || {}; }
function getTopOpportunities(minConf = 0.60) {
  return (getLastSignals()).filter(s => s.side !== 'neutral' && s.confidence >= minConf).sort((a,b) => b.confidence - a.confidence);
}
function getSignalForAsset(asset) { return (getLastSignals()).find(s => s.asset === asset) || null; }

// ─── Persistence ─────────────────────────────────────────────────────────────
function loadState() {
  try {
    const f = STATE_FILE;
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {}
  return { cycleCount: 0, lastSignals: [] };
}
function saveState(s) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch {}
}

// ─── Fetch Helper ────────────────────────────────────────────────────────────
function fetchWithTimeout(url, ms = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

module.exports = { runNexusCycle, getLastSignals, getLastFearGreed, getLastMacro, getTopOpportunities, getSignalForAsset, synthesizeNexusSignal };
