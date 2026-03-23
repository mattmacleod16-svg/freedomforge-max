'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateAutonomyMecca,
  formatReport,
} = require('../scripts/autonomy-mecca-audit');

describe('autonomy mecca readiness', () => {
  it('should remain above minimum maturity threshold', () => {
    const result = evaluateAutonomyMecca();
    assert.ok(
      result.score >= result.threshold,
      `autonomy mecca score is below threshold\n${formatReport(result)}`
    );
  });

  it('should have no zeroed categories', () => {
    const result = evaluateAutonomyMecca();
    const zeroed = result.categories.filter((c) => c.earnedPoints === 0).map((c) => c.name);
    assert.deepStrictEqual(zeroed, [], `zeroed autonomy categories: ${zeroed.join(', ')}`);
  });
});
