// server/execution/TradeExecutor.ts

export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: number; // Raw integer units or lamports
  slippageBps?: number;
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
  walletAddress?: string;
  network?: string;
  label?: string;
  preValidatedQuote?: QuoteResult | null;
  clientRequestId?: string;
  tokenDecimals?: number;
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
  inputDecimals?: number;
  outputDecimals?: number;
}

export interface TradeExecutor {
  quoteBuy(params: QuoteParams): Promise<QuoteResult>;
  quoteSell(params: QuoteParams): Promise<QuoteResult>;
  buy(params: ExecuteParams): Promise<ExecutionResult>;
  sell(params: ExecuteParams): Promise<ExecutionResult>;
  getBalance(walletAddress?: string): Promise<number>;
  getTokenBalance(mint: string, walletAddress?: string): Promise<number>;
}
