# FreedomForge Personal Info Sync Guide

## Overview

Sync your personal dashboard data (portfolio, trades, settings) across all your devices (web, mobile, desktop) with **vector clock conflict resolution**.

---

## Quick Start

### 1. **CLI Command** (Recommended)

```bash
# Local development
npm run sync:personal

# Production (Railway)
npm run sync:personal:prod

# Custom URL
node scripts/sync-personal-info.js https://your-domain.com
```

**Requirements:**
- Must be logged in via browser first (sets session cookie)
- Generates and stores device ID in `.device-id` file

**Output:**
```
╔════════════════════════════════════════════════════════════════════╗
║           FreedomForge Personal Info Sync                          ║
╚════════════════════════════════════════════════════════════════════╝
  Base URL:  http://localhost:3000
  Device ID: cli-1711270523456
  
📱 Registering device: cli-1711270523456
✅ Device registered: CLI (darwin)
📤 Pushing device deltas...
✅ Deltas pushed
   Vector clock: {"cli-1711270523456":1}
📥 Pulling full resolved state...
✅ Full state retrieved

╔════════════════════════════════════════════════════════════════════╗
║                    ✅ Sync Complete                                ║
╚════════════════════════════════════════════════════════════════════╝
```

---

## Advanced Usage

### 2. **Browser Console** (Dashboard)

Open the dashboard at `/dashboard`, press `F12`, then paste:

```javascript
const syncPersonalInfo = async () => {
  const deviceId = localStorage.getItem('ff-device-id') || `web-${Date.now()}`;
  localStorage.setItem('ff-device-id', deviceId);
  
  console.log('📱 Device ID:', deviceId);
  
  // Register device
  const reg = await fetch('/api/sync', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      deviceId,
      name: `Browser (${navigator.userAgent.split(' ').pop()})`,
      platform: 'web',
      userAgent: navigator.userAgent,
    })
  });
  console.log('📱 Device registered:', (await reg.json()).device.name);
  
  // Sync deltas
  const sync = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      deviceId,
      deltas: [],
      clock: {}
    })
  });
  const result = await sync.json();
  console.log('✅ Sync complete:', result);
};

syncPersonalInfo();
```

---

### 3. **React Hook** (Components)

In your dashboard component:

```tsx
import { usePersonalSync } from '@/lib/hooks/usePersonalSync';

export function SyncButton() {
  const { sync, status, message, isLoading } = usePersonalSync();

  return (
    <div>
      <button 
        onClick={() => sync()}
        disabled={isLoading}
        className="px-4 py-2 rounded bg-blue-600 text-white"
      >
        {isLoading ? 'Syncing...' : 'Sync Personal Info'}
      </button>
      
      <p className={status === 'error' ? 'text-red-600' : 'text-green-600'}>
        {message}
      </p>
    </div>
  );
}
```

### Full state refresh (one-time):

```javascript
const syncPersonalInfo = async () => {
  const result = await fetch('/api/sync?full=true', {
    credentials: 'include'
  });
  const data = await result.json();
  console.log('Full state:', data.resolvedState);
};
```

---

## API Endpoints

### `POST /api/sync` — Push deltas + receive missing deltas

```bash
curl -X POST http://localhost:3000/api/sync \
  -H 'Content-Type: application/json' \
  -b 'ff_session=...' \
  -d '{
    "deviceId": "cli-123",
    "deltas": [],
    "clock": {}
  }'
```

**Response:**
```json
{
  "status": "ok",
  "serverSeq": 42,
  "vectorClock": { "web-123": 1, "cli-456": 2 },
  "deltas": [
    {
      "deviceId": "web-123",
      "seq": 1,
      "ts": 1711270000000,
      "path": "settings.theme",
      "value": "dark",
      "checksum": "abc123..."
    }
  ],
  "resolvedConflicts": []
}
```

### `GET /api/sync?full=true` — Pull full resolved state

```bash
curl http://localhost:3000/api/sync?full=true \
  -b 'ff_session=...'
```

### `GET /api/sync?deviceId=web-123&clock={...}` — Pull missing deltas

```bash
curl 'http://localhost:3000/api/sync?deviceId=web-123&clock=%7B%7D' \
  -b 'ff_session=...'
```

### `PUT /api/sync` — Register/update device

