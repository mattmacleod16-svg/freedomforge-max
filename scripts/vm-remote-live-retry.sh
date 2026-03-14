#!/usr/bin/env bash
set -euo pipefail

HOST=""
USER_NAME="ubuntu"
KEY_PATH=""
REPO_URL=""
REMOTE_DIR="/opt/freedomforge-max"
LOCAL_ENV_FILE=".env.local"
APP_BASE_URL="https://freedomforge-max.up.railway.app"
LIVE_ONCE="true"
RETRIES="120"
SLEEP_SEC="20"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      cat <<'EOF'
Usage:
  bash scripts/vm-remote-live-retry.sh \
    --host <VM_HOST_OR_IP> \
    --user <VM_USER> \
    --key <PATH_TO_SSH_PRIVATE_KEY> \
    [--repo <GIT_REPO_URL>] \
    [--remote-dir /opt/freedomforge-max] \
    [--env-file .env.local] \
    [--app-base-url https://freedomforge-max.up.railway.app] \
    [--live-once true|false] \
    [--retries 120] \
    [--sleep-sec 20]
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
    --env-file)
      LOCAL_ENV_FILE="$2"; shift 2 ;;
    --app-base-url)
      APP_BASE_URL="$2"; shift 2 ;;
    --live-once)
      LIVE_ONCE="$2"; shift 2 ;;
    --retries)
      RETRIES="$2"; shift 2 ;;
    --sleep-sec)
      SLEEP_SEC="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

if [[ -z "$HOST" ]]; then
  echo "Missing --host" >&2
  exit 1
fi

if [[ -z "$KEY_PATH" || ! -f "$KEY_PATH" ]]; then
  echo "Missing valid --key <ssh-private-key-path>." >&2
  exit 1
fi

SSH_DEST="$USER_NAME@$HOST"
SSH_OPTS=(
  -o ConnectTimeout=12
  -o ConnectionAttempts=1
  -o StrictHostKeyChecking=accept-new
  -i "$KEY_PATH"
)

for ((i=1; i<=RETRIES; i++)); do
  echo "[vm-remote-live-retry] ssh-check $i/$RETRIES"
  if ssh "${SSH_OPTS[@]}" "$SSH_DEST" 'echo VM_ONLINE >/dev/null'; then
    echo "[vm-remote-live-retry] ssh reachable; launching remote live flow"
    exec bash scripts/polymarket-remote-live.sh \
      --host "$HOST" \
      --user "$USER_NAME" \
      --key "$KEY_PATH" \
      --repo "$REPO_URL" \
      --remote-dir "$REMOTE_DIR" \
      --env-file "$LOCAL_ENV_FILE" \
      --app-base-url "$APP_BASE_URL" \
      --live-once "$LIVE_ONCE"
  fi
  sleep "$SLEEP_SEC"
done

echo "[vm-remote-live-retry] failed: ssh still unreachable after $RETRIES attempts" >&2
exit 1
