#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${PWD}"
ENV_FILE=".env.local"
RUN_INTELLIGENCE_CYCLE="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir)
      REPO_DIR="$2"; shift 2 ;;
    --env-file)
      ENV_FILE="$2"; shift 2 ;;
    --run-intelligence-cycle)
      RUN_INTELLIGENCE_CYCLE="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

cd "$REPO_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

required_keys=(
  "WALLET_PRIVATE_KEY"
  "ALCHEMY_API_KEY"
  "CONVERSION_NETWORKS"
)

missing=0
for key in "${required_keys[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env: $key" >&2
    missing=1
  fi
done

networks_csv="${CONVERSION_NETWORKS:-}"
IFS=',' read -r -a networks <<< "$networks_csv"
for raw in "${networks[@]}"; do
  network="$(echo "$raw" | xargs)"
  case "$network" in
    eth-mainnet)
      suffix="ETH_MAINNET" ;;
    opt-mainnet|optimism-mainnet|op)
      suffix="OPT_MAINNET" ;;
    arb-mainnet|arbitrum-mainnet|arb)
      suffix="ARB_MAINNET" ;;
    polygon-mainnet|matic-mainnet|polygon|matic)
      suffix="POLYGON_MAINNET" ;;
    base-mainnet|base)
      suffix="BASE_MAINNET" ;;
    *)
      suffix="" ;;
  esac

  if [[ -z "$suffix" ]]; then
    echo "Unsupported network in CONVERSION_NETWORKS: $network" >&2
    missing=1
    continue
  fi

  from_key="CONVERSION_FROM_TOKEN_${suffix}"
  to_key="CONVERSION_TO_TOKEN_${suffix}"

  if [[ -z "${!from_key:-}" ]]; then
    echo "Missing required env: $from_key" >&2
    missing=1
  fi
  if [[ -z "${!to_key:-}" ]]; then
    echo "Missing required env: $to_key" >&2
    missing=1
  fi
done

if [[ "$missing" -ne 0 ]]; then
  echo
  echo "❌ Live launch blocked by missing configuration."
  echo "Set the missing env vars and rerun."
  exit 2
fi

echo "Running preflight dry-run on configured routes"
CONVERSION_ENGINE_ENABLED=true CONVERSION_ENGINE_DRY_RUN=true npm run conversion:engine

echo "Launching live on-chain conversion execution"
CONVERSION_ENGINE_ENABLED=true CONVERSION_ENGINE_DRY_RUN=false npm run conversion:engine

if [[ "$RUN_INTELLIGENCE_CYCLE" == "true" ]]; then
  echo "Running collaborative intelligence cycle"
  bash scripts/trade-loop-intelligence-maintain.sh || true
fi

echo "✅ Live launch sequence completed"
