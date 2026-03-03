# OSS Growth & Adaptive Learning Roadmap

This plan prioritizes reliability-first growth using open-source tools that fit the current FreedomForge stack.

## Phase 1 (Week 1): Observability Foundation

### Add
- Prometheus + Grafana
- Node exporter / app metrics endpoint

### Why
- Long-term growth requires fast detection of payout failures, gas drift, and profitability decay.

### Track
- `transfer_success_rate`
- `gas_topup_error_rate`
- `distribution_skip_rate`
- `estimated_revenue_inflow_eth`
- `payouts_sent_eth`

### Exit Criteria
- Live dashboard with 24h/7d trend views and alert thresholds.

---

## Phase 2 (Week 2): Research & Backtesting Layer

### Add
- `vectorbt` (primary)
- `Backtrader` (optional cross-check)

### Why
- Test threshold/retry/reserve policies on historical windows before touching production env values.

### Track
- Sharpe-like risk-adjusted payout stability
- Drawdown of treasury balance
- Skip/error rate under stress windows

### Exit Criteria
- Reproducible notebook/script that scores candidate parameter sets and exports top 3 configs.

---

## Phase 3 (Week 3): Data Connectivity Expansion

### Add
- CCXT (exchange-agnostic market data)

### Why
- Reduces single-source dependency and improves signal resilience.

### Track
- Source agreement rate (price/volatility deltas)
- Data freshness lag
- Missing-data incident count

### Exit Criteria
- Multi-source market snapshot is available for strategy scoring and fallback routing.

---

## Phase 4 (Week 4): Adaptive Learning Workflow

### Add
- Optuna (parameter optimization)
- MLflow (experiment tracking)

### Why
- Move from static tuning to experiment-driven parameter updates with auditability.

### Track
- Best config uplift vs baseline
- Stability of uplift over rolling windows
- Frequency of reverted experiments

### Exit Criteria
- Weekly optimizer run produces candidate config + confidence score + rollback-safe diff.

---

## Phase 5 (Week 5): Feature Consistency + Drift Monitoring

### Add
- Feast (feature store; optional if feature volume grows)
- Evidently (drift/performance monitoring)

### Why
- Prevent silent degradation when market regime changes or feature distributions shift.

### Track
- Feature drift alerts/week
- Regime classification stability
- Strategy degradation lead time

### Exit Criteria
- Drift alerts trigger strategy fallback mode and recommendation updates.

---

## Phase 6 (Week 6): Safe Auto-Apply Loop

### Add
- Policy gate script (in-repo) for max change bounds + approval labels

### Why
- Enables controlled automation of env updates from adaptive recommendations.

### Guardrails
- Never auto-apply private key/network changes
- Clamp max deltas per cycle for:
  - `GAS_TOPUP_AMOUNT`
  - `GAS_RESERVE_ETH`
  - `MIN_PAYOUT_ETH`
  - `GAS_TOPUP_THRESHOLD`
- Require successful smoke test before apply completes

### Exit Criteria
- One-click safe promotion from “recommendation” to “production env patch”.

---

## Recommended Priority Stack (Minimal, High ROI)

1. Prometheus + Grafana
2. vectorbt + Optuna
3. MLflow
4. CCXT
5. Evidently

Feast can wait until feature complexity justifies it.

---

## Monthly Operating Cadence

- Daily: `npm run watch:live` checks + alert review
- Weekly: optimizer/backtest run, compare vs baseline
- Biweekly: market-source quality review (agreement + freshness)
- Monthly: controlled env retune + smoke validation + rollback checkpoint
