// server/types/index.ts

// Re-export all shared types
export * from '../../src/types/index.js';

export type HardenedDecision = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface HardenedCriterionResult {
  ruleId: string;
  name: string;
  status: HardenedDecision;
  passed: boolean;
  reason?: string;
  observedValue?: any;
  threshold?: any;
}

export interface HardenedApproval {
  approvalId: string;
  chain: 'solana';
  mint: string;
  criteriaVersion: string;
  evaluatedAt: number;
  evaluatedSlot: number;
  evaluationPrice: number;
  maxSlotLag: number;
  maxPriceDeviationPct: number;
  expiresAt: number;
  checks: HardenedCriterionResult[];
  decisionHash: string;
  correlationId: string;
  state: 'ISSUED' | 'CONSUMING' | 'CONSUMED' | 'EXPIRED' | 'INVALID';
  pool?: string;
  consumedByOrderId?: string;
  consumedAt?: number;
}

// Server-specific extensions
export interface ServerEntryDecision {
  allowed: boolean;
  decision: 'BUY' | 'BLOCK' | 'CRITERIA_PASSED' | 'CRITERIA_FAILED';
  mintAddress: string;
  symbol: string;
  buyAmountSol: number;
  matchScorePct?: number;
  confidenceScore?: number;
  candidateId?: string;
  criteriaResults?: Record<string, any>;
  blockingReasons: string[];
  evaluatedAt: number;
}

export interface TradeEngineResponse {
  success: boolean;
  orderId?: string;
  positionId?: string;
  signature?: string;
  error?: string;
  status?: 'success' | 'rejected' | 'error';
  reason?: string;
  stage?: string;
  result?: any;
}

export interface WorkerHeartbeat {
  worker: string;
  status: 'RUNNING' | 'STOPPED' | 'ERROR';
  lastHeartbeat: number;
  metadata?: Record<string, any>;
}

export interface OrderRecord {
  id: string;
  network: string;
  wallet: string;
  mint: string;
  side: 'buy' | 'sell';
  amountRaw: string;
  decimals: number;
  slippageBps: number;
  status: string;
  createdAt: number;
  updatedAt: number;
  filledAt?: number;
  signature?: string;
  error?: string;
  clientRequestId?: string;
  label?: string;
}

export interface PositionRecord {
  id: string;
  mintAddress: string;
  network: string;
  wallet?: string;
  amountRaw: string;
  decimals: number;
  entryPriceSOL: number;
  solSpent: number;
  currentPriceSOL: number;
  peakPriceSOL: number;
  highestPnLPct: number;
  currentPnLSol?: number;
  currentPnLPct?: number;
  tpPct: number;
  slPct: number;
  trailingSlPct?: number;
  maxHoldTimeMs?: number;
  slippageBpsTp: number;
  slippageBpsSl: number;
  state: string;
  orderIds: string[];
  buySignature?: string;
  exitSignature?: string;
  createdAt: number;
  updatedAt: number;
  lastMarketPriceAt?: number;
  lastExecutableQuoteAt?: number;
  lastMarketEventAt?: number;
  lastExitEvaluationAt?: number;
  closedAt?: number;
  realizedPnLSol?: number;
  realizedPnLPct?: number;
}
