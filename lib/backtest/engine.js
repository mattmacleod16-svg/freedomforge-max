/**
 * Backtest Engine -- Core simulation engine for FreedomForge trading system.
 * ==========================================================================
 *
 * Replays historical OHLCV candle data through the same indicator logic
 * used in live trading (edge-detector.js). Produces trade-level and
 * portfolio-level statistics for evaluating strategy performance.
 *
 * Usage:
 *   const { runBacktest, walkForwardValidation } = require('./engine');
 *   const result = await runBacktest({ candles, initialCapital: 1000 });
 *   console.log(result.totalReturn, result.sharpeRatio, result.winRate);
 */

'use strict';

const { ema, bollingerBands, volumeConfirmation } = require('../edge-detector');

const TAG = '[backtest]';

// ─── Defaults (mirrored from self-evolving-brain) ────────────────────────────

const DEFAULT_WEIGHTS = {
  multiTfMomentum: 0.30,
  rsi: 0.15,
  bollingerBands: 0.10,
  volumeConfirmation: 0.10,
  atrVolatility: 0.05,
  regimeAlignment: 0.15,
  sentimentDivergence: 0.08,
  forecastAlignment: 0.04,
  geoRiskPenalty: 0.03,
};

const DEFAULT_THRESHOLDS = {
  minConfidence: 0.56,
  maxConfidence: 0.95,
  overboughtRsi: 70,
  oversoldRsi: 30,
  bbPercentBHigh: 0.9,
  bbPercentBLow: 0.1,
  bbSqueezeWidth: 0.02,
  bbHighVolWidth: 0.08,
  volumeMinRatio: 0.8,
  volumeSurgeRatio: 2.0,
  minEdge: 0.10,
};

const BARS_PER_YEAR = 8760;   // 365 * 24 for 1h candles
const BARS_PER_DAY = 24;
const DAILY_LOSS_LIMIT_PCT = 0.08;

// ─── Precompute Helpers ──────────────────────────────────────────────────────
// Produce per-bar indicator series in O(n), avoiding O(n^2) recomputation
// in the hot loop. Algorithms match edge-detector.js exactly (Wilder smoothing).

/**
 * Pre-compute RSI for every bar using Wilder's smoothing.
 * result[i] = RSI after processing closes[0..i]. null when insufficient data.
 * @param {number[]} closes
 * @param {number} period
 * @returns {Array<number|null>}
 */
