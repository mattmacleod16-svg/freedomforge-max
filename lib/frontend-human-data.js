'use strict';

const HUMAN_ONLY_TEXT_PATTERNS = [
  /\blorem ipsum\b/i,
  /\btest user\b/i,
  /\bdummy user\b/i,
  /\bfake user\b/i,
  /\bjohn doe\b/i,
  /\bjane doe\b/i,
  /\bsample user\b/i,
  /\bsynthetic user\b/i,
  /\bbot persona\b/i,
  /\bai-generated\b/i,
];

const VALID_RISK_TOLERANCE = new Set(['conservative', 'balanced', 'aggressive']);

function hasSyntheticMarker(input) {
  const value = String(input || '');
  return HUMAN_ONLY_TEXT_PATTERNS.some((pattern) => pattern.test(value));
}

function validateHumanProfile(profile) {
  const errors = [];

  if (!profile || typeof profile !== 'object') {
    return ['profile must be an object'];
  }

  const requiredStringFields = ['id', 'name', 'region', 'occupation', 'timePreference'];
  for (const field of requiredStringFields) {
    const value = profile[field];
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`${field} must be a non-empty string`);
      continue;
    }
    if (hasSyntheticMarker(value)) {
      errors.push(`${field} contains a synthetic placeholder marker`);
    }
  }

  if (!Array.isArray(profile.goals) || profile.goals.length === 0) {
    errors.push('goals must be a non-empty array');
  } else {
    for (const goal of profile.goals) {
      if (typeof goal !== 'string' || goal.trim() === '') {
        errors.push('goals must contain non-empty strings');
        continue;
      }
      if (hasSyntheticMarker(goal)) {
        errors.push('goals contains a synthetic placeholder marker');
      }
    }
  }

  if (!VALID_RISK_TOLERANCE.has(profile.riskTolerance)) {
    errors.push('riskTolerance must be conservative, balanced, or aggressive');
  }

  return errors;
}

function forgeUserPath(profile) {
  const firstGoal = Array.isArray(profile.goals) && profile.goals.length > 0 ? profile.goals[0] : 'Build momentum safely';
  const cadence = profile.timePreference || 'weekly';
  const risk = profile.riskTolerance || 'balanced';
  const intensity = risk === 'aggressive' ? 'high-conviction' : risk === 'conservative' ? 'capital-preserving' : 'adaptive';

  return [
    `${profile.name}: establish a personal operating baseline tied to ${firstGoal}`,
    `${profile.name}: activate a ${cadence} execution rhythm with ${intensity} guardrails`,
    `${profile.name}: run reflective checkpoints to refine strategy based on lived outcomes`,
    `${profile.name}: unlock a new compounding path by iterating one edge at a time`,
  ];
}

module.exports = {
  HUMAN_ONLY_TEXT_PATTERNS,
  hasSyntheticMarker,
  validateHumanProfile,
  forgeUserPath,
};
