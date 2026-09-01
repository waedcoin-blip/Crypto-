import { auth } from '../lib/firebase';

export interface CriteriaSyncPayload {
  // Trade Size
  buyAmountSol?: number;
  simulationBuyAmountSol?: number;

  // Hardened Entry Scanner Criteria
  hardenedMcapMinPump?: number;
  hardenedMcapMinRaydium?: number;
  hardenedMcapMax?: number;
  hardenedLiquidityMin?: number;
  hardenedLiquidityRatio?: number;
  hardenedMaxRiskScore?: number;
  hardenedMaxDevOwnership?: number;
  hardenedMaxTop10?: number;
  hardenedMinUniqueBuyers30s?: number;
  hardenedMinBuyCount30s?: number;
  hardenedMaxBuyCount30s?: number;
  hardenedMinBuySellRatio?: number;
  hardenedMaxBuySellRatio?: number;
  hardenedMaxPriceChange1m?: number;
  hardenedMinBondingProgress?: number;
  hardenedMaxBondingProgress?: number;
  hardenedMinAge?: number;
  hardenedMaxAge?: number;
  hardenedMinLatency?: number;
  hardenedMaxLatency?: number;
  hardenedMatchRequirement?: number;
  enableLatencyGuard?: boolean;
  telemetryWhaleBuyMin?: number;
  telemetryHighBuyMin?: number;
  telemetryVolumeSpikeMin?: number;
  telemetryAllowWhaleBuy?: boolean;
  telemetryAllowHighBuy?: boolean;
  telemetryAllowVolumeSpike?: boolean;
  telemetryAllowMigrated?: boolean;
  telemetryAllowGoldenCross?: boolean;
  tradePumpFun?: boolean;
  tradeRaydium?: boolean;
  tradeBonding?: boolean;
  tradeUnknown?: boolean;
  hardenedMinProfit5m?: number;
  maxRebuyTimes?: number;
  tradeOnlyOnce?: boolean;

  // Exit & Position Limits
  minTakeProfit?: number;
  maxTakeProfit?: number;
  bondingCurveTakeProfit?: number;
  stopLoss?: number;
  bondingCurveStopLoss?: number;
  pumpSwapStopLoss?: number;
  unknownStopLoss?: number;
  maxPositions?: number;
  moonbagStrategy?: boolean;
  slippage?: number;
  activePreset?: string;

  // Connection & Auth
  rpcUrl?: string;
  rpcUrl2?: string;
  customWsUrl?: string;
  apiKey?: string;
  jupiterRpcUrl?: string;

  // Metadata
  userId?: string;
  updatedAt?: string;
  source?: string;
  [key: string]: any;
}

export interface SyncStatus {
  lastSyncedAt: number | null;
  firebaseSynced: boolean;
  backendSynced: boolean;
  backendVersion: number | null;
  isSyncing: boolean;
  lastError: string | null;
}

export interface AuthoritativeCriteriaResponse {
  status: string;
  message?: string;
  version: number;
  updatedAt: string;
  source: string;
  userId?: string;
  criteria: Partial<CriteriaSyncPayload>;
  timestamp: number;
}

class SyncManager {
  private status: SyncStatus = {
    lastSyncedAt: null,
    firebaseSynced: false,
    backendSynced: false,
    backendVersion: null,
    isSyncing: false,
    lastError: null,
  };

  private listeners: Array<(status: SyncStatus) => void> = [];
  private debounceTimer: any = null;
  private pendingPayload: Partial<CriteriaSyncPayload> | null = null;
  private activeAbortController: AbortController | null = null;

