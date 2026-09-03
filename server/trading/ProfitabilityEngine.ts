// server/trading/ProfitabilityEngine.ts
import { EnrichedCandidate } from './CandidateEnricher.js';

export interface ProfitabilityMetrics {
  mint: string;
  expectedEntryPrice: number;
  expectedExitPrice: number;
  expectedGrossProfitSol: number;
  estimatedSlippageSol: number;
  networkFeesSol: number;
  dexFeesSol: number;
  executionCostsSol: number;
  expectedNetProfitSol: number;
  expectedNetProfitPercent: number;
  quoteFreshnessMs: number;
  status: 'PROFITABLE' | 'UNPROFITABLE' | 'STALE' | 'DATA_UNAVAILABLE';
}

export class ProfitabilityEngine {
  private static instance: ProfitabilityEngine;

  private constructor() {}

  public static getInstance(): ProfitabilityEngine {
    if (!ProfitabilityEngine.instance) {
      ProfitabilityEngine.instance = new ProfitabilityEngine();
    }
    return ProfitabilityEngine.instance;
  }

  /**
   * Evaluates executable profitability for a candidate token based on live quote estimations.
   */
  public calculateProfitability(
    candidate: EnrichedCandidate,
    buyAmountSol: number,
    targetProfitPct: number = 25
  ): ProfitabilityMetrics {
    const mint = candidate.mintAddress;
    const now = Date.now();

    const priceSol = candidate.priceSol?.value;
    if (!priceSol || priceSol <= 0) {
      return this.createUnavailableMetrics(mint, 'Price data is missing or non-positive');
    }

    const priceAgeMs = candidate.priceSol?.timestamp ? now - candidate.priceSol.timestamp : 0;
    if (priceAgeMs > 15000) {
      return {
        ...this.createUnavailableMetrics(mint, 'Price quote is stale'),
        status: 'STALE',
        quoteFreshnessMs: priceAgeMs,
      };
    }

    // Executable Price & Slippage Modeling
    // High liquidity reduces price impact; low liquidity or high size accelerates slippage
    const liquidityUsd = candidate.liquidityUsd?.value || 1000;
    const solPriceUsd = 140; // Default Solana conversion fallback
    const liquiditySol = liquidityUsd / solPriceUsd;

    const estimatedSlippagePct = Math.min(15, (buyAmountSol / Math.max(1, liquiditySol)) * 100 + 0.5); // base 0.5% slippage
    const estimatedSlippageSol = buyAmountSol * (estimatedSlippagePct / 100);

    const expectedEntryPrice = priceSol * (1 + estimatedSlippagePct / 100);
    const expectedExitPrice = expectedEntryPrice * (1 + targetProfitPct / 100);

    const expectedGrossProfitSol = buyAmountSol * (targetProfitPct / 100);

    // Fixed & Variable Execution Costs
    const networkFeesSol = 0.000005; // Standard Solana signature fee
    const priorityFeesSol = 0.0015; // Jito / Priority fee to guarantee high-velocity execution
    const dexFeesSol = buyAmountSol * 0.003; // ~0.3% standard DEX swap fee
    const executionCostsSol = networkFeesSol + priorityFeesSol + dexFeesSol;

    const expectedNetProfitSol = expectedGrossProfitSol - estimatedSlippageSol - executionCostsSol;
    const expectedNetProfitPercent = buyAmountSol > 0 ? (expectedNetProfitSol / buyAmountSol) * 100 : 0;

    const status = expectedNetProfitSol > 0 ? 'PROFITABLE' : 'UNPROFITABLE';

    return {
      mint,
      expectedEntryPrice,
      expectedExitPrice,
      expectedGrossProfitSol,
      estimatedSlippageSol,
      networkFeesSol,
      dexFeesSol,
      executionCostsSol,
      expectedNetProfitSol,
      expectedNetProfitPercent,
      quoteFreshnessMs: priceAgeMs,
      status,
    };
  }

  private createUnavailableMetrics(mint: string, reason: string): ProfitabilityMetrics {
    return {
      mint,
      expectedEntryPrice: 0,
      expectedExitPrice: 0,
      expectedGrossProfitSol: 0,
      estimatedSlippageSol: 0,
      networkFeesSol: 0,
      dexFeesSol: 0,
      executionCostsSol: 0,
      expectedNetProfitSol: 0,
      expectedNetProfitPercent: 0,
      quoteFreshnessMs: 999999,
      status: 'DATA_UNAVAILABLE',
    };
  }
}

export const profitabilityEngine = ProfitabilityEngine.getInstance();
