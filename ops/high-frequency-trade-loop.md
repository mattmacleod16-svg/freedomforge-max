# High-Frequency Trade Loop (1s cadence)

Use this when you want near-real-time trade/distribution attempts rather than cron-based scheduling.

## Why this exists

- GitHub Actions cron cannot run every second.
- Vercel cron jobs are also not second-level.
- This loop runs as a persistent process and can attempt execution every `1000ms`.

## Start locally or on VM

```bash
cd /Users/mattyice/Desktop/freedomforge-max
APP_BASE_URL=https://freedomforge-max.vercel.app \
TRADE_LOOP_INTERVAL_MS=1000 \
BOT_SHARD_INDEX=0 \
BOT_SHARDS=1 \
BOT_ID=live-0 \
npm run trade:loop
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

## Optional tuning env vars

- `TRADE_LOOP_INTERVAL_MS` (default `1000`, minimum `1000`)
- `TRADE_LOOP_MAX_INTERVAL_MS` (default `10000`)
- `TRADE_LOOP_SKIP_BACKOFF_FACTOR` (default `1.35`)
- `TRADE_LOOP_HEALTH_EVERY` (default `30` ticks)
- `TRADE_LOOP_REQUEST_TIMEOUT_MS` (default `12000`)
- `DISTRIBUTION_URL` (override full endpoint if needed)
- `HEALTH_URL` (override health endpoint)

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
      <string>cd /Users/mattyice/Desktop/freedomforge-max && APP_BASE_URL=https://freedomforge-max.vercel.app TRADE_LOOP_INTERVAL_MS=1000 BOT_SHARD_INDEX=0 BOT_SHARDS=1 BOT_ID=live-0 npm run trade:loop</string>
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
