// src/services/RealTradeExecutor.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { DevnetAmmExecutor } from './DevnetAmmExecutor';
import { MainnetJupiterExecutor } from './MainnetJupiterExecutor';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { TradingNetwork } from '../config/network';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';

export interface RealTradeConfig {
  network?: TradingNetwork;
  verbose?: boolean;
}

export class RealTradeExecutor implements ITradeExecutor {
  public mode: TradingNetwork;
  private delegate: ITradeExecutor;

  constructor(config: RealTradeConfig = {}) {
    const network: TradingNetwork = config.network || useTradingEnvironmentStore.getState().network || (localStorage.getItem('app_trading_network') as TradingNetwork) || 'devnet';
    this.mode = network;

    if (network === 'devnet') {
      this.delegate = new DevnetAmmExecutor();
    } else {
      this.delegate = new MainnetJupiterExecutor();
    }
  }

  private getActiveExecutor(): ITradeExecutor {
    const currentNetwork = useTradingEnvironmentStore.getState().network || (localStorage.getItem('app_trading_network') as TradingNetwork) || 'devnet';
    if (currentNetwork !== this.mode) {
      this.mode = currentNetwork;
      this.delegate = currentNetwork === 'devnet' ? new DevnetAmmExecutor() : new MainnetJupiterExecutor();
    }
    return this.delegate;
  }

  public get publicKey(): string {
    return this.getActiveExecutor().publicKey;
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
    return this.getActiveExecutor().swap(inputMint, outputMint, amount, slippageBps, label);
  }

  async batchSwap(
    swaps: Array<{ inputMint: string; outputMint: string; amount: number; slippageBps: number }>
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
