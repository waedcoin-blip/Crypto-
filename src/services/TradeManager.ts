// src/services/TradeManager.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { RealTradeExecutor, RealTradeConfig } from './RealTradeExecutor';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { TradingNetwork } from '../config/network';
import { orderManager } from './OrderManager';

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
  }

  getExecutor(): ITradeExecutor { return this.executor; }
  get mode() { return this._mode; }

  save() {
    // No-op for real on-chain execution
  }

  // Passthrough methods
  getQuote(params: QuoteGetRequest) { return this.executor.getQuote(params); }

  async swap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
    label: 'entry' | 'exit_tp' | 'exit_sl' = 'entry'
  ): Promise<SwapResult> {
    const isSolBuy = inputMint === 'So11111111111111111111111111111111111111112';
    const targetMint = isSolBuy ? outputMint : inputMint;
    const side = isSolBuy ? 'buy' : 'sell';

    const order = orderManager.createOrder(targetMint, side, amount, slippageBps);
    orderManager.transitionState(order.id, 'VALIDATING');

    try {
      orderManager.transitionState(order.id, 'QUOTE_REQUESTED');
      orderManager.transitionState(order.id, 'TRANSACTION_BUILDING');
      orderManager.transitionState(order.id, 'SUBMITTED');

      const result = await this.executor.swap(inputMint, outputMint, amount, slippageBps, label);

      orderManager.transitionState(order.id, 'CONFIRMED', {
        signature: result.signature,
        result,
      });

      return result;
    } catch (err: any) {
      orderManager.transitionState(order.id, 'FAILED', {
        error: err.message || String(err),
      });
      throw err;
    }
  }

  batchSwap(...args: Parameters<ITradeExecutor['batchSwap']>) {
    return this.executor.batchSwap(...args);
  }
  getSolBalance() { return this.executor.getSolBalance(); }
  getTokenBalance(mint: string) { return this.executor.getTokenBalance(mint); }
  hasTokenAccount(mint: string) { return this.executor.hasTokenAccount(mint); }
  getTelemetry() { return this.executor.getTelemetry(); }
}

