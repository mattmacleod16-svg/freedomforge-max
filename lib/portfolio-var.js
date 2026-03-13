/**
 * Portfolio-Level VaR Engine
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Cross-asset portfolio VaR using the correlation matrix from correlation-monitor.
 * Goes beyond per-asset VaR to detect concentration risk that individual
 * checks miss.
 *
 * Methodologies:
 *   1. Variance-Covariance (parametric) portfolio VaR
 *   2. Monte Carlo portfolio simulation
 *   3. Component VaR — shows risk contribution per position
 *   4. Diversification benefit analysis
 *
 * @module lib/portfolio-var
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('./logger');
const log = createLogger('portfolio-var');

let varEngine, correlationMonitor, riskManager;
try { varEngine = require('./var-engine'); } catch { varEngine = null; }
try { correlationMonitor = require('./correlation-monitor'); } catch { correlationMonitor = null; }
try { riskManager = require('./risk-manager'); } catch { riskManager = null; }

// ─── Configuration ────────────────────────────────────────────────────────────
const CONFIDENCE = Number(process.env.PORTFOLIO_VAR_CONFIDENCE || 0.95);
const MAX_PORTFOLIO_VAR_PCT = Number(process.env.PORTFOLIO_VAR_MAX_PCT || 5); // Max 5% daily VaR
const MC_SIMULATIONS = Number(process.env.PORTFOLIO_VAR_MC_SIMS || 3000);
const HOLDING_PERIOD_DAYS = Number(process.env.PORTFOLIO_VAR_HOLDING_DAYS || 1);

// ─── Helper Functions ─────────────────────────────────────────────────────────

function zScore(confidence) {
  // Approximation of inverse normal CDF
  const p = 1 - confidence;
  const a1 = -39.6968302866538, a2 = 220.946098424521, a3 = -275.928510446969;
  const a4 = 138.357751867269, a5 = -30.6647980661472, a6 = 2.50662823884;
  const b1 = -54.4760987982241, b2 = 161.585836858041, b3 = -155.698979859887;
  const b4 = 66.8013118877197, b5 = -13.2806815528857;
  const t = Math.sqrt(-2 * Math.log(p));
  return -(t + (a1 + t * (a2 + t * (a3 + t * (a4 + t * (a5 + t * a6))))) /
    (1 + t * (b1 + t * (b2 + t * (b3 + t * (b4 + t * b5))))));
}

function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr) {
  if (!arr || arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function getCorrelation(matrix, a, b) {
  if (!matrix) return 0.4; // Default moderate correlation
  const key1 = `${a}-${b}`;
  const key2 = `${b}-${a}`;
  if (matrix[key1] !== undefined) return matrix[key1];
  if (matrix[key2] !== undefined) return matrix[key2];
  return a === b ? 1.0 : 0.4;
}

// ─── Core Portfolio VaR ───────────────────────────────────────────────────────

/**
 * Compute portfolio-level parametric VaR using variance-covariance method.
 *
 * @param {Array<{asset: string, usdExposure: number, volatility: number}>} positions
 * @param {object} [corrMatrix] - Correlation matrix { 'BTC-ETH': 0.82, ... }
 * @returns {{
 *   portfolioVaR: number,
 *   undiversifiedVaR: number,
 *   diversificationBenefit: number,
 *   diversificationPct: number,
 *   componentVaR: Object<string, number>,
 *   marginalVaR: Object<string, number>,
 *   totalExposure: number,
 *   varPct: number,
 *   breachesLimit: boolean
 * }}
 */
