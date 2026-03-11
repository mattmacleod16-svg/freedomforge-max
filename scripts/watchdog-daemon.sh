#!/bin/bash
# FreedomForge Watchdog Daemon — runs 24/7/365 with 2-minute healing loops
# This is a persistent service — systemd will auto-restart on unexpected exit
#
# Systemd unit: ff-watchdog.service (Type=simple, Restart=always)
# Replaces the old ff-watchdog.timer (oneshot every 5 min)

REPO_DIR="/home/opc/freedomforge-max"
WATCHDOG_SCRIPT="$REPO_DIR/scripts/watchdog.sh"
INTERVAL_SEC=120

log() { logger -t "ff-watchdog-daemon" "$1"; echo "$(date -u +%FT%TZ) $1"; }

log "FreedomForge Watchdog Daemon started — loop interval=${INTERVAL_SEC}s"

trap 'log "Watchdog daemon shutting down"; exit 0' SIGTERM SIGINT

while true; do
  if [[ -x "$WATCHDOG_SCRIPT" ]]; then
    bash "$WATCHDOG_SCRIPT" 2>&1 || log "WARN: watchdog.sh exited with code $?"
  else
    log "ALERT: watchdog.sh not found or not executable at $WATCHDOG_SCRIPT"
  fi
  sleep "$INTERVAL_SEC" &
  wait $!
done
