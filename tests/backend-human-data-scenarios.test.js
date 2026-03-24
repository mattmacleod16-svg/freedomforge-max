'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { validateHumanProfile } = require('../lib/frontend-human-data');
const {
  loadHumanProfiles,
  buildSyncPayload,
  buildClawdPrompt,
  buildPersonaChatHistory,
  buildPersonaPrompt,
} = require('./helpers/human-scenario-factory');

describe('backend human-data scenarios', () => {
  it('builds offline sync payloads that match route contracts', () => {
    const profiles = loadHumanProfiles();

    for (const profile of profiles) {
      const payload = buildSyncPayload(profile);

      assert.ok(typeof payload.deviceId === 'string' && payload.deviceId.length > 0);
      assert.ok(Array.isArray(payload.deltas) && payload.deltas.length > 0);
      assert.ok(payload.clock && typeof payload.clock === 'object');

      for (const delta of payload.deltas) {
        assert.ok(typeof delta.id === 'string' && delta.id.length > 0);
        assert.ok(typeof delta.entity === 'string' && delta.entity.length > 0);
        assert.ok(typeof delta.op === 'string' && delta.op.length > 0);
        assert.ok(delta.payload && typeof delta.payload === 'object');
        assert.ok(Array.isArray(delta.payload.goals) && delta.payload.goals.length > 0);
      }
    }
  });

  it('builds clawd prompts that are human-specific and safe', () => {
    const profiles = loadHumanProfiles();
    const prompts = new Set();

    for (const profile of profiles) {
      const prompt = buildClawdPrompt(profile);
      assert.ok(prompt.includes(profile.name));
      assert.ok(prompt.includes(profile.riskTolerance));
      assert.ok(prompt.length > 60);
      assert.ok(!prompts.has(prompt), `duplicate backend prompt for ${profile.id}`);
      prompts.add(prompt);
    }
  });

  it('keeps generated backend history coherent with persona profile', () => {
    const profiles = loadHumanProfiles();

    for (const profile of profiles) {
      const history = buildPersonaChatHistory(profile, 6);
      assert.equal(history.length, 6);
      assert.ok(history.every((entry) => entry.text.includes(profile.name)));
      assert.ok(history.some((entry) => entry.text.includes(profile.riskTolerance)));
    }
  });

  it('rejects malformed persona data before scenario generation', () => {
    const invalid = {
      id: 'bad-profile',
      name: 'Test User',
      region: '',
      occupation: '',
      goals: [],
      riskTolerance: 'extreme',
      timePreference: '',
    };

    const errors = validateHumanProfile(invalid);
    assert.ok(errors.length > 0);
  });

  it('ensures frontend and backend prompts remain aligned per persona', () => {
    const profiles = loadHumanProfiles();

    for (const profile of profiles) {
      const frontendPrompt = buildPersonaPrompt(profile);
      const backendPrompt = buildClawdPrompt(profile);

      assert.ok(frontendPrompt.includes(profile.name));
      assert.ok(backendPrompt.includes(profile.name));
      assert.ok(frontendPrompt.includes(profile.riskTolerance));
      assert.ok(backendPrompt.includes(profile.riskTolerance));
    }
  });
});
