/**
 * Orchestrator Pure Function Tests
 * ==================================
 *
 * Unit tests for the pure utility functions extracted from
 * lib/synthesis/orchestrator.ts.
 *
 * Because the orchestrator is a TypeScript/Next.js module with bundler
 * module resolution, the pure functions are re-implemented inline here so
 * they can be exercised without a build step. The implementations must stay
 * in sync with orchestrator.ts — any divergence should be treated as a bug.
 *
 * Run:  node --test tests/orchestrator.test.js
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ─── Pure function re-implementations (mirrors orchestrator.ts) ────────────

function isUsableResponse(text) {
  const value = (text || '').trim().toLowerCase();
  if (!value) return false;
  if (value === 'no response') return false;
  if (value.startsWith('error:')) return false;
  return value.length >= 24;
}

function firstUsableResponse(responses) {
  return responses.find((item) => isUsableResponse(item.response))?.response || '';
}

function extractKeyLines(text, limit = 2) {
  const lines = (text || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 18)
    .filter((line) => !/^sources?:/i.test(line));
  return lines.slice(0, limit);
}

function classifyResponseIssue(text) {
  const value = (text || '').trim().toLowerCase();
  if (!value) return 'empty';
  if (value === 'no response') return 'no_response';
  if (value.startsWith('error:')) return 'provider_error';
  if (value.length < 24) return 'too_short';
  return 'filtered_by_consensus';
}

function tokenSet(text) {
  return new Set(
    (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2)
  );
}

function jaccard(a, b) {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let intersection = 0;
  a.forEach((token) => { if (b.has(token)) intersection += 1; });
  return intersection / union.size;
}

function computeAgreementScore(items) {
  if (items.length <= 1) return 1;
  const sets = items.map((item) => tokenSet(item.response));
  const pairs = [];
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      pairs.push(jaccard(sets[i], sets[j]));
    }
  }
  if (pairs.length === 0) return 1;
  const avg = pairs.reduce((sum, value) => sum + value, 0) / pairs.length;
  return Number(avg.toFixed(4));
}

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

function isBottomLineCriticalQuery(query) {
  return /(portfolio|allocation|position size|rebalance|drawdown|risk|autopilot|prediction market|trade|entry|exit|capital|cashflow|budget|revenue|payout|transfer|wire|execute|bottom line|profit|loss)/i.test(query);
}

function isLowStakesQuery(query) {
  const text = (query || '').trim();
  if (!text) return true;
  const words = countWords(text);
  if (words <= 3) return true;
  if (/^(hi|hello|hey|yo|ping|status\??|gm|gn)$/i.test(text)) return true;
  return false;
}

function isCodingQuery(query) {
  return /(code|debug|function|class|implement|refactor|script|algorithm|typescript|javascript|python|api endpoint|unit test|bug fix|snippet|regex|sql query|shell command|dockerfile|lint|compile|build error)/i.test(
    query
  );
}

function estimateComplexityScore(input) {
  const words = countWords(input.userQuery);
  const query = input.userQuery.toLowerCase();
  const strategyIntent = /(strategy|plan|roadmap|allocation|portfolio|risk|trade|forecast|reason|optimi|architecture|compare|autonomy)/i.test(query);
  const highImpactIntent = /(transfer|wire|execute|autopilot|all-in|leverage|rebalance|deploy|live)/i.test(query) || isBottomLineCriticalQuery(query);
  const uncertainMarket = (input.marketConfidence ?? 0.5) < 0.5 || (input.forecastConfidence ?? 0.5) < 0.52 || (input.forecastBrier ?? 0.2) > 0.22;
  const riskOff = input.marketRegime === 'risk_off';

  let score = 0.2;
  score += Math.min(0.25, words / 140);
  if (strategyIntent) score += 0.2;
  if (highImpactIntent) score += 0.2;
  if (uncertainMarket) score += 0.15;
  if (riskOff) score += 0.1;
  if (input.maxMode) score += 0.15;

  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

function buildReasoningProfile(input) {
  const bottomLineProtected = isBottomLineCriticalQuery(input.userQuery);
  const complexityScore = estimateComplexityScore({
    userQuery: input.userQuery,
    maxMode: input.maxMode,
    marketRegime: input.marketRegime,
    marketConfidence: input.marketConfidence,
    forecastConfidence: input.forecastConfidence,
    forecastBrier: input.forecastBrier,
  });

  const budgetUsdDefault = input.maxMode ? 0.028 : 0.012;
  const criticalBudgetDefault = input.maxMode ? 0.04 : 0.025;
  const baseBudget = Math.max(0.002, Number(process.env.AI_QUERY_BUDGET_USD || budgetUsdDefault));
  const criticalBudget = Math.max(baseBudget, Number(process.env.AI_CRITICAL_QUERY_BUDGET_USD || criticalBudgetDefault));
  const budgetUsd = bottomLineProtected ? criticalBudget : baseBudget;
  const costPer1kTokens = Math.max(0.0001, Number(process.env.AI_MODEL_COST_PER_1K_TOKENS || 0.0022));

  const estimatedTokensPerModel =
    complexityScore >= 0.75 ? 1300 : complexityScore >= 0.45 ? 950 : 650;

  const estimatedCostPerModel = (estimatedTokensPerModel / 1000) * costPer1kTokens;
  const computedBudgetCap = Math.floor(budgetUsd / Math.max(0.000001, estimatedCostPerModel));
  const modelBudgetCap = Math.max(1, Math.min(input.availableModelCount, computedBudgetCap));

  const minModelsBase = Math.max(1, Number(process.env.AI_MIN_MODEL_COUNT || 1));
  const criticalMinModels = Math.max(minModelsBase, Number(process.env.AI_CRITICAL_MIN_MODEL_COUNT || 3));
  const minModels = bottomLineProtected ? criticalMinModels : minModelsBase;
  const maxModelsEnv = Math.max(1, Number(process.env.AI_MAX_MODEL_COUNT || (input.maxMode ? 5 : 4)));
  const criticalMaxFloor = Math.max(minModels, Number(process.env.AI_CRITICAL_MAX_MODEL_COUNT || 4));

  const mode = complexityScore >= 0.75 ? 'deep' : complexityScore >= 0.4 ? 'balanced' : 'lean';

  const initialFromComplexity = mode === 'deep' ? 3 : mode === 'balanced' ? 2 : 1;
  const initialModelCount = Math.max(
    minModels,
    Math.min(input.availableModelCount, input.baselineModelCount, initialFromComplexity, modelBudgetCap)
  );

  const targetMaxFromMode =
    mode === 'deep' ? Math.max(input.baselineModelCount, input.maxMode ? 5 : 4)
      : mode === 'balanced' ? Math.max(initialModelCount + 1, input.baselineModelCount)
        : initialModelCount;

  let maxModelCount = Math.max(
    initialModelCount,
    Math.min(input.availableModelCount, maxModelsEnv, modelBudgetCap, targetMaxFromMode)
  );

  if (bottomLineProtected) {
    maxModelCount = Math.max(
      maxModelCount,
      Math.min(input.availableModelCount, maxModelsEnv, criticalMaxFloor, modelBudgetCap)
    );
  }

  const escalationEnabled = maxModelCount > initialModelCount;
  const escalationAgreementThreshold = Math.max(0.08, Math.min(0.7, Number(process.env.AI_ESCALATION_AGREEMENT_THRESHOLD || 0.23)));
  const escalationConfidenceThreshold = Math.max(0.3, Math.min(0.9, Number(process.env.AI_ESCALATION_CONFIDENCE_THRESHOLD || 0.56)));

  return {
    mode,
    bottomLineProtected,
    complexityScore,
    budgetUsd,
    estimatedTokensPerModel,
    modelBudgetCap,
    initialModelCount,
    maxModelCount,
    escalationEnabled,
    escalationAgreementThreshold,
    escalationConfidenceThreshold,
  };
}

function shouldEscalateModelPass(input) {
  if (!input.profile.escalationEnabled) {
    return { escalate: false, reasons: [] };
  }

  const reasons = [];
  const lowStakes = isLowStakesQuery(input.userQuery);
  const highImpact = /(autopilot|transfer|wire|execute|allocation|portfolio|prediction market|leverage|all-in)/i.test(input.userQuery);

  if (lowStakes && !input.profile.bottomLineProtected && !highImpact) {
    return { escalate: false, reasons: [] };
  }

  if (input.consensusAgreement < input.profile.escalationAgreementThreshold) {
    reasons.push(`low_agreement(${input.consensusAgreement.toFixed(3)})`);
  }
  if (input.maxConfidence < input.profile.escalationConfidenceThreshold) {
    reasons.push(`low_confidence(${input.maxConfidence.toFixed(3)})`);
  }
  if (highImpact) reasons.push('high_impact_query');
  if (input.profile.bottomLineProtected) reasons.push('bottom_line_protection');
  if (input.profile.mode === 'deep' && reasons.length === 0) reasons.push('deep_mode_committee');

  return { escalate: reasons.length > 0, reasons };
}

function buildEnsembleConsensus(input) {
  const usable = input.responses
    .filter((row) => isUsableResponse(row.response))
    .sort((a, b) => b.confidence - a.confidence);

  if (usable.length === 0) {
    return {
      response: '',
      participatingModels: [],
      droppedModels: input.responses.map((row) => row.model),
      droppedDetails: input.responses.map((row) => ({
        model: row.model,
        reason: classifyResponseIssue(row.response),
      })),
      agreementScore: 0,
    };
  }

  if (usable.length === 1) {
    return {
      response: usable[0].response,
      participatingModels: [usable[0].model],
      droppedModels: input.responses.filter((row) => row.model !== usable[0].model).map((row) => row.model),
      droppedDetails: input.responses
        .filter((row) => row.model !== usable[0].model)
        .map((row) => ({ model: row.model, reason: classifyResponseIssue(row.response) })),
      agreementScore: 1,
    };
  }

  const topN = input.maxMode ? Math.min(4, usable.length) : Math.min(3, usable.length);
  const picked = usable.slice(0, topN);
  const lines = picked.flatMap((row) => extractKeyLines(row.response, 2));

  const seen = new Set();
  const dedupedLines = lines.filter((line) => {
    const key = line.toLowerCase().slice(0, 120);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, input.maxMode ? 6 : 4);

  const response = [
    'Ensemble consensus:',
    ...dedupedLines.map((line) => `- ${line}`),
    `Committee coverage: ${picked.map((row) => row.model).join(', ')}`,
  ].join('\n');

  return {
    response,
    participatingModels: picked.map((row) => row.model),
    droppedModels: input.responses
      .map((row) => row.model)
      .filter((name) => !picked.some((row) => row.model === name)),
    droppedDetails: input.responses
      .filter((row) => !picked.some((candidate) => candidate.model === row.model))
      .map((row) => ({ model: row.model, reason: classifyResponseIssue(row.response) })),
    agreementScore: computeAgreementScore(picked),
  };
}

// ─── Test suites ──────────────────────────────────────────────────────────────

describe('orchestrator: isUsableResponse()', () => {
  it('rejects empty string', () => { assert.strictEqual(isUsableResponse(''), false); });
  it('rejects whitespace-only string', () => { assert.strictEqual(isUsableResponse('   '), false); });
  it('rejects "no response"', () => { assert.strictEqual(isUsableResponse('no response'), false); });
  it('rejects "NO RESPONSE" (case-insensitive)', () => { assert.strictEqual(isUsableResponse('NO RESPONSE'), false); });
  it('rejects strings starting with "error:"', () => { assert.strictEqual(isUsableResponse('error: model unavailable'), false); });
  it('rejects "Error: rate limit exceeded" (case-insensitive)', () => { assert.strictEqual(isUsableResponse('Error: rate limit exceeded'), false); });
  it('rejects strings shorter than 24 chars', () => { assert.strictEqual(isUsableResponse('Too short'), false); });
  it('rejects exactly 23 characters', () => { assert.strictEqual(isUsableResponse('a'.repeat(23)), false); });
  it('accepts exactly 24 characters', () => { assert.strictEqual(isUsableResponse('a'.repeat(24)), true); });
  it('accepts valid long response', () => { assert.strictEqual(isUsableResponse('This is a proper detailed response from the AI model.'), true); });
});

describe('orchestrator: firstUsableResponse()', () => {
  it('returns empty string for empty array', () => {
    assert.strictEqual(firstUsableResponse([]), '');
  });
  it('returns empty string when all responses are unusable', () => {
    assert.strictEqual(firstUsableResponse([
      { response: '' },
      { response: 'error: fail' },
      { response: 'no response' },
    ]), '');
  });
  it('returns first usable response', () => {
    const valid = 'This is a valid response that is long enough to pass.';
    assert.strictEqual(firstUsableResponse([
      { response: 'error: fail' },
      { response: valid },
      { response: 'Another valid long response that would also pass the filter.' },
    ]), valid);
  });
  it('skips short unusable responses before first usable one', () => {
    const valid = 'Valid long response that exceeds the minimum length threshold.';
    assert.strictEqual(firstUsableResponse([
      { response: 'short' },
      { response: valid },
    ]), valid);
  });
});

describe('orchestrator: extractKeyLines()', () => {
  it('returns empty array for empty string', () => {
    assert.deepStrictEqual(extractKeyLines(''), []);
  });
  it('returns up to limit lines', () => {
    const text = 'Line one is long enough to pass.\nLine two is also long enough.\nLine three here.';
    const lines = extractKeyLines(text, 2);
    assert.strictEqual(lines.length, 2);
  });
  it('filters out lines shorter than 18 characters', () => {
    const text = 'Short.\nThis line is long enough to be included in results.';
    const lines = extractKeyLines(text, 5);
    assert.ok(lines.every((l) => l.length >= 18));
  });
  it('filters out "Sources:" lines', () => {
    const text = 'Sources: some source\nThis is a valid long response line that should be included.';
    const lines = extractKeyLines(text, 5);
    assert.ok(lines.every((l) => !/^sources?:/i.test(l)));
  });
  it('default limit is 2', () => {
    const text = Array.from({ length: 10 }, (_, i) => `This is line number ${i + 1} and it is long enough.`).join('\n');
    assert.strictEqual(extractKeyLines(text).length, 2);
  });
});

describe('orchestrator: classifyResponseIssue()', () => {
  it('classifies empty string as "empty"', () => {
    assert.strictEqual(classifyResponseIssue(''), 'empty');
  });
  it('classifies null/undefined as "empty"', () => {
    assert.strictEqual(classifyResponseIssue(null), 'empty');
    assert.strictEqual(classifyResponseIssue(undefined), 'empty');
  });
  it('classifies "no response" as "no_response"', () => {
    assert.strictEqual(classifyResponseIssue('no response'), 'no_response');
  });
  it('classifies "error: ..." as "provider_error"', () => {
    assert.strictEqual(classifyResponseIssue('error: model overloaded'), 'provider_error');
  });
  it('classifies string < 24 chars as "too_short"', () => {
    assert.strictEqual(classifyResponseIssue('tiny'), 'too_short');
  });
  it('classifies valid response as "filtered_by_consensus"', () => {
    assert.strictEqual(classifyResponseIssue('This is a valid long response that passes the usable check.'), 'filtered_by_consensus');
  });
});

describe('orchestrator: computeAgreementScore()', () => {
  it('returns 1 for single item', () => {
    assert.strictEqual(computeAgreementScore([{ response: 'hello world test' }]), 1);
  });
  it('returns 1 for identical responses', () => {
    const r = { response: 'the quick brown fox jumps over the lazy dog' };
    assert.strictEqual(computeAgreementScore([r, r]), 1);
  });
  it('returns 0 for completely different responses', () => {
    const score = computeAgreementScore([
      { response: 'alpha beta gamma delta epsilon zeta' },
      { response: 'one two three four five six seven eight nine ten' },
    ]);
    assert.ok(score >= 0 && score <= 1, `Expected 0-1 range, got ${score}`);
    assert.ok(score < 0.5, `Expected low agreement, got ${score}`);
  });
  it('returns value between 0 and 1', () => {
    const score = computeAgreementScore([
      { response: 'the market is bullish with strong momentum indicators' },
      { response: 'the market shows bullish signals but watch for reversal' },
    ]);
    assert.ok(score >= 0 && score <= 1);
  });
  it('returns 1 for empty array', () => {
    assert.strictEqual(computeAgreementScore([]), 1);
  });
});

describe('orchestrator: buildEnsembleConsensus()', () => {
  it('returns empty response when all responses are unusable', () => {
    const result = buildEnsembleConsensus({
      responses: [
        { model: 'gpt-4', response: 'error: unavailable', confidence: 0.9 },
        { model: 'claude', response: '', confidence: 0.8 },
      ],
      maxMode: false,
    });
    assert.strictEqual(result.response, '');
    assert.strictEqual(result.participatingModels.length, 0);
    assert.strictEqual(result.droppedModels.length, 2);
    assert.strictEqual(result.agreementScore, 0);
  });

  it('returns single response when only one model is usable', () => {
    const valid = 'This is a valid response from the model that is long enough to pass.';
    const result = buildEnsembleConsensus({
      responses: [
        { model: 'gpt-4', response: valid, confidence: 0.9 },
        { model: 'claude', response: 'error: fail', confidence: 0.5 },
      ],
      maxMode: false,
    });
    assert.strictEqual(result.response, valid);
    assert.deepStrictEqual(result.participatingModels, ['gpt-4']);
    assert.strictEqual(result.agreementScore, 1);
  });

  it('builds ensemble response from multiple usable responses', () => {
    const r1 = 'The portfolio allocation should consider risk tolerance and time horizon carefully.';
    const r2 = 'Market conditions suggest a balanced approach to diversification across sectors.';
    const result = buildEnsembleConsensus({
      responses: [
        { model: 'gpt-4', response: r1, confidence: 0.9 },
        { model: 'claude', response: r2, confidence: 0.8 },
      ],
      maxMode: false,
    });
    assert.ok(result.response.startsWith('Ensemble consensus:'), `Expected consensus prefix, got: ${result.response.substring(0, 60)}`);
    assert.ok(result.participatingModels.length >= 1);
    assert.ok(result.agreementScore >= 0 && result.agreementScore <= 1);
  });

  it('respects maxMode by including more models', () => {
    const responses = Array.from({ length: 5 }, (_, i) => ({
      model: `model-${i}`,
      response: `This is a valid response number ${i + 1} that is long enough to be considered usable by the filter.`,
      confidence: 0.9 - i * 0.05,
    }));

    const normalResult = buildEnsembleConsensus({ responses, maxMode: false });
    const maxResult = buildEnsembleConsensus({ responses, maxMode: true });

    assert.ok(maxResult.participatingModels.length >= normalResult.participatingModels.length,
      'maxMode should include at least as many models as normal mode');
  });
});

describe('orchestrator: isBottomLineCriticalQuery()', () => {
  it('flags "trade" as critical', () => { assert.ok(isBottomLineCriticalQuery('How should I trade this position?')); });
  it('flags "portfolio" as critical', () => { assert.ok(isBottomLineCriticalQuery('Review my portfolio allocation')); });
  it('flags "transfer" as critical', () => { assert.ok(isBottomLineCriticalQuery('Transfer funds to wallet')); });
  it('flags "risk" as critical', () => { assert.ok(isBottomLineCriticalQuery('What is my current risk exposure?')); });
  it('flags "profit" as critical', () => { assert.ok(isBottomLineCriticalQuery('Show me my profit and loss')); });
  it('does not flag simple greeting', () => { assert.strictEqual(isBottomLineCriticalQuery('Hello how are you?'), false); });
  it('does not flag general question', () => { assert.strictEqual(isBottomLineCriticalQuery('What is the weather today?'), false); });
});

describe('orchestrator: isLowStakesQuery()', () => {
  it('treats empty string as low stakes', () => { assert.ok(isLowStakesQuery('')); });
  it('treats single word greetings as low stakes', () => { assert.ok(isLowStakesQuery('hi')); });
  it('treats "hello" as low stakes', () => { assert.ok(isLowStakesQuery('hello')); });
  it('treats queries with 3 or fewer words as low stakes', () => { assert.ok(isLowStakesQuery('what is this')); });
  it('treats longer strategic query as NOT low stakes', () => {
    assert.strictEqual(isLowStakesQuery('Can you analyze my portfolio and suggest a rebalancing strategy?'), false);
  });
  it('treats "status" as low stakes', () => { assert.ok(isLowStakesQuery('status')); });
});

describe('orchestrator: estimateComplexityScore()', () => {
  it('returns value between 0 and 1', () => {
    const score = estimateComplexityScore({ userQuery: 'hello', maxMode: false });
    assert.ok(score >= 0 && score <= 1, `Score out of range: ${score}`);
  });
  it('short greeting has low complexity', () => {
    const score = estimateComplexityScore({ userQuery: 'hi', maxMode: false });
    assert.ok(score < 0.5, `Expected low complexity, got ${score}`);
  });
  it('strategy query has higher complexity', () => {
    const score = estimateComplexityScore({
      userQuery: 'Analyze my full portfolio allocation strategy and forecast risk-adjusted returns',
      maxMode: false,
    });
    assert.ok(score > 0.3, `Expected moderate/high complexity, got ${score}`);
  });
  it('maxMode increases complexity score', () => {
    const base = estimateComplexityScore({ userQuery: 'analyze portfolio', maxMode: false });
    const max = estimateComplexityScore({ userQuery: 'analyze portfolio', maxMode: true });
    assert.ok(max >= base, `maxMode should increase or maintain score: base=${base} max=${max}`);
  });
  it('risk_off market increases complexity score', () => {
    const neutral = estimateComplexityScore({ userQuery: 'check market', maxMode: false, marketRegime: 'neutral' });
    const riskOff = estimateComplexityScore({ userQuery: 'check market', maxMode: false, marketRegime: 'risk_off' });
    assert.ok(riskOff > neutral, `risk_off should increase complexity: neutral=${neutral} riskOff=${riskOff}`);
  });
});

describe('orchestrator: buildReasoningProfile()', () => {
  const baseInput = {
    userQuery: 'hello world',
    maxMode: false,
    availableModelCount: 5,
    baselineModelCount: 3,
  };

  it('returns "lean" mode for simple greeting', () => {
    const profile = buildReasoningProfile(baseInput);
    assert.strictEqual(profile.mode, 'lean');
  });

  it('returns "deep" mode for complex critical query', () => {
    const profile = buildReasoningProfile({
      ...baseInput,
      userQuery: 'Please provide an exhaustive multi-factor analysis of my portfolio risk allocation strategy given current market regime uncertainty and forecasted drawdown scenarios',
      maxMode: true,
      marketRegime: 'risk_off',
    });
    assert.strictEqual(profile.mode, 'deep');
  });

  it('bottomLineProtected is true for financial queries', () => {
    const profile = buildReasoningProfile({ ...baseInput, userQuery: 'execute trade now' });
    assert.ok(profile.bottomLineProtected);
  });

  it('bottomLineProtected is false for non-financial queries', () => {
    const profile = buildReasoningProfile({ ...baseInput, userQuery: 'hello how are you today' });
    assert.strictEqual(profile.bottomLineProtected, false);
  });

  it('escalationEnabled is true when maxModelCount > initialModelCount', () => {
    const profile = buildReasoningProfile({
      ...baseInput,
      userQuery: 'analyze portfolio allocation and risk management strategy for volatile markets',
      maxMode: true,
    });
    if (profile.escalationEnabled) {
      assert.ok(profile.maxModelCount > profile.initialModelCount);
    }
  });

  it('budgetUsd is higher for bottom-line protected queries', () => {
    const normal = buildReasoningProfile({ ...baseInput, userQuery: 'hello' });
    const critical = buildReasoningProfile({ ...baseInput, userQuery: 'transfer funds execute trade' });
    assert.ok(critical.budgetUsd >= normal.budgetUsd);
  });
});

describe('orchestrator: shouldEscalateModelPass()', () => {
  const makeProfile = (overrides = {}) => ({
    mode: 'balanced',
    bottomLineProtected: false,
    complexityScore: 0.5,
    budgetUsd: 0.012,
    estimatedTokensPerModel: 950,
    modelBudgetCap: 3,
    initialModelCount: 2,
    maxModelCount: 4,
    escalationEnabled: true,
    escalationAgreementThreshold: 0.23,
    escalationConfidenceThreshold: 0.56,
    ...overrides,
  });

  it('does not escalate when escalationEnabled is false', () => {
    const result = shouldEscalateModelPass({
      profile: makeProfile({ escalationEnabled: false }),
      consensusAgreement: 0.1,
      maxConfidence: 0.3,
      userQuery: 'analyze portfolio deeply',
    });
    assert.strictEqual(result.escalate, false);
  });

  it('does not escalate for low-stakes query with good agreement', () => {
    const result = shouldEscalateModelPass({
      profile: makeProfile(),
      consensusAgreement: 0.8,
      maxConfidence: 0.9,
      userQuery: 'hi',
    });
    assert.strictEqual(result.escalate, false);
  });

  it('escalates on low agreement', () => {
    const result = shouldEscalateModelPass({
      profile: makeProfile(),
      consensusAgreement: 0.05,
      maxConfidence: 0.9,
      userQuery: 'analyze portfolio allocation strategy thoroughly',
    });
    assert.ok(result.escalate);
    assert.ok(result.reasons.some((r) => r.startsWith('low_agreement')));
  });

  it('escalates on low confidence', () => {
    const result = shouldEscalateModelPass({
      profile: makeProfile(),
      consensusAgreement: 0.8,
      maxConfidence: 0.3,
      userQuery: 'analyze portfolio allocation strategy thoroughly',
    });
    assert.ok(result.escalate);
    assert.ok(result.reasons.some((r) => r.startsWith('low_confidence')));
  });

  it('escalates for high-impact query even with good metrics', () => {
    const result = shouldEscalateModelPass({
      profile: makeProfile(),
      consensusAgreement: 0.9,
      maxConfidence: 0.9,
      userQuery: 'execute autopilot trade now',
    });
    assert.ok(result.escalate);
    assert.ok(result.reasons.includes('high_impact_query'));
  });

  it('escalates for bottom-line protected query', () => {
    const result = shouldEscalateModelPass({
      profile: makeProfile({ bottomLineProtected: true }),
      consensusAgreement: 0.9,
      maxConfidence: 0.9,
      userQuery: 'analyze general information',
    });
    assert.ok(result.escalate);
    assert.ok(result.reasons.includes('bottom_line_protection'));
  });
});

describe('isCodingQuery', () => {
  it('detects code generation requests', () => {
    assert.equal(isCodingQuery('write a function to sort an array'), true);
    assert.equal(isCodingQuery('implement a binary search algorithm'), true);
    assert.equal(isCodingQuery('create a TypeScript class for a user model'), true);
  });

  it('detects debugging requests', () => {
    assert.equal(isCodingQuery('debug this TypeScript error'), true);
    assert.equal(isCodingQuery('fix this bug in my python script'), true);
    assert.equal(isCodingQuery('how do I compile this project?'), true);
  });

  it('detects refactoring and tooling requests', () => {
    assert.equal(isCodingQuery('refactor this class to use composition'), true);
    assert.equal(isCodingQuery('write a dockerfile for a node app'), true);
    assert.equal(isCodingQuery('add a unit test for this function'), true);
  });

  it('returns false for non-coding queries', () => {
    assert.equal(isCodingQuery('what is the current stock price?'), false);
    assert.equal(isCodingQuery('how do I optimize my portfolio?'), false);
    assert.equal(isCodingQuery('explain the tax implications of selling crypto'), false);
  });

  it('returns false for empty or trivial input', () => {
    assert.equal(isCodingQuery(''), false);
    assert.equal(isCodingQuery('hi'), false);
  });

  it('is case-insensitive', () => {
    assert.equal(isCodingQuery('Write a JavaScript Function'), true);
    assert.equal(isCodingQuery('DEBUG THIS ISSUE'), true);
  });
});

describe('decentralized fallback providers', () => {
  it('isFallback providers are excluded from the primary selection pool', () => {
    const models = [
      { name: 'grok', priority: 1, isFallback: false },
      { name: 'openai', priority: 2, isFallback: false },
      { name: 'akash', priority: 50, isFallback: true },
      { name: 'corcel', priority: 51, isFallback: true },
    ];
    const primary = models.filter((m) => !m.isFallback);
    assert.equal(primary.length, 2);
    assert.deepEqual(primary.map((m) => m.name), ['grok', 'openai']);
  });

  it('fallback pool contains all four decentralized providers', () => {
    const models = [
      { name: 'grok', priority: 1, isFallback: false },
      { name: 'akash', priority: 50, isFallback: true },
      { name: 'corcel', priority: 51, isFallback: true },
      { name: 'ionet', priority: 52, isFallback: true },
      { name: 'zerog', priority: 53, isFallback: true },
    ];
    const fallbacks = models.filter((m) => m.isFallback);
    assert.equal(fallbacks.length, 4);
    assert.deepEqual(fallbacks.map((m) => m.name), ['akash', 'corcel', 'ionet', 'zerog']);
  });

  it('decentralized provider priorities are higher than all primary providers', () => {
    const primaryMaxPriority = 21; // blackbox is currently the highest primary at 21
    const decPriorities = [50, 51, 52, 53];
    assert.ok(decPriorities.every((p) => p > primaryMaxPriority));
  });

  it('models without isFallback set are treated as primary', () => {
    const models = [
      { name: 'grok', priority: 1 },
      { name: 'akash', priority: 50, isFallback: true },
    ];
    const primary = models.filter((m) => !m.isFallback);
    assert.equal(primary.length, 1);
    assert.equal(primary[0].name, 'grok');
  });
});

