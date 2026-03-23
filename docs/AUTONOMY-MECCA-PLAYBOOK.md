# FreedomForge Autonomy Mecca Playbook

This playbook defines what "mecca of autonomous intelligence" means in operational terms: measurable capability, safety, and compounding user outcomes.

## North Star

FreedomForge is mecca-ready when it can:
- Think across multiple models and strategies.
- Act with risk-bounded autonomy.
- Learn continuously from outcomes.
- Personalize strategy paths for real humans.
- Self-heal and remain reliable under stress.

## Five Pillars

1. Core Autonomy
- Multi-agent orchestration and autonomous maintenance must be active and testable.
- Required scripts: self-heal, autonomy maintenance, orchestrator, continuous learning.

2. Safety and Governance
- Risk controls are mandatory: VaR, risk manager, circuit breakers, and authenticated control surfaces.
- No autonomy mode is valid without hard stop mechanisms.

3. Frontend Human Outcomes
- User-facing intelligence must be grounded in human-first data.
- Synthetic placeholder personas are prohibited in frontend pathways.
- Each user must receive a distinct growth path.

4. Operational Intelligence
- Runtime policy tuning and patching workflows must exist.
- Ops patch generation, preview/notification, and controlled apply paths must remain healthy.

5. Verification Discipline
- Core and human-data tests must run by default.
- Mecca maturity itself must be tested and enforceable.

## Scoring and Enforcement

Use the mecca audit command:

- npm run autonomy:mecca

Scoring model:
- 100-point weighted score across five pillars.
- Default passing threshold: 85.
- Override via AUTONOMY_MECCA_MIN_SCORE.

Interpretation:
- 90-100: elite autonomous reliability and compounding potential.
- 85-89: production-ready autonomy with clear upgrade path.
- 70-84: functional autonomy, needs strategic hardening.
- <70: not mecca-ready; ship blockers exist.

## Compounding Roadmap

Phase 1: Reliability Engine
- Keep mecca score above threshold in every PR.
- Expand fault-injection tests for self-heal and recovery loops.

Phase 2: Human Differentiation
- Add persona-specific UX snapshots and journey benchmarks.
- Track user outcomes by intent cluster, not only engagement.

Phase 3: Adaptive Strategy Graph
- Route users into evolving strategy paths from validated outcomes.
- Promote winning paths and retire weak paths automatically.

Phase 4: Autonomous Governance
- Add policy simulation before real policy activation.
- Require explainable change summaries for all autonomous policy shifts.
