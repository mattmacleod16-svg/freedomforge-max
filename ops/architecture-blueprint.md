   # FreedomForge Architecture Blueprint

> Practical, production-grade architecture document based on the actual codebase.
> Generated: 2026-03-11 — Grounded in reality, not hype.

---

## 1. Executive Summary

FreedomForge is a multi-agent automated trading system built on Next.js, deployed
across Railway (dashboard + APIs) and an Oracle Cloud VM (trade execution loops).
It trades crypto across Coinbase, Kraken, and Polymarket using a composite signal
engine backed by technical indicators, sentiment analysis, and a self-evolving
parameter optimizer. The system started with ~$805 in seed capital under a strict
zero-injection mandate — it must grow purely from trading profits.

The architecture follows an event-driven agent pattern where specialized scripts
communicate via a shared JSON signal bus, with a master orchestrator coordinating
execution every 3–5 minutes. Risk management is layered (capital mandate →
risk manager → liquidation guardian → kill switch). The owner receives automated
payouts from realized net revenue.

**What it does well:** Disciplined risk management, self-tuning parameters,
multi-venue execution, automated operations.

**What it does NOT do:** Guarantee profits, scale infinitely, or eliminate
market risk. All trading involves potential loss of capital.

---

## 2. Current Agent Class Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│                   OWNER LAYER (Matty)                   │
│  Kill switch · Dashboard · Payout stream · Full control │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│              MASTER ORCHESTRATOR                        │
│  scripts/master-orchestrator.js (910 lines)             │
│  Runs every 3-5 min via systemd timer                   │
│  Coordinates all sub-agents, routes trades to venues    │
└──┬──────────┬──────────┬──────────┬─────────────────────┘
   │          │          │          │
   ▼          ▼          ▼          ▼
┌──────┐ ┌────────┐ ┌────────┐ ┌──────────────┐
│SIGNAL│ │DECISION│ │ RISK   │ │  EXECUTION   │
│LAYER │ │ LAYER  │ │ LAYER  │ │   LAYER      │
└──┬───┘ └───┬────┘ └───┬────┘ └──────┬───────┘
   │         │          │             │
   ▼         ▼          ▼             ▼
