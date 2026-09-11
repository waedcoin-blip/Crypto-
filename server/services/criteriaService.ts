// server/services/criteriaService.ts
import { EventEmitter } from 'events';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

export interface CriteriaConfig {
  // Entry Criteria
  minMarketCap: number;
  maxMarketCap: number;
  minLiquidity: number;
  minLiquidityRatio: number;
  maxRiskScore: number;
  maxDevOwnership: number;
  maxTop10Ownership: number;
  minAge: number;           // minutes
  maxAge: number;           // minutes
  minBondingProgress: number;
  maxBondingProgress: number;
  minUniqueBuyers30s: number;
  minBuyCount30s: number;
  maxBuyCount30s: number;
  minBuySellRatio: number;
  maxBuySellRatio: number;
  maxPriceChange1m: number;
  minProfit5m: number;
  minLatency: number;
  maxLatency: number;

  // Trade Settings
  buyAmountSol: number;
  minBuyAmount: number;
  slippage: number;         // percentage (e.g., 1.0 = 1%)
  maxPositions: number;
  maxRebuyTimes: number;
  tradeOnlyOnce: boolean;
  tradePumpFun: boolean;
  tradeRaydium: boolean;
  tradeBonding: boolean;
  tradeUnknown: boolean;

  // Exit Criteria
  minTakeProfit: number;    // percentage
  maxTakeProfit: number;
  bondingCurveTakeProfit: number;
  stopLoss: number;         // percentage (positive number, evaluated as negative)
  bondingCurveStopLoss: number;
  pumpSwapStopLoss: number;
  unknownStopLoss: number;
  trailingStopPct: number;
  trailingActivationPct: number;
  maxHoldTimeMs: number;

  // Feature Flags
  enableLatencyGuard: boolean;
  moonbagStrategy: boolean;
  autoSniperEnabled: boolean;

  // Connection
  rpcUrl: string;
  rpcUrl2: string;
  customWsUrl: string;
  jupiterRpcUrl: string;
  activePreset: string;
}

export const DEFAULT_CRITERIA: CriteriaConfig = {
  // Entry
  minMarketCap: 5000,
  maxMarketCap: 100000000,
  minLiquidity: 5000,
  minLiquidityRatio: 2,
  maxRiskScore: 80,
  maxDevOwnership: 15,
  maxTop10Ownership: 60,
  minAge: 0,
  maxAge: 1440,
  minBondingProgress: 0,
  maxBondingProgress: 100,
  minUniqueBuyers30s: 2,
  minBuyCount30s: 3,
  maxBuyCount30s: 100,
  minBuySellRatio: 1.0,
  maxBuySellRatio: 50,
  maxPriceChange1m: 200,
  minProfit5m: 0,
  minLatency: 0,
  maxLatency: 5000,

  // Trade
  buyAmountSol: 0.1,
  minBuyAmount: 0.01,
  slippage: 1.0,
  maxPositions: 10,
  maxRebuyTimes: 3,
  tradeOnlyOnce: true,
  tradePumpFun: true,
  tradeRaydium: true,
  tradeBonding: true,
  tradeUnknown: false,

  // Exit
  minTakeProfit: 25,
  maxTakeProfit: 100,
  bondingCurveTakeProfit: 25,
  stopLoss: 15,
  bondingCurveStopLoss: 15,
  pumpSwapStopLoss: 15,
  unknownStopLoss: 15,
  trailingStopPct: 10,
  trailingActivationPct: 15,
  maxHoldTimeMs: 0, // 0 = no max hold

  // Flags
  enableLatencyGuard: true,
  moonbagStrategy: false,
  autoSniperEnabled: false,

  // Connection
  rpcUrl: '',
  rpcUrl2: '',
  customWsUrl: '',
  jupiterRpcUrl: '',
  activePreset: 'conservative',
};

