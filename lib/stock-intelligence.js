/**
 * Stock Intelligence Engine — FreedomForge
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Covers Matty's actual portfolio + major market players.
 * Uses Yahoo Finance public chart API (no key needed).
 *
 * Portfolio positions tracked:
 *   XRP (BITWISE), AMZN, ASTS, TSLA, NVDA, IREN, BE, URNM, XAIX, ONDS
 *
 * Market intelligence:
 *   SPY, QQQ, VIX, DXY (via UUP), TLT (bonds), GLD, XLK, ARKK
 *
 * Analysis layers:
 *   1. Price action + RSI + volume trend
 *   2. Relative strength vs SPY
 *   3. 52-week positioning (where in the range)
 *   4. Portfolio P&L vs cost basis
 *   5. Market regime (bull/bear/correction)
 *   6. Sector rotation signals
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let log;
try { const { createLogger } = require('./logger'); log = createLogger('stock-intel'); }
catch { log = { info: console.log, warn: console.warn, error: console.error, debug() {} }; }

let signalBus;
try { signalBus = require('./agent-signal-bus'); } catch {}

// ─── Matty's Portfolio ────────────────────────────────────────────────────────
const MATTY_PORTFOLIO = [
  { symbol: 'XRP',  qty: 250,   avgCost: 18.659,  note: 'Bitwise XRP ETF' },
  { symbol: 'AMZN', qty: 10,    avgCost: 214.625, note: 'Amazon' },
  { symbol: 'ASTS', qty: 25,    avgCost: 88.908,  note: 'AST SpaceMobile' },
  { symbol: 'TSLA', qty: 4.279, avgCost: 389.39,  note: 'Tesla' },
  { symbol: 'NVDA', qty: 8,     avgCost: 173.306, note: 'NVIDIA' },
  { symbol: 'IREN', qty: 25,    avgCost: 41.42,   note: 'IREN Limited' },
  { symbol: 'BE',   qty: 5,     avgCost: 148.344, note: 'Bloom Energy' },
  { symbol: 'URNM', qty: 5,     avgCost: 69.414,  note: 'Sprott Uranium ETF' },
  { symbol: 'XAIX', qty: 6,     avgCost: 42.75,   note: 'DBX AI ETF' },
  { symbol: 'ONDS', qty: 25,    avgCost: 10.03,   note: 'Ondas Inc' },
];

// ─── Market Benchmarks ────────────────────────────────────────────────────────
const BENCHMARKS = ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD', 'UUP', 'ARKK', 'XLK'];

// ─── Major Players to Watch ───────────────────────────────────────────────────
const MAJOR_PLAYERS = ['AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN', 'NVDA', 'TSLA', 'AMD', 'INTC', 'PLTR', 'SMCI', 'MSTR', 'COIN'];

const STATE_FILE = path.resolve(process.cwd(), 'data/stock-intelligence-state.json');
let _state = loadState();

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
};
// Retry with backoff on 429
async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1500 * i));
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(url, { signal: ctrl.signal, headers: HEADERS });
      clearTimeout(t);
      if (r.status === 429 && i < retries - 1) continue;
      return r;
    } catch (e) { if (i === retries - 1) throw e; }
  }
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

async function fetchYahooChart(symbol, interval = '1d', range = '60d') {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}&includePrePost=false`;
    const r = await fetchWithRetry(url);
    if (!r || !r.ok) return null;
    const d = await r.json();
    const result = d.chart?.result?.[0];
    if (!result) return null;
    
    const meta    = result.meta || {};
    const quotes  = result.indicators?.quote?.[0] || {};
    const closes  = (quotes.close  || []).filter(Boolean);
    const highs   = (quotes.high   || []).filter(Boolean);
    const lows    = (quotes.low    || []).filter(Boolean);
    const volumes = (quotes.volume || []).filter(Boolean);
    const ts      = (result.timestamp || []);
    
    const current  = meta.regularMarketPrice || closes[closes.length - 1];
    const prev     = meta.chartPreviousClose || closes[closes.length - 2];
    const change1d = prev ? (current - prev) / prev * 100 : 0;
    const change1m = closes.length > 20 ? (current - closes[closes.length - 21]) / closes[closes.length - 21] * 100 : 0;
    const avgVol   = volumes.length ? volumes.reduce((a,b)=>a+b,0) / volumes.length : 0;
    const lastVol  = volumes[volumes.length - 1] || avgVol;
    
    return {
      symbol, current, prev,
      change1d, change1m,
      rsi: computeRSI(closes),
      macdSignal: computeMACDSignal(closes),
      bollingerPos: computeBollingerPos(closes),
      emaSlope: computeEMASlope(closes, 21),
      avgVol, volRatio: avgVol > 0 ? lastVol / avgVol : 1,
      high52w: meta.fiftyTwoWeekHigh, low52w: meta.fiftyTwoWeekLow,
      rangePos: meta.fiftyTwoWeekHigh && meta.fiftyTwoWeekLow ? (current - meta.fiftyTwoWeekLow) / (meta.fiftyTwoWeekHigh - meta.fiftyTwoWeekLow) : 0.5,
      mktCap: meta.marketCap,
      closes, highs, lows, volumes, ts,
    };
  } catch { return null; }
}

// ─── Technical Indicators ─────────────────────────────────────────────────────

function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    if (d > 0) gains += d; else losses -= d;
  }
  const rs = gains / Math.max(0.001, losses);
  return 100 - 100 / (1 + rs);
}

function computeMACDSignal(closes) {
  if (closes.length < 26) return 'neutral';
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  const macd  = ema12 - ema26;
  // Signal line = 9-period EMA of MACD (approximated)
  const prevMacd = computeEMA(closes.slice(0,-1), 12) - computeEMA(closes.slice(0,-1), 26);
  if (macd > prevMacd && macd > 0) return 'bullish_cross';
  if (macd < prevMacd && macd < 0) return 'bearish_cross';
  if (macd > 0) return 'above_zero';
  return 'below_zero';
}

function computeEMA(closes, period) {
  if (closes.length < period) return closes[closes.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function computeEMASlope(closes, period = 21) {
  if (closes.length < period + 1) return 0;
  const ema1 = computeEMA(closes, period);
  const ema2 = computeEMA(closes.slice(0, -1), period);
  return ema1 > 0 ? (ema1 - ema2) / ema1 : 0;
}

function computeBollingerPos(closes, period = 20) {
  if (closes.length < period) return 0.5;
  const slice = closes.slice(-period);
  const mean  = slice.reduce((a,b) => a+b, 0) / period;
  const std   = Math.sqrt(slice.reduce((a,b) => a + (b-mean)**2, 0) / period);
  const upper = mean + 2 * std, lower = mean - 2 * std;
  const cur   = closes[closes.length - 1];
  return std > 0 ? (cur - lower) / (upper - lower) : 0.5;
}

// ─── Signal Generation ────────────────────────────────────────────────────────

function generateSignal(stockData, spyData = null) {
  if (!stockData) return { side: 'neutral', confidence: 0.50, score: 0 };
  
  const { rsi, macdSignal, bollingerPos, emaSlope, change1d, change1m, volRatio, rangePos } = stockData;
  
  let score = 0;
  const reasons = [];

  // RSI (25% weight)
  if (rsi < 25) { score += 0.70; reasons.push(`RSI=${rsi.toFixed(0)} OVERSOLD`); }
  else if (rsi < 35) { score += 0.40; reasons.push(`RSI=${rsi.toFixed(0)} oversold`); }
  else if (rsi < 45) { score += 0.15; reasons.push(`RSI=${rsi.toFixed(0)}`); }
  else if (rsi > 75) { score -= 0.70; reasons.push(`RSI=${rsi.toFixed(0)} OVERBOUGHT`); }
  else if (rsi > 65) { score -= 0.35; reasons.push(`RSI=${rsi.toFixed(0)} overbought`); }
  else if (rsi > 55) { score -= 0.15; }

  // MACD (20% weight)
  if (macdSignal === 'bullish_cross') { score += 0.50; reasons.push('MACD bullish cross'); }
  else if (macdSignal === 'above_zero') { score += 0.20; }
  else if (macdSignal === 'bearish_cross') { score -= 0.50; reasons.push('MACD bearish cross'); }
  else if (macdSignal === 'below_zero') { score -= 0.20; }

  // Bollinger Position (15% weight)
  if (bollingerPos < 0.1) { score += 0.50; reasons.push('Below lower Bollinger band'); }
  else if (bollingerPos < 0.25) { score += 0.25; }
  else if (bollingerPos > 0.9) { score -= 0.50; reasons.push('Above upper Bollinger band'); }
  else if (bollingerPos > 0.75) { score -= 0.20; }

  // EMA Slope / Trend (20% weight)
  const slopePct = emaSlope * 100;
  if (slopePct > 0.3) { score += 0.40; reasons.push('EMA trending up'); }
  else if (slopePct > 0.1) score += 0.20;
  else if (slopePct < -0.3) { score -= 0.40; reasons.push('EMA trending down'); }
  else if (slopePct < -0.1) score -= 0.20;

  // Volume confirmation (10% weight)
  if (volRatio > 2.0 && score > 0) { score += 0.20; reasons.push(`Volume surge ${volRatio.toFixed(1)}x`); }
  else if (volRatio > 2.0 && score < 0) { score -= 0.20; reasons.push(`Volume surge on downside`); }

  // Relative strength vs SPY (10% weight)
  if (spyData && spyData.change1d !== undefined) {
    const relStrength = change1d - spyData.change1d;
    if (relStrength > 2) { score += 0.25; reasons.push(`Outperforming SPY by +${relStrength.toFixed(1)}%`); }
    else if (relStrength < -2) { score -= 0.20; reasons.push(`Underperforming SPY by ${relStrength.toFixed(1)}%`); }
  }

  // Normalize
  const side = score > 0.08 ? 'buy' : score < -0.08 ? 'sell' : 'neutral';
  const confidence = Math.min(0.92, 0.50 + Math.abs(score) * 0.45);

  return { side, confidence, score, reasons };
}

// ─── Portfolio Analysis ───────────────────────────────────────────────────────

function analyzePortfolio(stockDataMap) {
  const positions = [];
  let totalValue = 0, totalCost = 0;
  
  for (const pos of MATTY_PORTFOLIO) {
    const data = stockDataMap[pos.symbol];
    if (!data) continue;
    
    const currentValue = data.current * pos.qty;
    const costBasis    = pos.avgCost * pos.qty;
    const pnl          = currentValue - costBasis;
    const pnlPct       = costBasis > 0 ? pnl / costBasis * 100 : 0;
    
    totalValue += currentValue;
    totalCost  += costBasis;
    
    const signal = generateSignal(data, stockDataMap['SPY']);
    
    positions.push({
      ...pos, ...data,
      currentValue, costBasis, pnl, pnlPct,
      signal: signal.side, signalConf: signal.confidence, signalScore: signal.score,
      signalReasons: signal.reasons,
    });
  }
  
  const totalPnl    = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? totalPnl / totalCost * 100 : 0;
  
  // Sort by signal conviction + P&L
  const watchlist  = positions.filter(p => p.signal === 'buy').sort((a,b) => b.signalConf - a.signalConf);
  const caution    = positions.filter(p => p.signal === 'sell').sort((a,b) => a.pnlPct - b.pnlPct);
  const biggestLosers = [...positions].sort((a,b) => a.pnlPct - b.pnlPct).slice(0, 3);
  const biggestWinners = [...positions].sort((a,b) => b.pnlPct - a.pnlPct).slice(0, 3);
  
  return { positions, totalValue, totalCost, totalPnl, totalPnlPct, watchlist, caution, biggestLosers, biggestWinners };
}

// ─── Market Regime ────────────────────────────────────────────────────────────

function detectStockMarketRegime(benchmarkData) {
  const spy = benchmarkData['SPY'], qqq = benchmarkData['QQQ'];
  if (!spy) return { regime: 'unknown', confidence: 0 };
  
  let bearPoints = 0, bullPoints = 0;
  
  if (spy.change1d < -2) bearPoints += 2;
  else if (spy.change1d > 2) bullPoints += 2;
  
  if (spy.change1m < -5) bearPoints += 2;
  else if (spy.change1m > 5) bullPoints += 2;
  
  if (spy.rsi < 40) bearPoints += 2;
  else if (spy.rsi > 60) bullPoints += 2;
  
  if (spy.emaSlope < -0.001) bearPoints += 1;
  else if (spy.emaSlope > 0.001) bullPoints += 1;
  
  if (qqq) {
    if (qqq.rsi < 40) bearPoints += 1;
    else if (qqq.rsi > 60) bullPoints += 1;
  }
  
  const total = bearPoints + bullPoints;
  if (total === 0) return { regime: 'neutral', confidence: 0.5 };
  
  if (bearPoints >= 6) return { regime: 'correction', confidence: bearPoints / total };
  if (bearPoints > bullPoints) return { regime: 'bearish', confidence: bearPoints / total };
  if (bullPoints >= 6) return { regime: 'bullish', confidence: bullPoints / total };
  return { regime: 'neutral', confidence: 0.5 };
}

// ─── Main Cycle ──────────────────────────────────────────────────────────────

async function runStockCycle() {
  const t0 = Date.now();
  log.info('Stock intelligence cycle starting');
  
  try {
    // Fetch with controlled concurrency (Yahoo rate limits parallel requests)
    const allSymbols = [...new Set([
      ...MATTY_PORTFOLIO.map(p => p.symbol),
      ...BENCHMARKS,
      ...MAJOR_PLAYERS,
    ])];
    
    // Stagger: 2 concurrent, 500ms between groups to avoid 429
    const stockDataMap = {};
    const concurrency = 2;
    for (let i = 0; i < allSymbols.length; i += concurrency) {
      const batch = allSymbols.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(sym => fetchYahooChart(sym)));
      results.forEach((data, idx) => { if (data) stockDataMap[batch[idx]] = data; });
      await new Promise(r => setTimeout(r, 600));
    }
    
    // Analyze portfolio
    const portfolioAnalysis = analyzePortfolio(stockDataMap);
    
    // Detect market regime
    const benchmarkData = {};
    BENCHMARKS.forEach(sym => { if (stockDataMap[sym]) benchmarkData[sym] = stockDataMap[sym]; });
    const marketRegime = detectStockMarketRegime(benchmarkData);
    
    // Find top opportunities across ALL tracked stocks
    const allOpportunities = [];
    for (const [sym, data] of Object.entries(stockDataMap)) {
      const sig = generateSignal(data, stockDataMap['SPY']);
      if (sig.side !== 'neutral' && sig.confidence > 0.62) {
        allOpportunities.push({ symbol: sym, ...sig, price: data.current, change1d: data.change1d, rsi: data.rsi });
      }
    }
    allOpportunities.sort((a,b) => b.confidence - a.confidence);
    
    // Publish to signal bus
    if (signalBus) {
      signalBus.publish({
        type: 'stock_market_regime',
        source: 'stock-intelligence',
        confidence: marketRegime.confidence,
        ttl: 30 * 60 * 1000,
        payload: { regime: marketRegime.regime, spy: stockDataMap['SPY']?.change1d, qqq: stockDataMap['QQQ']?.change1d },
      });
      
      for (const opp of allOpportunities.slice(0, 5)) {
        signalBus.publish({
          type: 'stock_opportunity',
          source: 'stock-intelligence',
          confidence: opp.confidence,
          ttl: 15 * 60 * 1000,
          payload: opp,
        });
      }
    }
    
    // Save state
    _state = {
      lastCycle: Date.now(),
      cycleCount: (_state.cycleCount || 0) + 1,
      portfolioAnalysis,
      marketRegime,
      topOpportunities: allOpportunities.slice(0, 10),
      stockDataMap: Object.fromEntries(Object.entries(stockDataMap).map(([k,v]) => [k, { current: v.current, change1d: v.change1d, rsi: v.rsi, macdSignal: v.macdSignal }])),
    };
    saveState(_state);
    
    log.info(`Stock cycle done in ${Date.now()-t0}ms | Portfolio: $${portfolioAnalysis.totalValue.toFixed(0)} (${portfolioAnalysis.totalPnlPct.toFixed(1)}%) | Regime: ${marketRegime.regime}`);
    return _state;
  } catch (e) {
    log.error('Stock cycle error', { err: e.message });
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function loadState() {
  try { if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE,'utf8')); } catch {}
  return { cycleCount: 0 };
}
function saveState(s) {
  try { fs.mkdirSync(path.dirname(STATE_FILE),{recursive:true}); fs.writeFileSync(STATE_FILE, JSON.stringify(s,null,2)); } catch {}
}

module.exports = {
  runStockCycle,
  getPortfolioAnalysis: () => _state.portfolioAnalysis || null,
  getMarketRegime: () => _state.marketRegime || { regime: 'unknown' },
  getTopOpportunities: () => _state.topOpportunities || [],
  getStockSignal: (symbol) => {
    const snap = _state.stockDataMap?.[symbol];
    if (!snap) return null;
    return snap;
  },
  MATTY_PORTFOLIO,
};
