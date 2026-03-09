#!/bin/bash
while true; do
  URL=$(sudo journalctl -u ff-tunnel --no-pager -n 50 2>/dev/null | grep -oP "https://[a-z0-9-]+\.trycloudflare\.com" | tail -1)
  if [ -n "$URL" ]; then
    SAVED=$(cat /home/opc/freedomforge-max/data/tunnel-url.txt 2>/dev/null)
    if [ "$URL" != "$SAVED" ]; then
      echo "$URL" > /home/opc/freedomforge-max/data/tunnel-url.txt
      echo "$(date): URL updated to $URL" >> /home/opc/freedomforge-max/logs/tunnel-url.log
    fi
  fi
  sleep 30
done
