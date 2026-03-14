# High-Frequency Trade Loop (1s cadence)

Use this when you want near-real-time trade/distribution attempts rather than cron-based scheduling.

## Why this exists

- GitHub Actions cron cannot run every second.
- Vercel cron jobs are also not second-level.
- This loop runs as a persistent process and can attempt execution every `1000ms`.

## Start locally or on VM

```bash
cd /Users/mattyice/Desktop/freedomforge-max
APP_BASE_URL=https://<YOUR_APP_URL> \
TRADE_LOOP_INTERVAL_MS=1000 \
BOT_SHARD_INDEX=0 \
BOT_SHARDS=1 \
BOT_ID=live-0 \
npm run trade:loop
```

## Linux VM (systemd, recommended for 24/7)

### Oracle VM one-command bootstrap (recommended)

On a fresh Oracle Ubuntu VM:

```bash
git clone <your-repo-url>
cd freedomforge-max
bash scripts/oracle-trade-loop-bootstrap.sh \
  --app-base-url https://<YOUR_APP_URL> \
  --user "$USER"
```

If repo is not cloned yet, run from anywhere:

```bash
bash scripts/oracle-trade-loop-bootstrap.sh \
  --repo https://github.com/<owner>/<repo>.git \
  --dir /opt/freedomforge-max \
  --app-base-url https://<YOUR_APP_URL> \
  --user ubuntu
```

This installs Node.js, installs production dependencies, registers systemd units, starts them now, and enables auto-start on reboot.
It also installs two nightly timers by default:

- `freedomforge-trade-loop-update.timer`: health-gated updates with staged restarts and rollback on failure.
- `freedomforge-trade-loop-intelligence.timer`: runs learning and policy-maintenance routines so the system keeps improving over time.
- `freedomforge-trade-loop-clob-burnin.timer`: runs a 24h burn-in audit and auto-flags persistent CLOB skips/errors.

The intelligence routine includes `cashflow:autotune`, which continuously updates chain-specific keys:

- `MIN_PAYOUT_ETH_<CHAIN>`
- `MIN_PAYOUT_GAS_MULTIPLIER_<CHAIN>`
- `SELF_SUSTAIN_REINVEST_BPS_<CHAIN>`
- `GAS_RESERVE_ETH_<CHAIN>`
- `GAS_TOPUP_THRESHOLD_<CHAIN>`
- `GAS_TOPUP_AMOUNT_<CHAIN>`

based on observed transfer success/failures and threshold skips.

Capital protection circuit-breaker (enabled by default in autotune):

- `CASHFLOW_CIRCUIT_BREAKER_ENABLED=true`
- `CASHFLOW_CIRCUIT_FAIL_SPIKE=3`
- `CASHFLOW_CIRCUIT_NOGAS_SPIKE=3`
- `CASHFLOW_CIRCUIT_MIN_SUCCESS_RATE=0.70`
- `CASHFLOW_CIRCUIT_MIN_ATTEMPTS=4`
- `CASHFLOW_CIRCUIT_REINVEST_BPS=7000`

When triggered, autotune shifts into temporary capital-preservation mode (higher reserve/topup and stricter payout economics) until runtime stability improves.

### One-command autonomy refresh (existing Oracle VM)

When you already have the repo on Oracle and just want to ensure every autonomous service/timer is enabled:

```bash
cd ~/freedomforge-max
npm run oracle:enable:autonomy
```

After this, you can shut your laptop and the VM continues running independently.

This autonomy refresh also installs X automation posting:

- Service: `freedomforge-x-growth.service`
- Timer: `freedomforge-x-growth.timer` (default 3x/day UTC)

Install/update only the X posting timer:

```bash
cd ~/freedomforge-max
npm run x-growth:install
```

Live posting requires valid X credentials with `X_DRY_RUN=false`.

Profit-first guard is enabled by default for X posting:

- `X_POST_REQUIRE_PROFIT=true`
- `X_POST_MIN_NET_ETH=0.002`
- `X_POST_MIN_SUCCESS_RATE=0.80`
- `X_POST_MIN_ATTEMPTS=3`

If these thresholds are not met for the proof window, posting is blocked.

