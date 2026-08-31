// server/repositories/CriteriaRepository.ts
import { readDataFile, writeDataFile } from '../db/jsonStore.js';

export interface TradingCriteria {
  minLiquidityUsd: number;
  minAgeMinutes: number;
  maxAgeMinutes: number;

  maxDevOwnershipPct: number;
  maxTop10Pct: number;
  maxRiskScore: number;

  minBondingProgress?: number;
  maxBondingProgress?: number;
}

const FILE_NAME = 'trading_criteria.json';

const DEFAULT_CRITERIA: TradingCriteria = {
  minLiquidityUsd: 5000,
  minAgeMinutes: 0,
  maxAgeMinutes: 1440,
  maxDevOwnershipPct: 10,
  maxTop10Pct: 40,
  maxRiskScore: 22,
};

export class CriteriaRepository {
  private static instance: CriteriaRepository;
  private currentCriteria: TradingCriteria;

  private constructor() {
    this.currentCriteria = readDataFile<TradingCriteria>(FILE_NAME, DEFAULT_CRITERIA);
  }

  public static getInstance(): CriteriaRepository {
    if (!CriteriaRepository.instance) {
      CriteriaRepository.instance = new CriteriaRepository();
    }
    return CriteriaRepository.instance;
  }

  public async getActiveCriteria(): Promise<TradingCriteria> {
    return { ...this.currentCriteria };
  }

  public getActiveCriteriaSync(): TradingCriteria {
    return { ...this.currentCriteria };
  }

  public async updateCriteria(patch: Partial<TradingCriteria>): Promise<TradingCriteria> {
    this.currentCriteria = {
      ...this.currentCriteria,
      ...patch,
    };
    writeDataFile(FILE_NAME, this.currentCriteria);
    return { ...this.currentCriteria };
  }
}

export const criteriaRepository = CriteriaRepository.getInstance();
