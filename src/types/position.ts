// src/types/position.ts
export type PositionState =
  | 'SIGNAL'        // Detected, not yet bought
  | 'BUY_PENDING'   // Buy tx submitted, awaiting confirmation
  | 'BUY_CONFIRMED' // On-chain confirmed
  | 'OPEN'          // Active, monitoring for exit
  | 'EXIT_TRIGGERED'// TP/SL condition met, lock engaged
  | 'SELL_PENDING'  // Sell tx submitted
  | 'SELL_CONFIRMED'// Sell confirmed
  | 'CLOSED';       // Final state, never re-enter

export interface Position {
  mint: string;
  symbol: string;
  amount: number;
  solSpent: number;
  buyPrice: number;
  currentPrice?: number;
  peakPnLPct: number;
  state: PositionState;
  buySignature?: string;
  sellSignature?: string;
  buySlot?: number;
  sellSlot?: number;
  pendingSince?: number;
  exitTriggeredAt?: number;
  exitSide?: 'tp' | 'sl' | 'trailing_sl';
  
  // Cached sell quote for fast execution
  cachedSellQuote?: {
    quoteResponse: any;
    fetchedAt: number;
    expectedOutputSol: number;
  };
  
  // Safety metrics
  riskScore: number;
  isRugSafe: boolean;
  devWalletPercentage: number;
  top10Percentage: number;
  
  // User settings
  tpPct: number;
  slPct: number;
  recoveryMode: boolean;
}

export interface PositionTransition {
  from: PositionState;
  to: PositionState;
  timestamp: number;
  reason: string;
}
