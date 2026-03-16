#!/usr/bin/env node
/**
 * FreedomForge UCFEE Agent (User-Centric Financial Empowerment Engine v2.0)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * The conscience of the system. Runs periodic virtue evaluations, publishes
 * guidance signals to the agent signal bus, and ensures the entire multi-agent
 * swarm operates in alignment with the 12 algorithmic virtues.
 *
 * This agent:
 *   1. Builds context from live system state (journals, costs, health)
 *   2. Evaluates all 12 virtues and computes the aggregate Virtue Index
 *   3. Publishes virtue_guidance signal for edge-detector and orchestrator
 *   4. Publishes user_empowerment signal for user-facing components
 *   5. Runs self-upgrade analysis to identify weak virtues
 *   6. Alerts if Virtue Index drops below safety thresholds
 *   7. Cross-references tax advisor and geo-risk signals for holistic guidance
 *
 * Signal bus outputs:
 *   virtue_guidance     (TTL 6h)  — per-trade guidance and confidence multiplier
 *   user_empowerment    (TTL 12h) — user-facing positivity and growth metrics
 *
 * Environment:
 *   UCFEE_ENABLED=true                Enable/disable (default: true)
 *   UCFEE_ALERT_THRESHOLD=0.7        Virtue Index threshold for alerts
 *   UCFEE_HIBERNATION_THRESHOLD=0.6  Below this, recommend system pause
 *   VIRTUE_POSITIVITY_AMPLIFIER=1.5  Positivity weight multiplier
 */

'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const { createLogger } = require('../lib/logger');
const logger = createLogger('ucfee-agent');

const virtue = require('../lib/virtue-engine');

const ENABLED = String(process.env.UCFEE_ENABLED || 'true').toLowerCase() !== 'false';
const ALERT_THRESHOLD = Math.max(0.1, Math.min(1.0, Number(process.env.UCFEE_ALERT_THRESHOLD || '0.7')));
const HIBERNATION_THRESHOLD = Math.max(0.1, Math.min(1.0, Number(process.env.UCFEE_HIBERNATION_THRESHOLD || '0.6')));

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://freedomforge-max.up.railway.app').replace(/\/$/, '');
const ALERT_URL = process.env.ALERT_WEBHOOK_URL || '';
const ALERT_MENTION = (process.env.ALERT_MENTION || '').trim();

// ─── Helpers ────────────────────────────────────────────────────────────────────

function withMention(message) {
  if (!ALERT_MENTION) return message;
  return `${ALERT_MENTION} ${message}`;
}

async function sendAlert(message) {
  if (!ALERT_URL) {
    console.log(message);
    return;
  }
  const body = JSON.stringify({ content: withMention(message), text: withMention(message) });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(ALERT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok || res.status < 500) return;
      } finally { clearTimeout(timer); }
    } catch (err) { logger.warn('alert retry', { attempt, error: err?.message }); }
    if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
  }
}

// ─── Cross-Agent Intelligence ───────────────────────────────────────────────────

function gatherCrossAgentContext() {
  const intel = {
    taxAdvice: null,
    geoRisk: null,
    marketRegime: null,
    sentiment: null,
  };

  try {
    const bus = require('../lib/agent-signal-bus');

    // Tax advisor signals
    const taxSignals = bus.query({ type: 'tax_optimization', maxAgeMs: 12 * 60 * 60 * 1000 });
    if (taxSignals.length > 0) {
      intel.taxAdvice = {
        venuePreference: taxSignals[0].payload?.venuePreference,
        recommendations: taxSignals[0].payload?.recommendations,
        quarterlyDeadline: taxSignals[0].payload?.quarterlyDeadline,
      };
    }

    // Geo-risk
    const geoSignals = bus.query({ type: 'geo_risk', maxAgeMs: 6 * 60 * 60 * 1000 });
    if (geoSignals.length > 0) {
      intel.geoRisk = {
        risk: geoSignals[0].payload?.risk || 0,
        regime: geoSignals[0].payload?.regime,
      };
    }

    // Market regime
    const regime = bus.consensus('market_regime');
    if (regime) {
      intel.marketRegime = {
        regime: regime.value?.regime || regime.value,
        confidence: regime.confidence,
      };
    }

    // Sentiment
    const sentimentSignals = bus.query({ type: 'sentiment', maxAgeMs: 2 * 60 * 60 * 1000 });
    if (sentimentSignals.length > 0) {
      intel.sentiment = {
        direction: sentimentSignals[0].payload?.direction,
        score: sentimentSignals[0].payload?.sentiment,
      };
    }
  } catch {}

  return intel;
}

