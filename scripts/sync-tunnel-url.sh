#!/bin/bash
# sync-tunnel-url.sh — Updates Vercel ORACLE_API_URL + triggers redeploy when tunnel URL changes
# HARDENED: Health-checks new URL before pushing, retries on failure, verifies Vercel deployment
set -euo pipefail

TUNNEL_FILE="/home/opc/freedomforge-max/data/tunnel-url.txt"
VERCEL_SYNC_FILE="/home/opc/freedomforge-max/data/.last-synced-tunnel-url"
LOG="/home/opc/freedomforge-max/logs/tunnel-sync.log"
MAX_RETRIES=3

log() { echo "$(date -u): $*" >> "$LOG"; }

URL=$(cat "$TUNNEL_FILE" 2>/dev/null || echo "")
LAST=$(cat "$VERCEL_SYNC_FILE" 2>/dev/null || echo "")

if [ -z "$URL" ]; then
  log "No tunnel URL found"
  exit 0
fi

if [ "$URL" = "$LAST" ]; then
  exit 0
fi

log "Tunnel URL changed: $LAST -> $URL"

# ─── Health check: verify the tunnel URL actually works before pushing ────
health_ok=false
for i in $(seq 1 $MAX_RETRIES); do
  if curl -sf --max-time 10 "$URL/api/status/empire" >/dev/null 2>&1; then
    health_ok=true
    break
  fi
  log "Health check attempt $i/$MAX_RETRIES failed for $URL"
  sleep 3
done

if [ "$health_ok" = "false" ]; then
  log "WARN: Tunnel URL failed health check after $MAX_RETRIES attempts — pushing anyway (tunnel may still be starting)"
fi

# ─── Update Vercel env var with retry ─────────────────────────────────────
cd /home/opc/freedomforge-max
if ! command -v vercel >/dev/null 2>&1; then
  log "ERROR: vercel CLI not found — cannot sync"
  exit 1
fi

env_updated=false
for i in $(seq 1 $MAX_RETRIES); do
  vercel env rm ORACLE_API_URL production --yes 2>/dev/null || true
  if printf "%s" "$URL" | vercel env add ORACLE_API_URL production 2>>"$LOG"; then
    env_updated=true
    log "Vercel ORACLE_API_URL updated (attempt $i)"
    break
  fi
  log "Vercel env update attempt $i/$MAX_RETRIES failed"
  sleep 5
done

if [ "$env_updated" = "false" ]; then
  log "CRITICAL: All $MAX_RETRIES Vercel env update attempts failed"
  exit 1
fi

# ─── Trigger production redeploy with retry ───────────────────────────────
deploy_ok=false
for i in $(seq 1 $MAX_RETRIES); do
  if vercel --prod --yes 2>>"$LOG"; then
    deploy_ok=true
    log "Vercel redeploy completed (attempt $i)"
    break
  fi
  log "Vercel redeploy attempt $i/$MAX_RETRIES failed"
  sleep 10
done

if [ "$deploy_ok" = "true" ]; then
  echo "$URL" > "$VERCEL_SYNC_FILE"
  log "Sync complete: $URL"

  # ─── Post-deploy verification (non-blocking) ─────────────────────────
  sleep 30 # Wait for Vercel build
  for i in $(seq 1 3); do
    resp=$(curl -sf --max-time 15 "https://freedomforge-max.vercel.app/api/status/empire" 2>/dev/null || echo "FAIL")
    if echo "$resp" | grep -q '"totalUsd"'; then
      log "Post-deploy verification PASSED"
      break
    fi
    log "Post-deploy verification attempt $i — waiting..."
    sleep 15
  done
else
  log "CRITICAL: Vercel redeploy failed after $MAX_RETRIES attempts (env was updated)"
  # Still mark as synced to avoid retry storm — next tunnel restart will re-trigger
  echo "$URL" > "$VERCEL_SYNC_FILE"
fi
