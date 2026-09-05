// src/services/MainnetJupiterExecutor.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry, ExecutionError, ExecutionFailureClassification } from './ITradeExecutor';
import { JupiterTransactionReplay, classifyExecutionError } from './JupiterTransactionReplay';
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
import { getTokenBalanceRaw, percentOfRawAmount } from './jupiterService';

import { rpcRouting } from './rpcRouting';

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
  private lastFailureReason?: string;

  constructor(mainnetRpcUrl?: string) {
    this.updateConnection(mainnetRpcUrl);
  }

  private updateConnection(mainnetRpcUrl?: string) {
    const rpcUrl = mainnetRpcUrl || rpcRouting.getExecutionRpcUrl();
    if (!this.connection || this.currentRpcUrl !== rpcUrl) {
      this.currentRpcUrl = rpcUrl;
      this.connection = new Connection(rpcUrl, 'confirmed');
    }
    
    const jupUrl = (typeof process !== 'undefined' ? process.env.JUPITER_API_URL : undefined) || 'https://api.jup.ag/swap/v1';
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
    JupiterTransactionReplay.validateInitialQuote({
      quote,
      inputAmount,
      slippageBps,
      maxPriceImpactPct: 10.0,
    });
  }

  private async getActiveWallet() {
    await this.checkNetworkSafety();
    const wallet = useActiveWalletStore.getState().activeWallet;
    if (!wallet) throw new ExecutionError('transaction_failure', 'No active wallet selected for Mainnet trading');
    return wallet;
  }

  private getActivePublicKey(): string {
    const pk = this.publicKey;
    if (!pk) throw new ExecutionError('transaction_failure', 'Active wallet has no valid address');
    return pk;
  }

  async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    await this.checkNetworkSafety();
    try {
      const quote = await this.jupiterApi.quoteGet(params);
      if (!quote) {
        throw new ExecutionError('quote_failure', 'Jupiter returned empty quote.');
      }
      return quote;
    } catch (err: any) {
      const classification = classifyExecutionError(err);
      throw new ExecutionError(classification, `Jupiter getQuote failed: ${err.message || String(err)}`);
    }
  }

  async swap(
    inputMint: string,
    outputMint: string,
    amount: number | string | bigint,
    slippageBps: number,
    label: 'entry' | 'exit_tp' | 'exit_sl' | 'MAX_HOLD' | 'MANUAL' | 'FORCE_EXIT' | string = 'entry',
    preValidatedQuote?: QuoteResponse | null
  ): Promise<SwapResult> {
    const start = Date.now();
    this.telemetryTotalSwaps++;

    try {
      await this.checkNetworkSafety();
      const activeWallet = await this.getActiveWallet();
      
      // 🔴 Mainnet wallet/keypair identity enforcement: No automatic/generated signer for real trades
      const kp = activeWallet.keypair;
      if (!kp) {
        throw new ExecutionError(
          'transaction_failure',
          'KEYPAIR_REQUIRED: Active mainnet wallet does not contain a signing private key. Real mainnet trades require an explicit private key imported in Settings. Automatic key generation is disabled.'
        );
      }

      const activePublicKey = kp.publicKey.toBase58();
      if (activeWallet.address && activeWallet.address !== activePublicKey) {
        throw new ExecutionError(
          'transaction_failure',
          `KEYPAIR_IDENTITY_MISMATCH: Keypair public key (${activePublicKey.slice(0, 8)}...) does not match active wallet address (${activeWallet.address.slice(0, 8)}...). Execution aborted.`
        );
      }

      const isSolBuy = inputMint === 'So11111111111111111111111111111111111111112';
      const numAmount = typeof amount === 'bigint' ? Number(amount) : Number(amount);
      const strAmount = typeof amount === 'bigint' ? amount.toString() : (typeof amount === 'string' ? amount : String(Math.trunc(amount)));

      const endpoint = isSolBuy ? '/api/trading/buy' : '/api/trading/sell';
      const body = isSolBuy ? {
        network: 'mainnet',
        mint: outputMint,
        amountSol: numAmount / LAMPORTS_PER_SOL,
        slippageBps,
        clientRequestId: `mainnet_buy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        label,
      } : {
        network: 'mainnet',
        mint: inputMint,
        amountRaw: strAmount,
        slippageBps,
        clientRequestId: `mainnet_sell_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        reason: label,
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new ExecutionError('transaction_failure', data.error || 'Mainnet server execution failed');
      }

      const sig = data.signature;
      const targetMint = isSolBuy ? outputMint : inputMint;
      this.syncStoreBalances(activePublicKey, targetMint).catch(e => console.warn('[MainnetJupiterExecutor] syncStoreBalances non-blocking error:', e));
      const landingTimeMs = Date.now() - start;

      const outAmountRaw = Number(data.result?.outAmountRaw || data.outAmountRaw || 0);
      return {
        signature: sig,
        inputMint,
        outputMint,
        inputAmount: numAmount,
        outputAmount: outAmountRaw,
        feeSol: 0.000005,
        slot: 0,
        landingTimeMs,
        method: 'rpc',
      };
    } catch (err: any) {
      const classification = classifyExecutionError(err);
      this.telemetryFailedSwaps++;
      this.lastFailureReason = `[${classification}] ${err.message || String(err)}`;
      console.error(`[MainnetJupiterExecutor] [${classification}] Swap failed:`, err);
      throw new ExecutionError(classification, `Mainnet Jupiter swap execution failed: ${err.message || String(err)}`);
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
    const ownerPk = new PublicKey(this.publicKey);
    const mintPk = new PublicKey(mint);

    const [splAccounts, t22Accounts] = await Promise.all([
      this.connection.getParsedTokenAccountsByOwner(
        ownerPk,
        { mint: mintPk, programId: TOKEN_PROGRAM_ID },
        'confirmed'
      ).catch(() => ({ value: [] })),
      this.connection.getParsedTokenAccountsByOwner(
        ownerPk,
        { mint: mintPk, programId: TOKEN_2022_PROGRAM_ID },
        'confirmed'
      ).catch(() => ({ value: [] })),
    ]);

    return splAccounts.value.length > 0 || t22Accounts.value.length > 0;
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
    const totalAttempted = this.telemetryTotalSwaps + this.telemetryFailedSwaps;
    return {
      totalSwaps: this.telemetryTotalSwaps,
      totalFeesPaidSol: this.telemetryTotalFeesPaidSol,
      avgLandingTimeMs: this.telemetryTotalSwaps > 0 ? this.telemetryLandingTimeTotalMs / this.telemetryTotalSwaps : 0,
      failureRate: totalAttempted > 0 ? this.telemetryFailedSwaps / totalAttempted : 0,
      lastFailure: this.lastFailureReason,
    };
  }
}
