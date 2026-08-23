// src/services/TradeManager.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { RealTradeExecutor, RealTradeConfig } from './RealTradeExecutor';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { TradingNetwork } from '../config/network';

export type TradeMode = 'devnet' | 'mainnet';

export class TradeManager {
  private executor: ITradeExecutor;
  private _mode: TradeMode;
  private realConfig: RealTradeConfig;

  constructor(options: {
    mode: TradeMode;
    realConfig?: RealTradeConfig;
  }) {
    this._mode = options.mode;
    this.realConfig = options.realConfig || {};
    this.executor = this.createExecutor();
  }

  private createExecutor(): ITradeExecutor {
    const network: TradingNetwork = this._mode;
    return new RealTradeExecutor({
      ...this.realConfig,
      network,
    });
  }

  switchMode(mode: TradeMode) {
    if (mode === this._mode) return;
    this.save();
    this._mode = mode;
    this.executor = this.createExecutor();
    try {
      window.dispatchEvent(new CustomEvent('trading_network_changed', { detail: { network: mode } }));
    } catch (e) {}
  }

  getExecutor(): ITradeExecutor { return this.executor; }
  get mode() { return this._mode; }

  save() {
    // No-op for real on-chain execution
  }

  // Passthrough methods
  getQuote(params: QuoteGetRequest) { return this.executor.getQuote(params); }
  swap(...args: Parameters<ITradeExecutor['swap']>) { return this.executor.swap(...args); }
  batchSwap(...args: Parameters<ITradeExecutor['batchSwap']>) {
    return this.executor.batchSwap(...args);
  }
  getSolBalance() { return this.executor.getSolBalance(); }
  getTokenBalance(mint: string) { return this.executor.getTokenBalance(mint); }
  hasTokenAccount(mint: string) { return this.executor.hasTokenAccount(mint); }
  getTelemetry() { return this.executor.getTelemetry(); }
}

