#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$PWD"
SERVICE_USER="${SUDO_USER:-$USER}"
APP_BASE_URL="https://freedomforge-max.vercel.app"
ENABLE_X_AUTOMATION="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir)
      REPO_DIR="$2"; shift 2 ;;
    --user)
      SERVICE_USER="$2"; shift 2 ;;
    --app-base-url)
      APP_BASE_URL="$2"; shift 2 ;;
    --enable-x-automation)
      ENABLE_X_AUTOMATION="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

if [[ ! -f "$REPO_DIR/package.json" ]]; then
  echo "package.json not found in --repo-dir=$REPO_DIR" >&2
  exit 1
fi

for script in \
  scripts/install-trade-loop-services.sh \
  scripts/install-trade-loop-autoupdate.sh \
  scripts/install-trade-loop-intelligence.sh \
  scripts/install-trade-loop-clob-burnin.sh \
  scripts/install-superagent-selftest.sh
do
  if [[ ! -f "$REPO_DIR/$script" ]]; then
    echo "Missing required script: $REPO_DIR/$script" >&2
    exit 1
  fi
done

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "User not found: $SERVICE_USER" >&2
  exit 1
fi

cd "$REPO_DIR"

echo "[superagent] installing persistent trade loop services"
sudo bash scripts/install-trade-loop-services.sh \
  --repo-dir "$REPO_DIR" \
  --app-base-url "$APP_BASE_URL" \
  --user "$SERVICE_USER" \
  --install-deps true

echo "[superagent] installing nightly update timer"
sudo bash scripts/install-trade-loop-autoupdate.sh \
  --repo-dir "$REPO_DIR" \
  --user "$SERVICE_USER" \
  --on-calendar "*-*-* 03:15:00" \
  --random-delay-sec "0" \
  --persistent true

echo "[superagent] installing intelligence cycle timer"
sudo bash scripts/install-trade-loop-intelligence.sh \
  --repo-dir "$REPO_DIR" \
  --user "$SERVICE_USER" \
  --app-base-url "$APP_BASE_URL" \
  --on-calendar "*-*-* 00,06,12,18:45:00" \
  --random-delay-sec "0" \
  --persistent true \
  --timeout-sec "2400"

echo "[superagent] installing CLOB burn-in guard timer"
sudo bash scripts/install-trade-loop-clob-burnin.sh \
  --repo-dir "$REPO_DIR" \
  --user "$SERVICE_USER" \
  --on-calendar "*-*-* 23:55:00" \
  --random-delay-sec "0" \
  --persistent true \
  --lookback-hours "24" \
  --min-runs "1" \
  --skip-threshold "4" \
  --error-threshold "1" \
  --warn-streak-threshold "2" \
  --auto-patch-on-warn-streak "true" \
  --health-streak-threshold "3" \
  --auto-restore-on-health-streak "true"

echo "[superagent] installing weekly self-test + auto-repair timer"
sudo bash scripts/install-superagent-selftest.sh \
  --repo-dir "$REPO_DIR" \
  --user "$SERVICE_USER" \
  --app-base-url "$APP_BASE_URL" \
  --on-calendar "Sun *-*-* 04:30:00" \
  --random-delay-sec "0" \
  --persistent true

if [[ "$ENABLE_X_AUTOMATION" == "true" ]]; then
  if [[ ! -f "$REPO_DIR/scripts/install-x-growth.sh" ]]; then
    echo "Missing optional script for X automation: $REPO_DIR/scripts/install-x-growth.sh" >&2
    exit 1
  fi
  echo "[superagent] installing x-growth automation timer"
  sudo bash scripts/install-x-growth.sh \
    --repo-dir "$REPO_DIR" \
    --user "$SERVICE_USER" \
    --app-base-url "$APP_BASE_URL" \
    --on-calendar "*-*-* 02,10,18:20:00" \
    --random-delay-sec "0" \
    --persistent true \
    --x-dry-run "true" \
    --x-force "false"
else
  echo "[superagent] skipping x-growth automation timer (core-profit mode)"
  if systemctl list-unit-files freedomforge-x-growth.timer >/dev/null 2>&1; then
    sudo systemctl disable --now freedomforge-x-growth.timer || true
  fi
  if systemctl list-unit-files freedomforge-x-growth.service >/dev/null 2>&1; then
    sudo systemctl stop freedomforge-x-growth.service || true
  fi
fi

echo "[superagent] running intelligence cycle now"
sudo systemctl start freedomforge-trade-loop-intelligence.service

echo
echo "✅ Autonomous superagent is enabled on Oracle VM"
echo "Timers:"
systemctl list-timers 'freedomforge-trade-loop-*.timer' --no-pager || true
echo
echo "Health checks:"
echo "  systemctl is-active freedomforge-trade-loop-eth-shard0.service"
echo "  systemctl is-active freedomforge-trade-loop-intelligence.timer"
echo "  systemctl is-active freedomforge-trade-loop-update.timer"
echo "  systemctl is-active freedomforge-trade-loop-clob-burnin.timer"
echo "  systemctl is-active freedomforge-superagent-selftest.timer"
if [[ "$ENABLE_X_AUTOMATION" == "true" ]]; then
  echo "  systemctl is-active freedomforge-x-growth.timer"
fi
