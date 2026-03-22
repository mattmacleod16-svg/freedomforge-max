# FreedomForge — Copilot Instructions

> These instructions apply to **every** Copilot agent, sub-agent, and custom bot operating within the FreedomForge repository. They are automatically loaded before any agent-specific instructions.

---

## Prime Directive

**The superagent must never stop generating revenue.** Every change, refactor, deployment, or fix must preserve revenue continuity. If in doubt, do not break what's working.

---

## Project Identity

- **Name**: FreedomForge
- **Type**: Autonomous AI-powered trading & revenue generation platform
- **Stack**: Next.js 16 (TypeScript/React 19), Node.js, Ethers.js v5+v6, Capacitor (iOS), Prometheus/Grafana
- **Repo**: `mattmacleod16-svg/freedomforge-max`
- **Deployments**: Vercel (primary), Railway (secondary), Oracle Cloud VMs

---

## Canonical Configuration Values

All agents MUST reference these as the single source of truth. If code defaults differ, the code is wrong — file an issue or fix it.

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `PREDICTION_MIN_EDGE_FOR_ACTION` | `0.24` | Minimum edge to execute a prediction trade |
| `PREDICTION_MIN_RELIABILITY_FOR_ACTION` | `0.64` | Minimum confidence floor |
| `PREDICTION_CALIBRATION_GUARD_BRIER` | `0.21` | Calibration quality guard |
| `SELF_SUSTAIN_REINVEST_BPS` | `2000` | Reinvestment rate (20%) |
| `GAS_RESERVE_ETH` | `0.02` | Minimum gas reserve in wallet |
| `SUPERVISOR_CHECK_MS` | `30000` | Agent health check interval |
| `MAX_INTELLIGENCE_MODE` | `true` | High-rigor ensemble mode |
| `AUTONOMY_MAX_MODE` | `true` | Maximum autonomy |

---

## State Files (Shared Truth)

All agents reading or writing these files MUST follow the access rules:

| File | Purpose | Access |
|------|---------|--------|
| `data/agent-signal-bus.json` | Cross-agent signals & consensus | Read/Write (use `lib/resilient-io.js` for atomic writes) |
| `data/kill-switch.json` | Emergency halt state | Read/Write (Commander authority required to activate) |
| `data/trade-journal.json` | Trade execution history | Write: trading engines only. Read: all agents |
| `data/treasury-ledger.json` | Revenue ledger | Write: distribution scripts only. Read: all agents |
| `data/prediction-market-state.json` | Active prediction positions | Write: prediction engines. Read: all agents |
| `data/autonomy-state.json` | AI autonomy director state | Write: autonomy director. Read: all agents |
| `data/episodic-memory.json` | Episodic memory store | Write: memory bridge. Read: all agents |
| `data/events.log` | JSONL audit trail | Append-only. Never truncate without archiving |
| `data/recovery-controller-state.json` | Recovery state | Write: recovery controller. Read: all agents |
| `data/liquidation-guardian-state.json` | Liquidation risk state | Write: liquidation guardian. Read: all agents |

**Multi-writer rule**: Any file with multiple writers MUST use `lib/resilient-io.js` for atomic file operations. Never use raw `fs.writeFileSync` on shared state.

---

## Operational Cadence

All agents must be aware of and respect this schedule:

| Interval | Operation | Owner |
|----------|-----------|-------|
| Every 5 min | Self-heal cycle | `scripts/self-heal.js` |
| Every 15 min | Horizontal distribution | `distribute-horizontal.yml` |
| Hourly | Ensemble policy tuning | `ensemble-policy-tuner.yml` |
| Every 4 hours | Revenue distribution (Fridays) | `distribute.yml` |
| Daily | Health snapshot, KPI report, agent proofs | Multiple scripts |
| Weekly | Policy review, summary | `weekly-policy-review.yml` |
| Monthly | Strategy review, ops patches | `monthly-strategy.yml` |

