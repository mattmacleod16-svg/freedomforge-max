/**
 * Backtest Report Generator — Human-readable and machine-readable reports.
 * ========================================================================
 *
 * Takes backtest engine results and produces formatted text reports,
 * structured JSON reports, and strategy comparison tables.
 *
 * Features:
 *   - Text report with performance summary, trade stats, monthly returns,
 *     top/bottom trades, exit reason breakdown, and risk grading
 *   - JSON report with sampled equity curve (max 500 points) and structured
 *     metrics suitable for API responses or file persistence
 *   - Side-by-side comparison of two backtest results
 *   - Risk grading from A+ to F with actionable recommendations
 *
 * Usage:
 *   const { generateTextReport, generateJsonReport, compareReports } = require('../lib/backtest/report');
 *   const text = generateTextReport(backtestResult, { asset: 'BTC', interval: '1h' });
 *   const json = generateJsonReport(backtestResult, { asset: 'ETH', interval: '4h' });
 *   const cmp  = compareReports(resultA, resultB);
 *
 * No external dependencies — uses only core Node.js.
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_EQUITY_CURVE_POINTS = 500;

const DOUBLE_LINE = '\u2550';  // ═
const SINGLE_LINE = '\u2500';  // ─
const RULE_WIDTH  = 51;

const RISK_GRADES = [
  { grade: 'A+', label: 'Excellent',  check: (r) => r.sharpeRatio > 2.0 && r.maxDrawdown < 10 && r.profitFactor > 2.5 },
  { grade: 'A',  label: 'Very Good',  check: (r) => r.sharpeRatio > 1.5 && r.maxDrawdown < 15 && r.profitFactor > 2.0 },
  { grade: 'B+', label: 'Good',       check: (r) => r.sharpeRatio > 1.0 && r.maxDrawdown < 20 && r.profitFactor > 1.5 },
  { grade: 'B',  label: 'Fair',       check: (r) => r.sharpeRatio > 0.5 && r.maxDrawdown < 25 && r.profitFactor > 1.2 },
  { grade: 'C',  label: 'Mediocre',   check: (r) => r.sharpeRatio > 0   && r.profitFactor > 1.0 },
  { grade: 'D',  label: 'Poor',       check: (r) => r.sharpeRatio <= 0  || r.profitFactor <= 1.0 },
];

// ─── Formatting Helpers ───────────────────────────────────────────────────────

/**
 * Repeat a character to form a horizontal rule.
 * @param {string} ch
 * @param {number} width
 * @returns {string}
 */
function rule(ch, width) {
  let line = '';
  for (let i = 0; i < width; i++) line += ch;
  return line;
}

/**
 * Format a number as USD with two decimal places.
 * @param {number} n
 * @returns {string}
 */
