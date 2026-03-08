#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$PWD"
SERVICE_USER="${SUDO_USER:-$USER}"
APP_BASE_URL="https://freedomforge-max.vercel.app"
ON_CALENDAR="*-*-* 03:15:00"
RANDOM_DELAY_SEC="0"
PERSISTENT="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir)
      REPO_DIR="$2"; shift 2 ;;
    --user)
      SERVICE_USER="$2"; shift 2 ;;
    --app-base-url)
      APP_BASE_URL="$2"; shift 2 ;;
    --on-calendar)
      ON_CALENDAR="$2"; shift 2 ;;
    --random-delay-sec)
      RANDOM_DELAY_SEC="$2"; shift 2 ;;
    --persistent)
      PERSISTENT="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

if [[ ! -f "$REPO_DIR/scripts/trade-loop-update.sh" ]]; then
  echo "Missing $REPO_DIR/scripts/trade-loop-update.sh" >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "User not found: $SERVICE_USER" >&2
  exit 1
fi

SERVICE_NAME="freedomforge-trade-loop-update.service"
TIMER_NAME="freedomforge-trade-loop-update.timer"
SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME"
TIMER_PATH="/etc/systemd/system/$TIMER_NAME"

sudo tee "$SERVICE_PATH" >/dev/null <<EOF
[Unit]
Description=FreedomForge Trade Loop Nightly Update
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash '$REPO_DIR/scripts/trade-loop-update.sh' --repo-dir '$REPO_DIR' --user '$SERVICE_USER' --install-deps true --app-base-url '$APP_BASE_URL'
EOF

sudo tee "$TIMER_PATH" >/dev/null <<EOF
[Unit]
Description=Schedule FreedomForge Trade Loop Nightly Update

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

echo "✅ Auto-update timer installed"
echo "Inspect timer: systemctl status $TIMER_NAME --no-pager"
echo "Next runs: systemctl list-timers '$TIMER_NAME' --no-pager"
echo "Run update now: sudo systemctl start $SERVICE_NAME"
