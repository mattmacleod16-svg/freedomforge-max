#!/bin/bash
# Extract current tunnel URL from cloudflared logs
URL=$(sudo journalctl -u ff-tunnel --no-pager -n 50 2>/dev/null | grep -oP "https://[a-z0-9-]+\.trycloudflare\.com" | tail -1)
if [ -n "$URL" ]; then
  echo "$URL" > /home/opc/freedomforge-max/data/tunnel-url.txt
  echo "Dashboard: $URL/dashboard"
  echo "API:       $URL/api/status/empire"
  echo "Saved to:  data/tunnel-url.txt"
else
  echo "No tunnel URL found. Check: sudo systemctl status ff-tunnel"
fi