function fmtUsd(n) {
  if (n == null || !Number.isFinite(n)) return '$0.00';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  return sign + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format a number as a percentage with two decimal places.
 * @param {number} n - percentage value (e.g. 23.46 for 23.46%)
 * @param {boolean} [showSign=true]
 * @returns {string}
 */
function fmtPct(n, showSign) {
  if (showSign === undefined) showSign = true;
  if (n == null || !Number.isFinite(n)) return '0.00%';
  const prefix = showSign ? (n > 0 ? '+' : '') : '';
  return prefix + n.toFixed(2) + '%';
}

/**
 * Format a number with a fixed number of decimal places.
 * @param {number} n
 * @param {number} [decimals=2]
 * @returns {string}
 */
function fmtNum(n, decimals) {
  if (decimals === undefined) decimals = 2;
  if (n == null || !Number.isFinite(n)) return '0';
  return n.toFixed(decimals);
}

/**
 * Right-pad a string to a given width.
 * @param {string} s
 * @param {number} w
 * @returns {string}
 */
function padRight(s, w) {
  while (s.length < w) s += ' ';
  return s;
}

/**
 * Left-pad a string to a given width.
 * @param {string} s
 * @param {number} w
 * @returns {string}
 */
function padLeft(s, w) {
  while (s.length < w) s = ' ' + s;
  return s;
}

// ─── Metric Helpers ───────────────────────────────────────────────────────────

/**
 * Normalize maxDrawdown to a positive percentage value.
 * The backtest engine may store it as negative or as a decimal fraction.
 * We always want a positive number representing the percentage.
 * @param {number} dd
 * @returns {number}
 */
function normalizeDrawdown(dd) {
  if (dd == null || !Number.isFinite(dd)) return 0;
  let val = Math.abs(dd);
  // If it looks like a decimal fraction (< 1), convert to percentage
  if (val > 0 && val < 1) val *= 100;
  return val;
}

/**
 * Normalize totalReturn — could be decimal (0.2346) or percentage (23.46).
 * We always want percentage representation.
 * @param {number} ret
 * @returns {number}
 */
function normalizePct(ret) {
  if (ret == null || !Number.isFinite(ret)) return 0;
  // Heuristic: if absolute value <= 5 it's likely a decimal fraction
  if (Math.abs(ret) <= 5 && Math.abs(ret) !== 0) {
    // Could be either — check if it makes sense as a decimal
    // Values like 0.23 (23%) are clearly decimals.
    // Values like 3.5 (350%?!) are ambiguous. We treat < 1.0 as decimal.
    if (Math.abs(ret) < 1) return ret * 100;
  }
  return ret;
}

// ─── Monthly Returns Calculation ──────────────────────────────────────────────

/**
 * Group trades by exit month and compute monthly returns.
 * Monthly return = sum of P&L in that month / equity at start of that month.
 *
 * @param {Array} trades
 * @param {Array} equityCurve
 * @param {number} [initialCapital=1000]
 * @returns {Object} e.g. { '2024-01': 3.2, '2024-02': -1.1, ... }
 */
function calculateMonthlyReturns(trades, equityCurve, initialCapital) {
  if (initialCapital === undefined) initialCapital = 1000;
  if (!trades || trades.length === 0) return {};

  // Build a map of bar -> equity from the equity curve for lookups
  const equityByBar = {};
  if (equityCurve && equityCurve.length > 0) {
    for (let i = 0; i < equityCurve.length; i++) {
      const pt = equityCurve[i];
      if (pt.bar != null) equityByBar[pt.bar] = pt.equity;
    }
  }

  // Build month -> { pnl, startEquity } map
  // We figure out the month from exit timestamp if available, else from exitBar.
  const monthBuckets = {};

  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i];
    let monthKey = null;

    // Try to derive month from exit bar's timestamp via equity curve
    if (trade.exitBar != null && equityCurve && equityCurve.length > 0) {
      // Find the equity curve point for this exit bar
      for (let j = 0; j < equityCurve.length; j++) {
        if (equityCurve[j].bar === trade.exitBar && equityCurve[j].ts) {
          const d = new Date(equityCurve[j].ts);
          if (!isNaN(d.getTime())) {
            monthKey = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
          }
          break;
        }
      }
    }

    // Fallback: if trades have a ts field or exitTs field
    if (!monthKey && trade.exitTs) {
      const d = new Date(trade.exitTs);
      if (!isNaN(d.getTime())) {
        monthKey = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
      }
    }

    // Last resort: assign to a synthetic month based on exitBar
    if (!monthKey) {
      // Group by 720-bar chunks as a rough monthly proxy
      const monthNum = trade.exitBar != null ? Math.floor(trade.exitBar / 720) : 0;
      monthKey = 'period-' + monthNum;
    }

    if (!monthBuckets[monthKey]) {
      monthBuckets[monthKey] = { pnl: 0, startEquity: 0 };
    }
    monthBuckets[monthKey].pnl += (trade.pnl || 0);
  }

  // Determine start-of-month equity.
  // Walk through months in order, tracking cumulative equity.
  const sortedMonths = Object.keys(monthBuckets).sort();
  let runningEquity = initialCapital;

  const monthlyReturns = {};
  for (let i = 0; i < sortedMonths.length; i++) {
    const key = sortedMonths[i];
    const bucket = monthBuckets[key];
    const startEq = Math.max(runningEquity, 1); // avoid division by zero
    const retPct = (bucket.pnl / startEq) * 100;
    monthlyReturns[key] = Math.round(retPct * 100) / 100;
    runningEquity += bucket.pnl;
  }

  return monthlyReturns;
}

