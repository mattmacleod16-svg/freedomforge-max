#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIN_SCORE = Number(process.env.UNISON_MIN_SCORE || 85);

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
  return { name, checks, total, earned, pct: total ? Math.round((earned / total) * 100) : 100 };
}

function evaluateUnison() {
  const pkg = readJSON('package.json', {});
  const scripts = pkg.scripts || {};

  const crossChain = category('cross-chain-interoperability', [
    { id: 'protocol-adapters', pass: exists('lib/protocols/adapters.ts'), points: 5 },
    { id: 'agent-protocols', pass: exists('lib/protocols/agentProtocols.ts'), points: 5 },
    { id: 'venue-engine', pass: exists('scripts/venue-engine.js'), points: 5 },
    { id: 'polymarket-engine', pass: exists('scripts/polymarket-clob-engine.js'), points: 5 },
    { id: 'kraken-engine', pass: exists('scripts/kraken-spot-engine.js'), points: 5 },
    { id: 'coinbase-engine', pass: exists('scripts/coinbase-spot-engine.js'), points: 5 },
    { id: 'multiversx-engine', pass: exists('scripts/multiversx-engine.js'), points: 5 },
  ]);

  const teamwork = category('teamwork-and-orchestration', [
    { id: 'agent-signal-bus', pass: exists('lib/agent-signal-bus.js'), points: 5 },
    { id: 'event-mesh', pass: exists('lib/event-mesh.js'), points: 5 },
    { id: 'consensus-engine', pass: exists('lib/consensus-engine.js'), points: 5 },
    { id: 'help-bots-orchestrator', pass: exists('scripts/help-bots-orchestrator.js'), points: 5 },
    { id: 'teamwork-test', pass: exists('tests/agent-mesh-test.js'), points: 5 },
  ]);

  const knowledge = category('knowledge-base-and-memory', [
    { id: 'knowledge-base-state', pass: exists('data/knowledge-base.json'), points: 5 },
    { id: 'memory-engine', pass: exists('lib/intelligence/memoryEngine.ts'), points: 5 },
    { id: 'learning-script', pass: !!scripts['continuous-learning'], points: 5 },
    { id: 'kb-summary-doc', pass: exists('docs/STRATEGIC-INTELLIGENCE.md'), points: 5 },
  ]);

  const skills = category('skills-matrix', [
    { id: 'skills-matrix-module', pass: exists('lib/intelligence/skillsMatrix.ts'), points: 8 },
    { id: 'human-skill-data', pass: exists('data/human-frontend-profiles.json'), points: 4 },
    { id: 'mecca-audit', pass: !!scripts['autonomy:mecca'], points: 4 },
    { id: 'unison-audit', pass: !!scripts['unison:audit'], points: 4 },
  ]);

  const release = category('main-branch-unison', [
    { id: 'ci-workflow', pass: exists('.github/workflows/ci.yml'), points: 5 },
    { id: 'railway-apply-workflow', pass: exists('.github/workflows/apply-railway-env.yml'), points: 5 },
    { id: 'test-script-includes-unison', pass: String(scripts.test || '').includes('tests/unison-sync.test.js'), points: 5 },
    { id: 'cleanup-script', pass: !!scripts['unison:cleanup'], points: 5 },
  ]);

  const categories = [crossChain, teamwork, knowledge, skills, release];
  const total = categories.reduce((n, c) => n + c.total, 0);
  const earned = categories.reduce((n, c) => n + c.earned, 0);
  const score = total ? Math.round((earned / total) * 100) : 0;

  return {
    score,
    threshold: MIN_SCORE,
    status: score >= MIN_SCORE ? 'in-unison' : 'needs-alignment',
    categories,
  };
}

function formatResult(result) {
  const lines = [];
  lines.push(`Unison Score: ${result.score}/100`);
  lines.push(`Status: ${result.status}`);
  lines.push(`Threshold: ${result.threshold}`);
  for (const c of result.categories) {
    lines.push(`- ${c.name}: ${c.earned}/${c.total} (${c.pct}%)`);
  }
  return lines.join('\n');
}

if (require.main === module) {
  const result = evaluateUnison();
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
  evaluateUnison,
  formatResult,
};
