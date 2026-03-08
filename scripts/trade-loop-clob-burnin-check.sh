#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$PWD"
SERVICE_NAME="freedomforge-trade-loop-intelligence.service"
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
    --service-name)
      SERVICE_NAME="$2"; shift 2 ;;
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

if ! command -v journalctl >/dev/null 2>&1; then
  echo "journalctl is required for burn-in check" >&2
  exit 1
fi

if [[ ! -d "$REPO_DIR" ]]; then
  echo "Repo dir not found: $REPO_DIR" >&2
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

load_state() {
  local file="$1"
  LAST_STATUS=""
  WARN_STREAK="0"
  HEALTHY_STREAK="0"
  LAST_AUTOPATCH_DATE=""
  LAST_AUTORESTORE_DATE=""

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  while IFS='=' read -r raw_key raw_value; do
    [[ -z "${raw_key// }" ]] && continue
    [[ "$raw_key" =~ ^# ]] && continue
    case "$raw_key" in
      LAST_STATUS) LAST_STATUS="$raw_value" ;;
      WARN_STREAK) WARN_STREAK="$raw_value" ;;
      HEALTHY_STREAK) HEALTHY_STREAK="$raw_value" ;;
      LAST_AUTOPATCH_DATE) LAST_AUTOPATCH_DATE="$raw_value" ;;
      LAST_AUTORESTORE_DATE) LAST_AUTORESTORE_DATE="$raw_value" ;;
    esac
  done < "$file"

  if ! [[ "$WARN_STREAK" =~ ^[0-9]+$ ]]; then
    WARN_STREAK="0"
  fi
  if ! [[ "$HEALTHY_STREAK" =~ ^[0-9]+$ ]]; then
    HEALTHY_STREAK="0"
  fi
}

save_state() {
  local file="$1"
  mkdir -p "$(dirname "$file")"
  cat > "$file" <<EOF
LAST_STATUS=$LAST_STATUS
WARN_STREAK=$WARN_STREAK
HEALTHY_STREAK=$HEALTHY_STREAK
LAST_AUTOPATCH_DATE=$LAST_AUTOPATCH_DATE
LAST_AUTORESTORE_DATE=$LAST_AUTORESTORE_DATE
EOF
}

logs="$(journalctl -u "$SERVICE_NAME" --since "${LOOKBACK_HOURS} hours ago" --no-pager -o cat 2>/dev/null || true)"

if [[ -z "$logs" ]]; then
  summary="⚠️ CLOB Burn-in Check (${LOOKBACK_HOURS}h): no intelligence logs found for $SERVICE_NAME"
  echo "$summary"
  notify_webhook "$summary"
  exit 0
fi

clob_sections="$(printf '%s\n' "$logs" | awk '
  /\[intelligence\] starting: polymarket-clob-engine/ { in_clob=1; run_count++; print "__CLOB_RUN__"; next }
  /\[intelligence\] starting: weekly-policy-review/ { if (in_clob==1) in_clob=0 }
  { if (in_clob==1) print }
')"

if [[ -z "$clob_sections" ]]; then
  summary="⚠️ CLOB Burn-in Check (${LOOKBACK_HOURS}h): no clob runs captured"
  echo "$summary"
  notify_webhook "$summary"
  exit 0
fi

run_count="$(printf '%s\n' "$clob_sections" | grep -c '__CLOB_RUN__' || true)"
skip_count="$(printf '%s\n' "$clob_sections" | grep -Eic '"status"[[:space:]]*:[[:space:]]*"skipped"|no ultra-short BTC markets found|market selection empty|disabled' || true)"
error_count="$(printf '%s\n' "$clob_sections" | grep -Eic 'warning: step failed: polymarket-clob-engine|\berror\b|\bfailed\b|HTTP[[:space:]]+[45][0-9]{2}' || true)"

status="ok"
reasons=()

if (( run_count < MIN_RUNS )); then
  status="warn"
  reasons+=("low_run_count=${run_count}<${MIN_RUNS}")
fi

