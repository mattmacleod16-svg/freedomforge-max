'use strict';

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function buildTeamworkSignalMatrix(events = []) {
  const matrix = new Map();
  const agentSet = new Set();

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const from = String(event.from || '').trim();
    const to = String(event.to || '').trim();
    if (!from || !to || from === to) continue;

    agentSet.add(from);
    agentSet.add(to);

    const key = `${from}->${to}`;
    matrix.set(key, (matrix.get(key) || 0) + 1);
  }

  const agents = [...agentSet];
  const directedEdges = matrix.size;
  const possibleEdges = agents.length <= 1 ? 0 : agents.length * (agents.length - 1);
  const collaborationDensity = possibleEdges === 0 ? 0 : clamp(directedEdges / possibleEdges);

  return {
    agents,
    directedEdges,
    possibleEdges,
    collaborationDensity,
    matrix: Object.fromEntries(matrix.entries()),
  };
}

function buildSharedMemoryMap(entries = []) {
  const map = new Map();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const topic = String(entry.topic || '').trim();
    const author = String(entry.author || '').trim();
    const confidence = clamp(safeNumber(entry.confidence, 0.5));
    if (!topic || !author) continue;

    const current = map.get(topic) || {
      topic,
      contributors: new Set(),
      revisions: 0,
      confidenceSum: 0,
    };

    current.contributors.add(author);
    current.revisions += 1;
    current.confidenceSum += confidence;
    map.set(topic, current);
  }

  const topics = [...map.values()].map((item) => ({
    topic: item.topic,
    contributors: [...item.contributors].sort(),
    contributorCount: item.contributors.size,
    revisions: item.revisions,
    confidence: clamp(item.revisions === 0 ? 0 : item.confidenceSum / item.revisions),
  }));

  const contributorSpread = topics.length === 0
    ? 0
    : clamp(topics.reduce((sum, t) => sum + t.contributorCount, 0) / (topics.length * 4));

  return {
    topicCount: topics.length,
    contributorSpread,
    topics,
  };
}

function computeAutonomousSynchronization(heartbeats = []) {
  const valid = heartbeats
    .map((entry) => ({
      agent: String(entry?.agent || '').trim(),
      lagMs: safeNumber(entry?.lagMs, Infinity),
      ok: Boolean(entry?.ok),
    }))
    .filter((entry) => entry.agent);

  if (valid.length === 0) {
    return {
      healthyRatio: 0,
      lagScore: 0,
      synchronizationScore: 0,
      activeAgents: 0,
    };
  }

  const healthy = valid.filter((entry) => entry.ok).length;
  const healthyRatio = clamp(healthy / valid.length);

  const lagValues = valid
    .map((entry) => entry.lagMs)
    .filter((lagMs) => Number.isFinite(lagMs) && lagMs >= 0);

  const avgLagMs = lagValues.length === 0 ? 30000 : lagValues.reduce((sum, n) => sum + n, 0) / lagValues.length;
  const lagScore = clamp(1 - avgLagMs / 30000);

  const synchronizationScore = clamp(healthyRatio * 0.65 + lagScore * 0.35);

  return {
    healthyRatio,
    lagScore,
    synchronizationScore,
    activeAgents: valid.length,
  };
}

function computeConsciousnessExpansion(snapshots = []) {
  const valid = snapshots
    .map((entry) => ({
      timestamp: safeNumber(entry?.timestamp, 0),
      contextDepth: safeNumber(entry?.contextDepth, 0),
      strategicOptions: safeNumber(entry?.strategicOptions, 0),
      reflectionScore: clamp(safeNumber(entry?.reflectionScore, 0)),
    }))
    .filter((entry) => entry.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (valid.length < 2) {
    return {
      expansionScore: 0,
      depthGrowth: 0,
      optionGrowth: 0,
      reflectionDelta: 0,
      sampleSize: valid.length,
    };
  }

  const first = valid[0];
  const last = valid[valid.length - 1];

  const depthGrowth = first.contextDepth <= 0 ? 0 : (last.contextDepth - first.contextDepth) / first.contextDepth;
  const optionGrowth = first.strategicOptions <= 0 ? 0 : (last.strategicOptions - first.strategicOptions) / first.strategicOptions;
  const reflectionDelta = last.reflectionScore - first.reflectionScore;

  const expansionScore = clamp(
    clamp(depthGrowth, -1, 2) * 0.4 +
    clamp(optionGrowth, -1, 2) * 0.35 +
    clamp(reflectionDelta, -1, 1) * 0.25
  );

  return {
    expansionScore,
    depthGrowth,
    optionGrowth,
    reflectionDelta,
    sampleSize: valid.length,
  };
}

function evaluateCollectiveState(input = {}) {
  const teamwork = buildTeamworkSignalMatrix(input.events || []);
  const memory = buildSharedMemoryMap(input.memoryEntries || []);
  const sync = computeAutonomousSynchronization(input.heartbeats || []);
  const consciousness = computeConsciousnessExpansion(input.snapshots || []);

  const score = clamp(
    teamwork.collaborationDensity * 0.25 +
    memory.contributorSpread * 0.25 +
    sync.synchronizationScore * 0.25 +
    consciousness.expansionScore * 0.25
  );

  return {
    score,
    teamwork,
    memory,
    synchronization: sync,
    consciousness,
  };
}

module.exports = {
  buildTeamworkSignalMatrix,
  buildSharedMemoryMap,
  computeAutonomousSynchronization,
  computeConsciousnessExpansion,
  evaluateCollectiveState,
};
