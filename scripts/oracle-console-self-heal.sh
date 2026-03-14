#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-/home/opc/freedomforge-max}"
SERVICE_USER="${2:-opc}"
APP_BASE_URL="${APP_BASE_URL:-https://freedomforge-max.up.railway.app}"

echo "[oracle-self-heal] repo=$REPO_DIR user=$SERVICE_USER app=$APP_BASE_URL"

if command -v sudo >/dev/null 2>&1; then
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl daemon-reload || true
    sudo systemctl restart ssh || sudo systemctl restart sshd || true
  fi
fi

if [[ ! -d "$REPO_DIR" ]]; then
  echo "[oracle-self-heal] missing repo dir: $REPO_DIR" >&2
  exit 1
fi

cd "$REPO_DIR"

if [[ ! -f "package.json" ]]; then
  echo "[oracle-self-heal] package.json missing in $REPO_DIR" >&2
  exit 1
fi

if command -v git >/dev/null 2>&1; then
  git fetch --all --prune || true
  git pull --ff-only || true
fi

if [[ ! -f "scripts/oracle-enable-superagent-autonomy.sh" ]]; then
  echo "[oracle-self-heal] missing scripts/oracle-enable-superagent-autonomy.sh" >&2
  exit 1
fi

bash scripts/oracle-enable-superagent-autonomy.sh \
  --repo-dir "$REPO_DIR" \
  --user "$SERVICE_USER" \
  --app-base-url "$APP_BASE_URL"

echo "[oracle-self-heal] forcing immediate validation run"
sudo systemctl start freedomforge-trade-loop-intelligence.service || true

echo "[oracle-self-heal] timer states"
systemctl is-active freedomforge-trade-loop-intelligence.timer || true
systemctl is-active freedomforge-trade-loop-update.timer || true
systemctl is-active freedomforge-trade-loop-clob-burnin.timer || true
systemctl is-active freedomforge-superagent-selftest.timer || true
systemctl is-active freedomforge-x-growth.timer || true

echo "[oracle-self-heal] core loop states"
systemctl is-active freedomforge-trade-loop-eth-shard0.service || true
systemctl is-active freedomforge-trade-loop-eth-shard1.service || true
systemctl is-active freedomforge-trade-loop-op.service || true
systemctl is-active freedomforge-trade-loop-arb.service || true
systemctl is-active freedomforge-trade-loop-pol.service || true

echo "oracle-enforce-success"
