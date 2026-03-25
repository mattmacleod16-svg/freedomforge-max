/**
 * usePersonalSync — Browser hook for cross-device sync
 * ═════════════════════════════════════════════════════════════════════════
 * 
 * Usage in React components:
 *   const { sync, status, error } = usePersonalSync();
 *   
 *   const handleSync = async () => {
 *     await sync();
 *   };
 * 
 */

'use client';

import { useCallback, useEffect, useState, useRef } from 'react';

export interface SyncStatus {
  status: 'idle' | 'syncing' | 'success' | 'error';
  message: string;
  timestamp: number;
  deltaCount: number;
}

export function usePersonalSync() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    status: 'idle',
    message: 'Ready to sync',
    timestamp: Date.now(),
    deltaCount: 0,
  });

  const deviceIdRef = useRef<string>('');

  // Get or create device ID
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('ff-device-id');
      if (stored) {
        deviceIdRef.current = stored;
      } else {
        const newId = `web-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        localStorage.setItem('ff-device-id', newId);
        deviceIdRef.current = newId;
      }
    }
  }, []);

  const sync = useCallback(async (options?: { full?: boolean }) => {
    setSyncStatus((prev) => ({
      ...prev,
      status: 'syncing',
      message: 'Syncing personal info...',
      timestamp: Date.now(),
    }));

    try {
      // Step 1: Register device
      const registerRes = await fetch('/api/sync', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          deviceId: deviceIdRef.current,
          name: `Web (${navigator.userAgent.split(' ').at(-1)})`,
          platform: 'web',
          userAgent: navigator.userAgent,
        }),
      });

      if (registerRes.status === 401) {
        setSyncStatus((prev) => ({
          ...prev,
          status: 'error',
          message: 'Not authenticated. Please log in.',
          timestamp: Date.now(),
        }));
        return false;
      }

      if (!registerRes.ok) {
        throw new Error(`Registration failed: ${registerRes.statusText}`);
      }

      // Step 2: Full state or delta push
      let deltas = [];
      let clock = {};

      if (options?.full) {
        // Pull full resolved state
        const fullRes = await fetch('/api/sync?full=true', {
          credentials: 'include',
        });
        if (!fullRes.ok) throw new Error('Failed to fetch full state');
        const fullData = await fullRes.json();
        setSyncStatus((prev) => ({
          ...prev,
          status: 'success',
          message: `✅ Full sync complete — ${Object.keys(fullData?.resolvedState || {}).length} objects`,
          timestamp: Date.now(),
          deltaCount: 0,
        }));
        return fullData;
      }

      // Normal delta push/pull
      const syncRes = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          deviceId: deviceIdRef.current,
          deltas: [],
          clock: {},
        }),
      });

      if (!syncRes.ok) throw new Error(`Sync failed: ${syncRes.statusText}`);
      const syncData = await syncRes.json();

      setSyncStatus((prev) => ({
        ...prev,
        status: 'success',
        message: `✅ Synced — ${syncData.deltas?.length || 0} deltas applied`,
        timestamp: Date.now(),
        deltaCount: syncData.deltas?.length || 0,
      }));

      return syncData;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setSyncStatus((prev) => ({
        ...prev,
        status: 'error',
        message: `❌ ${message}`,
        timestamp: Date.now(),
      }));
      return false;
    }
  }, []);

  return {
    sync,
    status: syncStatus.status,
    message: syncStatus.message,
    deltaCount: syncStatus.deltaCount,
    isLoading: syncStatus.status === 'syncing',
  };
}

export default usePersonalSync;
