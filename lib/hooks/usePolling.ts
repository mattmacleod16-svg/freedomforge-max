/**
 * usePolling — Client-side hook for dashboard real-time updates
 * Polls /api/status/* endpoints at specified intervals.
 * Automatically pauses when tab is hidden (visibility API).
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';

interface UsePollingOptions {
  endpoint: string;
  interval?: number; // ms, default 5000
  enabled?: boolean; // default true
  onData: (data: any) => void;
  onError?: (err: Error) => void;
}

export function usePolling({
  endpoint,
  interval = 5000,
  enabled = true,
  onData,
  onError,
}: UsePollingOptions): void {
  const intervalIdRef = useRef<NodeJS.Timeout | null>(null);
  const isVisibleRef = useRef(true);

  const poll = async () => {
    if (!isVisibleRef.current) {
      console.log(`[usePolling] Tab hidden, skipping poll for ${endpoint}`);
      return;
    }

    try {
      const response = await apiFetch(endpoint, { timeoutMs: 5000 });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      onData(data);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[usePolling] Error fetching ${endpoint}:`, error.message);
      if (onError) onError(error);
    }
  };

  useEffect(() => {
    if (!enabled) return;

    // Visibility API — pause polling when tab is hidden
    const handleVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === 'visible';
      if (isVisibleRef.current) {
        console.log(`[usePolling] Tab visible, resuming poll for ${endpoint}`);
        poll(); // Poll immediately on tab refocus
      } else {
        console.log(`[usePolling] Tab hidden, pausing poll for ${endpoint}`);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Initial poll
    poll();

    // Set up interval
    intervalIdRef.current = setInterval(poll, interval);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
      }
    };
  }, [endpoint, interval, enabled, onData, onError]);
}

/**
 * useDashboardPolling — Combined polling for all dashboard endpoints
 */
interface DashboardData {
  portfolio?: any;
  metrics?: any;
  riskMetrics?: any;
  lastUpdated?: string;
}

export function useDashboardPolling(
  enabled: boolean = true
): DashboardData & { isLoading: boolean; error: Error | null } {
  const [data, setData] = useState<DashboardData>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Poll /api/status/portfolio
  usePolling({
    endpoint: '/api/status/portfolio',
    interval: 5000,
    enabled,
    onData: (portfolioData) => {
      setData((prev) => ({
        ...prev,
        portfolio: portfolioData,
        lastUpdated: new Date().toISOString(),
      }));
      setIsLoading(false);
      setError(null);
    },
    onError: (err) => {
      setError(err);
      setIsLoading(false);
    },
  });

  // Poll /api/status/metrics
  usePolling({
    endpoint: '/api/status/metrics',
    interval: 5000,
    enabled,
    onData: (metricsData) => {
      setData((prev) => ({
        ...prev,
        metrics: metricsData,
        lastUpdated: new Date().toISOString(),
      }));
    },
    onError: (err) => {
      console.warn('[useDashboardPolling] Metrics error:', err.message);
    },
  });

  // Poll /api/status/risk
  usePolling({
    endpoint: '/api/status/risk',
    interval: 10000, // Less frequent for risk metrics
    enabled,
    onData: (riskData) => {
      setData((prev) => ({
        ...prev,
        riskMetrics: riskData,
        lastUpdated: new Date().toISOString(),
      }));
    },
    onError: (err) => {
      console.warn('[useDashboardPolling] Risk error:', err.message);
    },
  });

  return { ...data, isLoading, error };
}
