import { EventEmitter } from 'events';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { adminAuth, adminDb, FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID } from '../utils/firebaseAdmin.js';
import { toFirestoreDocument, parseFirestoreDocument } from '../utils/firestoreConverter.js';

export interface CriteriaConfig {
  buyAmountSol: number;
  simulationBuyAmountSol?: number;
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
  rpcUrl?: string;
  rpcUrl2?: string;
  customWsUrl?: string;
  apiKey?: string;
  jupiterRpcUrl?: string;
  [key: string]: any;
}

export interface AuthoritativeCriteriaState {
  version: number;
  updatedAt: string;
  source: string;
  userId?: string;
  criteria: CriteriaConfig;
  updateTime?: string;
}

export const DEFAULT_CRITERIA: CriteriaConfig = {
  buyAmountSol: 0.1,
  simulationBuyAmountSol: 0.1,
  hardenedMcapMinPump: 40000,
  hardenedMcapMinRaydium: 80000,
  hardenedMcapMax: 3000000,
  hardenedLiquidityMin: 20000,
  hardenedLiquidityRatio: 5,
  hardenedMaxRiskScore: 18,
  hardenedMaxDevOwnership: 10,
  hardenedMaxTop10: 25.0,
  hardenedMinUniqueBuyers30s: 4,
  hardenedMinBuyCount30s: 5,
  hardenedMaxBuyCount30s: 30,
  hardenedMinBuySellRatio: 2.0,
  hardenedMaxBuySellRatio: 10.0,
  hardenedMaxPriceChange1m: 15.0,
  hardenedMinBondingProgress: 65,
  hardenedMaxBondingProgress: 100,
  hardenedMinAge: 0,
  hardenedMaxAge: 240,
  hardenedMinLatency: 0,
  hardenedMaxLatency: 250,
  hardenedMatchRequirement: 100,
  enableLatencyGuard: true,
  telemetryWhaleBuyMin: 5,
  telemetryHighBuyMin: 2,
  telemetryVolumeSpikeMin: 10,
  telemetryAllowWhaleBuy: true,
  telemetryAllowHighBuy: true,
  telemetryAllowVolumeSpike: true,
  telemetryAllowMigrated: true,
  telemetryAllowGoldenCross: true,
  tradePumpFun: true,
  tradeRaydium: true,
  tradeBonding: true,
  tradeUnknown: false,
  hardenedMinProfit5m: 0,
  maxRebuyTimes: 3,
  minTakeProfit: 25,
  maxTakeProfit: 45,
  bondingCurveTakeProfit: 25,
  pumpSwapTakeProfit: 25,
  stopLoss: -30,
  bondingCurveStopLoss: -30,
  pumpSwapStopLoss: -30,
  unknownStopLoss: -30,
  maxPositions: 5,
  moonbagStrategy: false,
  slippage: 1.0,
  activePreset: 'conservative',
  rpcUrl: '',
  rpcUrl2: '',
  customWsUrl: '',
  apiKey: '',
  jupiterRpcUrl: ''
};

