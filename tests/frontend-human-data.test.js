'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  HUMAN_ONLY_TEXT_PATTERNS,
  hasSyntheticMarker,
  validateHumanProfile,
  forgeUserPath,
} = require('../lib/frontend-human-data');
const {
  buildPersonaPrompt,
  buildPersonaChatHistory,
} = require('./helpers/human-scenario-factory');

const REPO_ROOT = path.join(__dirname, '..');
const PROFILE_FIXTURE_PATH = path.join(REPO_ROOT, 'data', 'human-frontend-profiles.json');
const FRONTEND_DIR = path.join(REPO_ROOT, 'app');

function walkFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, out);
      continue;
    }
    out.push(fullPath);
  }
  return out;
}

describe('frontend human-data contract', () => {
  it('should validate all human profile fixtures', () => {
    const raw = fs.readFileSync(PROFILE_FIXTURE_PATH, 'utf8');
    const profiles = JSON.parse(raw);

    assert.ok(Array.isArray(profiles), 'profile fixture must be an array');
    assert.ok(profiles.length >= 3, 'profile fixture should contain multiple real users');

    for (const profile of profiles) {
      const errors = validateHumanProfile(profile);
      assert.deepStrictEqual(errors, [], `invalid profile ${profile.id}: ${errors.join('; ')}`);
    }
  });

  it('should forge a distinct growth path for each user', () => {
    const profiles = JSON.parse(fs.readFileSync(PROFILE_FIXTURE_PATH, 'utf8'));
    const pathSignatures = new Set();

    for (const profile of profiles) {
      const userPath = forgeUserPath(profile);
      assert.ok(Array.isArray(userPath), 'forged path should be an array');
      assert.ok(userPath.length >= 4, 'forged path should contain at least 4 steps');
      assert.ok(userPath.every((step) => typeof step === 'string' && step.includes(profile.name)), 'each step should be personalized with the user name');

      const signature = userPath.join(' | ');
      assert.ok(!pathSignatures.has(signature), `duplicate forged path detected for ${profile.id}`);
      pathSignatures.add(signature);
    }
  });

  it('should fail synthetic placeholder content in frontend source', () => {
    const files = walkFiles(FRONTEND_DIR).filter((filePath) => /\.(ts|tsx|js|jsx|mdx)$/.test(filePath));
    const violations = [];

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const pattern of HUMAN_ONLY_TEXT_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`${path.relative(REPO_ROOT, filePath)} matched ${pattern}`);
        }
      }
    }

    assert.deepStrictEqual(violations, [], `synthetic placeholders found in frontend source:\n${violations.join('\n')}`);
  });

  it('should detect synthetic values at validator level', () => {
    assert.equal(hasSyntheticMarker('lorem ipsum profile'), true);
    assert.equal(hasSyntheticMarker('Maya Thompson'), false);
  });

  it('should cover conservative, balanced, and aggressive risk tiers', () => {
    const profiles = JSON.parse(fs.readFileSync(PROFILE_FIXTURE_PATH, 'utf8'));
    const riskSet = new Set(profiles.map((profile) => profile.riskTolerance));
    const idSet = new Set(profiles.map((profile) => profile.id));

    assert.deepStrictEqual(riskSet, new Set(['conservative', 'balanced', 'aggressive']));
    assert.equal(idSet.size, profiles.length, 'profile ids must remain unique');
  });

  it('should generate synthetic-free persona prompts and histories', () => {
    const profiles = JSON.parse(fs.readFileSync(PROFILE_FIXTURE_PATH, 'utf8'));

    for (const profile of profiles) {
      const prompt = buildPersonaPrompt(profile);
      const history = buildPersonaChatHistory(profile, 6);

      assert.equal(hasSyntheticMarker(prompt), false, `prompt contains synthetic marker for ${profile.id}`);
      assert.equal(history.length, 6, 'history generation should honor requested length');
      assert.ok(history.every((entry) => typeof entry.text === 'string' && entry.text.includes(profile.name)));
      assert.ok(history.some((entry) => entry.text.includes(profile.riskTolerance)));
    }
  });
});
