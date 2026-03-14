#!/bin/bash
# sync-tunnel-url.sh — Updates Railway ORACLE_API_URL + triggers redeploy when tunnel URL changes
# HARDENED: Health-checks new URL before pushing, retries on failure, verifies Railway deployment
set -euo pipefail

TUNNEL_FILE="/home/opc/freedomforge-max/data/tunnel-url.txt"
RAILWAY_SYNC_FILE="/home/opc/freedomforge-max/data/.last-synced-tunnel-url"
LOG="/home/opc/freedomforge-max/logs/tunnel-sync.log"
MAX_RETRIES=3

log() { echo "$(date -u): $*" >> "$LOG"; }

URL=$(cat "$TUNNEL_FILE" 2>/dev/null || echo "")
LAST=$(cat "$RAILWAY_SYNC_FILE" 2>/dev/null || echo "")

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
  if curl -sf --max-time 10 "$URL/api/alchemy/health" >/dev/null 2>&1; then
    health_ok=true
    break
  fi
  log "Health check attempt $i/$MAX_RETRIES failed for $URL"
  sleep 3
done

if [ "$health_ok" = "false" ]; then
  log "WARN: Tunnel URL failed health check after $MAX_RETRIES attempts — pushing anyway (tunnel may still be starting)"
fi

# ─── Update Railway env var with retry (GraphQL API) ─────────────────────
cd /home/opc/freedomforge-max
if [ -z "${RAILWAY_TOKEN:-}" ] || [ -z "${RAILWAY_PROJECT_ID:-}" ] || [ -z "${RAILWAY_SERVICE_ID:-}" ] || [ -z "${RAILWAY_ENVIRONMENT_ID:-}" ]; then
  log "ERROR: RAILWAY_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_SERVICE_ID, RAILWAY_ENVIRONMENT_ID must be set — cannot sync"
  exit 1
fi

env_updated=false
for i in $(seq 1 $MAX_RETRIES); do
  response=$(curl -sf --max-time 15 \
    -H "Authorization: Bearer ${RAILWAY_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"query\":\"mutation VariableUpsert(\$input: VariableUpsertInput!) { variableUpsert(input: \$input) }\",\"variables\":{\"input\":{\"projectId\":\"${RAILWAY_PROJECT_ID}\",\"serviceId\":\"${RAILWAY_SERVICE_ID}\",\"environmentId\":\"${RAILWAY_ENVIRONMENT_ID}\",\"name\":\"ORACLE_API_URL\",\"value\":\"${URL}\"}}}" \
    "https://backboard.railway.app/graphql/v2" 2>>"$LOG" || echo "FAIL")
  if echo "$response" | grep -q '"variableUpsert"'; then
    env_updated=true
    log "Railway ORACLE_API_URL updated (attempt $i)"
    break
  fi
  log "Railway env update attempt $i/$MAX_RETRIES failed: $response"
  sleep 5
done

if [ "$env_updated" = "false" ]; then
  log "CRITICAL: All $MAX_RETRIES Railway env update attempts failed"
  exit 1
fi

# ─── Trigger production redeploy with retry ───────────────────────────────
deploy_ok=false
for i in $(seq 1 $MAX_RETRIES); do
  response=$(curl -sf --max-time 30 \
    -H "Authorization: Bearer ${RAILWAY_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"query\":\"mutation ServiceInstanceRedeploy(\$serviceId: String!, \$environmentId: String!) { serviceInstanceRedeploy(serviceId: \$serviceId, environmentId: \$environmentId) }\",\"variables\":{\"serviceId\":\"${RAILWAY_SERVICE_ID}\",\"environmentId\":\"${RAILWAY_ENVIRONMENT_ID}\"}}" \
    "https://backboard.railway.app/graphql/v2" 2>>"$LOG" || echo "FAIL")
  if echo "$response" | grep -q '"serviceInstanceRedeploy"'; then
    deploy_ok=true
    log "Railway redeploy completed (attempt $i)"
    break
  fi
  log "Railway redeploy attempt $i/$MAX_RETRIES failed: $response"
  sleep 10
done

if [ "$deploy_ok" = "true" ]; then
  echo "$URL" > "$RAILWAY_SYNC_FILE"
  log "Sync complete: $URL"

  # ─── Post-deploy verification (non-blocking) ─────────────────────────
  sleep 30 # Wait for Railway build
  for i in $(seq 1 3); do
    resp=$(curl -sf --max-time 15 -H "x-api-secret: ${ALERT_SECRET:-}" "https://freedomforge-max.up.railway.app/api/status/empire" 2>/dev/null || echo "FAIL")
    if echo "$resp" | grep -q '"totalUsd"'; then
      log "Post-deploy verification PASSED"
      break
    fi
    log "Post-deploy verification attempt $i — waiting..."
    sleep 15
  done
else
  log "CRITICAL: Railway redeploy failed after $MAX_RETRIES attempts (env was updated)"
  # Still mark as synced to avoid retry storm — next tunnel restart will re-trigger
  echo "$URL" > "$RAILWAY_SYNC_FILE"
fi
