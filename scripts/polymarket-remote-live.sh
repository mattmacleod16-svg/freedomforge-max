#!/usr/bin/env bash
set -euo pipefail

HOST=""
USER_NAME="ubuntu"
KEY_PATH=""
REMOTE_DIR="/opt/freedomforge-max"
REPO_URL=""
APP_BASE_URL="https://freedomforge-max.up.railway.app"
LOCAL_ENV_FILE=".env.local"
LIVE_ONCE="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      cat <<'EOF'
Usage:
  bash scripts/polymarket-remote-live.sh \
    --host <REMOTE_HOST_OR_IP> \
    --user <REMOTE_USER> \
    --key <PATH_TO_SSH_PRIVATE_KEY> \
    [--repo <GIT_REPO_URL>] \
    [--remote-dir /opt/freedomforge-max] \
    [--env-file .env.local] \
    [--app-base-url https://freedomforge-max.up.railway.app] \
    [--live-once true|false]
EOF
      exit 0
      ;;
    --host)
      HOST="$2"; shift 2 ;;
    --user)
      USER_NAME="$2"; shift 2 ;;
    --key)
      KEY_PATH="$2"; shift 2 ;;
    --repo)
      REPO_URL="$2"; shift 2 ;;
    --remote-dir)
      REMOTE_DIR="$2"; shift 2 ;;
    --app-base-url)
      APP_BASE_URL="$2"; shift 2 ;;
    --env-file)
      LOCAL_ENV_FILE="$2"; shift 2 ;;
    --live-once)
      LIVE_ONCE="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

if [[ -z "$HOST" ]]; then
  echo "Missing --host (allowed-region VM public IP or hostname)." >&2
  exit 1
fi

if [[ -z "$KEY_PATH" || ! -f "$KEY_PATH" ]]; then
  echo "Missing valid --key <ssh-private-key-path>." >&2
  exit 1
fi

if [[ ! -f "$LOCAL_ENV_FILE" ]]; then
  echo "Local env file not found: $LOCAL_ENV_FILE" >&2
  exit 1
fi

if [[ -z "$REPO_URL" ]]; then
  if git config --get remote.origin.url >/dev/null 2>&1; then
    REPO_URL="$(git config --get remote.origin.url)"
  else
    echo "Missing --repo and no git origin configured." >&2
    exit 1
  fi
fi

required_keys=(
  WALLET_PRIVATE_KEY
  ALCHEMY_API_KEY
  POLY_CLOB_API_KEY
  POLY_CLOB_API_SECRET
  POLY_CLOB_API_PASSPHRASE
)

for key in "${required_keys[@]}"; do
  if ! grep -Eq "^${key}=" "$LOCAL_ENV_FILE"; then
    echo "Missing required key in $LOCAL_ENV_FILE: $key" >&2
    exit 1
  fi
  value="$(grep -E "^${key}=" "$LOCAL_ENV_FILE" | tail -n1 | cut -d'=' -f2-)"
  if [[ -z "${value//\"/}" || "$value" == '""' ]]; then
    echo "Empty required key in $LOCAL_ENV_FILE: $key" >&2
    exit 1
  fi
done

SSH_OPTS=(
  -o ConnectTimeout=20
  -o ConnectionAttempts=1
  -o StrictHostKeyChecking=accept-new
  -i "$KEY_PATH"
)
SSH_DEST="$USER_NAME@$HOST"

echo "[polymarket-remote-live] checking ssh connectivity"
ssh "${SSH_OPTS[@]}" "$SSH_DEST" 'echo remote-online >/dev/null'

echo "[polymarket-remote-live] provisioning runtime on remote host"
ssh "${SSH_OPTS[@]}" "$SSH_DEST" "set -e
if command -v apt >/dev/null 2>&1; then
  sudo apt update >/dev/null
  sudo apt install -y ca-certificates curl git >/dev/null
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null
  sudo apt install -y nodejs >/dev/null
fi
if [[ ! -d '$REMOTE_DIR/.git' ]]; then
  sudo mkdir -p '$REMOTE_DIR'
  sudo chown -R '$USER_NAME':'$USER_NAME' '$REMOTE_DIR'
  git clone '$REPO_URL' '$REMOTE_DIR' >/dev/null
else
  git -C '$REMOTE_DIR' fetch --all --prune >/dev/null
  git -C '$REMOTE_DIR' pull --ff-only >/dev/null
fi
cd '$REMOTE_DIR'
npm ci --omit=dev >/dev/null
"

tmp_env="$(mktemp)"
{
  echo "APP_BASE_URL=\"$APP_BASE_URL\""
  grep -E '^(WALLET_PRIVATE_KEY|ALCHEMY_API_KEY|ALCHEMY_NETWORK|POLY_CLOB_API_KEY|POLY_CLOB_API_SECRET|POLY_CLOB_API_PASSPHRASE|POLY_CLOB_REST_URL|POLY_CLOB_WS_URL|PREDICTION_MARKET_ENDPOINT|POLY_CLOB_ENABLED|POLY_CLOB_DRY_RUN|POLY_CLOB_MIN_CONFIDENCE|POLY_CLOB_MIN_INTERVAL_SEC|POLY_CLOB_MAX_ORDERS_PER_CYCLE|POLY_CLOB_MICRO_SPLITS|POLY_CLOB_ORDER_USD|POLY_CLOB_ORDER_USD_MAX|POLY_CLOB_PRICE_FLOOR|POLY_CLOB_PRICE_CAP|POLY_CLOB_ASSET_FALLBACK_ENABLED|POLY_CLOB_FALLBACK_ASSETS|POLY_CLOB_ANY_ACTIVE_FALLBACK_ENABLED|POLY_CLOB_SHORT_FALLBACK_ENABLED|POLY_CLOB_SHORT_FALLBACK_MAX_HOURS)=' "$LOCAL_ENV_FILE" || true
} > "$tmp_env"

echo "[polymarket-remote-live] uploading scoped runtime env"
scp "${SSH_OPTS[@]}" "$tmp_env" "$SSH_DEST:$REMOTE_DIR/.env.local" >/dev/null
rm -f "$tmp_env"

if [[ "$LIVE_ONCE" == "true" ]]; then
  echo "[polymarket-remote-live] executing one immediate live CLOB cycle"
  ssh "${SSH_OPTS[@]}" "$SSH_DEST" "set -e
cd '$REMOTE_DIR'
POLY_CLOB_ENABLED=true POLY_CLOB_DRY_RUN=false POLY_CLOB_MIN_INTERVAL_SEC=0 npm run polymarket:clob
"
  echo "[polymarket-remote-live] completed"
else
  echo "[polymarket-remote-live] setup complete (live execution skipped by --live-once=false)"
fi