// ─── Exit Reason Breakdown ────────────────────────────────────────────────────

/**
 * Count trades grouped by exit reason.
 * @param {Array} trades
 * @returns {Object} e.g. { opposite_signal: { count: 28, pct: 59.6 }, ... }
 */
function calculateExitReasons(trades) {
  if (!trades || trades.length === 0) return {};

  const counts = {};
  for (let i = 0; i < trades.length; i++) {
    const reason = trades[i].exitReason || 'unknown';
    counts[reason] = (counts[reason] || 0) + 1;
  }

  const total = trades.length;
  const breakdown = {};
  const reasons = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });

  for (let i = 0; i < reasons.length; i++) {
    const reason = reasons[i];
    breakdown[reason] = {
      count: counts[reason],
      pct: Math.round((counts[reason] / total) * 1000) / 10,
    };
  }

  return breakdown;
}

// ─── Risk Grading ─────────────────────────────────────────────────────────────

/**
 * Compute risk grade and recommendations based on backtest metrics.
 * @param {object} result - backtest result object
 * @returns {{ grade: string, label: string, description: string, recommendations: string[] }}
 */
function computeRiskGrade(result) {
  const totalReturn = normalizePct(result.totalReturn);
  const maxDD = normalizeDrawdown(result.maxDrawdown);
  const sharpe = result.sharpeRatio || 0;
  const pf = result.profitFactor || 0;
  const winRate = result.winRate || 0;
  const avgHold = result.avgHoldingBars || 0;
  const totalTrades = result.totalTrades || 0;

  // Normalized view for grade checks
  const normalized = {
    sharpeRatio: sharpe,
    maxDrawdown: maxDD,
    profitFactor: pf,
    totalReturn: totalReturn,
  };

  // Check for F grade first (overrides everything)
  let grade = 'D';
  let label = 'Poor';

  if (totalReturn < -10) {
    grade = 'F';
    label = 'Failing';
  } else {
    // Walk through grades from best to worst
    for (let i = 0; i < RISK_GRADES.length; i++) {
      if (RISK_GRADES[i].check(normalized)) {
        grade = RISK_GRADES[i].grade;
        label = RISK_GRADES[i].label;
        break;
      }
    }
  }

  // Build description
  const descriptions = {
    'A+': 'Outstanding - Exceptional risk-adjusted returns with minimal drawdown',
    'A':  'Very Good - Strong returns with well-controlled risk',
    'B+': 'Good - Positive returns with controlled drawdown',
    'B':  'Fair - Acceptable returns but room for improvement',
    'C':  'Mediocre - Marginal profitability with notable risk',
    'D':  'Poor - Unprofitable or excessive risk',
    'F':  'Failing - Significant capital loss',
  };

  // Build recommendations
  const recommendations = [];

  if (winRate < 40) {
    recommendations.push('Consider raising confidence threshold to filter weak signals');
  }
  if (maxDD > 15) {
    recommendations.push('Reduce position sizing or tighten stop losses');
  }
  if (avgHold > 0 && avgHold < 2) {
    recommendations.push('Holding period is very short - check for overtrading');
  }
  if (pf > 0 && pf < 1.5) {
    recommendations.push('Edge is thin - focus on improving signal quality');
  }
  if (sharpe < 0.5) {
    recommendations.push('Risk-adjusted returns are poor - review strategy fundamentals');
  }
  if (totalTrades > 0 && totalTrades < 20) {
    recommendations.push('Insufficient trades for statistical significance');
  }

  if (recommendations.length === 0) {
    recommendations.push('Strategy metrics look healthy - continue monitoring');
  }

  return {
    grade: grade,
    label: label,
    description: descriptions[grade] || descriptions['D'],
    recommendations: recommendations,
  };
}

// ─── Equity Curve Sampling ────────────────────────────────────────────────────

/**
 * Downsample an equity curve to at most maxPoints evenly-spaced points.
 * Always includes the first and last points.
 * @param {Array} curve
 * @param {number} [maxPoints=500]
 * @returns {Array}
 */
