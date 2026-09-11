// server/execution/TradeExecutor.ts

export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: number | string | bigint; // Raw units (lamports for SOL, base units for SPL)
  slippageBps: number;
  network?: string;
  walletAddress?: string;
}

export interface QuoteResult {
  success: boolean;
  quote?: any;
  error?: string;
  priceImpactPct?: number;
  outAmountLamports?: number;
  outAmountRaw?: string;
  routePlanLength?: number;
}

export interface ExecuteParams {
  inputMint: string;
  outputMint: string;
  amount: number | string | bigint;
  slippageBps: number;
  decimals: number;
  walletAddress: string;
  network: string;
  label?: string;
  preValidatedQuote?: any;
  clientRequestId?: string;
  onBroadcast?: (signature: string) => Promise<void>;
}

export interface ExecutionResult {
  success: boolean;
  signature?: string;
  error?: string;
  outAmountRaw?: string;
  outAmountLamports?: number;
  feeLamports?: number;
  isBroadcasted?: boolean;
  isAmbiguous?: boolean;
  durationMs?: number;
  status?: string;
}

/**
 * Base interface for all trade executors (Paper, Devnet, Mainnet).
 * All executors must implement this contract.
 */
export interface TradeExecutor {
  readonly network: string;

  getQuote(params: QuoteParams): Promise<QuoteResult>;
  buy(params: ExecuteParams): Promise<ExecutionResult>;
  sell(params: ExecuteParams): Promise<ExecutionResult>;
  getSolBalance(walletAddress?: string): Promise<number>;
  getTokenBalance(mint: string, walletAddress?: string): Promise<number>;
  verifyReadiness(): Promise<{ ready: boolean; reason?: string }>;
}

/**
 * Execution error with classification for retry logic.
 */
export class ExecutionError extends Error {
  public readonly classification: ExecutionFailureClassification;

  constructor(classification: ExecutionFailureClassification, message: string) {
    super(message);
    this.name = 'ExecutionError';
    this.classification = classification;
  }
}

export type ExecutionFailureClassification =
  | 'SLIPPAGE_EXCEEDED'
  | 'INSUFFICIENT_BALANCE'
  | 'NO_ROUTE_FOUND'
  | 'RPC_TIMEOUT'
  | 'RPC_ERROR'
  | 'BLOCKHASH_EXPIRED'
  | 'SIGNATURE_ERROR'
  | 'TOKEN_ACCOUNT_MISSING'
  | 'NETWORK_ERROR'
  | 'RATE_LIMITED'
  | 'UNKNOWN';

export function classifyExecutionError(err: any): ExecutionFailureClassification {
  const msg = (err?.message || String(err)).toLowerCase();

  if (msg.includes('slippage') || msg.includes('excessive_slippage')) return 'SLIPPAGE_EXCEEDED';
  if (msg.includes('insufficient') || msg.includes('balance')) return 'INSUFFICIENT_BALANCE';
  if (msg.includes('no route') || msg.includes('could not find')) return 'NO_ROUTE_FOUND';
  if (msg.includes('timeout') || msg.includes('timed out')) return 'RPC_TIMEOUT';
  if (msg.includes('blockhash')) return 'BLOCKHASH_EXPIRED';
  if (msg.includes('sign') || msg.includes('signature')) return 'SIGNATURE_ERROR';
  if (msg.includes('token account') || msg.includes('associated token')) return 'TOKEN_ACCOUNT_MISSING';
  if (msg.includes('rate limit') || msg.includes('429')) return 'RATE_LIMITED';
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound')) return 'NETWORK_ERROR';
  return 'UNKNOWN';
}
