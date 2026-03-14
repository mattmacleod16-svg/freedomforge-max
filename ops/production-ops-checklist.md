# Production Ops Checklist (Base Mainnet)

Use this checklist to keep gas top-up and payout automation stable after env or wallet changes.

## Locked Runtime Settings (validated in live test)

- `ALCHEMY_NETWORK=base-mainnet`
- `FUNDING_PRIVATE_KEY` set (must hold enough native ETH for top-ups)
- `WALLET_PRIVATE_KEY` set (stable revenue wallet)
- `PAYOUT_TOKEN_ADDRESS` unset for native ETH payout mode
- `GAS_TOPUP_AMOUNT=0.01`
- `GAS_TOPUP_THRESHOLD=0.01` (default is acceptable)
- `GAS_TOPUP_ADAPTIVE=true` (default)
- `GAS_TOPUP_BUFFER_ETH=0.002` (default)
- `GAS_RESERVE_ETH=0.005`
- `MIN_PAYOUT_ETH=0.001`
- `FUNDING_LOW_BALANCE_ALERT_ETH=0.03` (default)

## Guardrails

- Funding wallet must always hold more than `GAS_TOPUP_AMOUNT + gas fees`.
- Revenue wallet native balance must remain above reserve for payout path to execute.
- If switching to token payouts, set `PAYOUT_TOKEN_ADDRESS` and ensure token balance + gas reserve are both present.
- Keep `STRATEGY_MARKET_DATA_ENABLED=true` (default) so monthly strategy incorporates public market regime data.

## Post-change smoke test

1. Deploy to production.
2. Check health endpoint:
   - `curl -sS https://freedomforge-max.up.railway.app/api/alchemy/health`
3. Trigger distribution with unique bot id:
   - `curl -sS "https://freedomforge-max.up.railway.app/api/alchemy/wallet/distribute?shard=0&shards=1&botId=manual-$(date +%s)"`
4. Verify wallet state/logs:
   - `curl -sS https://freedomforge-max.up.railway.app/api/alchemy/wallet`
   - `curl -sS "https://freedomforge-max.up.railway.app/api/alchemy/wallet/logs?limit=100"`
5. Optional live terminal watch:
   - `APP_BASE_URL=https://freedomforge-max.up.railway.app WATCH_INTERVAL_MS=15000 npm run watch:live`
   - In-app ops view: `https://freedomforge-max.up.railway.app/dashboard/ops`
6. Metrics scrape endpoint (Prometheus format):
   - `curl -sS https://freedomforge-max.up.railway.app/api/status/metrics`
   - JSON mode: `curl -sS "https://freedomforge-max.up.railway.app/api/status/metrics?format=json"`

## Grafana Quick Start

1. Add Prometheus scrape target for the bot metrics endpoint (`/api/status/metrics`).
2. In Grafana, import dashboard file:
   - `ops/grafana-dashboard.freedomforge.json`
3. Select your Prometheus datasource when prompted.
4. Set dashboard refresh to `15s` for near-live visibility.
5. Oracle Free VM setup guide: `ops/oracle-cloud-free-vm-setup.md`
6. HTTPS + reverse proxy are included via Caddy in the Oracle monitoring stack.
7. Emergency recovery runbook: `ops/break-glass.md`

## Known skip/error signals

- `distribution_skipped_no_gas`: gas check/top-up failed.
- `distribution_skipped_native_gas_reserve`: wallet balance not above reserve.
- `distribution_skipped_threshold`: computed per-recipient share below `MIN_PAYOUT_ETH`.
- `gas_topup_error` with insufficient funds: funding wallet underfunded.
- `gas_topup_funding_low`: funding wallet below warning level.
- `gas_topup_blocked_funding`: funding wallet cannot cover top-up plus reserve.
