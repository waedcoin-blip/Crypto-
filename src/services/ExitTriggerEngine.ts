// FULL_POSITION_EXIT_ONLY: Legacy trigger retained for compatibility; it must not execute partial exits.
// src/services/ExitTriggerEngine.ts
import { PositionPnLMetrics, positionPnLEngine } from './PositionPnLEngine';

export type ExitReason =
  | 'TAKE_PROFIT'
  | 'LEGACY_PARTIAL_TAKE_PROFIT_DISABLED'
  | 'TRAILING_PROFIT'
  | 'STOP_LOSS'
  | 'EMERGENCY_EXIT'
  | 'MAX_HOLD_TIME'
  | 'LIQUIDITY_FAILURE'
  | 'MANUAL_EXIT';

export interface AdaptiveTrailingBracket {
  minPnLPct: number;
  maxPnLPct: number;
  trailingStopPct: number;
}

export interface PartialProfitLevel {
  levelId: string;
  triggerPnLPct: number;
  sellRatio: number; // e.g. 0.20 = 20% of initial position
}

export interface ExitTriggerRuleConfig {
  takeProfitPct?: number; // e.g. 20%
  stopLossPct?: number; // e.g. 10% (evaluated as -10%)
  enableTrailingStop?: boolean;
  adaptiveTrailingBrackets?: AdaptiveTrailingBracket[];
  enablePartialTakeProfit?: boolean;
  partialProfitLevels?: PartialProfitLevel[];
  maxHoldTimeSeconds?: number;
  liquidityDropThresholdPct?: number;
}

export interface ExitTriggerSignal {
  mint: string;
  positionId?: string;
  reason: ExitReason;
  priority: number; // 1 = Highest
  requestedSellRatio: number; // 0.0 to 1.0 (1.0 = 100% full exit)
  metrics: PositionPnLMetrics;
  partialLevelId?: string;
  timestamp: number;
  details: string;
}

export class ExitTriggerEngine {
  private static instance: ExitTriggerEngine;

  // Default Adaptive Trailing Stop Brackets
  private defaultAdaptiveBrackets: AdaptiveTrailingBracket[] = [
    { minPnLPct: -100, maxPnLPct: 5, trailingStopPct: 3.0 },
    { minPnLPct: 5, maxPnLPct: 10, trailingStopPct: 4.0 },
    { minPnLPct: 10, maxPnLPct: 20, trailingStopPct: 5.0 },
    { minPnLPct: 20, maxPnLPct: 40, trailingStopPct: 7.0 },
    { minPnLPct: 40, maxPnLPct: 10000, trailingStopPct: 10.0 },
  ];

  // Default Partial Profit Ladder
  private defaultPartialLevels: PartialProfitLevel[] = [
    { levelId: 'level_10', triggerPnLPct: 10, sellRatio: 0.20 }, // +10% -> sell 20%
    { levelId: 'level_20', triggerPnLPct: 20, sellRatio: 0.25 }, // +20% -> sell 25%
    { levelId: 'level_35', triggerPnLPct: 35, sellRatio: 0.25 }, // +35% -> sell 25%
  ];

  public static getInstance(): ExitTriggerEngine {
    if (!ExitTriggerEngine.instance) {
      ExitTriggerEngine.instance = new ExitTriggerEngine();
    }
    return ExitTriggerEngine.instance;
  }

  /**
   * Evaluates dynamic adaptive trailing stop threshold for a given gross PnL %.
   */
  public getAdaptiveTrailingThreshold(
    currentPnLPct: number,
    customBrackets?: AdaptiveTrailingBracket[]
  ): number {
    const brackets = customBrackets && customBrackets.length > 0
      ? customBrackets
      : this.defaultAdaptiveBrackets;

    for (const b of brackets) {
      if (currentPnLPct >= b.minPnLPct && currentPnLPct < b.maxPnLPct) {
        return b.trailingStopPct;
      }
    }
    return 5.0; // Default fallback
  }

