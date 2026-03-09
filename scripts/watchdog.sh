#!/bin/bash
# FreedomForge Watchdog — runs every 5 minutes via systemd timer
# Auto-heals crashed services, checks disk/memory, detects stale orchestrator

LOG_TAG="ff-watchdog"
ALERT_FILE="/home/opc/freedomforge-max/data/watchdog-alerts.json"
REPO_DIR="/home/opc/freedomforge-max"

log() { logger -t "$LOG_TAG" "$1"; echo "$(date -u +%FT%TZ) $1"; }

HEALED=0
ALERTS=""

# ─── 1. Check & restart critical services ─────────────────────────────────────
CRITICAL_SERVICES="ff-dashboard ff-tunnel caddy"
for svc in $CRITICAL_SERVICES; do
  if ! systemctl is-active --quiet "$svc"; then
    log "HEAL: $svc is down — restarting"
    sudo systemctl restart "$svc"
    sleep 2
    if systemctl is-active --quiet "$svc"; then
      log "HEAL: $svc restarted successfully"
      HEALED=$((HEALED + 1))
    else
      log "ALERT: $svc failed to restart!"
      ALERTS="${ALERTS}\"${svc}_down\","
    fi
  fi
done

# ─── 2. Check trade loop services ─────────────────────────────────────────────
TRADE_LOOPS="freedomforge-trade-loop-arb freedomforge-trade-loop-eth-shard0 freedomforge-trade-loop-eth-shard1 freedomforge-trade-loop-op freedomforge-trade-loop-pol"
for svc in $TRADE_LOOPS; do
  if ! systemctl is-active --quiet "$svc"; then
    log "HEAL: trade loop $svc is down — restarting"
    sudo systemctl restart "$svc"
    HEALED=$((HEALED + 1))
  fi
done

# ─── 3. Check orchestrator freshness (should run every 3 min) ─────────────────
ORCH_STATE="$REPO_DIR/data/orchestrator-state.json"
if [[ -f "$ORCH_STATE" ]]; then
  LAST_RUN=$(python3 -c "
import json, time
d = json.load(open('$ORCH_STATE'))
ts = d.get('lastRunAt') or d.get('updatedAt') or 0
if ts > 1e12: ts = ts / 1000  # ms to seconds
age = time.time() - ts
print(int(age))
" 2>/dev/null)
  LAST_RUN=${LAST_RUN:-9999}
  if [[ "$LAST_RUN" -gt 600 ]]; then
    log "ALERT: Orchestrator stale — last ran ${LAST_RUN}s ago (>10min). Triggering manual run."
    sudo systemctl start ff-orchestrator.service
    ALERTS="${ALERTS}\"orchestrator_stale\","
  fi
fi

# ─── 4. Check disk space ──────────────────────────────────────────────────────
DISK_PCT=$(df / --output=pcent | tail -1 | tr -d ' %')
if [[ "$DISK_PCT" -gt 85 ]]; then
  log "ALERT: Disk usage at ${DISK_PCT}%"
  sudo journalctl --vacuum-size=30M 2>/dev/null
  ALERTS="${ALERTS}\"disk_${DISK_PCT}pct\","
fi

# ─── 5. Check memory ──────────────────────────────────────────────────────────
MEM_AVAIL=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
if [[ "$MEM_AVAIL" -lt 500 ]]; then
  log "ALERT: Available memory low — ${MEM_AVAIL}MB"
  ALERTS="${ALERTS}\"mem_low_${MEM_AVAIL}mb\","
fi

# ─── 6. Check dashboard responding ────────────────────────────────────────────
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/api/status/empire 2>/dev/null)
if [[ "$HTTP_CODE" != "200" ]]; then
  log "HEAL: Dashboard API returned $HTTP_CODE — restarting ff-dashboard"
  sudo systemctl restart ff-dashboard
  HEALED=$((HEALED + 1))
  ALERTS="${ALERTS}\"dashboard_${HTTP_CODE}\","
fi

# ─── 7. Write status ──────────────────────────────────────────────────────────
ALERTS="${ALERTS%,}"  # trim trailing comma

# ─── Data rotation guard (rotate files >50MB) ─────────────────────────────────
ROTATE_SCRIPT="$REPO_DIR/scripts/data-rotate.sh"
if [[ -x "$ROTATE_SCRIPT" ]]; then
  bash "$ROTATE_SCRIPT" 2>/dev/null
fi

cat > "$ALERT_FILE" << ENDSTATUS
{
  "lastCheck": "$(date -u +%FT%TZ)",
  "healed": $HEALED,
  "diskPct": $DISK_PCT,
  "memAvailMB": $MEM_AVAIL,
  "dashboardHttp": $HTTP_CODE,
  "alerts": [${ALERTS}]
}
ENDSTATUS

if [[ $HEALED -gt 0 || -n "$ALERTS" ]]; then
  log "Watchdog complete: healed=$HEALED alerts=[$ALERTS]"
else
  log "Watchdog complete: all systems nominal"
fi
