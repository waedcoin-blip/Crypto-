// src/services/JupiterTransactionFixture.ts
import { Connection, ParsedTransactionWithMeta, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { QuoteResponse } from '@jup-ag/api';
import { ExecutionError } from './ITradeExecutor';
import { JupiterTransactionReplay, ReplayReceiptResult } from './JupiterTransactionReplay';

export interface JupiterCapturedFixture {
  signature: string;
  userWallet: string;
  slot: number;
  blockTime: number | null;
  inputMint: string;
  outputMint: string;
  isSolBuy: boolean;
  actualFeeSol: number;
  transactionMeta: {
    err: any;
    fee: number;
    logMessages?: string[] | null;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: any[] | null;
    postTokenBalances?: any[] | null;
  };
  detectedJupiterEvidence: {
    hasJupiterProgram: boolean;
    programIds: string[];
    logsContainJupiter: boolean;
  };
  originalQuoteSnapshot?: QuoteResponse | null;
  capturedAt: string;
}

export interface ReplayCapturedFixtureResult {
  signature: string;
  verified: boolean;
  actualFeeSol: number;
  actualOutputAmount: number;
  originalQuoteSnapshotPresent: boolean;
  slippageThresholdChecked: boolean;
  otherAmountThreshold?: number;
}

export class JupiterTransactionFixtureService {
  /**
   * Read-only capture of a confirmed Solana transaction into a fixture structure.
   * Does NOT sign or submit any transactions.
   */
  static async captureTransaction(params: {
    connection: Connection;
    signature: string;
    userWallet: string;
    originalQuoteSnapshot?: QuoteResponse | null;
  }): Promise<JupiterCapturedFixture> {
    const { connection, signature, userWallet, originalQuoteSnapshot } = params;

    const txDetails: ParsedTransactionWithMeta | null = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!txDetails || !txDetails.meta) {
      throw new ExecutionError(
        'receipt_failure',
        `FAILED_TO_FETCH_TRANSACTION: No parsed transaction found for signature: ${signature}`
      );
    }

    // Inspect program IDs and logs for Jupiter evidence
    const accountKeys = txDetails.transaction.message.accountKeys.map((k: any) =>
      typeof k === 'string' ? k : (k?.pubkey?.toBase58 ? k.pubkey.toBase58() : String(k?.pubkey || ''))
    );
    const logs = txDetails.meta.logMessages || [];
    const JUPITER_PROGRAM_ID = 'JUP6LkbZbjS1jKKwapdHNy74bheuvzS44Ff2qG31941';
    const JUPITER_V4_PROGRAM_ID = 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB';

    const hasJupiterProgram = accountKeys.some((k) => k === JUPITER_PROGRAM_ID || k === JUPITER_V4_PROGRAM_ID);
    const logsContainJupiter = logs.some((l) => l.toLowerCase().includes('jup') || l.includes(JUPITER_PROGRAM_ID));

    // Determine inputMint and outputMint from pre/post token balances or SOL
    let inputMint = 'So11111111111111111111111111111111111111112';
    let outputMint = 'So11111111111111111111111111111111111111112';
    let isSolBuy = true;

    const userPreTokens = (txDetails.meta.preTokenBalances || []).filter((b: any) => b.owner === userWallet);
    const userPostTokens = (txDetails.meta.postTokenBalances || []).filter((b: any) => b.owner === userWallet);

    const tokenMints = new Set<string>();
    userPreTokens.forEach((b: any) => b.mint && tokenMints.add(b.mint));
    userPostTokens.forEach((b: any) => b.mint && tokenMints.add(b.mint));

    let detectedSplMint = '';
    for (const mint of tokenMints) {
      if (mint !== 'So11111111111111111111111111111111111111112') {
        detectedSplMint = mint;
        break;
      }
    }

    if (originalQuoteSnapshot) {
      inputMint = originalQuoteSnapshot.inputMint;
      outputMint = originalQuoteSnapshot.outputMint;
      isSolBuy = inputMint === 'So11111111111111111111111111111111111111112';
    } else if (detectedSplMint) {
      const preTok = userPreTokens.find((b: any) => b.mint === detectedSplMint);
      const postTok = userPostTokens.find((b: any) => b.mint === detectedSplMint);
      const preAmt = preTok?.uiTokenAmount?.amount ? BigInt(preTok.uiTokenAmount.amount) : 0n;
      const postAmt = postTok?.uiTokenAmount?.amount ? BigInt(postTok.uiTokenAmount.amount) : 0n;

      if (postAmt > preAmt) {
        // SOL -> Token
        inputMint = 'So11111111111111111111111111111111111111112';
        outputMint = detectedSplMint;
        isSolBuy = true;
      } else {
        // Token -> SOL
        inputMint = detectedSplMint;
        outputMint = 'So11111111111111111111111111111111111111112';
        isSolBuy = false;
      }
    }

    const actualFeeSol = (txDetails.meta.fee || 5000) / LAMPORTS_PER_SOL;

    return {
      signature,
      userWallet,
      slot: txDetails.slot,
      blockTime: txDetails.blockTime || null,
      inputMint,
      outputMint,
      isSolBuy,
      actualFeeSol,
      transactionMeta: {
        err: txDetails.meta.err,
        fee: txDetails.meta.fee,
        logMessages: txDetails.meta.logMessages,
        preBalances: txDetails.meta.preBalances,
        postBalances: txDetails.meta.postBalances,
        preTokenBalances: txDetails.meta.preTokenBalances,
        postTokenBalances: txDetails.meta.postTokenBalances,
      },
      detectedJupiterEvidence: {
        hasJupiterProgram,
        programIds: accountKeys.filter((k) => k.startsWith('JUP') || k.toLowerCase().includes('jup')),
        logsContainJupiter,
      },
      originalQuoteSnapshot: originalQuoteSnapshot || null,
      capturedAt: new Date().toISOString(),
    };
  }

  /**
   * Converts a captured fixture directly into deterministic replay verification.
   * Enforces original quote presence when verifying slippage thresholds.
   * If originalQuoteSnapshot is missing, threshold replay is explicitly rejected.
   */
  static replayCapturedFixture(
    fixture: JupiterCapturedFixture,
    options: { requireQuoteSnapshot?: boolean } = { requireQuoteSnapshot: true }
  ): ReplayCapturedFixtureResult {
    if (options.requireQuoteSnapshot && !fixture.originalQuoteSnapshot) {
      throw new ExecutionError(
        'quote_failure',
        `HISTORICAL_TRANSACTION_REJECTED: Historical captured fixture (${fixture.signature.slice(0, 8)}...) does not have an original quote snapshot. Threshold replay is explicitly rejected instead of inventing one.`
      );
    }

    // Synthesize ParsedTransactionWithMeta from recorded fixture
    const txDetails: ParsedTransactionWithMeta = {
      slot: fixture.slot,
      blockTime: fixture.blockTime,
      transaction: {
        message: {
          accountKeys: [fixture.userWallet, 'JUP6LkbZbjS1jKKwapdHNy74bheuvzS44Ff2qG31941'],
          instructions: [],
          recentBlockhash: '',
        } as any,
        signatures: [fixture.signature],
      },
      meta: {
        err: fixture.transactionMeta.err,
        fee: fixture.transactionMeta.fee,
        logMessages: fixture.transactionMeta.logMessages || [],
        preBalances: fixture.transactionMeta.preBalances,
        postBalances: fixture.transactionMeta.postBalances,
        preTokenBalances: fixture.transactionMeta.preTokenBalances || [],
        postTokenBalances: fixture.transactionMeta.postTokenBalances || [],
      } as any,
    };

    // Verify confirmed receipt and on-chain balance deltas
    const receiptResult: ReplayReceiptResult = JupiterTransactionReplay.verifyConfirmedReceipt({
      txDetails,
      userPublicKey: fixture.userWallet,
      inputMint: fixture.inputMint,
      outputMint: fixture.outputMint,
      isSolBuy: fixture.isSolBuy,
    });

    let slippageThresholdChecked = false;
    let otherAmountThreshold: number | undefined;

    if (fixture.originalQuoteSnapshot) {
      const quote = fixture.originalQuoteSnapshot;
      otherAmountThreshold = quote.otherAmountThreshold ? Number(quote.otherAmountThreshold) : 0;

      if (otherAmountThreshold > 0) {
        if (receiptResult.actualOutputAmount < otherAmountThreshold) {
          throw new ExecutionError(
            'slippage_failure',
            `SLIPPAGE_TOLERANCE_EXCEEDED: Actual confirmed output amount (${receiptResult.actualOutputAmount}) was below original quote threshold (${otherAmountThreshold}).`
          );
        }
        slippageThresholdChecked = true;
      }
    }

    return {
      signature: fixture.signature,
      verified: receiptResult.verified,
      actualFeeSol: receiptResult.actualFeeSol,
      actualOutputAmount: receiptResult.actualOutputAmount,
      originalQuoteSnapshotPresent: !!fixture.originalQuoteSnapshot,
      slippageThresholdChecked,
      otherAmountThreshold,
    };
  }
}
