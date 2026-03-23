'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { evaluateUnison, formatResult } = require('../scripts/unison-sync-audit');
const { runCleanup } = require('../scripts/unison-clean-stale-data');

describe('unison audit and cleanup', () => {
  it('should keep repository above unison threshold', () => {
    const result = evaluateUnison();
    assert.ok(result.score >= result.threshold, `unison score below threshold\n${formatResult(result)}`);
  });

  it('should not have empty core categories', () => {
    const result = evaluateUnison();
    const empty = result.categories.filter((c) => c.earned === 0).map((c) => c.name);
    assert.deepStrictEqual(empty, [], `empty unison categories: ${empty.join(', ')}`);
  });

  it('should execute stale-data cleanup in dry-run mode without errors', () => {
    const result = runCleanup({ apply: false });
    assert.equal(typeof result.actionCount, 'number');
    assert.ok(Array.isArray(result.actions));
  });
});
