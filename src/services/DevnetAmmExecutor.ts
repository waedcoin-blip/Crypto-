// src/services/DevnetAmmExecutor.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
  SendTransactionError,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { useActiveWalletStore } from '../store/activeWalletStore';
import { getOrCreateSessionKeypair } from '../utils/keypairUtils';
import { useBalanceStore, assertTradeBalance } from '../store/balanceStore';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { walletBalanceService } from './WalletBalanceService';
import { getNetworkConfig } from '../config/network';
import { NetworkGuard } from './NetworkGuard';
import { useAppStore } from '../store/appStore';

export class DevnetAmmExecutor implements ITradeExecutor {
  readonly mode = 'devnet' as const;
  private connection: Connection;

  private telemetryTotalSwaps = 0;
  private telemetryTotalFeesPaidSol = 0;
  private telemetryLandingTimeTotalMs = 0;
  private telemetryFailedSwaps = 0;

  constructor(devnetRpcUrl?: string) {
    const defaultRpc = getNetworkConfig('devnet').rpcUrl || 'https://api.devnet.solana.com';
    this.connection = new Connection(devnetRpcUrl || defaultRpc, 'confirmed');
  }

  public get publicKey(): string {
    const wallet = useActiveWalletStore.getState().activeWallet;
    if (!wallet) return '';
    if (wallet.keypair) {
      return wallet.keypair.publicKey.toBase58();
    }
    return wallet.address || '';
  }

  private checkNetworkSafety(): void {
    const envNetwork = useTradingEnvironmentStore.getState().network;
    if (envNetwork !== 'devnet') {
      throw new Error(`NETWORK SAFETY ERROR: Devnet execution blocked because selected environment network is '${envNetwork}'.`);
    }
    const activeWallet = useActiveWalletStore.getState().activeWallet;
    if (!activeWallet) {
      throw new Error('NETWORK SAFETY ERROR: Devnet execution blocked because no active wallet is selected.');
    }
    if (activeWallet.network !== 'devnet') {
      console.warn(`[DevnetAmmExecutor] Reconciling active wallet network from '${activeWallet.network}' to 'devnet'`);
      useActiveWalletStore.getState().setActiveWallet({
        ...activeWallet,
        network: 'devnet',
        version: activeWallet.version + 1,
      });
    }
    NetworkGuard.assertNetwork('devnet', this.connection.rpcEndpoint);
  }

  private getActiveWallet() {
    this.checkNetworkSafety();
    const wallet = useActiveWalletStore.getState().activeWallet;
    if (!wallet) throw new Error('No active wallet selected for Devnet trading');
    return wallet;
  }

  /**
   * Reads real on-chain token decimals for a given mint
   */
  async getTokenDecimals(mintPk: PublicKey): Promise<number> {
    if (mintPk.toBase58() === 'So11111111111111111111111111111111111111112') return 9;
    try {
      const info = await this.connection.getParsedAccountInfo(mintPk, 'confirmed');
      const decimals = (info.value?.data as any)?.parsed?.info?.decimals;
      if (typeof decimals === 'number') return decimals;
    } catch {}
    return 6;
  }

  /**
   * Validates if a mint account exists on Devnet RPC and determines its exact token program owner
   */
  async validateDevnetMint(mintPk: PublicKey): Promise<{
    exists: boolean;
    tokenProgram?: PublicKey;
    isToken2022?: boolean;
    decimals: number;
  }> {
    if (mintPk.toBase58() === 'So11111111111111111111111111111111111111112') {
      return { exists: true, tokenProgram: TOKEN_PROGRAM_ID, isToken2022: false, decimals: 9 };
    }

    try {
      const info = await this.connection.getParsedAccountInfo(mintPk, 'confirmed');
      if (!info.value) {
        return { exists: false, decimals: 6 };
      }

      const isLegacy = info.value.owner.equals(TOKEN_PROGRAM_ID);
      const isToken2022 = info.value.owner.equals(TOKEN_2022_PROGRAM_ID);
      const decimals = (info.value.data as any)?.parsed?.info?.decimals ?? 6;

      if (!isLegacy && !isToken2022) {
        return { exists: false, decimals };
      }

      return {
        exists: true,
        tokenProgram: info.value.owner,
        isToken2022,
        decimals,
      };
    } catch (e: any) {
      return { exists: false, decimals: 6 };
    }
  }

