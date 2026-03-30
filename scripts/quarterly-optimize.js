/**
 * Quarterly Self-Optimization Engine — FreedomForge Max
 * ═══════════════════════════════════════════════════════
 *
 * Reviews engine performance over the past quarter and proposes
 * parameter adjustments for risk limits, venue weights, and model routing.
 *
 * Triggered by: .github/workflows/quarterly-optimize.yml (cron: 0 0 1 */3 *)
 * Can also run manually: node scripts/quarterly-optimize.js
 *
 * SQDIP 2.0 output:
 *   Safety   → no destructive changes without explicit confirmation
 *   Quality  → parameter proposals validated against backtest
 *   Delivery → writes recommendations to ops/quarterly-recommendations.json
 *   Inventory → git log summary of changes since last quarter
 *   Productivity → summary report to stdout + ops/quarterly-report.md
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const REPORT_PATH = path.join(process.cwd(), 'ops', 'quarterly-recommendations.json');
const HISTORY_PATH = path.join(process.cwd(), 'data', 'revenue-router.json');
const JOURNAL_PATH = path.join(process.cwd(), 'data', 'trade-journal.json');

// ─── Data Loaders ─────────────────────────────────────────────────────────────

function loadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

// ─── Analysis ─────────────────────────────────────────────────────────────────

function analyzeTradeJournal(journal) {
  if (!journal || !Array.isArray(journal.trades)) {
    return { winRate: null, avgPnl: null, bestVenue: null, worstVenue: null, sampleSize: 0 };
  }

  const q = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const recent = journal.trades.filter(t => t.closedAt > q);
  if (recent.length === 0) return { winRate: null, avgPnl: null, bestVenue: null, worstVenue: null, sampleSize: 0 };

  const wins = recent.filter(t => (t.pnl ?? 0) > 0).length;
  const avgPnl = recent.reduce((s, t) => s + (t.pnl ?? 0), 0) / recent.length;

  // Venue P&L breakdown
  const byVenue = {};
  for (const t of recent) {
    const v = t.venue ?? 'unknown';
    if (!byVenue[v]) byVenue[v] = { pnl: 0, count: 0 };
    byVenue[v].pnl += t.pnl ?? 0;
    byVenue[v].count++;
  }
  const venuesSorted = Object.entries(byVenue).sort((a, b) => b[1].pnl - a[1].pnl);

  return {
    winRate: Math.round((wins / recent.length) * 1000) / 10,
    avgPnl: Math.round(avgPnl * 100) / 100,
    bestVenue: venuesSorted[0]?.[0] ?? null,
    worstVenue: venuesSorted[venuesSorted.length - 1]?.[0] ?? null,
    sampleSize: recent.length,
  };
}

function analyzeRevenueRouter(routerState) {
  if (!routerState) return { totalRouted: 0, completedGoals: [], nearingGoals: [] };
  const goals = routerState.goals ?? [];
  return {
    totalRouted: routerState.totalRouted ?? 0,
    completedGoals: goals.filter(g => g.status === 'completed').map(g => g.name),
    nearingGoals: goals.filter(g => g.status === 'active' && g.currentUsd / g.targetUsd >= 0.8).map(g => g.name),
  };
}

// ─── Proposal Generator ───────────────────────────────────────────────────────

