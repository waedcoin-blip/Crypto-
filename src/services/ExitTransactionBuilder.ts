// src/services/ExitTransactionBuilder.ts
import { ValidatedExitQuote } from './JupiterQuoteService';
import { VersionedTransaction, Connection, Keypair } from '@solana/web3.js';
import { createJupiterApiClient } from '@jup-ag/api';
import { useActiveWalletStore } from '../store/activeWalletStore';
import { rpcRouting } from './rpcRouting';

export type ExitPriorityTier = 'NORMAL' | 'HIGH' | 'URGENT' | 'EMERGENCY';

export interface PreparedExitTransaction {
  transaction: VersionedTransaction;
  rawTxBuffer: Buffer;
  quote: ValidatedExitQuote;
  userPublicKey: string;
  priorityTier: ExitPriorityTier;
  maxPriorityFeeLamports: number;
  buildTimestamp: number;
}

export class ExitTransactionBuilder {
  private static instance: ExitTransactionBuilder;
  private jupiterApiClient: ReturnType<typeof createJupiterApiClient>;

  private constructor() {
    const basePath = (typeof process !== 'undefined' ? process.env.JUPITER_API_URL : undefined) || 'https://api.jup.ag/swap/v1';
    this.jupiterApiClient = createJupiterApiClient({ basePath });
  }

  public static getInstance(): ExitTransactionBuilder {
    if (!ExitTransactionBuilder.instance) {
      ExitTransactionBuilder.instance = new ExitTransactionBuilder();
    }
    return ExitTransactionBuilder.instance;
  }

  public getPriorityFeeForTier(tier: ExitPriorityTier): number {
    switch (tier) {
      case 'EMERGENCY':
        return 1_500_000; // 0.0015 SOL
      case 'URGENT':
        return 800_000; // 0.0008 SOL
      case 'HIGH':
        return 400_000; // 0.0004 SOL
      case 'NORMAL':
      default:
        return 150_000; // 0.00015 SOL
    }
  }

  /**
   * Builds and signs a VersionedTransaction using the validated executable exit quote.
   */
  public async buildSignedExitTransaction(
    validatedQuote: ValidatedExitQuote,
    priorityTier: ExitPriorityTier = 'HIGH',
    customSignerKeypair?: Keypair
  ): Promise<PreparedExitTransaction> {
    if (Date.now() >= validatedQuote.expiresAt) {
      throw new Error(`TRANSACTION_BUILD_ERROR: Validated quote expired for mint ${validatedQuote.mint}`);
    }

    const activeWallet = useActiveWalletStore.getState().activeWallet;
    const kp = customSignerKeypair || activeWallet?.keypair;

    if (!kp) {
      throw new Error('TRANSACTION_BUILD_ERROR: No active signing keypair available for mainnet transaction building');
    }

    const userPublicKey = kp.publicKey.toBase58();
    const maxLamports = this.getPriorityFeeForTier(priorityTier);

    let swapResponse: any;
    try {
      swapResponse = await this.jupiterApiClient.swapPost({
        swapRequest: {
          quoteResponse: validatedQuote.quote,
          userPublicKey,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
              priorityLevel: priorityTier.toLowerCase() as any,
              maxLamports,
              global: false,
            },
          } as any,
        },
      });
    } catch (err: any) {
      throw new Error(`TRANSACTION_BUILD_ERROR: Jupiter swapPost failed for ${validatedQuote.mint}: ${err?.message || String(err)}`);
    }

    if (!swapResponse?.swapTransaction) {
      throw new Error(`TRANSACTION_BUILD_ERROR: Jupiter returned empty swapTransaction for ${validatedQuote.mint}`);
    }

    const rawTxBuffer = Buffer.from(swapResponse.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(rawTxBuffer);

    // Sign the transaction with active wallet keypair
    transaction.sign([kp]);

    return {
      transaction,
      rawTxBuffer: Buffer.from(transaction.serialize()),
      quote: validatedQuote,
      userPublicKey,
      priorityTier,
      maxPriorityFeeLamports: maxLamports,
      buildTimestamp: Date.now(),
    };
  }
}

export const exitTransactionBuilder = ExitTransactionBuilder.getInstance();
