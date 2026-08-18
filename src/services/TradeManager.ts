// src/services/TradeManager.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { RealTradeExecutor, RealTradeConfig } from './RealTradeExecutor';
import { PaperTradeExecutor, PaperTradeConfig } from './PaperTradeExecutor';
import { getSimExecutor } from './SimExecutorSingleton';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { TradingNetwork } from '../config/network';
import { Keypair } from '@solana/web3.js';
import { getSavedSessionKeypair } from '../utils/keypairUtils';

export type TradeMode = 'devnet' | 'mainnet' | 'real' | 'paper';

export class TradeManager {
  private executor: ITradeExecutor;
  private _mode: TradeMode;
  private realConfig: RealTradeConfig;
  private paperConfig: any;
  private currentKeypair: Keypair | null = null;

  constructor(options: {
    mode: TradeMode;
    realConfig?: RealTradeConfig;
    paperConfig?: any;
  }) {
    this._mode = options.mode;
    this.realConfig = options.realConfig || {};
    this.paperConfig = options.paperConfig || { initialSolBalance: 10 };
    this.currentKeypair = getSavedSessionKeypair();
    this.executor = this.createExecutor();
  }

  public setWallet(keypair: Keypair | null, network?: TradingNetwork) {
    this.currentKeypair = keypair;
    if (this.executor instanceof RealTradeExecutor) {
      this.executor.setWallet(keypair, network);
    }
  }

  private createExecutor(): ITradeExecutor {
    if (this._mode === 'paper') {
      return getSimExecutor(this.paperConfig.initialSolBalance || 10);
    }

    if (this._mode === 'mainnet' || this._mode === 'real') {
      console.warn("Mainnet/Real execution routed to RealTradeExecutor or paper fallback if unconfigured.");
      if (this.realConfig?.hybridEngine) {
        const exec = new RealTradeExecutor({
          ...this.realConfig,
          network: 'mainnet',
        });
        if (this.currentKeypair) exec.setWallet(this.currentKeypair, 'mainnet');
        return exec;
      }
      return getSimExecutor(this.paperConfig.initialSolBalance || 10);
    }

    const exec = new RealTradeExecutor({
      ...this.realConfig,
      network: 'devnet',
    });
    if (this.currentKeypair) exec.setWallet(this.currentKeypair, 'devnet');
    return exec;
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
