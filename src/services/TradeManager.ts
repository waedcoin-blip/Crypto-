// src/services/TradeManager.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { PaperTradeExecutor, PaperTradeConfig } from './PaperTradeExecutor';
import { RealTradeExecutor, RealTradeConfig } from './RealTradeExecutor';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';

export type TradeMode = 'real' | 'paper';

export class TradeManager {
  private executor: ITradeExecutor;
  private _mode: TradeMode;
  private paperConfig: PaperTradeConfig;
  private realConfig: RealTradeConfig;

  constructor(options: {
    mode: TradeMode;
    paperConfig: PaperTradeConfig;
    realConfig: RealTradeConfig;
  }) {
    this._mode = options.mode;
    this.paperConfig = options.paperConfig;
    this.realConfig = options.realConfig;
    this.executor = this.createExecutor();
  }

  private createExecutor(): ITradeExecutor {
    if (this._mode === 'paper') {
      const saved = typeof window !== 'undefined'
        ? localStorage.getItem('paper_state') : null;
      if (saved) {
        try { return PaperTradeExecutor.deserialize(this.paperConfig, saved); }
        catch { /* fall through */ }
      }
      return new PaperTradeExecutor(this.paperConfig);
    }
    return new RealTradeExecutor(this.realConfig);
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
    if (this.executor instanceof PaperTradeExecutor) {
      localStorage.setItem('paper_state', this.executor.serialize());
    }
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
