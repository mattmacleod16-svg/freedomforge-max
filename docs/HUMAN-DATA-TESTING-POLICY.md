# Human Data Testing Policy

FreedomForge human-data testing is intentionally constrained for privacy and safety.

## Approved Data Sources

- Use anonymized, in-repo persona fixtures from `data/human-frontend-profiles.json`.
- Expand personas with realistic human context only (occupation, goals, risk tolerance, cadence).
- Reject synthetic placeholders (for example: lorem ipsum, test user, dummy user).

## Prohibited Data Sources

- Production user exports.
- Personally identifying records collected from live systems.
- Any dataset that requires external secrets or network access during tests.

## Test Execution Boundaries

- Human-data tests must run offline using local fixtures and deterministic factories.
- Backend human-data scenarios should validate contracts and normalization behavior without calling Railway, OpenRouter, OCI, or other live endpoints.
- Frontend persona scenarios should verify personalized behavior through mocks and local state only.

## Required Checks

- `npm test` must pass with backend and human-data contract suites.
- `npm run test:frontend` must pass with persona-driven frontend scenarios.
- New personas must pass `validateHumanProfile` and contain no synthetic markers.
