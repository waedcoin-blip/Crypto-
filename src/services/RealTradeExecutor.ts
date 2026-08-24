// src/services/RealTradeExecutor.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { DevnetAmmExecutor } from './DevnetAmmExecutor';
import { MainnetJupiterExecutor } from './MainnetJupiterExecutor';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { TradingNetwork } from '../config/network';

export interface RealTradeConfig {
  network?: TradingNetwork;
  verbose?: boolean;
  hybridEngine?: any;
}

export class RealTradeExecutor implements ITradeExecutor {
  readonly mode: TradingNetwork;
  private delegate: ITradeExecutor;

  constructor(config: RealTradeConfig = {}) {
    const network: TradingNetwork = config.network || (localStorage.getItem('app_trading_network') as TradingNetwork) || 'devnet';
    this.mode = network;

    if (network === 'devnet') {
      this.delegate = new DevnetAmmExecutor();
    } else {
      this.delegate = new MainnetJupiterExecutor();
    }
  }

  public get publicKey(): string {
    return this.delegate.publicKey;
  }

  async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    if (this.mode === 'devnet') {
      throw new Error("Jupiter API is not available on Solana Devnet. Cannot fetch quotes for Devnet execution.");
    }
    return this.delegate.getQuote(params);
  }

  async swap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
    label: 'entry' | 'exit_tp' | 'exit_sl' = 'entry'
  ): Promise<SwapResult> {
    return this.delegate.swap(inputMint, outputMint, amount, slippageBps, label);
  }

  async batchSwap(
    swaps: Array<{ inputMint: string; outputMint: string; amount: number; slippageBps: number }>
  ): Promise<SwapResult[]> {
    return this.delegate.batchSwap(swaps);
  }

  async getSolBalance(): Promise<number> {
    return this.delegate.getSolBalance();
  }

  async getTokenBalance(mint: string): Promise<number> {
    return this.delegate.getTokenBalance(mint);
  }

  async hasTokenAccount(mint: string): Promise<boolean> {
    return this.delegate.hasTokenAccount(mint);
  }

  getTelemetry(): ExecutorTelemetry {
    return this.delegate.getTelemetry();
  }
}
