#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$PWD"
SERVICE_USER="${SUDO_USER:-$USER}"
APP_BASE_URL="https://freedomforge-max.up.railway.app"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir)
      REPO_DIR="$2"; shift 2 ;;
    --user)
      SERVICE_USER="$2"; shift 2 ;;
    --app-base-url)
      APP_BASE_URL="$2"; shift 2 ;;
    --alert-webhook-url)
      ALERT_WEBHOOK_URL="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl not available" >&2
  exit 1
fi

if [[ ! -f "$REPO_DIR/scripts/install-trade-loop-services.sh" ]]; then
  echo "missing install script in $REPO_DIR" >&2
  exit 1
fi

notify_webhook() {
  local message="$1"
  if [[ -z "$ALERT_WEBHOOK_URL" ]]; then
    return 0
  fi
  curl -sS -X POST "$ALERT_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "{\"content\": $(python3 - <<'PY'
import json, sys
print(json.dumps(sys.stdin.read()))
PY
<<< "$message")}" >/dev/null || true
}

declare -a REQUIRED_SERVICES=(
  "freedomforge-trade-loop-eth-shard0.service"
  "freedomforge-trade-loop-eth-shard1.service"
  "freedomforge-trade-loop-op.service"
  "freedomforge-trade-loop-arb.service"
  "freedomforge-trade-loop-pol.service"
)

declare -a REQUIRED_TIMERS=(
  "freedomforge-trade-loop-update.timer"
  "freedomforge-trade-loop-intelligence.timer"
  "freedomforge-trade-loop-clob-burnin.timer"
)

repair_actions=()
issues=()

repair_from_installers() {
  repair_actions+=("reinstall-core-services")
  sudo bash "$REPO_DIR/scripts/install-trade-loop-services.sh" \
    --repo-dir "$REPO_DIR" \
    --app-base-url "$APP_BASE_URL" \
    --user "$SERVICE_USER" \
    --install-deps false >/dev/null

  if [[ -f "$REPO_DIR/scripts/install-trade-loop-autoupdate.sh" ]]; then
    repair_actions+=("reinstall-update-timer")
    sudo bash "$REPO_DIR/scripts/install-trade-loop-autoupdate.sh" \
      --repo-dir "$REPO_DIR" \
      --user "$SERVICE_USER" \
      --on-calendar "*-*-* 03:15:00" \
      --random-delay-sec "0" \
      --persistent true >/dev/null
  fi

  if [[ -f "$REPO_DIR/scripts/install-trade-loop-intelligence.sh" ]]; then
    repair_actions+=("reinstall-intelligence-timer")
    sudo bash "$REPO_DIR/scripts/install-trade-loop-intelligence.sh" \
      --repo-dir "$REPO_DIR" \
      --user "$SERVICE_USER" \
      --app-base-url "$APP_BASE_URL" \
      --on-calendar "*-*-* 00,06,12,18:45:00" \
      --random-delay-sec "0" \
      --persistent true \
      --timeout-sec "2400" >/dev/null
  fi

  if [[ -f "$REPO_DIR/scripts/install-trade-loop-clob-burnin.sh" ]]; then
    repair_actions+=("reinstall-clob-burnin-timer")
    sudo bash "$REPO_DIR/scripts/install-trade-loop-clob-burnin.sh" \
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
      --auto-restore-on-health-streak "true" >/dev/null
  fi
}

check_unit() {
  local unit="$1"
  local kind="$2"

  if ! systemctl list-unit-files "$unit" --no-legend --no-pager | grep -q "${unit}"; then
    issues+=("missing:${unit}")
    return
  fi

  if ! systemctl is-enabled --quiet "$unit"; then
    issues+=("disabled:${unit}")
    if sudo systemctl enable "$unit" >/dev/null 2>&1; then
      repair_actions+=("enable:${unit}")
    fi
  fi

  if [[ "$kind" == "timer" ]]; then
    if ! systemctl is-active --quiet "$unit"; then
      issues+=("inactive:${unit}")
      if sudo systemctl start "$unit" >/dev/null 2>&1; then
        repair_actions+=("start:${unit}")
      fi
    fi
  else
    if ! systemctl is-active --quiet "$unit"; then
      issues+=("inactive:${unit}")
      if sudo systemctl restart "$unit" >/dev/null 2>&1 || sudo systemctl start "$unit" >/dev/null 2>&1; then
        repair_actions+=("restart:${unit}")
      fi
    fi
  fi
}

initial_missing=0
for unit in "${REQUIRED_SERVICES[@]}" "${REQUIRED_TIMERS[@]}"; do
  if ! systemctl list-unit-files "$unit" --no-legend --no-pager | grep -q "${unit}"; then
    initial_missing=1
    break
  fi
done

if [[ "$initial_missing" -eq 1 ]]; then
  repair_from_installers
fi

for service in "${REQUIRED_SERVICES[@]}"; do
  check_unit "$service" "service"
done

for timer in "${REQUIRED_TIMERS[@]}"; do
  check_unit "$timer" "timer"
done

status="ok"
if [[ "${#issues[@]}" -gt 0 ]]; then
  status="warn"
fi

issues_text="none"
if [[ "${#issues[@]}" -gt 0 ]]; then
  issues_text="$(IFS=','; echo "${issues[*]}")"
fi

actions_text="none"
if [[ "${#repair_actions[@]}" -gt 0 ]]; then
  actions_text="$(IFS=','; echo "${repair_actions[*]}")"
fi

summary="🛠️ Superagent Self-Test: status=${status} issues=${issues_text} actions=${actions_text}"
echo "$summary"

if [[ "$status" != "ok" || "${#repair_actions[@]}" -gt 0 ]]; then
  notify_webhook "$summary"
fi

exit 0
