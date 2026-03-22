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

## Agent Credit Lines

Every agent in the fleet has an **independent credit line** — a self-managed budget for AI queries, API calls, compute, and operational spend. This enables autonomous decision-making without bottlenecking on Commander approval for routine resource consumption.

### Credit Line Architecture

The FreedomForge credit system is powered by `lib/intelligence/apiCreditMonitor.ts` (tracking) and `lib/intelligence/apiCreditAutoFunder.ts` (auto-scaling). Each agent taps into this infrastructure with its own allocation.

| Agent | Credit Tier | Per-Query Budget | Daily Ceiling | Auto-Scale |
|-------|-------------|-----------------|---------------|------------|
| **Commander** | Unlimited | `AI_CRITICAL_QUERY_BUDGET_USD` | No limit | N/A |
| **FF-TradingOps** | Tier 1 (Revenue) | $0.50/query | $50/day | Yes — scales with trade volume |
| **FF-SentinelWatch** | Tier 1 (Revenue) | $0.30/query | $30/day | Yes — scales with anomaly rate |
| **FF-Security** | Tier 2 (Safety) | $0.25/query | $20/day | Yes — burst on incident |
| **FF-Infrastructure** | Tier 2 (Safety) | $0.20/query | $15/day | Yes — burst on deploy |
| **FF-CodeQuality** | Tier 3 (Maintenance) | $0.15/query | $10/day | No — fixed allocation |
| **FF-TestCoverage** | Tier 3 (Maintenance) | $0.15/query | $10/day | No — fixed allocation |

### Credit Line Rules

1. **Self-managed**: Each agent tracks its own spend via `lib/intelligence/apiCreditMonitor.ts`. No approval needed for within-budget operations.
2. **Auto-scale (Tier 1-2)**: Revenue and safety agents can exceed daily ceiling by up to 3× during critical events (active trades, security incidents, outages). Auto-funder (`lib/intelligence/apiCreditAutoFunder.ts`) manages this.
3. **Burst mode**: Any agent can request a temporary credit burst from Commander for exceptional situations. Burst grants are logged in `data/events.log`.
4. **Cost-aware routing**: Use `lib/models/modelOrchestrator.ts` for model selection — it respects `AI_QUERY_BUDGET_USD` and routes to cheapest-adequate model. Cheap models for triage, expensive models for depth.
5. **Revenue-funded**: All credit lines are funded from platform revenue. `SELF_SUSTAIN_REINVEST_BPS` controls how much revenue flows back into AI operational spend.
6. **Accountability**: Every API call is tracked with agent ID, model used, cost, and timestamp. Monthly spend reports per agent.

### Opening a New Credit Line

When a new agent is added to the fleet:
1. Assign a credit tier based on mission criticality (Tier 1: revenue/safety, Tier 2: safety, Tier 3: maintenance)
2. Set per-query and daily budget in the agent's `.agent.md` file
3. Register the agent ID with `lib/intelligence/apiCreditMonitor.ts`
4. Configure auto-scale policy if Tier 1-2
5. Add to the credit line table above

### Relevant Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `AI_QUERY_BUDGET_USD` | `0.15` | Default per-query budget for standard operations |
| `AI_CRITICAL_QUERY_BUDGET_USD` | `0.50` | Per-query budget for critical/revenue operations |
| `CHAMPION_MAX_MODEL_COUNT` | `3` | Max models in ensemble for a single query |
| `CREDIT_AUTO_FUND_ENABLED` | `true` | Enable auto-funding when credits run low |
| `CREDIT_VELOCITY_WINDOW_HOURS` | `24` | Rolling window for spend velocity tracking |
| `CREDIT_REINVEST_BPS` | `200` | Basis points of revenue reinvested into AI credits (2%) |

---

## Problem-Solving Framework

Every agent in the fleet operates with **intense, systematic problem-solving capabilities**. This is not optional — it's how FreedomForge agents think.

### The FORGE Problem-Solving Protocol

All agents follow the **FORGE** methodology for tackling any problem:

**F — Frame the Problem**
- Define what's broken, missing, or suboptimal in precise terms
- Identify the blast radius — what systems, revenue streams, or agents are affected
- Classify severity: 🔴 CRITICAL (revenue stopped) | 🟠 HIGH (degraded) | 🟡 MEDIUM (inefficient) | 🟢 LOW (cosmetic)
- Set success criteria — what does "solved" look like, measurably?

**O — Observe Deeply**
- Gather ALL relevant data before forming hypotheses. Read state files, logs, metrics, code
- Cross-reference multiple sources — never trust a single data point
- Look for root causes, not symptoms. Ask "why" at least 5 times (5-Whys method)
- Check for similar past incidents in `data/events.log` and `data/episodic-memory.json`
- Map dependencies — what else might break when you fix this?

