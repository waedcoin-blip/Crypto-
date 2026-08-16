// src/services/SyncService.ts

import { doc, setDoc } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';

export interface CriteriaSyncPayload {
  // Trade Size
  buyAmountSol: number;
  simulationBuyAmountSol?: number;

  // Hardened Entry Scanner Criteria
  hardenedMcapMinPump: number;
  hardenedMcapMinRaydium: number;
  hardenedMcapMax: number;
  hardenedLiquidityMin: number;
  hardenedLiquidityRatio: number;
  hardenedMaxRiskScore: number;
  hardenedMaxDevOwnership: number;
  hardenedMaxTop10: number;
  hardenedMinUniqueBuyers30s: number;
  hardenedMinBuyCount30s: number;
  hardenedMaxBuyCount30s: number;
  hardenedMinBuySellRatio: number;
  hardenedMaxBuySellRatio: number;
  hardenedMaxPriceChange1m: number;
  hardenedMinBondingProgress: number;
  hardenedMaxBondingProgress: number;
  hardenedMinAge: number;
  hardenedMaxAge: number;
  hardenedMinLatency: number;
  hardenedMaxLatency: number;
  hardenedMatchRequirement: number;
  enableLatencyGuard: boolean;
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

  /**
   * Fetch current authoritative criteria and version from backend
   */
  public async fetchAuthoritativeCriteria(): Promise<AuthoritativeCriteriaResponse | null> {
    try {
      const res = await fetch('/api/criteria', {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data: AuthoritativeCriteriaResponse = await res.json();
        if (data && typeof data.version === 'number') {
          this.status.backendVersion = data.version;
          this.status.backendSynced = true;
          this.notify();
          return data;
        }
      }
    } catch (e) {
      console.warn('Could not fetch authoritative criteria from backend:', e);
    }
    return null;
  }

  /**
   * Immediately syncs criteria and parameters to the authoritative backend endpoint and Firestore
   */
  public async syncImmediately(
    payload: Partial<CriteriaSyncPayload>,
    customUserId?: string
  ): Promise<{ firebase: boolean; backend: boolean; version: number | null }> {
    const timestamp = new Date().toISOString();
    const currentUid = auth.currentUser?.uid || customUserId;

    const fullPayload: CriteriaSyncPayload = {
      buyAmountSol: payload.buyAmountSol !== undefined ? Number(payload.buyAmountSol) : 0.1,
      hardenedMcapMinPump: payload.hardenedMcapMinPump !== undefined ? Number(payload.hardenedMcapMinPump) : 40000,
      hardenedMcapMinRaydium: payload.hardenedMcapMinRaydium !== undefined ? Number(payload.hardenedMcapMinRaydium) : 80000,
      hardenedMcapMax: payload.hardenedMcapMax !== undefined ? Number(payload.hardenedMcapMax) : 3000000,
      hardenedLiquidityMin: payload.hardenedLiquidityMin !== undefined ? Number(payload.hardenedLiquidityMin) : 20000,
      hardenedLiquidityRatio: payload.hardenedLiquidityRatio !== undefined ? Number(payload.hardenedLiquidityRatio) : 5,
      hardenedMaxRiskScore: payload.hardenedMaxRiskScore !== undefined ? Number(payload.hardenedMaxRiskScore) : 18,
      hardenedMaxDevOwnership: payload.hardenedMaxDevOwnership !== undefined ? Number(payload.hardenedMaxDevOwnership) : 10,
      hardenedMaxTop10: payload.hardenedMaxTop10 !== undefined ? Number(payload.hardenedMaxTop10) : 25.0,
      hardenedMinUniqueBuyers30s: payload.hardenedMinUniqueBuyers30s !== undefined ? Number(payload.hardenedMinUniqueBuyers30s) : 4,
      hardenedMinBuyCount30s: payload.hardenedMinBuyCount30s !== undefined ? Number(payload.hardenedMinBuyCount30s) : 5,
      hardenedMaxBuyCount30s: payload.hardenedMaxBuyCount30s !== undefined ? Number(payload.hardenedMaxBuyCount30s) : 30,
      hardenedMinBuySellRatio: payload.hardenedMinBuySellRatio !== undefined ? Number(payload.hardenedMinBuySellRatio) : 2.0,
      hardenedMaxBuySellRatio: payload.hardenedMaxBuySellRatio !== undefined ? Number(payload.hardenedMaxBuySellRatio) : 10.0,
      hardenedMaxPriceChange1m: payload.hardenedMaxPriceChange1m !== undefined ? Number(payload.hardenedMaxPriceChange1m) : 15.0,
      hardenedMinBondingProgress: payload.hardenedMinBondingProgress !== undefined ? Number(payload.hardenedMinBondingProgress) : 65,
      hardenedMaxBondingProgress: payload.hardenedMaxBondingProgress !== undefined ? Number(payload.hardenedMaxBondingProgress) : 100,
      hardenedMinAge: payload.hardenedMinAge !== undefined ? Number(payload.hardenedMinAge) : 0,
      hardenedMaxAge: payload.hardenedMaxAge !== undefined ? Number(payload.hardenedMaxAge) : 240,
      hardenedMinLatency: payload.hardenedMinLatency !== undefined ? Number(payload.hardenedMinLatency) : 0,
      hardenedMaxLatency: payload.hardenedMaxLatency !== undefined ? Number(payload.hardenedMaxLatency) : 250,
      hardenedMatchRequirement: payload.hardenedMatchRequirement !== undefined ? Number(payload.hardenedMatchRequirement) : 100,
      enableLatencyGuard: payload.enableLatencyGuard !== undefined ? payload.enableLatencyGuard : true,
      telemetryWhaleBuyMin: payload.telemetryWhaleBuyMin,
      telemetryHighBuyMin: payload.telemetryHighBuyMin,
      telemetryVolumeSpikeMin: payload.telemetryVolumeSpikeMin,
      telemetryAllowWhaleBuy: payload.telemetryAllowWhaleBuy,
      telemetryAllowHighBuy: payload.telemetryAllowHighBuy,
      telemetryAllowVolumeSpike: payload.telemetryAllowVolumeSpike,
      telemetryAllowMigrated: payload.telemetryAllowMigrated,
      telemetryAllowGoldenCross: payload.telemetryAllowGoldenCross,
      tradePumpFun: payload.tradePumpFun,
      tradeRaydium: payload.tradeRaydium,
      tradeBonding: payload.tradeBonding,
      tradeUnknown: payload.tradeUnknown,
      hardenedMinProfit5m: payload.hardenedMinProfit5m,
      maxRebuyTimes: payload.maxRebuyTimes,
      minTakeProfit: payload.minTakeProfit,
      maxTakeProfit: payload.maxTakeProfit,
      bondingCurveTakeProfit: payload.bondingCurveTakeProfit,
      stopLoss: payload.stopLoss,
      bondingCurveStopLoss: payload.bondingCurveStopLoss,
      pumpSwapStopLoss: payload.pumpSwapStopLoss,
      unknownStopLoss: payload.unknownStopLoss,
      maxPositions: payload.maxPositions,
      moonbagStrategy: payload.moonbagStrategy,
      slippage: payload.slippage,
      activePreset: payload.activePreset,
      rpcUrl: payload.rpcUrl,
      rpcUrl2: payload.rpcUrl2,
      customWsUrl: payload.customWsUrl,
      apiKey: payload.apiKey,
      jupiterRpcUrl: payload.jupiterRpcUrl,
      userId: currentUid,
      updatedAt: timestamp,
      source: 'live_user_update',
    };

    this.status.isSyncing = true;
    this.status.lastError = null;
    this.notify();

    let firebaseSuccess = false;
    let backendSuccess = false;
    let confirmedVersion: number | null = null;

    // 1. Authoritative Backend Synchronization (/api/criteria)
    if (this.activeAbortController) {
      this.activeAbortController.abort();
    }
    this.activeAbortController = new AbortController();
    const signal = this.activeAbortController.signal;

    try {
      const res = await fetch('/api/criteria', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(fullPayload),
        signal,
      });

      if (res.ok) {
        const data: AuthoritativeCriteriaResponse = await res.json();
        if (data && typeof data.version === 'number') {
          backendSuccess = true;
          confirmedVersion = data.version;
          this.status.backendSynced = true;
          this.status.backendVersion = data.version;
          console.log(`✅ [CRITERIA PERSISTED] Authoritative backend synced (Version: ${data.version}, Updated: ${data.updatedAt})`);
        }
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
    }

    // 2. Firebase Database (Firestore) Cloud Persistence for Authenticated User
    try {
      if (auth.currentUser && auth.currentUser.uid) {
        const docRef = doc(db, 'settings', auth.currentUser.uid);
        await setDoc(docRef, fullPayload, { merge: true });
        firebaseSuccess = true;
        this.status.firebaseSynced = true;
        console.log(`✅ [FIREBASE SYNC] Cloud settings updated for user: ${auth.currentUser.uid.slice(0, 6)}...`);
      } else {
        // Unauthenticated sessions store locally and defer cloud writes until sign-in
        this.status.firebaseSynced = false;
      }
    } catch (err: any) {
      console.error('❌ [FIREBASE SYNC ERROR]', err);
      if (currentUid) {
        handleFirestoreError(err, OperationType.WRITE, `settings/${currentUid}`);
      }
      this.status.lastError = err?.message || 'Firebase sync failed';
    } finally {
      this.status.isSyncing = false;
      this.status.lastSyncedAt = Date.now();
      this.notify();
    }

    return {
      firebase: firebaseSuccess,
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

    // Fast 150ms debounce for rapid slider/typing inputs
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
