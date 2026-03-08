#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$PWD"
DEFAULT_USER="${USER:-$(id -un)}"
SERVICE_USER="${SUDO_USER:-$DEFAULT_USER}"
APP_BASE_URL="https://freedomforge-max.vercel.app"
TIMEOUT_SEC="1800"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
INTELLIGENCE_ALERT_SUMMARY_MODE="${INTELLIGENCE_ALERT_SUMMARY_MODE:-failures-only}"
CORE_PROFIT_MODE="${CORE_PROFIT_MODE:-true}"
INTELLIGENCE_EDGE_FOCUS_MODE="${INTELLIGENCE_EDGE_FOCUS_MODE:-true}"
COLLAB_EDGE_ROUNDS="${COLLAB_EDGE_ROUNDS:-3}"
COLLAB_EDGE_MIN_ROUNDS="${COLLAB_EDGE_MIN_ROUNDS:-4}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir)
      REPO_DIR="$2"; shift 2 ;;
    --user)
      SERVICE_USER="$2"; shift 2 ;;
    --app-base-url)
      APP_BASE_URL="$2"; shift 2 ;;
    --timeout-sec)
      TIMEOUT_SEC="$2"; shift 2 ;;
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

TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN="gtimeout"
fi

run_step() {
  local label="$1"
  local cmd="$2"
  local output_file="$3"
  local wrapped_cmd=""

  if [[ -n "$TIMEOUT_BIN" ]]; then
    wrapped_cmd="cd '$REPO_DIR' && APP_BASE_URL='$APP_BASE_URL' $TIMEOUT_BIN '$TIMEOUT_SEC' $cmd"
  else
    wrapped_cmd="cd '$REPO_DIR' && APP_BASE_URL='$APP_BASE_URL' $cmd"
  fi

  echo "[intelligence] starting: $label"
  if ! sudo -u "$SERVICE_USER" /bin/bash -lc "$wrapped_cmd" | tee "$output_file"; then
    echo "[intelligence] warning: step failed: $label"
    return 1
  fi
  echo "[intelligence] completed: $label"
  return 0
}

should_run_step() {
  local label="$1"
  if [[ "$CORE_PROFIT_MODE" != "true" ]]; then
    return 0
  fi

  case "$label" in
    recovery-controller|cashflow-autotune|autonomy-maintenance)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

run_step_if_enabled() {
  local label="$1"
  local cmd="$2"
  local output_file="$3"
  local status_var="$4"

  if should_run_step "$label"; then
    if ! run_step "$label" "$cmd" "$output_file"; then
      failures=$((failures + 1))
      printf -v "$status_var" '%s' "warn"
    fi
  else
    echo "[intelligence] skipping (core-profit mode): $label"
    printf -v "$status_var" '%s' "skipped"
  fi
}

normalize_positive_int() {
  local raw="$1"
  local fallback="$2"
  local n
  n="$(printf '%s' "$raw" | tr -cd '0-9')"
  if [[ -z "$n" || "$n" -lt 1 ]]; then
    n="$fallback"
  fi
  printf '%s' "$n"
}

run_edge_collaboration_rounds() {
  local rounds_raw="$1"
  local min_rounds_raw="$2"
  local rounds
  local min_rounds

  rounds="$(normalize_positive_int "$rounds_raw" "1")"
  min_rounds="$(normalize_positive_int "$min_rounds_raw" "1")"

  if [[ "$rounds" -lt "$min_rounds" ]]; then
    rounds="$min_rounds"
  fi

  local idx
  for ((idx=1; idx<=rounds; idx++)); do
    echo "[intelligence] collaborative-edge round ${idx}/${rounds}"
    run_step_if_enabled "edge-scanner" "npm run edge:scan" "$edge_scanner_log" edge_scanner_status
    run_step_if_enabled "continuous-learning" "npm run continuous-learning" "$continuous_log" continuous_status
    run_step_if_enabled "public-alpha-fusion" "npm run public:alpha" "$public_alpha_log" public_alpha_status
    run_step_if_enabled "geopolitical-watch" "npm run geopolitical-watch" "$geopolitical_log" geopolitical_status
    run_step_if_enabled "market-venue-engine" "npm run venue:engine" "$venue_log" venue_status
    run_step_if_enabled "daily-agent-proof" "npm run daily-agent-proof" "$agent_proof_log" agent_proof_status
    run_step_if_enabled "help-bots-orchestrator" "npm run help-bots:run" "$help_bots_log" help_bots_status
  done
}

failures=0

tmp_dir="$(mktemp -d)"
continuous_log="$tmp_dir/continuous.log"
public_alpha_log="$tmp_dir/public-alpha.log"
geopolitical_log="$tmp_dir/geopolitical.log"
venue_log="$tmp_dir/venue.log"
agent_proof_log="$tmp_dir/agent-proof.log"
recovery_log="$tmp_dir/recovery.log"
autotune_log="$tmp_dir/autotune.log"
conversion_log="$tmp_dir/conversion.log"
weekly_log="$tmp_dir/weekly.log"
autonomy_log="$tmp_dir/autonomy.log"
help_bots_log="$tmp_dir/help-bots.log"
edge_scanner_log="$tmp_dir/edge-scanner.log"

touch "$continuous_log" "$public_alpha_log" "$geopolitical_log" "$venue_log" "$agent_proof_log" "$recovery_log" "$autotune_log" "$conversion_log" "$weekly_log" "$autonomy_log" "$help_bots_log" "$edge_scanner_log"

