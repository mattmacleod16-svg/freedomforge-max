#!/usr/bin/env node
/**
 * FreedomForge Telemetry Analyzer Agent
 * ══════════════════════════════════════
 *
 * Analyzes telemetry data to generate actionable improvement signals.
 * This is the "meta-learning" layer — it measures whether the system's
 * self-improvement mechanisms (brain evolution, strategy promotion,
 * virtue engine) are actually making things better.
 *
 * Analysis dimensions:
 *   1. Decision Quality Trend — are predictions getting more accurate?
 *   2. Execution Efficiency — are latencies improving, errors decreasing?
 *   3. Learning Effectiveness — does brain evolution improve win rates?
 *   4. Venue Performance — which venues deliver best execution?
 *   5. Signal Attribution — which signals contribute most to wins?
 *   6. Agent Mesh Health — are all agents communicating effectively?
 *   7. Cost Efficiency — is revenue/cost ratio improving?
 *   8. Virtue Alignment — is the system staying aligned with user values?
 *
 * Publishes: system_improvement signal (TTL 12h)
 *
 * Environment:
 *   TELEMETRY_ANALYZER_ENABLED=true
 *   TELEMETRY_LOOKBACK_HOURS=168     (1 week default)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const { createLogger } = require('../lib/logger');
const logger = createLogger('telemetry-analyzer');
const telemetry = require('../lib/telemetry-collector');

const ENABLED = String(process.env.TELEMETRY_ANALYZER_ENABLED || 'true').toLowerCase() !== 'false';
const LOOKBACK_HOURS = Math.max(1, Number(process.env.TELEMETRY_LOOKBACK_HOURS || '168'));
const ALERT_URL = process.env.ALERT_WEBHOOK_URL || '';
const ALERT_MENTION = (process.env.ALERT_MENTION || '').trim();

// ─── Helpers ────────────────────────────────────────────────────────────────────

function withMention(msg) { return ALERT_MENTION ? `${ALERT_MENTION} ${msg}` : msg; }

async function sendAlert(message) {
  if (!ALERT_URL) { console.log(message); return; }
  const body = JSON.stringify({ content: withMention(message), text: withMention(message) });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 10000);
      try {
        const r = await fetch(ALERT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: c.signal });
        clearTimeout(t);
        if (r.ok || r.status < 500) return;
      } finally { clearTimeout(t); }
    } catch {}
    if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
  }
}

// ─── Trade Journal Analysis ─────────────────────────────────────────────────────

function analyzeTradeJournal() {
  const journalPath = path.resolve(process.cwd(), process.env.TRADE_JOURNAL_FILE || 'data/trade-journal.json');
  let trades = [];
  try {
    if (fs.existsSync(journalPath)) {
      const raw = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      trades = Array.isArray(raw?.trades) ? raw.trades : [];
    }
  } catch { return null; }

  const cutoff = Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000;
  const recent = trades.filter(t => (t.ts || 0) > cutoff);
  const closed = recent.filter(t => t.closedAt && t.pnl !== null);

  if (closed.length === 0) return { trades: 0, message: 'No closed trades in lookback window' };

  const wins = closed.filter(t => t.pnl > 0);
  const losses = closed.filter(t => t.pnl < 0);
  const totalPnl = closed.reduce((s, t) => s + t.pnl, 0);
  const totalFees = closed.reduce((s, t) => s + (t.fees || 0), 0);
  const winRate = wins.length / closed.length;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(t.pnl), 0) / losses.length : 0;
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : Infinity;

  // Record decision quality for each trade
  for (const t of closed) {
    telemetry.recordDecisionQuality({
      predictedConfidence: t.signal?.confidence || 0.5,
      predictedSide: t.side,
      actualReturn: t.pnlPercent || 0,
      venue: t.venue || 'unknown',
      strategy: t.strategy || 'unknown',
    });
  }

  // By venue breakdown
  const byVenue = {};
  for (const t of closed) {
    const v = t.venue || 'unknown';
    if (!byVenue[v]) byVenue[v] = { trades: 0, wins: 0, pnl: 0, fees: 0, avgSlippage: [] };
    byVenue[v].trades++;
    if (t.pnl > 0) byVenue[v].wins++;
    byVenue[v].pnl += t.pnl;
    byVenue[v].fees += t.fees || 0;
    if (t.slippagePct != null) byVenue[v].avgSlippage.push(t.slippagePct);
  }

  for (const v of Object.values(byVenue)) {
    v.winRate = v.trades > 0 ? v.wins / v.trades : 0;
    v.avgSlippage = v.avgSlippage.length > 0 ? v.avgSlippage.reduce((s, x) => s + x, 0) / v.avgSlippage.length : 0;
  }

  // By strategy breakdown
  const byStrategy = {};
  for (const t of closed) {
    const s = t.strategy || 'unknown';
    if (!byStrategy[s]) byStrategy[s] = { trades: 0, wins: 0, pnl: 0 };
    byStrategy[s].trades++;
    if (t.pnl > 0) byStrategy[s].wins++;
    byStrategy[s].pnl += t.pnl;
  }

  for (const s of Object.values(byStrategy)) {
    s.winRate = s.trades > 0 ? s.wins / s.trades : 0;
  }

  // By confidence bucket
  const confBuckets = { low: { min: 0, max: 0.6, trades: 0, wins: 0 }, mid: { min: 0.6, max: 0.75, trades: 0, wins: 0 }, high: { min: 0.75, max: 1, trades: 0, wins: 0 } };
  for (const t of closed) {
    const conf = t.signal?.confidence || 0.5;
    for (const [, bucket] of Object.entries(confBuckets)) {
      if (conf >= bucket.min && conf < bucket.max) { bucket.trades++; if (t.pnl > 0) bucket.wins++; break; }
    }
  }

  // Signal component attribution — which indicators appear in winning vs losing trades
  const indicatorAttribution = {};
  for (const t of closed) {
    const comps = t.signalComponents || {};
    for (const [key, val] of Object.entries(comps)) {
      if (!indicatorAttribution[key]) indicatorAttribution[key] = { winCount: 0, lossCount: 0, totalPnl: 0 };
      if (t.pnl > 0) indicatorAttribution[key].winCount++;
      else indicatorAttribution[key].lossCount++;
      indicatorAttribution[key].totalPnl += t.pnl;
    }
  }

  for (const [, attr] of Object.entries(indicatorAttribution)) {
    const total = attr.winCount + attr.lossCount;
    attr.winRate = total > 0 ? attr.winCount / total : 0;
  }

  // Time-of-day analysis
  const byHour = {};
  for (const t of closed) {
    const hour = new Date(t.ts).getUTCHours();
    const bucket = `${String(hour).padStart(2, '0')}:00`;
    if (!byHour[bucket]) byHour[bucket] = { trades: 0, wins: 0, pnl: 0 };
    byHour[bucket].trades++;
    if (t.pnl > 0) byHour[bucket].wins++;
    byHour[bucket].pnl += t.pnl;
  }

  // Record telemetry gauges
  telemetry.gauge('trade_win_rate', winRate);
  telemetry.gauge('trade_profit_factor', profitFactor === Infinity ? 999 : profitFactor);
  telemetry.gauge('trade_total_pnl', totalPnl);
  telemetry.gauge('trade_count_lookback', closed.length);

  return {
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: Math.round(winRate * 10000) / 100,
    profitFactor: profitFactor === Infinity ? 'Inf' : Math.round(profitFactor * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalFees: Math.round(totalFees * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    byVenue,
    byStrategy,
    confBuckets: Object.fromEntries(
      Object.entries(confBuckets).map(([k, v]) => [k, { ...v, winRate: v.trades > 0 ? Math.round(v.wins / v.trades * 100) : 0 }])
    ),
    indicatorAttribution,
    byHour,
  };
}

// ─── Brain Evolution Analysis ───────────────────────────────────────────────────

function analyzeBrainEvolution() {
  const brainPath = path.resolve(process.cwd(), process.env.BRAIN_STATE_FILE || 'data/brain-state.json');
  try {
    if (!fs.existsSync(brainPath)) return null;
    const brain = JSON.parse(fs.readFileSync(brainPath, 'utf8'));

    const generation = brain.generation || 0;
    const calibration = brain.calibrationScore || 0;
    const weights = brain.weights || {};
    const streaks = brain.streaks || {};
    const regimeProfiles = brain.regimeProfiles || {};

    // Track brain health
    telemetry.gauge('brain_generation', generation);
    telemetry.gauge('brain_calibration', calibration);
    telemetry.gauge('brain_win_streak', streaks.currentWin || 0);

    // Compute weight stability (high churn = unstable learning)
    const weightValues = Object.values(weights).filter(v => typeof v === 'number');
    const avgWeight = weightValues.length > 0 ? weightValues.reduce((s, v) => s + v, 0) / weightValues.length : 0;
    const weightVariance = weightValues.length > 0
      ? weightValues.reduce((s, v) => s + Math.pow(v - avgWeight, 2), 0) / weightValues.length
      : 0;

    // Best regime
    let bestRegime = null;
    let bestWinRate = 0;
    for (const [regime, profile] of Object.entries(regimeProfiles)) {
      const wr = profile.winRate || profile.wins / (profile.wins + profile.losses) || 0;
      if (wr > bestWinRate) { bestWinRate = wr; bestRegime = regime; }
    }

    return {
      generation,
      calibration: Math.round(calibration * 1000) / 1000,
      weightStability: Math.round((1 - Math.sqrt(weightVariance)) * 100) / 100,
      topWeights: Object.entries(weights)
        .filter(([, v]) => typeof v === 'number')
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, v]) => ({ indicator: k, weight: Math.round(v * 1000) / 1000 })),
      streaks,
      bestRegime,
      bestRegimeWinRate: Math.round(bestWinRate * 100),
      regimeCount: Object.keys(regimeProfiles).length,
    };
  } catch { return null; }
}

// ─── Virtue Trend Analysis ──────────────────────────────────────────────────────

function analyzeVirtueTrends() {
  try {
    const virtue = require('../lib/virtue-engine');
    const state = virtue.getVirtueIndex();
    const vi = state.virtueIndex;
    const compliance = virtue.checkVirtueCompliance();
    const certValidity = virtue.checkCertificateValidity();

    // Compute per-virtue trends from history
    const trends = {};
    for (const [name, vs] of Object.entries(state.scores || {})) {
      const delta = vs.current - vs.avg;
      trends[name] = {
        current: Math.round((vs.current || 0) * 1000) / 1000,
        avg: Math.round((vs.avg || 0) * 1000) / 1000,
        delta: Math.round(delta * 1000) / 1000,
        trend: delta > 0.02 ? 'improving' : delta < -0.02 ? 'degrading' : 'stable',
        min: Math.round((vs.min || 0) * 1000) / 1000,
        max: Math.round((vs.max || 0) * 1000) / 1000,
      };
    }

    // Identify weakest and degrading virtues
    const degrading = Object.entries(trends)
      .filter(([, t]) => t.trend === 'degrading')
      .map(([name, t]) => ({ virtue: name, delta: t.delta }));

    const weakest = Object.entries(trends)
      .sort((a, b) => a[1].current - b[1].current)
      .slice(0, 3)
      .map(([name, t]) => ({ virtue: name, score: t.current }));

    // Track telemetry
    telemetry.gauge('virtue_index', vi);
    telemetry.gauge('virtue_compliance_rate', compliance.complianceRate);
    telemetry.gauge('virtue_degrading_count', degrading.length);

    return {
      virtueIndex: Math.round(vi * 1000) / 1000,
      complianceRate: compliance.complianceRate,
      allCompliant: compliance.compliant,
      trends,
      degrading,
      weakest,
      certificateValid: certValidity.valid || false,
      conformanceLevel: certValidity.conformanceLevel || 'unknown',
      evaluationCount: state.evaluationCount,
      upgradeGeneration: state.upgradeGeneration,
    };
  } catch {
    return null;
  }
}

// ─── Cost Efficiency Analysis ───────────────────────────────────────────────────

function analyzeCostEfficiency() {
  const costPath = path.resolve(process.cwd(), 'data/api-cost-state.json');
  try {
    if (!fs.existsSync(costPath)) return null;
    const costs = JSON.parse(fs.readFileSync(costPath, 'utf8'));

    const todayCost = costs.todayCostUsd || 0;
    const avgDaily = costs.avgDailyCost || todayCost;
    const monthCost = costs.monthCostUsd || 0;

    telemetry.gauge('api_cost_today_usd', todayCost);
    telemetry.gauge('api_cost_monthly_usd', monthCost);

    // Load treasury for revenue comparison
    let ytdPnl = 0;
    try {
      const ledgerPath = path.resolve(process.cwd(), 'data/treasury-ledger.json');
      if (fs.existsSync(ledgerPath)) {
        const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
        ytdPnl = ledger?.lifetimePnl || 0;
      }
    } catch {}

    const revenueCostRatio = avgDaily > 0 ? ytdPnl / (avgDaily * 30) : 0;
    telemetry.gauge('revenue_cost_ratio', revenueCostRatio);

    return {
      todayCost: Math.round(todayCost * 100) / 100,
      avgDailyCost: Math.round(avgDaily * 100) / 100,
      monthCost: Math.round(monthCost * 100) / 100,
      ytdPnl: Math.round(ytdPnl * 100) / 100,
      revenueCostRatio: Math.round(revenueCostRatio * 100) / 100,
      selfSustaining: revenueCostRatio >= 1,
    };
  } catch { return null; }
}

// ─── Generate Improvement Recommendations ───────────────────────────────────────

function generateRecommendations(tradeAnalysis, brainAnalysis, costAnalysis) {
  const recommendations = [];

  if (tradeAnalysis) {
    // Win rate improvement
    if (tradeAnalysis.winRate < 55) {
      recommendations.push({
        priority: 'high',
        area: 'decision_quality',
        action: `Win rate ${tradeAnalysis.winRate}% below target 55%. Consider raising minimum confidence threshold.`,
      });
    }

    // Confidence calibration
    const confBuckets = tradeAnalysis.confBuckets || {};
    if (confBuckets.high?.winRate < confBuckets.low?.winRate && confBuckets.high?.trades > 3) {
      recommendations.push({
        priority: 'high',
        area: 'calibration',
        action: 'High-confidence trades underperforming low-confidence. Brain calibration needs attention.',
      });
    }

    // Venue optimization
    if (tradeAnalysis.byVenue) {
      const venues = Object.entries(tradeAnalysis.byVenue);
      const sorted = venues.sort((a, b) => b[1].winRate - a[1].winRate);
      if (sorted.length >= 2 && sorted[0][1].winRate - sorted[sorted.length - 1][1].winRate > 0.15) {
        recommendations.push({
          priority: 'medium',
          area: 'venue_routing',
          action: `${sorted[0][0]} (${(sorted[0][1].winRate * 100).toFixed(0)}% WR) outperforming ${sorted[sorted.length - 1][0]} (${(sorted[sorted.length - 1][1].winRate * 100).toFixed(0)}% WR). Consider increasing ${sorted[0][0]} allocation.`,
        });
      }
    }

    // Fee optimization
    if (tradeAnalysis.totalFees > 0 && tradeAnalysis.totalPnl > 0) {
      const feeRatio = tradeAnalysis.totalFees / tradeAnalysis.totalPnl;
      if (feeRatio > 0.3) {
        recommendations.push({
          priority: 'medium',
          area: 'fee_reduction',
          action: `Fees consuming ${(feeRatio * 100).toFixed(0)}% of profits. Consider larger position sizes or lower-fee venues.`,
        });
      }
    }

    // Time-of-day optimization
    if (tradeAnalysis.byHour) {
      const hourEntries = Object.entries(tradeAnalysis.byHour).filter(([, v]) => v.trades >= 3);
      const bestHour = hourEntries.sort((a, b) => b[1].pnl - a[1].pnl)[0];
      const worstHour = hourEntries.sort((a, b) => a[1].pnl - b[1].pnl)[0];
      if (bestHour && worstHour && bestHour[1].pnl > 0 && worstHour[1].pnl < 0) {
        recommendations.push({
          priority: 'low',
          area: 'time_optimization',
          action: `Best hour: ${bestHour[0]} UTC ($${bestHour[1].pnl.toFixed(2)}). Worst: ${worstHour[0]} UTC ($${worstHour[1].pnl.toFixed(2)}). Consider time-gating.`,
        });
      }
    }

    // Indicator attribution
    if (tradeAnalysis.indicatorAttribution) {
      const attrs = Object.entries(tradeAnalysis.indicatorAttribution)
        .filter(([, v]) => (v.winCount + v.lossCount) >= 3)
        .sort((a, b) => b[1].winRate - a[1].winRate);
      if (attrs.length >= 2) {
        const best = attrs[0];
        const worst = attrs[attrs.length - 1];
        if (best[1].winRate - worst[1].winRate > 0.2) {
          recommendations.push({
            priority: 'medium',
            area: 'signal_weighting',
            action: `${best[0]} (${(best[1].winRate * 100).toFixed(0)}% WR) outperforming ${worst[0]} (${(worst[1].winRate * 100).toFixed(0)}% WR). Brain should upweight ${best[0]}.`,
          });
        }
      }
    }
  }

  if (brainAnalysis) {
    if (brainAnalysis.calibration < 0.6) {
      recommendations.push({
        priority: 'high',
        area: 'brain_calibration',
        action: `Brain calibration ${(brainAnalysis.calibration * 100).toFixed(0)}% — model confidence doesn't match outcomes. Needs retraining.`,
      });
    }
    if (brainAnalysis.weightStability < 0.5) {
      recommendations.push({
        priority: 'medium',
        area: 'weight_stability',
        action: 'Brain weights are volatile — learning rate may be too high. Consider reducing BRAIN_LEARNING_RATE.',
      });
    }
  }

  if (costAnalysis && !costAnalysis.selfSustaining) {
    recommendations.push({
      priority: 'medium',
      area: 'cost_efficiency',
      action: `Revenue/cost ratio ${costAnalysis.revenueCostRatio}x — not yet self-sustaining. Target 1.0x+.`,
    });
  }

  return recommendations;
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  if (!ENABLED) {
    console.log('[telemetry-analyzer] Disabled');
    process.exit(0);
  }

  console.log(`[telemetry-analyzer] Starting analysis (lookback: ${LOOKBACK_HOURS}h)`);

  // 1. Analyze trade journal
  const tradeAnalysis = analyzeTradeJournal();
  console.log(`[telemetry-analyzer] Trades analyzed: ${tradeAnalysis?.trades || 0}`);

  // 2. Analyze brain evolution
  const brainAnalysis = analyzeBrainEvolution();
  console.log(`[telemetry-analyzer] Brain generation: ${brainAnalysis?.generation || 'N/A'}`);

  // 2b. Analyze virtue trends (UCFEE-2.0)
  const virtueAnalysis = analyzeVirtueTrends();
  if (virtueAnalysis) {
    console.log(`[telemetry-analyzer] Virtue Index: ${(virtueAnalysis.virtueIndex * 100).toFixed(1)}% | Compliance: ${(virtueAnalysis.complianceRate * 100).toFixed(0)}% | Conformance: ${virtueAnalysis.conformanceLevel}`);
    if (virtueAnalysis.degrading.length > 0) {
      console.log(`[telemetry-analyzer] Degrading virtues: ${virtueAnalysis.degrading.map(d => d.virtue).join(', ')}`);
    }
  }

  // 3. Analyze cost efficiency
  const costAnalysis = analyzeCostEfficiency();
  console.log(`[telemetry-analyzer] Cost ratio: ${costAnalysis?.revenueCostRatio || 'N/A'}x`);

  // 4. Get telemetry snapshot
  const snapshot = telemetry.getSnapshot();
  const feedbackStats = telemetry.getFeedbackStats();
  const agentMesh = telemetry.getAgentMeshHealth();

  // 5. Generate recommendations
  const recommendations = generateRecommendations(tradeAnalysis, brainAnalysis, costAnalysis);

  // 6. Compute improvement score (are things getting better?)
  let improvementScore = 0.5; // neutral baseline
  if (tradeAnalysis && tradeAnalysis.winRate > 55) improvementScore += 0.1;
  if (tradeAnalysis && tradeAnalysis.profitFactor !== 'Inf' && tradeAnalysis.profitFactor > 1.5) improvementScore += 0.1;
  if (brainAnalysis && brainAnalysis.calibration > 0.7) improvementScore += 0.1;
  if (virtueAnalysis && virtueAnalysis.virtueIndex >= 0.9) improvementScore += 0.1;
  if (costAnalysis && costAnalysis.selfSustaining) improvementScore += 0.1;
  if (feedbackStats.improvementRate > 0.6) improvementScore += 0.1;
  improvementScore = Math.min(1, improvementScore);

  // 7. Publish to signal bus
  try {
    const bus = require('../lib/agent-signal-bus');
    bus.publish({
      type: 'system_improvement',
      source: 'telemetry-analyzer',
      confidence: improvementScore,
      payload: {
        improvementScore: Math.round(improvementScore * 100) / 100,
        tradeAnalysis: tradeAnalysis ? {
          trades: tradeAnalysis.trades,
          winRate: tradeAnalysis.winRate,
          profitFactor: tradeAnalysis.profitFactor,
          totalPnl: tradeAnalysis.totalPnl,
        } : null,
        brainAnalysis: brainAnalysis ? {
          generation: brainAnalysis.generation,
          calibration: brainAnalysis.calibration,
          weightStability: brainAnalysis.weightStability,
        } : null,
        costAnalysis: costAnalysis ? {
          revenueCostRatio: costAnalysis.revenueCostRatio,
          selfSustaining: costAnalysis.selfSustaining,
        } : null,
        virtueAnalysis: virtueAnalysis ? {
          virtueIndex: virtueAnalysis.virtueIndex,
          complianceRate: virtueAnalysis.complianceRate,
          allCompliant: virtueAnalysis.allCompliant,
          conformanceLevel: virtueAnalysis.conformanceLevel,
          degradingVirtues: virtueAnalysis.degrading,
          weakestVirtues: virtueAnalysis.weakest,
          certificateValid: virtueAnalysis.certificateValid,
        } : null,
        feedbackStats: {
          total: feedbackStats.total,
          improvementRate: feedbackStats.improvementRate,
          avgDelta: feedbackStats.avgDelta,
        },
        recommendations,
        agentMeshAlive: Object.values(agentMesh).filter(a => a.alive).length,
        agentMeshTotal: Object.keys(agentMesh).length,
        analysisAt: new Date().toISOString(),
      },
      ttlMs: 12 * 60 * 60 * 1000,
    });
    console.log('[telemetry-analyzer] Published system_improvement signal');
  } catch (busErr) {
    logger.warn('Signal bus unavailable', { error: busErr?.message });
  }

  // 8. Save telemetry snapshot
  telemetry.saveSnapshot();

  // 9. Build report
  const lines = [
    `=== Telemetry Analysis Report ===`,
    `Improvement Score: ${(improvementScore * 100).toFixed(0)}%`,
    ``,
  ];

  if (tradeAnalysis && tradeAnalysis.trades > 0) {
    lines.push(`--- Trade Performance (${LOOKBACK_HOURS}h) ---`);
    lines.push(`  Trades: ${tradeAnalysis.trades} | Win Rate: ${tradeAnalysis.winRate}% | PF: ${tradeAnalysis.profitFactor}`);
    lines.push(`  P&L: $${tradeAnalysis.totalPnl} | Fees: $${tradeAnalysis.totalFees}`);
    lines.push(`  Avg Win: $${tradeAnalysis.avgWin} | Avg Loss: $${tradeAnalysis.avgLoss}`);

    if (tradeAnalysis.confBuckets) {
      lines.push(`  Confidence calibration:`);
      for (const [bucket, data] of Object.entries(tradeAnalysis.confBuckets)) {
        if (data.trades > 0) lines.push(`    ${bucket}: ${data.winRate}% WR (${data.trades} trades)`);
      }
    }
  }

  if (brainAnalysis) {
    lines.push('');
    lines.push('--- Brain Evolution ---');
    lines.push(`  Generation: ${brainAnalysis.generation} | Calibration: ${(brainAnalysis.calibration * 100).toFixed(0)}%`);
    lines.push(`  Weight stability: ${(brainAnalysis.weightStability * 100).toFixed(0)}%`);
    if (brainAnalysis.bestRegime) {
      lines.push(`  Best regime: ${brainAnalysis.bestRegime} (${brainAnalysis.bestRegimeWinRate}% WR)`);
    }
    lines.push(`  Top indicators: ${brainAnalysis.topWeights.map(w => `${w.indicator}=${w.weight}`).join(', ')}`);
  }

  if (costAnalysis) {
    lines.push('');
    lines.push('--- Cost Efficiency ---');
    lines.push(`  Daily: $${costAnalysis.avgDailyCost} | Monthly: $${costAnalysis.monthCost}`);
    lines.push(`  Revenue/Cost: ${costAnalysis.revenueCostRatio}x | Self-sustaining: ${costAnalysis.selfSustaining ? 'YES' : 'not yet'}`);
  }

  if (feedbackStats.total > 0) {
    lines.push('');
    lines.push('--- Learning Feedback ---');
    lines.push(`  Loops: ${feedbackStats.total} | Improvement rate: ${(feedbackStats.improvementRate * 100).toFixed(0)}%`);
    lines.push(`  Avg delta: ${feedbackStats.avgDelta > 0 ? '+' : ''}${feedbackStats.avgDelta}`);
  }

  if (Object.keys(agentMesh).length > 0) {
    lines.push('');
    lines.push('--- Agent Mesh ---');
    for (const [name, data] of Object.entries(agentMesh)) {
      lines.push(`  ${name}: ${data.alive ? 'ALIVE' : 'DEAD'} | signals=${data.signalCount} errors=${data.errorCount} (${data.errorRate}%)`);
    }
  }

  if (recommendations.length > 0) {
    lines.push('');
    lines.push('--- Improvement Recommendations ---');
    for (const rec of recommendations) {
      lines.push(`  [${rec.priority.toUpperCase()}] ${rec.area}: ${rec.action}`);
    }
  }

  const report = lines.join('\n');
  console.log('');
  console.log(report);

  // Alert on high-priority recommendations
  const highPriority = recommendations.filter(r => r.priority === 'high');
  if (highPriority.length > 0) {
    await sendAlert(`Telemetry: ${highPriority.length} high-priority improvements identified\n` +
      highPriority.map(r => `  [${r.area}] ${r.action}`).join('\n'));
  }

  console.log('[telemetry-analyzer] Analysis complete');
}

if (require.main === module) {
  main().catch(async (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[telemetry-analyzer] Fatal: ${msg}`);
    try { await sendAlert(`Telemetry analyzer failed: ${msg}`); } catch {}
    process.exit(1);
  });
}
