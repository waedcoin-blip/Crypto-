import { EventEmitter } from 'events';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { adminAuth, FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID } from '../utils/firebaseAdmin.js';
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
    const url = this.getFirestoreUrl(userId);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${idToken}`
      }
    });

    let state: AuthoritativeCriteriaState;
    if (res.ok) {
      const doc = await res.json();
      const data = parseFirestoreDocument(doc);
      state = {
        version: data.version || 1,
        updatedAt: data.updatedAt || new Date().toISOString(),
        source: data.source || 'persisted_disk_state',
        userId,
        criteria: { ...DEFAULT_CRITERIA, ...data }
      };
    } else {
      // Not found or permission denied -> fallback to default
      state = {
        version: 1,
        updatedAt: new Date().toISOString(),
        source: 'initial_system_defaults',
        userId,
        criteria: { ...DEFAULT_CRITERIA }
      };
    }

    this.activeUsers.set(userId, state);
    return state;
  }

  public async persistToFirestore(userId: string, idToken: string, state: AuthoritativeCriteriaState): Promise<void> {
    const url = this.getFirestoreUrl(userId);
    const docData = {
      ...state.criteria,
      version: state.version,
      updatedAt: state.updatedAt,
      source: state.source,
      userId: state.userId
    };
    
    const docPayload = toFirestoreDocument(docData);
    
    // We use PATCH without updateMask to replace the document fields (merge semantics require updateMask, but we are sending the full document anyway, wait, no, PATCH without updateMask replaces the document. We have the full document in state.criteria. Actually let's just use PATCH and let it overwrite. Wait, PATCH with no updateMask only updates the fields provided in the body, which is what we want! No, actually to merge we need updateMask. Since we send full merged criteria, we don't need updateMask.)
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(docPayload)
    });

    if (!res.ok) {
      const err = await res.text();
      logger.error({ err, userId }, 'Failed to persist criteria to Firestore');
      throw new Error('Failed to persist criteria to Firestore: ' + res.status);
    }
  }

  public getCriteriaState(userId: string): AuthoritativeCriteriaState {
    const state = this.activeUsers.get(userId);
    if (!state) {
      // In-memory fallback if not loaded yet
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

    // 2. Fetch existing state from Firestore (single source of truth)
    const currentState = await this.fetchCriteriaFromFirestore(userId, idToken);

    // 3. Verify Version
    if (options?.expectedVersion !== undefined) {
      if (options.expectedVersion !== currentState.version) {
        throw new Error(`Conflict: Expected version ${options.expectedVersion} but found ${currentState.version}.`);
      }
    }

    // 4. Validate partial payload
    const validated = criteriaSchema.parse(inputPayload);
    const { userId: payloadUserId, source: payloadSource, updatedAt: _clientUpdatedAt, version: _clientVersion, ...criteriaUpdates } = validated;

    // 5. Merge only changed fields
    const mergedCriteria: CriteriaConfig = {
      ...currentState.criteria,
      ...criteriaUpdates
    };

    const newVersion = currentState.version + 1;
    const newState: AuthoritativeCriteriaState = {
      version: newVersion,
      updatedAt: new Date().toISOString(),
      source: payloadSource || 'live_user_update',
      userId,
      criteria: mergedCriteria
    };

    // 6. Persist atomically back to Firestore
    await this.persistToFirestore(userId, idToken, newState);

    // 7. Update in-memory map
    this.activeUsers.set(userId, newState);

    // 8. Emit live update event for attached engine listeners
    this.emit('criteriaUpdated', newState);

    logger.info({
      version: newVersion,
      source: newState.source,
      userId: `${userId.slice(0, 6)}...`,
      updatedKeysCount: Object.keys(criteriaUpdates).length
    }, 'Authoritative criteria updated and persisted');

    return newState;
  }
}

export const criteriaService = CriteriaService.getInstance();
