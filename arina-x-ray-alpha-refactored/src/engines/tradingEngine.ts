import { useAppStore } from '../store/appStore';
import { getJupiterQuote, createJupiterSwapTransaction, executeTxWithRPCFallback } from '../services/jupiterService';
import { Connection, Keypair } from '@solana/web3.js';

export class TradingEngine {
  private static instance: TradingEngine;
  
  public static getInstance(): TradingEngine {
    if (!TradingEngine.instance) {
      TradingEngine.instance = new TradingEngine();
    }
    return TradingEngine.instance;
  }

  public async executeTrade(
    connection: Connection,
    wallet: Keypair,
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

      // 1. Get Quote
      const quoteDetails = await getJupiterQuote(
        inputMint,
        outputMint,
        amountSol,
        useAppStore.getState().slippage * 100 // bps
      );

      if (!quoteDetails) throw new Error('No quote found');

      // 2. Build Transaction
      const base64Tx = await createJupiterSwapTransaction(
        wallet.publicKey.toBase58(),
        quoteDetails
      );
      
      if (!base64Tx) throw new Error('Failed to build transaction');

      // 3. Sign Transaction
      base64Tx.sign([wallet]);

      // 4. Execution
      const signature = await executeTxWithRPCFallback(base64Tx, connection);

      return { success: true, signature };
    } catch (error: any) {
      console.error(`TradingEngine: Execution Failed`, error);
      return { success: false, error: error.message };
    }
  }

  // Advanced features like Auto-Sniping or Copy-Trading would hook into the Event Bus
}

export const tradingEngine = TradingEngine.getInstance();
