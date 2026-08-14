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
}

export interface SyncStatus {
  lastSyncedAt: number | null;
  firebaseSynced: boolean;
  renderSynced: boolean;
  isSyncing: boolean;
  lastError: string | null;
}

const RENDER_PRIMARY_URL = 'https://crypto-yla8.onrender.com';

class SyncManager {
  private status: SyncStatus = {
    lastSyncedAt: null,
    firebaseSynced: false,
    renderSynced: false,
    isSyncing: false,
    lastError: null
  };

  private listeners: Array<(status: SyncStatus) => void> = [];
  private debounceTimer: any = null;
  private pendingPayload: CriteriaSyncPayload | null = null;
  private activeAbortController: AbortController | null = null;

  public subscribe(fn: (status: SyncStatus) => void): () => void {
    this.listeners.push(fn);
    fn(this.status);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
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
   * Immediately syncs criteria and trade size changes to both Render and Firebase database
   */
  public async syncImmediately(payload: Partial<CriteriaSyncPayload>, customUserId?: string): Promise<{ firebase: boolean; render: boolean }> {
    const timestamp = new Date().toISOString();
    const resolvedUserId = customUserId || auth.currentUser?.uid || 'anonymous_user';

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
      userId: resolvedUserId,
      updatedAt: timestamp,
      source: 'live_user_update'
    };

    this.status.isSyncing = true;
    this.status.lastError = null;
    this.notify();

    let firebaseSuccess = false;
    let renderSuccess = false;

    // 1. Synchronize to Firebase Database (Firestore)
    try {
      if (auth.currentUser) {
        const docRef = doc(db, 'settings', auth.currentUser.uid);
        await setDoc(docRef, fullPayload, { merge: true });
        firebaseSuccess = true;
        this.status.firebaseSynced = true;
        console.log('✅ [FIREBASE SYNC] Criteria and trade size updated on Firebase database');
      } else if (resolvedUserId && resolvedUserId !== 'anonymous_user') {
        const docRef = doc(db, 'settings', resolvedUserId);
        await setDoc(docRef, fullPayload, { merge: true });
        firebaseSuccess = true;
        this.status.firebaseSynced = true;
        console.log('✅ [FIREBASE SYNC] Criteria and trade size updated for user on Firebase');
      } else {
        // If not yet signed in, the local storage retains it and it will save upon auth state change
        console.log('ℹ️ [FIREBASE SYNC] Awaiting authenticated user session for cloud database commit');
      }
    } catch (err: any) {
      console.error('❌ [FIREBASE SYNC ERROR]', err);
      handleFirestoreError(err, OperationType.WRITE, `settings/${resolvedUserId}`);
      this.status.lastError = err?.message || 'Firebase sync failed';
    }

    // 2. Synchronize to Render Server
    if (this.activeAbortController) {
      this.activeAbortController.abort();
    }
    this.activeAbortController = new AbortController();
    const signal = this.activeAbortController.signal;

    try {
      const renderEndpoints = [
        `${RENDER_PRIMARY_URL}/api/criteria`,
        `${RENDER_PRIMARY_URL}/api/jup/config`,
        `/api/criteria`,
        `/api/jup/config`
      ];

      // Dispatch parallel sync calls
      const requests = renderEndpoints.map(async (url) => {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify(fullPayload),
            signal
          });
          return res.ok;
        } catch (e: any) {
          if (e.name === 'AbortError') return false;
          // Silently capture individual endpoint unreachable to allow best-effort sync
          return false;
        }
      });

      const results = await Promise.allSettled(requests);
      renderSuccess = results.some(r => r.status === 'fulfilled' && r.value === true);
      this.status.renderSynced = renderSuccess;
      console.log(`✅ [RENDER SYNC] Criteria and trade size posted to Render: ${renderSuccess ? 'SUCCESS' : 'QUEUED'}`);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('❌ [RENDER SYNC ERROR]', err);
      }
    } finally {
      this.status.isSyncing = false;
      this.status.lastSyncedAt = Date.now();
      this.notify();
    }

    return {
      firebase: firebaseSuccess,
      render: renderSuccess
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
