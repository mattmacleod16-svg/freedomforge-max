/**
 * Drawdown Intelligence — FreedomForge
 * ═══════════════════════════════════════════════════════════════════════════
 * Monitors real-time PnL drawdown and automatically adjusts Kelly sizing,
 * position limits, and strategy aggression in response to losing streaks.
 *
 * Behavior:
 *   HEALTHY  (DD < 5%):  Full Kelly, normal operation
 *   CAUTION  (5-10%):    Reduce to 75% Kelly, increase min confidence
 *   DANGER   (10-15%):   Reduce to 50% Kelly, stricter thresholds
 *   SEVERE   (15-20%):   Reduce to 25% Kelly, only high-confidence trades
 *   HALT     (> 20%):    Pause trading completely, alert user
 *
 * Also tracks:
 *   - Consecutive losing streak (trigger at 3/5/7 losses in a row)
 *   - Win-rate rolling 20-trade window (below 45% = caution mode)
 *   - Time-of-day patterns (score trades by past performance at same hour)
 *
 * Emits events on the signal bus for the edge-detector to read.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let log;
try { const { createLogger } = require('./logger'); log = createLogger('drawdown-intel'); }
catch { log = { info: console.log, warn: console.warn, error: console.error, debug() {} }; }

let _signalBus = null;
try { _signalBus = require('./agent-signal-bus'); } catch {}

const STATE_FILE = path.resolve(process.cwd(), 'data/drawdown-state.json');
const JOURNAL_FILE = path.resolve(process.cwd(), 'data/trade-journal.json');

// ── Thresholds ──────────────────────────────────────────────────────────────
const DD_CAUTION = Number(process.env.DD_CAUTION_PCT  || 5)  / 100;
const DD_DANGER  = Number(process.env.DD_DANGER_PCT   || 10) / 100;
const DD_SEVERE  = Number(process.env.DD_SEVERE_PCT   || 15) / 100;
const DD_HALT    = Number(process.env.DD_HALT_PCT     || 20) / 100;
const STREAK_WARN   = parseInt(process.env.DD_STREAK_WARN   || '3', 10);
const STREAK_DANGER = parseInt(process.env.DD_STREAK_DANGER || '5', 10);
const STREAK_HALT   = parseInt(process.env.DD_STREAK_HALT   || '7', 10);
const ROLLING_WINDOW = parseInt(process.env.DD_ROLLING_WINDOW || '20', 10);
const MIN_WIN_RATE   = Number(process.env.DD_MIN_WIN_RATE || 0.45);

// ── State helpers ───────────────────────────────────────────────────────────
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {}
  return { peakEquity: 0, currentEquity: 0, drawdown: 0, mode: 'healthy', streak: 0, history: [], lastUpdated: 0 };
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, lastUpdated: Date.now() }, null, 2));
  } catch {}
}

// ── Journal reader ──────────────────────────────────────────────────────────
function readClosedTrades() {
  try {
    if (!fs.existsSync(JOURNAL_FILE)) return [];
    const j = JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf8'));
    return (j.trades || []).filter(t => t.closedAt && t.pnl != null).sort((a,b) => new Date(a.closedAt) - new Date(b.closedAt));
  } catch { return []; }
}

// ── Core analysis ──────────────────────────────────────────────────────────
function analyzeDrawdown() {
  const trades = readClosedTrades();
  if (trades.length === 0) {
    return { mode: 'healthy', drawdown: 0, streak: 0, kellyMultiplier: 1.0, halted: false };
  }

  // Compute equity curve from PnL
  let equity = Number(process.env.TRADING_ACCOUNT_USD || 1000);
  let peakEquity = equity;
  let maxDrawdown = 0;

  const equityCurve = [];
  for (const t of trades) {
    equity += (t.pnl || 0) - (t.fees || 0);
    if (equity > peakEquity) peakEquity = equity;
    const dd = (peakEquity - equity) / peakEquity;
    if (dd > maxDrawdown) maxDrawdown = dd;
    equityCurve.push({ ts: t.closedAt, equity: Math.round(equity * 100) / 100, dd });
  }

  const currentDD = equityCurve[equityCurve.length - 1]?.dd || 0;

  // Consecutive loss streak
  let streak = 0;
  for (let i = trades.length - 1; i >= 0; i--) {
    if (trades[i].outcome === 'loss') streak++;
    else break;
  }

  // Rolling win rate (last N trades)
  const recent = trades.slice(-ROLLING_WINDOW);
  const wins = recent.filter(t => t.outcome === 'win').length;
  const rollingWinRate = recent.length > 0 ? wins / recent.length : 0.5;

  // Time-of-day pattern
  const hourStats = {};
  for (const t of trades) {
    const h = new Date(t.closedAt).getHours();
    if (!hourStats[h]) hourStats[h] = { wins: 0, losses: 0 };
    if (t.outcome === 'win') hourStats[h].wins++;
    else hourStats[h].losses++;
  }
  const currentHour = new Date().getHours();
  const hourWR = hourStats[currentHour] ? hourStats[currentHour].wins / (hourStats[currentHour].wins + hourStats[currentHour].losses) : null;

  // ── Determine mode ────────────────────────────────────────────────────────
  let mode = 'healthy';
  let kellyMultiplier = 1.0;
  let minConfidenceBoost = 0; // how much to raise the minConfidence threshold

  // Halt conditions (most severe first)
  if (currentDD >= DD_HALT || streak >= STREAK_HALT) {
    mode = 'halted';
    kellyMultiplier = 0;
    minConfidenceBoost = 0.20;
  } else if (currentDD >= DD_SEVERE || streak >= STREAK_DANGER) {
    mode = 'severe';
    kellyMultiplier = 0.25;
    minConfidenceBoost = 0.12;
  } else if (currentDD >= DD_DANGER || (rollingWinRate < MIN_WIN_RATE && recent.length >= 10)) {
    mode = 'danger';
    kellyMultiplier = 0.50;
    minConfidenceBoost = 0.08;
  } else if (currentDD >= DD_CAUTION || streak >= STREAK_WARN) {
    mode = 'caution';
    kellyMultiplier = 0.75;
    minConfidenceBoost = 0.04;
  }

  // Hour penalty: if this hour historically has < 40% WR, reduce Kelly
  if (hourWR !== null && hourWR < 0.40 && trades.length >= 30) {
    kellyMultiplier *= 0.8;
    log.debug('hour-of-day penalty applied', { hour: currentHour, wr: hourWR.toFixed(2) });
  }

  const result = {
    mode,
    drawdown:         Math.round(currentDD * 10000) / 100, // as percentage
    maxDrawdown:      Math.round(maxDrawdown * 10000) / 100,
    peakEquity:       Math.round(peakEquity * 100) / 100,
    currentEquity:    Math.round(equity * 100) / 100,
    streak,
    rollingWinRate:   Math.round(rollingWinRate * 1000) / 10,
    rollingWindow:    recent.length,
    kellyMultiplier:  Math.max(0, Math.min(1, kellyMultiplier)),
    minConfidenceBoost,
    hourWR,
    halted: mode === 'halted',
    totalTrades: trades.length,
    equityCurve: equityCurve.slice(-50), // last 50 points
    lastUpdated: new Date().toISOString(),
  };

  saveState(result);

  // Publish to signal bus for edge-detector
  if (_signalBus) {
    try {
      _signalBus.publish({
        type:       'drawdown_state',
        payload:    { mode, kellyMultiplier: result.kellyMultiplier, minConfidenceBoost, drawdown: result.drawdown },
        source:     'drawdown-intelligence',
        ttlMs:      30 * 60 * 1000,
      });
    } catch {}
  }

  if (mode !== 'healthy') {
    log.warn(`Drawdown mode: ${mode.toUpperCase()} | DD=${result.drawdown}% | streak=${streak} | Kelly×${kellyMultiplier}`, result);
  }

  return result;
}

// ── Edge-detector integration: read drawdown state ─────────────────────────
function getDrawdownMultiplier() {
  try {
    const state = loadState();
    const ageMs = Date.now() - (state.lastUpdated || 0);
    if (ageMs > 60 * 60 * 1000) return 1.0; // state too old, ignore
    return state.kellyMultiplier ?? 1.0;
  } catch { return 1.0; }
}

function isHalted() {
  try {
    const state = loadState();
    const ageMs = Date.now() - (state.lastUpdated || 0);
    return ageMs < 60 * 60 * 1000 && state.halted === true;
  } catch { return false; }
}

module.exports = { analyzeDrawdown, getDrawdownMultiplier, isHalted };