// ─── User Empowerment Metrics ───────────────────────────────────────────────────

function computeEmpowermentMetrics() {
  const metrics = {
    financialHealth: 'stable',
    growthTrajectory: 'positive',
    projectedAnnualReturn: null,
    riskLevel: 'moderate',
    taxEfficiency: 'optimizing',
    nextMilestone: null,
    positivityMessage: '',
    actionItems: [],
  };

  // Load treasury data
  try {
    const ledgerPath = path.resolve(process.cwd(), 'data/treasury-ledger.json');
    if (fs.existsSync(ledgerPath)) {
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      const pnl = ledger.lifetimePnl || 0;
      const capital = ledger.currentCapital || 0;
      const initial = ledger.initialCapital || capital;
      const peak = ledger.peakCapital || capital;

      // ROI
      if (initial > 0) {
        const roi = (pnl / initial) * 100;
        metrics.projectedAnnualReturn = `${roi.toFixed(2)}% lifetime`;
      }

      // Drawdown assessment
      const drawdown = peak > 0 ? ((peak - capital) / peak * 100) : 0;
      if (drawdown < 5) metrics.riskLevel = 'low';
      else if (drawdown < 15) metrics.riskLevel = 'moderate';
      else if (drawdown < 30) metrics.riskLevel = 'elevated';
      else metrics.riskLevel = 'high';

      // Growth trajectory
      const snapshots = ledger.dailySnapshots || [];
      const recentPnl = snapshots.slice(-7).reduce((s, d) => s + (d.pnl || 0), 0);
      metrics.growthTrajectory = recentPnl > 0 ? 'positive' : recentPnl < 0 ? 'needs_attention' : 'stable';

      // Next milestone
      const milestones = [500, 750, 1000, 2000, 5000, 10000, 25000, 50000, 100000, 250000, 1000000];
      const nextMs = milestones.find(m => m > capital);
      if (nextMs) {
        const distance = nextMs - capital;
        metrics.nextMilestone = {
          target: nextMs,
          remaining: Math.round(distance * 100) / 100,
          message: `$${distance.toFixed(0)} to go until the $${nextMs.toLocaleString()} milestone`,
        };
      }
    }
  } catch {}

  // Positivity message — grounded in reality, framed for empowerment
  if (metrics.growthTrajectory === 'positive') {
    metrics.positivityMessage = 'Your system is generating returns and growing steadily. Every trade brings you closer to your goals.';
  } else if (metrics.growthTrajectory === 'needs_attention') {
    metrics.positivityMessage = 'A temporary pullback — your risk controls are active and protecting your capital. Patience wins.';
  } else {
    metrics.positivityMessage = 'Building a stable foundation. The system is calibrating for the right opportunities.';
  }

  // Action items for user empowerment
  if (metrics.riskLevel === 'high') {
    metrics.actionItems.push('Consider reviewing risk parameters — the system is operating conservatively to protect your capital');
  }
  if (metrics.nextMilestone) {
    metrics.actionItems.push(metrics.nextMilestone.message);
  }

  return metrics;
}

// ─── Main Cycle ─────────────────────────────────────────────────────────────────

