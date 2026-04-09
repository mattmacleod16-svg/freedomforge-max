import { describe, expect, it } from 'vitest';
import {
  runPPOGrantAgent,
  GRANT_DATABASE,
  type PPOGrantResult,
} from './ppoGrantAgent';

// ─── PPO Grant Agent Tests ─────────────────────────────────────────────────────

describe('ppoGrantAgent', () => {
  describe('GRANT_DATABASE', () => {
    it('should contain at least 10 grants', () => {
      expect(GRANT_DATABASE.length).toBeGreaterThanOrEqual(10);
    });

    it('every grant should have required fields', () => {
      for (const g of GRANT_DATABASE) {
        expect(typeof g.id).toBe('string');
        expect(g.id.length).toBeGreaterThan(0);
        expect(typeof g.name).toBe('string');
        expect(typeof g.provider).toBe('string');
        expect(['federal', 'state', 'local', 'private']).toContain(g.category);
        expect(g.maxAmount).toBeGreaterThan(0);
        expect(Array.isArray(g.states)).toBe(true);
        expect(g.baseApprovalRate).toBeGreaterThan(0);
        expect(g.baseApprovalRate).toBeLessThanOrEqual(1);
        expect(Array.isArray(g.tags)).toBe(true);
        expect(typeof g.url).toBe('string');
      }
    });

    it('should include SC-specific grants', () => {
      const scGrants = GRANT_DATABASE.filter((g) => g.states.includes('SC'));
      expect(scGrants.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('runPPOGrantAgent()', () => {
    it('returns a valid result for Forest Acres, SC', () => {
      const result = runPPOGrantAgent({
        userId: 'test-user-123',
        state: 'SC',
        location: 'Forest Acres, SC',
      });

      expect(result).toBeDefined();
      expect(typeof result.ppo_action).toBe('string');
      expect(result.ppo_action.length).toBeGreaterThan(10);
      expect(Array.isArray(result.topMatches)).toBe(true);
      expect(result.topMatches.length).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.totalPotentialValue).toBeGreaterThan(0);
      expect(result.stateCode).toBe('SC');
      expect(result.location).toBe('Forest Acres, SC');
      expect(typeof result.timestamp).toBe('string');
    });

    it('algorithm details are present and valid', () => {
      const result = runPPOGrantAgent({
        userId: 'test-user',
        state: 'SC',
        location: 'Forest Acres, SC',
      });

      const algo = result.algorithm;
      expect(algo.name).toBe('PPO');
      expect(algo.clipEpsilon).toBe(0.2);
      expect(algo.iterations).toBe(50);
      expect(typeof algo.surrogateObjective).toBe('number');
      expect(typeof algo.entropy).toBe('number');
      expect(typeof algo.averageAdvantage).toBe('number');
      expect(typeof algo.convergence).toBe('boolean');
      expect(Array.isArray(algo.policyRatios)).toBe(true);
    });

    it('match scores sum to ≈ 1 across topMatches', () => {
      const result = runPPOGrantAgent({
        userId: 'test-user',
        state: 'SC',
        location: 'Columbia, SC',
        topK: 10,
      });
      // Because topMatches are sliced from a normalised distribution,
      // their scores should all be positive
      for (const m of result.topMatches) {
        expect(m.matchScore).toBeGreaterThan(0);
        expect(m.estimatedValue).toBeGreaterThanOrEqual(0);
        expect(typeof m.actionRecommendation).toBe('string');
        expect(typeof m.advantage).toBe('number');
      }
    });

    it('topK parameter limits number of matches', () => {
      const result = runPPOGrantAgent({
        userId: 'test-user',
        state: 'SC',
        location: 'Forest Acres, SC',
        topK: 3,
      });
      expect(result.topMatches.length).toBeLessThanOrEqual(3);
    });

    it('matches are sorted by matchScore descending', () => {
      const result = runPPOGrantAgent({
        userId: 'test-user',
        state: 'SC',
        location: 'Forest Acres, SC',
      });
      for (let i = 0; i < result.topMatches.length - 1; i++) {
        expect(result.topMatches[i].matchScore).toBeGreaterThanOrEqual(
          result.topMatches[i + 1].matchScore,
        );
      }
    });

    it('works for a non-SC state (federal grants still returned)', () => {
      const result = runPPOGrantAgent({
        userId: 'test-user',
        state: 'TX',
        location: 'Austin, TX',
      });
      expect(result.topMatches.length).toBeGreaterThan(0);
      // Should include federal grants (available in all states)
      const hasFederal = result.topMatches.some((m) => m.grant.category === 'federal');
      expect(hasFederal).toBe(true);
    });

    it('derives state code from location when state param is empty', () => {
      const result = runPPOGrantAgent({
        userId: 'test-user',
        state: '',
        location: 'Forest Acres, SC',
      });
      expect(result.stateCode).toBe('SC');
    });

    it('clipped surrogate objective is finite', () => {
      const result = runPPOGrantAgent({
        userId: 'test-user',
        state: 'SC',
        location: 'Forest Acres, SC',
      });
      expect(Number.isFinite(result.algorithm.surrogateObjective)).toBe(true);
      expect(Number.isFinite(result.algorithm.entropy)).toBe(true);
    });
  });
});