function computePortfolioVaR(positions, corrMatrix = null) {
  if (!positions || positions.length === 0) {
    return {
      portfolioVaR: 0, undiversifiedVaR: 0, diversificationBenefit: 0,
      diversificationPct: 0, componentVaR: {}, marginalVaR: {},
      totalExposure: 0, varPct: 0, breachesLimit: false,
    };
  }

  const z = zScore(CONFIDENCE);
  const sqrtT = Math.sqrt(HOLDING_PERIOD_DAYS);

  // Fetch correlation matrix if not provided
  if (!corrMatrix && correlationMonitor) {
    try {
      const cm = correlationMonitor.getCorrelationMatrix();
      if (cm && cm.matrix) corrMatrix = cm.matrix;
    } catch { /* use defaults */ }
  }

  const n = positions.length;
  const totalExposure = positions.reduce((s, p) => s + Math.abs(p.usdExposure), 0);

  // 1. Per-position VaR (undiversified)
  const positionVaRs = positions.map(p => {
    const vol = p.volatility || 0.03; // Default 3% daily vol
    return Math.abs(p.usdExposure) * vol * z * sqrtT;
  });

  const undiversifiedVaR = positionVaRs.reduce((s, v) => s + v, 0);

  // 2. Portfolio VaR using variance-covariance
  // Σ_portfolio = Σ_i Σ_j w_i w_j σ_i σ_j ρ_ij
  let portfolioVariance = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const wi = Math.abs(positions[i].usdExposure);
      const wj = Math.abs(positions[j].usdExposure);
      const sigmaI = positions[i].volatility || 0.03;
      const sigmaJ = positions[j].volatility || 0.03;
      const rho = getCorrelation(corrMatrix, positions[i].asset, positions[j].asset);
      portfolioVariance += wi * wj * sigmaI * sigmaJ * rho;
    }
  }

  const portfolioVaR = z * Math.sqrt(Math.max(0, portfolioVariance)) * sqrtT;

  // 3. Diversification benefit
  const diversificationBenefit = undiversifiedVaR - portfolioVaR;
  const diversificationPct = undiversifiedVaR > 0
    ? Math.round((diversificationBenefit / undiversifiedVaR) * 10000) / 100
    : 0;

  // 4. Component VaR — how much each position contributes to total portfolio VaR
  const componentVaR = {};
  const marginalVaR = {};
  for (let i = 0; i < n; i++) {
    const asset = positions[i].asset;
    let covSum = 0;
    for (let j = 0; j < n; j++) {
      const wj = Math.abs(positions[j].usdExposure);
      const sigmaI = positions[i].volatility || 0.03;
      const sigmaJ = positions[j].volatility || 0.03;
      const rho = getCorrelation(corrMatrix, positions[i].asset, positions[j].asset);
      covSum += wj * sigmaI * sigmaJ * rho;
    }
    const portfolioSigma = Math.sqrt(Math.max(0, portfolioVariance));
    const marginal = portfolioSigma > 0 ? (covSum / portfolioSigma) * z * sqrtT : 0;
    marginalVaR[asset] = Math.round(marginal * 100) / 100;
    componentVaR[asset] = Math.round(Math.abs(positions[i].usdExposure) * marginal * 100) / 100;
  }

  const varPct = totalExposure > 0 ? Math.round((portfolioVaR / totalExposure) * 10000) / 100 : 0;

  return {
    portfolioVaR: Math.round(portfolioVaR * 100) / 100,
    undiversifiedVaR: Math.round(undiversifiedVaR * 100) / 100,
    diversificationBenefit: Math.round(diversificationBenefit * 100) / 100,
    diversificationPct,
    componentVaR,
    marginalVaR,
    totalExposure: Math.round(totalExposure * 100) / 100,
    varPct,
    breachesLimit: varPct > MAX_PORTFOLIO_VAR_PCT,
  };
}

/**
 * Monte Carlo portfolio VaR simulation.
 * Generates correlated return scenarios using Cholesky decomposition.
 *
 * @param {Array<{asset: string, usdExposure: number, volatility: number, expectedReturn?: number}>} positions
 * @param {object} [corrMatrix]
 * @returns {{ mcVaR95: number, mcVaR99: number, mcCVaR95: number, worstCase: number, scenarioCount: number }}
 */
