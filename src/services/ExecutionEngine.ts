// src/services/ExecutionEngine.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { TradingNetwork } from '../config/network';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { apiClient } from './apiClient';

export interface ExecutionEngineConfig {
  network?: TradingNetwork;
  verbose?: boolean;
}

/**
 * ExecutionEngine: Authoritative execution gateway.
 * Delegates all swap execution to backend API routes (/api/trading/buy and /api/trading/sell).
 */
export class ExecutionEngine implements ITradeExecutor {
  private static instance: ExecutionEngine;
  public mode: TradingNetwork;

  constructor(config: ExecutionEngineConfig = {}) {
    const network: TradingNetwork =
      config.network ||
      useTradingEnvironmentStore.getState().network ||
      (typeof window !== 'undefined' ? (localStorage.getItem('app_trading_network') as TradingNetwork) : null) ||
      'paper';
    this.mode = network;
  }

  public static getInstance(): ExecutionEngine {
    if (!ExecutionEngine.instance) {
      ExecutionEngine.instance = new ExecutionEngine();
    }
    return ExecutionEngine.instance;
  }

  public getExecutorForNetwork(network: TradingNetwork): ITradeExecutor {
    this.mode = network;
    return this;
  }

  public resolveSession(): { network: TradingNetwork; executor: ITradeExecutor } {
    const network =
      useTradingEnvironmentStore.getState().network ||
      (typeof window !== 'undefined' ? (localStorage.getItem('app_trading_network') as TradingNetwork) : null) ||
      'paper';

    this.mode = network;
    return { network, executor: this };
  }

  public get publicKey(): string {
    return 'backend-authoritative-wallet';
  }

  public getNetwork(): TradingNetwork {
    return this.resolveSession().network;
  }

  async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    const inputMint = params.inputMint;
    const outputMint = params.outputMint;
    const amount = params.amount;
    const slippageBps = params.slippageBps || 100;

    const res = await apiClient.get(`/api/trading/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`);
    if (res && res.quote) {
      return res.quote;
    }
    throw new Error(res?.error || 'Failed to fetch quote from backend');
  }

  async swap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
    label: 'entry' | 'exit_tp' | 'exit_sl' | string = 'entry'
  ): Promise<SwapResult> {
    const network = this.getNetwork();
    const isSolBuy = inputMint.startsWith('So11111111111111111111111111111111111111112');
    const endpoint = isSolBuy ? '/api/trading/buy' : '/api/trading/sell';
    const body = isSolBuy
      ? { network, mint: outputMint, amountSol: amount / 1e9, slippageBps, label }
      : { network, mint: inputMint, amountRaw: String(amount), slippageBps, reason: label };

    const data = await apiClient.post(endpoint, body);
    if (!data || !data.success) {
      throw new Error(data?.error || 'Trade execution failed');
    }

    return {
      signature: data.signature,
      inputMint,
      outputMint,
      inputAmount: amount,
      outputAmount: Number(data.result?.outAmountRaw || data.outAmountRaw || 0),
      feeSol: 0,
      slot: 0,
      landingTimeMs: 0,
      method: 'rpc',
    };
  }

  async batchSwap(
    swaps: Array<{
      inputMint: string;
      outputMint: string;
      amount: number;
      slippageBps: number;
      label?: 'entry' | 'exit_tp' | 'exit_sl' | string;
    }>
  ): Promise<SwapResult[]> {
    const results: SwapResult[] = [];
    for (const s of swaps) {
      const res = await this.swap(s.inputMint, s.outputMint, s.amount, s.slippageBps, s.label || 'entry');
      results.push(res);
    }
    return results;
  }

  async getSolBalance(): Promise<number> {
    return 0;
  }

  async getTokenBalance(mint: string): Promise<number> {
    return 0;
  }

  async hasTokenAccount(mint: string): Promise<boolean> {
    return false;
  }

  getTelemetry(): ExecutorTelemetry {
    return {
      totalSwaps: 0,
      totalFeesPaidSol: 0,
      avgLandingTimeMs: 0,
      failureRate: 0,
    };
  }
}

export const executionEngine = ExecutionEngine.getInstance();
