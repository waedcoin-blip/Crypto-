import { useActiveWalletStore } from '../store/activeWalletStore';
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { HybridExecutionEngine } from './HybridExecutionEngine';
import { BatchExitEngine } from './BatchExitEngine';
import { QuoteGetRequest, QuoteResponse, createJupiterApiClient } from '@jup-ag/api';
import { Connection, LAMPORTS_PER_SOL, PublicKey, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { DEFAULT_HELIUS_RPC } from '../constants/solana';
import { getNetworkConfig, TradingNetwork } from '../config/network';
import { NetworkGuard } from './NetworkGuard';
import { assertExecutionEnvironment, assertTradeBalance, useBalanceStore } from '../store/balanceStore';
import { WalletBalanceService, walletBalanceService } from './WalletBalanceService';

export interface RealTradeConfig {
  network?: TradingNetwork;
  hybridEngine?: HybridExecutionEngine | null;
  batchEngine?: BatchExitEngine | null;
  verbose?: boolean;
}

export class RealTradeExecutor implements ITradeExecutor {
  readonly mode: TradingNetwork = 'devnet';

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
    (this as any).mode = this.network;
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
  }

  public get publicKey(): string {
    if (this.hybrid && this.hybrid.wallet) {
      return this.hybrid.wallet.publicKey.toBase58();
    }
    const wallet = useActiveWalletStore.getState().activeWallet;
    if (!wallet) return '';
    if (wallet.keypair) {
      return wallet.keypair.publicKey.toBase58();
    }
    if (wallet.address) {
      return wallet.address;
    }
    return '';
  }

  private getActiveWallet() {
    const wallet = useActiveWalletStore.getState().activeWallet;
    if (!wallet) {
      throw new Error('No active wallet selected');
    }
    return wallet;
  }

  private getActivePublicKey(): string {
    const pk = this.publicKey;
    if (!pk) {
      throw new Error('Active wallet has no valid address');
    }
    return pk;
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
      const isSolBuy = inputMint === 'So11111111111111111111111111111111111111112';

      // Priority 5 Safety Gate: Ensure balance is live and sufficient before trading
      await assertTradeBalance(isSolBuy ? amount / LAMPORTS_PER_SOL : 0.005);

      if (!isSolBuy) {
        const tokenBalance = await this.getTokenBalance(inputMint);
        if (tokenBalance < amount) {
          throw new Error(`Insufficient token balance (Available: ${tokenBalance}, Required: ${amount})`);
        }
      }

      let sig = '';
      let slot = 0;
      let actualFee = 0.000005;
      let outAmountNum = 0;

      const activePublicKey = this.getActivePublicKey();

      if (this.network === 'devnet') {
        // Fetch real Jupiter quote to see if route exists on Devnet (or Mainnet API accessed under Devnet mode)
        const quote = await this.getQuote({
          inputMint,
          outputMint,
          amount,
          slippageBps,
          restrictIntermediateTokens: true,
        }).catch(e => {
          throw new Error(`Devnet swap unavailable: No route found. ${e.message || String(e)}`);
        });

        if (!quote) {
          throw new Error("Devnet swap unavailable: Jupiter returned no quote.");
        }

        const activeWallet = this.getActiveWallet();
        const kp = activeWallet?.keypair;
        if (!kp) throw new Error('RealTradeExecutor failed: No private key available to sign Devnet transaction.');

        const swapBuild = await this.jupiterApi.swapPost({
          swapRequest: {
            quoteResponse: quote,
            userPublicKey: activePublicKey,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 10_000 as any,
          },
        }).catch(e => {
          throw new Error(`Devnet swap unavailable: Failed to build swap transaction. ${e.message || String(e)}`);
        });

        const txBuf = Buffer.from(swapBuild.swapTransaction, 'base64');
        const tx = VersionedTransaction.deserialize(txBuf);
        tx.sign([kp]);

        // Record pre-transaction token and SOL balances
        const targetMint = isSolBuy ? outputMint : inputMint;
        const preTokenBalance = await this.getTokenBalance(targetMint);
        const preSolBalance = await this.getSolBalance();

        sig = await this.connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });

        const confirmation = await this.connection.confirmTransaction({
          signature: sig,
          blockhash: tx.message.recentBlockhash,
          lastValidBlockHeight: swapBuild.lastValidBlockHeight || (await this.connection.getLatestBlockhash()).lastValidBlockHeight
        }, 'confirmed');

        if (confirmation.value.err) {
          throw new Error(`Devnet transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
        }

        slot = confirmation.context.slot;

        // Poll/fetch post-transaction balances to verify exact changes
        let postTokenBalance = preTokenBalance;
        let postSolBalance = preSolBalance;
        let actualTokensChange = 0;

        for (let attempt = 0; attempt < 3; attempt++) {
          postTokenBalance = await this.getTokenBalance(targetMint);
          postSolBalance = await this.getSolBalance();
          actualTokensChange = postTokenBalance - preTokenBalance;
          if (isSolBuy ? actualTokensChange > 0 : actualTokensChange < 0) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Parse confirmed transaction for precise numbers
        let parsedTokensReceived = 0;
        let parsedSolSpent = 0;
        let parsedFee = 0.000005;

        try {
          const txDetails = await this.connection.getParsedTransaction(sig, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed'
          });
          if (txDetails && txDetails.meta) {
            parsedFee = txDetails.meta.fee / LAMPORTS_PER_SOL;
            const accountKeys = txDetails.transaction.message.accountKeys;
            const ourIndex = accountKeys.findIndex(k => k.pubkey.toBase58() === activePublicKey);
            if (ourIndex !== -1) {
              const preBalance = txDetails.meta.preBalances[ourIndex];
              const postBalance = txDetails.meta.postBalances[ourIndex];
              parsedSolSpent = Math.max(0, (preBalance - postBalance) / LAMPORTS_PER_SOL);
            }
            const preTokenBalances = txDetails.meta.preTokenBalances || [];
            const postTokenBalances = txDetails.meta.postTokenBalances || [];
            const ourPreToken = preTokenBalances.find(b => b.owner === activePublicKey && b.mint === targetMint);
            const ourPostToken = postTokenBalances.find(b => b.owner === activePublicKey && b.mint === targetMint);
            const preAmount = ourPreToken ? Number(ourPreToken.uiTokenAmount.amount) : 0;
            const postAmount = ourPostToken ? Number(ourPostToken.uiTokenAmount.amount) : 0;
            parsedTokensReceived = Math.abs(postAmount - preAmount);
          }
        } catch (parseErr) {
          console.warn("Failed to parse transaction for balance changes:", parseErr);
        }

        const finalTokensChange = parsedTokensReceived > 0 ? parsedTokensReceived : Math.abs(actualTokensChange);

        if (finalTokensChange <= 0) {
          throw new Error("TRADE FAILED: Devnet transaction confirmed but expected token balance change was not detected.");
        }

        outAmountNum = finalTokensChange;
        actualFee = parsedFee;

      } else {
        // Mainnet Execution Venue: Jupiter Swap Aggregator API
        const quote = await this.getQuote({
          inputMint,
          outputMint,
          amount,
          slippageBps,
          restrictIntermediateTokens: true,
        });
        outAmountNum = Number(quote.outAmount);

        if (this.hybrid) {
          const swapBuild = await this.hybrid.jupiterApi.swapPost({
            swapRequest: {
              quoteResponse: quote,
              userPublicKey: activePublicKey,
              dynamicComputeUnitLimit: true,
              prioritizationFeeLamports: 10_000 as any,
            },
          });

          const txBuf = Buffer.from(swapBuild.swapTransaction, 'base64');
          
          const activeWallet = this.getActiveWallet();
          const kp = activeWallet?.keypair;
          if (!kp) throw new Error('Hybrid execution failed: No private key available to sign transaction.');
          
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
              userPublicKey: activePublicKey || '11111111111111111111111111111111',
              dynamicComputeUnitLimit: true,
              prioritizationFeeLamports: 10_000 as any,
            },
          });

          const txBuf = Buffer.from(swapBuild.swapTransaction, 'base64');
          const activeWallet = this.getActiveWallet();
          const kp = activeWallet?.keypair;
          if (!kp) throw new Error('RealTradeExecutor failed: No private key available to sign transaction.');

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
      }

      // Authoritative Post-Trade State Refresh
      if (activePublicKey) {
        const isSolBuy = inputMint === 'So11111111111111111111111111111111111111112';
        await this.syncStoreBalances(activePublicKey, isSolBuy ? outputMint : inputMint);
      }

      const landingTimeMs = Date.now() - start;
      this.telemetryTotalFeesPaidSol += actualFee;
      this.telemetryLandingTimeTotalMs += landingTimeMs;

      return {
        signature: sig || 'real-tx-sig',
        inputMint,
        outputMint,
        inputAmount: amount,
        outputAmount: outAmountNum,
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
        { mint: new PublicKey(mint) },
        'confirmed'
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
        { mint: new PublicKey(mint) },
        'confirmed'
      );
      return accounts.value.length > 0;
    } catch {
      return false;
    }
  }

  private async syncStoreBalances(activePublicKey: string, targetMint?: string): Promise<void> {
    try {
      // 1. SOL
      const solLamports = await this.connection.getBalance(new PublicKey(activePublicKey), 'confirmed');
      const sol = solLamports / LAMPORTS_PER_SOL;

      // 2. All tokens (so the store is fully consistent, not just the traded one)
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        new PublicKey(activePublicKey),
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') },
        'confirmed'
      );

      const tokenBalances: Record<string, number> = {};
      for (const { account } of tokenAccounts.value) {
        const info = account.data.parsed.info;
        const mint = info.mint;
        const ta = info.tokenAmount;
        tokenBalances[mint] = ta.uiAmount ?? Number(ta.amount) / Math.pow(10, ta.decimals);
      }

      // 3. Push directly into the reactive store
      const bs = useBalanceStore.getState();
      bs.setOnChainBalance({ solBalance: sol });

      if ('setTokenBalances' in bs && typeof (bs as any).setTokenBalances === 'function') {
        (bs as any).setTokenBalances(tokenBalances);
      } else if ('setTokenBalance' in bs && typeof (bs as any).setTokenBalance === 'function') {
        for (const [mint, bal] of Object.entries(tokenBalances)) {
          (bs as any).setTokenBalance(mint, bal);
        }
      }

      // 4. Also keep the singleton service in sync
      walletBalanceService.refreshNow(activePublicKey);

      if (this.network === 'devnet') {
        console.log('[RealTradeExecutor] Balances synced:', {
          sol,
          targetMint,
          targetBalance: targetMint ? tokenBalances[targetMint] : undefined,
        });
      }
    } catch (e) {
      console.warn('[RealTradeExecutor] syncStoreBalances failed:', e);
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