  public subscribe(fn: (status: SyncStatus) => void): () => void {
    this.listeners.push(fn);
    fn({ ...this.status });
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener({ ...this.status });
      } catch (e) {
        console.error('Error in sync listener:', e);
      }
    }
  }

  public getStatus(): SyncStatus {
    return { ...this.status };
  }

  private async getAuthToken(): Promise<string | null> {
    if (!auth.currentUser) return null;
    try {
      return await auth.currentUser.getIdToken();
    } catch (e) {
      console.warn("Failed to get ID token", e);
      return null;
    }
  }

  /**
   * Fetch current authoritative criteria and version from backend
   */
  public async fetchAuthoritativeCriteria(): Promise<AuthoritativeCriteriaResponse | null> {
    const token = await this.getAuthToken();
    if (!token) return null;

    try {
      const res = await fetch('/api/criteria', {
        headers: { 
          Accept: 'application/json',
          Authorization: `Bearer ${token}`
        },
      });
      if (res.ok) {
        const data: AuthoritativeCriteriaResponse = await res.json();
        if (data && typeof data.version === 'number') {
          this.status.backendVersion = data.version;
          this.status.backendSynced = true;
          this.status.lastError = null;
          try {
            localStorage.setItem('app_last_known_criteria_v1', JSON.stringify({
              version: data.version,
              criteria: data.criteria,
              updatedAt: data.updatedAt
            }));
          } catch (e) {
            // Ignore localStorage quota errors
          }
          this.notify();
          return data;
        }
      } else {
        const errJson = await res.json().catch(() => null);
        const errMsg = errJson?.error || `Failed to fetch authoritative criteria (HTTP ${res.status})`;
        console.warn('⚠️ [CRITERIA PERSISTENCE FETCH ERROR]:', errMsg);
        this.status.backendSynced = false;
        this.status.lastError = errMsg;
        this.notify();
      }
    } catch (e: any) {
      console.warn('Could not fetch authoritative criteria from backend:', e);
      this.status.backendSynced = false;
      this.status.lastError = e?.message || 'Network error fetching criteria';
      this.notify();
    }
    return null;
  }

  /**
   * Retrieve the last-known-good criteria if offline or backend is inaccessible
   */
  public getLastKnownGoodCriteria(): Partial<CriteriaSyncPayload> | null {
    try {
      const saved = localStorage.getItem('app_last_known_criteria_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed?.criteria || null;
      }
    } catch (e) {
      console.error('Error reading last known good criteria:', e);
    }
    return null;
  }


  /**
   * Immediately syncs criteria and parameters to the authoritative backend endpoint and Firestore
   */
  public async syncImmediately(
    payload: Partial<CriteriaSyncPayload>,
    customUserId?: string
  ): Promise<{ backend: boolean; version: number | null }> {
    const token = await this.getAuthToken();
    if (!token) {
      this.status.lastError = 'Not authenticated';
      this.notify();
      return { backend: false, version: null };
    }

    // Build the partial update payload, removing undefined
    const changes: Partial<CriteriaSyncPayload> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined) {
        // Handle numbers correctly
        if (typeof value === 'string' && !isNaN(Number(value)) && key !== 'rpcUrl' && key !== 'rpcUrl2' && key !== 'customWsUrl' && key !== 'apiKey' && key !== 'jupiterRpcUrl' && key !== 'activePreset') {
            changes[key] = Number(value);
        } else {
            changes[key] = value;
        }
      }
    }

    this.status.isSyncing = true;
    this.status.lastError = null;
    this.notify();

    let backendSuccess = false;
    let confirmedVersion: number | null = null;

    if (this.activeAbortController) {
      this.activeAbortController.abort();
    }
    this.activeAbortController = new AbortController();
    const signal = this.activeAbortController.signal;

    try {
      const res = await fetch('/api/criteria', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          expectedVersion: this.status.backendVersion || undefined,
          changes
        }),
        signal,
      });

      if (res.ok) {
        const data: AuthoritativeCriteriaResponse = await res.json();
        if (data && typeof data.version === 'number') {
          backendSuccess = true;
          confirmedVersion = data.version;
          this.status.backendSynced = true;
          this.status.backendVersion = data.version;
          console.log(`✅ [CRITERIA PERSISTED] Authoritative backend synced (Version: ${data.version})`);
        }
      } else if (res.status === 409) {
        // Conflict
        const errJson = await res.json().catch(() => null);
        console.warn('⚠️ [VERSION CONFLICT]', errJson?.error);
        // We should reload authoritative criteria to resolve conflict
        await this.fetchAuthoritativeCriteria();
        this.status.backendSynced = false;
        this.status.lastError = errJson?.error || 'Version conflict';
      } else {
        const errJson = await res.json().catch(() => null);
        const errMsg = errJson?.error || `Backend criteria sync rejected with HTTP ${res.status}`;
        console.error('❌ [CRITERIA PERSISTENCE ERROR]', errMsg);
        this.status.backendSynced = false;
        this.status.lastError = errMsg;
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('❌ [BACKEND CRITERIA SYNC ERROR]', err);
        this.status.backendSynced = false;
        this.status.lastError = err?.message || 'Backend criteria sync failed';
      }
    } finally {
      this.status.isSyncing = false;
      this.status.lastSyncedAt = Date.now();
      this.notify();
    }

    return {
      backend: backendSuccess,
      version: confirmedVersion,
    };
  }

  /**
   * Trigger immediate or fast-debounced sync upon any user input changes
   */
  public triggerSync(payload: Partial<CriteriaSyncPayload>, customUserId?: string, immediate = false) {
    this.pendingPayload = { ...this.pendingPayload, ...payload };

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (immediate) {
      const p = this.pendingPayload;
      this.pendingPayload = null;
      return this.syncImmediately(p, customUserId);
    }

    this.debounceTimer = setTimeout(() => {
      if (this.pendingPayload) {
        const p = this.pendingPayload;
        this.pendingPayload = null;
        this.syncImmediately(p, customUserId);
      }
    }, 150);
  }
}

export const syncManager = new SyncManager();
