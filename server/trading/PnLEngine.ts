// server/trading/PnLEngine.ts
import { Position } from './PositionManager.js';
import { rawToUiNumber } from '../utils/rawAmount.js';

export interface PnLMetrics {
  positionId: string;
  mint: string;
  tokenAmountRaw: string;
  decimals: number;
  tokenQuantity: number;
  totalSolSpent: number;
  averageEntryPrice: number;
  currentPriceSol: number;
  currentValueSol: number;
  unrealizedPnlSol: number;
  unrealizedPnlPercent: number;
  realizedPnlSol: number;
  realizedPnlPercent: number;
}

export class PnLEngine {
  private static instance: PnLEngine;

  private constructor() {}

  public static getInstance(): PnLEngine {
    if (!PnLEngine.instance) {
      PnLEngine.instance = new PnLEngine();
    }
    return PnLEngine.instance;
  }

  public calculatePnL(
    position: Position,
    currentMarketPriceSol: number,
    estimatedFeeSol: number = 0.0005
  ): PnLMetrics {
    const decimals = position.decimals;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      throw new Error(`Invalid persisted decimals: ${decimals} for ${position.mint}`);
    }
    const tokenQuantity = rawToUiNumber(position.tokenAmountRaw || String(position.tokenAmount), decimals);
    const averageEntryPrice = position.averageEntryPrice > 0
      ? position.averageEntryPrice
      : tokenQuantity > 0 ? position.totalSolSpent / tokenQuantity : 0;

    const currentPriceSol = currentMarketPriceSol > 0 ? currentMarketPriceSol : averageEntryPrice;
    const grossCurrentValueSol = tokenQuantity * currentPriceSol;
    const netCurrentValueSol = Math.max(0, grossCurrentValueSol - estimatedFeeSol);

    const unrealizedPnlSol = netCurrentValueSol - position.totalSolSpent;
    const unrealizedPnlPercent = position.totalSolSpent > 0
      ? (unrealizedPnlSol / position.totalSolSpent) * 100
      : 0;

    const realizedPnlSol = position.realizedPnl || 0;
    const realizedPnlPercent = position.totalSolSpent > 0
      ? (realizedPnlSol / position.totalSolSpent) * 100
      : 0;

    return {
      positionId: position.id,
      mint: position.mint,
      tokenAmountRaw: position.tokenAmountRaw || String(position.tokenAmount),
      decimals,
      tokenQuantity,
      totalSolSpent: position.totalSolSpent,
      averageEntryPrice,
      currentPriceSol,
      currentValueSol: netCurrentValueSol,
      unrealizedPnlSol,
      unrealizedPnlPercent,
      realizedPnlSol,
      realizedPnlPercent,
    };
  }

  public calculatePortfolioPnL(
    positions: Position[],
    currentPrices: Map<string, number>
  ): {
    totalValueSol: number;
    totalCostSol: number;
    totalUnrealizedPnlSol: number;
    totalUnrealizedPnlPercent: number;
    totalRealizedPnlSol: number;
    positionsCount: number;
    positionPnLs: PnLMetrics[];
  } {
    let totalValueSol = 0;
    let totalCostSol = 0;
    let totalUnrealizedPnlSol = 0;
    let totalRealizedPnlSol = 0;
    const positionPnLs: PnLMetrics[] = [];

    for (const pos of positions) {
      const currentPrice = currentPrices.get(pos.mint) || pos.currentPriceSol || 0;
      const metrics = this.calculatePnL(pos, currentPrice);
      positionPnLs.push(metrics);

      totalValueSol += metrics.currentValueSol;
      totalCostSol += metrics.totalSolSpent;
      totalUnrealizedPnlSol += metrics.unrealizedPnlSol;
      totalRealizedPnlSol += metrics.realizedPnlSol;
    }

    const totalUnrealizedPnlPercent = totalCostSol > 0 ? (totalUnrealizedPnlSol / totalCostSol) * 100 : 0;

    return {
      totalValueSol,
      totalCostSol,
      totalUnrealizedPnlSol,
      totalUnrealizedPnlPercent,
      totalRealizedPnlSol,
      positionsCount: positions.length,
      positionPnLs,
    };
  }
}

export const pnlEngine = PnLEngine.getInstance();
