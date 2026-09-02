// server/trading/RiskManager.ts
import { Position, positionManager } from './PositionManager.js';
import { pnlEngine } from './PnLEngine.js';
import { executionGateway } from '../execution/ExecutionGateway.js';

export interface ExitDecision {
  shouldExit: boolean;
  reason?: 'TP' | 'SL' | 'TRAILING_SL' | 'MAX_HOLD' | 'FORCE_EXIT';
  executablePnlPct?: number;
  expectedOutSol?: number;
  message?: string;
}

export class RiskManager {
  private static instance: RiskManager;
  private pendingExitReservations: Set<string> = new Set(); // positionId -> exit lock

  private constructor() {}

  public static getInstance(): RiskManager {
    if (!RiskManager.instance) {
      RiskManager.instance = new RiskManager();
    }
    return RiskManager.instance;
  }

  public reserveExit(positionId: string): boolean {
    if (this.pendingExitReservations.has(positionId)) {
      return false; // Already exit pending!
    }
    this.pendingExitReservations.add(positionId);
    return true;
  }

  public releaseExit(positionId: string): void {
    this.pendingExitReservations.delete(positionId);
  }

  public async evaluatePositionExit(
    position: Position,
    marketPriceSol: number
  ): Promise<ExitDecision> {
    if (position.status !== 'OPEN') {
      return { shouldExit: false, message: `Position status is ${position.status}, not OPEN` };
    }

    if (this.pendingExitReservations.has(position.id)) {
      return { shouldExit: false, message: 'Exit already pending for position' };
    }

    const pnl = pnlEngine.calculatePnL(position, marketPriceSol);

    // 1. Check Max Hold Time
    if (position.maxHoldTimeMs && position.maxHoldTimeMs > 0) {
      const heldMs = Date.now() - position.openedAt;
      if (heldMs >= position.maxHoldTimeMs) {
        return {
          shouldExit: true,
          reason: 'MAX_HOLD',
          message: `Max hold time exceeded (${(heldMs / 1000).toFixed(0)}s >= ${(position.maxHoldTimeMs / 1000).toFixed(0)}s)`,
        };
      }
    }

    // 2. Check Trailing SL
    if (position.trailingSlPct && position.highestPnlPct > 0) {
      const dropFromPeak = position.highestPnlPct - pnl.unrealizedPnlPercent;
      if (dropFromPeak >= position.trailingSlPct) {
        return {
          shouldExit: true,
          reason: 'TRAILING_SL',
          message: `Trailing stop loss triggered: peak +${position.highestPnlPct.toFixed(1)}%, dropped by ${dropFromPeak.toFixed(1)}% >= ${position.trailingSlPct}%`,
        };
      }
    }

    // 3. Check Take Profit threshold
    const tpThreshold = position.tpPct;
    if (pnl.unrealizedPnlPercent >= tpThreshold) {
      // Validate executable quote before exit
      const quoteCheck = await this.validateExecutableQuote(position, 'TP', tpThreshold);
      if (quoteCheck.isValid) {
        return {
          shouldExit: true,
          reason: 'TP',
          executablePnlPct: quoteCheck.executablePnlPct,
          expectedOutSol: quoteCheck.expectedOutSol,
          message: `Take profit condition met: +${pnl.unrealizedPnlPercent.toFixed(2)}% >= +${tpThreshold}%`,
        };
      } else {
        return {
          shouldExit: false,
          message: `TP condition met on market price, but executable quote rejected: ${quoteCheck.reason}`,
        };
      }
    }

    // 4. Check Stop Loss threshold
    const slThreshold = -Math.abs(position.slPct);
    if (pnl.unrealizedPnlPercent <= slThreshold) {
      const quoteCheck = await this.validateExecutableQuote(position, 'SL', slThreshold);
      if (quoteCheck.isValid) {
        return {
          shouldExit: true,
          reason: 'SL',
          executablePnlPct: quoteCheck.executablePnlPct,
          expectedOutSol: quoteCheck.expectedOutSol,
          message: `Stop loss condition met: ${pnl.unrealizedPnlPercent.toFixed(2)}% <= ${slThreshold}%`,
        };
      } else {
        return {
          shouldExit: false,
          message: `SL condition met on market price, but executable quote rejected: ${quoteCheck.reason}`,
        };
      }
    }

    return { shouldExit: false };
  }

  private async validateExecutableQuote(
    position: Position,
    triggerType: 'TP' | 'SL',
    thresholdPct: number
  ): Promise<{ isValid: boolean; executablePnlPct?: number; expectedOutSol?: number; reason?: string }> {
    try {
      const quoteRes = await executionGateway.quoteSell({
        inputMint: position.mint,
        outputMint: 'So11111111111111111111111111111111111111112',
        amount: position.tokenAmount,
        slippageBps: triggerType === 'TP' ? position.slippageBpsTp : position.slippageBpsSl,
        network: position.network,
      });

      const outLamports = Number(quoteRes.outAmount || 0);
      const outSol = outLamports / 1e9;
      const executablePnlPct = position.totalSolSpent > 0
        ? ((outSol - position.totalSolSpent) / position.totalSolSpent) * 100
        : 0;

      if (triggerType === 'TP' && executablePnlPct < 0) {
        return {
          isValid: false,
          reason: `Market price indicated TP, but executable route is negative (${executablePnlPct.toFixed(2)}%)`,
        };
      }

      return {
        isValid: true,
        executablePnlPct,
        expectedOutSol: outSol,
      };
    } catch (e: any) {
      return {
        isValid: false,
        reason: `Executable quote request failed: ${e?.message || e}`,
      };
    }
  }
}

export const riskManager = RiskManager.getInstance();
