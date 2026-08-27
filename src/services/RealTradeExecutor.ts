// src/services/RealTradeExecutor.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { ExecutionEngine, executionEngine } from './ExecutionEngine';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { TradingNetwork } from '../config/network';

import { orderManager } from './OrderManager';

export interface RealTradeConfig {
  network?: TradingNetwork;
  verbose?: boolean;
}

/**
 * RealTradeExecutor: Authoritative execution wrapper routing through OrderManager.
 */
export class RealTradeExecutor implements ITradeExecutor {
  private engine: ExecutionEngine;

  constructor(config: RealTradeConfig = {}) {
    this.engine = config.network ? new ExecutionEngine({ network: config.network }) : executionEngine;
  }

  public get mode(): TradingNetwork {
    return this.engine.mode;
  }

  public get publicKey(): string {
    return this.engine.publicKey;
  }

  async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    return this.engine.getQuote(params);
  }

  async swap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
    label: 'entry' | 'exit_tp' | 'exit_sl' = 'entry'
  ): Promise<SwapResult> {
    return orderManager.executeOrder(inputMint, outputMint, amount, slippageBps, label);
  }

  async batchSwap(
    swaps: Array<{ inputMint: string; outputMint: string; amount: number; slippageBps: number }>
  ): Promise<SwapResult[]> {
    return this.engine.batchSwap(swaps);
  }

  async getSolBalance(): Promise<number> {
    return this.engine.getSolBalance();
  }

  async getTokenBalance(mint: string): Promise<number> {
    return this.engine.getTokenBalance(mint);
  }

  async hasTokenAccount(mint: string): Promise<boolean> {
    return this.engine.hasTokenAccount(mint);
  }

  getTelemetry(): ExecutorTelemetry {
    return this.engine.getTelemetry();
  }
}