### Oracle console emergency self-heal (if SSH hangs)

If port 22 is reachable but SSH banner/login hangs, run this from the Oracle web console/serial console:

```bash
cd ~/freedomforge-max
npm run oracle:console:self-heal
```

This restarts `sshd`, refreshes code, reinstalls/reenables all autonomy services + timers, triggers an immediate intelligence cycle, and prints `oracle-enforce-success` when complete.

### Weekly drift guard (self-test + auto-repair)

A weekly timer now verifies required services/timers are enabled+active and automatically repairs drift.

- Service: `freedomforge-superagent-selftest.service`
- Timer: `freedomforge-superagent-selftest.timer`

Manual commands:

```bash
npm run superagent:selftest
npm run superagent:selftest:install
sudo systemctl start freedomforge-superagent-selftest.service
systemctl list-timers freedomforge-superagent-selftest.timer --no-pager
```

## Collaborative conversion engine

The intelligence cycle also runs `conversion:engine` so agents can coordinate liquidity conversions when needed for execution efficiency.

Safety defaults:

- `CONVERSION_ENGINE_ENABLED=false`
- `CONVERSION_ENGINE_DRY_RUN=true`
- `CONVERSION_ENGINE_MAX_TX_PER_CYCLE=1`

Required for live swaps:

- `ZEROX_API_KEY` (0x API key; conversion engine skips live swap without it)

Key controls:

- `CONVERSION_NETWORKS` (comma-separated)
- `CONVERSION_FROM_TOKEN_<CHAIN>`
- `CONVERSION_TO_TOKEN_<CHAIN>`
- `CONVERSION_SELL_BALANCE_PCT_<CHAIN>` or `CONVERSION_SELL_AMOUNT_WEI_<CHAIN>`
- `CONVERSION_MIN_SELL_AMOUNT_WEI_<CHAIN>`
- `CONVERSION_MIN_BUY_AMOUNT_WEI_<CHAIN>`
- `CONVERSION_SLIPPAGE_BPS_<CHAIN>`
- `CONVERSION_MIN_INTERVAL_SEC` (minimum seconds between executed conversions per network)
- `CONVERSION_SKIP_COOLDOWN_SEC` (cooldown after repeated low-value skip conditions)
- `CONVERSION_MAX_NETWORK_FEE_RATIO_BPS` (max acceptable fee-to-sell ratio for native sells)

Micro-sizing + order splitting controls:

- `CONVERSION_SPLIT_ORDERS=true`
- `CONVERSION_SPLIT_MAX_PARTS=3`
- `CONVERSION_SPLIT_BASE_BPS=2500` (base slice size)
- `CONVERSION_STRENGTHEN_BPS=20` (scale up only if quote quality improves)
- `CONVERSION_SPLIT_MAX_SCALE_BPS=15000` (hard cap on progressive scale-up)

Trigger gating:

- `CONVERSION_TRIGGER_LOOKBACK_HOURS`
- `CONVERSION_TRIGGER_NOGAS_SPIKE_MIN`

By default, conversions only run when recent no-gas/topup-error spikes indicate execution friction.
This keeps conversion behavior aligned with probability-farming: many small controlled actions, scaling only when conditions strengthen.

## Polymarket CLOB engine

The intelligence cycle now also runs `polymarket:clob` for direct short-timeframe prediction-market execution.

## Public alpha fusion (new)

The intelligence cycle now runs `public:alpha` to fuse public data into a compact regime signal for agent coordination.

Current public sources used each cycle:

- Fear & Greed index (`alternative.me`)
- BTC/ETH 24h momentum (`Binance`)
- Crypto narrative trend proxy (`CoinGecko trending`)
- Open-source AI-agent trading innovation pulse (`GitHub repository search`)
- Cross-chain bridge flow pulse (`WormholeScan`)

Output is persisted to `data/public-alpha-state.json` and exposed in cycle logs.

Wormhole controls:

- `WORMHOLE_ENABLED=true|false` (default true)
- `WORMHOLE_SCAN_URL` (default `https://api.wormholescan.io/api/v1/last-txs?numRows=50`)