function precomputeRsiSeries(closes, period) {
  const n = closes.length;
  const result = new Array(n);
  for (let i = 0; i < n; i++) result[i] = null;

  if (n < period + 1) return result;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) gainSum += delta;
    else lossSum -= delta;
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < n; i++) {
    const delta = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (delta > 0 ? delta : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (delta < 0 ? -delta : 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

/**
 * Pre-compute ATR for every bar using Wilder's smoothing.
 * result[i] = ATR after processing candles[0..i]. null when insufficient data.
 * @param {Array<{high: number, low: number, close: number}>} candles
 * @param {number} period
 * @returns {Array<number|null>}
 */
function precomputeAtrSeries(candles, period) {
  const n = candles.length;
  const result = new Array(n);
  for (let i = 0; i < n; i++) result[i] = null;

  if (n < period + 1) return result;

  // Initial ATR: simple mean of first `period` true ranges
  let atrVal = 0;
  for (let i = 1; i <= period; i++) {
    atrVal += Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
  }
  atrVal /= period;
  result[period] = atrVal;

  // Wilder's smoothing for remaining bars
  for (let i = period + 1; i < n; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    atrVal = (atrVal * (period - 1) + tr) / period;
    result[i] = atrVal;
  }

  return result;
}

// ─── Position Close Helper ───────────────────────────────────────────────────

/**
 * Compute P&L for closing a position at a given exit price.
 * @param {object} position  - Open position state
 * @param {number} exitPrice - Fill price for exit
 * @param {number} fees      - Fee rate (e.g. 0.001 = 0.1%)
 * @returns {{ pnl: number, pnlPct: number, totalFees: number }}
 */
function closePosition(position, exitPrice, fees) {
  const exitValue = position.units * exitPrice;
  const exitFees = exitValue * fees;
  let pnl;
  if (position.side === 'buy') {
    // Long: profit = what we receive - what we paid - all fees
    pnl = exitValue - position.sizeUsd - position.entryFees - exitFees;
  } else {
    // Short: profit = what we received at entry - cost to cover - all fees
    pnl = position.sizeUsd - exitValue - position.entryFees - exitFees;
  }
  return {
    pnl,
    pnlPct: position.sizeUsd > 0 ? pnl / position.sizeUsd : 0,
    totalFees: position.entryFees + exitFees,
  };
}

/**
 * Build a trade record from a position close.
 * @param {object} position
 * @param {number} exitBar
 * @param {number} exitPrice
 * @param {string} exitReason
 * @param {{ pnl: number, pnlPct: number, totalFees: number }} closeResult
 * @returns {object}
 */
function buildTradeRecord(position, exitBar, exitPrice, exitReason, closeResult) {
  return {
    entryBar: position.entryBar,
    exitBar,
    side: position.side,
    entryPrice: position.entryPrice,
    exitPrice,
    pnl: Math.round(closeResult.pnl * 100) / 100,
    pnlPct: Math.round(closeResult.pnlPct * 10000) / 10000,
    fees: Math.round(closeResult.totalFees * 100) / 100,
    exitReason,
    confidence: position.confidence,
    edge: position.edge,
  };
}

// ─── Main Backtest ───────────────────────────────────────────────────────────

/**
 * Run a full backtest simulation over historical candle data.
 *
 * @param {object} options
 * @param {Array<{ts, open, high, low, close, volume}>} options.candles - Historical OHLCV data
 * @param {number} [options.initialCapital=1000]   - Starting USD
 * @param {number} [options.fees=0.001]            - Fee rate per trade leg (0.1%)
 * @param {number} [options.slippage=0.0005]       - Slippage rate (0.05%)
 * @param {object} [options.weights={}]            - Indicator weight overrides
 * @param {object} [options.thresholds={}]         - Threshold overrides
 * @param {number} [options.maxPositionPct=0.06]   - Max % of capital per position
 * @param {number} [options.maxDrawdownPct=0.20]   - Max drawdown before halting
 * @param {number} [options.minCandlesWarmup=50]   - Warmup bars skipped for indicators
 * @param {number} [options.cooldownBars=3]        - Min bars between trades
 * @returns {Promise<object>} Backtest results with trades, equity curve, and stats
 */
async function runBacktest(options = {}) {
  const {
    candles,
    initialCapital = 1000,
    fees = 0.001,
    slippage = 0.0005,
    weights: weightOverrides = {},
    thresholds: thresholdOverrides = {},
    maxPositionPct = 0.06,
    maxDrawdownPct = 0.20,
    minCandlesWarmup = 50,
    cooldownBars = 3,
  } = options;

  // ── Validation ──────────────────────────────────────────────────────────────

  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error(`${TAG} "candles" must be a non-empty array`);
  }
  if (candles.length <= minCandlesWarmup) {
    throw new Error(
      `${TAG} Need more than ${minCandlesWarmup} candles (got ${candles.length})`,
    );
  }

  const w = { ...DEFAULT_WEIGHTS, ...weightOverrides };
  const t = { ...DEFAULT_THRESHOLDS, ...thresholdOverrides };
  const n = candles.length;

  // ── Pre-extract closes ──────────────────────────────────────────────────────

  const closes = new Array(n);
  for (let i = 0; i < n; i++) closes[i] = candles[i].close;

  // ── Pre-compute indicator series — O(n) each ───────────────────────────────
  // EMA arrays: ema(closes, p) returns array where result[j] = EMA at bar j+(p-1).
  // To read EMA at bar i: ema_arr[i - (period - 1)].

  const ema8 = ema(closes, 8);    // ema8[j]  -> bar j + 7
  const ema21 = ema(closes, 21);  // ema21[j] -> bar j + 20
  const rsiSeries = precomputeRsiSeries(closes, 14);
  const atrSeries = precomputeAtrSeries(candles, 14);

  // ── Simulation state ────────────────────────────────────────────────────────

  const trades = [];
  const equityCurve = [];
  let cash = initialCapital;
  let position = null;
  let lastTradeBar = -cooldownBars - 1; // allow trading from first eligible bar
  let peakEquity = initialCapital;
  let maxDrawdown = 0;
  let maxDrawdownUsd = 0;
  let haltedByDrawdown = false;

  // Daily loss tracking (24-bar "days")
  let currentDayIdx = -1;
  let dayLoss = 0;
  let dayHalted = false;

  // ── Main simulation loop ────────────────────────────────────────────────────

  for (let i = minCandlesWarmup; i < n; i++) {
    // ── Day boundary ──
    const dayIdx = Math.floor((i - minCandlesWarmup) / BARS_PER_DAY);
    if (dayIdx !== currentDayIdx) {
      currentDayIdx = dayIdx;
      dayLoss = 0;
      dayHalted = false;
    }

    const bar = candles[i];
    const currentClose = bar.close;

    // ────────────────────────────────────────────────────────────────────────
    // STEP 1: Compute indicators at bar i
    // ────────────────────────────────────────────────────────────────────────

    // a. EMA crossover (8/21) on closes
    const ema8Idx = i - 7;
    const ema21Idx = i - 20;
    const ema8Val =
      ema8Idx >= 0 && ema8Idx < ema8.length ? ema8[ema8Idx] : null;
    const ema21Val =
      ema21Idx >= 0 && ema21Idx < ema21.length ? ema21[ema21Idx] : null;

    // b. RSI(14)
    const rsiVal = rsiSeries[i];

    // c. Bollinger Bands(20, 2) — needs 20 closes ending at bar i
    let bb = null;
    if (i >= 19) {
      bb = bollingerBands(closes.slice(i - 19, i + 1), 20, 2);
    }

    // d. ATR(14)
    const atrVal = atrSeries[i];

    // e. Volume confirmation (lookback 20)
    let volCheck;
    if (i >= 20) {
      volCheck = volumeConfirmation(candles.slice(i - 20, i + 1), 20);
    } else {
      volCheck = { confirmed: true, ratio: 1 };
    }

    // ────────────────────────────────────────────────────────────────────────
    // STEP 2: Compute composite score (matches edge-detector weighted formula)
    // ────────────────────────────────────────────────────────────────────────

    let compositeScore = 0;

    // EMA crossover direction + strength
    if (ema8Val !== null && ema21Val !== null && ema21Val > 0) {
      if (ema8Val > ema21Val) {
        const strength = Math.min(
          1,
          ((ema8Val - ema21Val) / ema21Val) * 1000,
        );
        compositeScore += w.multiTfMomentum * strength;
      } else if (ema8Val < ema21Val) {
        const strength = Math.min(
          1,
          ((ema21Val - ema8Val) / ema21Val) * 1000,
        );
        compositeScore -= w.multiTfMomentum * strength;
      }
    }

    // RSI contribution
    if (rsiVal !== null) {
      if (rsiVal > t.overboughtRsi) compositeScore -= w.rsi;
      else if (rsiVal < t.oversoldRsi) compositeScore += w.rsi;
    }

    // Bollinger Bands contribution
    if (bb) {
      if (bb.percentB > t.bbPercentBHigh) compositeScore -= w.bollingerBands;
      else if (bb.percentB < t.bbPercentBLow)
        compositeScore += w.bollingerBands;

      // Squeeze bonus: tight bands signal impending breakout
      if (bb.width < t.bbSqueezeWidth) compositeScore *= 1.15;
    }

    // Volume filter: reduce conviction when volume does not confirm
    if (!volCheck.confirmed) {
      compositeScore *= 1 - w.volumeConfirmation * 2.5;
    }

    // ────────────────────────────────────────────────────────────────────────
    // STEP 3: Determine signal side, confidence, edge
    // ────────────────────────────────────────────────────────────────────────

    const absScore = Math.abs(compositeScore);
    let signalSide = 'neutral';
    if (compositeScore > 0.02) signalSide = 'buy';
    else if (compositeScore < -0.02) signalSide = 'sell';

    const confidence = Math.min(0.95, 0.5 + absScore * 0.75);
    const edge = Math.min(1, absScore * 2);

    // ────────────────────────────────────────────────────────────────────────
    // STEP 4: Exit management — check SL / TP / opposite signal
    // ────────────────────────────────────────────────────────────────────────

    if (position) {
      let exitPrice = null;
      let exitReason = null;

      if (position.side === 'buy') {
        // Stop loss: bar's low breached the stop level
        if (bar.low <= position.stopLoss) {
          exitPrice = position.stopLoss * (1 - slippage);
          exitReason = 'stop_loss';
        }
        // Take profit: bar's high reached the target
        else if (bar.high >= position.takeProfit) {
          exitPrice = position.takeProfit * (1 - slippage);
          exitReason = 'take_profit';
        }
        // Opposite signal
        else if (signalSide === 'sell') {
          exitPrice = currentClose * (1 - slippage);
          exitReason = 'signal';
        }
      } else {
        // Short position exits
        if (bar.high >= position.stopLoss) {
          exitPrice = position.stopLoss * (1 + slippage);
          exitReason = 'stop_loss';
        } else if (bar.low <= position.takeProfit) {
          exitPrice = position.takeProfit * (1 + slippage);
          exitReason = 'take_profit';
        } else if (signalSide === 'buy') {
          exitPrice = currentClose * (1 + slippage);
          exitReason = 'signal';
        }
      }

      if (exitPrice !== null) {
        const result = closePosition(position, exitPrice, fees);
        cash += result.pnl;
        if (result.pnl < 0) dayLoss += Math.abs(result.pnl);
        trades.push(
          buildTradeRecord(position, i, exitPrice, exitReason, result),
        );
        position = null;
        lastTradeBar = i;
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // STEP 5: Mark-to-market equity
    // ────────────────────────────────────────────────────────────────────────

    let currentEquity = cash;
    if (position) {
      if (position.side === 'buy') {
        currentEquity += position.units * (currentClose - position.entryPrice);
      } else {
        currentEquity += position.units * (position.entryPrice - currentClose);
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // STEP 6: Drawdown tracking and kill switch
    // ────────────────────────────────────────────────────────────────────────

    if (currentEquity > peakEquity) peakEquity = currentEquity;

    const drawdown =
      peakEquity > 0 ? (peakEquity - currentEquity) / peakEquity : 0;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    const ddUsd = peakEquity - currentEquity;
    if (ddUsd > maxDrawdownUsd) maxDrawdownUsd = ddUsd;

    if (drawdown >= maxDrawdownPct && !haltedByDrawdown) {
      haltedByDrawdown = true;

      // Force close any open position
      if (position) {
        const forceExitPrice =
          position.side === 'buy'
            ? currentClose * (1 - slippage)
            : currentClose * (1 + slippage);

        const result = closePosition(position, forceExitPrice, fees);
        cash += result.pnl;
        if (result.pnl < 0) dayLoss += Math.abs(result.pnl);
        trades.push(
          buildTradeRecord(
            position,
            i,
            forceExitPrice,
            'drawdown_halt',
            result,
          ),
        );
        position = null;
        lastTradeBar = i;
        currentEquity = cash;
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // STEP 7: Daily loss limit
    // ────────────────────────────────────────────────────────────────────────

    if (dayLoss >= initialCapital * DAILY_LOSS_LIMIT_PCT) {
      dayHalted = true;
    }

    // ────────────────────────────────────────────────────────────────────────
    // STEP 8: Entry management
    // ────────────────────────────────────────────────────────────────────────

    if (
      !position &&
      signalSide !== 'neutral' &&
      !haltedByDrawdown &&
      !dayHalted
    ) {
      if (i - lastTradeBar >= cooldownBars) {
        if (currentEquity > 0 && atrVal !== null && atrVal > 0) {
          const kellyFrac = Math.min(0.5, edge * confidence);
          const sizeUsd = Math.min(
            maxPositionPct * currentEquity,
            currentEquity * kellyFrac,
          );

          if (sizeUsd > 0) {
            const entryPrice =
              signalSide === 'buy'
                ? currentClose * (1 + slippage)
                : currentClose * (1 - slippage);

            const entryFees = sizeUsd * fees;
            const units = sizeUsd / entryPrice;

            let stopLoss, takeProfit;
            if (signalSide === 'buy') {
              stopLoss = entryPrice - 2.0 * atrVal;
              takeProfit = entryPrice + 3.0 * atrVal;
            } else {
              stopLoss = entryPrice + 2.0 * atrVal;
              takeProfit = entryPrice - 3.0 * atrVal;
            }

            position = {
              side: signalSide,
              entryPrice,
              entryBar: i,
              units,
              sizeUsd,
              stopLoss,
              takeProfit,
              confidence,
              edge,
              entryFees,
            };

            // Recalculate equity with new position's immediate slippage cost
            if (position.side === 'buy') {
              currentEquity =
                cash + position.units * (currentClose - position.entryPrice);
            } else {
              currentEquity =
                cash + position.units * (position.entryPrice - currentClose);
            }
          }
        }
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // STEP 9: Record equity curve
    // ────────────────────────────────────────────────────────────────────────

    equityCurve.push({
      bar: i,
      ts: bar.ts,
      equity: Math.round(currentEquity * 100) / 100,
    });
  }

  // ── Force close remaining position at end of data ──────────────────────────

  if (position) {
    const lastClose = candles[n - 1].close;
    const exitPrice =
      position.side === 'buy'
        ? lastClose * (1 - slippage)
        : lastClose * (1 + slippage);

    const result = closePosition(position, exitPrice, fees);
    cash += result.pnl;
    trades.push(
      buildTradeRecord(position, n - 1, exitPrice, 'end_of_data', result),
    );
    position = null;

    // Update final equity curve point to reflect realized close
    if (equityCurve.length > 0) {
      equityCurve[equityCurve.length - 1].equity =
        Math.round(cash * 100) / 100;
    }
  }

  // ── Compute statistics ─────────────────────────────────────────────────────

  const finalEquity = cash;
  const totalReturn =
    initialCapital > 0 ? (finalEquity - initialCapital) / initialCapital : 0;
  const totalTrades = trades.length;

  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let holdingBarsSum = 0;

  for (let j = 0; j < totalTrades; j++) {
    const tr = trades[j];
    holdingBarsSum += tr.exitBar - tr.entryBar;
    if (tr.pnl > 0) {
      wins++;
      grossProfit += tr.pnl;
    } else {
      losses++;
      grossLoss += Math.abs(tr.pnl);
    }
  }

  const winRate = totalTrades > 0 ? wins / totalTrades : 0;
  const profitFactor =
    grossLoss > 0
      ? grossProfit / grossLoss
      : grossProfit > 0
        ? Infinity
        : 0;
  const avgWin = wins > 0 ? grossProfit / wins : 0;
  const avgLoss = losses > 0 ? grossLoss / losses : 0;
  const avgHoldingBars =
    totalTrades > 0 ? holdingBarsSum / totalTrades : 0;

  // ── Sharpe ratio (annualized) ──────────────────────────────────────────────
  // Per-bar returns -> annualize with sqrt(barsPerYear).
  // Uses population variance (standard for backtesting).

  let sharpeRatio = 0;
  if (equityCurve.length > 1) {
    let sumR = 0;
    let sumR2 = 0;
    const count = equityCurve.length - 1;

    for (let j = 1; j < equityCurve.length; j++) {
      const prev = equityCurve[j - 1].equity;
      const r = prev > 0 ? (equityCurve[j].equity - prev) / prev : 0;
      sumR += r;
      sumR2 += r * r;
    }

    const meanReturn = sumR / count;
    const variance = sumR2 / count - meanReturn * meanReturn;
    const stdReturn = Math.sqrt(Math.max(0, variance));

    if (stdReturn > 0) {
      sharpeRatio = (meanReturn / stdReturn) * Math.sqrt(BARS_PER_YEAR);
    }
  }

  // ── Return results ─────────────────────────────────────────────────────────

  return {
    trades,
    equityCurve,
    finalEquity: Math.round(finalEquity * 100) / 100,
    totalReturn: Math.round(totalReturn * 10000) / 10000,
    totalTrades,
    wins,
    losses,
    winRate: Math.round(winRate * 10000) / 10000,
    profitFactor:
      profitFactor === Infinity
        ? Infinity
        : Math.round(profitFactor * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 10000) / 10000,
    maxDrawdownUsd: Math.round(maxDrawdownUsd * 100) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    avgHoldingBars: Math.round(avgHoldingBars * 100) / 100,
    haltedByDrawdown,
  };
}

// ─── Walk-Forward Validation ─────────────────────────────────────────────────

/**
 * Split candles into train/test sets and run backtests on each to detect
 * overfitting. If the test-set Sharpe ratio is less than 50% of the
 * train-set Sharpe ratio, the strategy is flagged as overfit.
 *
 * @param {Array<{ts, open, high, low, close, volume}>} candles - Full dataset
 * @param {object} options  - Options forwarded to runBacktest (excluding candles)
 * @param {object} config
 * @param {number} [config.trainPct=0.7]  - Fraction of candles for training
 * @param {number} [config.folds=1]       - Number of walk-forward folds
 * @returns {Promise<{ train: object, test: object, overfit: boolean }>}
 */
async function walkForwardValidation(candles, options = {}, config = {}) {
  const { trainPct = 0.7, folds = 1 } = config;

  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error(`${TAG} "candles" must be a non-empty array`);
  }

  const warmup = options.minCandlesWarmup || 50;

  if (folds <= 1) {
    // ── Single train/test split ────────────────────────────────────────────
    const splitIdx = Math.floor(candles.length * trainPct);
    const trainCandles = candles.slice(0, splitIdx);
    const testCandles = candles.slice(splitIdx);

    if (trainCandles.length <= warmup) {
      throw new Error(
        `${TAG} Insufficient candles for training set (${trainCandles.length} <= ${warmup} warmup)`,
      );
    }
    if (testCandles.length <= warmup) {
      throw new Error(
        `${TAG} Insufficient candles for test set (${testCandles.length} <= ${warmup} warmup)`,
      );
    }

    const trainResult = await runBacktest({ ...options, candles: trainCandles });
    const testResult = await runBacktest({
      ...options,
      candles: testCandles,
      weights: options.weights || {},
    });

    const trainSharpe = trainResult.sharpeRatio || 0;
    const testSharpe = testResult.sharpeRatio || 0;
    const overfit = trainSharpe > 0 && testSharpe < trainSharpe * 0.5;

    return { train: trainResult, test: testResult, overfit };
  }

  // ── Multi-fold anchored walk-forward ───────────────────────────────────────
  // Divide data into (folds + 1) segments. For each fold k:
  //   train = segments 0..k, test = segment k+1.
  // Return the final (most recent) fold's results, which represents
  // the most up-to-date out-of-sample performance estimate.

  const segmentLen = Math.floor(candles.length / (folds + 1));
  let lastTrain = null;
  let lastTest = null;

  for (let k = 0; k < folds; k++) {
    const trainEnd = (k + 1) * segmentLen;
    const testEnd = Math.min((k + 2) * segmentLen, candles.length);
    const trainCandles = candles.slice(0, trainEnd);
    const testCandles = candles.slice(trainEnd, testEnd);

    if (trainCandles.length <= warmup || testCandles.length <= warmup) {
      continue; // skip folds with insufficient data
    }

    lastTrain = await runBacktest({ ...options, candles: trainCandles });
    lastTest = await runBacktest({
      ...options,
      candles: testCandles,
      weights: options.weights || {},
    });
  }

  if (!lastTrain || !lastTest) {
    throw new Error(
      `${TAG} No valid fold could be computed (insufficient candles per segment)`,
    );
  }

  const trainSharpe = lastTrain.sharpeRatio || 0;
  const testSharpe = lastTest.sharpeRatio || 0;
  const overfit = trainSharpe > 0 && testSharpe < trainSharpe * 0.5;

  return { train: lastTrain, test: lastTest, overfit };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { runBacktest, walkForwardValidation };
