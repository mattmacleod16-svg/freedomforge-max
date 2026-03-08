# Polymarket-Style MVP API Checklist (Ultra-Short Automation)

This checklist is designed for your current stack and mission: continuous, small-edge execution with strict risk controls.

## 1) Core Trading APIs (Required)

- Polymarket CLOB API credentials:
  - `POLY_CLOB_API_KEY`
  - `POLY_CLOB_API_SECRET`
  - `POLY_CLOB_API_PASSPHRASE`
- Polymarket endpoints:
  - `POLY_CLOB_REST_URL` (example: `https://clob.polymarket.com`)
  - `POLY_CLOB_WS_URL` (example: `wss://ws-subscriptions-clob.polymarket.com/ws`)
  - Engine runner: `npm run polymarket:clob`
- Gamma discovery endpoint:
  - `PREDICTION_MARKET_ENDPOINT` (already present in your stack; defaults to Polymarket Gamma)

## 2) Wallet / Settlement (Required)

- Signing key:
  - `WALLET_PRIVATE_KEY`
- Chain RPC:
  - `ALCHEMY_API_KEY`
  - `ALCHEMY_NETWORK` (set to execution chain)

## 3) Execution / Routing (Required for your current swap engine)

- 0x route API key:
  - `ZEROX_API_KEY`
- Conversion controls:
  - `CONVERSION_ENGINE_ENABLED=true`
  - `CONVERSION_ENGINE_DRY_RUN=false` (after dry-run validation)
  - `CONVERSION_NETWORKS=<chain-list>`
  - `CONVERSION_FROM_TOKEN_<CHAIN>`
  - `CONVERSION_TO_TOKEN_<CHAIN>`

## 4) Observability + Safety (Required)

- Alert pipeline:
  - `ALERT_WEBHOOK_URL`
- Cycle notifier + policy updater prerequisites:
  - Vercel CLI authenticated on runtime host OR `VERCEL_TOKEN` + project refs
- Core guardrails:
  - `MIN_PAYOUT_ETH_<CHAIN>`
  - `MIN_PAYOUT_GAS_MULTIPLIER_<CHAIN>`
  - `GAS_RESERVE_ETH_<CHAIN>`
  - `CASHFLOW_CIRCUIT_BREAKER_ENABLED=true`

## 5) Helpful Optional APIs

- CEX micro-momentum feeds (for lead/lag signals): Binance/Coinbase/Bybit market data
- Additional DEX aggregators for route redundancy (if 0x degrades)
- Telegram bot API for direct cycle summaries

## 6) Go-Live Sequence (MVP)

1. Fill env template in `ops/polymarket-mvp.env.example`.
2. Run preflight:
  - local env: `npm run api:preflight`
  - production-pulled env: `npm run api:preflight:prod`
3. Run dry cycle: `bash scripts/trade-loop-intelligence-maintain.sh` with `CONVERSION_ENGINE_DRY_RUN=true` and `POLY_CLOB_DRY_RUN=true`.
4. Enable live conversion: `CONVERSION_ENGINE_DRY_RUN=false`.
5. Enable live CLOB: `POLY_CLOB_ENABLED=true`, `POLY_CLOB_DRY_RUN=false`.
6. Verify tx + cycle summary alerts.

## 7) Fast Reality Check

- If your edge size is small, prioritize execution quality and fee/slippage minimization over trade count.
- Keep fixed sizing + split execution + strict loss-of-edge skip logic as default behavior.