---

## Security Rules (Non-Negotiable)

1. **Never** hardcode API keys, private keys, mnemonics, or passwords in source files
2. **Never** commit `.env.local`, `.env.vercel.*`, or any file containing real credentials
3. **Always** use `process.env.VARIABLE_NAME` for secrets — never string literals
4. **Always** use `lib/resilient-io.js` for atomic writes to shared state files
5. **Never** log sensitive values — redact wallet addresses, keys, and tokens in output
6. **Always** respect the kill switch — check `data/kill-switch.json` before trading operations

---

## Code Standards

- **Logger**: Use `lib/logger.js` — never `console.log/warn/error` in production code
- **Error handling**: All async functions must have try/catch with structured error logging
- **Module loading**: Use the defensive `try { mod = require('./module'); } catch { mod = null; }` pattern for optional dependencies only
- **File I/O**: Use `lib/resilient-io.js` for any file that may be read by other processes
- **Testing**: Run `npm test` before committing. Use Node.js built-in `node --test`
- **Types**: TypeScript preferred for new modules. Add JSDoc to existing JS files

---

## Agent Hierarchy

```
FreedomForge Commander (supreme authority)
├── FF-SentinelWatch   (cross-system oversight & anomaly detection)
├── FF-Security        (credentials, secrets, access control)
├── FF-TradingOps      (trading engines, revenue, predictions)
├── FF-Infrastructure  (CI/CD, logs, deployments, monitoring)
├── FF-CodeQuality     (refactoring, lint, tech debt)
└── FF-TestCoverage    (tests, coverage, quality assurance)
```

**Escalation path**: Any bot → FF-SentinelWatch (for cross-system issues) → Commander (for decisions requiring authority)

**Conflict resolution**: If two bots disagree, Commander decides. If Commander is unavailable, FF-SentinelWatch has interim authority for read-only operations.

---

## Key Architecture Modules

Every agent should know these exist. Do not modify them without understanding their role:

| Module | Role | Critical? |
|--------|------|-----------|
| `lib/agent-supervisor.js` | Auto-restart dead agents, backoff, circuit breakers | 🔴 YES |
| `lib/heartbeat-registry.js` | Agent health pulse monitoring | 🔴 YES |
| `lib/agent-signal-bus.js` | Cross-agent messaging and consensus | 🔴 YES |
| `lib/event-mesh.js` | Pub/sub backbone for agent communication | 🔴 YES |
| `lib/consensus-engine.js` | Jury-based voting/approval system | 🔴 YES |
| `lib/memory-bridge.js` | Episodic memory across agents | 🟡 IMPORTANT |
| `lib/resilient-io.js` | Atomic file I/O with backup rotation | 🔴 YES |
| `lib/circuit-breaker.js` | Position size limits | 🔴 YES |
| `lib/drawdown-circuit-breaker.js` | Max drawdown protection | 🔴 YES |
| `lib/smart-order-router.js` | Optimal order routing across venues | 🔴 YES |
| `lib/risk-manager.js` | Risk assessment and scoring | 🔴 YES |
| `lib/models/modelOrchestrator.ts` | Multi-model AI routing | 🟡 IMPORTANT |
| `lib/intelligence/autonomyDirector.ts` | Autonomy system director | 🟡 IMPORTANT |

---

## How to Add a New Agent

1. Create `.github/agents/<agent-name>.agent.md` with YAML frontmatter (`name`, `description`)
2. Reference this file (`copilot-instructions.md`) as the governance layer — do not duplicate rules
3. Define the agent's **specific** responsibilities (what it does that no other agent does)
4. Add inter-agent coordination section listing which bots it works with and how
5. Add the agent to the hierarchy table in this file
6. Add the agent to the Commander's fleet roster in `freedomforge-commander.agent.md`
7. Commit with descriptive message and `Co-authored-by: Copilot` trailer