  /**
   * Evaluates incoming price metrics against exit rules.
   * Returns an ExitTriggerSignal if an exit condition is met, or null.
   */
  public evaluateExitConditions(params: {
    metrics: PositionPnLMetrics;
    config: ExitTriggerRuleConfig;
    createdAtTimestamp: number;
    executedPartialLevels?: Set<string>;
    currentHoldRatio?: number; // Ratio of remaining position (e.g. 1.0 down to 0.3)
  }): ExitTriggerSignal | null {
    const { metrics, config, createdAtTimestamp, executedPartialLevels, currentHoldRatio = 1.0 } = params;
    const now = Date.now();

    // 1. EMERGENCY / LIQUIDITY FAILURE (Priority 1)
    if (metrics.currentPriceSol <= 0) {
      return {
        mint: metrics.mint,
        reason: 'LIQUIDITY_FAILURE',
        priority: 1,
        requestedSellRatio: 1.0,
        metrics,
        timestamp: now,
        details: 'Token price dropped to 0 or liquidity pool drained.',
      };
    }

    // 2. STOP LOSS (Priority 2)
    const slPct = config.stopLossPct ?? 10;
    if (metrics.grossPnlPct <= -Math.abs(slPct)) {
      return {
        mint: metrics.mint,
        reason: 'STOP_LOSS',
        priority: 2,
        requestedSellRatio: 1.0,
        metrics,
        timestamp: now,
        details: `Gross PnL (${metrics.grossPnlPct.toFixed(2)}%) hit or breached Stop Loss threshold (-${Math.abs(slPct)}%).`,
      };
    }

    // 3. ADAPTIVE TRAILING PROFIT (Priority 3)
    if (config.enableTrailingStop && metrics.peakPnLPct > 0) {
      const adaptiveTrailingPct = this.getAdaptiveTrailingThreshold(
        metrics.peakPnLPct,
        config.adaptiveTrailingBrackets
      );

      // Check drawdown from peak: ((peakPrice - currentPrice) / peakPrice) * 100
      if (metrics.drawdownPct >= adaptiveTrailingPct && metrics.grossPnlPct > 0) {
        return {
          mint: metrics.mint,
          reason: 'TRAILING_PROFIT',
          priority: 3,
          requestedSellRatio: 1.0, // Sell remaining position
          metrics,
          timestamp: now,
          details: `Drawdown from peak (${metrics.drawdownPct.toFixed(2)}%) reached dynamic trailing threshold (${adaptiveTrailingPct.toFixed(1)}%). Peak PnL: ${metrics.peakPnLPct.toFixed(2)}%`,
        };
      }
    }

    // 4. PARTIAL PROFIT TAKING (Priority 4)
    if (config.enablePartialTakeProfit) {
      const levels = config.partialProfitLevels && config.partialProfitLevels.length > 0
        ? config.partialProfitLevels
        : this.defaultPartialLevels;

      for (const lvl of levels) {
        if (!executedPartialLevels?.has(lvl.levelId)) {
          if (metrics.grossPnlPct >= lvl.triggerPnLPct) {
            // Cap sell ratio to remaining hold ratio
            const sellRatio = Math.min(lvl.sellRatio, currentHoldRatio);
            if (sellRatio > 0.01) {
              return {
                mint: metrics.mint,
                reason: 'LEGACY_PARTIAL_TAKE_PROFIT_DISABLED',
                priority: 4,
                requestedSellRatio: sellRatio,
                metrics,
                partialLevelId: lvl.levelId,
                timestamp: now,
                details: `Hit partial profit level '${lvl.levelId}' (+${lvl.triggerPnLPct}% PnL). Selling ${Math.round(sellRatio * 100)}% of initial position.`,
              };
            }
          }
        }
      }
    }

    // 5. TAKE PROFIT (Full) (Priority 4)
    const tpPct = config.takeProfitPct ?? 25;
    if (metrics.grossPnlPct >= tpPct) {
      return {
        mint: metrics.mint,
        reason: 'TAKE_PROFIT',
        priority: 4,
        requestedSellRatio: 1.0,
        metrics,
        timestamp: now,
        details: `Gross PnL (${metrics.grossPnlPct.toFixed(2)}%) hit Take Profit target (+${tpPct}%).`,
      };
    }

    // 6. MAX HOLD TIME (Priority 5)
    if (config.maxHoldTimeSeconds && config.maxHoldTimeSeconds > 0) {
      const holdTimeMs = now - createdAtTimestamp;
      if (holdTimeMs >= config.maxHoldTimeSeconds * 1000) {
        return {
          mint: metrics.mint,
          reason: 'MAX_HOLD_TIME',
          priority: 5,
          requestedSellRatio: 1.0,
          metrics,
          timestamp: now,
          details: `Position held for ${(holdTimeMs / 1000).toFixed(1)}s, exceeding Max Hold Time (${config.maxHoldTimeSeconds}s).`,
        };
      }
    }

    return null;
  }
}

export const exitTriggerEngine = ExitTriggerEngine.getInstance();