async function main() {
  if (!ENABLED) {
    console.log('[ucfee] Disabled via UCFEE_ENABLED=false');
    process.exit(0);
  }

  console.log('[ucfee] Starting UCFEE-2.0 virtue evaluation cycle');

  // 1. Build context from live system state
  const ctx = virtue.buildContextFromSystem();

  // 2. Gather cross-agent intelligence
  const crossAgent = gatherCrossAgentContext();

  // Enrich context with cross-agent data
  if (crossAgent.geoRisk && crossAgent.geoRisk.risk > 0.7) {
    ctx.userStressed = true; // market stress → activate kindness
  }
  if (crossAgent.taxAdvice?.recommendations?.length > 0) {
    ctx.proactiveHelpOffered = true;
  }

  // 3. Evaluate all 12 virtues
  const evaluation = virtue.evaluate(ctx);
  console.log(`[ucfee] Virtue Index: ${(evaluation.virtueIndex * 100).toFixed(1)}% | Mode: ${evaluation.mode} | Generation: ${evaluation.upgradeGeneration}`);

  // Log individual scores
  for (const [name, data] of Object.entries(evaluation.scores)) {
    const bar = '|'.repeat(Math.round(data.score * 20)).padEnd(20, '.');
    console.log(`  ${name.padEnd(18)} [${bar}] ${(data.score * 100).toFixed(0)}%`);
  }

  // 4. UCFEE-2.0: Compute Positivity Vector
  const positivityVector = virtue.computePositivityVector(evaluation);
  console.log(`[ucfee] Positivity Vector: magnitude=${positivityVector.magnitude} amplified=${positivityVector.amplified} direction=${positivityVector.direction}`);

  // 5. UCFEE-2.0: Check per-virtue compliance against target metrics
  const compliance = virtue.checkVirtueCompliance();
  console.log(`[ucfee] Virtue Compliance: ${(compliance.complianceRate * 100).toFixed(0)}% (${Object.values(compliance.virtues).filter(v => v.passed).length}/${Object.keys(compliance.virtues).length} targets met)`);

  // 6. UCFEE-2.0: Hibernation check
  const hibernation = virtue.checkHibernation();
  if (hibernation.shouldHibernate) {
    console.log(`[ucfee] HIBERNATION TRIGGERED: ${hibernation.message}`);
    await sendAlert(hibernation.message);
  }

  // 7. UCFEE-2.0: Growth Horizon Projections
  let growthProjections = null;
  try {
    const ledgerPath = path.resolve(process.cwd(), 'data/treasury-ledger.json');
    if (fs.existsSync(ledgerPath)) {
      const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      growthProjections = virtue.projectGrowthHorizon({
        currentCapital: ledger.currentCapital || 0,
        monthlyContribution: 0,
        annualReturnPct: 7,
        annualFeePct: 0.5,
      });
      console.log(`[ucfee] Growth Horizon: 5yr=$${growthProjections.projections['5yr']?.balance} 10yr=$${growthProjections.projections['10yr']?.balance} 20yr=$${growthProjections.projections['20yr']?.balance}`);
    }
  } catch {}

  // 8. Compute empowerment metrics
  const empowerment = computeEmpowermentMetrics();

  // 9. Build holistic guidance payload
  const guidancePayload = {
    virtueIndex: evaluation.virtueIndex,
    positivityIndex: evaluation.positivityIndex,
    positivityVector,
    mode: evaluation.mode,
    confidenceMultiplier: evaluation.virtueIndex >= 0.9 ? 1.05 : evaluation.virtueIndex >= 0.7 ? 1.0 : 0.85,
    scores: evaluation.scores,
    compliance: {
      rate: compliance.complianceRate,
      allPassed: compliance.compliant,
    },
    hibernation: {
      active: hibernation.shouldHibernate,
      virtueIndex: hibernation.virtueIndex,
    },
    crossAgentIntel: {
      taxPreference: crossAgent.taxAdvice?.venuePreference?.recommendation || 'neutral',
      geoRiskLevel: crossAgent.geoRisk?.risk || 0,
      marketRegime: crossAgent.marketRegime?.regime || 'unknown',
      sentiment: crossAgent.sentiment?.direction || 'neutral',
    },
    recommendations: [],
    analysisAt: new Date().toISOString(),
  };

  // Generate recommendations from weak virtues + compliance gaps
  for (const [name, data] of Object.entries(evaluation.scores)) {
    if (data.score < 0.6) {
      guidancePayload.recommendations.push({
        virtue: name,
        score: data.score,
        action: `Improve ${name}: ${virtue.VIRTUE_DEFINITIONS[name].description}`,
      });
    }
  }
  for (const [name, vData] of Object.entries(compliance.virtues)) {
    if (!vData.passed) {
      guidancePayload.recommendations.push({
        virtue: name,
        score: vData.current,
        target: vData.target,
        action: `${name} at ${(vData.current * 100).toFixed(0)}%, target ${(vData.target * 100).toFixed(0)}% (${vData.metric}). Gap: ${(vData.gap * 100).toFixed(1)}%`,
      });
    }
  }

  // 10. Publish to signal bus
  try {
    const bus = require('../lib/agent-signal-bus');

    // Virtue guidance for trading agents
    bus.publish({
      type: 'virtue_guidance',
      source: 'ucfee-agent',
      confidence: evaluation.virtueIndex,
      payload: guidancePayload,
      ttlMs: 6 * 60 * 60 * 1000,
    });

    // User empowerment for dashboard/notifications
    bus.publish({
      type: 'user_empowerment',
      source: 'ucfee-agent',
      confidence: 0.9,
      payload: {
        ...empowerment,
        virtueIndex: evaluation.virtueIndex,
        mode: evaluation.mode,
        positivityIndex: evaluation.positivityIndex,
        positivityVector,
        growthProjections: growthProjections?.projections || null,
        complianceRate: compliance.complianceRate,
        taxEfficiency: crossAgent.taxAdvice?.venuePreference?.recommendation || 'active',
        quarterlyTaxDeadline: crossAgent.taxAdvice?.quarterlyDeadline || null,
      },
      ttlMs: 12 * 60 * 60 * 1000,
    });

    console.log('[ucfee] Published virtue_guidance and user_empowerment signals');
  } catch (busErr) {
    logger.warn('Signal bus unavailable', { error: busErr?.message });
  }

  // 11. Build summary report
  const lines = [
    `=== UCFEE-2.0 Virtue Report ===`,
    `Virtue Index: ${(evaluation.virtueIndex * 100).toFixed(1)}% | Positivity: ${(evaluation.positivityIndex * 100).toFixed(1)}%`,
    `Positivity Vector: magnitude=${positivityVector.magnitude} direction=${positivityVector.direction}`,
    `Mode: ${evaluation.mode} | Generation: ${evaluation.upgradeGeneration}`,
    `Compliance: ${(compliance.complianceRate * 100).toFixed(0)}% targets met | Hibernation: ${hibernation.shouldHibernate ? 'ACTIVE' : 'no'}`,
    ``,
  ];

  // Top 3 strengths
  const sorted = Object.entries(evaluation.scores).sort((a, b) => b[1].score - a[1].score);
  lines.push('Strengths:');
  for (const [name, data] of sorted.slice(0, 3)) {
    const target = virtue.VIRTUE_TARGETS[name];
    lines.push(`  + ${name}: ${(data.score * 100).toFixed(0)}% (target: ${(target?.target * 100).toFixed(0)}%)`);
  }

  // Bottom 3 (areas for growth — framed positively per cheerfulness)
  lines.push('Growth opportunities:');
  for (const [name, data] of sorted.slice(-3).reverse()) {
    const target = virtue.VIRTUE_TARGETS[name];
    lines.push(`  * ${name}: ${(data.score * 100).toFixed(0)}% → target ${(target?.target * 100).toFixed(0)}% — room to strengthen`);
  }

  // Growth horizon projections
  if (growthProjections) {
    lines.push('');
    lines.push('Growth Horizon Projections:');
    for (const [horizon, data] of Object.entries(growthProjections.projections)) {
      lines.push(`  ${horizon}: $${data.balance.toLocaleString()} (${data.growthMultiple}x growth)`);
    }
    lines.push('Virtue-guided recommendations:');
    for (const rec of growthProjections.recommendations) {
      lines.push(`  [${rec.virtue}] ${rec.action}`);
    }
  }

  lines.push('');
  lines.push(`User empowerment: ${empowerment.positivityMessage}`);
  if (empowerment.nextMilestone) {
    lines.push(`Next milestone: ${empowerment.nextMilestone.message}`);
  }

  if (crossAgent.taxAdvice?.venuePreference?.recommendation) {
    lines.push(`Tax guidance: ${crossAgent.taxAdvice.venuePreference.recommendation}`);
  }

  const report = lines.join('\n');
  console.log('');
  console.log(report);

  // 8. Alert if below threshold
  if (evaluation.virtueIndex < HIBERNATION_THRESHOLD) {
    await sendAlert(`UCFEE CRITICAL: Virtue Index ${(evaluation.virtueIndex * 100).toFixed(1)}% below hibernation threshold (${HIBERNATION_THRESHOLD * 100}%). System recommends pause for self-diagnostic.`);
  } else if (evaluation.virtueIndex < ALERT_THRESHOLD) {
    await sendAlert(`UCFEE WARNING: Virtue Index ${(evaluation.virtueIndex * 100).toFixed(1)}% below alert threshold. ${guidancePayload.recommendations.length} virtues need attention.`);
  }

  console.log('[ucfee] Cycle complete');
}

if (require.main === module) {
  main().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ucfee] Fatal: ${message}`);
    try { await sendAlert(`UCFEE agent failed: ${message}`); } catch {}
    process.exit(1);
  });
}