function sampleEquityCurve(curve, maxPoints) {
  if (maxPoints === undefined) maxPoints = MAX_EQUITY_CURVE_POINTS;
  if (!curve || curve.length === 0) return [];
  if (curve.length <= maxPoints) return curve.slice();

  const sampled = [];
  const step = (curve.length - 1) / (maxPoints - 1);

  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step);
    sampled.push(curve[idx]);
  }

  // Ensure last point is always included
  if (sampled[sampled.length - 1] !== curve[curve.length - 1]) {
    sampled[sampled.length - 1] = curve[curve.length - 1];
  }

  return sampled;
}

// ─── Top/Bottom Trades ────────────────────────────────────────────────────────

/**
 * Get the top N winning and losing trades sorted by absolute P&L.
 * @param {Array} trades
 * @param {number} [n=5]
 * @returns {{ topWins: Array, topLosses: Array }}
 */
function getTopTrades(trades, n) {
  if (n === undefined) n = 5;
  if (!trades || trades.length === 0) return { topWins: [], topLosses: [] };

  const sorted = trades.slice().sort(function (a, b) { return (b.pnl || 0) - (a.pnl || 0); });

  const topWins = [];
  const topLosses = [];

  for (let i = 0; i < sorted.length && topWins.length < n; i++) {
    if ((sorted[i].pnl || 0) > 0) topWins.push(sorted[i]);
  }

  for (let i = sorted.length - 1; i >= 0 && topLosses.length < n; i--) {
    if ((sorted[i].pnl || 0) < 0) topLosses.push(sorted[i]);
  }

  return { topWins: topWins, topLosses: topLosses };
}

// ─── Bar Chart Helpers ────────────────────────────────────────────────────────

/**
 * Render a simple horizontal bar using unicode block characters.
 * @param {number} value
 * @param {number} maxAbsValue
 * @param {number} [maxBarWidth=20]
 * @returns {string}
 */
function renderBar(value, maxAbsValue, maxBarWidth) {
  if (maxBarWidth === undefined) maxBarWidth = 20;
  if (maxAbsValue === 0 || !Number.isFinite(value)) return '';

  const fraction = Math.abs(value) / maxAbsValue;
  const fullBlocks = Math.floor(fraction * maxBarWidth);
  const remainder = (fraction * maxBarWidth) - fullBlocks;

  // Unicode block elements for sub-character precision
  const partials = [' ', '\u258F', '\u258E', '\u258D', '\u258C', '\u258B', '\u258A', '\u2589', '\u2588'];
  const full = '\u2588';

  let bar = '';
  for (let i = 0; i < fullBlocks; i++) bar += full;

  if (remainder > 0.125) {
    const idx = Math.round(remainder * 8);
    bar += partials[Math.min(idx, 8)];
  }

  return bar;
}

// ─── Text Report Generator ───────────────────────────────────────────────────

/**
 * Generate a formatted text report from backtest results.
 *
 * @param {object} result - backtest result object from the engine
 * @param {object} [options={}]
 * @param {string} [options.asset]     - e.g. 'BTC'
 * @param {string} [options.interval]  - e.g. '1h'
 * @param {string} [options.startDate] - e.g. '2024-01-01'
 * @param {string} [options.endDate]   - e.g. '2024-06-01'
 * @returns {string}
 */
