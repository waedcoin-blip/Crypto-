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
import { useBalanceStore, assertTradeBalance } from '../store/balanceStore';
import { walletBalanceService } from './WalletBalanceService';
import { getNetworkConfig } from '../config/network';
import { useAppStore } from '../store/appStore';

import { connectedWalletService } from './connectedWalletService';

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
      const isConnectedWallet = activeWallet.source === 'connected';
      let userPk: PublicKey;
      let kp = activeWallet.keypair;

      if (isConnectedWallet) {
        const verify = connectedWalletService.verifySigner(activeWallet.address);
        if (!verify.valid) {
          throw new Error(`DevnetAmmExecutor failed: ${verify.error}`);
        }
        userPk = new PublicKey(activeWallet.address);
      } else {
        if (!kp) {
          throw new Error('DevnetAmmExecutor failed: Session keypair missing for Devnet transaction.');
        }
        userPk = kp.publicKey;
      }

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
        const targetMintPk = new PublicKey(targetMintStr);
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
      await this.syncStoreBalances(userPk.toBase58(), targetMintStr);

      const landingTimeMs = Date.now() - start;
      const actualFee = 0.000005;
      this.telemetryTotalFeesPaidSol += actualFee;
      this.telemetryLandingTimeTotalMs += landingTimeMs;

      useAppStore.getState().addJupiterLog({
        type: 'INFO',
        message: `Devnet Swap Success: ${sig.slice(0, 8)}... (Slot ${slot})`,
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