function monteCarloPortfolioVaR(positions, corrMatrix = null) {
  if (!positions || positions.length === 0) {
    return { mcVaR95: 0, mcVaR99: 0, mcCVaR95: 0, worstCase: 0, scenarioCount: 0 };
  }

  if (!corrMatrix && correlationMonitor) {
    try {
      const cm = correlationMonitor.getCorrelationMatrix();
      if (cm && cm.matrix) corrMatrix = cm.matrix;
    } catch { /* use defaults */ }
  }

  const n = positions.length;

  // Build correlation matrix for Cholesky
  const corrMat = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      corrMat[i][j] = i === j ? 1.0 : getCorrelation(corrMatrix, positions[i].asset, positions[j].asset);
    }
  }

  // Cholesky decomposition L where LL^T = corrMat
  const L = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
      if (i === j) {
        const val = corrMat[i][i] - sum;
        L[i][j] = val > 0 ? Math.sqrt(val) : 0;
      } else {
        L[i][j] = L[j][j] > 0 ? (corrMat[i][j] - sum) / L[j][j] : 0;
      }
    }
  }

  // Generate scenarios
  const portfolioReturns = [];
  for (let sim = 0; sim < MC_SIMULATIONS; sim++) {
    // Generate independent standard normals (Box-Muller)
    const z = [];
    for (let i = 0; i < n; i++) {
      const u1 = Math.random();
      const u2 = Math.random();
      z.push(Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2));
    }

    // Correlated returns: r = L * z * sigma + mu
    let portfolioPnl = 0;
    for (let i = 0; i < n; i++) {
      let correlatedZ = 0;
      for (let j = 0; j <= i; j++) {
        correlatedZ += L[i][j] * z[j];
      }
      const vol = positions[i].volatility || 0.03;
      const mu = positions[i].expectedReturn || 0;
      const assetReturn = mu + vol * correlatedZ * Math.sqrt(HOLDING_PERIOD_DAYS);
      portfolioPnl += positions[i].usdExposure * assetReturn;
    }
    portfolioReturns.push(portfolioPnl);
  }

  // Sort ascending (worst losses first)
  portfolioReturns.sort((a, b) => a - b);

  const idx95 = Math.floor(MC_SIMULATIONS * 0.05);
  const idx99 = Math.floor(MC_SIMULATIONS * 0.01);

  const mcVaR95 = -portfolioReturns[idx95];
  const mcVaR99 = -portfolioReturns[idx99];
  const mcCVaR95 = -(portfolioReturns.slice(0, idx95).reduce((s, v) => s + v, 0) / Math.max(1, idx95));
  const worstCase = -portfolioReturns[0];

  return {
    mcVaR95: Math.round(mcVaR95 * 100) / 100,
    mcVaR99: Math.round(mcVaR99 * 100) / 100,
    mcCVaR95: Math.round(mcCVaR95 * 100) / 100,
    worstCase: Math.round(worstCase * 100) / 100,
    scenarioCount: MC_SIMULATIONS,
  };
}

/**
 * Get live portfolio VaR from current open positions.
 * Reads positions from risk-manager's exposure tracker.
 *
 * @returns {{ parametric: object, monteCarlo: object, combined: object, timestamp: string }}
 */
