// server/trading/PnLEngine.ts
import { Position } from './PositionManager.js';

export interface PnLMetrics {
  positionId: string;
  mint: string;
  tokenAmountRaw: number;
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
      throw new Error(`UNRESOLVED_TOKEN_DECIMALS: Invalid persisted decimals for ${position.mint}`);
    }
    const tokenQuantity = position.tokenAmount / (10 ** decimals);
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
      tokenAmountRaw: position.tokenAmount,
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
}

export const pnlEngine = PnLEngine.getInstance();
