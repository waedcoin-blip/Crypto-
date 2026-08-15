// src/services/RealTradeExecutor.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { HybridExecutionEngine } from './HybridExecutionEngine';
import { BatchExitEngine } from './BatchExitEngine';
import { QuoteGetRequest, QuoteResponse, createJupiterApiClient } from '@jup-ag/api';
import { Connection, LAMPORTS_PER_SOL, PublicKey, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { DEFAULT_HELIUS_RPC } from '../constants/solana';

export interface RealTradeConfig {
  hybridEngine?: HybridExecutionEngine | null;
  batchEngine?: BatchExitEngine | null;
  verbose?: boolean;
}

export class RealTradeExecutor implements ITradeExecutor {
  readonly mode = 'real' as const;
  readonly publicKey: string;

  private hybrid?: HybridExecutionEngine | null;
  private batch?: BatchExitEngine | null;
  private jupiterApi: ReturnType<typeof createJupiterApiClient>;
  private connection: Connection;
  
  // Telemetry state
  private telemetryTotalSwaps = 0;
  private telemetryTotalFeesPaidSol = 0;
  private telemetryLandingTimeTotalMs = 0;
  private telemetryFailedSwaps = 0;

  constructor(config: RealTradeConfig) {
    this.hybrid = config.hybridEngine || null;
    this.batch = config.batchEngine || null;
    this.jupiterApi = createJupiterApiClient({
      basePath: localStorage.getItem('juipter_auto_jupiterRpcUrl') || 'https://api.jup.ag/swap/v1'
    });
    this.connection = new Connection(
      localStorage.getItem('juipter_auto_rpcUrl') || DEFAULT_HELIUS_RPC,
      'confirmed'
    );

    if (this.hybrid && this.hybrid.wallet) {
      this.publicKey = this.hybrid.wallet.publicKey.toBase58();
    } else {
      const savedKey = typeof window !== 'undefined' ? sessionStorage.getItem('matrix_session_key') : null;
      if (savedKey) {
        try {
          const kp = Keypair.fromSecretKey(bs58.decode(savedKey));
          this.publicKey = kp.publicKey.toBase58();
        } catch {
          this.publicKey = '';
        }
      } else {
        this.publicKey = '';
      }
    }
  }

  async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    if (this.hybrid) {
      return this.hybrid.jupiterApi.quoteGet(params);
    }
    return this.jupiterApi.quoteGet(params);
  }

  async swap(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
    label: 'entry' | 'exit_tp' | 'exit_sl' = 'entry'
  ): Promise<SwapResult> {
    const start = Date.now();
    this.telemetryTotalSwaps++;

    try {
      const quote = await this.getQuote({
        inputMint,
        outputMint,
        amount,
        slippageBps,
        restrictIntermediateTokens: true,
      });

      let sig = '';
      let slot = 0;
      let actualFee = 0.000005;

      if (this.hybrid) {
        const swapBuild = await this.hybrid.jupiterApi.swapPost({
          swapRequest: {
            quoteResponse: quote,
            userPublicKey: this.publicKey,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 10_000 as any,
          },
        });

        const txBuf = Buffer.from(swapBuild.swapTransaction, 'base64');
        
        const savedKey = typeof window !== 'undefined' ? sessionStorage.getItem('matrix_session_key') : null;
        if (!savedKey) throw new Error('Hybrid execution failed: No private key available to sign transaction.');
        
        const kp = Keypair.fromSecretKey(bs58.decode(savedKey));
        const tx = VersionedTransaction.deserialize(txBuf);
        tx.sign([kp]);
        
        sig = await this.hybrid.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
        
        const confirmation = await this.hybrid.connection.confirmTransaction({
          signature: sig,
          blockhash: tx.message.recentBlockhash,
          lastValidBlockHeight: swapBuild.lastValidBlockHeight || (await this.hybrid.connection.getLatestBlockhash()).lastValidBlockHeight
        }, 'confirmed');

        if (confirmation.value.err) throw new Error(`Hybrid transaction failed to confirm: ${JSON.stringify(confirmation.value.err)}`);

        slot = confirmation.context.slot;
        actualFee = 0.000005 + (10_000 * 140_000 / 1e15);

      } else {
        const swapBuild = await this.jupiterApi.swapPost({
          swapRequest: {
            quoteResponse: quote,
            userPublicKey: this.publicKey || '11111111111111111111111111111111',
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 10_000 as any,
          },
        });

        const txBuf = Buffer.from(swapBuild.swapTransaction, 'base64');
        const savedKey = typeof window !== 'undefined' ? sessionStorage.getItem('matrix_session_key') : null;
        if (!savedKey) throw new Error('RealTradeExecutor failed: No private key available to sign transaction.');

        const kp = Keypair.fromSecretKey(bs58.decode(savedKey));
        const tx = VersionedTransaction.deserialize(txBuf);
        tx.sign([kp]);
        sig = await this.connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 3
        });

        const confirmation = await this.connection.confirmTransaction({
          signature: sig,
          blockhash: tx.message.recentBlockhash,
          lastValidBlockHeight: swapBuild.lastValidBlockHeight || (await this.connection.getLatestBlockhash()).lastValidBlockHeight
        }, 'confirmed');

        if (confirmation.value.err) throw new Error(`Transaction failed to confirm: ${JSON.stringify(confirmation.value.err)}`);
        
        slot = confirmation.context.slot;
      }

      const landingTimeMs = Date.now() - start;
      this.telemetryTotalFeesPaidSol += actualFee;
      this.telemetryLandingTimeTotalMs += landingTimeMs;

      return {
        signature: sig || 'real-tx-sig',
        inputMint,
        outputMint,
        inputAmount: amount,
        outputAmount: Number(quote.outAmount),
        feeSol: actualFee,
        slot,
        landingTimeMs,
        method: 'rpc',
      };
    } catch (err: any) {
      this.telemetryFailedSwaps++;
      console.error('RealTradeExecutor swap failed:', err);
      throw new Error(`Real Jupiter swap transaction execution failed: ${err.message || String(err)}`);
    }
  }

  async batchSwap(
    swaps: Array<{ inputMint: string; outputMint: string; amount: number; slippageBps: number }>
  ): Promise<SwapResult[]> {
    if (!this.batch) throw new Error('Batch engine not configured');
    
    const positions = swaps.map(s => ({
      mint: s.inputMint,
      amount: s.amount,
      solSpent: 0,
    }));
    
    this.telemetryTotalSwaps += swaps.length;
    const results = await this.batch.batchExit(positions as any);
    
    const mappedResults: SwapResult[] = [];
    
    for (const batchRes of results) {
       this.telemetryLandingTimeTotalMs += batchRes.landingTimeMs;
       this.telemetryTotalFeesPaidSol += batchRes.totalFeesSol;
       this.telemetryFailedSwaps += batchRes.failedMints.length;
       
       for (const posRes of batchRes.perPositionResults) {
          const originalSwap = swaps.find(s => s.inputMint === posRes.mint);
          if (!originalSwap) continue;
          
          if (!posRes.success) {
            mappedResults.push({
              signature: batchRes.signature || ('failed-batch-' + Date.now()),
              inputMint: posRes.mint,
              outputMint: 'So11111111111111111111111111111111111111112',
              inputAmount: originalSwap.amount,
              outputAmount: 0,
              feeSol: 0,
              slot: batchRes.slot || 0,
              landingTimeMs: batchRes.landingTimeMs,
              method: 'rpc',
              error: 'Position failed to swap in batch'
            });
          } else {
            mappedResults.push({
              signature: batchRes.signature,
              inputMint: posRes.mint,
              outputMint: 'So11111111111111111111111111111111111111112',
              inputAmount: originalSwap.amount,
              outputAmount: (posRes.amountReceivedSol || 0) * 1e9,
              feeSol: batchRes.totalFeesSol / batchRes.perPositionResults.filter(p => p.success).length, // approximate fee share
              slot: batchRes.slot,
              landingTimeMs: batchRes.landingTimeMs,
              method: 'rpc',
            });
          }
       }
    }
    
    return mappedResults;
  }

  async getSolBalance(): Promise<number> {
    if (!this.publicKey) return 0;
    try {
      const lamports = await this.connection.getBalance(new PublicKey(this.publicKey));
      return lamports / LAMPORTS_PER_SOL;
    } catch {
      return 0;
    }
  }

  async getTokenBalance(mint: string): Promise<number> {
    if (!this.publicKey) return 0;
    try {
      const accounts = await this.connection.getParsedTokenAccountsByOwner(
        new PublicKey(this.publicKey),
        { mint: new PublicKey(mint) }
      );
      if (accounts.value.length === 0) return 0;
      return Number(accounts.value[0].account.data.parsed.info.tokenAmount.amount);
    } catch {
      return 0;
    }
  }

  async hasTokenAccount(mint: string): Promise<boolean> {
    if (!this.publicKey) return false;
    try {
      const accounts = await this.connection.getParsedTokenAccountsByOwner(
        new PublicKey(this.publicKey),
        { mint: new PublicKey(mint) }
      );
      return accounts.value.length > 0;
    } catch {
      return false;
    }
  }

  getTelemetry(): ExecutorTelemetry {
    return {
      totalSwaps: this.telemetryTotalSwaps,
      totalFeesPaidSol: this.telemetryTotalFeesPaidSol,
      avgLandingTimeMs: this.telemetryTotalSwaps > 0 ? this.telemetryLandingTimeTotalMs / this.telemetryTotalSwaps : 0,
      failureRate: this.telemetryTotalSwaps > 0 ? this.telemetryFailedSwaps / this.telemetryTotalSwaps : 0,
    };
  }
}