Efficiency defaults:

- `POLY_CLOB_DRY_RUN=true`
- `POLY_CLOB_MAX_ORDERS_PER_CYCLE=2`
- `POLY_CLOB_MICRO_SPLITS=2`
- `POLY_CLOB_MIN_INTERVAL_SEC=120`

Live mode requirements:

- `POLY_CLOB_ENABLED=true`
- `POLY_CLOB_DRY_RUN=false`
- `POLY_CLOB_API_KEY`, `POLY_CLOB_API_SECRET`, `POLY_CLOB_API_PASSPHRASE`

## 24h CLOB burn-in monitor

The burn-in checker scans the last 24h of `freedomforge-trade-loop-intelligence.service` logs and summarizes CLOB run health.
It reports `warn` when skip/error thresholds are breached and posts to `ALERT_WEBHOOK_URL` when configured.
The intelligence cycle summary/webhook now includes this snapshot as `clob burn-in (24h)` for each run.
The intelligence cycle summary/webhook now also includes `mission health (7d)`, a weekly KPI line combining warning-cycle rate, burn-in streak state, and realized tx activity.

Auto-mitigation (enabled by default):

- If burn-in status is `warn` for 2 consecutive daily checks, the system auto-applies a conservative CLOB profile to production env and requests redeploy.
- If burn-in status is `ok` for 3 consecutive daily checks, the system auto-restores the normal CLOB profile and requests redeploy.
- Conservative profile defaults:
  - `POLY_CLOB_DRY_RUN=true`
  - `POLY_CLOB_MAX_ORDERS_PER_CYCLE=1`
  - `POLY_CLOB_MICRO_SPLITS=1`
  - `POLY_CLOB_MIN_INTERVAL_SEC=300`
  - `POLY_CLOB_MIN_CONFIDENCE=0.60`
  - `POLY_CLOB_ORDER_USD=3`
  - `POLY_CLOB_ORDER_USD_MAX=10`
  - `POLY_CLOB_PRICE_FLOOR=0.40`
  - `POLY_CLOB_PRICE_CAP=0.60`

Burn-in state is persisted in `data/clob-burnin-state.env`.

Default thresholds:

- `lookback-hours=24`
- `min-runs=1`
- `skip-threshold=4`
- `error-threshold=1`
- `warn-streak-threshold=2`
- `health-streak-threshold=3`

Manual run:

```bash
sudo systemctl start freedomforge-trade-loop-clob-burnin.service
journalctl -u freedomforge-trade-loop-clob-burnin.service -n 50 --no-pager
npm run clob:burnin:autopatch
npm run clob:burnin:restore
npm run mission:health
npm run public:alpha
```
Efficiency guards now also persist per-network conversion state in `data/conversion-state.json` to suppress wasteful repeated attempts.

## Live on-chain launch

Use the guarded launcher after setting route + wallet env vars:

```bash
bash scripts/launch-live-onchain.sh --repo-dir "$PWD" --env-file .env.local
```

The launcher runs:

1. Config preflight (required secrets + route keys)
2. Dry-run conversion check
3. Live conversion execution (`CONVERSION_ENGINE_DRY_RUN=false`)
4. Collaborative intelligence cycle

Default schedules (UTC):

- Update rollout at `03:15`
- Intelligence maintenance at `00:45`, `06:45`, `12:45`, `18:45`

On your Ubuntu VM, from repo root:

```bash
chmod +x scripts/install-trade-loop-services.sh
sudo bash scripts/install-trade-loop-services.sh \
  --repo-dir "$PWD" \
  --app-base-url https://<YOUR_APP_URL> \
  --user "$USER"
```

This installs and starts 5 persistent services:

- `freedomforge-trade-loop-eth-shard0.service`
- `freedomforge-trade-loop-eth-shard1.service`
- `freedomforge-trade-loop-op.service`
- `freedomforge-trade-loop-arb.service`
- `freedomforge-trade-loop-pol.service`

Useful checks:

