// src/services/TradeManager.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { ExecutionEngine, executionEngine } from './ExecutionEngine';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { TradingNetwork } from '../config/network';
import { orderManager } from './OrderManager';

export type TradeMode = 'paper' | 'mainnet';

/**
 * TradeManager: Adapter layer routing through OrderManager and ExecutionEngine.
 */
export class TradeManager {
  private executor: ExecutionEngine;
  private _mode: TradeMode;

  constructor(options: {
    mode: TradeMode;
    realConfig?: { network?: TradingNetwork; verbose?: boolean };
  }) {
    this._mode = options.mode;
    this.executor = options.realConfig?.network 
      ? new ExecutionEngine({ network: options.realConfig.network }) 
      : executionEngine;
  }

  switchMode(mode: TradeMode) {
    if (mode === this._mode) return;
    this.save();
    this._mode = mode;
    this.executor = new ExecutionEngine({ network: mode });
    orderManager.setExecutor(this.executor);
  }

  getExecutor(): ITradeExecutor { return this.executor; }
  get mode() { return this._mode; }

  save() {
    // No-op for real execution
  }

  // Passthrough methods to ExecutionEngine / OrderManager
  getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    return this.executor.getQuote(params);
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

  batchSwap(...args: Parameters<ITradeExecutor['batchSwap']>) {
    return this.executor.batchSwap(...args);
  }

  getSolBalance() { return this.executor.getSolBalance(); }
  getTokenBalance(mint: string) { return this.executor.getTokenBalance(mint); }
  hasTokenAccount(mint: string) { return this.executor.hasTokenAccount(mint); }
  getTelemetry(): ExecutorTelemetry { return this.executor.getTelemetry(); }
}


