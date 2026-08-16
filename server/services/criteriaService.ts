// server/services/criteriaService.ts

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

export interface CriteriaConfig {
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

  // Extra generic keys
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
}).passthrough();

export class CriteriaService extends EventEmitter {
  private static instance: CriteriaService;
  private state: AuthoritativeCriteriaState;
  private filePath: string;

  private constructor() {
    super();
    // Default storage directory at data/criteria.json
    const storageDir = path.join(process.cwd(), 'data');
    this.filePath = path.join(storageDir, 'criteria.json');

    // Ensure data directory exists
    try {
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }
    } catch (e) {
      logger.warn({ err: e }, 'Could not create data directory, using in-memory store');
    }

    this.state = this.loadInitialState();
  }

  public static getInstance(): CriteriaService {
    if (!CriteriaService.instance) {
      CriteriaService.instance = new CriteriaService();
    }
    return CriteriaService.instance;
  }

  private loadInitialState(): AuthoritativeCriteriaState {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.version === 'number' && parsed.criteria) {
          logger.info({ version: parsed.version, updatedAt: parsed.updatedAt }, 'Loaded persisted criteria from disk');
          return {
            version: parsed.version,
            updatedAt: parsed.updatedAt || new Date().toISOString(),
            source: parsed.source || 'persisted_disk_state',
            userId: parsed.userId,
            criteria: { ...DEFAULT_CRITERIA, ...parsed.criteria }
          };
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed reading persisted criteria, falling back to defaults');
    }

    const initialState: AuthoritativeCriteriaState = {
      version: 1,
      updatedAt: new Date().toISOString(),
      source: 'initial_system_defaults',
      criteria: { ...DEFAULT_CRITERIA }
    };

    this.persistToDisk(initialState);
    return initialState;
  }

  private persistToDisk(state: AuthoritativeCriteriaState): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      logger.error({ err }, 'Failed to persist criteria to disk');
    }
  }

  public getCriteriaState(): AuthoritativeCriteriaState {
    return {
      version: this.state.version,
      updatedAt: this.state.updatedAt,
      source: this.state.source,
      userId: this.state.userId,
      criteria: { ...this.state.criteria }
    };
  }

  public updateCriteria(
    inputPayload: unknown,
    options?: { source?: string; userId?: string; expectedVersion?: number }
  ): AuthoritativeCriteriaState {
    // 1. Validate payload
    const validated = criteriaSchema.parse(inputPayload);

    // Extract metadata fields from payload if present
    const { userId: payloadUserId, source: payloadSource, updatedAt: _clientUpdatedAt, ...criteriaUpdates } = validated;

    const source = options?.source || payloadSource || 'live_user_update';
    const userId = options?.userId || payloadUserId || this.state.userId;

    // 2. Increment version and update state atomically
    const newVersion = this.state.version + 1;
    const newUpdatedAt = new Date().toISOString();

    const mergedCriteria: CriteriaConfig = {
      ...this.state.criteria,
      ...criteriaUpdates
    };

    const newState: AuthoritativeCriteriaState = {
      version: newVersion,
      updatedAt: newUpdatedAt,
      source,
      userId,
      criteria: mergedCriteria
    };

    this.state = newState;

    // 3. Persist to disk
    this.persistToDisk(newState);

    logger.info({
      version: newVersion,
      source,
      userId: userId ? `${userId.slice(0, 6)}...` : undefined,
      updatedKeysCount: Object.keys(criteriaUpdates).length
    }, 'Authoritative criteria updated and persisted');

    // 4. Emit live update event for attached engine listeners
    this.emit('criteriaUpdated', newState);

    return this.getCriteriaState();
  }
}

export const criteriaService = CriteriaService.getInstance();
