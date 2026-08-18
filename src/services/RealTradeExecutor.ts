// src/services/RealTradeExecutor.ts
import { getKeypairFromPrivateKey, getSavedSessionKeypair } from '../utils/keypairUtils';
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { HybridExecutionEngine } from './HybridExecutionEngine';
import { BatchExitEngine } from './BatchExitEngine';
import { QuoteGetRequest, QuoteResponse, createJupiterApiClient } from '@jup-ag/api';
import { Connection, LAMPORTS_PER_SOL, PublicKey, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { DEFAULT_HELIUS_RPC } from '../constants/solana';
import { getNetworkConfig, TradingNetwork } from '../config/network';
import { NetworkGuard } from './NetworkGuard';
import { assertExecutionEnvironment, assertTradeBalance } from '../store/balanceStore';

export interface RealTradeConfig {
  network?: TradingNetwork;
  hybridEngine?: HybridExecutionEngine | null;
  batchEngine?: BatchExitEngine | null;
  verbose?: boolean;
}

export class RealTradeExecutor implements ITradeExecutor {
  public mode: TradingNetwork = 'devnet';
  public publicKey: string = '';
  private keypair: Keypair | null = null;

  private network: TradingNetwork;
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
    this.network = config.network || (localStorage.getItem('app_trading_network') as TradingNetwork) || 'devnet';
    this.mode = this.network;
    this.hybrid = config.hybridEngine || null;
    this.batch = config.batchEngine || null;
    
    const netConfig = getNetworkConfig(this.network);
    const rpcUrl = this.network === 'devnet' 
      ? netConfig.rpcUrl 
      : (localStorage.getItem('juipter_auto_rpcUrl') || netConfig.rpcUrl || DEFAULT_HELIUS_RPC);

    NetworkGuard.assertNetwork(this.network, rpcUrl);
    assertExecutionEnvironment(this.network, rpcUrl);

    this.jupiterApi = createJupiterApiClient({
      basePath: localStorage.getItem('juipter_auto_jupiterRpcUrl') || 'https://api.jup.ag/swap/v1'
    });
    this.connection = new Connection(rpcUrl, 'confirmed');

    if (this.hybrid && this.hybrid.wallet) {
      this.keypair = this.hybrid.wallet;
      this.publicKey = this.hybrid.wallet.publicKey.toBase58();
    } else {
      const kp = getSavedSessionKeypair();
      if (kp) {
        this.keypair = kp;
        this.publicKey = kp.publicKey.toBase58();
      } else {
        this.keypair = null;
        this.publicKey = '';
      }
    }
  }

  public setWallet(keypair: Keypair | null, network?: TradingNetwork) {
    this.keypair = keypair;
    this.publicKey = keypair ? keypair.publicKey.toBase58() : '';

    if (network && network !== this.network) {
      this.network = network;
      this.mode = network;
      const netConfig = getNetworkConfig(this.network);
      const rpcUrl = this.network === 'devnet' 
        ? netConfig.rpcUrl 
        : (localStorage.getItem('juipter_auto_rpcUrl') || netConfig.rpcUrl || DEFAULT_HELIUS_RPC);
      NetworkGuard.assertNetwork(this.network, rpcUrl);
      this.connection = new Connection(rpcUrl, 'confirmed');
    }

    if (this.hybrid) {
      this.hybrid.setWallet(keypair);
    }
    if (this.batch) {
      this.batch.setWallet(keypair);
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
      // Priority Safety Gate: Ensure balance is live and sufficient before trading
      await assertTradeBalance(inputMint === 'So11111111111111111111111111111111111111112' ? amount / LAMPORTS_PER_SOL : 0.005);

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

      const kp = this.keypair || getSavedSessionKeypair();
      const currentPubkey = kp ? kp.publicKey.toBase58() : this.publicKey;

      if (!kp) {
        throw new Error('RealTradeExecutor failed: No active private key available to sign transaction.');
      }

      if (this.hybrid) {
        const swapBuild = await this.hybrid.jupiterApi.swapPost({
          swapRequest: {
            quoteResponse: quote,
            userPublicKey: currentPubkey || kp.publicKey.toBase58(),
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 10_000 as any,
          },
        });

        const txBuf = Buffer.from(swapBuild.swapTransaction, 'base64');
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
            userPublicKey: currentPubkey || kp.publicKey.toBase58(),
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 10_000 as any,
          },
        });

        const txBuf = Buffer.from(swapBuild.swapTransaction, 'base64');
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
      throw err;
    }
  }

  async batchSwap(
    swaps: {
      inputMint: string;
      outputMint: string;
      amount: number;
      slippageBps: number;
      label?: 'entry' | 'exit_tp' | 'exit_sl';
    }[]
  ): Promise<SwapResult[]> {
    if (!this.batch) {
      const results: SwapResult[] = [];
      for (const s of swaps) {
        results.push(await this.swap(s.inputMint, s.outputMint, s.amount, s.slippageBps, s.label));
      }
      return results;
    }

    const microPositions = swaps.map(s => ({
      mint: s.inputMint,
      amount: s.amount,
      solSpent: 0,
    }));

    const results = await this.batch.batchExit(microPositions);
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
              feeSol: batchRes.totalFeesSol / Math.max(1, batchRes.perPositionResults.filter(p => p.success).length),
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
    const address = this.publicKey || (this.keypair ? this.keypair.publicKey.toBase58() : '');
    if (!address) return 0;
    try {
      const lamports = await this.connection.getBalance(new PublicKey(address));
      return lamports / LAMPORTS_PER_SOL;
    } catch {
      return 0;
    }
  }

  async getTokenBalance(mint: string): Promise<number> {
    const address = this.publicKey || (this.keypair ? this.keypair.publicKey.toBase58() : '');
    if (!address) return 0;
    try {
      const accounts = await this.connection.getParsedTokenAccountsByOwner(
        new PublicKey(address),
        { mint: new PublicKey(mint) }
      );
      if (accounts.value.length === 0) return 0;
      return Number(accounts.value[0].account.data.parsed.info.tokenAmount.amount);
    } catch {
      return 0;
    }
  }

  async hasTokenAccount(mint: string): Promise<boolean> {
    const address = this.publicKey || (this.keypair ? this.keypair.publicKey.toBase58() : '');
    if (!address) return false;
    try {
      const accounts = await this.connection.getParsedTokenAccountsByOwner(
        new PublicKey(address),
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
