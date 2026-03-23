#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const ENFORCE_THRESHOLD = Number(process.env.AUTONOMY_MECCA_MIN_SCORE || 85);

function exists(relPath) {
  return fs.existsSync(path.join(REPO_ROOT, relPath));
}

function readSafe(relPath) {
  try {
    return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
  } catch {
    return '';
  }
}

function scoreCategory(name, checks) {
  const maxPoints = checks.reduce((sum, c) => sum + c.points, 0);
  const earnedPoints = checks.reduce((sum, c) => sum + (c.pass ? c.points : 0), 0);
  const ratio = maxPoints === 0 ? 1 : earnedPoints / maxPoints;
  return {
    name,
    maxPoints,
    earnedPoints,
    ratio,
    checks,
  };
}

function evaluateAutonomyMecca() {
  const packageJson = JSON.parse(readSafe('package.json') || '{}');
  const scripts = packageJson.scripts || {};

  const c1 = scoreCategory('core-autonomy', [
    { id: 'self-heal-script', pass: !!scripts['self-heal'], points: 5 },
    { id: 'autonomy-maintenance-script', pass: !!scripts['autonomy:maintain'], points: 5 },
    { id: 'orchestrator-script', pass: !!scripts['help-bots:run'], points: 5 },
    { id: 'model-intel-script', pass: !!scripts['continuous-learning'], points: 5 },
  ]);

  const c2 = scoreCategory('safety-governance', [
    { id: 'risk-manager-module', pass: exists('lib/risk-manager.js'), points: 5 },
    { id: 'var-engine-module', pass: exists('lib/var-engine.js'), points: 5 },
    { id: 'circuit-breaker-module', pass: exists('lib/circuit-breaker.js'), points: 5 },
    { id: 'auth-guard-module', pass: exists('lib/auth/apiGuard.ts'), points: 5 },
  ]);

  const c3 = scoreCategory('frontend-human-outcomes', [
    { id: 'human-profile-fixtures', pass: exists('data/human-frontend-profiles.json'), points: 6 },
    { id: 'human-data-validator', pass: exists('lib/frontend-human-data.js'), points: 6 },
    { id: 'frontend-human-tests', pass: exists('tests/frontend-human-data.test.js'), points: 8 },
  ]);

  const c4 = scoreCategory('operational-intelligence', [
    { id: 'ops-patch-pr-workflow', pass: exists('.github/workflows/ops-patch-pr.yml'), points: 5 },
    { id: 'ops-preview-notify-workflow', pass: exists('.github/workflows/ops-patch-preview-notify.yml'), points: 5 },
    { id: 'apply-railway-env-workflow', pass: exists('.github/workflows/apply-railway-env.yml'), points: 5 },
    { id: 'weekly-policy-workflow', pass: exists('.github/workflows/weekly-policy-review.yml'), points: 5 },
  ]);

  const c5 = scoreCategory('verification-discipline', [
    { id: 'core-tests', pass: /tests\/core\.test\.js/.test(String(scripts.test || '')), points: 5 },
    { id: 'frontend-human-tests-wired', pass: /tests\/frontend-human-data\.test\.js/.test(String(scripts.test || '')), points: 5 },
    { id: 'mecca-tests-wired', pass: /tests\/autonomy-mecca\.test\.js/.test(String(scripts.test || '')), points: 5 },
    { id: 'deep-audit-script', pass: !!scripts['audit:deep'], points: 5 },
  ]);

  const categories = [c1, c2, c3, c4, c5];
  const maxPoints = categories.reduce((sum, c) => sum + c.maxPoints, 0);
  const earnedPoints = categories.reduce((sum, c) => sum + c.earnedPoints, 0);
  const score = maxPoints === 0 ? 0 : Math.round((earnedPoints / maxPoints) * 100);

  return {
    score,
    threshold: ENFORCE_THRESHOLD,
    status: score >= ENFORCE_THRESHOLD ? 'mecca-ready' : 'needs-work',
    categories,
  };
}

function formatReport(result) {
  const lines = [];
  lines.push(`Autonomy Mecca Score: ${result.score}/100`);
  lines.push(`Status: ${result.status}`);
  lines.push(`Threshold: ${result.threshold}`);
  for (const category of result.categories) {
    const pct = Math.round(category.ratio * 100);
    lines.push(`- ${category.name}: ${category.earnedPoints}/${category.maxPoints} (${pct}%)`);
  }
  return lines.join('\n');
}

if (require.main === module) {
  const result = evaluateAutonomyMecca();
  const outputJson = process.argv.includes('--json');
  if (outputJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatReport(result));
  }

  if (process.argv.includes('--enforce') && result.score < result.threshold) {
    process.exit(1);
  }
}

module.exports = {
  evaluateAutonomyMecca,
  formatReport,
};
