import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('interoperability routing bridge', () => {
  const originalCwd = process.cwd();
  let tempDir = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-skill-bridge-'));
    process.chdir(tempDir);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('resolves matched skills and aggregates model affinities for a query', async () => {
    const { registerSkill, resolveSkillRoutingContext } = await import('@/lib/intelligence/skillsMatrix');

    registerSkill({
      name: 'Solana Yield Strategy',
      domain: 'defi',
      subdomain: 'solana',
      description: 'Optimize SOL yield, staking, and Jupiter routing',
      modelAffinities: ['gemini', 'openai'],
      tags: ['solana', 'yield', 'staking'],
    });

    registerSkill({
      name: 'Risk Controls',
      domain: 'risk',
      description: 'Protect capital and manage downside risk',
      modelAffinities: ['claude'],
      tags: ['risk', 'drawdown'],
    });

    const resolved = resolveSkillRoutingContext('Build a Solana yield and staking plan', { limit: 4, gapLimit: 4 });

    expect(resolved.matchedSkills.length).toBeGreaterThan(0);
    expect(resolved.matchedSkills[0]?.domain).toBe('defi');
    expect(resolved.inferredDomains).toContain('defi');
    expect(resolved.rankedModelAffinities[0]).toBe('gemini');
  });

  it('boosts champion routing toward skill and language preferences', async () => {
    const { selectChampionChallengerRouting } = await import('@/lib/intelligence/championPolicy');

    const routing = selectChampionChallengerRouting({
      availableModels: ['openai', 'claude', 'gemini'],
      regime: 'neutral',
      forecastBrierScore: 0.15,
      forecastConfidence: 0.7,
      marketConfidence: 0.7,
      skillAffinityModels: ['gemini'],
      detectedLanguage: 'es',
      languagePreferredModels: ['gemini', 'openai'],
    });

    expect(routing.preferredModels[0]).toBe('gemini');
    expect(routing.rationale).toContain('skill_affinities=gemini');
    expect(routing.rationale).toContain('detected_language=es');
  });

  it('detects non-english input while preserving english-first response policy assumptions', async () => {
    const { detectLanguage, getModelForLanguage } = await import('@/lib/intelligence/limitlessGrowth');

    const detected = detectLanguage('hola, necesito ayuda con mi portafolio y riesgo');
    const preferredModels = getModelForLanguage(detected.code);

    expect(detected.code).toBe('es');
    expect(preferredModels.length).toBeGreaterThan(0);
    expect(preferredModels.map((model) => model.toLowerCase())).toContain('openai');
  });
});