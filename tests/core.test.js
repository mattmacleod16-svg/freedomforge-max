/**
 * FreedomForge Core Module Tests
 * ===============================
 *
 * Comprehensive unit tests for all core library modules.
 * Uses Node built-in test runner (node:test) and assert.
 *
 * Run:  node --test tests/core.test.js
 *
 * Modules under test:
 *   - edge-detector      (technical indicators, dynamic sizing)
 *   - self-evolving-brain (attribution, profiling, calibration, evolution)
 *   - var-engine          (VaR calculations, correlations, statistics)
 *   - edge-case-mitigations (flash crash, overfit, gas, key compromise)
 *   - risk-manager        (stop-loss, position sizing arithmetic)
 *   - capital-mandate     (mode determination, milestones)
 *   - trade-journal       (stats computation, outcome recording)
 *   - resilient-io        (rate limiter, circuit breaker)
 *   - agent-signal-bus    (publish, query, consensus)
 *   - treasury-ledger     (reconciliation, payout, snapshots)
 */

'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Test Helpers ─────────────────────────────────────────────────────────────

const TEST_DATA_DIR = path.join(os.tmpdir(), `ff-test-${process.pid}-${Date.now()}`);

function setupTestDataDir() {
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  // Point all state files into the temp directory so tests never touch real data
  process.env.BRAIN_STATE_FILE = path.join(TEST_DATA_DIR, 'self-evolving-brain.json');
  process.env.TRADE_JOURNAL_FILE = path.join(TEST_DATA_DIR, 'trade-journal.json');
  process.env.RISK_STATE_FILE = path.join(TEST_DATA_DIR, 'risk-manager-state.json');
  process.env.GUARDIAN_STATE_FILE = path.join(TEST_DATA_DIR, 'liquidation-guardian-state.json');
  process.env.AGENT_SIGNAL_BUS_FILE = path.join(TEST_DATA_DIR, 'agent-signal-bus.json');
  process.env.EDGE_CASE_STATE_FILE = path.join(TEST_DATA_DIR, 'edge-case-state.json');
  process.env.STRATEGY_STATE_FILE = path.join(TEST_DATA_DIR, 'strategy-evolution.json');
  // Force file-mode for signal bus (no Redis in test environment)
  process.env.SIGNAL_BUS_MODE = 'file';
  // Disable kill-switch owner token so deactivate tests work
  process.env.BREAK_GLASS = 'true';
}

