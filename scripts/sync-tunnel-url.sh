#!/bin/bash
# sync-tunnel-url.sh — Updates Vercel ORACLE_API_URL + triggers redeploy when tunnel URL changes
# Called by tunnel-url-watcher or as a standalone cron/timer
set -euo pipefail

TUNNEL_FILE="/home/opc/freedomforge-max/data/tunnel-url.txt"
VERCEL_SYNC_FILE="/home/opc/freedomforge-max/data/.last-synced-tunnel-url"
LOG="/home/opc/freedomforge-max/logs/tunnel-sync.log"

URL=$(cat "$TUNNEL_FILE" 2>/dev/null || echo "")
LAST=$(cat "$VERCEL_SYNC_FILE" 2>/dev/null || echo "")

if [ -z "$URL" ]; then
  echo "$(date -u): No tunnel URL found" >> "$LOG"
  exit 0
fi

if [ "$URL" = "$LAST" ]; then
  exit 0
fi

echo "$(date -u): Tunnel URL changed: $LAST -> $URL" >> "$LOG"

# Update Vercel env var + trigger production redeploy
cd /home/opc/freedomforge-max
if command -v vercel >/dev/null 2>&1; then
  # Remove old, add new env var
  vercel env rm ORACLE_API_URL production --yes 2>/dev/null || true
  printf "%s" "$URL" | vercel env add ORACLE_API_URL production 2>>"$LOG" && {
    echo "$URL" > "$VERCEL_SYNC_FILE"
    echo "$(date -u): Vercel ORACLE_API_URL updated to $URL" >> "$LOG"

    # Trigger a production redeploy so the new env var takes effect
    echo "$(date -u): Triggering Vercel production redeploy..." >> "$LOG"
    vercel --prod --yes 2>>"$LOG" && {
      echo "$(date -u): Vercel redeploy completed" >> "$LOG"
    } || {
      echo "$(date -u): Vercel redeploy FAILED (env var still updated)" >> "$LOG"
    }
  } || {
    echo "$(date -u): FAILED to update Vercel env" >> "$LOG"
  }
else
  echo "$(date -u): vercel CLI not found — cannot sync" >> "$LOG"
fi