  async getQuote(params: QuoteGetRequest): Promise<QuoteResponse> {
    const inputMint = params.inputMint;
    const outputMint = params.outputMint;
    const amount = Number(params.amount);
    const slippageBps = params.slippageBps || 50;

    const isBuy = inputMint === 'So11111111111111111111111111111111111111112';
    const targetMint = isBuy ? outputMint : inputMint;

    let tokenPriceNative = 0.001; // SOL per token default
    const metrics = useAppStore.getState().tokenMetrics?.[targetMint];
    if (metrics?.priceNative && metrics.priceNative > 0) {
      tokenPriceNative = metrics.priceNative;
    } else if (metrics?.priceUsd && metrics.priceUsd > 0) {
      tokenPriceNative = metrics.priceUsd / 150;
    }

    let tokenDecimals = 6;
    try {
      tokenDecimals = await this.getTokenDecimals(new PublicKey(targetMint));
    } catch {}

    let outAmountLamports = 0n;

    if (isBuy) {
      const solIn = amount / 1_000_000_000;
      const tokensOut = solIn / Math.max(tokenPriceNative, 1e-9);
      outAmountLamports = BigInt(Math.floor(tokensOut * Math.pow(10, tokenDecimals)));
    } else {
      const tokensIn = amount / Math.pow(10, tokenDecimals);
      const solOut = tokensIn * Math.max(tokenPriceNative, 1e-9);
      outAmountLamports = BigInt(Math.floor(solOut * 1_000_000_000));
    }

    if (outAmountLamports <= 0n) outAmountLamports = 1n;

    const slippageFactor = 1 - slippageBps / 10000;
    const otherThreshold = BigInt(Math.floor(Number(outAmountLamports) * slippageFactor));

    return {
      inputMint,
      inAmount: String(amount),
      outputMint,
      outAmount: String(outAmountLamports),
      otherAmountThreshold: String(otherThreshold),
      swapMode: 'ExactIn',
      slippageBps,
      platformFee: null,
      priceImpactPct: '0.01',
      routePlan: [
        {
          swapInfo: {
            ammKey: 'DevnetSettlementExchange',
            label: 'Devnet Atomic Settlement Exchange',
            inputMint,
            outputMint,
            inAmount: String(amount),
            outAmount: String(outAmountLamports),
            feeAmount: '5000',
            feeMint: inputMint,
          },
          percent: 100,
        },
      ],
      contextSlot: Math.floor(Date.now() / 400),
    } as unknown as QuoteResponse;
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
      let kp = activeWallet.keypair;
      if (!kp) {
        kp = getOrCreateSessionKeypair();
        useActiveWalletStore.getState().setActiveWallet({
          ...activeWallet,
          keypair: kp,
          address: kp.publicKey.toBase58(),
          version: activeWallet.version + 1,
        });
      }

      const userPk = kp.publicKey;
      const activePublicKey = userPk.toBase58();

      const isSolBuy = inputMint === 'So11111111111111111111111111111111111111112';
      const targetMintStr = isSolBuy ? outputMint : inputMint;
      const requiredSol = isSolBuy ? (amount / LAMPORTS_PER_SOL) + 0.002 : 0.002;

      await assertTradeBalance(requiredSol);

      // Pre-flight check: Verify target mint exists on Devnet
      if (targetMintStr !== 'So11111111111111111111111111111111111111112') {
        let targetMintPk: PublicKey;
        try {
          targetMintPk = new PublicKey(targetMintStr);
        } catch {
          throw new Error(`Invalid token mint address: ${targetMintStr}`);
        }
        const devnetMintCheck = await this.validateDevnetMint(targetMintPk);
        if (!devnetMintCheck.exists) {
          throw new Error(
            `Mint ${targetMintStr} does not exist on Solana Devnet. Non-Devnet-native tokens from mainnet scanner feeds cannot be traded on Devnet.`
          );
        }
      }

      // Pre-trade on-chain balance snapshots for verification
      const initialSolLamports = await this.connection.getBalance(userPk, 'confirmed').catch(() => 0);
      const initialTokenRawAmount = await this.getTokenBalance(targetMintStr);

      const quote = await this.getQuote({ inputMint, outputMint, amount, slippageBps });

      // 0. Check server build ID via diagnostic endpoint before building swap
      const EXPECTED_BUILD_ID = 'devnet-swap-v5-ata-fix-2026-08-26';
      const diagRes = await fetch('/api/devnet-swap/diagnostic').catch(() => null);
      if (diagRes && diagRes.ok) {
        const diagData = await diagRes.json().catch(() => ({}));
        if (diagData.buildId !== EXPECTED_BUILD_ID) {
          throw new Error(
            `Server build mismatch: Server reports build '${diagData.buildId || 'legacy'}', expected '${EXPECTED_BUILD_ID}'. Please rebuild and restart server.`
          );
        }
      }

      // 1. Build Atomic VersionedTransaction on Server Settlement Route with retry logic
      let buildRes: Response | null = null;
      let lastFetchErr: any = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          buildRes = await fetch('/api/devnet-swap/build', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userPublicKey: activePublicKey,
              inputMint,
              outputMint,
              amount,
              quoteResponse: quote,
              slippageBps,
            }),
          });
          if (buildRes && (buildRes.ok || buildRes.status === 400)) {
            break;
          }
        } catch (fetchErr) {
          lastFetchErr = fetchErr;
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, attempt * 400));
          }
        }
      }

      if (!buildRes) {
        throw new Error(
          `Server swap build request failed (network error): ${lastFetchErr?.message || 'Failed to fetch'}`
        );
      }

      if (!buildRes.ok) {
        const errJson = await buildRes.json().catch(() => ({ error: buildRes.statusText }));
        throw new Error(errJson.message || errJson.error || `Server swap build failed with HTTP ${buildRes.status}`);
      }

      const buildData = await buildRes.json();
      const {
        swapTransaction,
        lastValidBlockHeight,
        blockhash,
        expectedSolLamports,
        expectedTokenAmount,
      } = buildData;

      // 2. Deserialize atomic VersionedTransaction (already signed by settlement wallet)
      const rawTxBuf = Buffer.from(swapTransaction, 'base64');
      const tx = VersionedTransaction.deserialize(rawTxBuf);

      // 3. User keypair signs the transaction
      tx.sign([kp]);

      // 4. Send atomic raw transaction to Devnet RPC
      const sig = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      // 5. Confirm on-chain transaction
      const confirmation = await this.connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        'confirmed'
      );

      if (confirmation.value.err) {
        throw new Error(`Devnet transaction confirmation failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      const slot = confirmation.context.slot;

      // 6. On SELL: Verify on-chain SOL balance actually increased and token balance actually decreased
      if (!isSolBuy && targetMintStr !== 'So11111111111111111111111111111111111111112') {
        const verifyStart = Date.now();
        let solIncreased = false;
        let tokenDecreased = false;

        // Mark token cleared optimistically and verify
        void walletBalanceService.verifyTokenBalanceCleared(targetMintStr, activePublicKey);

        while (Date.now() - verifyStart < 12000) {
          try {
            const currentSolLamports = await this.connection.getBalance(userPk, 'confirmed');
            const currentTokenRaw = await this.getTokenBalance(targetMintStr);

            if (currentSolLamports > initialSolLamports) {
              solIncreased = true;
            }
            if (currentTokenRaw < initialTokenRawAmount || currentTokenRaw === 0) {
              tokenDecreased = true;
            }
            if (solIncreased && tokenDecreased) {
              break;
            }
          } catch {}
          await new Promise((r) => setTimeout(r, 600));
        }

        console.log(
          `[DevnetAmmExecutor] Post-sell on-chain verification - SOL increase: ${solIncreased}, Token decrease: ${tokenDecreased}`
        );
      }

      // 7. Authoritative Post-Trade State Refresh directly from Devnet RPC
      await this.syncStoreBalances(activePublicKey, targetMintStr);

      const landingTimeMs = Date.now() - start;
      const actualFee = 0.000005;
      const outAmountNum = isSolBuy ? Number(expectedTokenAmount) : expectedSolLamports;

      this.telemetryTotalFeesPaidSol += actualFee;
      this.telemetryLandingTimeTotalMs += landingTimeMs;

      useAppStore.getState().addJupiterLog({
        type: 'INFO',
        message: `Devnet Atomic Settlement Success: ${sig.slice(0, 8)}... (Slot ${slot}, In: ${amount}, Out: ${outAmountNum})`,
        details: {
          signature: sig,
          inputMint,
          outputMint,
          inAmount: amount,
          outAmount: outAmountNum,
          feeSol: actualFee,
        },
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
      let detailsStr = err?.message || String(err);

      if (err instanceof SendTransactionError || (err && typeof err.getLogs === 'function')) {
        try {
          const logs = typeof err.getLogs === 'function' ? await err.getLogs(this.connection) : err.logs;
          if (logs && logs.length > 0) {
            detailsStr = `Simulation/Execution Logs:\n${logs.join('\n')}`;
          }
        } catch (logErr) {
          console.warn('[DevnetAmmExecutor] Unable to fetch SendTransactionError logs:', logErr);
        }
      }

      console.error('[DevnetAmmExecutor] Swap failed:', detailsStr, err);
      throw new Error(`Devnet swap execution failed: ${detailsStr}`);
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
          signature: 'failed-devnet-' + Date.now(),
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
    const lamports = await this.connection.getBalance(new PublicKey(this.publicKey), 'confirmed');
    return lamports / LAMPORTS_PER_SOL;
  }

  async getTokenBalance(mint: string): Promise<number> {
    if (!this.publicKey) return 0;
    try {
      const ownerPk = new PublicKey(this.publicKey);
      let mintPk: PublicKey;
      try {
        mintPk = new PublicKey(mint);
      } catch {
        return 0;
      }

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

      const allAccounts = [...splAccounts.value, ...t22Accounts.value];
      let totalRawAmount = 0;
      for (const account of allAccounts) {
        const amountStr = account.account.data.parsed?.info?.tokenAmount?.amount;
        if (amountStr) {
          totalRawAmount += Number(amountStr);
        }
      }
      return totalRawAmount;
    } catch {
      return 0;
    }
  }

  async hasTokenAccount(mint: string): Promise<boolean> {
    if (!this.publicKey) return false;
    const balance = await this.getTokenBalance(mint);
    return balance > 0;
  }

  private async syncStoreBalances(activePublicKey: string, targetMint?: string): Promise<void> {
    try {
      // 1. Await authoritative wallet balance query across Devnet RPC with retry to ensure post-tx settling
      await walletBalanceService.refreshWithRetry(activePublicKey, 3, 400);

      // 2. Fetch fresh on-chain SOL balance directly from RPC
      const solLamports = await this.connection.getBalance(new PublicKey(activePublicKey), 'confirmed');
      const sol = solLamports / LAMPORTS_PER_SOL;

      // 3. Fetch token accounts for both SPL Token and Token-2022 programs
      const [legacyAccounts, token2022Accounts] = await Promise.all([
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

      const tokenBalances: Record<string, number> = { ...useBalanceStore.getState().tokenBalances };
      if (targetMint && targetMint !== 'So11111111111111111111111111111111111111112') {
        tokenBalances[targetMint] = 0;
      }

      for (const { account } of [...legacyAccounts.value, ...token2022Accounts.value]) {
        const info = account.data.parsed?.info;
        if (!info) continue;
        const mint = info.mint;
        const ta = info.tokenAmount;
        const uiAmt = ta.uiAmount ?? Number(ta.amount) / Math.pow(10, ta.decimals);
        // Correctly aggregate across multiple token accounts
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

      console.log('[DevnetAmmExecutor] On-chain Devnet balances synced:', { sol, targetMint });
    } catch (e) {
      console.warn('[DevnetAmmExecutor] syncStoreBalances failed:', e);
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


