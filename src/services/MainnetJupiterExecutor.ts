// src/services/MainnetJupiterExecutor.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { QuoteGetRequest, QuoteResponse, createJupiterApiClient } from '@jup-ag/api';
import { Connection, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { DEFAULT_HELIUS_RPC } from '../constants/solana';
import { getNetworkConfig } from '../config/network';
import { useActiveWalletStore } from '../store/activeWalletStore';
import { useBalanceStore, assertTradeBalance } from '../store/balanceStore';
import { walletBalanceService } from './WalletBalanceService';
import { useAppStore } from '../store/appStore';
import { connectedWalletService } from './connectedWalletService';

export class MainnetJupiterExecutor implements ITradeExecutor {
  readonly mode = 'mainnet' as const;
  private connection: Connection;
  private jupiterApi: ReturnType<typeof createJupiterApiClient>;

  private telemetryTotalSwaps = 0;
  private telemetryTotalFeesPaidSol = 0;
  private telemetryLandingTimeTotalMs = 0;
  private telemetryFailedSwaps = 0;

  constructor(mainnetRpcUrl?: string) {
    const defaultRpc = getNetworkConfig('mainnet').rpcUrl || DEFAULT_HELIUS_RPC;
    const rpcUrl = mainnetRpcUrl || localStorage.getItem('juipter_auto_rpcUrl') || defaultRpc;
    this.connection = new Connection(rpcUrl, 'confirmed');
    
    const jupUrl = localStorage.getItem('juipter_auto_jupiterRpcUrl') || 'https://api.jup.ag/swap/v1';
    this.jupiterApi = createJupiterApiClient({ basePath: jupUrl });
  }

  public get publicKey(): string {
    const wallet = useActiveWalletStore.getState().activeWallet;
    if (!wallet) return '';
    if (wallet.keypair) {
      return wallet.keypair.publicKey.toBase58();
    }
    return wallet.address || '';
  }

  private getActiveWallet() {
    const wallet = useActiveWalletStore.getState().activeWallet;
    if (!wallet || (!wallet.address && !wallet.keypair)) {
      throw new Error('No active wallet selected for Mainnet trading');
    }
    return wallet;
  }

  private getActivePublicKey(): string {
    const pk = this.publicKey;
    if (!pk) throw new Error('Active wallet has no valid address');
    return pk;
  }

  async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
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
      const activeWallet = this.getActiveWallet();
      const isConnectedWallet = activeWallet.source === 'connected';
      let activePublicKey = activeWallet.address;
      let kp = activeWallet.keypair;

      if (isConnectedWallet) {
        const verify = connectedWalletService.verifySigner(activeWallet.address);
        if (!verify.valid) {
          throw new Error(`MainnetJupiterExecutor failed: ${verify.error}`);
        }
        activePublicKey = activeWallet.address;
      } else {
        if (!kp) {
          throw new Error('MainnetJupiterExecutor failed: Session keypair missing for Mainnet transaction.');
        }
        activePublicKey = kp.publicKey.toBase58();
      }

      const isSolBuy = inputMint === 'So11111111111111111111111111111111111111112';

      await assertTradeBalance(isSolBuy ? amount / LAMPORTS_PER_SOL + 0.005 : 0.005);

      if (!isSolBuy) {
        const tokenBalance = await this.getTokenBalance(inputMint);
        if (tokenBalance < amount) {
          throw new Error(`Insufficient token balance for exit (Available: ${tokenBalance}, Required: ${amount})`);
        }
      }

      // Fetch quote from Mainnet Jupiter API
      const quote = await this.getQuote({
        inputMint,
        outputMint,
        amount,
        slippageBps,
        restrictIntermediateTokens: true,
      });

      if (!quote) {
        throw new Error('Jupiter Mainnet returned no quote.');
      }

      const outAmountNum = Number(quote.outAmount);

      // Post swap request with properly formatted prioritizationFeeLamports object
      const swapBuild = await this.jupiterApi.swapPost({
        swapRequest: {
          quoteResponse: quote,
          userPublicKey: activePublicKey,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
              priorityLevel: 'medium',
              maxLamports: 100000,
              global: false,
            },
          } as any,
        },
      });

      const txBuf = Buffer.from(swapBuild.swapTransaction, 'base64');
      const tx = VersionedTransaction.deserialize(txBuf);

      let sig: string;

      if (isConnectedWallet) {
        const connectedSigner = connectedWalletService.getSigner()!;
        if (connectedSigner.signTransaction) {
          const signedTx = await connectedSigner.signTransaction(tx);
          sig = await this.connection.sendRawTransaction(signedTx.serialize(), {
            skipPreflight: false,
            maxRetries: 3,
          });
        } else if (connectedSigner.sendTransaction) {
          sig = await connectedSigner.sendTransaction(tx, this.connection);
        } else {
          throw new Error('Connected browser wallet does not support transaction signing or sending.');
        }
      } else {
        tx.sign([kp!]);
        sig = await this.connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });
      }

      const confirmation = await this.connection.confirmTransaction(
        {
          signature: sig,
          blockhash: tx.message.recentBlockhash,
          lastValidBlockHeight: swapBuild.lastValidBlockHeight || (await this.connection.getLatestBlockhash()).lastValidBlockHeight,
        },
        'confirmed'
      );

      if (confirmation.value.err) {
        throw new Error(`Mainnet transaction confirmation failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      const slot = confirmation.context.slot;
      const targetMint = isSolBuy ? outputMint : inputMint;

      await this.syncStoreBalances(activePublicKey, targetMint);

      const landingTimeMs = Date.now() - start;
      const actualFee = 0.000005;
      this.telemetryTotalFeesPaidSol += actualFee;
      this.telemetryLandingTimeTotalMs += landingTimeMs;

      useAppStore.getState().addJupiterLog({
        type: 'INFO',
        message: `Mainnet Swap Success: ${sig.slice(0, 8)}... (Slot ${slot})`,
        details: { signature: sig, inputMint, outputMint, inAmount: amount, outAmount: outAmountNum },
      });

      return {
        signature: sig,
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
      console.error('[MainnetJupiterExecutor] Swap failed:', err);
      throw new Error(`Mainnet Jupiter swap execution failed: ${err.message || String(err)}`);
    }
  }

  async batchSwap(
    swaps: Array<{ inputMint: string; outputMint: string; amount: number; slippageBps: number }>
  ): Promise<SwapResult[]> {
    const results: SwapResult[] = [];
    for (const s of swaps) {
      try {
        const res = await this.swap(s.inputMint, s.outputMint, s.amount, s.slippageBps, 'exit_tp');
        results.push(res);
      } catch (err: any) {
        results.push({
          signature: 'failed-mainnet-' + Date.now(),
          inputMint: s.inputMint,
          outputMint: s.outputMint,
          inputAmount: s.amount,
          outputAmount: 0,
          feeSol: 0,
          slot: 0,
          landingTimeMs: 0,
          method: 'rpc',
          error: err.message || String(err),
        });
      }
    }
    return results;
  }

  async getSolBalance(): Promise<number> {
    if (!this.publicKey) return 0;
    try {
      const lamports = await this.connection.getBalance(new PublicKey(this.publicKey), 'confirmed');
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
      const solLamports = await this.connection.getBalance(new PublicKey(activePublicKey), 'confirmed');
      const sol = solLamports / LAMPORTS_PER_SOL;

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

      const bs = useBalanceStore.getState();
      bs.setOnChainBalance({ solBalance: sol });
      if ('setTokenBalances' in bs && typeof (bs as any).setTokenBalances === 'function') {
        (bs as any).setTokenBalances(tokenBalances);
      } else if ('setTokenBalance' in bs && typeof (bs as any).setTokenBalance === 'function') {
        for (const [m, bal] of Object.entries(tokenBalances)) {
          (bs as any).setTokenBalance(m, bal);
        }
      }

      walletBalanceService.refreshNow(activePublicKey);
    } catch (e) {
      console.warn('[MainnetJupiterExecutor] syncStoreBalances failed:', e);
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
