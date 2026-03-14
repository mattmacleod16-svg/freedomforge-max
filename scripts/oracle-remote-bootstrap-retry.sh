#!/usr/bin/env bash
set -euo pipefail

HOST=""
USER_NAME="opc"
KEY_PATH="$HOME/Downloads/ssh-key-2026-03-05.key"
REPO_URL="https://github.com/mattmacleod16-svg/freedomforge-max.git"
REMOTE_DIR="/home/opc/freedomforge-max"
APP_BASE_URL="https://freedomforge-max.up.railway.app"
RETRIES="30"
SLEEP_SEC="15"

while [[ $# -gt 0 ]]; do
  case "$1" in
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
  echo "Missing required --host (example: 129.80.97.247)" >&2
  exit 1
fi

if [[ ! -f "$KEY_PATH" ]]; then
  echo "SSH private key not found: $KEY_PATH" >&2
  exit 1
fi

if [[ ! -f "scripts/oracle-trade-loop-bootstrap.sh" ]]; then
  echo "Run this from repo root (missing scripts/oracle-trade-loop-bootstrap.sh)" >&2
  exit 1
fi

SSH_DEST="$USER_NAME@$HOST"

for ((i=1; i<=RETRIES; i++)); do
  echo "[oracle-remote-bootstrap] attempt $i/$RETRIES: waiting for ssh banner/login"
  if ssh -o ConnectTimeout=20 -o ConnectionAttempts=1 -o StrictHostKeyChecking=accept-new -i "$KEY_PATH" "$SSH_DEST" 'echo VM_ONLINE >/dev/null'; then
    echo "[oracle-remote-bootstrap] ssh login successful"

    echo "[oracle-remote-bootstrap] streaming bootstrap script to remote host"
    cat scripts/oracle-trade-loop-bootstrap.sh | ssh -o ConnectTimeout=30 -o ConnectionAttempts=1 -o StrictHostKeyChecking=accept-new -i "$KEY_PATH" "$SSH_DEST" \
      "bash -s -- --repo '$REPO_URL' --dir '$REMOTE_DIR' --app-base-url '$APP_BASE_URL' --user '$USER_NAME'"

    echo "[oracle-remote-bootstrap] verifying timers/services"
    ssh -o ConnectTimeout=30 -o ConnectionAttempts=1 -o StrictHostKeyChecking=accept-new -i "$KEY_PATH" "$SSH_DEST" \
      "systemctl list-timers 'freedomforge-trade-loop-*.timer' 'freedomforge-superagent-selftest.timer' --no-pager || true; \
       systemctl is-active freedomforge-trade-loop-intelligence.timer; \
       systemctl is-active freedomforge-trade-loop-update.timer; \
       systemctl is-active freedomforge-trade-loop-clob-burnin.timer; \
       systemctl is-active freedomforge-superagent-selftest.timer"

    echo "[oracle-remote-bootstrap] complete"
    exit 0
  fi
  sleep "$SLEEP_SEC"
done

echo "[oracle-remote-bootstrap] failed: ssh never stabilized after $RETRIES attempts" >&2
exit 1
