#!/usr/bin/env bash
set -euo pipefail

##
# Quick-deploy: push latest code to VM and restart services.
#
# Usage:
#   bash scripts/deploy-to-vm.sh [--key /path/to/key] [--host IP] [--env-file .env.local]
#
# Defaults: uses ORACLE_SSH_KEY, ORACLE_VM_HOST env vars or common paths.
##

KEY="${ORACLE_SSH_KEY:-${HOME}/Downloads/ssh-key-2026-03-08.key}"
HOST="${ORACLE_VM_HOST:-150.136.245.31}"
USER="${ORACLE_VM_USER:-opc}"
REMOTE_DIR="/home/opc/freedomforge-max"
ENV_FILE=".env.local"
BRANCH="${DEPLOY_BRANCH:-main}"
SKIP_GIT_PUSH="${SKIP_GIT_PUSH:-false}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --key) KEY="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --user) USER="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --skip-git-push) SKIP_GIT_PUSH="true"; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

SSH_OPTS="-o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -i $KEY"

echo "[deploy] target=$USER@$HOST remote=$REMOTE_DIR branch=$BRANCH"

# 1. Git push local changes (unless skipped)
if [[ "$SKIP_GIT_PUSH" != "true" ]]; then
  echo "[deploy] pushing local commits..."
  git add -A && git diff --cached --quiet || git commit -m "auto-deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)" --allow-empty
  git push origin "$BRANCH" 2>/dev/null || echo "[deploy] push skipped (may already be up to date)"
fi

# 2. Connect and pull latest on remote
echo "[deploy] syncing remote repo..."
# shellcheck disable=SC2029
ssh $SSH_OPTS "$USER@$HOST" "
  set -e
  cd '$REMOTE_DIR' || exit 1
  git fetch --all --prune
  git reset --hard origin/$BRANCH
  npm install --omit=dev --prefer-offline 2>/dev/null || npm install --omit=dev
  echo '[deploy] remote code synced'
"

# 3. Upload .env.local
if [[ -f "$ENV_FILE" ]]; then
  echo "[deploy] uploading $ENV_FILE..."
  scp $SSH_OPTS "$ENV_FILE" "$USER@$HOST:$REMOTE_DIR/.env.local"
fi

# 4. Restart active services
echo "[deploy] restarting services..."
# shellcheck disable=SC2029
ssh $SSH_OPTS "$USER@$HOST" "
  set -e
  for svc in freedomforge-trade-loop-shard0 freedomforge-trade-loop-shard1 freedomforge-trade-loop-pol freedomforge-trade-loop-arb freedomforge-trade-loop-op; do
    sudo systemctl restart \$svc 2>/dev/null && echo \"  restarted \$svc\" || true
  done
  # Trigger an immediate intelligence cycle
  sudo systemctl start freedomforge-trade-loop-intelligence.service 2>/dev/null || true
  echo '[deploy] services restarted'
"

echo "[deploy] done at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