```

### 2.1 Signal Layer (data gathering)

| Agent                  | File                                   | Role                                   |
|------------------------|----------------------------------------|----------------------------------------|
| Edge Detector          | `lib/edge-detector.js`                 | Multi-TF technical signals (RSI, BB, ATR, EMA) |
| Continuous Learning    | `scripts/continuous-learning.js`       | Market regime detection, model updates |
| Geopolitical Watch     | `scripts/geopolitical-watch.js`        | Macro event monitoring                 |
| Public Alpha Fusion    | `scripts/public-alpha-fusion.js`       | Sentiment & alpha signal aggregation   |
| Forecast Engine        | `lib/intelligence/forecastEngine.ts`   | Price forecasting                      |
| Behavioral Intel       | `lib/intelligence/behavioralIntel.ts`  | Market participant behavior analysis   |
| Market Feature Store   | `lib/intelligence/marketFeatureStore.ts` | Feature engineering for ML signals   |
| X Automation           | `lib/social/xAutomation.ts`           | Social media signal extraction         |

### 2.2 Decision Layer (strategy + self-tuning)

| Agent                  | File                                   | Role                                   |
|------------------------|----------------------------------------|----------------------------------------|
| Self-Evolving Brain    | `lib/self-evolving-brain.js`           | Bayesian weight tuning per indicator   |
| Adaptive Cortex        | `lib/intelligence/adaptiveCortex.ts`   | Regime-adaptive strategy selection     |
| Champion Policy        | `lib/intelligence/championPolicy.ts`   | Best-performing policy tracking        |
| Ensemble Auto-Policy   | `lib/intelligence/ensembleAutoPolicy.ts` | Multi-strategy ensemble              |
| Ensemble Diagnostics   | `lib/intelligence/ensembleDiagnostics.ts` | Strategy health monitoring          |
| Opportunity Engine     | `lib/intelligence/opportunityEngine.ts` | Trade opportunity scoring             |
| Horizontal Scaler      | `scripts/horizontal-scaler.js`         | Asset discovery + capital allocation  |

### 2.3 Risk Layer (capital protection)

| Agent                  | File                                   | Role                                   |
|------------------------|----------------------------------------|----------------------------------------|
| Capital Mandate        | `lib/capital-mandate.js`               | Zero-injection law, position sizing    |
| Risk Manager           | `lib/risk-manager.js`                  | Portfolio exposure, drawdown breaker   |
| Liquidation Guardian   | `lib/liquidation-guardian.js`          | Margin health, auto-close positions    |
| Risk Monitor (API)     | `lib/intelligence/riskMonitor.ts`      | Real-time risk metrics dashboard       |
| Kill Switch            | `data/kill-switch.json`                | Emergency halt (owner-triggered)       |

### 2.4 Execution Layer (venue engines)

| Agent                  | File                                   | Role                                   |
|------------------------|----------------------------------------|----------------------------------------|
| Coinbase Spot Engine   | `scripts/coinbase-spot-engine.js`      | Spot trading on Coinbase               |
| Kraken Spot Engine     | `scripts/kraken-spot-engine.js`        | Spot trading on Kraken                 |
| Polymarket CLOB Engine | `scripts/polymarket-clob-engine.js`    | Prediction market trading              |
| Prediction Market Eng. | `scripts/prediction-market-engine.js`  | General prediction market execution    |
| Conversion Engine      | `scripts/conversion-engine.js`         | Cross-asset conversion                 |
| Venue Engine           | `scripts/venue-engine.js`              | Multi-venue router                     |
| Trade Reconciler       | `lib/trade-reconciler.js`              | Match fills against orders             |

### 2.5 Operations Layer (self-maintenance)

| Agent                  | File                                   | Role                                   |
|------------------------|----------------------------------------|----------------------------------------|
| Self-Heal              | `scripts/self-heal.js`                 | Auto-repair broken state               |
| Recovery Controller    | `scripts/recovery-controller.js`       | Failure recovery orchestration         |
| Integrity Guardian     | `scripts/integrity-guardian.js`        | Data integrity verification            |
| Scheduled Audit        | `scripts/scheduled-audit.js`           | Periodic system health audit           |
| Watchdog Daemon        | `scripts/watchdog-daemon.sh`           | Process health monitoring              |
| Data Hygiene           | `scripts/data-hygiene.js`              | State file cleanup + rotation          |
| Autonomy Maintenance   | `scripts/autonomy-maintenance.js`      | Self-governance enforcement            |

### 2.6 Reporting & Payout Layer

| Agent                  | File                                   | Role                                   |
|------------------------|----------------------------------------|----------------------------------------|
| Treasury Ledger        | `lib/treasury-ledger.js`               | Cumulative P&L + payout tracking       |
| Trade Journal          | `lib/trade-journal.js`                 | Per-trade history + performance stats  |
| Daily KPI Report       | `scripts/daily-kpi-report.js`          | Daily performance summary              |
| Weekly Summary         | `scripts/weekly-summary.js`            | Weekly digest + payout calculation     |
| Profit Scorecard       | `scripts/profit-scorecard.js`          | Revenue attribution                    |
| Daily Agent Proof      | `scripts/daily-agent-proof.js`         | Agent liveness verification            |
| Cashflow Autotune      | `scripts/cashflow-autotune.js`         | Dynamic expense/revenue balancing      |

---

## 3. Technical Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        RAILWAY (Next.js 16)                         │
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────┐    │
│  │ Dashboard UI │  │ API Routes   │  │ Intelligence Layer (TS)  │    │
│  │ app/dashboard│  │ app/api/     │  │ lib/intelligence/        │    │
│  │ React 19     │  │ status/*     │  │ adaptiveCortex           │    │
│  │ Chart.js     │  │ empire/*     │  │ ensembleAutoPolicy       │    │
│  │ Framer       │  │ auth/*       │  │ forecastEngine           │    │
│  │              │  │ x/*          │  │ memoryEngine             │    │
│  └─────────────┘  └──────────────┘  └──────────────────────────┘    │
│                                                                      │
│  Env: Railway environment variables (synced via npm run apply-railway-env)      │
└──────────────────────────────────────────────────────────────────────┘
          │                        │
          │ HTTPS                  │ SSH deploy
          ▼                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│              ORACLE CLOUD VM (Always-On Compute)                     │
│                                                                      │
│  systemd timers:                                                     │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  every 3-5 min : master-orchestrator.js                      │    │
│  │  every 5 min   : trade-loop.js                               │    │
│  │  every 30 min  : horizontal-scaler.js                        │    │
│  │  every 1 hr    : integrity-guardian.js, scheduled-audit.js   │    │
│  │  every 6 hr    : continuous-learning.js                      │    │
│  │  daily         : daily-check.js, daily-kpi-report.js         │    │
│  │  weekly        : weekly-summary.js, weekly-policy-review.js  │    │
│  │  monthly       : monthly-strategy.js                         │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  watchdog-daemon.sh (always-on process supervisor)                   │
│  ff-watchdog.service (systemd)                                       │
└──────────────────────────────────────────────────────────────────────┘
          │                   │                    │
          ▼                   ▼                    ▼
   ┌────────────┐    ┌──────────────┐    ┌────────────────┐
   │  Coinbase   │    │   Kraken     │    │  Polymarket    │
   │  CDP API    │    │   REST API   │    │  CLOB API      │
   │  JWT auth   │    │   HMAC auth  │    │  EIP-712 auth  │
   └────────────┘    └──────────────┘    └────────────────┘
```

