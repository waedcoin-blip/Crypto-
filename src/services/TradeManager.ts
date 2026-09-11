// src/services/TradeManager.ts
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { TradingNetwork } from '../config/network';
import { orderManager, SwapResult, ITradeExecutor } from './OrderManager';
import { getJupiterQuote } from './jupiterService';
import { tradingApi } from './ApiClient';
import { useWalletBridge } from './walletBridge';

export type TradeMode = 'paper' | 'mainnet';

export interface ExecutorTelemetry {
  successfulSwaps: number;
  failedSwaps: number;
  avgLatencyMs: number;
}

/**
 * TradeManager: Adapter layer routing through OrderManager and backend API.
 */
export class TradeManager {
  private _mode: TradeMode;

  constructor(options: {
    mode: TradeMode;
    realConfig?: { network?: TradingNetwork; verbose?: boolean };
  }) {
    this._mode = options.mode;
  }

  switchMode(mode: TradeMode) {
    if (mode === this._mode) return;
    this.save();
    this._mode = mode;
  }

  get mode() { return this._mode; }

  save() {
    // No-op for real execution
  }

  getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    return getJupiterQuote(params.inputMint, params.outputMint, Number(params.amount), params.slippageBps);
  }

  async swap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
    label: 'entry' | 'exit_tp' | 'exit_sl' | 'MAX_HOLD' | 'MANUAL' | 'FORCE_EXIT' | string = 'entry',
    preValidatedQuote?: QuoteResponse | null
  ): Promise<SwapResult> {
    return orderManager.executeOrder(inputMint, outputMint, amount, slippageBps, label, preValidatedQuote);
  }

  batchSwap(swaps: Array<{ inputMint: string; outputMint: string; amount: number; slippageBps: number; label?: string }>) {
    return Promise.all(swaps.map(s => this.swap(s.inputMint, s.outputMint, s.amount, s.slippageBps, s.label)));
  }

  async getSolBalance(): Promise<number> {
    const status = await tradingApi.getStatus().catch(() => null);
    return status?.engine?.solBalance ?? useWalletBridge.getState().solBalance ?? 0;
  }

  async getTokenBalance(mint: string): Promise<number> {
    const positions = await tradingApi.getPositions().catch(() => ({ positions: [] }));
    const match = positions.positions?.find(p => p.mint === mint);
    return match?.amount ?? 0;
  }

  async hasTokenAccount(mint: string): Promise<boolean> {
    const balance = await this.getTokenBalance(mint);
    return balance > 0;
  }

  getTelemetry(): ExecutorTelemetry {
    return {
      successfulSwaps: 0,
      failedSwaps: 0,
      avgLatencyMs: 0,
    };
  }
}



