import { useAppStore } from '../store/appStore';
import { RealTradeExecutor } from '../services/RealTradeExecutor';
import { Connection, Keypair } from '@solana/web3.js';

export class TradingEngine {
  private static instance: TradingEngine;
  private executor: RealTradeExecutor;
  
  private constructor() {
    this.executor = new RealTradeExecutor();
  }

  public static getInstance(): TradingEngine {
    if (!TradingEngine.instance) {
      TradingEngine.instance = new TradingEngine();
    }
    return TradingEngine.instance;
  }

  public async executeTrade(
    _connection: Connection,
    _wallet: Keypair,
    tokenMint: string,
    amountSol: number,
    side: 'BUY' | 'SELL'
  ) {
    if (tokenMint === 'So11111111111111111111111111111111111111112') {
      return { success: false, error: 'Cannot trade native Solana token.' };
    }
    try {
      const isBuy = side === 'BUY';
      const inputMint = isBuy ? 'So11111111111111111111111111111111111111112' : tokenMint;
      const outputMint = isBuy ? tokenMint : 'So11111111111111111111111111111111111111112';
      const slippageBps = Math.round((useAppStore.getState().slippage || 1) * 100);

      const result = await this.executor.swap(
        inputMint,
        outputMint,
        amountSol,
        slippageBps,
        isBuy ? 'entry' : 'exit_tp'
      );

      return { success: true, signature: result.signature };
    } catch (error: any) {
      console.error(`TradingEngine: Execution Failed`, error);
      return { success: false, error: error.message };
    }
  }

  // Advanced features like Auto-Sniping or Copy-Trading would hook into the Event Bus
}

export const tradingEngine = TradingEngine.getInstance();