### 3.1 Communication Pattern: Shared JSON Signal Bus

All agents communicate through `lib/agent-signal-bus.js`, which reads/writes
`data/agent-signal-bus.json`. Signals are typed, timestamped, and expire via TTL.

```
Producer (any agent) ──publish()──▶ data/agent-signal-bus.json ──query()──▶ Consumer
```

Signal types currently in use:
- `market_regime` — bull/bear/sideways/risk-off classification
- `geo_risk` — geopolitical risk score affecting all venues
- `venue_health` — per-venue latency and availability
- `alpha_signal` — enriched trading opportunities
- `kill_switch` — emergency halt broadcast

### 3.2 Data Persistence Pattern

All state is JSON-file-based in `data/`, with atomic writes via `lib/resilient-io.js`:
- Write to `.tmp` file, then `rename()` (atomic on most filesystems)
- Backup recovery if primary file is corrupted
- File locking to prevent concurrent corruption

State files: ~20 JSON files in `data/` (orchestrator, risk, brain, journal, bus, etc.)

### 3.3 Env Configuration

- `.env.local` — local secrets (API keys, wallet keys)
- Railway environment variables — production secrets (synced via `npm run apply-railway-env`)
- Environment-driven feature flags for every agent (e.g., `KRAKEN_ENABLED`, `DRY_RUN`)

---

## 4. Implementation Roadmap

### Phase 1: Current State (DONE)

- [x] Coinbase + Kraken spot trading
- [x] Polymarket CLOB prediction market trading
- [x] Multi-indicator edge detection (RSI, BB, ATR, volume, multi-TF momentum)
- [x] Self-evolving brain with Bayesian weight tuning
- [x] Capital mandate with survival/normal/growth modes
- [x] Multi-layer risk management (portfolio, drawdown, liquidation, kill switch)
- [x] Oracle Cloud VM with systemd timers
- [x] Dashboard + status APIs on Railway
- [x] Alerting via Discord webhooks
- [x] iOS app shell via Capacitor
- [x] Monitoring via Grafana + Prometheus

### Phase 2: Near-Term Improvements (practical, achievable)

