// src/services/ExecutionEngine.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { MainnetJupiterExecutor } from './MainnetJupiterExecutor';
import { PaperTradeExecutor } from './PaperTradeExecutor';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { TradingNetwork } from '../config/network';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';

export interface ExecutionEngineConfig {
  network?: TradingNetwork;
  verbose?: boolean;
}

/**
 * ExecutionEngine: The authoritative execution layer.
 * 
 * CORE PRINCIPLE: Only ONE component in the application may submit a blockchain transaction.
 * ExecutionEngine locks executor resolution per transaction to guarantee atomic quote-to-execution
 * consistency and prevent mid-flight network desynchronization.
 */
export class ExecutionEngine implements ITradeExecutor {
  private static instance: ExecutionEngine;
  public mode: TradingNetwork;
  private paperExecutor: PaperTradeExecutor | null = null;
  private mainnetExecutor: MainnetJupiterExecutor | null = null;

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
    if (network === 'paper') {
      if (!this.paperExecutor) {
        this.paperExecutor = new PaperTradeExecutor();
      }
      return this.paperExecutor;
    } else {
      if (!this.mainnetExecutor) {
        this.mainnetExecutor = new MainnetJupiterExecutor();
      }
      return this.mainnetExecutor;
    }
  }

  /**
   * Resolves the current network and its corresponding executor atomically for a transaction.
   */
  public resolveSession(): { network: TradingNetwork; executor: ITradeExecutor } {
    const network =
      useTradingEnvironmentStore.getState().network ||
      (typeof window !== 'undefined' ? (localStorage.getItem('app_trading_network') as TradingNetwork) : null) ||
      'paper';

    this.mode = network;
    const executor = this.getExecutorForNetwork(network);
    return { network, executor };
  }

  private getActiveExecutor(): ITradeExecutor {
    return this.resolveSession().executor;
  }

  public get publicKey(): string {
    return this.getActiveExecutor().publicKey;
  }

  public getNetwork(): TradingNetwork {
    return this.resolveSession().network;
  }

  async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    const { executor } = this.resolveSession();
    return executor.getQuote(params);
  }

  async swap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
    label: 'entry' | 'exit_tp' | 'exit_sl' = 'entry',
    preValidatedQuote?: QuoteResponse | null
  ): Promise<SwapResult> {
    // Atomically lock session for the duration of this swap
    const { executor } = this.resolveSession();
    return executor.swap(inputMint, outputMint, amount, slippageBps, label, preValidatedQuote);
  }

  async batchSwap(
    swaps: Array<{
      inputMint: string;
      outputMint: string;
      amount: number;
      slippageBps: number;
      label?: 'entry' | 'exit_tp' | 'exit_sl';
    }>
  ): Promise<SwapResult[]> {
    const { executor } = this.resolveSession();

    // Forward label explicitly for each swap
    const sanitizedSwaps = swaps.map(s => ({
      ...s,
      label: s.label || 'entry',
    }));

    return executor.batchSwap(sanitizedSwaps);
  }

  async getSolBalance(): Promise<number> {
    const { executor } = this.resolveSession();
    return executor.getSolBalance();
  }

  async getTokenBalance(mint: string): Promise<number> {
    const { executor } = this.resolveSession();
    return executor.getTokenBalance(mint);
  }

  async hasTokenAccount(mint: string): Promise<boolean> {
    const { executor } = this.resolveSession();
    return executor.hasTokenAccount(mint);
  }

  getTelemetry(): ExecutorTelemetry {
    const { executor } = this.resolveSession();
    return executor.getTelemetry();
  }
}

export const executionEngine = ExecutionEngine.getInstance();
