#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$PWD"
SERVICE_USER="${SUDO_USER:-$USER}"
ON_CALENDAR="*-*-* 23:55:00"
RANDOM_DELAY_SEC="0"
PERSISTENT="true"
LOOKBACK_HOURS="24"
MIN_RUNS="1"
SKIP_THRESHOLD="4"
ERROR_THRESHOLD="1"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
STATE_FILE="data/clob-burnin-state.env"
WARN_STREAK_THRESHOLD="2"
AUTO_PATCH_ON_WARN_STREAK="true"
HEALTH_STREAK_THRESHOLD="3"
AUTO_RESTORE_ON_HEALTH_STREAK="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir)
      REPO_DIR="$2"; shift 2 ;;
    --user)
      SERVICE_USER="$2"; shift 2 ;;
    --on-calendar)
      ON_CALENDAR="$2"; shift 2 ;;
    --random-delay-sec)
      RANDOM_DELAY_SEC="$2"; shift 2 ;;
    --persistent)
      PERSISTENT="$2"; shift 2 ;;
    --lookback-hours)
      LOOKBACK_HOURS="$2"; shift 2 ;;
    --min-runs)
      MIN_RUNS="$2"; shift 2 ;;
    --skip-threshold)
      SKIP_THRESHOLD="$2"; shift 2 ;;
    --error-threshold)
      ERROR_THRESHOLD="$2"; shift 2 ;;
    --alert-webhook-url)
      ALERT_WEBHOOK_URL="$2"; shift 2 ;;
    --state-file)
      STATE_FILE="$2"; shift 2 ;;
    --warn-streak-threshold)
      WARN_STREAK_THRESHOLD="$2"; shift 2 ;;
    --auto-patch-on-warn-streak)
      AUTO_PATCH_ON_WARN_STREAK="$2"; shift 2 ;;
    --health-streak-threshold)
      HEALTH_STREAK_THRESHOLD="$2"; shift 2 ;;
    --auto-restore-on-health-streak)
      AUTO_RESTORE_ON_HEALTH_STREAK="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

if [[ ! -f "$REPO_DIR/scripts/trade-loop-clob-burnin-check.sh" ]]; then
  echo "Missing $REPO_DIR/scripts/trade-loop-clob-burnin-check.sh" >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "User not found: $SERVICE_USER" >&2
  exit 1
fi

SERVICE_NAME="freedomforge-trade-loop-clob-burnin.service"
TIMER_NAME="freedomforge-trade-loop-clob-burnin.timer"
SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME"
TIMER_PATH="/etc/systemd/system/$TIMER_NAME"

sudo tee "$SERVICE_PATH" >/dev/null <<EOF
[Unit]
Description=FreedomForge CLOB 24h Burn-in Check
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash '$REPO_DIR/scripts/trade-loop-clob-burnin-check.sh' --repo-dir '$REPO_DIR' --lookback-hours '$LOOKBACK_HOURS' --min-runs '$MIN_RUNS' --skip-threshold '$SKIP_THRESHOLD' --error-threshold '$ERROR_THRESHOLD' --alert-webhook-url '$ALERT_WEBHOOK_URL' --state-file '$STATE_FILE' --warn-streak-threshold '$WARN_STREAK_THRESHOLD' --auto-patch-on-warn-streak '$AUTO_PATCH_ON_WARN_STREAK' --health-streak-threshold '$HEALTH_STREAK_THRESHOLD' --auto-restore-on-health-streak '$AUTO_RESTORE_ON_HEALTH_STREAK'
User=$SERVICE_USER
EOF

sudo tee "$TIMER_PATH" >/dev/null <<EOF
[Unit]
Description=Schedule FreedomForge CLOB Burn-in Check

[Timer]
OnCalendar=$ON_CALENDAR
RandomizedDelaySec=$RANDOM_DELAY_SEC
Persistent=$PERSISTENT
Unit=$SERVICE_NAME

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now "$TIMER_NAME"

if ! systemctl is-enabled --quiet "$TIMER_NAME"; then
  echo "Failed to enable $TIMER_NAME" >&2
  exit 1
fi

if ! systemctl is-active --quiet "$TIMER_NAME"; then
  echo "Timer not active: $TIMER_NAME" >&2
  exit 1
fi

echo "✅ CLOB burn-in timer installed"
echo "Inspect timer: systemctl status $TIMER_NAME --no-pager"
echo "Next runs: systemctl list-timers '$TIMER_NAME' --no-pager"
echo "Run now: sudo systemctl start $SERVICE_NAME"
