// src/hooks/useCriteria.ts
import { useState, useEffect, useCallback } from 'react';
import { criteriaApi } from '../services/ApiClient';
import { useAppStore } from '../store/appStore';

/**
 * useCriteria: Fetches and manages trading criteria from the backend.
 * The backend CriteriaRepository is the single source of truth.
 * Local state is a cache only.
 */
export function useCriteria() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const criteria = useAppStore((s) => s.criteria);
  const setCriteria = useAppStore((s) => s.setCriteria);
  const addLog = useAppStore((s) => s.addLog);

  // ---- Fetch criteria from backend ----
  const fetchCriteria = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await criteriaApi.get();
      if (res.status === 'success' && res.criteria) {
        setCriteria(res.criteria);
      }
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch criteria');
    } finally {
      setIsLoading(false);
    }
  }, [setCriteria]);

  // ---- Update criteria on backend ----
  const updateCriteria = useCallback(async (patch: Record<string, any>) => {
    try {
      const res = await criteriaApi.update(patch);
      if (res.status === 'success' && res.criteria) {
        setCriteria(res.criteria);
        addLog('✅ [CRITERIA] Updated trading criteria', 'success');
        return true;
      }
      return false;
    } catch (err: any) {
      addLog(`❌ [CRITERIA] Update failed: ${err?.message}`, 'error');
      return false;
    }
  }, [setCriteria, addLog]);

  // ---- Reset to defaults ----
  const resetCriteria = useCallback(async () => {
    try {
      const res = await criteriaApi.reset();
      if (res.status === 'success' && res.criteria) {
        setCriteria(res.criteria);
        addLog('🔄 [CRITERIA] Reset to defaults', 'info');
      }
    } catch (err: any) {
      addLog(`❌ [CRITERIA] Reset failed: ${err?.message}`, 'error');
    }
  }, [setCriteria, addLog]);

  // ---- Apply a named preset ----
  const applyPreset = useCallback(async (name: string) => {
    try {
      const res = await criteriaApi.applyPreset(name);
      if (res.status === 'success' && res.criteria) {
        setCriteria(res.criteria);
        addLog(`✅ [CRITERIA] Applied preset: ${name}`, 'success');
      }
    } catch (err: any) {
      addLog(`❌ [CRITERIA] Preset failed: ${err?.message}`, 'error');
    }
  }, [setCriteria, addLog]);

  // Initial fetch on mount
  useEffect(() => {
    fetchCriteria();
  }, [fetchCriteria]);

  return {
    criteria,
    isLoading,
    error,
    fetchCriteria,
    updateCriteria,
    resetCriteria,
    applyPreset,
  };
}