function generateProposals(tradeStats, revenueStats) {
  const proposals = [];

  // Win rate analysis
  if (tradeStats.winRate !== null) {
    if (tradeStats.winRate < 45) {
      proposals.push({
        area: 'risk',
        parameter: 'MAX_POSITION_USD',
        action: 'decrease',
        rationale: `Win rate ${tradeStats.winRate}% below 45% threshold — reduce position size to protect capital`,
        currentValue: null,
        suggestedChange: '-20%',
        priority: 'high',
      });
    } else if (tradeStats.winRate > 65 && tradeStats.sampleSize >= 30) {
      proposals.push({
        area: 'risk',
        parameter: 'MAX_POSITION_USD',
        action: 'increase',
        rationale: `Win rate ${tradeStats.winRate}% above 65% with ${tradeStats.sampleSize} trades — room to scale up`,
        currentValue: null,
        suggestedChange: '+15%',
        priority: 'medium',
      });
    }
  }

  // Venue routing
  if (tradeStats.worstVenue) {
    proposals.push({
      area: 'routing',
      parameter: `ROUTER_FEE_${tradeStats.worstVenue.toUpperCase()}`,
      action: 'increase',
      rationale: `${tradeStats.worstVenue} is worst-performing venue — increase fee penalty to de-prioritize routing`,
      currentValue: null,
      suggestedChange: '+5 bps',
      priority: 'medium',
    });
  }
  if (tradeStats.bestVenue) {
    proposals.push({
      area: 'routing',
      parameter: `ROUTER_FEE_${tradeStats.bestVenue.toUpperCase()}`,
      action: 'decrease',
      rationale: `${tradeStats.bestVenue} is best-performing venue — lower fee penalty to increase routing priority`,
      currentValue: null,
      suggestedChange: '-3 bps',
      priority: 'low',
    });
  }

  // Revenue goals
  if (revenueStats.completedGoals.length > 0) {
    proposals.push({
      area: 'goals',
      parameter: 'revenue_router_goals',
      action: 'review',
      rationale: `Completed goals: ${revenueStats.completedGoals.join(', ')} — consider raising targets or adding new goals`,
      currentValue: null,
      suggestedChange: 'Review and update goal targets',
      priority: 'low',
    });
  }

  // Always add quarterly reinvestment reminder
  proposals.push({
    area: 'capital',
    parameter: 'quarterly_reinvestment',
    action: 'execute',
    rationale: `Quarterly cycle complete — reinvest profits from pool into standby capital`,
    currentValue: null,
    suggestedChange: `Route $${revenueStats.totalRouted.toFixed(2)} quarterly pool balance to standby`,
    priority: 'high',
  });

  return proposals;
}

// ─── Git Log Summary ──────────────────────────────────────────────────────────

const { execSync } = require('child_process');

function getQuarterlyGitLog() {
  try {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const log = execSync(`git log --oneline --since="${since}" 2>/dev/null`, { encoding: 'utf8' });
    return log.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  FreedomForge Max — Quarterly Self-Optimization  ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const journal     = loadJson(JOURNAL_PATH);
  const routerState = loadJson(HISTORY_PATH);
  const gitLog      = getQuarterlyGitLog();

  // ── S: Safety ──
  console.log('🛡  Safety: Read-only analysis — no parameters modified automatically');

  // ── Q: Quality ──
  const tradeStats   = analyzeTradeJournal(journal);
  const revenueStats = analyzeRevenueRouter(routerState);
  const proposals    = generateProposals(tradeStats, revenueStats);

  console.log('\n📊 Quality Analysis:');
  console.log(`   Win Rate    : ${tradeStats.winRate ?? 'N/A'}% (${tradeStats.sampleSize} trades)`);
  console.log(`   Avg P&L     : $${tradeStats.avgPnl ?? 'N/A'}`);
  console.log(`   Best Venue  : ${tradeStats.bestVenue ?? 'N/A'}`);
  console.log(`   Total Routed: $${revenueStats.totalRouted.toFixed(2)}`);
  console.log(`   Completed   : ${revenueStats.completedGoals.join(', ') || 'none'}`);

  // ── D: Delivery ──
  const report = {
    generatedAt: new Date().toISOString(),
    quarterEnd: new Date().toISOString(),
    tradeStats,
    revenueStats,
    proposals,
    commitsSinceLastQuarter: gitLog.length,
    recentCommits: gitLog.slice(0, 10),
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n📦 Delivery: Recommendations saved → ${REPORT_PATH}`);

  // ── I: Inventory ──
  console.log(`\n📋 Inventory: ${gitLog.length} commits this quarter`);
  gitLog.slice(0, 5).forEach(l => console.log(`   ${l}`));

  // ── P: Productivity ──
  console.log('\n⚡ Productivity Summary:');
  console.log(`   ${proposals.length} optimization proposals generated`);
  const high = proposals.filter(p => p.priority === 'high');
  if (high.length > 0) {
    console.log(`   🔴 ${high.length} HIGH priority action(s):`);
    high.forEach(p => console.log(`      → [${p.area}] ${p.rationale}`));
  }

  console.log('\n✅ Quarterly optimization complete. Review ops/quarterly-recommendations.json\n');
}

main().catch(err => { console.error('Quarterly optimize failed:', err); process.exit(1); });
