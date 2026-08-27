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
import { devnetShadowMintCache } from './devnetShadowMintCache';
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
      throw new Error(`NETWORK SAFETY ERROR: Devnet execution blocked. Active wallet is configured for '${activeWallet.network}', not 'devnet'. Explicitly switch your wallet network to devnet before executing devnet trades.`);
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
    const slippageBps = Math.max(0, Math.min(5000, Number(params.slippageBps || 50)));
    const isBuy = inputMint === 'So11111111111111111111111111111111111111112';
    const targetMint = isBuy ? outputMint : inputMint;
    const diag = await fetch('/api/devnet-swap/diagnostic').then((r) => r.ok ? r.json() : null).catch(() => null);
    const tokenPriceNative = Number(diag?.tokenPriceNative);

    if (!Number.isFinite(tokenPriceNative) || tokenPriceNative <= 0) {
      throw new Error('Invalid Devnet token price configuration');
    }

    const tokenDecimals = await this.getTokenDecimals(new PublicKey(targetMint));
    const outAmount = isBuy
      ? BigInt(Math.max(1, Math.floor((amount / LAMPORTS_PER_SOL / tokenPriceNative) * 10 ** tokenDecimals)))
      : BigInt(Math.max(1, Math.floor((Number(amount) / 10 ** tokenDecimals) * tokenPriceNative * LAMPORTS_PER_SOL)));
    const threshold = BigInt(Math.max(1, Math.floor(Number(outAmount) * (1 - slippageBps / 10000))));

    return {
      inputMint,
      inAmount: String(amount),
      outputMint,
      outAmount: outAmount.toString(),
      otherAmountThreshold: threshold.toString(),
      swapMode: 'ExactIn',
      slippageBps,
      platformFee: null,
      priceImpactPct: '0',
      routePlan: [{
        swapInfo: {
          ammKey: 'DevnetSettlementExchange',
          label: 'Devnet Settlement (SPL transfer)',
          inputMint,
          outputMint,
          inAmount: String(amount),
          outAmount: outAmount.toString(),
          feeAmount: '5000',
          feeMint: inputMint,
        },
        percent: 100,
      }],
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
      const kp = activeWallet.keypair;
      if (!kp) {
        throw new Error('KEYPAIR_REQUIRED: Active devnet wallet does not contain a signing private key. Please connect/import your devnet keypair.');
      }

      const userPk = kp.publicKey;
      const activePublicKey = userPk.toBase58();

      const isSolBuy = inputMint === 'So11111111111111111111111111111111111111112';
      const targetMintStr = isSolBuy ? outputMint : inputMint;
      const requiredSol = isSolBuy ? (amount / LAMPORTS_PER_SOL) + 0.002 : 0.0003;

      await assertTradeBalance(requiredSol);

      // Pre-flight check: Ensure shadow mint cache initialized
      await devnetShadowMintCache.ensureInitialized();

      // Pre-trade on-chain balance snapshots for verification
      const initialSolLamports = await this.connection.getBalance(userPk, 'confirmed').catch(() => 0);
      const initialTokenRawAmount = await this.getTokenBalance(targetMintStr);

      const quote = await this.getQuote({ inputMint, outputMint, amount, slippageBps });

      // 0. Check server build ID via diagnostic endpoint before building swap
      const EXPECTED_BUILD_ID = 'devnet-swap-v11-no-ata-two-wallets-2026-08-26';
      const diagRes = await fetch('/api/devnet-swap/diagnostic').catch(() => null);
      if (diagRes && diagRes.ok) {
        const diagData = await diagRes.json().catch(() => ({}));
        if (diagData.buildId !== EXPECTED_BUILD_ID) {
          throw new Error(
            `Server build mismatch: Server reports build '${diagData.buildId || 'legacy'}', expected '${EXPECTED_BUILD_ID}'. Please rebuild and restart server.`
          );
        }
        if (diagData.associatedTokenProgramAllowed !== false || diagData.tokenAccountCreationMethod !== 'system-create-account-plus-spl-initialize-account') {
          throw new Error('Devnet safety check failed: server does not guarantee ATA-free token account creation.');
        }
        if (!diagData.settlementAddress) {
          throw new Error('Devnet safety check failed: settlement wallet is not initialized on server.');
        }
        if (diagData.settlementAddress === activePublicKey) {
          throw new Error('Devnet safety check failed: settlement wallet must be different from the active user wallet.');
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
      if (buildData.shadowMint) {
        devnetShadowMintCache.register(buildData.shadowMint);
      }
      const {
        swapTransaction,
        lastValidBlockHeight,
        blockhash,
        expectedSolLamports,
        expectedTokenAmount,
      } = buildData;
      if (buildData.userPublicKey !== activePublicKey) {
        throw new Error('Devnet build returned a different user wallet than the active wallet.');
      }
      if (!buildData.settlementPublicKey || buildData.settlementPublicKey === activePublicKey) {
        throw new Error('Devnet build returned an invalid settlement wallet.');
      }

      // 2. Deserialize atomic VersionedTransaction (already signed by settlement wallet)
      const rawTxBuf = Buffer.from(swapTransaction, 'base64');
      const tx = VersionedTransaction.deserialize(rawTxBuf);

      // 3. User keypair signs the transaction if listed as a required signer in the message header
      const requiredSigners = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
      const isUserSignerRequired = requiredSigners.some((k) => k.equals(kp.publicKey));
      if (isUserSignerRequired) {
        tx.sign([kp]);
      }

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

      // 6. Verify exact Devnet balance effects. A successful signature alone is not enough.
      const expectedSol = Number(expectedSolLamports);
      const expectedToken = Number(expectedTokenAmount);
      if (isSolBuy) {
        const verifyStart = Date.now();
        let verified = false;
        while (Date.now() - verifyStart < 12000) {
          const currentTokenRaw = await this.getTokenBalance(targetMintStr);
          if (currentTokenRaw >= initialTokenRawAmount + expectedToken) {
            verified = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!verified) throw new Error('Devnet BUY confirmed on-chain but expected token balance increase was not observed.');
      } else {
        const verifyStart = Date.now();
        let verified = false;
        while (Date.now() - verifyStart < 12000) {
          const currentSolLamports = await this.connection.getBalance(userPk, 'confirmed');
          const currentTokenRaw = await this.getTokenBalance(targetMintStr);
          const solDelta = currentSolLamports - initialSolLamports;
          const tokenDelta = initialTokenRawAmount - currentTokenRaw;
          if (tokenDelta >= expectedToken && solDelta >= Math.max(0, expectedSol - 10000)) {
            verified = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!verified) throw new Error('Devnet SELL confirmed on-chain but exact token/SOL balance effects were not verified.');
      }

      // 7. Authoritative Post-Trade State Refresh directly from Devnet RPC
      await this.syncStoreBalances(activePublicKey, targetMintStr);

      const landingTimeMs = Date.now() - start;
      const actualFee = 0.000005;
      const outAmountNum = isSolBuy ? Number(expectedTokenAmount) : Number(expectedSolLamports);

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
      const devnetMintStr = devnetShadowMintCache.resolveDevnetMint(mint);
      let mintPk: PublicKey;
      try {
        mintPk = new PublicKey(devnetMintStr);
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
    } catch (err: any) {
      throw new Error(`Devnet token balance RPC failed: ${err?.message || err}`);
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
        const rawMint = info.mint;
        const mappedMint = devnetShadowMintCache.resolveMainnetMint(rawMint);
        const ta = info.tokenAmount;
        const uiAmt = ta.uiAmount ?? Number(ta.amount) / Math.pow(10, ta.decimals);
        // Correctly aggregate across multiple token accounts
        tokenBalances[mappedMint] = (tokenBalances[mappedMint] || 0) + uiAmt;
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


