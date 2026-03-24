# Multichain Launch Runbook

This project now supports coordinated launch execution across:
- Ethereum (via conversion engine)
- Solana (via Solana engine preflight/launch readiness)
- MultiversX (via MultiversX engine)

## Commands

- Dry-run across all chains:
  - `npm run launch:multichain`
- Live launch across all chains:
  - `npm run launch:multichain:live`
- Chain-specific execution:
  - `npm run ethereum:engine`
  - `npm run solana:engine`
  - `npm run multiversx:engine`

## Required Environment

### Ethereum

- `ALCHEMY_API_KEY`
- `WALLET_PRIVATE_KEY`
- `CONVERSION_NETWORKS` should include `eth-mainnet`
- `CONVERSION_FROM_TOKEN_ETH_MAINNET`
- `CONVERSION_TO_TOKEN_ETH_MAINNET`

### Solana

- `SOLANA_ENABLED=true`
- `SOLANA_DRY_RUN=true|false`
- `SOLANA_RPC_URL` (default: `https://api.mainnet-beta.solana.com`)
- `SOLANA_WALLET_ADDRESS` (required for live readiness)

### MultiversX

- `MVX_ENABLED=true`
- `MVX_DRY_RUN=true|false`
- MultiversX client credentials expected by `lib/multiversx/client`

## Recommended Launch Sequence

1. Run dry-run for all chains:
   - `npm run launch:multichain`
2. Resolve all `skipped` reasons in output JSON.
3. Run live launch:
   - `npm run launch:multichain:live`
4. Monitor platform health:
   - `npm run mission:health`
   - `npm run monitor`

## Notes

- The multi-chain launcher exits non-zero if any chain reports an execution error.
- `skipped` indicates missing configuration or intentional safeguards.
- Keep kill switch and capital mandate protections enabled for live operation.