if (( skip_count >= SKIP_THRESHOLD )); then
  status="warn"
  reasons+=("skip_threshold=${skip_count}>=${SKIP_THRESHOLD}")
fi

if (( error_count >= ERROR_THRESHOLD )); then
  status="warn"
  reasons+=("error_threshold=${error_count}>=${ERROR_THRESHOLD}")
fi

if [[ ${#reasons[@]} -eq 0 ]]; then
  reasons+=("healthy")
fi

state_abs="$STATE_FILE"
if [[ "$state_abs" != /* ]]; then
  state_abs="$REPO_DIR/$state_abs"
fi

load_state "$state_abs"

if [[ "$status" == "warn" ]]; then
  if [[ "$LAST_STATUS" == "warn" ]]; then
    WARN_STREAK="$((WARN_STREAK + 1))"
  else
    WARN_STREAK="1"
  fi
  HEALTHY_STREAK="0"
else
  WARN_STREAK="0"
  if [[ "$LAST_STATUS" == "ok" ]]; then
    HEALTHY_STREAK="$((HEALTHY_STREAK + 1))"
  else
    HEALTHY_STREAK="1"
  fi
fi

autopatch_result="none"
autoreset_result="none"
today_utc="$(date -u +%F)"
if [[ "$AUTO_PATCH_ON_WARN_STREAK" == "true" && "$status" == "warn" && "$WARN_STREAK" -ge "$WARN_STREAK_THRESHOLD" ]]; then
  if [[ "$LAST_AUTOPATCH_DATE" != "$today_utc" ]]; then
    if /bin/bash -lc "cd '$REPO_DIR' && node scripts/clob-burnin-autopatch.js" >/tmp/clob-burnin-autopatch.log 2>&1; then
      autopatch_result="applied"
      LAST_AUTOPATCH_DATE="$today_utc"
    else
      autopatch_result="failed"
      reasons+=("autopatch_failed")
    fi
  else
    autopatch_result="already-applied-today"
  fi
fi

if [[ "$AUTO_RESTORE_ON_HEALTH_STREAK" == "true" && "$status" == "ok" && "$HEALTHY_STREAK" -ge "$HEALTH_STREAK_THRESHOLD" ]]; then
  if [[ "$LAST_AUTORESTORE_DATE" != "$today_utc" ]]; then
    if /bin/bash -lc "cd '$REPO_DIR' && node scripts/clob-burnin-restore.js" >/tmp/clob-burnin-autorestore.log 2>&1; then
      autoreset_result="applied"
      LAST_AUTORESTORE_DATE="$today_utc"
    else
      autoreset_result="failed"
      reasons+=("autoreset_failed")
    fi
  else
    autoreset_result="already-applied-today"
  fi
fi

LAST_STATUS="$status"
save_state "$state_abs"

reason_text="$(IFS=','; echo "${reasons[*]}")"
summary="📈 CLOB Burn-in Check (${LOOKBACK_HOURS}h): status=${status} runs=${run_count} skips=${skip_count} errors=${error_count} warn_streak=${WARN_STREAK} healthy_streak=${HEALTHY_STREAK} autopatch=${autopatch_result} autorestore=${autoreset_result} reasons=${reason_text}"

echo "$summary"

if [[ -n "$ALERT_WEBHOOK_URL" && "$status" != "ok" ]]; then
  if [[ "$autopatch_result" == "failed" && -f /tmp/clob-burnin-autopatch.log ]]; then
    detail="$(tail -n 20 /tmp/clob-burnin-autopatch.log | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g' | sed 's/^ //;s/ $//')"
    notify_webhook "$summary | autopatch_log=${detail}"
  else
    notify_webhook "$summary"
  fi
fi

if [[ -n "$ALERT_WEBHOOK_URL" && "$autoreset_result" == "failed" && -f /tmp/clob-burnin-autorestore.log ]]; then
  detail="$(tail -n 20 /tmp/clob-burnin-autorestore.log | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g' | sed 's/^ //;s/ $//')"
  notify_webhook "$summary | autorestore_log=${detail}"
fi

exit 0