**a) Improve Signal Quality**
- [ ] Add order book depth analysis to edge detector
- [ ] Integrate on-chain whale wallet tracking (Alchemy SDK already in deps)
- [ ] Add funding rate signals for perpetual futures arbitrage detection
- [ ] Improve volume profile analysis with VWAP

**b) Expand Venue Coverage**
- [ ] Add Kalshi prediction market integration (US-regulated)
- [ ] Add Hyperliquid for perps (on-chain, no KYC for small accounts)
- [ ] Evaluate Alpaca for US equities (free commissions, easy API)

**c) Harden Operations**
- [ ] Migrate signal bus from file-based to Redis (reduces race conditions)
- [ ] Add structured logging with correlation IDs across agent cycles
- [ ] Implement circuit breaker pattern for external API calls
- [ ] Add dead-letter queue for failed trades (retry with backoff)

**d) Improve Payout System**
- [ ] Automate weekly payout calculation in treasury-ledger
- [ ] Add payout history to dashboard
- [ ] Implement configurable payout percentage (currently hardcoded at 15%)

### Phase 3: Medium-Term Growth (3-6 months)

**a) Better ML/Decision Making**
- [ ] Train lightweight gradient-boosted model on trade journal data
- [ ] Add feature importance tracking to evolving brain
- [ ] Implement walk-forward optimization with out-of-sample testing
- [ ] Add Kelly criterion position sizing (already referenced in brain thresholds)

**b) DeFi Integration**
- [ ] Aave/Compound yield farming for idle capital (Ethereum, already have ethers)
- [ ] Uniswap LP positions for stablecoin pairs
- [ ] Cross-chain bridge monitoring for arbitrage opportunities

**c) Operational Maturity**
- [ ] Migrate from JSON files to SQLite or PostgreSQL for state
- [ ] Add proper backtesting framework using historical trade journal data
- [ ] Implement A/B testing for strategy variants
- [ ] Add PagerDuty/OpsGenie integration for critical alerts

### Phase 4: Long-Term Scaling (6-12 months)

- [ ] Multi-VM deployment for venue-specific engines
- [ ] Strategy marketplace — publish best-performing strategies
- [ ] API-as-a-service for signal data (revenue diversification)
- [ ] Proper containerization (Docker) for reproducible deployments
- [ ] Add more sophisticated portfolio optimization (mean-variance, risk parity)

---

## 5. Self-Auditing & Verification Loops

### 5.1 Every Cycle (3-5 minutes)

```
master-orchestrator.js runs:
  1. Check kill switch → halt if active
  2. Load risk state → verify within drawdown limits
  3. Run brain evolution cycle → update indicator weights
  4. Check capital mandate → determine mode (survival/normal/growth)
  5. Fetch composite signals → only trade if confidence + edge thresholds met
  6. Pre-trade risk check → checkTradeAllowed() for every candidate
  7. Post-trade → record in journal, update exposure, publish to bus
  8. Self-heal → detect and recover from any errors in the cycle
```

### 5.2 Hourly

- `integrity-guardian.js` — validates all state files are parseable and consistent
- `scheduled-audit.js` — checks venue API connectivity, balance reconciliation

### 5.3 Daily

- `daily-check.js` — full system health check
- `daily-kpi-report.js` — P&L, win rate, Sharpe ratio, drawdown
- `daily-agent-proof.js` — proves every agent ran within expected interval

### 5.4 Weekly

- `weekly-summary.js` — aggregate performance, payout calculation
- `weekly-policy-review.js` — reviews and adjusts risk parameters

### 5.5 Capital Mandate Verification (continuous)

Every trade must pass through this chain before execution:

```
Trade Candidate
  │
  ├── Capital Mandate check (mode-appropriate sizing)
  │     └── HALT if below critical floor ($100)
  │     └── SURVIVAL mode if below $200 (max $8/trade, confidence > 0.75)
  │     └── NORMAL mode: max 6% of capital per trade
  │     └── GROWTH mode (>$600): max 8% of capital per trade
  │
  ├── Risk Manager check (portfolio exposure)
  │     └── BLOCK if portfolio exposure > $500
  │     └── BLOCK if single asset > 40% of portfolio
  │     └── BLOCK if single venue > 60% of portfolio
  │     └── BLOCK if daily loss > $50
  │     └── BLOCK if drawdown > 20% of peak equity
  │
  ├── Liquidation Guardian check
  │     └── BLOCK if margin utilization > 80%
  │     └── AUTO-CLOSE if margin utilization > 90%
  │
  └── Execute trade (or deny)
```

