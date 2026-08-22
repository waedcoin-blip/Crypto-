// src/services/DevnetAmmExecutor.ts
import { ITradeExecutor, SwapResult, ExecutorTelemetry } from './ITradeExecutor';
import { QuoteGetRequest, QuoteResponse } from '@jup-ag/api';
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  SendTransactionError,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import { useActiveWalletStore } from '../store/activeWalletStore';
import { useBalanceStore, assertTradeBalance } from '../store/balanceStore';
import { walletBalanceService } from './WalletBalanceService';
import { getNetworkConfig } from '../config/network';
import { useAppStore } from '../store/appStore';

// Authoritative Pump.fun / PumpSwap program constants
const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_GLOBAL = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
const PUMP_FEE_RECIPIENT = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');
const PUMP_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
const SYSVAR_RENT_PUBKEY = new PublicKey('SysvarRent111111111111111111111111111111111');

// Raydium Devnet AMM Program ID
const RAYDIUM_DEVNET_AMM_ID = new PublicKey('HWySuSbtHGHXtxWhbm92ENKXQcrTRyZoKBNdNLMQdMQ5');

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

  private getActiveWallet() {
    const wallet = useActiveWalletStore.getState().activeWallet;
    if (!wallet) throw new Error('No active wallet selected for Devnet trading');
    return wallet;
  }

  private getActivePublicKey(): string {
    const pk = this.publicKey;
    if (!pk) throw new Error('Active wallet has no valid address');
    return pk;
  }

  /**
   * Derive Pump.fun / PumpSwap bonding curve PDA for a given mint
   */
  public getBondingCurvePda(mintPk: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mintPk.toBuffer()],
      PUMP_FUN_PROGRAM_ID
    );
  }

  /**
   * Validates if a mint account exists on Devnet RPC and determines its exact token program owner
   */
  async validateDevnetMint(mintPk: PublicKey): Promise<{
    exists: boolean;
    tokenProgram?: PublicKey;
    isToken2022?: boolean;
  }> {
    if (mintPk.toBase58() === 'So11111111111111111111111111111111111111112') {
      return { exists: true, tokenProgram: TOKEN_PROGRAM_ID, isToken2022: false };
    }

    try {
      const info = await this.connection.getAccountInfo(mintPk, 'confirmed');
      if (!info) {
        return { exists: false };
      }

      const isLegacy = info.owner.equals(TOKEN_PROGRAM_ID);
      const isToken2022 = info.owner.equals(TOKEN_2022_PROGRAM_ID);

      if (!isLegacy && !isToken2022) {
        console.warn(`[DevnetAmmExecutor] Unrecognized owner for mint ${mintPk.toBase58()}: ${info.owner.toBase58()}`);
        return { exists: false };
      }

      return {
        exists: true,
        tokenProgram: info.owner,
        isToken2022,
      };
    } catch (e: any) {
      console.warn(`[DevnetAmmExecutor] Failed to query mint info for ${mintPk.toBase58()}:`, e?.message || e);
      return { exists: false };
    }
  }

  /**
   * Check if an active on-chain liquidity pool or bonding curve exists for a mint on Devnet
   */
  async checkDevnetLiquiditySource(mintPk: PublicKey): Promise<{
    type: 'pump_bonding' | 'raydium_amm' | 'none';
    bondingCurvePda?: PublicKey;
    tokenProgram: PublicKey;
  }> {
    const mintValidation = await this.validateDevnetMint(mintPk);
    const tokenProgram = mintValidation.tokenProgram || TOKEN_PROGRAM_ID;

    if (!mintValidation.exists) {
      return { type: 'none', tokenProgram };
    }

    try {
      const [bondingCurvePda] = this.getBondingCurvePda(mintPk);
      const curveInfo = await this.connection.getAccountInfo(bondingCurvePda, 'confirmed');

      if (curveInfo && curveInfo.owner.equals(PUMP_FUN_PROGRAM_ID)) {
        return {
          type: 'pump_bonding',
          bondingCurvePda,
          tokenProgram,
        };
      }

      // Check for standard Raydium Devnet AMM pool
      const [raydiumPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('amm_associated_seed'), mintPk.toBuffer()],
        RAYDIUM_DEVNET_AMM_ID
      );
      const raydiumInfo = await this.connection.getAccountInfo(raydiumPoolPda, 'confirmed');
      if (raydiumInfo) {
        return {
          type: 'raydium_amm',
          tokenProgram,
        };
      }

      return { type: 'none', tokenProgram, bondingCurvePda };
    } catch {
      return { type: 'none', tokenProgram };
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
            ammKey: 'PumpSwapDevnet111111111111111111111111111111',
            label: 'PumpSwap Devnet Adapter',
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
      const kp = activeWallet.keypair;
      if (!kp) {
        throw new Error('DevnetAmmExecutor failed: Active wallet private key is missing for on-chain Devnet signing.');
      }

      const activePublicKey = this.getActivePublicKey();
      const userPk = kp.publicKey;

      const isSolBuy = inputMint === 'So11111111111111111111111111111111111111112';
      const targetMintStr = isSolBuy ? outputMint : inputMint;
      const targetMintPk = new PublicKey(targetMintStr);

      const requiredSol = isSolBuy ? amount / LAMPORTS_PER_SOL + 0.002 : 0.002;
      await assertTradeBalance(requiredSol);

      // Validate on-chain mint and bonding curve existence on Devnet
      const liquiditySource = await this.checkDevnetLiquiditySource(targetMintPk);

      if (liquiditySource.type === 'none') {
        throw new Error(
          `Devnet PumpSwap swap rejected: No active Pump.fun bonding curve or Raydium AMM pool is deployed on Solana Devnet for mint ${targetMintStr}. Devnet fail-closed protection prevents generating unbacked transactions.`
        );
      }

      const tokenProgram = liquiditySource.tokenProgram;
      const [bondingCurvePda] = this.getBondingCurvePda(targetMintPk);
      const associatedBondingCurve = getAssociatedTokenAddressSync(
        targetMintPk,
        bondingCurvePda,
        true,
        tokenProgram
      );
      const userAta = getAssociatedTokenAddressSync(
        targetMintPk,
        userPk,
        false,
        tokenProgram
      );

      const preTradeTokenBalance = await this.getTokenBalance(targetMintStr).catch(() => 0);

      const quote = await this.getQuote({ inputMint, outputMint, amount, slippageBps });
      const outAmountNum = Number(quote.outAmount);

      const instructions: TransactionInstruction[] = [];

      // 1. Create User ATA if not existing
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          userPk,
          userAta,
          userPk,
          targetMintPk,
          tokenProgram
        )
      );

      // 2. Build actual Pump.fun / PumpSwap Buy or Sell instruction
      if (isSolBuy) {
        const outAmountBigInt = BigInt(Math.floor(outAmountNum));
        const maxSolCost = BigInt(Math.floor(amount * (1 + slippageBps / 10000)));

        // Discriminator for Buy: [102, 6, 61, 18, 1, 218, 235, 234]
        const buyData = Buffer.alloc(24);
        buyData.set([102, 6, 61, 18, 1, 218, 235, 234], 0);
        buyData.writeBigUInt64LE(outAmountBigInt, 8);
        buyData.writeBigUInt64LE(maxSolCost, 16);

        instructions.push(
          new TransactionInstruction({
            programId: PUMP_FUN_PROGRAM_ID,
            keys: [
              { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
              { pubkey: PUMP_FEE_RECIPIENT, isSigner: false, isWritable: true },
              { pubkey: targetMintPk, isSigner: false, isWritable: false },
              { pubkey: bondingCurvePda, isSigner: false, isWritable: true },
              { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
              { pubkey: userAta, isSigner: false, isWritable: true },
              { pubkey: userPk, isSigner: true, isWritable: true },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
              { pubkey: tokenProgram, isSigner: false, isWritable: false },
              { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
              { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
              { pubkey: PUMP_FUN_PROGRAM_ID, isSigner: false, isWritable: false },
            ],
            data: buyData,
          })
        );
      } else {
        const tokenAmountToSell = BigInt(Math.floor(amount));
        const minSolOutput = BigInt(Math.floor(outAmountNum * (1 - slippageBps / 10000)));

        // Discriminator for Sell: [51, 230, 133, 164, 1, 127, 131, 173]
        const sellData = Buffer.alloc(24);
        sellData.set([51, 230, 133, 164, 1, 127, 131, 173], 0);
        sellData.writeBigUInt64LE(tokenAmountToSell, 8);
        sellData.writeBigUInt64LE(minSolOutput, 16);

        instructions.push(
          new TransactionInstruction({
            programId: PUMP_FUN_PROGRAM_ID,
            keys: [
              { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
              { pubkey: PUMP_FEE_RECIPIENT, isSigner: false, isWritable: true },
              { pubkey: targetMintPk, isSigner: false, isWritable: false },
              { pubkey: bondingCurvePda, isSigner: false, isWritable: true },
              { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
              { pubkey: userAta, isSigner: false, isWritable: true },
              { pubkey: userPk, isSigner: true, isWritable: true },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
              { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
              { pubkey: tokenProgram, isSigner: false, isWritable: false },
              { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
              { pubkey: PUMP_FUN_PROGRAM_ID, isSigner: false, isWritable: false },
            ],
            data: sellData,
          })
        );
      }

      // 3. Fetch fresh blockhash
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');

      // 4. Compile and sign VersionedTransaction on Devnet
      const messageV0 = new TransactionMessage({
        payerKey: userPk,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message();

      const tx = new VersionedTransaction(messageV0);
      tx.sign([kp]);

      // 5. Send raw transaction to Devnet RPC
      const sig = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      // 6. Confirm transaction on Devnet RPC
      const confirmation = await this.connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        'confirmed'
      );

      if (confirmation.value.err) {
        throw new Error(`Devnet transaction confirmation failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      const slot = confirmation.context.slot;

      // 7. Authoritative Post-Trade State Refresh against Devnet RPC
      await this.syncStoreBalances(activePublicKey, targetMintStr);

      const postTradeTokenBalance = await this.getTokenBalance(targetMintStr);
      if (isSolBuy && postTradeTokenBalance <= preTradeTokenBalance) {
        throw new Error(`Devnet trade rejected: Transaction confirmed but token balance did not increase. (Pre: ${preTradeTokenBalance}, Post: ${postTradeTokenBalance})`);
      } else if (!isSolBuy && postTradeTokenBalance >= preTradeTokenBalance && amount > 0) {
        throw new Error(`Devnet trade rejected: Transaction confirmed but token balance did not decrease. (Pre: ${preTradeTokenBalance}, Post: ${postTradeTokenBalance})`);
      }

      const landingTimeMs = Date.now() - start;
      const actualFee = 0.000005;
      this.telemetryTotalFeesPaidSol += actualFee;
      this.telemetryLandingTimeTotalMs += landingTimeMs;

      useAppStore.getState().addJupiterLog({
        type: 'INFO',
        message: `Devnet PumpSwap Success: ${sig.slice(0, 8)}... (Slot ${slot})`,
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
      let totalAmount = 0;
      for (const { account } of accounts.value) {
        totalAmount += Number(account.data.parsed.info.tokenAmount.amount);
      }
      return totalAmount;
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

  async getConfirmedSolDelta(signature: string): Promise<number | null> {
    if (!signature || signature.startsWith('simulated') || signature.startsWith('mock') || signature === 'exit-tx' || signature === 'recovered-exit-tx') {
      return null;
    }
    const pubkeyStr = this.publicKey;
    if (!pubkeyStr) return null;

    try {
      // 1. Try getParsedTransaction first
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      if (tx && tx.meta && tx.meta.preBalances && tx.meta.postBalances) {
        const accountKeys = tx.transaction.message.accountKeys;
        const idx = accountKeys.findIndex((acc: any) => {
          const key = typeof acc === 'string' ? acc : (acc.pubkey ? acc.pubkey.toBase58() : '');
          return key === pubkeyStr;
        });

        if (idx !== -1) {
          const preLamports = tx.meta.preBalances[idx];
          const postLamports = tx.meta.postBalances[idx];
          return (postLamports - preLamports) / LAMPORTS_PER_SOL;
        }
      }

      // 2. Fallback to raw getTransaction
      const rawTx = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      if (rawTx && rawTx.meta && rawTx.meta.preBalances && rawTx.meta.postBalances) {
        const staticKeys = rawTx.transaction.message.staticAccountKeys;
        let idx = staticKeys ? staticKeys.findIndex(pk => pk.toBase58() === pubkeyStr) : -1;

        if (idx === -1 && rawTx.meta.loadedAddresses) {
          const { writable, readonly } = rawTx.meta.loadedAddresses;
          const allKeys = [...(staticKeys || []), ...(writable || []), ...(readonly || [])];
          idx = allKeys.findIndex(pk => (typeof pk === 'string' ? pk : pk.toBase58()) === pubkeyStr);
        }

        if (idx !== -1) {
          const preLamports = rawTx.meta.preBalances[idx];
          const postLamports = rawTx.meta.postBalances[idx];
          return (postLamports - preLamports) / LAMPORTS_PER_SOL;
        }
      }

      return null;
    } catch (err) {
      console.warn(`[DevnetAmmExecutor] Error fetching confirmed tx delta for ${signature}:`, err);
      return null;
    }
  }

  private async syncStoreBalances(activePublicKey: string, targetMint?: string): Promise<void> {
    try {
      const solLamports = await this.connection.getBalance(new PublicKey(activePublicKey), 'confirmed');
      const sol = solLamports / LAMPORTS_PER_SOL;

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

      const tokenBalances: Record<string, number> = {};
      for (const { account } of [...legacyAccounts.value, ...token2022Accounts.value]) {
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
