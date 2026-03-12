/**
 * VaR Engine -- Portfolio-level Value-at-Risk analytics and
 * correlation-aware position sizing for FreedomForge.
 * =====================================================================
 *
 * Provides:
 *   1. Historical VaR (sort-and-percentile on real return series)
 *   2. Parametric VaR (normal-distribution shortcut)
 *   3. Portfolio VaR with correlation matrix
 *   4. Correlation matrix builder from price histories
 *   5. VaR-constrained position sizer
 *   6. Risk contribution analysis (marginal VaR per position)
 *   7. Enhanced risk check that layers VaR on top of risk-manager
 *
 * Zero external dependencies beyond Node built-ins.
 *
 * Usage:
 *   const varEngine = require('./var-engine');
 *   const hist = varEngine.calculateVaR(returnsArray);
 *   const pVar = varEngine.portfolioVaR(positions, corrMatrix);
 *   const size = varEngine.varConstrainedSize({ baseUsd: 25, ... });
 *   const ok   = varEngine.enhancedRiskCheck(tradeParams);
 */

'use strict';

const path = require('path');

// ── Resilient I/O (optional) ─────────────────────────────────────────────────

let rio;
try { rio = require('./resilient-io'); } catch { rio = null; }

// ── Logger (optional) ────────────────────────────────────────────────────────

let log;
try {
  const { createLogger } = require('./logger');
  log = createLogger('var-engine');
} catch {
  log = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
  };
}

// ── Configuration ────────────────────────────────────────────────────────────

const VAR_CONFIDENCE_LEVEL = Math.max(0.9, Math.min(0.999, Number(process.env.VAR_CONFIDENCE_LEVEL || 0.95)));
const VAR_PORTFOLIO_LIMIT_PCT = Math.max(1, Math.min(25, Number(process.env.VAR_PORTFOLIO_LIMIT_PCT || 5)));
const VAR_LOOKBACK_DAYS = Math.max(7, Math.min(365, parseInt(process.env.VAR_LOOKBACK_DAYS || '30', 10)));

// Z-scores for common confidence levels (one-tailed)
const Z_SCORES = {
  0.90: 1.282,
  0.95: 1.645,
  0.99: 2.326,
};

/**
 * Linearly interpolate a Z-score for arbitrary confidence levels.
 * Falls back to the nearest known value for extreme inputs.
 */
function zScore(confidence) {
  if (Z_SCORES[confidence] !== undefined) return Z_SCORES[confidence];
  // Approximation via Beasley-Springer-Moro for the normal inverse CDF
  // Good enough for risk management (error < 0.0003 for 0.9-0.999)
  const p = confidence;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02,
    -2.759285104469687e+02, 1.383577518672690e+02,
    -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02,
    -1.556989798598866e+02, 6.680131188771972e+01,
    -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01,
    -2.400758277161838e+00, -2.549732539343734e+00,
    4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01,
    2.445134137142996e+00, 3.754408661907416e+00];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q, r;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Historical VaR
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate VaR using historical simulation.
 *
 * @param {number[]} returns - Array of historical percentage returns
 *                             (e.g. [1.2, -0.5, 0.3, ...])
 * @param {number}   [confidenceLevel=0.95] - Confidence level (0-1)
 * @returns {{ var95: number, var99: number, cvar95: number }}
 *   Negative values represent losses. E.g. var95 = -2.3 means
 *   "95% confident daily loss will not exceed 2.3%".
 */
