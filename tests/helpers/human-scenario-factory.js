'use strict';

const fs = require('fs');
const path = require('path');
const {
  hasSyntheticMarker,
  validateHumanProfile,
} = require('../../lib/frontend-human-data');

const PROFILE_FIXTURE_PATH = path.join(__dirname, '..', '..', 'data', 'human-frontend-profiles.json');

function loadHumanProfiles() {
  const raw = fs.readFileSync(PROFILE_FIXTURE_PATH, 'utf8');
  const profiles = JSON.parse(raw);
  if (!Array.isArray(profiles)) {
    throw new Error('human profile fixture must be an array');
  }
  return profiles;
}

function ensureValidProfile(profile) {
  const errors = validateHumanProfile(profile);
  if (errors.length > 0) {
    throw new Error(`invalid human profile ${profile?.id || 'unknown'}: ${errors.join('; ')}`);
  }
}

function buildPersonaPrompt(profile) {
  ensureValidProfile(profile);
  const primaryGoal = profile.goals[0];
  const secondaryGoal = profile.goals[1] || profile.goals[0];

  const prompt = [
    `I am ${profile.name}, a ${profile.occupation} in ${profile.region}.`,
    `My risk profile is ${profile.riskTolerance} and I prefer ${profile.timePreference} decision loops.`,
    `Help me prioritize ${primaryGoal} while still supporting ${secondaryGoal}.`,
    'Give me a practical next step with one measurable checkpoint.',
  ].join(' ');

  if (hasSyntheticMarker(prompt)) {
    throw new Error(`persona prompt contains synthetic markers for ${profile.id}`);
  }

  return prompt;
}

function buildPersonaChatHistory(profile, count = 4) {
  ensureValidProfile(profile);
  const history = [];
  for (let i = 0; i < count; i += 1) {
    if (i % 2 === 0) {
      history.push({
        role: 'user',
        text: `${profile.name} checkpoint ${i + 1}: focus on ${profile.goals[i % profile.goals.length]}`,
        ts: 1700000000000 + i,
      });
    } else {
      history.push({
        role: 'assistant',
        text: `Guidance for ${profile.name}: keep a ${profile.riskTolerance} plan and review ${profile.timePreference}.`,
        ts: 1700000000000 + i,
      });
    }
  }
  return history;
}

function buildSyncPayload(profile) {
  ensureValidProfile(profile);
  return {
    deviceId: `device-${profile.id}`,
    deltas: [
      {
        id: `delta-${profile.id}-1`,
        entity: 'userPreferences',
        op: 'upsert',
        payload: {
          name: profile.name,
          region: profile.region,
          riskTolerance: profile.riskTolerance,
          goals: profile.goals,
          timePreference: profile.timePreference,
        },
        ts: 1700000000000,
      },
    ],
    clock: {
      [`device-${profile.id}`]: 1,
    },
  };
}

function buildClawdPrompt(profile) {
  ensureValidProfile(profile);
  const prompt = `Draft a ${profile.timePreference} operating plan for ${profile.name} (${profile.occupation}) in ${profile.region} with ${profile.riskTolerance} risk posture and goals: ${profile.goals.join(', ')}.`;
  if (hasSyntheticMarker(prompt)) {
    throw new Error(`clawd prompt contains synthetic markers for ${profile.id}`);
  }
  return prompt;
}

module.exports = {
  loadHumanProfiles,
  ensureValidProfile,
  buildPersonaPrompt,
  buildPersonaChatHistory,
  buildSyncPayload,
  buildClawdPrompt,
};
