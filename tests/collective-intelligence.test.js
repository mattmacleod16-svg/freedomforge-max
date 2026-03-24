'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTeamworkSignalMatrix,
  buildSharedMemoryMap,
  computeAutonomousSynchronization,
  computeConsciousnessExpansion,
  evaluateCollectiveState,
} = require('../lib/intelligence/collective-intelligence');

describe('collective intelligence', () => {
  it('builds teamwork collaboration density from directed events', () => {
    const result = buildTeamworkSignalMatrix([
      { from: 'planner', to: 'executor' },
      { from: 'executor', to: 'reviewer' },
      { from: 'reviewer', to: 'planner' },
      { from: 'planner', to: 'executor' },
    ]);

    assert.equal(result.agents.length, 3);
    assert.equal(result.directedEdges, 3);
    assert.ok(result.collaborationDensity > 0.4);
    assert.equal(result.matrix['planner->executor'], 2);
  });

  it('builds shared memory map with contributor spread', () => {
    const result = buildSharedMemoryMap([
      { topic: 'risk-guardrails', author: 'planner', confidence: 0.8 },
      { topic: 'risk-guardrails', author: 'reviewer', confidence: 0.9 },
      { topic: 'latency-tuning', author: 'executor', confidence: 0.7 },
    ]);

    assert.equal(result.topicCount, 2);
    assert.ok(result.contributorSpread > 0);
    assert.ok(result.topics.some((topic) => topic.topic === 'risk-guardrails' && topic.contributorCount === 2));
  });

  it('computes autonomous synchronization from heartbeats', () => {
    const result = computeAutonomousSynchronization([
      { agent: 'planner', ok: true, lagMs: 1500 },
      { agent: 'executor', ok: true, lagMs: 2000 },
      { agent: 'reviewer', ok: false, lagMs: 12000 },
    ]);

    assert.equal(result.activeAgents, 3);
    assert.ok(result.healthyRatio > 0.6);
    assert.ok(result.synchronizationScore > 0.4);
  });

  it('computes consciousness expansion from growth snapshots', () => {
    const now = Date.now();
    const result = computeConsciousnessExpansion([
      { timestamp: now - 4000, contextDepth: 10, strategicOptions: 5, reflectionScore: 0.4 },
      { timestamp: now - 2000, contextDepth: 12, strategicOptions: 7, reflectionScore: 0.6 },
      { timestamp: now, contextDepth: 15, strategicOptions: 9, reflectionScore: 0.75 },
    ]);

    assert.ok(result.depthGrowth > 0);
    assert.ok(result.optionGrowth > 0);
    assert.ok(result.reflectionDelta > 0);
    assert.ok(result.expansionScore > 0);
  });

  it('evaluates a collective state across all dimensions', () => {
    const now = Date.now();
    const result = evaluateCollectiveState({
      events: [
        { from: 'planner', to: 'executor' },
        { from: 'executor', to: 'reviewer' },
        { from: 'reviewer', to: 'planner' },
      ],
      memoryEntries: [
        { topic: 'edge-detection', author: 'planner', confidence: 0.8 },
        { topic: 'edge-detection', author: 'executor', confidence: 0.7 },
        { topic: 'allocation-policy', author: 'reviewer', confidence: 0.9 },
      ],
      heartbeats: [
        { agent: 'planner', ok: true, lagMs: 1200 },
        { agent: 'executor', ok: true, lagMs: 1800 },
        { agent: 'reviewer', ok: true, lagMs: 2200 },
      ],
      snapshots: [
        { timestamp: now - 3000, contextDepth: 8, strategicOptions: 4, reflectionScore: 0.45 },
        { timestamp: now, contextDepth: 14, strategicOptions: 9, reflectionScore: 0.8 },
      ],
    });

    assert.ok(result.score > 0.5, `expected collective score > 0.5, got ${result.score}`);
  });
});
