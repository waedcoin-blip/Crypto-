import { useAppStore } from '../store/appStore';
import { getJupiterQuote, createJupiterSwapTransaction, executeTxWithRPCFallback } from '../services/jupiterService';
import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_DECIMALS = 9;

export class TradingEngine {
  private static instance: TradingEngine;

  public static getInstance(): TradingEngine {
    if (!TradingEngine.instance) {
      TradingEngine.instance = new TradingEngine();
    }
    return TradingEngine.instance;
  }

  /**
   * Resolves the on-chain decimals for a given mint so amounts can be
   * converted to the correct atomic unit before being sent to Jupiter.
   * SOL is hardcoded since it isn't an SPL mint account.
   */
  private async getMintDecimals(connection: Connection, mint: string): Promise<number> {
    if (mint === SOL_MINT) return SOL_DECIMALS;
    const mintInfo = await getMint(connection, new PublicKey(mint));
    return mintInfo.decimals;
  }

  /**
   * @param amount For a BUY this is the amount of SOL to spend. For a SELL
   *   this is the amount of the token being sold (human-readable units, not
   *   atomic units) - it is NOT a SOL amount on the sell side.
   */
  public async executeTrade(
    connection: Connection,
    wallet: Keypair,
    tokenMint: string,
    amount: number,
    side: 'BUY' | 'SELL'
  ) {
    if (tokenMint === SOL_MINT) {
      return { success: false, error: 'Cannot trade native Solana token.' };
    }
    try {
      const isBuy = side === 'BUY';
      const inputMint = isBuy ? SOL_MINT : tokenMint;
      const outputMint = isBuy ? tokenMint : SOL_MINT;

      // Convert the human-readable amount into the input mint's atomic units.
      // SOL always has 9 decimals; the token's decimals must be read on-chain
      // since it varies per mint (6, 9, or something else entirely).
      const inputDecimals = await this.getMintDecimals(connection, inputMint);
      const atomicAmount = Math.floor(amount * Math.pow(10, inputDecimals));

      if (atomicAmount <= 0) {
        throw new Error('Trade amount resolves to zero atomic units.');
      }

      // 1. Get Quote
      const quoteDetails = await getJupiterQuote(
        inputMint,
        outputMint,
        atomicAmount,
        useAppStore.getState().slippage * 100 // bps
      );

      if (!quoteDetails) throw new Error('No quote found');

      // 2. Build Transaction
      const base64Tx = await createJupiterSwapTransaction(
        wallet.publicKey.toBase58(),
        quoteDetails
      );

      if (!base64Tx) throw new Error('Failed to build transaction');

      // 3. Deserialize, then sign. createJupiterSwapTransaction returns a
      // base64-encoded transaction, not a live VersionedTransaction object,
      // so it must be deserialized before .sign() is available on it.
      const transaction = VersionedTransaction.deserialize(Buffer.from(base64Tx, 'base64'));
      transaction.sign([wallet]);
      const signedTx = Buffer.from(transaction.serialize()).toString('base64');

      // 4. Execution
      const signature = await executeTxWithRPCFallback(signedTx, connection);

      return { success: true, signature };
    } catch (error: any) {
      console.error(`TradingEngine: Execution Failed`, error);
      return { success: false, error: error.message };
    }
  }

  // Advanced features like Auto-Sniping or Copy-Trading would hook into the Event Bus
}

export const tradingEngine = TradingEngine.getInstance();