export const criteriaSchema = z.object({
  buyAmountSol: z.coerce.number().min(0.0001).max(1000).optional(),
  simulationBuyAmountSol: z.coerce.number().optional(),
  hardenedMcapMinPump: z.coerce.number().optional(),
  hardenedMcapMinRaydium: z.coerce.number().optional(),
  hardenedMcapMax: z.coerce.number().optional(),
  hardenedLiquidityMin: z.coerce.number().optional(),
  hardenedLiquidityRatio: z.coerce.number().optional(),
  hardenedMaxRiskScore: z.coerce.number().optional(),
  hardenedMaxDevOwnership: z.coerce.number().optional(),
  hardenedMaxTop10: z.coerce.number().optional(),
  hardenedMinUniqueBuyers30s: z.coerce.number().optional(),
  hardenedMinBuyCount30s: z.coerce.number().optional(),
  hardenedMaxBuyCount30s: z.coerce.number().optional(),
  hardenedMinBuySellRatio: z.coerce.number().optional(),
  hardenedMaxBuySellRatio: z.coerce.number().optional(),
  hardenedMaxPriceChange1m: z.coerce.number().optional(),
  hardenedMinBondingProgress: z.coerce.number().optional(),
  hardenedMaxBondingProgress: z.coerce.number().optional(),
  hardenedMinAge: z.coerce.number().optional(),
  hardenedMaxAge: z.coerce.number().optional(),
  hardenedMinLatency: z.coerce.number().optional(),
  hardenedMaxLatency: z.coerce.number().optional(),
  hardenedMatchRequirement: z.coerce.number().optional(),
  enableLatencyGuard: z.coerce.boolean().optional(),
  telemetryWhaleBuyMin: z.coerce.number().optional(),
  telemetryHighBuyMin: z.coerce.number().optional(),
  telemetryVolumeSpikeMin: z.coerce.number().optional(),
  telemetryAllowWhaleBuy: z.coerce.boolean().optional(),
  telemetryAllowHighBuy: z.coerce.boolean().optional(),
  telemetryAllowVolumeSpike: z.coerce.boolean().optional(),
  telemetryAllowMigrated: z.coerce.boolean().optional(),
  telemetryAllowGoldenCross: z.coerce.boolean().optional(),
  tradePumpFun: z.coerce.boolean().optional(),
  tradeRaydium: z.coerce.boolean().optional(),
  tradeBonding: z.coerce.boolean().optional(),
  tradeUnknown: z.coerce.boolean().optional(),
  hardenedMinProfit5m: z.coerce.number().optional(),
  maxRebuyTimes: z.coerce.number().optional(),
  minTakeProfit: z.coerce.number().optional(),
  maxTakeProfit: z.coerce.number().optional(),
  bondingCurveTakeProfit: z.coerce.number().optional(),
  pumpSwapTakeProfit: z.coerce.number().optional(),
  stopLoss: z.coerce.number().optional(),
  bondingCurveStopLoss: z.coerce.number().optional(),
  pumpSwapStopLoss: z.coerce.number().optional(),
  unknownStopLoss: z.coerce.number().optional(),
  maxPositions: z.coerce.number().optional(),
  moonbagStrategy: z.coerce.boolean().optional(),
  slippage: z.coerce.number().optional(),
  activePreset: z.string().optional(),
  rpcUrl: z.string().optional(),
  rpcUrl2: z.string().optional(),
  customWsUrl: z.string().optional(),
  apiKey: z.string().optional(),
  jupiterRpcUrl: z.string().optional(),
  userId: z.string().optional(),
  source: z.string().optional(),
  updatedAt: z.string().optional(),
  version: z.coerce.number().optional(),
}).passthrough();

export class CriteriaService extends EventEmitter {
  private static instance: CriteriaService;
  // User ID -> Criteria State
  private activeUsers = new Map<string, AuthoritativeCriteriaState>();

  private constructor() {
    super();
  }

  public static getInstance(): CriteriaService {
    if (!CriteriaService.instance) {
      CriteriaService.instance = new CriteriaService();
    }
    return CriteriaService.instance;
  }

