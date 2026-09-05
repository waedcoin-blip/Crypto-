// server/execution/TradeExecutor.ts

export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: bigint | string | number; // Raw integer units or lamports
  slippageBps?: number;
  decimals?: number;
  userPublicKey?: string;
  walletAddress?: string;
  network?: string;
}

export interface QuoteResult {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: number;
  routePlan?: any[];
  rawQuote?: any;
}

export interface ExecuteParams {
  inputMint: string;
  outputMint: string;
  amount: bigint | string | number; // Raw integer units
  slippageBps: number;
  decimals: number;
  walletAddress?: string;
  network?: string;
  label?: string;
  preValidatedQuote?: QuoteResult | null;
  clientRequestId?: string;
  onBroadcast?: (signature: string, meta?: { blockhash?: string; lastValidBlockHeight?: number }) => Promise<void> | void;
}

export interface ExecutionResult {
  success: boolean;
  signature?: string;
  status?: 'CONFIRMED' | 'FAILED' | 'RECOVERY_REQUIRED' | 'SUBMITTED';
  isAmbiguous?: boolean;
  lastValidBlockHeight?: number;
  blockhash?: string;
  inputMint: string;
  outputMint: string;
  inAmountRaw: bigint | string | number;
  outAmountRaw: bigint | string | number;
  effectivePriceSol?: number;
  totalCostSol?: number;
  netProceedsSol?: number;
  error?: string;
  rawResponse?: any;
}

export interface TradeExecutor {
  quoteBuy(params: QuoteParams): Promise<QuoteResult>;
  quoteSell(params: QuoteParams): Promise<QuoteResult>;
  buy(params: ExecuteParams): Promise<ExecutionResult>;
  sell(params: ExecuteParams): Promise<ExecutionResult>;
  getBalance(walletAddress?: string): Promise<number>;
  getTokenBalance(mint: string, walletAddress?: string): Promise<number>;
}