function calculateVaR(returns, confidenceLevel = 0.95) {
  if (!Array.isArray(returns) || returns.length < 2) {
    return { var95: 0, var99: 0, cvar95: 0 };
  }

  // Filter out non-finite values
  const clean = returns.filter(r => Number.isFinite(r));
  if (clean.length < 2) return { var95: 0, var99: 0, cvar95: 0 };

  // Sort ascending (worst losses first as most-negative)
  const sorted = [...clean].sort((a, b) => a - b);

  // VaR at a given confidence = percentile at (1 - confidence)
  // E.g. 95% confidence -> 5th percentile
  const index95 = Math.max(0, Math.floor(sorted.length * (1 - 0.95)));
  const index99 = Math.max(0, Math.floor(sorted.length * (1 - 0.99)));

  const var95 = sorted[index95];
  const var99 = sorted[index99];

  // CVaR (Expected Shortfall) at 95%: mean of all returns worse than VaR95
  const tailReturns = sorted.slice(0, index95 + 1);
  const cvar95 = tailReturns.length > 0
    ? tailReturns.reduce((sum, v) => sum + v, 0) / tailReturns.length
    : var95;

  return {
    var95: round6(var95),
    var99: round6(var99),
    cvar95: round6(cvar95),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. Parametric VaR
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Parametric (variance-covariance) VaR assuming normal returns,
 * plus CVaR (Expected Shortfall) using the parametric normal formula:
 *   CVaR = mean - stdDev * sqrt(T) * phi(z) / (1 - confidence)
 * where phi(z) is the standard normal PDF evaluated at the z-score.
 *
 * @param {number} mean    - Mean return (%)
 * @param {number} stdDev  - Standard deviation of returns (%)
 * @param {number} [confidenceLevel=0.95]
 * @param {number} [holdingPeriodDays=1]
 * @returns {{ var95: number, var99: number, cvar95: number, cvar99: number }}
 *   VaR = mean - Z * stdDev * sqrt(holdingPeriodDays)
 *   CVaR = mean - stdDev * sqrt(T) * phi(Z) / (1 - confidence)
 */
function parametricVaR(mean, stdDev, confidenceLevel = 0.95, holdingPeriodDays = 1) {
  if (!Number.isFinite(mean) || !Number.isFinite(stdDev) || stdDev < 0) {
    return { var95: 0, var99: 0, cvar95: 0, cvar99: 0 };
  }

  const sqrtT = Math.sqrt(Math.max(1, holdingPeriodDays));

  const var95 = mean - Z_SCORES[0.95] * stdDev * sqrtT;
  const var99 = mean - Z_SCORES[0.99] * stdDev * sqrtT;

  // CVaR (Expected Shortfall) for normal distribution:
  // CVaR_alpha = mean - stdDev * sqrt(T) * phi(z_alpha) / (1 - alpha)
  // phi(z) = standard normal PDF = exp(-z^2/2) / sqrt(2*pi)
  const phi95 = Math.exp(-(Z_SCORES[0.95] ** 2) / 2) / Math.sqrt(2 * Math.PI);
  const phi99 = Math.exp(-(Z_SCORES[0.99] ** 2) / 2) / Math.sqrt(2 * Math.PI);
  const cvar95 = mean - stdDev * sqrtT * phi95 / (1 - 0.95);
  const cvar99 = mean - stdDev * sqrtT * phi99 / (1 - 0.99);

  return {
    var95: round6(var95),
    var99: round6(var99),
    cvar95: round6(cvar95),
    cvar99: round6(cvar99),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. Portfolio VaR with Correlations
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Compute portfolio VaR incorporating cross-asset correlations.
 *
 * @param {Array<{asset: string, weight: number, meanReturn: number, stdDev: number}>} positions
 * @param {{ [pairKey: string]: number }} correlationMatrix
 *   Keys like 'BTC-ETH', values -1 to 1. Missing pairs default to 0.
 * @param {number} [confidenceLevel=0.95]
 * @returns {{ portfolioVar: number, diversificationBenefit: number, undiversifiedVar: number }}
 */
function portfolioVaR(positions, correlationMatrix, confidenceLevel = 0.95) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return { portfolioVar: 0, diversificationBenefit: 0, undiversifiedVar: 0 };
  }

  const z = zScore(confidenceLevel);

  // Portfolio variance: sum_i sum_j (wi * wj * sigma_i * sigma_j * rho_ij)
  let portfolioVariance = 0;
  let undiversifiedVol = 0; // sum of individual VaR contributions (no diversification)

  for (let i = 0; i < positions.length; i++) {
    const pi = positions[i];
    const wi = pi.weight || 0;
    const si = pi.stdDev || 0;

    undiversifiedVol += Math.abs(wi) * si;

    for (let j = 0; j < positions.length; j++) {
      const pj = positions[j];
      const wj = pj.weight || 0;
      const sj = pj.stdDev || 0;

      let rho;
      if (i === j) {
        rho = 1;
      } else {
        rho = getCorrelation(correlationMatrix, pi.asset, pj.asset);
      }

      portfolioVariance += wi * wj * si * sj * rho;
    }
  }

  // Portfolio VaR = Z * portfolio_sigma
  const portfolioSigma = Math.sqrt(Math.max(0, portfolioVariance));
  const portVaR = z * portfolioSigma;
  const undivVaR = z * undiversifiedVol;

  // Diversification benefit: how much less risk we have vs no-diversification
  const divBenefit = undivVaR > 0 ? (undivVaR - portVaR) / undivVaR * 100 : 0;

  return {
    portfolioVar: round6(portVaR),
    diversificationBenefit: round4(divBenefit),
    undiversifiedVar: round6(undivVaR),
  };
}

/**
 * Look up correlation between two assets in the matrix.
 * Tries both 'A-B' and 'B-A' orderings.
 */
function getCorrelation(matrix, assetA, assetB) {
  if (!matrix || assetA === assetB) return 1;
  const key1 = `${assetA}-${assetB}`;
  const key2 = `${assetB}-${assetA}`;
  if (matrix[key1] !== undefined) return matrix[key1];
  if (matrix[key2] !== undefined) return matrix[key2];
  return 0.4; // crypto assets are correlated, especially in crises; 0.4 is a safer default
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. Correlation Matrix Builder
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Build a Pearson correlation matrix from price history arrays.
 *
 * @param {{ [asset: string]: number[] }} priceHistory
 *   Each key is an asset symbol, value is array of prices (oldest first).
 * @returns {{ matrix: { [pairKey: string]: number }, assets: string[] }}
 */
function buildCorrelationMatrix(priceHistory) {
  if (!priceHistory || typeof priceHistory !== 'object') {
    return { matrix: {}, assets: [] };
  }

  const assets = Object.keys(priceHistory).filter(
    a => Array.isArray(priceHistory[a]) && priceHistory[a].length >= 3
  );

  if (assets.length < 2) {
    return { matrix: {}, assets };
  }

  // Convert price series to return series
  const returnSeries = {};
  for (const asset of assets) {
    returnSeries[asset] = pricesToReturns(priceHistory[asset]);
  }

  const matrix = {};
  for (let i = 0; i < assets.length; i++) {
    for (let j = i + 1; j < assets.length; j++) {
      const a = assets[i];
      const b = assets[j];
      const corr = pearsonCorrelation(returnSeries[a], returnSeries[b]);
      matrix[`${a}-${b}`] = round4(corr);
    }
  }

  return { matrix, assets };
}

/**
 * Convert a price series to percentage returns.
 * @param {number[]} prices
 * @returns {number[]}
 */
function pricesToReturns(prices) {
  if (!Array.isArray(prices) || prices.length < 2) return [];
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0 && Number.isFinite(prices[i]) && Number.isFinite(prices[i - 1])) {
      returns.push(((prices[i] - prices[i - 1]) / prices[i - 1]) * 100);
    }
  }
  return returns;
}

/**
 * Pearson correlation coefficient between two series.
 * Aligns to the shorter series length.
 * @param {number[]} x
 * @param {number[]} y
 * @returns {number} -1 to 1, or 0 if insufficient data
 */
function pearsonCorrelation(x, y) {
  if (!Array.isArray(x) || !Array.isArray(y)) return 0;
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;

  // Use the last n values from each series (most recent alignment)
  const xSlice = x.slice(-n);
  const ySlice = y.slice(-n);

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += xSlice[i];
    sumY += ySlice[i];
    sumXY += xSlice[i] * ySlice[i];
    sumX2 += xSlice[i] * xSlice[i];
    sumY2 += ySlice[i] * ySlice[i];
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
  );

  if (denominator === 0) return 0;
  return Math.max(-1, Math.min(1, numerator / denominator));
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. VaR-Constrained Position Sizer
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate position size constrained by portfolio VaR limit.
 *
 * If adding this position would push portfolio VaR beyond the limit,
 * scale down the size proportionally.
 *
 * @param {object} params
 * @param {number}  params.baseUsd          - Desired USD size before VaR constraint
 * @param {number}  [params.portfolioVarLimit] - Max acceptable VaR as % (default: VAR_PORTFOLIO_LIMIT_PCT)
 * @param {number}  [params.currentVaR]     - Current portfolio VaR as %
 * @param {number}  [params.assetVol]       - Volatility (stdDev) of the asset being traded (%)
 * @param {number}  [params.confidence]     - Signal confidence (0-1)
 * @param {number}  [params.edge]           - Signal edge (0-1)
 * @returns {number} Adjusted USD size
 */
function varConstrainedSize({
  baseUsd,
  portfolioVarLimit,
  currentVaR = 0,
  assetVol = 2,
  confidence = 0.5,
  edge = 0,
}) {
  if (!Number.isFinite(baseUsd) || baseUsd <= 0) return 0;

  const varLimit = Number.isFinite(portfolioVarLimit) && portfolioVarLimit > 0
    ? portfolioVarLimit
    : VAR_PORTFOLIO_LIMIT_PCT;

  const currentVarAbs = Math.abs(currentVaR);

  // How much VaR headroom remains
  const headroom = varLimit - currentVarAbs;

  if (headroom <= 0) {
    // Already at or beyond limit -- no new risk
    log.warn('VaR limit breached, blocking new position', {
      currentVaR: currentVarAbs,
      varLimit,
    });
    return 0;
  }

  // Estimate the marginal VaR contribution of this position
  // Simplified: marginal VaR ~ assetVol * Z_95 * (positionWeight)
  // Since we don't know the exact correlations here, use standalone vol as upper bound
  const z95 = Z_SCORES[0.95];
  const marginalVarPerDollar = (assetVol / 100) * z95;

  if (marginalVarPerDollar <= 0) return baseUsd;

  // Maximum dollars we can add before hitting the VaR limit
  // headroom is in %, marginalVarPerDollar is per $1, so we need to reconcile units
  // VaR headroom as fraction: headroom / 100
  // For a portfolio of size P, adding $X with vol sigma contributes roughly:
  //   delta_VaR ~ (X / P) * sigma * Z
  // Since we express VaR as a %, the max X = (headroom_fraction * P) / (sigma/100 * Z)
  // Without knowing total portfolio value, cap based on the ratio of headroom to asset risk
  const varRatio = (headroom / 100) / marginalVarPerDollar;
  const maxUsd = baseUsd * Math.min(1, varRatio);

  // Apply confidence-edge bonus: stronger signals get closer to the max
  const signalMultiplier = 0.5 + 0.5 * Math.min(1, (confidence * (1 + edge)));
  let adjustedSize = maxUsd * signalMultiplier;

  // Floor at $5 minimum viable order
  adjustedSize = Math.max(5, Math.round(adjustedSize * 100) / 100);

  // Never exceed the original base
  adjustedSize = Math.min(adjustedSize, baseUsd);

  if (adjustedSize < baseUsd) {
    log.info('VaR constraint reduced position size', {
      baseUsd,
      adjustedSize,
      currentVaR: currentVarAbs,
      headroom: round4(headroom),
      assetVol,
    });
  }

  return adjustedSize;
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. Risk Contribution Analysis
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Compute marginal VaR contribution of each position.
 *
 * Marginal VaR for position i = d(portfolioVaR) / d(wi)
 * Contribution% = (wi * marginalVaR_i) / portfolioVaR
 *
 * @param {Array<{asset: string, weight: number, meanReturn: number, stdDev: number}>} positions
 * @param {{ [pairKey: string]: number }} correlationMatrix
 * @returns {Array<{asset: string, marginalVar: number, contributionPct: number}>}
 */
function riskContribution(positions, correlationMatrix) {
  if (!Array.isArray(positions) || positions.length === 0) return [];

  const z = zScore(VAR_CONFIDENCE_LEVEL);

  // Compute portfolio variance
  let portfolioVariance = 0;
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      const rho = i === j ? 1 : getCorrelation(correlationMatrix, positions[i].asset, positions[j].asset);
      portfolioVariance += (positions[i].weight || 0) * (positions[j].weight || 0) *
                           (positions[i].stdDev || 0) * (positions[j].stdDev || 0) * rho;
    }
  }

  const portfolioSigma = Math.sqrt(Math.max(0, portfolioVariance));
  if (portfolioSigma === 0) {
    return positions.map(p => ({ asset: p.asset, marginalVar: 0, contributionPct: 0 }));
  }

  const portfolioVarVal = z * portfolioSigma;
  const results = [];

  for (let i = 0; i < positions.length; i++) {
    const pi = positions[i];
    const wi = pi.weight || 0;
    const si = pi.stdDev || 0;

    // Marginal VaR for position i:
    // d(portfolioVar) / d(wi) = Z * (1 / portfolioSigma) * sum_j(wj * si * sj * rho_ij)
    let covSum = 0;
    for (let j = 0; j < positions.length; j++) {
      const pj = positions[j];
      const rho = i === j ? 1 : getCorrelation(correlationMatrix, pi.asset, pj.asset);
      covSum += (pj.weight || 0) * si * (pj.stdDev || 0) * rho;
    }

    const marginalVar = z * covSum / portfolioSigma;

    // Component VaR = wi * marginalVar
    const componentVar = wi * marginalVar;
    const contributionPct = portfolioVarVal > 0
      ? (componentVar / portfolioVarVal) * 100
      : 0;

    results.push({
      asset: pi.asset,
      marginalVar: round6(marginalVar),
      contributionPct: round4(contributionPct),
    });
  }

  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. Compute Return Statistics from Trade Journal
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Extract historical return series from the trade journal.
 * Returns daily P&L percentages suitable for VaR calculation.
 *
 * @param {number} [lookbackDays] - Defaults to VAR_LOOKBACK_DAYS
 * @returns {number[]} Array of daily return percentages
 */
function getHistoricalReturns(lookbackDays) {
  const days = lookbackDays || VAR_LOOKBACK_DAYS;

  try {
    const journal = require('./trade-journal');
    const stats = journal.getStats({ sinceDays: days });

    // If the journal doesn't have enough data, return empty
    if (!stats || stats.closedTrades < 3) return [];

    // Build daily returns from trade-level data
    const journalFile = journal.JOURNAL_FILE;
    let raw;
    if (rio) {
      raw = rio.readJsonSafe(journalFile, { fallback: null });
    } else {
      const fs = require('fs');
      try {
        if (fs.existsSync(journalFile)) {
          raw = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
        }
      } catch { raw = null; }
    }

    if (!raw || !Array.isArray(raw.trades)) return [];

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const trades = raw.trades.filter(
      t => t.outcome && t.entryTs >= cutoff && Number.isFinite(t.pnlPercent)
    );

    if (trades.length < 3) return [];

    // Group by day and compute daily aggregate returns
    const dailyPnl = {};
    for (const t of trades) {
      const day = typeof t.closedAt === 'string'
        ? t.closedAt.slice(0, 10)
        : new Date(t.entryTs).toISOString().slice(0, 10);
      if (!dailyPnl[day]) dailyPnl[day] = [];
      dailyPnl[day].push(t.pnlPercent);
    }

    // Return mean daily return for each day
    return Object.values(dailyPnl).map(dayReturns =>
      dayReturns.reduce((sum, r) => sum + r, 0) / dayReturns.length
    );
  } catch (err) {
    log.error('Failed to extract historical returns', { error: err.message });
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. Per-Asset Realized Volatility
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Default annualized daily volatilities by asset class (%).
 * Used as fallback when insufficient trade history exists.
 * @type {{ [pattern: string]: number }}
 */
const ASSET_VOL_DEFAULTS = {
  BTC: 3,
  ETH: 4,
  USDC: 0.5,
  USDT: 0.5,
  DAI: 0.5,
  UST: 0.5,
  BUSD: 0.5,
};
const ALT_VOL_DEFAULT = 5;       // alts default
const STABLECOIN_VOL_DEFAULT = 0.5;

/**
 * Compute realized daily volatility (%) for a specific asset from
 * recent trade journal returns. Falls back to asset-class defaults
 * when there is insufficient data.
 *
 * Asset-class defaults:
 *   BTC: 3%, ETH: 4%, alts: 5%, stablecoins: 0.5%
 *
 * @param {string} asset - Asset symbol (e.g. 'BTC', 'ETH', 'SOL')
 * @param {number} [lookbackDays] - Days of history to use (default VAR_LOOKBACK_DAYS)
 * @returns {number} Realized daily volatility as a percentage
 */
function getAssetVolatility(asset, lookbackDays) {
  const days = lookbackDays || VAR_LOOKBACK_DAYS;
  const symbol = (asset || '').toUpperCase();

  try {
    const journal = require('./trade-journal');
    const journalFile = journal.JOURNAL_FILE;
    let raw;
    if (rio) {
      raw = rio.readJsonSafe(journalFile, { fallback: null });
    } else {
      const fs = require('fs');
      try {
        if (fs.existsSync(journalFile)) {
          raw = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
        }
      } catch { raw = null; }
    }

    if (raw && Array.isArray(raw.trades)) {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const assetTrades = raw.trades.filter(
        t => t.outcome &&
             t.entryTs >= cutoff &&
             Number.isFinite(t.pnlPercent) &&
             (t.asset || '').toUpperCase().includes(symbol)
      );

      if (assetTrades.length >= 5) {
        const returns = assetTrades.map(t => t.pnlPercent);
        const vol = stdDev(returns);
        if (vol > 0) {
          log.debug('Realized volatility computed from journal', {
            asset: symbol, vol: round4(vol), sampleSize: returns.length,
          });
          return round4(vol);
        }
      }
    }
  } catch (err) {
    log.warn('Failed to compute realized volatility from journal', {
      asset: symbol, error: err.message,
    });
  }

  // Fallback to asset-class defaults
  if (ASSET_VOL_DEFAULTS[symbol] !== undefined) return ASSET_VOL_DEFAULTS[symbol];

  // Detect stablecoins by common suffixes/patterns
  if (/^(USD|DAI|BUSD|TUSD|USDC|USDT|UST|FRAX|LUSD|GUSD|PAX)$/i.test(symbol)) {
    return STABLECOIN_VOL_DEFAULT;
  }

  return ALT_VOL_DEFAULT; // default for unknown altcoins
}

// ══════════════════════════════════════════════════════════════════════════════
// 9. Stressed VaR
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Compute a stressed VaR figure by applying a stress multiplier to the
 * base VaR. Regulatory frameworks (e.g. Basel III) use a multiplier of
 * ~3x; we use 2.5x as a pragmatic crypto-oriented stress scenario.
 *
 * Accepts either a pre-computed VaR number or a returns array from which
 * to compute VaR first.
 *
 * @param {{ var95?: number, returns?: number[], multiplier?: number }} params
 * @param {number}   [params.var95]       - Pre-computed 95% VaR (absolute value)
 * @param {number[]} [params.returns]     - Raw return series (used if var95 not provided)
 * @param {number}   [params.multiplier]  - Stress multiplier (default 2.5, clamped 1.5-5)
 * @returns {{ baseVar95: number, stressedVar95: number, multiplier: number }}
 */
function stressedVaR({ var95, returns, multiplier } = {}) {
  const mult = Math.max(1.5, Math.min(5, Number(multiplier) || 2.5));

  let baseVar;
  if (Number.isFinite(var95)) {
    baseVar = Math.abs(var95);
  } else if (Array.isArray(returns) && returns.length >= 2) {
    const result = calculateVaR(returns);
    baseVar = Math.abs(result.var95);
  } else {
    return { baseVar95: 0, stressedVar95: 0, multiplier: mult };
  }

  const stressed = round6(baseVar * mult);
  log.debug('Stressed VaR computed', { baseVar95: round6(baseVar), stressedVar95: stressed, multiplier: mult });

  return {
    baseVar95: round6(baseVar),
    stressedVar95: stressed,
    multiplier: mult,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 10. Enhanced Risk Check (VaR overlay on risk-manager)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Enhanced risk check that layers VaR constraints on top of the
 * existing risk-manager's checkTradeAllowed.
 *
 * @param {object} tradeParams
 * @param {string}  tradeParams.asset
 * @param {string}  tradeParams.side
 * @param {number}  tradeParams.usdSize
 * @param {string}  tradeParams.venue
 * @param {number}  [tradeParams.confidence]
 * @param {number}  [tradeParams.edge]
 * @param {number}  [tradeParams.assetVol] - Asset volatility (stdDev %)
 *
 * @returns {{ allowed: boolean, reasons: string[], adjustedSize: number, varMetrics: object }}
 */
function enhancedRiskCheck(tradeParams) {
  const {
    asset = 'BTC',
    side = 'buy',
    usdSize = 15,
    venue = 'unknown',
    confidence = 0.5,
    edge = 0,
    assetVol: assetVolOverride,
  } = tradeParams || {};

  // Use per-asset realized volatility; fall back to caller-supplied override or asset defaults
  const resolvedVol = Number.isFinite(assetVolOverride) && assetVolOverride > 0
    ? assetVolOverride
    : getAssetVolatility(asset);

  const reasons = [];
  let adjustedSize = usdSize;

  // Step 1: Run the base risk-manager check
  let baseCheck = { allowed: true, reasons: [] };
  try {
    const riskManager = require('./risk-manager');
    baseCheck = riskManager.checkTradeAllowed({ asset, side, usdSize, venue, confidence });
  } catch (err) {
    log.warn('Risk manager unavailable, VaR-only check', { error: err.message });
  }

  if (!baseCheck.allowed) {
    return {
      allowed: false,
      reasons: baseCheck.reasons,
      adjustedSize: 0,
      varMetrics: {},
    };
  }

  // Step 2: Historical VaR assessment
  const historicalReturns = getHistoricalReturns();
  let currentVaR = 0;
  let varMetrics = {};

  if (historicalReturns.length >= 5) {
    const histVaR = calculateVaR(historicalReturns);
    currentVaR = Math.abs(histVaR.var95);
    varMetrics = {
      historicalVar95: histVaR.var95,
      historicalVar99: histVaR.var99,
      historicalCVaR95: histVaR.cvar95,
      sampleSize: historicalReturns.length,
    };

    // Check if current VaR already exceeds limit
    if (currentVaR > VAR_PORTFOLIO_LIMIT_PCT) {
      reasons.push(
        `portfolio VaR ${currentVaR.toFixed(2)}% exceeds limit ${VAR_PORTFOLIO_LIMIT_PCT}% -- reduce exposure first`
      );
    }
  } else {
    // Not enough history: fall back to parametric estimate
    const mean = 0;
    const estimatedVol = resolvedVol;
    const paramVaR = parametricVaR(mean, estimatedVol);
    currentVaR = Math.abs(paramVaR.var95);
    varMetrics = {
      method: 'parametric-fallback',
      parametricVar95: paramVaR.var95,
      parametricVar99: paramVaR.var99,
    };
  }

  // Step 3: VaR-constrained sizing
  adjustedSize = varConstrainedSize({
    baseUsd: usdSize,
    portfolioVarLimit: VAR_PORTFOLIO_LIMIT_PCT,
    currentVaR,
    assetVol: resolvedVol,
    confidence,
    edge,
  });

  if (adjustedSize === 0) {
    reasons.push('VaR constraint eliminated position entirely');
  } else if (adjustedSize < usdSize * 0.5) {
    // Significant reduction -- warn but allow
    log.info('VaR constraint significantly reduced position', {
      asset, original: usdSize, adjusted: adjustedSize,
    });
  }

  varMetrics.adjustedSize = adjustedSize;
  varMetrics.varLimit = VAR_PORTFOLIO_LIMIT_PCT;
  varMetrics.currentVaR = round4(currentVaR);
  varMetrics.resolvedAssetVol = resolvedVol;

  // Add stressed VaR to risk metrics
  const stressed = stressedVaR({ var95: currentVaR });
  varMetrics.stressedVar95 = stressed.stressedVar95;

  return {
    allowed: reasons.length === 0 && adjustedSize > 0,
    reasons: [...baseCheck.reasons, ...reasons],
    adjustedSize,
    varMetrics,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Utility Functions
// ══════════════════════════════════════════════════════════════════════════════

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

function round6(v) {
  return Math.round(v * 1000000) / 1000000;
}

/**
 * Compute mean of a numeric array.
 * @param {number[]} arr
 * @returns {number}
 */
function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * Compute sample standard deviation.
 * @param {number[]} arr
 * @returns {number}
 */
function stdDev(arr) {
  if (!arr || arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// ══════════════════════════════════════════════════════════════════════════════
// Exports
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
  // Core VaR calculations
  calculateVaR,
  parametricVaR,
  portfolioVaR,
  stressedVaR,

  // Correlation
  buildCorrelationMatrix,
  pearsonCorrelation,
  pricesToReturns,

  // Position sizing
  varConstrainedSize,

  // Risk analysis
  riskContribution,
  enhancedRiskCheck,

  // Per-asset volatility
  getAssetVolatility,

  // Historical data
  getHistoricalReturns,

  // Utilities (exported for testing and use by correlation-monitor)
  getCorrelation,
  mean,
  stdDev,
  zScore,

  // Configuration (read-only)
  VAR_CONFIDENCE_LEVEL,
  VAR_PORTFOLIO_LIMIT_PCT,
  VAR_LOOKBACK_DAYS,
};
