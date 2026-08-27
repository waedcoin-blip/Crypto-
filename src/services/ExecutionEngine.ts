// src/services/ExecutionEngine.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { DevnetAmmExecutor } from './DevnetAmmExecutor';
import { MainnetJupiterExecutor } from './MainnetJupiterExecutor';
import { PaperTradeExecutor } from './PaperTradeExecutor';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { TradingNetwork } from '../config/network';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { NetworkGuard } from './NetworkGuard';

export interface ExecutionEngineConfig {
  network?: TradingNetwork;
  verbose?: boolean;
}

/**
 * ExecutionEngine: The authoritative execution layer.
 * 
 * CORE PRINCIPLE: Only ONE component in the application may submit a blockchain transaction.
 * ExecutionEngine is the single component permitted to route and execute trades via
 * DevnetAmmExecutor (for Devnet) or MainnetJupiterExecutor (for Mainnet).
 */
export class ExecutionEngine implements ITradeExecutor {
  private static instance: ExecutionEngine;
  public mode: TradingNetwork;
  private paperExecutor: PaperTradeExecutor | null = null;
  private devnetExecutor: DevnetAmmExecutor | null = null;
  private mainnetExecutor: MainnetJupiterExecutor | null = null;

  constructor(config: ExecutionEngineConfig = {}) {
    const network: TradingNetwork =
      config.network ||
      useTradingEnvironmentStore.getState().network ||
      (typeof window !== 'undefined' ? (localStorage.getItem('app_trading_network') as TradingNetwork) : null) ||
      'devnet';
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
    } else if (network === 'devnet') {
      if (!this.devnetExecutor) {
        this.devnetExecutor = new DevnetAmmExecutor();
      }
      return this.devnetExecutor;
    } else {
      if (!this.mainnetExecutor) {
        this.mainnetExecutor = new MainnetJupiterExecutor();
      }
      return this.mainnetExecutor;
    }
  }

  private getActiveExecutor(): ITradeExecutor {
    const currentNetwork =
      useTradingEnvironmentStore.getState().network ||
      (typeof window !== 'undefined' ? (localStorage.getItem('app_trading_network') as TradingNetwork) : null) ||
      'paper';

    this.mode = currentNetwork;

    return this.getExecutorForNetwork(currentNetwork);
  }

  public get publicKey(): string {
    return this.getActiveExecutor().publicKey;
  }

  public getNetwork(): TradingNetwork {
    return this.mode;
  }

  async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    return this.getActiveExecutor().getQuote(params);
  }

  async swap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
    label: 'entry' | 'exit_tp' | 'exit_sl' = 'entry'
  ): Promise<SwapResult> {
    const executor = this.getActiveExecutor();
    
    // Strict safety check before execution
    const currentNetwork = this.getNetwork();
    if (currentNetwork === 'mainnet' && executor instanceof DevnetAmmExecutor) {
      throw new Error('EXECUTION ENGINE SAFETY ERROR: Devnet executor cannot execute in Mainnet mode.');
    }
    if (currentNetwork === 'devnet' && executor instanceof MainnetJupiterExecutor) {
      throw new Error('EXECUTION ENGINE SAFETY ERROR: Mainnet executor cannot execute in Devnet mode.');
    }

    return executor.swap(inputMint, outputMint, amount, slippageBps, label);
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
    return this.getActiveExecutor().batchSwap(swaps);
  }

  async getSolBalance(): Promise<number> {
    return this.getActiveExecutor().getSolBalance();
  }

  async getTokenBalance(mint: string): Promise<number> {
    return this.getActiveExecutor().getTokenBalance(mint);
  }

  async hasTokenAccount(mint: string): Promise<boolean> {
    return this.getActiveExecutor().hasTokenAccount(mint);
  }

  getTelemetry(): ExecutorTelemetry {
    return this.getActiveExecutor().getTelemetry();
  }
}

export const executionEngine = ExecutionEngine.getInstance();
