// server/repositories/CriteriaRepository.ts
import { readDataFile, updateDataFileAtomic } from '../db/jsonStore.js';

export interface TradingCriteria {
  minLiquidityUsd: number;
  minAgeMinutes: number;
  maxAgeMinutes: number;

  maxDevOwnershipPct: number;
  maxTop10Pct: number;
  maxRiskScore: number;

  minBondingProgress?: number;
  maxBondingProgress?: number;
  version?: number;
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

  private constructor() {}

  public static getInstance(): CriteriaRepository {
    if (!CriteriaRepository.instance) {
      CriteriaRepository.instance = new CriteriaRepository();
    }
    return CriteriaRepository.instance;
  }

  public async getActiveCriteria(): Promise<TradingCriteria> {
    return this.getActiveCriteriaSync();
  }

  public getActiveCriteriaSync(): TradingCriteria {
    return readDataFile<TradingCriteria>(FILE_NAME, DEFAULT_CRITERIA);
  }

  public async updateCriteria(patch: Partial<TradingCriteria>): Promise<TradingCriteria> {
    return updateDataFileAtomic<TradingCriteria>(FILE_NAME, DEFAULT_CRITERIA, (current) => {
      return {
        ...current,
        ...patch,
        version: (current.version || 1) + 1,
      };
    });
  }
}

export const criteriaRepository = CriteriaRepository.getInstance();
