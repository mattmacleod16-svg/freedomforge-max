'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { evaluateCollectiveConsciousness } = require('../scripts/collective-consciousness-audit');

describe('collective consciousness readiness', () => {
  it('should meet the collective readiness threshold', () => {
    const result = evaluateCollectiveConsciousness();
    assert.ok(
      result.score >= result.threshold,
      `collective score ${result.score} is below threshold ${result.threshold}`
    );
  });

  it('should keep all collective dimensions above zero', () => {
    const result = evaluateCollectiveConsciousness();
    for (const category of result.categories) {
      assert.ok(category.earned > 0, `${category.name} has zero earned points`);
    }
  });
});
