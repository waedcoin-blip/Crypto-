import { useState, useEffect, useCallback } from 'react';

export interface SupervisorStatus {
  state: string;
  network: string;
  wallet: string;
  startedAt?: number;
  stoppedAt?: number;
  activePositionsCount?: number;
  healthMap?: Record<string, string>;
  lastError?: string;
  isRunning: boolean;
}

export function useSupervisor(pollIntervalMs: number = 3000) {
  const [status, setStatus] = useState<SupervisorStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/trading/supervisor/status');
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success') {
          setStatus({
            state: data.state || 'STOPPED',
            network: data.network || 'paper',
            wallet: data.wallet || 'default',
            startedAt: data.startedAt,
            stoppedAt: data.stoppedAt,
            activePositionsCount: data.activePositionsCount,
            healthMap: data.healthMap,
            lastError: data.lastError,
            isRunning: data.state === 'TRADING' || data.state === 'RUNNING',
          });
        }
      }
    } catch {
      // Ignore background network errors
    } finally {
      setIsLoading(false);
    }
  }, []);

  const startTrading = useCallback(async (params?: { network?: string; wallet?: string }) => {
    try {
      const res = await fetch('/api/trading/supervisor/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params || {}),
      });
      const data = await res.json();
      await fetchStatus();
      return data;
    } catch (err: any) {
      return { status: 'error', error: err?.message };
    }
  }, [fetchStatus]);

  const stopTrading = useCallback(async () => {
    try {
      const res = await fetch('/api/trading/supervisor/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      await fetchStatus();
      return data;
    } catch (err: any) {
      return { status: 'error', error: err?.message };
    }
  }, [fetchStatus]);

  const forceRecovery = useCallback(async (reason?: string) => {
    try {
      const res = await fetch('/api/trading/supervisor/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      await fetchStatus();
      return data;
    } catch (err: any) {
      return { status: 'error', error: err?.message };
    }
  }, [fetchStatus]);

  useEffect(() => {
    fetchStatus();
    if (pollIntervalMs > 0) {
      const interval = setInterval(fetchStatus, pollIntervalMs);
      return () => clearInterval(interval);
    }
  }, [fetchStatus, pollIntervalMs]);

  return {
    status,
    isLoading,
    refresh: fetchStatus,
    startTrading,
    stopTrading,
    forceRecovery,
  };
}