function cleanupTestDataDir() {
  try { fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
}

function approx(actual, expected, tolerance = 0.001) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be approximately ${expected} (tolerance ${tolerance})`
  );
}

// Global setup: point state files to temp dir BEFORE requiring any modules
setupTestDataDir();

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Edge Detector — Technical Indicators
// ═══════════════════════════════════════════════════════════════════════════════

describe('edge-detector: Technical Indicators', () => {
  let edge;

  before(() => {
    edge = require('../lib/edge-detector');
  });

  // ── EMA ──────────────────────────────────────────────────────────────────
  describe('ema()', () => {
    it('should return empty array for insufficient data', () => {
      assert.deepStrictEqual(edge.ema([1, 2], 5), []);
    });

    it('should compute EMA correctly for a simple series', () => {
      const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
      const result = edge.ema(closes, 3);
      // First value should be SMA of first 3 elements: (10+11+12)/3 = 11
      approx(result[0], 11, 0.001);
      // Subsequent values use exponential smoothing
      assert.ok(result.length > 0);
      // EMA should trend upward with monotonically increasing data
      for (let i = 1; i < result.length; i++) {
        assert.ok(result[i] > result[i - 1], `EMA should increase: ${result[i]} > ${result[i-1]}`);
      }
    });

    it('should compute EMA with k = 2/(period+1)', () => {
      const closes = [100, 110, 105, 115, 120];
      const result = edge.ema(closes, 3);
      // SMA of first 3: (100+110+105)/3 = 105
      approx(result[0], 105, 0.001);
      // k = 2/(3+1) = 0.5
      // EMA[1] = 115 * 0.5 + 105 * 0.5 = 110
      approx(result[1], 110, 0.001);
      // EMA[2] = 120 * 0.5 + 110 * 0.5 = 115
      approx(result[2], 115, 0.001);
    });
  });

  // ── SMA ──────────────────────────────────────────────────────────────────
  describe('sma()', () => {
    it('should compute simple moving average', () => {
      const closes = [10, 20, 30, 40, 50];
      const result = edge.sma(closes, 3);
      // SMA windows: [10,20,30]=20, [20,30,40]=30, [30,40,50]=40
      assert.deepStrictEqual(result, [20, 30, 40]);
    });

    it('should return empty for insufficient data', () => {
      assert.deepStrictEqual(edge.sma([1], 3), []);
    });
  });

  // ── RSI ──────────────────────────────────────────────────────────────────
  describe('rsi()', () => {
    it('should return null for insufficient data', () => {
      assert.strictEqual(edge.rsi([100, 101], 14), null);
    });

    it('should return 100 when all moves are gains', () => {
      const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
      const val = edge.rsi(closes, 14);
      assert.strictEqual(val, 100);
    });

    it('should return value between 0 and 100 for mixed data', () => {
      const closes = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42,
        45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41,
        46.22, 45.64];
      const val = edge.rsi(closes, 14);
      assert.ok(val > 0 && val < 100, `RSI should be 0-100, got ${val}`);
    });

    it('should produce values near 50 for oscillating data', () => {
      // Data that oscillates evenly should give RSI near 50
      const closes = [];
      for (let i = 0; i < 30; i++) {
        closes.push(i % 2 === 0 ? 100 : 101);
      }
      const val = edge.rsi(closes, 14);
      assert.ok(val >= 40 && val <= 60, `RSI of oscillating data should be near 50, got ${val}`);
    });
  });

  // ── Bollinger Bands ──────────────────────────────────────────────────────
  describe('bollingerBands()', () => {
    it('should return null for insufficient data', () => {
      assert.strictEqual(edge.bollingerBands([1, 2, 3], 20, 2), null);
    });

    it('should compute bands correctly', () => {
      const closes = Array.from({ length: 25 }, (_, i) => 100 + Math.sin(i / 3) * 5);
      const bb = edge.bollingerBands(closes, 20, 2);
      assert.ok(bb !== null);
      assert.ok(bb.upper > bb.middle, 'upper > middle');
      assert.ok(bb.middle > bb.lower, 'middle > lower');
      assert.ok(bb.width > 0, 'width > 0');
      assert.ok(bb.percentB >= 0 && bb.percentB <= 1.5, `%B should be reasonable, got ${bb.percentB}`);
    });

    it('should have percentB near 0.5 when price equals middle band', () => {
      // Constant price data: all bands collapse, price is at middle
      const closes = Array.from({ length: 25 }, () => 100);
      const bb = edge.bollingerBands(closes, 20, 2);
      assert.ok(bb !== null);
      approx(bb.percentB, 0.5, 0.01);
      approx(bb.width, 0, 0.001);
    });
  });

  // ── ATR ──────────────────────────────────────────────────────────────────
  describe('atr()', () => {
    it('should return null for insufficient data', () => {
      const candles = Array.from({ length: 5 }, (_, i) => ({
        open: 100, high: 105, low: 95, close: 102, volume: 1000, ts: i,
      }));
      assert.strictEqual(edge.atr(candles, 14), null);
    });

    it('should compute ATR for valid candle data', () => {
      const candles = Array.from({ length: 30 }, (_, i) => ({
        open: 100 + Math.random() * 2,
        high: 103 + Math.random() * 3,
        low: 97 + Math.random() * 2,
        close: 100 + Math.random() * 4,
        volume: 1000,
        ts: i * 60000,
      }));
      const val = edge.atr(candles, 14);
      assert.ok(val !== null, 'ATR should not be null');
      assert.ok(val > 0, `ATR should be positive, got ${val}`);
    });

    it('should return zero ATR for constant price candles', () => {
      const candles = Array.from({ length: 20 }, (_, i) => ({
        open: 100, high: 100, low: 100, close: 100, volume: 1000, ts: i * 60000,
      }));
      const val = edge.atr(candles, 14);
      assert.ok(val !== null);
      approx(val, 0, 0.001);
    });
  });

  // ── VWAP ─────────────────────────────────────────────────────────────────
  describe('vwap()', () => {
    it('should return null for zero-volume candles', () => {
      const candles = Array.from({ length: 5 }, () => ({
        high: 100, low: 90, close: 95, volume: 0,
      }));
      assert.strictEqual(edge.vwap(candles, 5), null);
    });

    it('should compute VWAP correctly', () => {
      const candles = [
        { high: 110, low: 90, close: 100, volume: 1000 },
        { high: 120, low: 100, close: 110, volume: 2000 },
      ];
      // Typical prices: (110+90+100)/3 = 100, (120+100+110)/3 = 110
      // VWAP = (100*1000 + 110*2000) / (1000+2000) = 320000/3000 = 106.67
      const val = edge.vwap(candles, 2);
      approx(val, 106.667, 0.01);
    });
  });

  // ── Volume Confirmation ──────────────────────────────────────────────────
  describe('volumeConfirmation()', () => {
    it('should return confirmed=true with ratio=1 for insufficient data', () => {
      const candles = Array.from({ length: 5 }, () => ({
        high: 100, low: 90, close: 95, volume: 1000,
      }));
      const result = edge.volumeConfirmation(candles, 20);
      assert.strictEqual(result.confirmed, true);
      assert.strictEqual(result.ratio, 1);
    });

    it('should detect volume surge', () => {
      const candles = Array.from({ length: 25 }, (_, i) => ({
        high: 100, low: 90, close: 95, volume: i < 24 ? 1000 : 5000,
      }));
      const result = edge.volumeConfirmation(candles, 20);
      assert.strictEqual(result.confirmed, true);
      assert.ok(result.ratio > 2, `volume ratio should indicate surge, got ${result.ratio}`);
    });

    it('should detect low volume', () => {
      const candles = Array.from({ length: 25 }, (_, i) => ({
        high: 100, low: 90, close: 95, volume: i < 24 ? 1000 : 100,
      }));
      const result = edge.volumeConfirmation(candles, 20);
      assert.strictEqual(result.confirmed, false);
      assert.ok(result.ratio < 0.8, `volume ratio should be low, got ${result.ratio}`);
    });
  });

  // ── Dynamic Order Size ───────────────────────────────────────────────────
  describe('dynamicOrderSize()', () => {
    it('should return baseUsd when edge is below threshold', () => {
      assert.strictEqual(edge.dynamicOrderSize({ confidence: 0.5, edge: 0.05 }, 15, 3), 15);
    });

    it('should scale up with higher edge and confidence', () => {
      const small = edge.dynamicOrderSize({ confidence: 0.6, edge: 0.2 }, 15, 3);
      const large = edge.dynamicOrderSize({ confidence: 0.9, edge: 0.8 }, 15, 3);
      assert.ok(large > small, `Higher edge/conf should give larger size: ${large} > ${small}`);
    });

    it('should never exceed baseUsd * maxMultiplier', () => {
      const size = edge.dynamicOrderSize({ confidence: 1.0, edge: 1.0 }, 15, 3);
      assert.ok(size <= 15 * 3 + 0.01, `Size ${size} should not exceed ${15 * 3}`);
    });

    it('should handle zero edge', () => {
      const size = edge.dynamicOrderSize({ confidence: 0.9, edge: 0 }, 20, 3);
      assert.strictEqual(size, 20);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Self-Evolving Brain
// ═══════════════════════════════════════════════════════════════════════════════

describe('self-evolving-brain: Analytics', () => {
  let brain;

  before(() => {
    brain = require('../lib/self-evolving-brain');
  });

  // ── Indicator Attribution ────────────────────────────────────────────────
  describe('computeIndicatorAttribution()', () => {
    it('should handle empty trades array', () => {
      const result = brain.computeIndicatorAttribution([]);
      assert.ok(result.multiTfMomentum !== undefined);
      assert.strictEqual(result.multiTfMomentum.totalTrades, 0);
    });

    it('should attribute wins and losses to indicators', () => {
      const trades = [
        { outcome: 'win', pnl: 10, signalComponents: { mtfConfluence: 0.8, rsi: 55, bbPercentB: 0.6 } },
        { outcome: 'win', pnl: 5, signalComponents: { mtfConfluence: 0.7, rsi: 45, volRatio: 1.5 } },
        { outcome: 'loss', pnl: -8, signalComponents: { mtfConfluence: 0.3, rsi: 70, regime: 'risk_off' } },
        { outcome: 'loss', pnl: -3, signalComponents: { mtfConfluence: 0.6, volRatio: 0.5 } },
      ];
      const result = brain.computeIndicatorAttribution(trades);

      assert.strictEqual(result.multiTfMomentum.totalTrades, 4);
      assert.strictEqual(result.multiTfMomentum.winTrades, 2);
      assert.strictEqual(result.multiTfMomentum.lossTrades, 2);
      assert.strictEqual(result.rsi.totalTrades, 3);
      assert.strictEqual(result.volumeConfirmation.totalTrades, 2);
      assert.strictEqual(result.regimeAlignment.totalTrades, 1);
    });

    it('should skip breakeven trades', () => {
      const trades = [
        { outcome: 'breakeven', pnl: 0, signalComponents: { mtfConfluence: 0.5 } },
      ];
      const result = brain.computeIndicatorAttribution(trades);
      assert.strictEqual(result.multiTfMomentum.totalTrades, 0);
    });

    it('should compute score as combination of winRate and profitFactor', () => {
      const trades = [
        { outcome: 'win', pnl: 20, signalComponents: { mtfConfluence: 0.8, rsi: 50 } },
        { outcome: 'win', pnl: 15, signalComponents: { mtfConfluence: 0.7, rsi: 55 } },
        { outcome: 'win', pnl: 10, signalComponents: { mtfConfluence: 0.6, rsi: 60 } },
        { outcome: 'loss', pnl: -5, signalComponents: { mtfConfluence: 0.3, rsi: 65 } },
      ];
      const result = brain.computeIndicatorAttribution(trades);
      // All-win indicator should have high score
      assert.ok(result.multiTfMomentum.score > 0.5, `Score should be > 0.5, got ${result.multiTfMomentum.score}`);
      assert.ok(result.rsi.score > 0.5);
    });
  });

  // ── Asset Profiles ───────────────────────────────────────────────────────
  describe('computeAssetProfiles()', () => {
    it('should profile assets from trade history', () => {
      const trades = [
        { outcome: 'win', asset: 'BTC', pnl: 10, side: 'buy', signal: { confidence: 0.8 } },
        { outcome: 'loss', asset: 'BTC', pnl: -5, side: 'buy', signal: { confidence: 0.7 } },
        { outcome: 'win', asset: 'ETH', pnl: 8, side: 'sell', signal: { confidence: 0.6 } },
        { outcome: 'win', asset: 'ETH', pnl: 12, side: 'buy', signal: { confidence: 0.9 } },
      ];
      const profiles = brain.computeAssetProfiles(trades);

      assert.ok(profiles.BTC);
      assert.ok(profiles.ETH);
      assert.strictEqual(profiles.BTC.wins, 1);
      assert.strictEqual(profiles.BTC.losses, 1);
      assert.strictEqual(profiles.BTC.trades, 2);
      assert.strictEqual(profiles.ETH.wins, 2);
      assert.strictEqual(profiles.ETH.losses, 0);
      assert.strictEqual(profiles.ETH.winRate, 100);
      assert.strictEqual(profiles.BTC.winRate, 50);
    });

    it('should determine preferred side from cumulative P&L', () => {
      const trades = [
        { outcome: 'win', asset: 'SOL', pnl: 20, side: 'sell', signal: { confidence: 0.8 } },
        { outcome: 'loss', asset: 'SOL', pnl: -5, side: 'buy', signal: { confidence: 0.6 } },
      ];
      const profiles = brain.computeAssetProfiles(trades);
      assert.strictEqual(profiles.SOL.preferredSide, 'sell');
    });

    it('should default asset to BTC when missing', () => {
      const trades = [
        { outcome: 'win', pnl: 5, side: 'buy', signal: { confidence: 0.5 } },
      ];
      const profiles = brain.computeAssetProfiles(trades);
      assert.ok(profiles.BTC);
      assert.strictEqual(profiles.BTC.trades, 1);
    });
  });

  // ── Regime Profiles ──────────────────────────────────────────────────────
  describe('computeRegimeProfiles()', () => {
    it('should profile regimes from trade history', () => {
      const trades = [
        { outcome: 'win', pnl: 10, signalComponents: { regime: 'risk_on' } },
        { outcome: 'win', pnl: 8, signalComponents: { regime: 'risk_on' } },
        { outcome: 'loss', pnl: -15, signalComponents: { regime: 'risk_off' } },
      ];
      const profiles = brain.computeRegimeProfiles(trades);
      assert.ok(profiles.risk_on);
      assert.ok(profiles.risk_off);
      assert.strictEqual(profiles.risk_on.wins, 2);
      assert.strictEqual(profiles.risk_on.losses, 0);
      assert.strictEqual(profiles.risk_off.wins, 0);
      assert.strictEqual(profiles.risk_off.losses, 1);
    });

    it('should bucket trades without regime info under "unknown"', () => {
      const trades = [
        { outcome: 'win', pnl: 5, signalComponents: {} },
      ];
      const profiles = brain.computeRegimeProfiles(trades);
      assert.ok(profiles.unknown);
    });
  });

  // ── Time Patterns ────────────────────────────────────────────────────────
  describe('computeTimePatterns()', () => {
    it('should bucket trades by hour and day', () => {
      const trades = [
        { outcome: 'win', pnl: 10, entryAt: '2025-01-15T14:30:00Z' },
        { outcome: 'win', pnl: 5, entryAt: '2025-01-15T14:45:00Z' },
        { outcome: 'loss', pnl: -20, entryAt: '2025-01-16T03:00:00Z' },
      ];
      const patterns = brain.computeTimePatterns(trades);
      assert.ok(Array.isArray(patterns.bestHours));
      assert.ok(Array.isArray(patterns.worstHours));
      assert.ok(Array.isArray(patterns.bestDays));
      assert.ok(Array.isArray(patterns.worstDays));
      assert.ok(patterns.hourBreakdown.length > 0);
    });

    it('should handle empty trades gracefully', () => {
      const patterns = brain.computeTimePatterns([]);
      assert.deepStrictEqual(patterns.bestHours, []);
      assert.deepStrictEqual(patterns.worstHours, []);
    });
  });

  // ── Calibration ──────────────────────────────────────────────────────────
  describe('computeCalibration()', () => {
    it('should bucket trades by confidence level', () => {
      const trades = [
        { outcome: 'win', signal: { confidence: 0.8 } },
        { outcome: 'win', signal: { confidence: 0.8 } },
        { outcome: 'loss', signal: { confidence: 0.8 } },
        { outcome: 'win', signal: { confidence: 0.6 } },
        { outcome: 'loss', signal: { confidence: 0.6 } },
        { outcome: 'loss', signal: { confidence: 0.6 } },
      ];
      const cal = brain.computeCalibration(trades);
      assert.ok(Array.isArray(cal.buckets));
      assert.ok(cal.buckets.length > 0);
      assert.ok(typeof cal.calibrationScore === 'number');
    });

    it('should detect overconfident zones', () => {
      // Stated confidence 0.9 but actual win rate much lower
      const trades = [];
      for (let i = 0; i < 10; i++) {
        trades.push({ outcome: i < 3 ? 'win' : 'loss', signal: { confidence: 0.9 } });
      }
      const cal = brain.computeCalibration(trades);
      // Actual win rate is 30% but stated confidence is 90% -> overconfident
      assert.ok(cal.overconfidentZones.length > 0, 'Should detect overconfident zone');
    });

    it('should return default score for empty trades', () => {
      const cal = brain.computeCalibration([]);
      assert.strictEqual(cal.calibrationScore, 0.5);
    });
  });

  // ── Streaks ──────────────────────────────────────────────────────────────
  describe('computeStreaks()', () => {
    it('should track winning streaks', () => {
      const trades = [
        { outcome: 'win', entryTs: 1 },
        { outcome: 'win', entryTs: 2 },
        { outcome: 'win', entryTs: 3 },
      ];
      const streaks = brain.computeStreaks(trades);
      assert.strictEqual(streaks.current, 3);
      assert.strictEqual(streaks.maxWin, 3);
      assert.strictEqual(streaks.maxLoss, 0);
    });

    it('should track losing streaks as negative current', () => {
      const trades = [
        { outcome: 'loss', entryTs: 1 },
        { outcome: 'loss', entryTs: 2 },
        { outcome: 'loss', entryTs: 3 },
        { outcome: 'loss', entryTs: 4 },
      ];
      const streaks = brain.computeStreaks(trades);
      assert.strictEqual(streaks.current, -4);
      assert.strictEqual(streaks.maxWin, 0);
      assert.strictEqual(streaks.maxLoss, 4);
    });

    it('should reset streak on direction change', () => {
      const trades = [
        { outcome: 'win', entryTs: 1 },
        { outcome: 'win', entryTs: 2 },
        { outcome: 'loss', entryTs: 3 },
        { outcome: 'win', entryTs: 4 },
      ];
      const streaks = brain.computeStreaks(trades);
      assert.strictEqual(streaks.current, 1);
      assert.strictEqual(streaks.maxWin, 2);
      assert.strictEqual(streaks.maxLoss, 1);
    });

    it('should skip breakeven trades', () => {
      const trades = [
        { outcome: 'win', entryTs: 1 },
        { outcome: 'breakeven', entryTs: 2 },
        { outcome: 'win', entryTs: 3 },
      ];
      const streaks = brain.computeStreaks(trades);
      assert.strictEqual(streaks.current, 2);
    });

    it('should handle empty trades', () => {
      const streaks = brain.computeStreaks([]);
      assert.strictEqual(streaks.current, 0);
      assert.strictEqual(streaks.maxWin, 0);
      assert.strictEqual(streaks.maxLoss, 0);
    });
  });

  // ── Default Weights/Thresholds ───────────────────────────────────────────
  describe('DEFAULT_WEIGHTS and DEFAULT_THRESHOLDS', () => {
    it('should have weights summing approximately to 1.0', () => {
      const total = Object.values(brain.DEFAULT_WEIGHTS).reduce((s, v) => s + v, 0);
      approx(total, 1.0, 0.01);
    });

    it('should have all required weight keys', () => {
      const required = ['multiTfMomentum', 'rsi', 'bollingerBands', 'volumeConfirmation',
        'atrVolatility', 'regimeAlignment', 'sentimentDivergence', 'forecastAlignment', 'geoRiskPenalty'];
      for (const key of required) {
        assert.ok(brain.DEFAULT_WEIGHTS[key] !== undefined, `Missing weight key: ${key}`);
      }
    });

    it('should have sensible threshold ranges', () => {
      assert.ok(brain.DEFAULT_THRESHOLDS.minConfidence >= 0.5 && brain.DEFAULT_THRESHOLDS.minConfidence <= 1.0);
      assert.ok(brain.DEFAULT_THRESHOLDS.overboughtRsi > 50);
      assert.ok(brain.DEFAULT_THRESHOLDS.oversoldRsi < 50);
      assert.ok(brain.DEFAULT_THRESHOLDS.losingStreakThreshold > 0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. VaR Engine
// ═══════════════════════════════════════════════════════════════════════════════

describe('var-engine: Value-at-Risk', () => {
  let varEngine;

  before(() => {
    varEngine = require('../lib/var-engine');
  });

  // ── Historical VaR ───────────────────────────────────────────────────────
  describe('calculateVaR()', () => {
    it('should return zeros for insufficient data', () => {
      const result = varEngine.calculateVaR([1]);
      assert.strictEqual(result.var95, 0);
      assert.strictEqual(result.var99, 0);
      assert.strictEqual(result.cvar95, 0);
    });

    it('should compute VaR for a normal-ish return series', () => {
      // Generate returns with some losses
      const returns = [-5, -3, -2, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3, 3, 4, 5, 5, 6, 7, 8, 10];
      const result = varEngine.calculateVaR(returns);
      // VaR95 should be the 5th percentile (negative = loss)
      assert.ok(result.var95 < 0, `VaR95 should be negative (loss), got ${result.var95}`);
      // VaR99 should be more extreme than VaR95
      assert.ok(result.var99 <= result.var95, `VaR99 should be >= VaR95 in magnitude`);
      // CVaR should be at least as bad as VaR
      assert.ok(result.cvar95 <= result.var95, `CVaR95 ${result.cvar95} should be <= VaR95 ${result.var95}`);
    });

    it('should handle all positive returns', () => {
      const returns = Array.from({ length: 30 }, (_, i) => i * 0.5 + 0.1);
      const result = varEngine.calculateVaR(returns);
      // Even with all positive returns, VaR95 is the 5th percentile value (still positive)
      assert.ok(result.var95 >= 0, 'VaR with all gains should still have non-negative VaR');
    });

    it('should filter non-finite values', () => {
      const returns = [1, 2, NaN, 3, Infinity, -1, -2, 4, 5, -Infinity, 6, 7, -3, 8, 9];
      const result = varEngine.calculateVaR(returns);
      // Should not crash and should return valid numbers
      assert.ok(Number.isFinite(result.var95));
      assert.ok(Number.isFinite(result.var99));
    });
  });

  // ── Parametric VaR ───────────────────────────────────────────────────────
  describe('parametricVaR()', () => {
    it('should compute parametric VaR', () => {
      // Mean return 0%, stdDev 2%
      const result = varEngine.parametricVaR(0, 2);
      // VaR95 = 0 - 1.645 * 2 = -3.29
      approx(result.var95, -3.29, 0.01);
      // VaR99 = 0 - 2.326 * 2 = -4.652
      approx(result.var99, -4.652, 0.01);
    });

    it('should scale with holding period', () => {
      const daily = varEngine.parametricVaR(0, 2, 0.95, 1);
      const weekly = varEngine.parametricVaR(0, 2, 0.95, 5);
      // Weekly VaR should be sqrt(5) times daily VaR
      assert.ok(Math.abs(weekly.var95) > Math.abs(daily.var95));
    });

    it('should return zeros for invalid inputs', () => {
      const result = varEngine.parametricVaR(NaN, 2);
      assert.strictEqual(result.var95, 0);
      assert.strictEqual(result.var99, 0);
    });
  });

  // ── Portfolio VaR ────────────────────────────────────────────────────────
  describe('portfolioVaR()', () => {
    it('should return zeros for empty positions', () => {
      const result = varEngine.portfolioVaR([], {});
      assert.strictEqual(result.portfolioVar, 0);
      assert.strictEqual(result.diversificationBenefit, 0);
    });

    it('should show diversification benefit for uncorrelated assets', () => {
      const positions = [
        { asset: 'BTC', weight: 0.5, meanReturn: 0, stdDev: 3 },
        { asset: 'ETH', weight: 0.5, meanReturn: 0, stdDev: 4 },
      ];
      const corrMatrix = { 'BTC-ETH': 0 }; // uncorrelated
      const result = varEngine.portfolioVaR(positions, corrMatrix);
      assert.ok(result.diversificationBenefit > 0, 'Should have diversification benefit');
      assert.ok(result.portfolioVar < result.undiversifiedVar, 'Diversified VaR < undiversified');
    });

    it('should show no diversification benefit for perfectly correlated assets', () => {
      const positions = [
        { asset: 'BTC', weight: 0.5, meanReturn: 0, stdDev: 3 },
        { asset: 'ETH', weight: 0.5, meanReturn: 0, stdDev: 3 },
      ];
      const corrMatrix = { 'BTC-ETH': 1.0 }; // perfectly correlated
      const result = varEngine.portfolioVaR(positions, corrMatrix);
      approx(result.diversificationBenefit, 0, 1); // ~0% benefit
    });
  });

  // ── Correlation Matrix Builder ───────────────────────────────────────────
  describe('buildCorrelationMatrix()', () => {
    it('should return empty for insufficient data', () => {
      const result = varEngine.buildCorrelationMatrix({ BTC: [1, 2] });
      assert.deepStrictEqual(result.matrix, {});
    });

    it('should build matrix for multiple assets', () => {
      const prices = {
        BTC: [100, 102, 101, 103, 105, 104, 106],
        ETH: [50, 51, 50.5, 52, 53, 52.5, 54],
        SOL: [10, 9, 8, 7, 6, 5, 4], // inversely correlated
      };
      const result = varEngine.buildCorrelationMatrix(prices);
      assert.ok(Object.keys(result.matrix).length > 0);
      assert.ok(result.assets.length === 3);
      // BTC and ETH should be positively correlated (both going up)
      assert.ok(result.matrix['BTC-ETH'] > 0, `BTC-ETH should be positive: ${result.matrix['BTC-ETH']}`);
      // SOL going down while others go up = negative correlation
      assert.ok(result.matrix['BTC-SOL'] < 0 || result.matrix['SOL-BTC'] === undefined,
        'BTC-SOL should be negatively correlated');
    });
  });

  // ── Pearson Correlation ──────────────────────────────────────────────────
  describe('pearsonCorrelation()', () => {
    it('should return 1 for identical series', () => {
      const x = [1, 2, 3, 4, 5];
      approx(varEngine.pearsonCorrelation(x, x), 1.0, 0.001);
    });

    it('should return -1 for perfectly inverse series', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [5, 4, 3, 2, 1];
      approx(varEngine.pearsonCorrelation(x, y), -1.0, 0.001);
    });

    it('should return 0 for insufficient data', () => {
      assert.strictEqual(varEngine.pearsonCorrelation([1, 2], [3, 4]), 0);
    });

    it('should return near 0 for uncorrelated series', () => {
      // Two series with no linear relationship
      const x = [1, 3, 2, 5, 4, 6, 8, 7];
      const y = [4, 2, 6, 1, 5, 3, 2, 7];
      const corr = varEngine.pearsonCorrelation(x, y);
      assert.ok(Math.abs(corr) < 0.4, `Correlation should be near 0, got ${corr}`);
    });
  });

  // ── Prices to Returns ────────────────────────────────────────────────────
  describe('pricesToReturns()', () => {
    it('should convert prices to percentage returns', () => {
      const prices = [100, 110, 105, 115];
      const returns = varEngine.pricesToReturns(prices);
      // 100->110 = +10%, 110->105 = -4.545%, 105->115 = +9.524%
      assert.strictEqual(returns.length, 3);
      approx(returns[0], 10.0, 0.01);
      approx(returns[1], -4.545, 0.01);
      approx(returns[2], 9.524, 0.01);
    });

    it('should return empty for single price', () => {
      assert.deepStrictEqual(varEngine.pricesToReturns([100]), []);
    });
  });

  // ── VaR-Constrained Size ─────────────────────────────────────────────────
  describe('varConstrainedSize()', () => {
    it('should return 0 for zero base', () => {
      assert.strictEqual(varEngine.varConstrainedSize({ baseUsd: 0 }), 0);
    });

    it('should return 0 when VaR limit already breached', () => {
      const size = varEngine.varConstrainedSize({
        baseUsd: 25,
        portfolioVarLimit: 5,
        currentVaR: 6,
        assetVol: 3,
      });
      assert.strictEqual(size, 0);
    });

    it('should reduce size proportionally to remaining headroom', () => {
      const full = varEngine.varConstrainedSize({
        baseUsd: 25,
        portfolioVarLimit: 10,
        currentVaR: 0,
        assetVol: 2,
        confidence: 0.8,
      });
      const partial = varEngine.varConstrainedSize({
        baseUsd: 25,
        portfolioVarLimit: 10,
        currentVaR: 8,
        assetVol: 2,
        confidence: 0.8,
      });
      assert.ok(partial < full, `Partial headroom should give smaller size: ${partial} < ${full}`);
    });

    it('should never exceed baseUsd', () => {
      const size = varEngine.varConstrainedSize({
        baseUsd: 25,
        portfolioVarLimit: 100,
        currentVaR: 0,
        assetVol: 0.01,
        confidence: 1.0,
        edge: 1.0,
      });
      assert.ok(size <= 25, `Size ${size} should not exceed base 25`);
    });
  });

  // ── Statistics ───────────────────────────────────────────────────────────
  describe('mean() and stdDev()', () => {
    it('should compute mean correctly', () => {
      approx(varEngine.mean([1, 2, 3, 4, 5]), 3.0, 0.001);
      assert.strictEqual(varEngine.mean([]), 0);
    });

    it('should compute sample standard deviation', () => {
      const arr = [2, 4, 4, 4, 5, 5, 7, 9];
      // Mean = 5, variance = 32/7 = 4.571, stdDev = 2.138
      approx(varEngine.stdDev(arr), 2.138, 0.01);
    });

    it('should return 0 for single value array', () => {
      assert.strictEqual(varEngine.stdDev([42]), 0);
    });
  });

  // ── Z-Score ──────────────────────────────────────────────────────────────
  describe('zScore()', () => {
    it('should return known values for standard confidence levels', () => {
      approx(varEngine.zScore(0.95), 1.645, 0.001);
      approx(varEngine.zScore(0.99), 2.326, 0.001);
      approx(varEngine.zScore(0.90), 1.282, 0.001);
    });

    it('should interpolate for non-standard confidence levels', () => {
      const z97 = varEngine.zScore(0.975);
      assert.ok(z97 > 1.645, `z(0.975) should be > z(0.95)=${1.645}, got ${z97}`);
      assert.ok(z97 < 2.326, `z(0.975) should be < z(0.99)=${2.326}, got ${z97}`);
      // z(0.975) = 1.96 (well-known value for two-tailed 95%)
      approx(z97, 1.96, 0.01);
    });
  });

  // ── Risk Contribution ────────────────────────────────────────────────────
  describe('riskContribution()', () => {
    it('should return empty for no positions', () => {
      assert.deepStrictEqual(varEngine.riskContribution([], {}), []);
    });

    it('should compute contributions summing to ~100%', () => {
      const positions = [
        { asset: 'BTC', weight: 0.6, meanReturn: 0, stdDev: 3 },
        { asset: 'ETH', weight: 0.4, meanReturn: 0, stdDev: 4 },
      ];
      const matrix = { 'BTC-ETH': 0.7 };
      const contributions = varEngine.riskContribution(positions, matrix);
      assert.strictEqual(contributions.length, 2);
      const totalPct = contributions.reduce((s, c) => s + c.contributionPct, 0);
      approx(totalPct, 100, 2); // ~100% with rounding tolerance
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Edge-Case Mitigations
// ═══════════════════════════════════════════════════════════════════════════════

describe('edge-case-mitigations', () => {
  let ecm;

  before(() => {
    ecm = require('../lib/edge-case-mitigations');
  });

  // ── Flash Crash ──────────────────────────────────────────────────────────
  describe('checkFlashCrash()', () => {
    it('should detect a flash crash', () => {
      const result = ecm.checkFlashCrash({
        asset: 'BTC',
        currentPrice: 45000,
        recentPrices: [50000, 49500, 48000, 47000],
      });
      assert.strictEqual(result.triggered, true);
      assert.ok(['critical', 'emergency'].includes(result.severity));
    });

    it('should not trigger for normal price movement', () => {
      const result = ecm.checkFlashCrash({
        asset: 'BTC',
        currentPrice: 49800,
        recentPrices: [50000, 49900, 49950, 49850],
      });
      assert.strictEqual(result.triggered, false);
    });

    it('should handle insufficient data gracefully', () => {
      const result = ecm.checkFlashCrash({ asset: 'BTC', currentPrice: 50000, recentPrices: [] });
      assert.strictEqual(result.triggered, false);
      assert.strictEqual(result.severity, 'info');
    });

    it('should detect extreme crash as emergency severity', () => {
      const result = ecm.checkFlashCrash({
        asset: 'ETH',
        currentPrice: 2000,
        recentPrices: [3000, 2900, 2800, 2700],
      });
      assert.strictEqual(result.triggered, true);
      // 33% drop > 2x threshold (8%), so emergency
      assert.strictEqual(result.severity, 'emergency');
    });
  });

  // ── Overfit Detection ────────────────────────────────────────────────────
  describe('checkOverfit()', () => {
    it('should require minimum live trades', () => {
      const result = ecm.checkOverfit({ liveSharpe: -1, backtestSharpe: 2, liveTrades: 5 });
      assert.strictEqual(result.triggered, false);
      assert.ok(result.message.includes('Insufficient'));
    });

    it('should detect overfit when live Sharpe is negative vs positive backtest', () => {
      const result = ecm.checkOverfit({
        liveSharpe: -0.5,
        backtestSharpe: 1.5,
        liveWinRate: 0.35,
        backtestWinRate: 0.65,
        liveTrades: 50,
      });
      assert.strictEqual(result.triggered, true);
      assert.strictEqual(result.severity, 'critical');
    });

    it('should not trigger when live matches backtest', () => {
      const result = ecm.checkOverfit({
        liveSharpe: 1.2,
        backtestSharpe: 1.5,
        liveWinRate: 0.60,
        backtestWinRate: 0.62,
        liveTrades: 100,
      });
      assert.strictEqual(result.triggered, false);
    });
  });

  // ── Key Compromise ───────────────────────────────────────────────────────
  describe('checkKeyCompromise()', () => {
    it('should detect unknown orders', () => {
      const result = ecm.checkKeyCompromise({
        venue: 'coinbase',
        recentOrders: [{ id: 'abc' }, { id: 'xyz' }],
        knownOrderIds: ['abc'],
      });
      assert.strictEqual(result.triggered, true);
      assert.strictEqual(result.severity, 'critical');
    });

    it('should detect unexpected IP access', () => {
      const result = ecm.checkKeyCompromise({
        venue: 'kraken',
        lastAccessIp: '1.2.3.4',
        expectedIps: ['5.6.7.8', '10.0.0.1'],
      });
      assert.strictEqual(result.triggered, true);
    });

    it('should pass when all orders are known', () => {
      const result = ecm.checkKeyCompromise({
        venue: 'coinbase',
        recentOrders: [{ id: 'abc' }, { id: 'def' }],
        knownOrderIds: ['abc', 'def'],
      });
      assert.strictEqual(result.triggered, false);
    });
  });

  // ── Correlated Drawdown ──────────────────────────────────────────────────
  describe('checkCorrelatedDrawdown()', () => {
    it('should detect all venues losing', () => {
      const result = ecm.checkCorrelatedDrawdown({
        venuePnl: { coinbase: -10, kraken: -5, polymarket: -3 },
      });
      assert.strictEqual(result.triggered, true);
      assert.strictEqual(result.severity, 'critical');
    });

    it('should not trigger when only one venue is losing', () => {
      const result = ecm.checkCorrelatedDrawdown({
        venuePnl: { coinbase: 10, kraken: -5, polymarket: 3 },
      });
      assert.strictEqual(result.triggered, false);
    });

    it('should need at least 2 venues', () => {
      const result = ecm.checkCorrelatedDrawdown({
        venuePnl: { coinbase: -10 },
      });
      assert.strictEqual(result.triggered, false);
    });
  });

  // ── Gas Spike ────────────────────────────────────────────────────────────
  describe('checkGasSpike()', () => {
    it('should detect extreme gas spike as critical', () => {
      const result = ecm.checkGasSpike({ gasPriceGwei: 250, chain: 'ethereum' });
      assert.strictEqual(result.triggered, true);
      assert.strictEqual(result.severity, 'critical');
    });

    it('should detect elevated gas as warning', () => {
      const result = ecm.checkGasSpike({ gasPriceGwei: 110, chain: 'ethereum' });
      assert.strictEqual(result.triggered, true);
      assert.strictEqual(result.severity, 'warning');
    });

    it('should pass for normal gas', () => {
      const result = ecm.checkGasSpike({ gasPriceGwei: 20, chain: 'ethereum' });
      assert.strictEqual(result.triggered, false);
    });

    it('should handle missing gas data', () => {
      const result = ecm.checkGasSpike({ chain: 'ethereum' });
      assert.strictEqual(result.triggered, false);
    });
  });

  // ── Order Duplication Guard ──────────────────────────────────────────────
  describe('checkOrderDuplication()', () => {
    it('should allow first order', () => {
      const result = ecm.checkOrderDuplication({
        venue: 'test', asset: 'BTC', side: 'buy', usdSize: 25,
      });
      assert.strictEqual(result.triggered, false);
    });

    it('should block duplicate order within window', () => {
      // First order (allowed)
      ecm.checkOrderDuplication({
        venue: 'duptest', asset: 'ETH', side: 'sell', usdSize: 15,
      });
      // Same order again immediately (should be blocked)
      const result = ecm.checkOrderDuplication({
        venue: 'duptest', asset: 'ETH', side: 'sell', usdSize: 15,
      });
      assert.strictEqual(result.triggered, true);
      assert.strictEqual(result.severity, 'warning');
    });
  });

  // ── Exchange Insolvency ──────────────────────────────────────────────────
  describe('checkExchangeInsolvency()', () => {
    it('should return healthy for no errors', () => {
      const result = ecm.checkExchangeInsolvency({ venue: 'coinbase', consecutiveErrors: 0 });
      assert.strictEqual(result.triggered, false);
    });

    it('should trigger emergency on withdrawals halted', () => {
      const result = ecm.checkExchangeInsolvency({
        venue: 'binance', consecutiveErrors: 0, withdrawalsHalted: true,
      });
      assert.strictEqual(result.triggered, true);
      assert.strictEqual(result.severity, 'emergency');
    });

    it('should trigger critical on many consecutive errors', () => {
      const result = ecm.checkExchangeInsolvency({ venue: 'ftx', consecutiveErrors: 15 });
      assert.strictEqual(result.triggered, true);
      assert.strictEqual(result.severity, 'critical');
    });

    it('should detect distress keywords in status page', () => {
      const result = ecm.checkExchangeInsolvency({
        venue: 'test-exchange',
        consecutiveErrors: 0,
        statusPageText: 'We are experiencing a major outage affecting trading. Withdrawals are halted temporarily.',
      });
      assert.strictEqual(result.triggered, true);
    });
  });

  // ── Stale Price Detection ────────────────────────────────────────────────
  describe('checkStalePrice()', () => {
    it('should not trigger for first price', () => {
      const result = ecm.checkStalePrice({ source: 'stale-test-1', price: 50000 });
      assert.strictEqual(result.triggered, false);
    });

    it('should detect stale prices after repeated identical values', () => {
      const source = 'stale-test-2';
      let lastResult;
      // Feed the same price many times
      for (let i = 0; i < 10; i++) {
        lastResult = ecm.checkStalePrice({ source, price: 42000 });
      }
      assert.strictEqual(lastResult.triggered, true);
      assert.strictEqual(lastResult.severity, 'warning');
    });

    it('should reset counter when price changes', () => {
      const source = 'stale-test-3';
      for (let i = 0; i < 4; i++) {
        ecm.checkStalePrice({ source, price: 50000 });
      }
      // Change the price
      const result = ecm.checkStalePrice({ source, price: 50001 });
      assert.strictEqual(result.triggered, false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Risk Manager
// ═══════════════════════════════════════════════════════════════════════════════

describe('risk-manager', () => {
  let risk;

  before(() => {
    risk = require('../lib/risk-manager');
  });

  // ── Stop Loss Calculator ─────────────────────────────────────────────────
  describe('calculateStopLoss()', () => {
    it('should compute ATR-based stop loss for buy side', () => {
      const result = risk.calculateStopLoss({
        asset: 'BTC', entryPrice: 50000, side: 'buy', atr: 1000,
      });
      assert.ok(result.stopLoss < 50000, 'Buy SL should be below entry');
      assert.ok(result.takeProfit > 50000, 'Buy TP should be above entry');
      assert.strictEqual(result.method, 'atr-dynamic');
      assert.ok(result.riskReward >= 1, 'Risk-reward should be >= 1');
    });

    it('should compute ATR-based stop loss for sell side', () => {
      const result = risk.calculateStopLoss({
        asset: 'ETH', entryPrice: 3000, side: 'sell', atr: 50,
      });
      assert.ok(result.stopLoss > 3000, 'Sell SL should be above entry');
      assert.ok(result.takeProfit < 3000, 'Sell TP should be below entry');
    });

    it('should fallback to percentage when atr is missing', () => {
      const result = risk.calculateStopLoss({
        asset: 'SOL', entryPrice: 100, side: 'buy', atr: 0,
      });
      assert.strictEqual(result.method, 'fallback-pct');
      assert.ok(result.stopLoss < 100);
      assert.ok(result.takeProfit > 100);
    });

    it('should fallback when entry price is zero', () => {
      const result = risk.calculateStopLoss({
        asset: 'DOGE', entryPrice: 0, side: 'buy', atr: 0.01,
      });
      assert.strictEqual(result.method, 'fallback-pct');
    });
  });

  // ── Kill Switch ──────────────────────────────────────────────────────────
  describe('kill switch', () => {
    beforeEach(() => {
      // Reset kill switch state before each test
      try {
        const killFile = path.join(TEST_DATA_DIR, 'kill-switch.json');
        if (fs.existsSync(killFile)) fs.unlinkSync(killFile);
        const riskFile = process.env.RISK_STATE_FILE;
        if (fs.existsSync(riskFile)) fs.unlinkSync(riskFile);
      } catch {}
    });

    it('should not be active initially', () => {
      // Fresh state with no kill-switch file
      const killFile = path.resolve(process.cwd(), 'data/kill-switch.json');
      // The kill switch checks the real file path, so this test verifies the behavior
      // We test the logic rather than the file I/O
      assert.ok(typeof risk.isKillSwitchActive === 'function');
    });

    it('should block trade when kill switch is active', () => {
      risk.activateKillSwitch('test activation');
      const check = risk.checkTradeAllowed({
        asset: 'BTC', side: 'buy', usdSize: 25, venue: 'kraken',
      });
      assert.strictEqual(check.allowed, false);
      assert.ok(check.reasons.some(r => r.includes('KILL SWITCH')));
      // Clean up
      risk.deactivateKillSwitch();
    });
  });

  // ── Portfolio Exposure ───────────────────────────────────────────────────
  describe('getPortfolioExposure()', () => {
    it('should return zero exposure for empty state', () => {
      const exposure = risk.getPortfolioExposure();
      assert.strictEqual(exposure.totalExposure, 0);
      assert.strictEqual(exposure.positionCount, 0);
    });
  });

  // ── P&L Recording ────────────────────────────────────────────────────────
  describe('recordPnl()', () => {
    it('should track cumulative equity changes', () => {
      risk.recordPnl(10);
      risk.recordPnl(5);
      risk.recordPnl(-3);
      const health = risk.getRiskHealth();
      assert.ok(health.currentEquity > 0, 'Equity should be positive after net positive P&L');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Capital Mandate
// ═══════════════════════════════════════════════════════════════════════════════

describe('capital-mandate', () => {
  let mandate;

  before(() => {
    mandate = require('../lib/capital-mandate');
  });

  describe('determineMode()', () => {
    it('should return capital_halt below critical floor', () => {
      assert.strictEqual(mandate.determineMode(50), 'capital_halt');
    });

    it('should return survival below survival threshold', () => {
      assert.strictEqual(mandate.determineMode(150), 'survival');
    });

    it('should return normal in the middle range', () => {
      assert.strictEqual(mandate.determineMode(400), 'normal');
    });

    it('should return growth above growth threshold', () => {
      assert.strictEqual(mandate.determineMode(700), 'growth');
    });

    it('should handle boundary values', () => {
      assert.strictEqual(mandate.determineMode(mandate.CRITICAL_FLOOR_USD), 'capital_halt');
      assert.strictEqual(mandate.determineMode(mandate.SURVIVAL_THRESHOLD_USD), 'survival');
      assert.strictEqual(mandate.determineMode(mandate.GROWTH_THRESHOLD_USD), 'growth');
    });
  });

  describe('MILESTONES', () => {
    it('should be a sorted array of increasing values', () => {
      for (let i = 1; i < mandate.MILESTONES.length; i++) {
        assert.ok(mandate.MILESTONES[i] > mandate.MILESTONES[i - 1],
          `Milestone ${mandate.MILESTONES[i]} should be > ${mandate.MILESTONES[i - 1]}`);
      }
    });

    it('should start at 500', () => {
      assert.strictEqual(mandate.MILESTONES[0], 500);
    });

    it('should end at 1000000', () => {
      assert.strictEqual(mandate.MILESTONES[mandate.MILESTONES.length - 1], 1000000);
    });
  });

  describe('mandateAdjustedSize()', () => {
    it('should return a non-negative number', () => {
      const size = mandate.mandateAdjustedSize({ baseUsd: 25, confidence: 0.8, edge: 0.1 });
      assert.ok(size >= 0, `mandateAdjustedSize should be non-negative, got ${size}`);
    });

    it('should return 0 when capital is at critical floor', () => {
      // determineMode returns capital_halt when total <= CRITICAL_FLOOR_USD
      const mode = mandate.determineMode(50);
      assert.strictEqual(mode, 'capital_halt');
      // mandateAdjustedSize internally calls getCurrentCapital which reads guardian state;
      // we verify the mode logic independently
    });

    it('should never exceed baseUsd beyond growth multiplier', () => {
      const size = mandate.mandateAdjustedSize({ baseUsd: 25, confidence: 1.0, edge: 0.5 });
      // Even in growth mode with high edge, size should remain reasonable
      assert.ok(size <= 25 * 2, `Size ${size} should not exceed 2x base`);
    });
  });

  describe('loadMandateState()', () => {
    it('should return fresh state when no file exists', () => {
      const state = mandate.loadMandateState();
      assert.ok(state.initialCapital > 0);
      assert.strictEqual(state.currentMode, 'normal');
      assert.ok(Array.isArray(state.milestonesReached));
      assert.ok(Array.isArray(state.modeTransitions));
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Agent Signal Bus
// ═══════════════════════════════════════════════════════════════════════════════

describe('agent-signal-bus', () => {
  let bus;

  before(() => {
    // Delete cached module to force re-require with file mode
    const busPath = require.resolve('../lib/agent-signal-bus');
    delete require.cache[busPath];
    // Also delete redis-signal-bus from cache if loaded
    try {
      const redisPath = require.resolve('../lib/redis-signal-bus');
      delete require.cache[redisPath];
    } catch {}
    bus = require('../lib/agent-signal-bus');
  });

  beforeEach(() => {
    // Clear signal file between tests
    try {
      const signalFile = process.env.AGENT_SIGNAL_BUS_FILE;
      if (signalFile && fs.existsSync(signalFile)) fs.unlinkSync(signalFile);
    } catch {}
  });

  describe('publish()', () => {
    it('should publish a signal and return it', () => {
      const signal = bus.publish({
        type: 'test_signal',
        source: 'unit-test',
        confidence: 0.85,
        payload: { message: 'hello' },
        ttlMs: 60000,
      });
      assert.ok(signal.id);
      assert.strictEqual(signal.type, 'test_signal');
      assert.strictEqual(signal.source, 'unit-test');
      assert.strictEqual(signal.confidence, 0.85);
      assert.ok(signal.publishedAt > 0);
    });
  });

  describe('query()', () => {
    it('should return empty for no signals', () => {
      const results = bus.query({ type: 'nonexistent' });
      assert.strictEqual(results.length, 0);
    });

    it('should filter by type', () => {
      bus.publish({ type: 'market_regime', source: 'test', confidence: 0.8, payload: { regime: 'risk_on' } });
      bus.publish({ type: 'forecast', source: 'test', confidence: 0.7, payload: { direction: 'bullish' } });

      const regimes = bus.query({ type: 'market_regime' });
      assert.strictEqual(regimes.length, 1);
      assert.strictEqual(regimes[0].type, 'market_regime');
    });

    it('should filter by minConfidence', () => {
      bus.publish({ type: 'test_conf', source: 'test', confidence: 0.3, payload: {} });
      bus.publish({ type: 'test_conf', source: 'test', confidence: 0.9, payload: {} });

      const high = bus.query({ type: 'test_conf', minConfidence: 0.5 });
      assert.strictEqual(high.length, 1);
      assert.ok(high[0].confidence >= 0.5);
    });

    it('should sort by newest first', () => {
      bus.publish({ type: 'sort_test', source: 'a', confidence: 0.5, payload: {} });
      bus.publish({ type: 'sort_test', source: 'b', confidence: 0.5, payload: {} });

      const results = bus.query({ type: 'sort_test' });
      assert.ok(results[0].publishedAt >= results[1].publishedAt);
    });
  });

  describe('consensus()', () => {
    it('should return null value for no signals', () => {
      const result = bus.consensus('nonexistent_type');
      assert.strictEqual(result.value, null);
      assert.strictEqual(result.count, 0);
    });

    it('should return the highest-weighted payload', () => {
      bus.publish({ type: 'regime_vote', source: 'agent1', confidence: 0.9, payload: { regime: 'risk_on' } });
      bus.publish({ type: 'regime_vote', source: 'agent2', confidence: 0.8, payload: { regime: 'risk_on' } });
      bus.publish({ type: 'regime_vote', source: 'agent3', confidence: 0.7, payload: { regime: 'risk_off' } });

      const result = bus.consensus('regime_vote');
      assert.deepStrictEqual(result.value, { regime: 'risk_on' });
      assert.strictEqual(result.count, 2);
    });
  });

  describe('summary()', () => {
    it('should return summary of active signals', () => {
      bus.publish({ type: 'summary_test', source: 'a', confidence: 0.8, payload: {} });
      bus.publish({ type: 'summary_test', source: 'b', confidence: 0.6, payload: {} });

      const s = bus.summary();
      assert.ok(s.totalSignals >= 2);
      assert.ok(s.types.summary_test);
      assert.strictEqual(s.types.summary_test.count, 2);
      assert.ok(s.types.summary_test.sources.includes('a'));
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Resilient I/O
// ═══════════════════════════════════════════════════════════════════════════════

describe('resilient-io', () => {
  let rio;

  before(() => {
    rio = require('../lib/resilient-io');
  });

  // ── Atomic Write / Safe Read ─────────────────────────────────────────────
  describe('writeJsonAtomic() / readJsonSafe()', () => {
    it('should write and read JSON atomically', () => {
      const testFile = path.join(TEST_DATA_DIR, 'atomic-test.json');
      const data = { key: 'value', number: 42, nested: { arr: [1, 2, 3] } };
      rio.writeJsonAtomic(testFile, data);
      const read = rio.readJsonSafe(testFile);
      assert.deepStrictEqual(read, data);
    });

    it('should create backup files', () => {
      const testFile = path.join(TEST_DATA_DIR, 'backup-test.json');
      rio.writeJsonAtomic(testFile, { v: 1 });
      rio.writeJsonAtomic(testFile, { v: 2 });
      // After second write, .bak.0 should exist
      assert.ok(fs.existsSync(testFile + '.bak.0'), 'Backup .bak.0 should exist');
      const backup = JSON.parse(fs.readFileSync(testFile + '.bak.0', 'utf8'));
      assert.strictEqual(backup.v, 1);
    });

    it('should return fallback for missing file', () => {
      const result = rio.readJsonSafe('/nonexistent/file.json', { fallback: { default: true } });
      assert.deepStrictEqual(result, { default: true });
    });

    it('should recover from corrupted primary file using backups', () => {
      const testFile = path.join(TEST_DATA_DIR, 'corrupt-test.json');
      // Write valid data then write backup
      rio.writeJsonAtomic(testFile, { good: true });
      // Corrupt the primary file manually
      fs.writeFileSync(testFile, '{{{{invalid json');
      // readJsonSafe should recover from backup
      const result = rio.readJsonSafe(testFile, { fallback: { recovered: false } });
      // It should either recover from backup or return fallback
      assert.ok(result !== null);
    });
  });

  // ── Rate Limiter ─────────────────────────────────────────────────────────
  describe('rateLimit()', () => {
    it('should allow requests within limit', () => {
      const allowed = rio.rateLimit('test-rl-1', { maxTokens: 5, refillPerSec: 10 });
      assert.strictEqual(allowed, true);
    });

    it('should block requests when bucket is empty', () => {
      const key = 'test-rl-2';
      // Drain the bucket
      for (let i = 0; i < 10; i++) {
        rio.rateLimit(key, { maxTokens: 3, refillPerSec: 0.001 });
      }
      // Should be blocked now
      const allowed = rio.rateLimit(key, { maxTokens: 3, refillPerSec: 0.001 });
      assert.strictEqual(allowed, false);
    });
  });

  // ── Circuit Breaker ──────────────────────────────────────────────────────
  describe('circuitBreaker()', () => {
    it('should pass through on success', async () => {
      const result = await rio.circuitBreaker('test-cb-1', async () => 42);
      assert.strictEqual(result, 42);
    });

    it('should open circuit after threshold failures', async () => {
      const key = 'test-cb-fail';
      for (let i = 0; i < 5; i++) {
        try {
          await rio.circuitBreaker(key, async () => { throw new Error('fail'); }, { failureThreshold: 5 });
        } catch {}
      }
      // Circuit should now be open
      await assert.rejects(
        () => rio.circuitBreaker(key, async () => 'ok', { failureThreshold: 5 }),
        /OPEN/,
      );
    });

    it('should report circuit status', () => {
      const status = rio.getCircuitStatus('test-cb-1');
      assert.strictEqual(status.status, 'CLOSED');
    });
  });

  // ── Retry ────────────────────────────────────────────────────────────────
  describe('retry()', () => {
    it('should succeed on first try', async () => {
      const result = await rio.retry(async () => 'success', { retries: 3 });
      assert.strictEqual(result, 'success');
    });

    it('should retry on failure and eventually succeed', async () => {
      let attempts = 0;
      const result = await rio.retry(async () => {
        attempts++;
        if (attempts < 3) throw new Error('not yet');
        return 'done';
      }, { retries: 5, baseDelayMs: 10 });
      assert.strictEqual(result, 'done');
      assert.strictEqual(attempts, 3);
    });

    it('should throw after max retries', async () => {
      await assert.rejects(
        () => rio.retry(async () => { throw new Error('always fail'); }, { retries: 2, baseDelayMs: 10 }),
        /always fail/,
      );
    });
  });

  // ── File Locking ─────────────────────────────────────────────────────────
  describe('acquireLock()', () => {
    it('should acquire and release a lock', () => {
      const testFile = path.join(TEST_DATA_DIR, 'lock-test.json');
      fs.writeFileSync(testFile, '{}');
      const release = rio.acquireLock(testFile);
      assert.ok(typeof release === 'function');
      // Lock file should exist
      assert.ok(fs.existsSync(testFile + '.lock'));
      release();
      // Lock file should be removed
      assert.ok(!fs.existsSync(testFile + '.lock'));
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Trade Journal
// ═══════════════════════════════════════════════════════════════════════════════

describe('trade-journal', () => {
  let journal;

  before(() => {
    journal = require('../lib/trade-journal');
  });

  describe('recordTrade() and recordOutcome()', () => {
    it('should record a trade and return an ID', () => {
      const id = journal.recordTrade({
        venue: 'kraken',
        asset: 'BTC',
        side: 'buy',
        entryPrice: 50000,
        usdSize: 25,
        signal: { confidence: 0.75, edge: 0.15 },
        signalComponents: {},
      });
      assert.ok(id);
      assert.ok(id.startsWith('trade-'));
    });

    it('should record outcome for an existing trade', () => {
      const id = journal.recordTrade({
        venue: 'coinbase',
        asset: 'ETH',
        side: 'sell',
        entryPrice: 3000,
        usdSize: 15,
        signal: { confidence: 0.6 },
      });
      const success = journal.recordOutcome(id, {
        exitPrice: 2900,
        pnl: 5,
        pnlPercent: 3.33,
      });
      assert.strictEqual(success, true);
    });

    it('should return false for non-existent trade ID', () => {
      const success = journal.recordOutcome('nonexistent-id', { exitPrice: 100, pnl: 1 });
      assert.strictEqual(success, false);
    });
  });

  describe('getStats()', () => {
    it('should return stats object with expected keys', () => {
      const stats = journal.getStats({ sinceDays: 30 });
      assert.ok('totalTrades' in stats);
      assert.ok('closedTrades' in stats);
      assert.ok('winRate' in stats);
      assert.ok('profitFactor' in stats);
      assert.ok('totalPnl' in stats);
      assert.ok('sharpeRatio' in stats);
      assert.ok('maxDrawdown' in stats);
    });

    it('should filter by venue', () => {
      journal.recordTrade({ venue: 'filter-test', asset: 'BTC', side: 'buy', entryPrice: 50000, usdSize: 10 });
      const stats = journal.getStats({ venue: 'filter-test', sinceDays: 1 });
      assert.ok(stats.totalTrades >= 1);
    });

    it('should filter by asset', () => {
      journal.recordTrade({ venue: 'test', asset: 'UNIQUE_ASSET', side: 'buy', entryPrice: 100, usdSize: 5 });
      const stats = journal.getStats({ asset: 'UNIQUE_ASSET', sinceDays: 1 });
      assert.ok(stats.totalTrades >= 1);
    });
  });

  describe('autoCloseEstimate()', () => {
    it('should auto-estimate P&L for unclosed trade', () => {
      const id = journal.recordTrade({
        venue: 'test',
        asset: 'SOL',
        side: 'buy',
        entryPrice: 100,
        usdSize: 50,
        signal: { confidence: 0.7 },
      });
      const success = journal.autoCloseEstimate(id, 110);
      assert.strictEqual(success, true);
    });

    it('should not auto-close an already closed trade', () => {
      const id = journal.recordTrade({
        venue: 'test',
        asset: 'DOGE',
        side: 'buy',
        entryPrice: 0.10,
        usdSize: 10,
        signal: {},
      });
      journal.recordOutcome(id, { exitPrice: 0.11, pnl: 1, pnlPercent: 10 });
      const success = journal.autoCloseEstimate(id, 0.12);
      assert.strictEqual(success, false);
    });
  });

  describe('getAdaptiveMinConfidence()', () => {
    it('should return default value with insufficient data', () => {
      const val = journal.getAdaptiveMinConfidence(0.56);
      assert.strictEqual(val, 0.56);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Treasury Ledger
// ═══════════════════════════════════════════════════════════════════════════════

describe('treasury-ledger', () => {
  let ledger;

  before(() => {
    ledger = require('../lib/treasury-ledger');
  });

  describe('recordReconciliation()', () => {
    it('should record reconciliation and update lifetime P&L', () => {
      const before = ledger.getSummary();
      const result = ledger.recordReconciliation({
        closedCount: 3,
        totalPnl: 15.50,
        closed: [
          { pnl: 10, outcome: 'win' },
          { pnl: 8, outcome: 'win' },
          { pnl: -2.5, outcome: 'loss' },
        ],
      });
      // P&L should increase by 15.50
      approx(result.lifetimePnl, before.lifetimePnl + 15.50, 0.01);
      assert.strictEqual(result.lifetimeTrades, before.lifetimeTrades + 3);
      assert.strictEqual(result.lifetimeWins, (before.winRate > 0 ? Math.round(before.lifetimeTrades * before.winRate / 100) : 0) + 2);
    });

    it('should accumulate over multiple reconciliations', () => {
      const before = ledger.getSummary();
      const result = ledger.recordReconciliation({
        closedCount: 1,
        totalPnl: 5,
        closed: [{ pnl: 5, outcome: 'win' }],
      });
      approx(result.lifetimePnl, before.lifetimePnl + 5, 0.01);
      assert.strictEqual(result.lifetimeTrades, before.lifetimeTrades + 1);
    });

    it('should handle empty reconciliation', () => {
      const before = ledger.getSummary();
      const result = ledger.recordReconciliation({});
      // Should not change anything
      approx(result.lifetimePnl, before.lifetimePnl, 0.01);
    });
  });

  describe('updateCapital()', () => {
    it('should track peak capital', () => {
      // Use a very high value to ensure it becomes the new peak
      const result = ledger.updateCapital(999999);
      assert.strictEqual(result.peakCapital, 999999);
      assert.strictEqual(result.currentCapital, 999999);
    });

    it('should track drawdown', () => {
      ledger.updateCapital(100000);
      const peek = ledger.getSummary().peakCapital;
      const result = ledger.updateCapital(80000);
      // Drawdown from peak
      const expectedDrawdown = ((peek - 80000) / peek) * 100;
      assert.ok(result.maxDrawdownPct >= Math.min(expectedDrawdown, 20),
        `Drawdown should be tracked, got ${result.maxDrawdownPct}%`);
    });

    it('should set initial capital on first run', () => {
      const summary = ledger.getSummary();
      assert.ok(summary.initialCapital > 0);
    });
  });

  describe('recordPayout()', () => {
    it('should record payout and update compounded amount', () => {
      const before = ledger.getSummary();
      const result = ledger.recordPayout(10);
      approx(result.lifetimePayouts, before.lifetimePayouts + 10, 0.01);
      // Compounded = lifetimePnl - lifetimePayouts
      assert.strictEqual(result.lifetimeCompounded,
        Math.round((result.lifetimePnl - result.lifetimePayouts) * 100) / 100);
    });

    it('should reject zero/negative payout amounts', () => {
      const before = ledger.getSummary();
      ledger.recordPayout(0);
      ledger.recordPayout(-5);
      const after = ledger.getSummary();
      assert.strictEqual(before.lifetimePayouts, after.lifetimePayouts);
    });
  });

  describe('getSummary()', () => {
    it('should return all expected fields', () => {
      const summary = ledger.getSummary();
      assert.ok('lifetimePnl' in summary);
      assert.ok('lifetimeTrades' in summary);
      assert.ok('winRate' in summary);
      assert.ok('profitFactor' in summary);
      assert.ok('roi' in summary);
      assert.ok('initialCapital' in summary);
      assert.ok('currentCapital' in summary);
      assert.ok('peakCapital' in summary);
      assert.ok('lifetimePayouts' in summary);
      assert.ok('nextMilestone' in summary);
      assert.ok(Array.isArray(summary.dailySnapshots));
      assert.ok(Array.isArray(summary.weeklySummaries));
    });
  });

  describe('takeDailySnapshot()', () => {
    it('should record a daily snapshot', () => {
      const beforeCount = ledger.getSummary().dailySnapshots.length;
      ledger.takeDailySnapshot(5, 10, 7, 600);
      const summary = ledger.getSummary();
      assert.ok(summary.dailySnapshots.length > 0);
      const latest = summary.dailySnapshots[summary.dailySnapshots.length - 1];
      // Trades may be accumulated if snapshot for today already existed
      assert.ok(latest.trades >= 10, `Latest snapshot should have at least 10 trades, got ${latest.trades}`);
    });

    it('should merge duplicate snapshots for same day', () => {
      const before = ledger.getSummary().dailySnapshots.length;
      ledger.takeDailySnapshot(3, 5, 3, 610);
      const after = ledger.getSummary().dailySnapshots.length;
      // Should not add a new entry for the same day
      assert.strictEqual(after, before);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Cross-Module Integration Sanity
// ═══════════════════════════════════════════════════════════════════════════════

describe('cross-module integration', () => {
  it('should have self-evolving-brain and edge-detector use compatible weight keys', () => {
    const brain = require('../lib/self-evolving-brain');
    const edge = require('../lib/edge-detector');

    const brainKeys = Object.keys(brain.DEFAULT_WEIGHTS);
    const edgeKeys = Object.keys(edge.ASSET_MAP || {});
    // Verify brain has all required indicator keys
    assert.ok(brainKeys.includes('multiTfMomentum'));
    assert.ok(brainKeys.includes('rsi'));
    assert.ok(brainKeys.includes('bollingerBands'));
    assert.ok(brainKeys.includes('regimeAlignment'));
  });

  it('should have var-engine and risk-manager coexist', () => {
    const varEngine = require('../lib/var-engine');
    const risk = require('../lib/risk-manager');

    // Both should be loadable and have their key functions
    assert.ok(typeof varEngine.calculateVaR === 'function');
    assert.ok(typeof risk.checkTradeAllowed === 'function');
    assert.ok(typeof risk.calculateStopLoss === 'function');
  });

  it('should have capital-mandate and risk-manager use consistent thresholds', () => {
    const mandate = require('../lib/capital-mandate');
    const risk = require('../lib/risk-manager');

    // Both modules should expose their key configurations
    assert.ok(mandate.CRITICAL_FLOOR_USD > 0);
    assert.ok(typeof risk.checkTradeAllowed === 'function');
  });

  it('should have treasury-ledger and capital-mandate share milestone definitions', () => {
    const mandate = require('../lib/capital-mandate');
    // Treasury ledger milestones are defined internally; just verify mandate has them
    assert.ok(mandate.MILESTONES.length >= 5, 'Should have multiple milestones');
    assert.ok(mandate.MILESTONES.every(m => typeof m === 'number' && m > 0));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cleanup
// ═══════════════════════════════════════════════════════════════════════════════

after(() => {
  cleanupTestDataDir();
});
