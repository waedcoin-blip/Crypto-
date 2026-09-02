// server/execution/TradeExecutor.ts

export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: number; // Raw integer units or lamports
  slippageBps?: number;
  decimals?: number; // ADDED
  userPublicKey?: string;
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
  amount: number; // Raw integer units
  slippageBps: number;
  decimals: number; // ADDED: Must be provided
  walletAddress?: string;
  label?: string;
  preValidatedQuote?: QuoteResult | null;
  clientRequestId?: string;
}

export interface ExecutionResult {
  success: boolean;
  signature?: string;
  inputMint: string;
  outputMint: string;
  inAmountRaw: number;
  outAmountRaw: number;
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
