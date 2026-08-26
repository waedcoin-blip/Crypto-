// src/engines/tradingEngine.ts
import { useAppStore } from '../store/appStore';
import { orderManager } from '../services/OrderManager';
import { riskManager } from '../services/RiskManager';
import { Connection, Keypair } from '@solana/web3.js';

export interface TradeDecision {
  tokenMint: string;
  amountSol: number;
  side: 'BUY' | 'SELL';
  signalReason?: string;
}

/**
 * TradingEngine: Token discovery, signals, momentum, and entry decision logic.
 * Trade executions are delegated strictly to OrderManager.
 */
export class TradingEngine {
  private static instance: TradingEngine;

  private constructor() {}

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
    const WSOL = 'So11111111111111111111111111111111111111112';
    if (tokenMint === WSOL) {
      return { success: false, error: 'Cannot trade native Solana token.' };
    }

    // Risk Check: Ensure we don't exceed position limits on new BUY orders
    if (side === 'BUY' && !riskManager.canOpenNewPosition()) {
      return {
        success: false,
        error: 'RiskManager: Maximum open position limit reached. Entry aborted.',
      };
    }

    try {
      const isBuy = side === 'BUY';
      const inputMint = isBuy ? WSOL : tokenMint;
      const outputMint = isBuy ? tokenMint : WSOL;
      const slippageBps = Math.round((useAppStore.getState().slippage || 1) * 100);

      const result = await orderManager.executeOrder(
        inputMint,
        outputMint,
        amountSol,
        slippageBps,
        isBuy ? 'entry' : 'exit_tp'
      );

      if (isBuy && result.signature) {
        const receivedTokens = result.outputAmount || 0;
        const entryPrice = receivedTokens > 0 ? amountSol / (receivedTokens / 1e6) : 0;
        riskManager.addPosition({
          mint: tokenMint,
          amount: receivedTokens,
          buyPrice: entryPrice,
          solSpent: amountSol,
          tokenDecimals: 6,
        });
      }

      return { success: true, signature: result.signature, result };
    } catch (error: any) {
      console.error(`TradingEngine: Execution Failed`, error);
      return { success: false, error: error.message || String(error) };
    }
  }
}

export const tradingEngine = TradingEngine.getInstance();