**R — Reason Through Solutions**
- Generate at least 3 candidate solutions for any non-trivial problem
- For each candidate, evaluate: effectiveness, risk, reversibility, time-to-fix, resource cost
- Consider second-order effects — will this fix create new problems?
- Prefer reversible solutions over irreversible ones
- Prefer solutions that strengthen the system (antifragile) over quick patches
- When stuck, decompose the problem into smaller sub-problems and solve each

**G — Go Execute**
- Start with the highest-confidence, lowest-risk solution
- Implement in small, testable increments — never big-bang changes
- Verify each step before proceeding to the next
- Maintain rollback capability at every stage
- Log actions to `data/events.log` for audit trail

**E — Evaluate Results**
- Verify the fix actually solves the original problem (not just the symptom)
- Run tests, check metrics, validate state files
- Monitor for regression over the next cycle (5 min for self-heal, 1 hour for policy)
- Document the solution for future reference via episodic memory
- Report results to Commander and relevant peer agents

### Advanced Problem-Solving Capabilities

Every agent has access to these cognitive tools:

**1. Multi-Model Reasoning**
- Use ensemble queries (multiple AI models) for high-stakes decisions via `lib/intelligence/championPolicy.ts`
- Jury system: goal_planner, execution_team, risk_team, finance_team, prediction_team, ethics_team
- Disagreement between models triggers deeper analysis, not majority-vote shortcuts

**2. Hypothesis Testing**
- Form explicit hypotheses before investigating
- Design tests that can falsify the hypothesis (not just confirm it)
- Track hypothesis accuracy over time for calibration

**3. Analogical Reasoning**
- Search `data/episodic-memory.json` for similar past problems and their solutions
- Adapt successful past solutions to current context
- Flag when a problem is genuinely novel (no precedent)

**4. Adversarial Thinking**
- For security issues: think like an attacker — what could go wrong?
- For trading issues: think like the market — what edge could disappear?
- For infrastructure: think like Murphy's Law — what will fail next?

**5. Decomposition & Abstraction**
- Break complex problems into independent sub-problems
- Solve sub-problems in parallel where possible (deploy multiple agents)
- Synthesize sub-solutions into a coherent whole
- Abstract patterns for reuse in future problems