export const criteriaSchema = z.object({
  minMarketCap: z.number().optional(),
  maxMarketCap: z.number().optional(),
  minLiquidity: z.number().optional(),
  minLiquidityRatio: z.number().optional(),
  maxRiskScore: z.number().optional(),
  maxDevOwnership: z.number().optional(),
  maxTop10Ownership: z.number().optional(),
  minAge: z.number().optional(),
  maxAge: z.number().optional(),
  minBondingProgress: z.number().optional(),
  maxBondingProgress: z.number().optional(),
  minUniqueBuyers30s: z.number().optional(),
  minBuyCount30s: z.number().optional(),
  maxBuyCount30s: z.number().optional(),
  minBuySellRatio: z.number().optional(),
  maxBuySellRatio: z.number().optional(),
  maxPriceChange1m: z.number().optional(),
  minProfit5m: z.number().optional(),
  minLatency: z.number().optional(),
  maxLatency: z.number().optional(),
  buyAmountSol: z.number().optional(),
  minBuyAmount: z.number().optional(),
  slippage: z.number().optional(),
  maxPositions: z.number().optional(),
  maxRebuyTimes: z.number().optional(),
  tradeOnlyOnce: z.boolean().optional(),
  tradePumpFun: z.boolean().optional(),
  tradeRaydium: z.boolean().optional(),
  tradeBonding: z.boolean().optional(),
  tradeUnknown: z.boolean().optional(),
  minTakeProfit: z.number().optional(),
  maxTakeProfit: z.number().optional(),
  bondingCurveTakeProfit: z.number().optional(),
  stopLoss: z.number().optional(),
  bondingCurveStopLoss: z.number().optional(),
  pumpSwapStopLoss: z.number().optional(),
  unknownStopLoss: z.number().optional(),
  trailingStopPct: z.number().optional(),
  trailingActivationPct: z.number().optional(),
  maxHoldTimeMs: z.number().optional(),
  enableLatencyGuard: z.boolean().optional(),
  moonbagStrategy: z.boolean().optional(),
  autoSniperEnabled: z.boolean().optional(),
  rpcUrl: z.string().optional(),
  rpcUrl2: z.string().optional(),
  customWsUrl: z.string().optional(),
  jupiterRpcUrl: z.string().optional(),
  activePreset: z.string().optional(),
});

export interface CriteriaPreset {
  name: string;
  label: string;
  values: Partial<CriteriaConfig>;
}

export const CRITERIA_PRESETS: CriteriaPreset[] = [
  {
    name: 'conservative',
    label: 'Conservative (Safe)',
    values: {
      minMarketCap: 10000,
      maxMarketCap: 5000000,
      minLiquidity: 10000,
      maxRiskScore: 50,
      maxDevOwnership: 10,
      buyAmountSol: 0.05,
      maxPositions: 5,
      minTakeProfit: 20,
      stopLoss: 10,
      tradeUnknown: false,
    },
  },
  {
    name: 'balanced',
    label: 'Balanced',
    values: {
      minMarketCap: 5000,
      maxMarketCap: 20000000,
      minLiquidity: 5000,
      maxRiskScore: 70,
      maxDevOwnership: 15,
      buyAmountSol: 0.1,
      maxPositions: 10,
      minTakeProfit: 25,
      stopLoss: 15,
      tradeUnknown: false,
    },
  },
  {
    name: 'aggressive',
    label: 'Aggressive (High Risk)',
    values: {
      minMarketCap: 2000,
      maxMarketCap: 100000000,
      minLiquidity: 2000,
      maxRiskScore: 90,
      maxDevOwnership: 25,
      buyAmountSol: 0.2,
      maxPositions: 15,
      minTakeProfit: 30,
      stopLoss: 20,
      tradeUnknown: true,
    },
  },
];

export class CriteriaService extends EventEmitter {
  private static instance: CriteriaService;
  private currentCriteria: CriteriaConfig = { ...DEFAULT_CRITERIA };

  private constructor() {
    super();
  }

  public static getInstance(): CriteriaService {
    if (!CriteriaService.instance) {
      CriteriaService.instance = new CriteriaService();
    }
    return CriteriaService.instance;
  }

  public getCriteria(): CriteriaConfig {
    return { ...this.currentCriteria };
  }

  public updateCriteria(patch: Partial<CriteriaConfig>): CriteriaConfig {
    // Validate patch
    const parseResult = criteriaSchema.safeParse(patch);
    if (!parseResult.success) {
      logger.warn({ errors: parseResult.error.format() }, 'Invalid criteria patch rejected');
      return this.currentCriteria;
    }

    this.currentCriteria = { ...this.currentCriteria, ...patch };
    this.emit('criteria_updated', this.currentCriteria);
    logger.info({ patch }, 'Criteria updated');
    return this.getCriteria();
  }

  public applyPreset(presetName: string): CriteriaConfig {
    const preset = CRITERIA_PRESETS.find(p => p.name === presetName);
    if (!preset) {
      logger.warn({ presetName }, 'Unknown criteria preset');
      return this.currentCriteria;
    }
    return this.updateCriteria({ ...preset.values, activePreset: presetName });
  }

  public resetToDefaults(): CriteriaConfig {
    this.currentCriteria = { ...DEFAULT_CRITERIA };
    this.emit('criteria_updated', this.currentCriteria);
    return this.getCriteria();
  }
}

export const criteriaService = CriteriaService.getInstance();
