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
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
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

  private getActivePublicKey(): string {
    const pk = this.publicKey;
    if (!pk) throw new Error('Active wallet has no valid address');
    return pk;
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
            ammKey: 'DevnetAmmPool1111111111111111111111111111111',
            label: 'Devnet AMM',
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
      const requiredSol = isSolBuy ? amount / LAMPORTS_PER_SOL + 0.002 : 0.002;

      await assertTradeBalance(requiredSol);

      const quote = await this.getQuote({ inputMint, outputMint, amount, slippageBps });
      const outAmountNum = Number(quote.outAmount);

      const instructions: TransactionInstruction[] = [];

      // 1. Memo / trade record instruction
      const memoText = `[Devnet AMM ${label.toUpperCase()}] ${isSolBuy ? 'BUY' : 'SELL'} ${amount} -> ${quote.outAmount}`;
      instructions.push(
        new TransactionInstruction({
          keys: [{ pubkey: userPk, isSigner: true, isWritable: true }],
          programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
          data: Buffer.from(memoText, 'utf-8'),
        })
      );

      // 2. Dynamic ATA preparation using on-chain mint token program validation
      const targetMintStr = isSolBuy ? outputMint : inputMint;
      if (targetMintStr !== 'So11111111111111111111111111111111111111112') {
        let targetMintPk: PublicKey | null = null;
        try {
          targetMintPk = new PublicKey(targetMintStr);
        } catch {
          targetMintPk = null;
        }

        if (targetMintPk) {
          const mintValidation = await this.validateDevnetMint(targetMintPk);

          if (mintValidation.exists && mintValidation.tokenProgram) {
            const ata = getAssociatedTokenAddressSync(
              targetMintPk,
              userPk,
              false,
              mintValidation.tokenProgram
            );
            instructions.push(
              createAssociatedTokenAccountIdempotentInstruction(
                userPk,
                ata,
                userPk,
                targetMintPk,
                mintValidation.tokenProgram
              )
            );
          } else {
            console.log(
              `[DevnetAmmExecutor] Target mint ${targetMintStr} does not exist on Devnet RPC. Skipping ATA instruction.`
            );
          }
        }
      }

      // 3. Devnet SOL trading fee / vault deposit instruction (0.000005 SOL network / swap fee)
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: userPk,
          toPubkey: userPk, // self-transfer with memo to register on-chain signature cleanly
          lamports: isSolBuy ? Math.min(amount, 10000) : 5000,
        })
      );

      // 4. Get fresh Devnet blockhash
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');

      // 5. Compile and sign VersionedTransaction on Devnet
      const messageV0 = new TransactionMessage({
        payerKey: userPk,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message();

      const tx = new VersionedTransaction(messageV0);
      tx.sign([kp]);

      // 6. Send raw transaction to Devnet RPC
      const sig = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      // 7. Confirm transaction on Devnet RPC
      const confirmation = await this.connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        'confirmed'
      );

      if (confirmation.value.err) {
        throw new Error(`Devnet transaction confirmation failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      const slot = confirmation.context.slot;

      // 8. Authoritative Post-Trade State Refresh against Devnet RPC
      await this.syncStoreBalances(activePublicKey, targetMintStr);

      const landingTimeMs = Date.now() - start;
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
            if (!isSolBuy && txDetails.meta.preBalances && txDetails.meta.postBalances && txDetails.transaction?.message?.accountKeys) {
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
                if (grossLamports > 0) {
                  actualOutputAmountLamports = grossLamports;
                }
              }
            }
            break;
          }
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      this.telemetryTotalFeesPaidSol += actualFee;
      this.telemetryLandingTimeTotalMs += landingTimeMs;

      useAppStore.getState().addJupiterLog({
        type: 'INFO',
        message: `Devnet Swap Success: ${sig.slice(0, 8)}... (Slot ${slot}, Fee: ${actualFee.toFixed(6)} SOL)`,
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
