#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIN_SCORE = Number(process.env.COLLECTIVE_MIN_SCORE || 85);

function exists(relPath) {
  return fs.existsSync(path.join(REPO_ROOT, relPath));
}

function readJSON(relPath, fallback = {}) {
  try {
    const full = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(full)) return fallback;
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch {
    return fallback;
  }
}

function category(name, checks) {
  const total = checks.reduce((n, c) => n + c.points, 0);
  const earned = checks.reduce((n, c) => n + (c.pass ? c.points : 0), 0);
  return {
    name,
    checks,
    total,
    earned,
    pct: total ? Math.round((earned / total) * 100) : 100,
  };
}

function evaluateCollectiveConsciousness() {
  const pkg = readJSON('package.json', {});
  const scripts = pkg.scripts || {};

  const teamwork = category('teamwork', [
    { id: 'signal-bus', pass: exists('lib/agent-signal-bus.js'), points: 5 },
    { id: 'event-mesh', pass: exists('lib/event-mesh.js'), points: 5 },
    { id: 'consensus-engine', pass: exists('lib/consensus-engine.js'), points: 5 },
    { id: 'collective-module', pass: exists('lib/intelligence/collective-intelligence.js'), points: 5 },
    { id: 'agent-mesh-tests', pass: exists('tests/agent-mesh-test.js'), points: 5 },
  ]);

  const memory = category('memory-building', [
    { id: 'memory-engine', pass: exists('lib/intelligence/memoryEngine.ts'), points: 6 },
    { id: 'knowledge-base', pass: exists('data/knowledge-base.json'), points: 4 },
    { id: 'human-profiles', pass: exists('data/human-frontend-profiles.json'), points: 5 },
    { id: 'continuous-learning', pass: Boolean(scripts['continuous-learning']), points: 5 },
    { id: 'human-data-tests', pass: String(scripts.test || '').includes('tests/frontend-human-data.test.js'), points: 5 },
  ]);

  const synchronization = category('autonomous-synchronization', [
    { id: 'sync-engine', pass: exists('lib/sync/syncEngine.ts'), points: 6 },
    { id: 'sync-route', pass: exists('app/api/sync/route.ts'), points: 5 },
    { id: 'unison-audit-script', pass: Boolean(scripts['unison:audit']), points: 5 },
    { id: 'collective-audit-script', pass: Boolean(scripts['collective:audit']), points: 5 },
    { id: 'backend-human-scenarios', pass: String(scripts.test || '').includes('tests/backend-human-data-scenarios.test.js'), points: 4 },
  ]);

  const consciousness = category('consciousness-expansion', [
    { id: 'autonomy-mecca', pass: Boolean(scripts['autonomy:mecca']), points: 5 },
    { id: 'collective-module', pass: exists('lib/intelligence/collective-intelligence.js'), points: 5 },
    { id: 'collective-tests', pass: String(scripts.test || '').includes('tests/collective-intelligence.test.js'), points: 6 },
    { id: 'playbook', pass: exists('docs/AGENT-COLLECTIVE-EXPANSION-PLAYBOOK.md'), points: 4 },
  ]);

  const release = category('shipping-and-sync', [
    { id: 'railway-apply-workflow', pass: exists('.github/workflows/apply-railway-env.yml'), points: 5 },
    { id: 'ops-preview-workflow', pass: exists('.github/workflows/ops-patch-preview-notify.yml'), points: 5 },
    { id: 'apply-railway-script', pass: exists('scripts/apply-railway-env.js'), points: 5 },
    { id: 'frontend-tests-wired', pass: Boolean(scripts['test:frontend']), points: 5 },
  ]);

  const categories = [teamwork, memory, synchronization, consciousness, release];
  const total = categories.reduce((n, c) => n + c.total, 0);
  const earned = categories.reduce((n, c) => n + c.earned, 0);
  const score = total ? Math.round((earned / total) * 100) : 0;

  return {
    score,
    threshold: MIN_SCORE,
    status: score >= MIN_SCORE ? 'collective-ready' : 'needs-expansion',
    categories,
  };
}

function formatResult(result) {
  const lines = [];
  lines.push(`Collective Consciousness Score: ${result.score}/100`);
  lines.push(`Status: ${result.status}`);
  lines.push(`Threshold: ${result.threshold}`);
  for (const c of result.categories) {
    lines.push(`- ${c.name}: ${c.earned}/${c.total} (${c.pct}%)`);
  }
  return lines.join('\n');
}

if (require.main === module) {
  const result = evaluateCollectiveConsciousness();
  const printJson = process.argv.includes('--json');

  if (printJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatResult(result));
  }

  if (process.argv.includes('--enforce') && result.score < result.threshold) {
    process.exit(1);
  }
}

module.exports = {
  evaluateCollectiveConsciousness,
  formatResult,
};