```bash
systemctl list-units --type=service | grep freedomforge-trade-loop
journalctl -u freedomforge-trade-loop-eth-shard0.service -f
systemctl list-timers freedomforge-trade-loop-update.timer --no-pager
systemctl list-timers freedomforge-trade-loop-intelligence.timer --no-pager
systemctl list-timers freedomforge-trade-loop-clob-burnin.timer --no-pager
sudo systemctl start freedomforge-trade-loop-update.service
sudo systemctl start freedomforge-trade-loop-intelligence.service
sudo systemctl start freedomforge-trade-loop-clob-burnin.service
npm run wallet:forensics
```

Reboot-persistence check:

```bash
sudo reboot
# after reconnect:
systemctl is-active freedomforge-trade-loop-eth-shard0.service
systemctl is-active freedomforge-trade-loop-op.service
```

## Recommended production shape

- Run on a persistent host (Oracle VM, VPS, or always-on machine).
- Keep one process per shard.
- If using multiple shards, set:
  - `BOT_SHARDS=<total>`
  - `BOT_SHARD_INDEX=<0..n-1>` per process

## Multiple profit wallets (recipients)

Set `REVENUE_RECIPIENTS` as a comma-separated list of wallets:

```bash
REVENUE_RECIPIENTS=0xWalletA,0xWalletB,0xWalletC
```

- Payouts are split evenly across active recipients.
- Invalid addresses are ignored and duplicates are de-duplicated automatically.
- For efficient sharding, set `BOT_SHARDS` close to recipient count (cap 4 currently).

## Self-reinvestment controls

The bot already reinvests via treasury retention settings:

- `SELF_SUSTAIN_REINVEST_BPS` (e.g. `3000` = 30% retained)
- `TREASURY_TARGET_ETH` (target balance for adaptive retention)
- `TREASURY_MAX_REINVEST_BPS` (upper bound during treasury deficit/risk)
- `GAS_RESERVE_ETH` (keeps gas available before payouts)

For faster compounding, increase `SELF_SUSTAIN_REINVEST_BPS` gradually (e.g. +500 bps steps) and monitor skip/throughput metrics before each bump.

## Multi-chain routing (ETH / OP / ARB / POL)

Set `ALCHEMY_NETWORK` in your deployment to one of:

- `eth-mainnet` (native ETH)
- `opt-mainnet` (Optimism)
- `arb-mainnet` (Arbitrum)
- `polygon-mainnet` (Polygon)

This allows the same agent stack to run on the chain where your capital is available.

For loop processes, set `TRADE_LOOP_NETWORK` per daemon:

- `TRADE_LOOP_NETWORK=eth-mainnet`
- `TRADE_LOOP_NETWORK=opt-mainnet`
- `TRADE_LOOP_NETWORK=arb-mainnet`
- `TRADE_LOOP_NETWORK=polygon-mainnet`

When set, the loop calls `/api/alchemy/wallet/distribute?...&network=<value>` so one deployment can execute per-chain routing.

## Optional tuning env vars

- `TRADE_LOOP_INTERVAL_MS` (default `1000`, minimum `1000`)
- `TRADE_LOOP_MAX_INTERVAL_MS` (default `10000`)
- `TRADE_LOOP_SKIP_BACKOFF_FACTOR` (default `1.35`)
- `TRADE_LOOP_SUCCESS_COOLDOWN_MS` (default `8000`) to avoid expensive rapid-fire payouts after a hit
- `TRADE_LOOP_JITTER_MS` (default `200`) random wait jitter to reduce shard collisions
- `TRADE_LOOP_SHARD_PHASE_MS` (default `300`) startup phase offset per shard
- `TRADE_LOOP_HEALTH_EVERY` (default `30` ticks)
- `TRADE_LOOP_REQUEST_TIMEOUT_MS` (default `12000`)
- `DISTRIBUTION_URL` (override full endpoint if needed)
- `HEALTH_URL` (override health endpoint)
- `MIN_PAYOUT_GAS_MULTIPLIER` (default `3`) to block uneconomic micro-payouts

Chain-specific overrides are also supported (fallback to global keys if unset):

