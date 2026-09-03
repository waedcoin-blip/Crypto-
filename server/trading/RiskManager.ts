// server/trading/RiskManager.ts
import { Position, positionManager } from './PositionManager.js';
import { unifiedExitEngine, ExitDecision } from './UnifiedExitEngine.js';

export type { ExitDecision };

export class RiskManager {
  private static instance: RiskManager;

  private constructor() {}

  public static getInstance(): RiskManager {
    if (!RiskManager.instance) {
      RiskManager.instance = new RiskManager();
    }
    return RiskManager.instance;
  }

  /**
   * Delegates exit locking/reservation to UnifiedExitEngine.
   */
  public reserveExit(positionId: string): boolean {
    const position = positionManager.getPositionById(positionId);
    if (!position) return false;
    return unifiedExitEngine.acquireExitLock(position.network, position.wallet, position.mint);
  }

  /**
   * Delegates releasing exit locking/reservation to UnifiedExitEngine.
   */
  public releaseExit(positionId: string): void {
    const position = positionManager.getPositionById(positionId);
    if (position) {
      unifiedExitEngine.releaseExitLock(position.network, position.wallet, position.mint);
    }
  }

  /**
   * Delegates position exit evaluations to UnifiedExitEngine.
   */
  public async evaluatePositionExit(
    position: Position,
    marketPriceSol: number
  ): Promise<ExitDecision> {
    return unifiedExitEngine.evaluatePositionExit(position, marketPriceSol);
  }
}

export const riskManager = RiskManager.getInstance();
