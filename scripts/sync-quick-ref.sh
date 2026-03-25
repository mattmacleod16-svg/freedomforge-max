#!/bin/bash
# Quick Reference: FreedomForge Personal Sync Commands
# ════════════════════════════════════════════════════════════════════

echo "📱 FreedomForge Personal Info Sync — Quick Reference"
echo ""
echo "━━━ CLI Commands ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Local dev:"
echo "    npm run sync:personal"
echo ""
echo "  Production (Railway):"
echo "    npm run sync:personal:prod"
echo ""
echo "  Custom URL:"
echo "    node scripts/sync-personal-info.js https://your-api.com"
echo ""
echo "━━━ Browser Console ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Open /dashboard, press F12, then paste:"
echo ""
echo '    fetch("/api/sync", {'
echo '      method: "POST",'
echo '      headers: { "Content-Type": "application/json" },'
echo '      credentials: "include",'
echo '      body: JSON.stringify({'
echo '        deviceId: localStorage.getItem("ff-device-id") || `web-${Date.now()}`,'
echo '        deltas: [],'
echo '        clock: {}'
echo '      })'
echo '    }).then(r => r.json()).then(d => console.log("✅", d))'
echo ""
echo "━━━ React Component ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  import { usePersonalSync } from '@/lib/hooks/usePersonalSync';"
echo ""
echo "  const { sync, status } = usePersonalSync();"
echo "  <button onClick={() => sync()}>Sync</button>"
echo ""
echo "━━━ Requirements ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  ✓ Must be logged in at /login first"
echo "  ✓ Session cookie: ff_session (auto-sent with credentials: 'include')"
echo "  ✓ Device ID auto-generated on first run, stored locally"
echo ""
echo "━━━ Status Codes ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  200 OK           — Sync successful"
echo "  401 Unauthorized — Not logged in, visit /login"
echo "  400 Bad Request  — Missing required fields"
echo "  500 Server Error — Backend issue"
echo ""
echo "━━━ Docs ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  📖 Full guide: docs/SYNC-GUIDE.md"
echo ""