  private getFirestoreUrl(userId: string) {
    return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/settings/${userId}`;
  }

  public async fetchCriteriaFromFirestore(userId: string, idToken: string): Promise<AuthoritativeCriteriaState> {
    // 1. Try Admin SDK if initialized and functional
    if (adminDb) {
      try {
        const docRef = adminDb.doc(`settings/${userId}`);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
          const data = docSnap.data() || {};
          const state: AuthoritativeCriteriaState = {
            version: typeof data.version === 'number' ? data.version : 1,
            updatedAt: data.updatedAt || (docSnap.updateTime ? docSnap.updateTime.toDate().toISOString() : new Date().toISOString()),
            source: data.source || 'persisted_disk_state',
            userId,
            criteria: { ...DEFAULT_CRITERIA, ...data },
            updateTime: docSnap.updateTime ? docSnap.updateTime.toDate().toISOString() : undefined
          };
          this.activeUsers.set(userId, state);
          return state;
        } else {
          // Document genuinely does NOT exist yet (new user) -> defaults
          const state: AuthoritativeCriteriaState = {
            version: 1,
            updatedAt: new Date().toISOString(),
            source: 'initial_system_defaults',
            userId,
            criteria: { ...DEFAULT_CRITERIA }
          };
          this.activeUsers.set(userId, state);
          return state;
        }
      } catch (adminErr: any) {
        logger.warn({ err: adminErr.message, userId }, 'Admin SDK getDoc failed, attempting authenticated REST fallback');
      }
    }

    // 2. Authenticated REST fallback using verified user ID token
    const url = this.getFirestoreUrl(userId);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${idToken}`
        }
      });
    } catch (networkErr: any) {
      logger.error({ err: networkErr.message, userId }, 'Network failure connecting to Firestore REST API');
      throw new Error(`Firestore connection error: ${networkErr.message}`);
    }

    if (res.ok) {
      const doc = await res.json();
      const data = parseFirestoreDocument(doc);
      const state: AuthoritativeCriteriaState = {
        version: typeof data.version === 'number' ? data.version : 1,
        updatedAt: data.updatedAt || doc.updateTime || new Date().toISOString(),
        source: data.source || 'persisted_disk_state',
        userId,
        criteria: { ...DEFAULT_CRITERIA, ...data },
        updateTime: doc.updateTime
      };
      this.activeUsers.set(userId, state);
      return state;
    } else if (res.status === 404) {
      // ONLY genuine 404 indicates the document has not yet been created -> initialize default criteria
      const state: AuthoritativeCriteriaState = {
        version: 1,
        updatedAt: new Date().toISOString(),
        source: 'initial_system_defaults',
        userId,
        criteria: { ...DEFAULT_CRITERIA }
      };
      this.activeUsers.set(userId, state);
      return state;
    } else {
      // 401 (Auth error), 403 (Permission error), 500/503 (Server/Firestore error)
      // CRITICAL: NEVER convert database/auth errors into defaults!
      const errText = await res.text().catch(() => '');
      logger.error({ status: res.status, errText, userId }, 'Firestore read error - rejecting with persistence failure');
      throw new Error(`Firestore read failed (HTTP ${res.status}): ${errText || 'Unable to access persistence storage'}`);
    }
  }

  public getCriteriaState(userId: string): AuthoritativeCriteriaState {
    const state = this.activeUsers.get(userId);
    if (!state) {
      return {
        version: 1,
        updatedAt: new Date().toISOString(),
        source: 'initial_system_defaults',
        userId,
        criteria: { ...DEFAULT_CRITERIA }
      };
    }
    return state;
  }

  public async updateCriteria(
    idToken: string,
    inputPayload: unknown,
    options?: { expectedVersion?: number }
  ): Promise<AuthoritativeCriteriaState> {
    // 1. Verify token
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const userId = decodedToken.uid;

    // 2. Validate partial payload
    const validated = criteriaSchema.parse(inputPayload);
    const { userId: payloadUserId, source: payloadSource, updatedAt: _clientUpdatedAt, version: _clientVersion, ...criteriaUpdates } = validated;

    // 3. ATOMIC TRANSACTIONS VIA ADMIN SDK
    if (adminDb) {
      try {
        const docRef = adminDb.doc(`settings/${userId}`);
        const resultState = await adminDb.runTransaction(async (transaction) => {
          const docSnap = await transaction.get(docRef);
          
          if (!docSnap.exists) {
            // New document
            if (options?.expectedVersion !== undefined && options.expectedVersion !== 1) {
              throw new Error(`Conflict: Document does not exist, expected version ${options.expectedVersion}.`);
            }
            const initialMerged: CriteriaConfig = {
              ...DEFAULT_CRITERIA,
              ...criteriaUpdates
            };
            const now = new Date().toISOString();
            const newState: AuthoritativeCriteriaState = {
              version: 1,
              updatedAt: now,
              source: payloadSource || 'initial_user_setup',
              userId,
              criteria: initialMerged
            };
            transaction.set(docRef, {
              ...initialMerged,
              version: 1,
              updatedAt: now,
              source: newState.source,
              userId
            });
            return newState;
          }

          // Existing document
          const existingData = docSnap.data() || {};
          const currentVersion = typeof existingData.version === 'number' ? existingData.version : 1;

          // Enforce atomic optimistic concurrency version matching
          if (options?.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
            throw new Error(`Conflict: Expected version ${options.expectedVersion} but found ${currentVersion}.`);
          }

          const nextVersion = currentVersion + 1;
          const mergedCriteria: CriteriaConfig = {
            ...DEFAULT_CRITERIA,
            ...existingData,
            ...criteriaUpdates
          };

          const now = new Date().toISOString();
          const newState: AuthoritativeCriteriaState = {
            version: nextVersion,
            updatedAt: now,
            source: payloadSource || 'live_user_update',
            userId,
            criteria: mergedCriteria,
            updateTime: docSnap.updateTime ? docSnap.updateTime.toDate().toISOString() : undefined
          };

          transaction.set(docRef, {
            ...mergedCriteria,
            version: nextVersion,
            updatedAt: now,
            source: newState.source,
            userId
          }, { merge: true });

          return newState;
        });

        // Update in-memory cache and emit events
        this.activeUsers.set(userId, resultState);
        this.emit('criteriaUpdated', resultState);

        logger.info({
          version: resultState.version,
          source: resultState.source,
          userId: `${userId.slice(0, 6)}...`,
          updatedKeysCount: Object.keys(criteriaUpdates).length
        }, 'Authoritative criteria atomically committed via Admin Firestore Transaction');

        return resultState;
      } catch (adminErr: any) {
        if (adminErr.message?.startsWith('Conflict:')) {
          throw adminErr; // Propagate 409 conflict directly
        }
        logger.warn({ err: adminErr.message, userId }, 'Admin SDK transaction failed, falling back to REST precondition execution');
      }
    }

    // 4. ATOMIC PRECONDITION FALLBACK VIA REST
    const currentState = await this.fetchCriteriaFromFirestore(userId, idToken);

    if (options?.expectedVersion !== undefined && options.expectedVersion !== currentState.version) {
      throw new Error(`Conflict: Expected version ${options.expectedVersion} but found ${currentState.version}.`);
    }

    const nextVersion = currentState.version + 1;
    const mergedCriteria: CriteriaConfig = {
      ...currentState.criteria,
      ...criteriaUpdates
    };

    const now = new Date().toISOString();
    const newState: AuthoritativeCriteriaState = {
      version: nextVersion,
      updatedAt: now,
      source: payloadSource || 'live_user_update',
      userId,
      criteria: mergedCriteria
    };

    const docData = {
      ...mergedCriteria,
      version: nextVersion,
      updatedAt: now,
      source: newState.source,
      userId
    };

    const docPayload = toFirestoreDocument(docData);
    let patchUrl = this.getFirestoreUrl(userId);
    if (currentState.updateTime) {
      patchUrl += `?currentDocument.updateTime=${encodeURIComponent(currentState.updateTime)}`;
    }

    const res = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(docPayload)
    });

    if (!res.ok) {
      if (res.status === 412 || res.status === 409) {
        throw new Error(`Conflict: Concurrent criteria update detected on Firestore document.`);
      }
      const err = await res.text();
      logger.error({ err, status: res.status, userId }, 'Failed to persist criteria via REST precondition');
      throw new Error(`Failed to persist criteria to Firestore (HTTP ${res.status}): ${err}`);
    }

    const resDoc = await res.json().catch(() => null);
    if (resDoc?.updateTime) {
      newState.updateTime = resDoc.updateTime;
    }

    this.activeUsers.set(userId, newState);
    this.emit('criteriaUpdated', newState);

    logger.info({
      version: nextVersion,
      source: newState.source,
      userId: `${userId.slice(0, 6)}...`,
      updatedKeysCount: Object.keys(criteriaUpdates).length
    }, 'Authoritative criteria atomically committed via REST precondition');

    return newState;
  }
}

export const criteriaService = CriteriaService.getInstance();

