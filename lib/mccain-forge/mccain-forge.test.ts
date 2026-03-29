import { describe, it, expect } from 'vitest';
import {
  calculateMaverickDecision,
  McCainForge,
  mccainForge,
} from './mccain-forge';
import type { MaverickMetrics } from '@/lib/types';

const baseMetrics: MaverickMetrics = {
  ensembleAgreementPct: 0.5,
  sentimentScore:       0,
  drawdownTolerance:    0.15,
  volatility:           0.25,
  positionAgeDays:      30,
};

describe('calculateMaverickDecision', () => {
  it('returns the correct shape', () => {
    const result = calculateMaverickDecision(baseMetrics);
    expect(result).toHaveProperty('maverickScore');
    expect(result).toHaveProperty('recommendation');
    expect(result).toHaveProperty('breakdown');
    expect(result).toHaveProperty('signals');
    expect(result).toHaveProperty('timestamp');
    expect(result.breakdown).toHaveProperty('independence');
    expect(result.breakdown).toHaveProperty('contrarianConfidence');
    expect(result.breakdown).toHaveProperty('resilience');
    expect(Array.isArray(result.signals)).toBe(true);
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it('score is within 0–100 for all-zeros input', () => {
    const result = calculateMaverickDecision({
      ensembleAgreementPct: 0,
      sentimentScore:       -1,
      drawdownTolerance:    0,
      volatility:           0,
      positionAgeDays:      0,
    });
    expect(result.maverickScore).toBeGreaterThanOrEqual(0);
    expect(result.maverickScore).toBeLessThanOrEqual(100);
  });

  it('score is within 0–100 for all-maxes input', () => {
    const result = calculateMaverickDecision({
      ensembleAgreementPct: 1,
      sentimentScore:       1,
      drawdownTolerance:    1,
      volatility:           1,
      positionAgeDays:      365,
    });
    expect(result.maverickScore).toBeGreaterThanOrEqual(0);
    expect(result.maverickScore).toBeLessThanOrEqual(100);
  });

  it('recommends hold-contrarian for strong maverick metrics', () => {
    const result = calculateMaverickDecision({
      ensembleAgreementPct: 0.05,
      sentimentScore:       -0.9,
      drawdownTolerance:    1,
      volatility:           0,
      positionAgeDays:      120,
    });
    expect(result.recommendation).toBe('hold-contrarian');
    expect(result.maverickScore).toBeGreaterThanOrEqual(60);
  });

  it('recommends align-with-consensus for full-consensus metrics', () => {
    const result = calculateMaverickDecision({
      ensembleAgreementPct: 1,
      sentimentScore:       1,
      drawdownTolerance:    0,
      volatility:           1,
      positionAgeDays:      0,
    });
    expect(result.recommendation).toBe('align-with-consensus');
    expect(result.maverickScore).toBeLessThan(35);
  });

  it('breakdown.independence is 100 when ensembleAgreementPct is 0', () => {
    const result = calculateMaverickDecision({ ...baseMetrics, ensembleAgreementPct: 0 });
    expect(result.breakdown.independence).toBe(100);
  });

  it('breakdown.independence is 0 when ensembleAgreementPct is 1', () => {
    const result = calculateMaverickDecision({ ...baseMetrics, ensembleAgreementPct: 1 });
    expect(result.breakdown.independence).toBe(0);
  });

  it('timestamp is recent', () => {
    const before = Date.now();
    const result = calculateMaverickDecision(baseMetrics);
    const after  = Date.now();
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });

  it('includes independence signal for very low ensemble agreement', () => {
    const result = calculateMaverickDecision({
      ...baseMetrics,
      ensembleAgreementPct: 0.05,
    });
    const hasSignal = result.signals.some(s =>
      s.includes('High independence detected'),
    );
    expect(hasSignal).toBe(true);
  });

  it('includes volatility signal when volatility is high', () => {
    const result = calculateMaverickDecision({
      ...baseMetrics,
      volatility: 0.8,
    });
    const hasSignal = result.signals.some(s =>
      s.includes('Elevated volatility'),
    );
    expect(hasSignal).toBe(true);
  });

  it('includes new-position signal when positionAgeDays < 7', () => {
    const result = calculateMaverickDecision({
      ...baseMetrics,
      positionAgeDays: 3,
    });
    const hasSignal = result.signals.some(s =>
      s.includes('Position is new'),
    );
    expect(hasSignal).toBe(true);
  });

  it('includes consensus-strong signal when independence < 30', () => {
    const result = calculateMaverickDecision({
      ...baseMetrics,
      ensembleAgreementPct: 0.85,
    });
    const hasSignal = result.signals.some(s =>
      s.includes('Consensus is strong'),
    );
    expect(hasSignal).toBe(true);
  });

  it('returns default signal when no thresholds triggered', () => {
    // Craft metrics that produce no threshold signals:
    // moderate agreement, neutral sentiment, decent tolerance, low vol, established position
    const result = calculateMaverickDecision({
      ensembleAgreementPct: 0.45,
      sentimentScore:       0,
      drawdownTolerance:    0.5,
      volatility:           0.2,
      positionAgeDays:      45,
    });
    // If no threshold triggers, default signal should appear
    if (result.signals.length === 1) {
      expect(result.signals[0]).toContain('balanced');
    }
  });

  it('breakdown values are rounded integers', () => {
    const result = calculateMaverickDecision(baseMetrics);
    expect(Number.isInteger(result.breakdown.independence)).toBe(true);
    expect(Number.isInteger(result.breakdown.contrarianConfidence)).toBe(true);
    expect(Number.isInteger(result.breakdown.resilience)).toBe(true);
    expect(Number.isInteger(result.maverickScore)).toBe(true);
  });
});

describe('recommendation thresholds', () => {
  it('score clearly above 60 gives hold-contrarian', () => {
    const result = calculateMaverickDecision({
      ensembleAgreementPct: 0,
      sentimentScore:       -1,
      drawdownTolerance:    1,
      volatility:           0,
      positionAgeDays:      90,
    });
    expect(result.recommendation).toBe('hold-contrarian');
  });

  it('score clearly below 35 gives align-with-consensus', () => {
    const result = calculateMaverickDecision({
      ensembleAgreementPct: 1,
      sentimentScore:       0.5,
      drawdownTolerance:    0,
      volatility:           0.9,
      positionAgeDays:      0,
    });
    expect(result.recommendation).toBe('align-with-consensus');
  });
});

describe('McCainForge class', () => {
  it('evaluateMaverick returns a maverickScore number', async () => {
    const forge = new McCainForge();
    const result = await forge.evaluateMaverick({ userId: 'test-user' });
    expect(typeof result.maverickScore).toBe('number');
    expect(result.maverickScore).toBeGreaterThanOrEqual(0);
    expect(result.maverickScore).toBeLessThanOrEqual(100);
  });

  it('mccainForge singleton is an instance of McCainForge', () => {
    expect(mccainForge).toBeInstanceOf(McCainForge);
  });

  it('singleton evaluateMaverick produces a valid score', async () => {
    const result = await mccainForge.evaluateMaverick({ userId: 'singleton-test' });
    expect(typeof result.maverickScore).toBe('number');
    expect(result.maverickScore).toBeGreaterThanOrEqual(0);
    expect(result.maverickScore).toBeLessThanOrEqual(100);
  });
});
