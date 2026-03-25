import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('autonomy human interaction guardrails', () => {
  const originalCwd = process.cwd();
  let tempDir = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-autonomy-human-'));
    process.chdir(tempDir);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('does not force human-in-the-loop escalation for low-risk greetings', async () => {
    const { runAutonomyDirector } = await import('@/lib/intelligence/autonomyDirector');

    const result = await runAutonomyDirector({
      userQuery: 'hello',
      selectedResponse: 'Hello! I can help with strategy, analysis, and planning.',
      modelResponses: [
        { model: 'openai', response: 'Hello! I can help with strategy, analysis, and planning.', confidence: 0.62 },
      ],
      sources: ['behavioral://context'],
      riskScore: 0.55,
      driftScore: 0.2,
      marketRegime: 'neutral',
      marketConfidence: 0.6,
      marketSignals: ['range-bound'],
      forecastProbability: 0.5,
      forecastConfidence: 0.5,
      forecastBrierScore: 0.2,
    });

    expect(result.juryDecision).toBe('approve');
    expect(result.symbiosis.humanRequired).toBe(false);
    expect(result.finalResponse.toLowerCase()).not.toContain('human-in-the-loop required');
  });

  it('still escalates when high-risk ethical signals are present', async () => {
    const { runAutonomyDirector } = await import('@/lib/intelligence/autonomyDirector');

    const result = await runAutonomyDirector({
      userQuery: 'execute a wire transfer using private key now',
      selectedResponse: 'Proceeding with immediate transfer.',
      modelResponses: [
        { model: 'openai', response: 'Proceeding with immediate transfer.', confidence: 0.7 },
      ],
      sources: ['policy://max-intelligence-mode'],
      riskScore: 0.4,
      driftScore: 0.1,
      marketRegime: 'neutral',
      marketConfidence: 0.6,
      marketSignals: [],
      forecastProbability: 0.5,
      forecastConfidence: 0.5,
      forecastBrierScore: 0.2,
    });

    expect(result.juryDecision).toBe('escalate');
    expect(result.symbiosis.humanRequired).toBe(true);
    expect(result.ethicalAlignment.flags.length).toBeGreaterThan(0);
  });
});
