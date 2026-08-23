// src/services/exit-manager.types.ts

export type Platform = 'PUMP_FUN' | 'PUMPSWAP' | 'RAYDIUM' | 'UNKNOWN';
export type ExitReason = 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'MAX_HOLD_TIME' | 'MANUAL';
export type PositionState = 'OPEN' | 'CLOSING' | 'CLOSED';

export interface TokenStage {
  platform: Platform;
  isBonding: boolean;
  stage: 'BONDING' | 'MIGRATED' | 'UNKNOWN';
}

export interface ExitConfig {
  minTakeProfit: number;
  maxTakeProfit: number;
  bondingCurveTakeProfit: number;

  stopLossPct: number;
  bondingCurveStopLossPct: number;
  pumpSwapStopLossPct: number;
  unknownStopLossPct: number;

  moonbagStrategy: boolean;
  moonbagSellPct: number;       // e.g. 0.5 = sell 50% on first TP

  trailingStopEnabled: boolean;
  trailingStopDistance: number; // e.g. 10 = exit if drops 10% from peak

  maxHoldTimeMs: number;        // 0 = disabled
  slippageBps: number;          // 100 = 1%
  stalePriceThresholdMs: number;

  recoveryModeSlOverride?: number; // Optional: special SL when in recovery
}

export interface ManagedExitPosition {
  mint: string;
  symbol: string;
  state: PositionState;
  amount: number;
  realCostBasis: number;        // Total SOL in, including fees
  lastPriceSol: number;
  lastPriceTimestamp: number;
  highestPnlPct: number;        // Runtime tracking for trailing stop
  soldPartial: boolean;         // Moonbag state
  recoveryMode: boolean;
  entryTime: number;
  dexId?: string;
  bondingCurveProgress?: number;
  isRaydiumListed?: boolean;
}