- `MIN_PAYOUT_ETH_ETH_MAINNET`
- `MIN_PAYOUT_ETH_OPT_MAINNET`
- `MIN_PAYOUT_ETH_ARB_MAINNET`
- `MIN_PAYOUT_ETH_POLYGON_MAINNET`
- `MIN_PAYOUT_GAS_MULTIPLIER_ETH_MAINNET`
- `MIN_PAYOUT_GAS_MULTIPLIER_OPT_MAINNET`
- `MIN_PAYOUT_GAS_MULTIPLIER_ARB_MAINNET`
- `MIN_PAYOUT_GAS_MULTIPLIER_POLYGON_MAINNET`
- `GAS_RESERVE_ETH_ETH_MAINNET`
- `GAS_RESERVE_ETH_OPT_MAINNET`
- `GAS_RESERVE_ETH_ARB_MAINNET`
- `GAS_RESERVE_ETH_POLYGON_MAINNET`
- `SELF_SUSTAIN_REINVEST_BPS_ETH_MAINNET`
- `SELF_SUSTAIN_REINVEST_BPS_OPT_MAINNET`
- `SELF_SUSTAIN_REINVEST_BPS_ARB_MAINNET`
- `SELF_SUSTAIN_REINVEST_BPS_POLYGON_MAINNET`
- `MIN_PAYOUT_MAX_DYNAMIC_GAS_GUARD_WEI_ETH_MAINNET`
- `MIN_PAYOUT_MAX_DYNAMIC_GAS_GUARD_WEI_OPT_MAINNET`
- `MIN_PAYOUT_MAX_DYNAMIC_GAS_GUARD_WEI_ARB_MAINNET`
- `MIN_PAYOUT_MAX_DYNAMIC_GAS_GUARD_WEI_POLYGON_MAINNET`

`MIN_PAYOUT_MAX_DYNAMIC_GAS_GUARD_WEI_*` caps extreme gas spikes from blocking payouts indefinitely while still keeping minimum economics guardrails.

Suggested starting profile for fewer/larger and more economic payouts:

- ETH: `MIN_PAYOUT_ETH_ETH_MAINNET=0.003`, `MIN_PAYOUT_GAS_MULTIPLIER_ETH_MAINNET=6`
- OP: `MIN_PAYOUT_ETH_OPT_MAINNET=0.0015`, `MIN_PAYOUT_GAS_MULTIPLIER_OPT_MAINNET=4`
- ARB: `MIN_PAYOUT_ETH_ARB_MAINNET=0.002`, `MIN_PAYOUT_GAS_MULTIPLIER_ARB_MAINNET=5`
- POL: `MIN_PAYOUT_ETH_POLYGON_MAINNET=0.001`, `MIN_PAYOUT_GAS_MULTIPLIER_POLYGON_MAINNET=3`

## LaunchAgent (macOS) example

Create `~/Library/LaunchAgents/com.freedomforge.trade-loop.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.freedomforge.trade-loop</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>-lc</string>
      <string>cd /Users/mattyice/Desktop/freedomforge-max && APP_BASE_URL=https://<YOUR_APP_URL> TRADE_LOOP_INTERVAL_MS=1000 BOT_SHARD_INDEX=0 BOT_SHARDS=1 BOT_ID=live-0 npm run trade:loop</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/Users/mattyice/Desktop/freedomforge-max/logs/trade-loop.out.log</string>
    <key>StandardErrorPath</key><string>/Users/mattyice/Desktop/freedomforge-max/logs/trade-loop.err.log</string>
  </dict>
</plist>
```

Then load it:

```bash
launchctl load ~/Library/LaunchAgents/com.freedomforge.trade-loop.plist
launchctl start com.freedomforge.trade-loop
```

Stop it:

```bash
launchctl stop com.freedomforge.trade-loop
launchctl unload ~/Library/LaunchAgents/com.freedomforge.trade-loop.plist
```

## Safety note

A 1-second loop only *attempts* execution every second; actual transfers still depend on risk/threshold gates (`MIN_PAYOUT_ETH`, reserves, forecast controls, wallet balance, and gas availability).

For efficiency, the loop automatically backs off toward `TRADE_LOOP_MAX_INTERVAL_MS` when consecutive ticks are skipped (or failing), then instantly returns to 1-second cadence after a successful transfer.
