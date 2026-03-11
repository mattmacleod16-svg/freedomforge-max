#!/bin/bash
# FreedomForge Watchdog — runs every 5 minutes via systemd timer
# Auto-heals crashed services, checks disk/memory, detects stale orchestrator

LOG_TAG="ff-watchdog"
ALERT_FILE="/home/opc/freedomforge-max/data/watchdog-alerts.json"
ALERT_TMP="${ALERT_FILE}.tmp.$$"
REPO_DIR="/home/opc/freedomforge-max"
RESTART_COOLDOWN_FILE="/tmp/ff-watchdog-restart-cooldown"

log() { logger -t "$LOG_TAG" "$1"; echo "$(date -u +%FT%TZ) $1"; }

# Cooldown check — prevent rapid restart loops (min 10 min between service restarts)
COOLDOWN_SEC=600
can_restart() {
  local svc="$1"
  local cooldown_marker="${RESTART_COOLDOWN_FILE}.${svc}"
  if [[ -f "$cooldown_marker" ]]; then
    local last_restart
    last_restart=$(cat "$cooldown_marker" 2>/dev/null || echo 0)
    local elapsed=$(( $(date +%s) - last_restart ))
    if [[ "$elapsed" -lt "$COOLDOWN_SEC" ]]; then
      log "COOLDOWN: $svc restarted ${elapsed}s ago (< ${COOLDOWN_SEC}s) — skipping"
      return 1
    fi
  fi
  return 0
}
mark_restart() {
  date +%s > "${RESTART_COOLDOWN_FILE}.${1}" 2>/dev/null
}

HEALED=0
ALERTS=""

# ─── 1. Check & restart critical services ─────────────────────────────────────
CRITICAL_SERVICES="ff-dashboard ff-tunnel caddy"
for svc in $CRITICAL_SERVICES; do
  if ! systemctl is-active --quiet "$svc"; then
    if can_restart "$svc"; then
      log "HEAL: $svc is down — restarting"
      sudo systemctl restart "$svc"
      mark_restart "$svc"
      sleep 2
      if systemctl is-active --quiet "$svc"; then
        log "HEAL: $svc restarted successfully"
        HEALED=$((HEALED + 1))
      else
        log "ALERT: $svc failed to restart!"
        ALERTS="${ALERTS}\"${svc}_down\","
      fi
    else
      ALERTS="${ALERTS}\"${svc}_down_cooldown\","
    fi
  fi
done

# ─── 2. Check trade loop services ─────────────────────────────────────────────
TRADE_LOOPS="freedomforge-trade-loop-arb freedomforge-trade-loop-eth-shard0 freedomforge-trade-loop-eth-shard1 freedomforge-trade-loop-op freedomforge-trade-loop-pol"
for svc in $TRADE_LOOPS; do
  if ! systemctl is-active --quiet "$svc"; then
    if can_restart "$svc"; then
      log "HEAL: trade loop $svc is down — restarting"
      sudo systemctl restart "$svc"
      mark_restart "$svc"
      sleep 2
      if systemctl is-active --quiet "$svc"; then
        log "HEAL: trade loop $svc restarted successfully"
        HEALED=$((HEALED + 1))
      else
        log "ALERT: trade loop $svc failed to restart!"
        ALERTS="${ALERTS}\"${svc}_down\","
      fi
    else
      ALERTS="${ALERTS}\"${svc}_down_cooldown\","
    fi
  fi
done

# ─── 3. Check orchestrator freshness (should run every 3 min) ─────────────────
ORCH_STATE="$REPO_DIR/data/orchestrator-state.json"
if [[ -f "$ORCH_STATE" ]]; then
  LAST_RUN=$(python3 -c "
import json, time, sys
d = json.load(open(sys.argv[1]))
ts = d.get('lastRunAt') or d.get('updatedAt') or 0
if ts > 1e12: ts = ts / 1000
age = time.time() - ts
print(int(age))
" "$ORCH_STATE" 2>/dev/null)
  LAST_RUN=${LAST_RUN:-9999}
  if [[ "$LAST_RUN" -gt 600 ]]; then
    log "ALERT: Orchestrator stale — last ran ${LAST_RUN}s ago (>10min). Triggering manual run."
    sudo systemctl start ff-orchestrator.service
    ALERTS="${ALERTS}\"orchestrator_stale\","
  fi
fi

# ─── 4. Check disk space ──────────────────────────────────────────────────────
DISK_PCT=$(df / --output=pcent 2>/dev/null | tail -1 | tr -d ' %')
DISK_PCT=${DISK_PCT:-0}
if [[ "$DISK_PCT" -gt 85 ]]; then
  log "ALERT: Disk usage at ${DISK_PCT}%"
  sudo journalctl --vacuum-size=30M 2>/dev/null
  ALERTS="${ALERTS}\"disk_${DISK_PCT}pct\","
fi

# ─── 5. Check memory ──────────────────────────────────────────────────────────
MEM_AVAIL=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo 2>/dev/null)
MEM_AVAIL=${MEM_AVAIL:-0}
if [[ "$MEM_AVAIL" -lt 500 ]]; then
  log "ALERT: Available memory low — ${MEM_AVAIL}MB"
  ALERTS="${ALERTS}\"mem_low_${MEM_AVAIL}mb\","
fi

# ─── 6. Check dashboard responding ────────────────────────────────────────────
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/api/status/empire 2>/dev/null)
HTTP_CODE=${HTTP_CODE:-0}
if [[ "$HTTP_CODE" != "200" ]]; then
  if can_restart "ff-dashboard"; then
    log "HEAL: Dashboard API returned $HTTP_CODE — restarting ff-dashboard"
    sudo systemctl restart ff-dashboard
    mark_restart "ff-dashboard"
    HEALED=$((HEALED + 1))
    ALERTS="${ALERTS}\"dashboard_${HTTP_CODE}\","
  else
    ALERTS="${ALERTS}\"dashboard_${HTTP_CODE}_cooldown\","
  fi
fi

# ─── 7. Write status ──────────────────────────────────────────────────────────
ALERTS="${ALERTS%,}"  # trim trailing comma

# ─── Data rotation guard (rotate files >50MB) ─────────────────────────────────
ROTATE_SCRIPT="$REPO_DIR/scripts/data-rotate.sh"
if [[ -x "$ROTATE_SCRIPT" ]]; then
  bash "$ROTATE_SCRIPT" 2>/dev/null
fi

cat > "$ALERT_TMP" << ENDSTATUS
{
  "lastCheck": "$(date -u +%FT%TZ)",
  "healed": ${HEALED:-0},
  "diskPct": ${DISK_PCT:-0},
  "memAvailMB": ${MEM_AVAIL:-0},
  "dashboardHttp": ${HTTP_CODE:-0},
  "alerts": [${ALERTS}]
}
ENDSTATUS
mv -f "$ALERT_TMP" "$ALERT_FILE" 2>/dev/null || true

if [[ $HEALED -gt 0 || -n "$ALERTS" ]]; then
  log "Watchdog complete: healed=$HEALED alerts=[$ALERTS]"
else
  log "Watchdog complete: all systems nominal"
fi