```bash
curl -X PUT http://localhost:3000/api/sync \
  -H 'Content-Type: application/json' \
  -b 'ff_session=...' \
  -d '{
    "deviceId": "ios-789",
    "name": "iPhone 15",
    "platform": "ios",
    "userAgent": "FreedomForge/1.0"
  }'
```

### `DELETE /api/sync?deviceId=ios-789` — Unregister device

```bash
curl -X DELETE http://localhost:3000/api/sync?deviceId=ios-789 \
  -b 'ff_session=...'
```

---

## How It Works

### Vector Clock Conflict Resolution

Each device has a logical clock `[deviceId]: sequenceNumber`. When syncing:

1. **Client sends**: latest deltas + current vector clock
2. **Server merges** new deltas, increments own clock
3. **Server returns**: missing deltas + merged vector clock
4. **Client applies** missing deltas in causal order

**Conflict scenario:**
- Device A: `settings.theme = "light"` (ts 1000)
- Device B: `settings.theme = "dark"` (ts 2000)
- **Winner**: Device B (later timestamp) ✅

---

## Troubleshooting

### ❌ "Unauthorized" Error

```
❌ Unauthorized — you must be logged in first
   Log in at http://localhost:3000/login then try again
```

**Fix:** Log in at `/login` with your admin credentials, then retry.

### ❌ "Invalid JSON response"

```
❌ Invalid JSON response: <html>...
```

**Fix:** Check the URL is correct (e.g., `https://freedomforge.one` for production).

### ❌ "HTTP 400: Missing deviceId"

**Fix:** Device ID is auto-generated. If missing, delete `.device-id` and retry.

### ❌ Conflicts not resolving

Conflicts are resolved by timestamp automatically. Check sync logs:

```bash
# View last sync attempt (CLI)
cat scripts/sync-personal-info.js | grep -A5 "resolvedConflicts"
```

---

## Device Management

### View All Devices

Currently synced devices are stored in `data/sync/devices.json` (local only).

### Remove a Device

```bash
curl -X DELETE http://localhost:3000/api/sync?deviceId=cli-1711270523456 \
  -b 'ff_session=...'
```

---

## Environment Variables

```bash
# Override default URL
export SYNC_URL=https://your-api.com
npm run sync:personal

# For CI/CD: pass session cookie
export FF_SESSION_COOKIE="ff_session=abc123..."
npm run sync:personal:prod
```

---

## Schema

### SyncDelta

```typescript
interface SyncDelta {
  deviceId: string;        // Device that made the change
  seq: number;            // Sequence number on that device
  ts: number;             // Timestamp (milliseconds)
  path: string;           // JSON pointer (e.g., "settings.theme")
  value: unknown;         // New value
  checksum: string;       // SHA-256(JSON.stringify(value))
}
```

### VectorClock

```typescript
type VectorClock = Record<string, number>;
// Example: { "web-123": 5, "ios-456": 3, "cli-789": 1 }
```

### Device Record

```typescript
interface DeviceRecord {
  deviceId: string;
  name: string;
  platform: "ios" | "android" | "web" | "desktop" | "api";
  registeredAt: number;
  lastSyncAt: number;
  lastSyncSeq: number;
  userAgent?: string;
  ipHash?: string;  // SHA-256(IP) for privacy
}
```

---

## Performance Tips

1. **Sync frequently** for best UX:
   - After dashboard data changes
   - Before critical trades
   - On app startup (browser)
   - Every 5-10 minutes (mobile background)

2. **Use full refresh** periodically:
   - Once per session
   - After long offline periods
   - `?full=true` replaces delta-based sync

3. **Monitor deltas**:
   - CLI shows: `Deltas to apply: 12`
   - Browser: `status.deltaCount`
   - High counts = out of sync for a while

---

## Security

✅ **Encrypted in transit** — HTTPS only  
✅ **Session-gated** — Requires login  
✅ **Device fingerprinting** — IP hash stored (not raw IP)  
✅ **Checksum validation** — SHA-256 per delta  
✅ **Last-write-wins** — No data loss, conflicts logged  

---

## See Also

- [lib/auth/session.ts](../lib/auth/session.ts) — Session validation
- [lib/sync/syncEngine.ts](../lib/sync/syncEngine.ts) — Sync implementation
- [app/api/sync/route.ts](../app/api/sync/route.ts) — API endpoints