function generateTextReport(result, options) {
  if (!options) options = {};
  if (!result) return '[report] No backtest result provided.';

  const asset     = options.asset     || 'UNKNOWN';
  const interval  = options.interval  || '?';
  const startDate = options.startDate || '?';
  const endDate   = options.endDate   || '?';

  const totalReturn = normalizePct(result.totalReturn);
  const maxDD       = normalizeDrawdown(result.maxDrawdown);
  const initialCapital = (result.finalEquity && totalReturn !== 0)
    ? result.finalEquity / (1 + totalReturn / 100)
    : 1000;

  const lines = [];

  // ── Header ──────────────────────────────────────────────────────────────────
  lines.push(rule(DOUBLE_LINE, RULE_WIDTH));
  lines.push(' BACKTEST REPORT \u2014 ' + asset + ' ' + interval + ' (' + startDate + ' \u2192 ' + endDate + ')');
  lines.push(rule(DOUBLE_LINE, RULE_WIDTH));
  lines.push('');

  // ── Performance Summary ─────────────────────────────────────────────────────
  lines.push('PERFORMANCE SUMMARY');
  lines.push(rule(SINGLE_LINE, RULE_WIDTH));
  lines.push(padRight('Initial Capital:', 20) + fmtUsd(initialCapital));
  lines.push(padRight('Final Equity:', 20) + fmtUsd(result.finalEquity));
  lines.push(padRight('Total Return:', 20) + fmtPct(totalReturn));
  lines.push(padRight('Sharpe Ratio:', 20) + fmtNum(result.sharpeRatio));
  lines.push(padRight('Max Drawdown:', 20) + '-' + fmtNum(maxDD) + '%');
  lines.push(padRight('Max Drawdown USD:', 20) + fmtUsd(-(result.maxDrawdownUsd || 0)));
  lines.push(padRight('Profit Factor:', 20) + fmtNum(result.profitFactor));
  lines.push('');

  // ── Trade Statistics ────────────────────────────────────────────────────────
  lines.push('TRADE STATISTICS');
  lines.push(rule(SINGLE_LINE, RULE_WIDTH));
  lines.push(padRight('Total Trades:', 20) + (result.totalTrades || 0));
  lines.push(padRight('Wins:', 20) + (result.wins || 0));
  lines.push(padRight('Losses:', 20) + (result.losses || 0));
  lines.push(padRight('Win Rate:', 20) + fmtPct(result.winRate, false));
  lines.push(padRight('Avg Win:', 20) + fmtUsd(result.avgWin));
  lines.push(padRight('Avg Loss:', 20) + fmtUsd(-(Math.abs(result.avgLoss || 0))));
  lines.push(padRight('Avg Holding:', 20) + fmtNum(result.avgHoldingBars, 1) + ' bars');
  lines.push(padRight('Halted by DD:', 20) + (result.haltedByDrawdown ? 'Yes' : 'No'));
  lines.push('');

  // ── Exit Reasons ────────────────────────────────────────────────────────────
  const exitReasons = calculateExitReasons(result.trades);
  const exitKeys = Object.keys(exitReasons);

  if (exitKeys.length > 0) {
    lines.push('EXIT REASONS');
    lines.push(rule(SINGLE_LINE, RULE_WIDTH));
    for (let i = 0; i < exitKeys.length; i++) {
      const reason = exitKeys[i];
      const info = exitReasons[reason];
      lines.push(padRight(reason + ':', 20) + info.count + ' (' + info.pct.toFixed(1) + '%)');
    }
    lines.push('');
  }

  // ── Monthly Returns ─────────────────────────────────────────────────────────
  const monthlyReturns = calculateMonthlyReturns(result.trades, result.equityCurve, initialCapital);
  const monthKeys = Object.keys(monthlyReturns).sort();

  if (monthKeys.length > 0) {
    lines.push('MONTHLY RETURNS');
    lines.push(rule(SINGLE_LINE, RULE_WIDTH));

    // Find max absolute return for bar scaling
    let maxAbsReturn = 0;
    for (let i = 0; i < monthKeys.length; i++) {
      const absVal = Math.abs(monthlyReturns[monthKeys[i]]);
      if (absVal > maxAbsReturn) maxAbsReturn = absVal;
    }

    for (let i = 0; i < monthKeys.length; i++) {
      const key = monthKeys[i];
      const ret = monthlyReturns[key];
      const pctStr = fmtPct(ret);
      const bar = renderBar(ret, maxAbsReturn, 20);
      lines.push(padRight(key + ':', 12) + padLeft(pctStr, 8) + '  ' + bar);
    }
    lines.push('');
  }

  // ── Top Winning Trades ──────────────────────────────────────────────────────
  const { topWins, topLosses } = getTopTrades(result.trades, 5);

  if (topWins.length > 0) {
    lines.push('TOP ' + topWins.length + ' WINNING TRADES');
    lines.push(rule(SINGLE_LINE, RULE_WIDTH));
    for (let i = 0; i < topWins.length; i++) {
      const t = topWins[i];
      const pnlStr = fmtUsd(t.pnl);
      const pctStr = fmtPct(t.pnlPct);
      const barStr = (t.entryBar != null && t.exitBar != null)
        ? '  [Bar ' + t.entryBar + '\u2192' + t.exitBar + ']'
        : '';
      lines.push('#' + (i + 1) + '  +' + pnlStr + ' (' + pctStr + ')' + barStr);
    }
    lines.push('');
  }

  // ── Top Losing Trades ───────────────────────────────────────────────────────
  if (topLosses.length > 0) {
    lines.push('TOP ' + topLosses.length + ' LOSING TRADES');
    lines.push(rule(SINGLE_LINE, RULE_WIDTH));
    for (let i = 0; i < topLosses.length; i++) {
      const t = topLosses[i];
      const pnlStr = fmtUsd(t.pnl);
      const pctStr = fmtPct(t.pnlPct);
      const barStr = (t.entryBar != null && t.exitBar != null)
        ? '  [Bar ' + t.entryBar + '\u2192' + t.exitBar + ']'
        : '';
      lines.push('#' + (i + 1) + '  ' + pnlStr + ' (' + pctStr + ')' + barStr);
    }
    lines.push('');
  }

  // ── Risk Assessment ─────────────────────────────────────────────────────────
  const riskGrade = computeRiskGrade(result);

  lines.push('RISK ASSESSMENT');
  lines.push(rule(SINGLE_LINE, RULE_WIDTH));
  lines.push('Grade: ' + riskGrade.grade + ' (' + riskGrade.description + ')');
  lines.push('');

  if (riskGrade.recommendations.length > 0) {
    lines.push('Recommendations:');
    for (let i = 0; i < riskGrade.recommendations.length; i++) {
      lines.push('- ' + riskGrade.recommendations[i]);
    }
  }

  lines.push(rule(DOUBLE_LINE, RULE_WIDTH));

  return lines.join('\n');
}

