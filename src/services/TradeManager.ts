// src/services/TradeManager.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { RealTradeExecutor, RealTradeConfig } from './RealTradeExecutor';
import { PaperTradeExecutor, PaperTradeConfig } from './PaperTradeExecutor';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { TradingNetwork } from '../config/network';

export type TradeMode = 'devnet' | 'mainnet' | 'real' | 'paper';

export class TradeManager {
  private executor: ITradeExecutor;
  private _mode: TradeMode;
  private realConfig: RealTradeConfig;
  private paperConfig: any;

  constructor(options: {
    mode: TradeMode;
    realConfig?: RealTradeConfig;
    paperConfig?: any;
  }) {
    this._mode = options.mode;
    this.realConfig = options.realConfig || {};
    this.paperConfig = options.paperConfig || { initialSolBalance: 10 };
    this.executor = this.createExecutor();
  }

  private createExecutor(): ITradeExecutor {
    if (this._mode === 'paper') {
      return new PaperTradeExecutor(this.paperConfig);
    }

    if (this._mode === 'mainnet' || this._mode === 'real') {
      console.error("TRADING STATUS: DEVELOPMENT ONLY. MAINNET EXECUTION: DISABLED. Falling back to paper trading.");
      this._mode = 'paper';
      return new PaperTradeExecutor(this.paperConfig);
    }

    return new RealTradeExecutor({
      ...this.realConfig,
      network: 'devnet',
    });
  }

  switchMode(mode: TradeMode) {
    if (mode === this._mode) return;
    this.save();
    this._mode = mode;
    this.executor = this.createExecutor();
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