function getLivePortfolioVaR() {
  const positions = [];

  // Get open positions from risk-manager
  if (riskManager && typeof riskManager.getPortfolioExposure === 'function') {
    try {
      const exposure = riskManager.getPortfolioExposure();
      if (exposure.assetExposure) {
        for (const [asset, usdExposure] of Object.entries(exposure.assetExposure)) {
          let volatility = 0.03; // Default
          if (varEngine && typeof varEngine.getAssetVolatility === 'function') {
            try {
              const vol = varEngine.getAssetVolatility(asset);
              if (vol && vol.dailyVol > 0) volatility = vol.dailyVol;
            } catch { /* use default */ }
          }
          positions.push({ asset: asset.toUpperCase(), usdExposure: Number(usdExposure) || 0, volatility });
        }
      }
    } catch (err) {
      log.warn('failed to get portfolio exposure', { error: err?.message });
    }
  }

  if (positions.length === 0) {
    return {
      parametric: computePortfolioVaR([]),
      monteCarlo: monteCarloPortfolioVaR([]),
      combined: { portfolioVaR: 0, breachesLimit: false, positionCount: 0 },
      timestamp: new Date().toISOString(),
    };
  }

  const parametric = computePortfolioVaR(positions);
  const mc = monteCarloPortfolioVaR(positions);

  // Combined: use the more conservative VaR
  const conservativeVaR = Math.max(parametric.portfolioVaR, mc.mcVaR95);
  const totalExposure = positions.reduce((s, p) => s + Math.abs(p.usdExposure), 0);
  const conservativeVarPct = totalExposure > 0 ? (conservativeVaR / totalExposure) * 100 : 0;

  const combined = {
    portfolioVaR: Math.round(conservativeVaR * 100) / 100,
    varPct: Math.round(conservativeVarPct * 100) / 100,
    breachesLimit: conservativeVarPct > MAX_PORTFOLIO_VAR_PCT,
    positionCount: positions.length,
    method: parametric.portfolioVaR > mc.mcVaR95 ? 'parametric' : 'monteCarlo',
  };

  if (combined.breachesLimit) {
    log.warn('portfolio VaR limit breached', {
      varPct: combined.varPct, limit: MAX_PORTFOLIO_VAR_PCT,
      portfolioVaR: combined.portfolioVaR, positions: positions.length,
    });
  }

  return {
    parametric,
    monteCarlo: mc,
    combined,
    positions: positions.map(p => ({ asset: p.asset, usdExposure: p.usdExposure, volatility: p.volatility })),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Check if adding a new position would breach the portfolio VaR limit.
 *
 * @param {string} asset - Asset to add
 * @param {number} usdSize - Size to add
 * @param {string} side - 'buy' or 'sell'
 * @returns {{ allowed: boolean, currentVaR: number, projectedVaR: number, varBudgetRemaining: number }}
 */
function checkVaRBudget(asset, usdSize, side) {
  const current = getLivePortfolioVaR();
  const currentVaR = current.combined.portfolioVaR;

  // Add hypothetical position
  const hypotheticalPositions = [...(current.positions || [])];
  let volatility = 0.03;
  if (varEngine && typeof varEngine.getAssetVolatility === 'function') {
    try {
      const vol = varEngine.getAssetVolatility(asset);
      if (vol && vol.dailyVol > 0) volatility = vol.dailyVol;
    } catch { /* use default */ }
  }

  const exposure = side === 'sell' ? -usdSize : usdSize;
  const existing = hypotheticalPositions.find(p => p.asset === asset.toUpperCase());
  if (existing) {
    existing.usdExposure += exposure;
  } else {
    hypotheticalPositions.push({ asset: asset.toUpperCase(), usdExposure: exposure, volatility });
  }

  const projected = computePortfolioVaR(hypotheticalPositions);
  const totalExposure = hypotheticalPositions.reduce((s, p) => s + Math.abs(p.usdExposure), 0);
  const varBudget = totalExposure * MAX_PORTFOLIO_VAR_PCT / 100;

  return {
    allowed: projected.varPct <= MAX_PORTFOLIO_VAR_PCT,
    currentVaR: Math.round(currentVaR * 100) / 100,
    projectedVaR: Math.round(projected.portfolioVaR * 100) / 100,
    projectedVarPct: projected.varPct,
    varBudgetRemaining: Math.round(Math.max(0, varBudget - projected.portfolioVaR) * 100) / 100,
    diversificationBenefit: projected.diversificationPct,
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  computePortfolioVaR,
  monteCarloPortfolioVaR,
  getLivePortfolioVaR,
  checkVaRBudget,
};
