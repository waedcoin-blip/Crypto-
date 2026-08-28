// src/services/MainnetJupiterExecutor.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { QuoteGetRequest, QuoteResponse, createJupiterApiClient } from '@jup-ag/api';
import { Connection, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { DEFAULT_HELIUS_RPC } from '../constants/solana';
import { getNetworkConfig } from '../config/network';
import { NetworkGuard } from './NetworkGuard';
import { useActiveWalletStore } from '../store/activeWalletStore';
import { getOrCreateSessionKeypair } from '../utils/keypairUtils';
import { useBalanceStore, assertTradeBalance } from '../store/balanceStore';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { walletBalanceService } from './WalletBalanceService';
import { useAppStore } from '../store/appStore';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

export class MainnetJupiterExecutor implements ITradeExecutor {
  readonly mode = 'mainnet' as const;
  private connection!: Connection;
  private jupiterApi!: ReturnType<typeof createJupiterApiClient>;
  private currentRpcUrl: string = '';

  private telemetryTotalSwaps = 0;
  private telemetryTotalFeesPaidSol = 0;
  private telemetryLandingTimeTotalMs = 0;
  private telemetryFailedSwaps = 0;

  constructor(mainnetRpcUrl?: string) {
    this.updateConnection(mainnetRpcUrl);
  }

  private updateConnection(mainnetRpcUrl?: string) {
    const defaultRpc = getNetworkConfig('mainnet').rpcUrl || DEFAULT_HELIUS_RPC;
    const rpcUrl = mainnetRpcUrl || localStorage.getItem('juipter_auto_rpcUrl') || localStorage.getItem('rpc_url') || defaultRpc;
    if (!this.connection || this.currentRpcUrl !== rpcUrl) {
      this.currentRpcUrl = rpcUrl;
      this.connection = new Connection(rpcUrl, 'confirmed');
    }
    
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

  private async checkNetworkSafety(): Promise<void> {
    this.updateConnection();
    const envNetwork = useTradingEnvironmentStore.getState().network;
    if (envNetwork !== 'mainnet') {
      throw new Error(`NETWORK SAFETY ERROR: Mainnet execution blocked because selected environment network is '${envNetwork}'.`);
    }
    const activeWallet = useActiveWalletStore.getState().activeWallet;
    if (!activeWallet) {
      throw new Error('NETWORK SAFETY ERROR: Mainnet execution blocked because no active wallet is selected.');
    }
    if (activeWallet.network !== 'mainnet') {
      throw new Error(`NETWORK SAFETY ERROR: Mainnet execution blocked. Active wallet is configured for '${activeWallet.network}', not 'mainnet'. Explicitly switch your wallet network to mainnet before executing mainnet trades.`);
    }
    NetworkGuard.assertNetwork('mainnet', this.connection.rpcEndpoint);
    await NetworkGuard.verifyGenesisHash('mainnet', this.connection.rpcEndpoint);
  }

  private validateQuoteSafety(quote: QuoteResponse, inputAmount: number, slippageBps: number): void {
    if (inputAmount <= 0 || !isFinite(inputAmount)) {
      throw new Error(`INVALID_SWAP_AMOUNT: Amount must be positive and finite (got: ${inputAmount}).`);
    }
    if (slippageBps > 1000) {
      throw new Error(`EXCESSIVE_SLIPPAGE: Slippage BPS ${slippageBps} exceeds maximum allowable limit of 1000 (10%).`);
    }
    if (!quote) {
      throw new Error('QUOTE_SAFETY_ERROR: Jupiter returned empty quote.');
    }
    if (!quote.outAmount || BigInt(quote.outAmount) <= 0n) {
      throw new Error('QUOTE_SAFETY_ERROR: Jupiter returned zero or negative output amount.');
    }
    if (!quote.routePlan || quote.routePlan.length === 0) {
      throw new Error('QUOTE_SAFETY_ERROR: Jupiter returned no executable routes.');
    }
    const impact = parseFloat(String(quote.priceImpactPct || '0')) * 100;
    if (impact > 10.0) {
      throw new Error(`QUOTE_SAFETY_ERROR: Excessive price impact (${impact.toFixed(2)}%) exceeds safety threshold of 10.0%.`);
    }
  }

  private async getActiveWallet() {
    await this.checkNetworkSafety();
    const wallet = useActiveWalletStore.getState().activeWallet;
    if (!wallet) throw new Error('No active wallet selected for Mainnet trading');
    return wallet;
  }

  private getActivePublicKey(): string {
    const pk = this.publicKey;
    if (!pk) throw new Error('Active wallet has no valid address');
    return pk;
  }

  async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    await this.checkNetworkSafety();
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
      await this.checkNetworkSafety();
      const activeWallet = await this.getActiveWallet();
      let kp = activeWallet.keypair;
      if (!kp) {
        kp = getOrCreateSessionKeypair();
      }
      if (!kp) {
        throw new Error('KEYPAIR_REQUIRED: Active mainnet wallet does not contain a signing private key. Please connect or import your mainnet wallet private key in Settings.');
      }

      const userPk = kp.publicKey;
      const activePublicKey = userPk.toBase58();
      const isSolBuy = inputMint === 'So11111111111111111111111111111111111111112';

      await assertTradeBalance(isSolBuy ? amount / LAMPORTS_PER_SOL + 0.005 : 0.005);

      if (!isSolBuy) {
        const tokenBalance = await this.getTokenBalance(inputMint);
        if (tokenBalance < amount) {
          throw new Error(`Insufficient token balance for exit (Available: ${tokenBalance}, Required: ${amount})`);
        }
      }

      // Fetch fresh quote from Mainnet Jupiter API
      const quote = await this.getQuote({
        inputMint,
        outputMint,
        amount,
        slippageBps,
        restrictIntermediateTokens: true,
      });

      this.validateQuoteSafety(quote, amount, slippageBps);

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
      tx.sign([kp]);

      const sig = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

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

      // Query actual transaction fee and on-chain balance deltas from confirmed transaction metadata with retries
      let actualFee = 0.000005;
      let actualOutputAmountLamports = outAmountNum;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const txDetails = await this.connection.getParsedTransaction(sig, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          });
          if (txDetails?.meta) {
            if (txDetails.meta.fee !== undefined) {
              actualFee = txDetails.meta.fee / LAMPORTS_PER_SOL;
            }
            // For token -> SOL swaps (SELL), extract the exact gross on-chain SOL balance change from transaction metadata
            if (isSolBuy && txDetails.meta.preTokenBalances && txDetails.meta.postTokenBalances) {
              const preTok = txDetails.meta.preTokenBalances.find((b: any) => b.mint === outputMint && b.owner === activePublicKey);
              const postTok = txDetails.meta.postTokenBalances.find((b: any) => b.mint === outputMint && b.owner === activePublicKey);
              const preAmount = preTok?.uiTokenAmount?.amount ? BigInt(preTok.uiTokenAmount.amount) : 0n;
              const postAmount = postTok?.uiTokenAmount?.amount ? BigInt(postTok.uiTokenAmount.amount) : 0n;
              const delta = postAmount - preAmount;
              if (delta > 0n) {
                actualOutputAmountLamports = Number(delta);
              }
            } else if (!isSolBuy && txDetails.meta.preBalances && txDetails.meta.postBalances && txDetails.transaction?.message?.accountKeys) {
              const keys = txDetails.transaction.message.accountKeys;
              const userIdx = keys.findIndex((k: any) => {
                const pk = typeof k === 'string' ? k : (k?.pubkey?.toBase58 ? k.pubkey.toBase58() : String(k?.pubkey || ''));
                return pk === activePublicKey;
              });
              if (userIdx !== -1 && txDetails.meta.preBalances[userIdx] !== undefined && txDetails.meta.postBalances[userIdx] !== undefined) {
                const preBal = txDetails.meta.preBalances[userIdx];
                const postBal = txDetails.meta.postBalances[userIdx];
                const feeLamports = (userIdx === 0 && txDetails.meta.fee) ? txDetails.meta.fee : 0;
                const grossLamports = postBal - preBal + feeLamports;
                // Only accept account delta if it is within 20% of quote output to exclude rent refunds
                if (grossLamports > 0 && outAmountNum > 0 && Math.abs(grossLamports - outAmountNum) / outAmountNum <= 0.20) {
                  actualOutputAmountLamports = grossLamports;
                }
              }
            }
            break;
          }
        } catch (fErr) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      this.telemetryTotalFeesPaidSol += actualFee;
      this.telemetryLandingTimeTotalMs += landingTimeMs;

      useAppStore.getState().addJupiterLog({
        type: 'INFO',
        message: `Mainnet Swap Success: ${sig.slice(0, 8)}... (Slot ${slot}, Fee: ${actualFee.toFixed(6)} SOL)`,
        details: { signature: sig, inputMint, outputMint, inAmount: amount, outAmount: actualOutputAmountLamports, feeSol: actualFee },
      });

      return {
        signature: sig,
        inputMint,
        outputMint,
        inputAmount: amount,
        outputAmount: actualOutputAmountLamports,
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
    swaps: Array<{ inputMint: string; outputMint: string; amount: number; slippageBps: number; label?: 'entry' | 'exit_tp' | 'exit_sl' }>
  ): Promise<SwapResult[]> {
    await this.checkNetworkSafety();
    const results: SwapResult[] = [];
    for (const s of swaps) {
      try {
        const res = await this.swap(s.inputMint, s.outputMint, s.amount, s.slippageBps, s.label || 'exit_tp');
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
    } catch (err) {
      throw new Error(`Mainnet getSolBalance RPC failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getTokenBalance(mint: string): Promise<number> {
    if (!this.publicKey) return 0;
    const ownerPk = new PublicKey(this.publicKey);
    const mintPk = new PublicKey(mint);

    const [splAccounts, t22Accounts] = await Promise.all([
      this.connection.getParsedTokenAccountsByOwner(
        ownerPk,
        { mint: mintPk, programId: TOKEN_PROGRAM_ID },
        'confirmed'
      ),
      this.connection.getParsedTokenAccountsByOwner(
        ownerPk,
        { mint: mintPk, programId: TOKEN_2022_PROGRAM_ID },
        'confirmed'
      ).catch(() => ({ value: [] })),
    ]);

    const allAccounts = [...splAccounts.value, ...t22Accounts.value];
    let totalRawAmount = 0;
    for (const account of allAccounts) {
      const amountStr = account.account.data.parsed?.info?.tokenAmount?.amount;
      if (amountStr) {
        totalRawAmount += Number(amountStr);
      }
    }
    return totalRawAmount;
  }

  async hasTokenAccount(mint: string): Promise<boolean> {
    if (!this.publicKey) return false;
    const balance = await this.getTokenBalance(mint);
    return balance > 0;
  }

  private async syncStoreBalances(activePublicKey: string, targetMint?: string): Promise<void> {
    try {
      const solLamports = await this.connection.getBalance(new PublicKey(activePublicKey), 'confirmed');
      const sol = solLamports / LAMPORTS_PER_SOL;

      const [splAccounts, t22Accounts] = await Promise.all([
        this.connection.getParsedTokenAccountsByOwner(
          new PublicKey(activePublicKey),
          { programId: TOKEN_PROGRAM_ID },
          'confirmed'
        ).catch(() => ({ value: [] })),
        this.connection.getParsedTokenAccountsByOwner(
          new PublicKey(activePublicKey),
          { programId: TOKEN_2022_PROGRAM_ID },
          'confirmed'
        ).catch(() => ({ value: [] })),
      ]);

      const tokenBalances: Record<string, number> = {};
      for (const { account } of [...splAccounts.value, ...t22Accounts.value]) {
        const info = account.data.parsed?.info;
        if (!info) continue;
        const mint = info.mint;
        const ta = info.tokenAmount;
        const uiAmt = ta.uiAmount ?? Number(ta.amount) / Math.pow(10, ta.decimals);
        tokenBalances[mint] = (tokenBalances[mint] || 0) + uiAmt;
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