continuous_status="ok"
public_alpha_status="ok"
geopolitical_status="ok"
venue_status="ok"
agent_proof_status="ok"
recovery_status="ok"
autotune_status="ok"
conversion_status="ok"
weekly_status="ok"
autonomy_status="ok"
help_bots_status="ok"
edge_scanner_status="ok"

edge_focus_mode_normalized="$(printf '%s' "$INTELLIGENCE_EDGE_FOCUS_MODE" | tr '[:upper:]' '[:lower:]')"
if [[ "$edge_focus_mode_normalized" == "true" ]]; then
  run_edge_collaboration_rounds "$COLLAB_EDGE_ROUNDS" "$COLLAB_EDGE_MIN_ROUNDS"
else
  run_step_if_enabled "edge-scanner" "npm run edge:scan" "$edge_scanner_log" edge_scanner_status
  run_step_if_enabled "continuous-learning" "npm run continuous-learning" "$continuous_log" continuous_status
  run_step_if_enabled "public-alpha-fusion" "npm run public:alpha" "$public_alpha_log" public_alpha_status
  run_step_if_enabled "geopolitical-watch" "npm run geopolitical-watch" "$geopolitical_log" geopolitical_status
  run_step_if_enabled "market-venue-engine" "npm run venue:engine" "$venue_log" venue_status
  run_step_if_enabled "daily-agent-proof" "npm run daily-agent-proof" "$agent_proof_log" agent_proof_status
  run_step_if_enabled "help-bots-orchestrator" "npm run help-bots:run" "$help_bots_log" help_bots_status
fi

run_step_if_enabled "recovery-controller" "npm run recovery:controller" "$recovery_log" recovery_status
run_step_if_enabled "cashflow-autotune" "npm run cashflow:autotune" "$autotune_log" autotune_status
run_step_if_enabled "conversion-engine" "npm run conversion:engine" "$conversion_log" conversion_status
run_step_if_enabled "weekly-policy-review" "npm run weekly-policy-review" "$weekly_log" weekly_status
run_step_if_enabled "autonomy-maintenance" "npm run autonomy:maintain" "$autonomy_log" autonomy_status

notify_summary() {
  local mission_health="unavailable"
  local mission_script="$REPO_DIR/scripts/mission-health-score.sh"
  if [[ -f "$mission_script" ]]; then
    mission_health="$(/bin/bash "$mission_script" --repo-dir "$REPO_DIR" --lookback-hours 168 | tail -n 1 | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g' | sed 's/^ //;s/ $//' || true)"
    if [[ -z "$mission_health" ]]; then
      mission_health="unavailable"
    fi
  fi

  local burnin_summary="not-installed"
  local burnin_script="$REPO_DIR/scripts/trade-loop-clob-burnin-check.sh"
  if [[ -f "$burnin_script" ]]; then
    burnin_summary="$(/bin/bash "$burnin_script" --repo-dir "$REPO_DIR" --lookback-hours 24 --min-runs 1 --skip-threshold 4 --error-threshold 1 | tail -n 1 | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g' | sed 's/^ //;s/ $//' || true)"
    if [[ -z "$burnin_summary" ]]; then
      burnin_summary="unavailable"
    fi
  fi

  local tx_hashes
  tx_hashes="$(grep -Eo '0x[a-fA-F0-9]{64}' "$conversion_log" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g' | sed 's/^ //;s/ $//' || true)"
  if [[ -z "$tx_hashes" ]]; then
    tx_hashes="none"
  fi

  local venue_hashes
  venue_hashes="$(grep -Eo '0x[a-fA-F0-9]{64}' "$venue_log" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g' | sed 's/^ //;s/ $//' || true)"
  if [[ -z "$venue_hashes" ]]; then
    venue_hashes="none"
  fi

  local summary
  summary="🤖 Intelligence Cycle Summary\n- edge-scanner: ${edge_scanner_status}\n- continuous-learning: ${continuous_status}\n- public-alpha-fusion: ${public_alpha_status}\n- geopolitical-watch: ${geopolitical_status}\n- market-venue-engine: ${venue_status}\n- daily-agent-proof: ${agent_proof_status}\n- help-bots-orchestrator: ${help_bots_status}\n- recovery-controller: ${recovery_status}\n- cashflow-autotune: ${autotune_status}\n- conversion-engine: ${conversion_status}\n- weekly-policy-review: ${weekly_status}\n- autonomy-maintenance: ${autonomy_status}\n- mission health (7d): ${mission_health}\n- clob burn-in (24h): ${burnin_summary}\n- warnings: ${failures}\n- conversion tx: ${tx_hashes}\n- venue tx: ${venue_hashes}"

  echo "$summary"

  local alert_mode_normalized
  alert_mode_normalized="$(printf '%s' "$INTELLIGENCE_ALERT_SUMMARY_MODE" | tr '[:upper:]' '[:lower:]')"
  local should_send="false"
  if [[ "$alert_mode_normalized" == "all" ]]; then
    should_send="true"
  elif [[ "$alert_mode_normalized" == "off" ]]; then
    should_send="false"
  elif [[ "$failures" -gt 0 ]]; then
    should_send="true"
  fi

  if [[ -n "$ALERT_WEBHOOK_URL" && "$should_send" == "true" ]]; then
    curl -sS -X POST "$ALERT_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"content\": $(python3 - <<'PY'
import json, sys
print(json.dumps(sys.stdin.read()))
PY
<<< "$summary")}" >/dev/null || true
  fi
}

notify_summary
rm -rf "$tmp_dir"

if [[ "$failures" -gt 0 ]]; then
  echo "[intelligence] completed with $failures warning(s)"
  exit 0
fi

echo "[intelligence] all learning steps completed successfully"
