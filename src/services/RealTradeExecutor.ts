// src/services/RealTradeExecutor.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { HybridExecutionEngine } from './HybridExecutionEngine';
import { BatchExitEngine } from './BatchExitEngine';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

export interface RealTradeConfig {
  hybridEngine: HybridExecutionEngine;
  batchEngine?: BatchExitEngine;
  verbose?: boolean;
}

export class RealTradeExecutor implements ITradeExecutor {
  readonly mode = 'real' as const;
  readonly publicKey: string;

  private hybrid: HybridExecutionEngine;
  private batch?: BatchExitEngine;

  constructor(config: RealTradeConfig) {
    this.hybrid = config.hybridEngine;
    this.batch = config.batchEngine;
    this.publicKey = this.hybrid.wallet.publicKey.toBase58();
  }

  async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    return this.hybrid.jupiterApi.quoteGet(params);
  }

  async swap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
    label: 'entry' | 'exit_tp' | 'exit_sl' = 'entry'
  ): Promise<SwapResult> {
    const start = Date.now();

    if (inputMint === 'So11111111111111111111111111111111111111112') {
      // Entry: SOL -> Token (simple RPC swap)
      const quote = await this.getQuote({
        inputMint,
        outputMint,
        amount,
        slippageBps,
        restrictIntermediateTokens: true,
      });

      const swapBuild = await this.hybrid.jupiterApi.swapPost({
        swapRequest: {
          quoteResponse: quote,
          userPublicKey: this.publicKey,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 10_000 as any,
        },
      });

      // Submit transaction via Hybrid connection
      const txBuf = Buffer.from(swapBuild.swapTransaction, 'base64');
      const sig = await this.hybrid.connection.sendRawTransaction(txBuf, { skipPreflight: true });

      return {
        signature: sig || 'real-tx-sig',
        inputMint,
        outputMint,
        inputAmount: amount,
        outputAmount: Number(quote.outAmount),
        feeSol: 0.000005 + (10_000 * 140_000 / 1e15),
        slot: 0,
        landingTimeMs: Date.now() - start,
        method: 'rpc',
      };
    }

    // Exits use bracket engine or hybrid atomic exit
    throw new Error('Real exits should use evaluateBracket via TradeManager');
  }

  async batchSwap(
    swaps: Array<{ inputMint: string; outputMint: string; amount: number; slippageBps: number }>
  ): Promise<SwapResult[]> {
    if (!this.batch) throw new Error('Batch engine not configured');
    return [];
  }

  async getSolBalance(): Promise<number> {
    const lamports = await this.hybrid.connection.getBalance(this.hybrid.wallet.publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  async getTokenBalance(mint: string): Promise<number> {
    const accounts = await this.hybrid.connection.getParsedTokenAccountsByOwner(
      this.hybrid.wallet.publicKey,
      { mint: new PublicKey(mint) }
    );
    if (accounts.value.length === 0) return 0;
    return Number(accounts.value[0].account.data.parsed.info.tokenAmount.amount);
  }

  async hasTokenAccount(mint: string): Promise<boolean> {
    const accounts = await this.hybrid.connection.getParsedTokenAccountsByOwner(
      this.hybrid.wallet.publicKey,
      { mint: new PublicKey(mint) }
    );
    return accounts.value.length > 0;
  }

  getTelemetry(): ExecutorTelemetry {
    return { totalSwaps: 0, totalFeesPaidSol: 0, avgLandingTimeMs: 0, failureRate: 0 };
  }
}