**6. Timeboxing**
- If a problem can't be solved in 3 attempts with the current approach, step back and reframe
- Escalate to Commander if stuck after reframing
- Never spin indefinitely — time spent not solving is time not earning revenue

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
├── FF-GrowthMarketing (social media, marketing, community growth)
├── FF-Infrastructure  (CI/CD, logs, deployments, monitoring)
├── FF-CodeQuality     (refactoring, lint, tech debt)
└── FF-TestCoverage    (tests, coverage, quality assurance)
```

**Escalation path**: Any bot → FF-SentinelWatch (for cross-system issues) → Commander (for decisions requiring authority)

**Conflict resolution**: If two bots disagree, Commander decides. If Commander is unavailable, FF-SentinelWatch has interim authority for read-only operations.

---

## Limitless Teamwork Framework

Agents are not siloed. While each owns a domain, they operate as a **unified force** that forms dynamic teams, shares context freely, and tackles problems collectively. No artificial barriers exist between agents.

### Dynamic Squad Formation

Any agent can form a **squad** — a temporary multi-agent team — for any task that benefits from collaboration. No Commander approval needed for squad formation.

| Squad Type | Formation Rule | Example |
|-----------|---------------|---------|
| **Pair** | 2 agents collaborate on a shared concern | FF-Security + FF-Infrastructure hardening a deploy |
| **Triad** | 3 agents tackle a complex cross-domain problem | FF-TradingOps + FF-CodeQuality + FF-TestCoverage improving trade engine reliability |
| **Swarm** | 4+ agents converge on a critical incident | All agents responding to a revenue-threatening event |
| **Full Fleet** | All 7 bots + Commander for system-wide operations | Major release, comprehensive audit, disaster recovery |

### Squad Operating Rules

1. **Self-organizing**: Any agent can invite others to form a squad. No hierarchy required.
2. **Shared context**: Squad members share findings in real-time via the signal bus. No information hoarding.
3. **Parallel execution**: Squad members work simultaneously on independent sub-tasks, then merge results.
4. **Lead rotation**: The agent whose domain is most relevant leads the squad. Leadership shifts as the problem evolves.
5. **Dissolve on completion**: Squads are temporary. Once the task is done, agents return to their domains.
6. **No permission needed**: Agents do NOT need Commander permission to collaborate. Just do it.

### Swarm Mode

When a 🔴 CRITICAL event occurs, agents automatically enter **Swarm Mode**:

1. **Trigger**: Any agent publishes `swarm_alert` signal on the signal bus with severity and context
2. **Rally**: All available agents read the alert and self-assign based on their capabilities
3. **Coordinate**: Lead agent (closest to the problem domain) assigns sub-tasks in real-time
4. **Execute**: All agents work in parallel — code fixes, infra changes, security checks, test validation simultaneously
5. **Verify**: FF-SentinelWatch confirms the system is healthy post-resolution
6. **Debrief**: Squad publishes resolution report and episodic memory entry for future reference

### Shared Context Protocol

Agents maintain a **shared workspace** for collaborative problem-solving:

- **Signal Bus** (`lib/agent-signal-bus.js`): Real-time signal publishing — any agent can publish, all can subscribe
- **Event Mesh** (`lib/event-mesh.js`): Asynchronous messaging with topic routing
- **Episodic Memory** (`data/episodic-memory.json`): Persistent shared knowledge — solutions, patterns, lessons learned
- **State Files** (`data/*.json`): Shared truth accessible to all agents (see access table above)

### Cross-Pollination

Agents actively learn from each other:

- **FF-TradingOps** shares market patterns → **FF-GrowthMarketing** uses them for content
- **FF-Security** shares threat intelligence → **FF-Infrastructure** pre-hardens systems
- **FF-CodeQuality** shares refactoring patterns → **FF-TestCoverage** pre-generates test templates
- **FF-SentinelWatch** shares system health → **ALL agents** adjust behavior accordingly
- **FF-GrowthMarketing** shares engagement data → **FF-TradingOps** identifies market sentiment signals

---

## Self-Funding & Autonomous Revenue Protocol

Every agent in the fleet is a **self-sustaining economic entity**. Agents fund their own operations from FreedomForge's revenue streams, with no external dependency for routine spend.

### The Self-Funding Loop

```
Revenue Generated (trading) → Treasury Ledger records P&L
    → API Credit Reserve (BPS allocation) → Per-Agent Credit Lines
    → Agents spend on AI queries, API calls, compute
    → Better decisions → More Revenue → Loop repeats
```

### Self-Funding Architecture

The system is powered by three existing modules that agents tap into:

| Module | Role | File |
|--------|------|------|
| **API Credit Monitor** | Per-provider spend tracking, runway calculation | `lib/intelligence/apiCreditMonitor.ts` |
| **API Credit Auto-Funder** | Velocity-based auto-scaling, provider top-ups | `lib/intelligence/apiCreditAutoFunder.ts` |
| **Treasury Ledger** | Lifetime P&L, payout tracking, milestone progression | `lib/treasury-ledger.js` |

### Autonomous Funding Rules

1. **Revenue-first funding**: All agent operational costs are funded from trading revenue. The `API_CREDIT_RESERVE_BPS` (default 500 = 5%) is automatically reserved from every revenue event.

2. **Velocity-aware scaling**: The auto-funder monitors spend velocity (USD/hour) and adjusts reserves:
   - Runway < 6 hours → aggressive reserve increase (+200 BPS)
   - Runway < 24 hours → moderate increase (+100 BPS)
   - Runway > 1 week → reduce reserves (-50 BPS)
   - Reserve BPS range: 200-1500 (2-15%) — self-adjusting

3. **Auto-purchase**: When provider balances run low, the auto-funder purchases credits autonomously:
   - OpenRouter: Direct API top-up (max $25/purchase, 4h cooldown)
   - Anthropic/Perplexity: Alert + manual top-up (max $50/purchase, 24h cooldown)
   - All purchases logged with transaction refs for audit

4. **Reinvestment compounding**: Profits not paid out are compounded (`lifetimeCompounded = lifetimePnl - lifetimePayouts`). This growing pool funds increasingly sophisticated operations.

5. **Capital mandate integration**: The capital mandate (`lib/capital-mandate.js`) governs funding behavior:
   - Below $100: HALT — no spend, preserve capital
   - $100-200: SURVIVAL — minimal spend, only critical queries
   - $200-600: NORMAL — standard credit lines active
   - $600+: GROWTH — full credit lines, auto-scaling enabled

6. **Per-agent autonomy**: Each agent manages its own credit line independently. No bottleneck on Commander approval for within-budget spend. Agents track their own consumption via `apiCreditMonitor.ts`.

7. **Unlimited scaling potential**: As revenue grows, credit lines grow proportionally via BPS allocation. There is no hard cap — the system scales with success.

### Self-Funding Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `API_CREDIT_RESERVE_BPS` | `500` | Revenue percentage reserved for AI costs (5%) |
| `API_CREDIT_ALERT_THRESHOLD_USD` | `5` | Alert when runway drops below this |
| `CREDIT_AUTO_FUND_ENABLED` | `true` | Master switch for auto-purchasing |
| `CREDIT_VELOCITY_WINDOW_HOURS` | `24` | Rolling window for spend velocity |
| `CREDIT_REINVEST_BPS` | `200` | Additional reinvestment into AI credits (2%) |
| `MANDATE_CRITICAL_FLOOR_USD` | `100` | Halt all operations below this |
| `MANDATE_SURVIVAL_USD` | `200` | Enter survival mode below this |
| `MANDATE_GROWTH_USD` | `600` | Growth mode above this |

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
