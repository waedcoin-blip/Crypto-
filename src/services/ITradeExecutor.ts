// src/services/ITradeExecutor.ts
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';

export interface SwapResult {
  signature: string;
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  feeSol: number;
  slot: number;
  landingTimeMs: number;
  method: 'jito' | 'helius' | 'rpc';
  simulated?: boolean;
  error?: string;
}

export interface ITradeExecutor {
  readonly mode: 'real' | 'paper';
  readonly publicKey: string;

  getQuote(params: QuoteGetRequest): Promise<QuoteResponse>;

  swap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
    label?: 'entry' | 'exit_tp' | 'exit_sl'
  ): Promise<SwapResult>;

  getSolBalance(): Promise<number>;
  getTokenBalance(mint: string): Promise<number>;
  hasTokenAccount(mint: string): Promise<boolean>;

  batchSwap(
    swaps: Array<{
      inputMint: string;
      outputMint: string;
      amount: number;
      slippageBps: number;
    }>
  ): Promise<SwapResult[]>;

  getTelemetry(): ExecutorTelemetry;
}

export interface ExecutorTelemetry {
  totalSwaps: number;
  totalFeesPaidSol: number;
  avgLandingTimeMs: number;
  failureRate: number;
  lastFailure?: string;
}