### 5.6 Owner Payout Verification

Treasury ledger tracks:
- `lifetimePnl` — all-time P&L
- `lifetimePayouts` — all USD paid to owner
- `lifetimeCompounded` — profits retained for growth
- Payout = configurable % of realized net revenue (currently ≥15%)
- Weekly summary calculates and reports payout amount

---

## 6. Edge-Case Stress Tests

### 6.1 Sustained Losses / Drawdown

**Current protection:**
- Capital mandate enters survival mode below $200 (ultra-conservative)
- All trading halts below $100 critical floor
- Risk manager triggers drawdown circuit breaker at 20% peak-to-trough
- Brain auto-reduces aggression after 5 consecutive losses
- Daily loss capped at $50

**Gap:** No automated recovery strategy once halted at critical floor.
**Recommendation:** Add a slow-recovery mode that paper-trades for N days before risking real capital again.

### 6.2 Exchange API Outage

**Current protection:**
- Timeout-based circuit breakers on all API calls (12-15s)
- Graceful degradation — missing venue just gets skipped
- Self-heal script repairs broken state files

**Gap:** No automatic failover to backup exchange.
**Recommendation:** Implement venue health scoring with automatic re-routing.

### 6.3 VM Goes Down

**Current protection:**
- Watchdog daemon monitors and restarts processes
- Oracle Cloud free tier provides stable uptime
- Remote bootstrap scripts can redeploy from scratch

**Gap:** Single point of failure — one VM.
**Recommendation:** Add a secondary VM (Oracle free tier allows 2) with health-check failover.

### 6.4 API Key Compromise

**Current protection:**
- Keys in env vars, not in code
- Railway encrypted environment variables

**Gap:** No key rotation automation, no IP whitelisting documented.
**Recommendation:** Implement automated key rotation alerts, set up exchange IP allowlists.

### 6.5 Regulatory Change

**Current protection:**
- Multiple venues across jurisdictions
- Polymarket already routed through Oracle VM for region compliance

**Gap:** No automated jurisdiction monitoring.
**Recommendation:** Add regulatory news monitoring to geopolitical-watch agent.

### 6.6 Flash Crash / Black Swan

**Current protection:**
- ATR-based dynamic stop losses (2x ATR multiplier)
- Kill switch for emergency halt
- Max trade size limits per cycle

**Gap:** Stop-loss orders are not guaranteed fills in extreme conditions.
**Recommendation:** Reduce max position concentration, add trailing stop implementation.

---

## 7. Honest Assessment

**Strengths of the current system:**
- Well-structured agent architecture with clear separation of concerns
- Multiple layers of risk protection that actually work together
- Self-evolving parameters based on real trade outcomes
- Capital mandate enforces discipline (survival/normal/growth modes)
- Automated operations with self-healing and alerting

**Risks and limitations:**
- Starting with ~$800 means even good returns generate small absolute dollars
- File-based state (JSON) can have race conditions under concurrent access
- No backtesting framework to validate strategies before deployment
- Single VM is a single point of failure for execution
- Crypto markets are highly correlated — diversification across crypto pairs provides less risk reduction than it appears
- Past indicator performance does not guarantee future results

**Realistic expectations:**
- Professional quant funds with PhDs and billions in infrastructure average 15-20% annual returns
- A small retail system should target capital preservation first, modest growth second
- The self-evolving brain is genuinely useful but needs more data (hundreds of trades) to tune well
- Expanding to more venues adds complexity and operational overhead — do it incrementally

---

*This document reflects the actual codebase as of 2026-03-11.
Updated as the system evolves.*