// ─── JSON Report Generator ───────────────────────────────────────────────────

/**
 * Generate a structured JSON report from backtest results.
 * Suitable for persisting to disk or returning via API.
 *
 * @param {object} result - backtest result object from the engine
 * @param {object} [options={}]
 * @param {string} [options.asset]
 * @param {string} [options.interval]
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @returns {object}
 */
function generateJsonReport(result, options) {
  if (!options) options = {};
  if (!result) {
    return {
      summary: {},
      trades: [],
      equityCurve: [],
      monthlyReturns: {},
      exitReasonBreakdown: {},
      riskGrade: { grade: 'F', label: 'No data', description: 'No backtest result provided', recommendations: [] },
      generatedAt: new Date().toISOString(),
    };
  }

  const totalReturn = normalizePct(result.totalReturn);
  const maxDD       = normalizeDrawdown(result.maxDrawdown);
  const initialCapital = (result.finalEquity && totalReturn !== 0)
    ? result.finalEquity / (1 + totalReturn / 100)
    : 1000;

  const riskGrade = computeRiskGrade(result);
  const monthlyReturns = calculateMonthlyReturns(result.trades, result.equityCurve, initialCapital);
  const exitReasonBreakdown = calculateExitReasons(result.trades);
  const sampledCurve = sampleEquityCurve(result.equityCurve);

  return {
    summary: {
      asset:            options.asset     || null,
      interval:         options.interval  || null,
      startDate:        options.startDate || null,
      endDate:          options.endDate   || null,
      initialCapital:   Math.round(initialCapital * 100) / 100,
      finalEquity:      result.finalEquity      || 0,
      totalReturn:      totalReturn,
      totalTrades:      result.totalTrades      || 0,
      wins:             result.wins             || 0,
      losses:           result.losses           || 0,
      winRate:          result.winRate           || 0,
      profitFactor:     result.profitFactor      || 0,
      sharpeRatio:      result.sharpeRatio       || 0,
      maxDrawdown:      maxDD,
      maxDrawdownUsd:   result.maxDrawdownUsd    || 0,
      avgWin:           result.avgWin            || 0,
      avgLoss:          result.avgLoss           || 0,
      avgHoldingBars:   result.avgHoldingBars    || 0,
      haltedByDrawdown: result.haltedByDrawdown  || false,
    },
    trades:              result.trades || [],
    equityCurve:         sampledCurve,
    monthlyReturns:      monthlyReturns,
    exitReasonBreakdown: exitReasonBreakdown,
    riskGrade: {
      grade:           riskGrade.grade,
      label:           riskGrade.label,
      description:     riskGrade.description,
      recommendations: riskGrade.recommendations,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─── Report Comparison ────────────────────────────────────────────────────────

/**
 * Compare two backtest results side by side.
 * Returns a structured comparison with per-metric winners and an overall verdict.
 *
 * @param {object} resultA - first backtest result
 * @param {object} resultB - second backtest result
 * @returns {{ metrics: object, verdict: string }}
 */
function compareReports(resultA, resultB) {
  if (!resultA || !resultB) {
    return {
      metrics: {},
      verdict: 'Cannot compare: one or both results are missing.',
    };
  }

  // Metrics to compare and whether "higher is better"
  const metricDefs = [
    { key: 'totalReturn',    label: 'Total Return (%)',  higherBetter: true,  extractA: normalizePct(resultA.totalReturn),    extractB: normalizePct(resultB.totalReturn)    },
    { key: 'sharpeRatio',    label: 'Sharpe Ratio',      higherBetter: true,  extractA: resultA.sharpeRatio    || 0,          extractB: resultB.sharpeRatio    || 0           },
    { key: 'profitFactor',   label: 'Profit Factor',     higherBetter: true,  extractA: resultA.profitFactor   || 0,          extractB: resultB.profitFactor   || 0           },
    { key: 'winRate',        label: 'Win Rate (%)',       higherBetter: true,  extractA: resultA.winRate        || 0,          extractB: resultB.winRate        || 0           },
    { key: 'maxDrawdown',    label: 'Max Drawdown (%)',   higherBetter: false, extractA: normalizeDrawdown(resultA.maxDrawdown), extractB: normalizeDrawdown(resultB.maxDrawdown) },
    { key: 'avgHoldingBars', label: 'Avg Holding (bars)', higherBetter: null,  extractA: resultA.avgHoldingBars || 0,         extractB: resultB.avgHoldingBars || 0           },
  ];

  const metrics = {};
  let aWins = 0;
  let bWins = 0;
  let comparableCount = 0;

  for (let i = 0; i < metricDefs.length; i++) {
    const def = metricDefs[i];
    const a = def.extractA;
    const b = def.extractB;

    let winner = 'tie';
    if (def.higherBetter !== null) {
      comparableCount++;
      if (def.higherBetter) {
        if (a > b) { winner = 'A'; aWins++; }
        else if (b > a) { winner = 'B'; bWins++; }
      } else {
        // Lower is better (e.g., drawdown)
        if (a < b) { winner = 'A'; aWins++; }
        else if (b < a) { winner = 'B'; bWins++; }
      }
    }

    metrics[def.key] = {
      label: def.label,
      a: Math.round(a * 100) / 100,
      b: Math.round(b * 100) / 100,
      winner: winner,
    };
  }

  // Build verdict
  let verdict;
  if (aWins > bWins) {
    verdict = 'Strategy A outperforms on ' + aWins + '/' + comparableCount + ' key metrics';
  } else if (bWins > aWins) {
    verdict = 'Strategy B outperforms on ' + bWins + '/' + comparableCount + ' key metrics';
  } else {
    verdict = 'Strategies are evenly matched (' + aWins + '/' + comparableCount + ' each)';
  }

  // Add risk grade comparison
  const gradeA = computeRiskGrade(resultA);
  const gradeB = computeRiskGrade(resultB);

  metrics.riskGrade = {
    label: 'Risk Grade',
    a: gradeA.grade,
    b: gradeB.grade,
    winner: gradeA.grade < gradeB.grade ? 'A' : (gradeB.grade < gradeA.grade ? 'B' : 'tie'),
  };

  return {
    metrics: metrics,
    verdict: verdict,
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  generateTextReport,
  generateJsonReport,
  compareReports,
};
