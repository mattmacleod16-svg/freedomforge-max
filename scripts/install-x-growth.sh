#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$PWD"
SERVICE_USER="${SUDO_USER:-$USER}"
APP_BASE_URL="https://freedomforge-max.vercel.app"
ON_CALENDAR="*-*-* 02,10,18:20:00"
RANDOM_DELAY_SEC="0"
PERSISTENT="true"
X_DRY_RUN="true"
X_FORCE="false"

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
    --x-dry-run)
      X_DRY_RUN="$2"; shift 2 ;;
    --x-force)
      X_FORCE="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

if [[ ! -f "$REPO_DIR/package.json" ]]; then
  echo "package.json not found in --repo-dir=$REPO_DIR" >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "User not found: $SERVICE_USER" >&2
  exit 1
fi

SERVICE_NAME="freedomforge-x-growth.service"
TIMER_NAME="freedomforge-x-growth.timer"
SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME"
TIMER_PATH="/etc/systemd/system/$TIMER_NAME"

sudo tee "$SERVICE_PATH" >/dev/null <<EOF
[Unit]
Description=FreedomForge X Growth Automation
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$SERVICE_USER
WorkingDirectory=$REPO_DIR
Environment=APP_BASE_URL=$APP_BASE_URL
Environment=X_DRY_RUN=$X_DRY_RUN
Environment=X_FORCE=$X_FORCE
Environment=X_POST_STYLE=proof
Environment=X_POST_REQUIRE_PROFIT=true
Environment=X_POST_MIN_NET_ETH=0.002
Environment=X_POST_MIN_SUCCESS_RATE=0.80
Environment=X_POST_MIN_ATTEMPTS=3
ExecStart=/bin/bash -lc 'cd "$REPO_DIR" && npm run x-growth'
EOF

sudo tee "$TIMER_PATH" >/dev/null <<EOF
[Unit]
Description=Schedule FreedomForge X Growth Automation

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

echo "✅ X growth timer installed"
echo "Inspect timer: systemctl status $TIMER_NAME --no-pager"
echo "Next runs: systemctl list-timers '$TIMER_NAME' --no-pager"
echo "Run now: sudo systemctl start $SERVICE_NAME"
echo "Mode: X_DRY_RUN=$X_DRY_RUN (set false only when explicitly needed)"
