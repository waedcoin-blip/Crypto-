// src/services/ITradeExecutor.ts
import { PublicKey } from '@solana/web3.js';

export interface SwapResult {
  success?: boolean;
  signature?: string;
  error?: string;
  inputAmount?: any;
  outputAmount?: any;
  inAmount?: string;
  outAmount?: string;
  priceImpactPct?: number;
  routePlan?: any[];
  txid?: string;
  latencyMs?: number;
  totalCostSol?: number;
  feeSol?: number;
  slot?: number;
  landingTimeMs?: number;
  method?: string;
  inputMint?: string;
  outputMint?: string;
}

export interface TradeQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold?: string;
  priceImpactPct?: number;
  routePlan?: any[];
  slippageBps?: number;
  rawQuoteResponse?: any;
}

export interface TradeResult {
  success: boolean;
  signature?: string;
  error?: string;
  inputAmount?: string;
  outputAmount?: string;
  inAmount?: string;
  outAmount?: string;
  priceImpactPct?: number;
}

export interface ExecutorTelemetry {
  totalSwaps: number;
  successfulSwaps: number;
  failedSwaps: number;
  avgLatencyMs: number;
}

export class ExecutionError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'ExecutionError';
  }
}

export interface ITradeExecutor {
  mode?: any;
  publicKey?: any;
  getQuote(params: any): Promise<any>;
  executeSwap(quote: any, keypair?: any): Promise<SwapResult>;
  batchSwap?(quotes: any[]): Promise<SwapResult[]>;
  getSolBalance?(address?: string): Promise<number>;
  getTokenBalance?(mintOrAddress: string, mint?: string): Promise<any>;
  hasTokenAccount?(mintOrAddress: string, mint?: string): Promise<boolean>;
  getTelemetry?(): ExecutorTelemetry;
}
