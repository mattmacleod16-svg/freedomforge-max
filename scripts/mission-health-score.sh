#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$PWD"
SERVICE_NAME="freedomforge-trade-loop-intelligence.service"
LOOKBACK_HOURS="168"
STATE_FILE="data/clob-burnin-state.env"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir)
      REPO_DIR="$2"; shift 2 ;;
    --service-name)
      SERVICE_NAME="$2"; shift 2 ;;
    --lookback-hours)
      LOOKBACK_HOURS="$2"; shift 2 ;;
    --state-file)
      STATE_FILE="$2"; shift 2 ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1 ;;
  esac
done

if ! command -v journalctl >/dev/null 2>&1; then
  echo "📊 Mission Health (7d): score=50 grade=C status=unavailable cycles=0 warn_cycles=0 tx=0 burnin=unknown"
  exit 0
fi

logs="$(journalctl -u "$SERVICE_NAME" --since "${LOOKBACK_HOURS} hours ago" --no-pager -o cat 2>/dev/null || true)"

cycle_count="$(printf '%s\n' "$logs" | grep -c '\[intelligence\] starting: continuous-learning' || true)"
warn_cycle_count="$(printf '%s\n' "$logs" | grep -E '\[intelligence\] completed with [1-9][0-9]* warning\(s\)' -c || true)"
tx_count="$(printf '%s\n' "$logs" | grep -Eo '0x[a-fA-F0-9]{64}' | sort -u | wc -l | tr -d ' ' || true)"

warn_rate_bps="0"
if [[ "$cycle_count" -gt 0 ]]; then
  warn_rate_bps="$(( warn_cycle_count * 10000 / cycle_count ))"
fi

state_abs="$STATE_FILE"
if [[ "$state_abs" != /* ]]; then
  state_abs="$REPO_DIR/$state_abs"
fi

warn_streak="0"
healthy_streak="0"
if [[ -f "$state_abs" ]]; then
  while IFS='=' read -r raw_key raw_value; do
    [[ -z "${raw_key// }" ]] && continue
    [[ "$raw_key" =~ ^# ]] && continue
    case "$raw_key" in
      WARN_STREAK) warn_streak="$raw_value" ;;
      HEALTHY_STREAK) healthy_streak="$raw_value" ;;
    esac
  done < "$state_abs"
fi

if ! [[ "$warn_streak" =~ ^[0-9]+$ ]]; then warn_streak="0"; fi
if ! [[ "$healthy_streak" =~ ^[0-9]+$ ]]; then healthy_streak="0"; fi

score="100"

warning_penalty="$(( warn_rate_bps * 40 / 10000 ))"
score="$(( score - warning_penalty ))"

if [[ "$warn_streak" -ge 4 ]]; then
  score="$(( score - 25 ))"
elif [[ "$warn_streak" -ge 2 ]]; then
  score="$(( score - 15 ))"
fi

if [[ "$healthy_streak" -ge 3 ]]; then
  score="$(( score + 5 ))"
fi

tx_bonus="$(( tx_count * 2 ))"
if [[ "$tx_bonus" -gt 20 ]]; then
  tx_bonus="20"
fi
score="$(( score + tx_bonus ))"

if [[ "$score" -lt 0 ]]; then score=0; fi
if [[ "$score" -gt 100 ]]; then score=100; fi

grade="F"
if [[ "$score" -ge 90 ]]; then grade="A";
elif [[ "$score" -ge 80 ]]; then grade="B";
elif [[ "$score" -ge 70 ]]; then grade="C";
elif [[ "$score" -ge 60 ]]; then grade="D";
fi

burnin_status="stable"
if [[ "$warn_streak" -ge 2 ]]; then
  burnin_status="risk"
fi

echo "📊 Mission Health (7d): score=${score} grade=${grade} status=${burnin_status} cycles=${cycle_count} warn_cycles=${warn_cycle_count} tx=${tx_count} burnin=warn_streak:${warn_streak},healthy_streak:${healthy_streak}"

exit 0
