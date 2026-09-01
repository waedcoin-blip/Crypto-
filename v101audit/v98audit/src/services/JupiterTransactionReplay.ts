// src/services/JupiterTransactionReplay.ts
import { Connection, LAMPORTS_PER_SOL, ParsedTransactionWithMeta } from '@solana/web3.js';
import { QuoteResponse, QuoteGetRequest } from '@jup-ag/api';
import { ExecutionFailureClassification, ExecutionError } from './ITradeExecutor';

export interface ReplayQuoteValidationParams {
  quote: QuoteResponse;
  inputAmount: number;
  slippageBps: number;
  maxPriceImpactPct?: number;
}

export interface ReplayExecutionParams {
  initialQuote: QuoteResponse;
  freshQuote: QuoteResponse;
  slippageBps: number;
}

export interface ReplayReceiptVerificationParams {
  txDetails: ParsedTransactionWithMeta;
  userPublicKey: string;
  inputMint: string;
  outputMint: string;
  isSolBuy: boolean;
}

export interface ReplayReceiptResult {
  verified: boolean;
  actualFeeSol: number;
  actualOutputAmount: number; // Lamports for SOL, raw base units for SPL tokens
  actualInputAmount: number;
  slot: number;
}

/**
 * Classifies any swap or execution error into one of the standard 4 categories:
 * - quote_failure
 * - slippage_failure
 * - transaction_failure
 * - receipt_failure
 */
export function classifyExecutionError(err: any): ExecutionFailureClassification {
  if (err instanceof ExecutionError) {
    return err.classification;
  }

  const msg = (err?.message || String(err)).toLowerCase();

  // Slippage & price impact errors
  if (
    msg.includes('slippage') ||
    msg.includes('excessive_slippage') ||
    msg.includes('price impact') ||
    msg.includes('otheramountthreshold') ||
    msg.includes('tolerance_exceeded')
  ) {
    return 'slippage_failure';
  }

  // Receipt & parsing errors
  if (
    msg.includes('receipt') ||
    msg.includes('txdetails') ||
    msg.includes('balance delta') ||
    msg.includes('receipt_failure') ||
    msg.includes('failed to parse transaction')
  ) {
    return 'receipt_failure';
  }

  // Quote errors
  if (
    msg.includes('quote') ||
    msg.includes('route') ||
    msg.includes('no executable routes') ||
    msg.includes('quote_safety') ||
    msg.includes('stale') ||
    msg.includes('empty quote')
  ) {
    return 'quote_failure';
  }

  // Default to transaction failure (e.g. blockhash, signing, RPC submission, simulation)
  return 'transaction_failure';
}

export class JupiterTransactionReplay {
  /**
   * Replays and asserts safety validation for an initial Jupiter quote
   */
  static validateInitialQuote(params: ReplayQuoteValidationParams): { otherAmountThreshold: number; outAmount: number } {
    const { quote, inputAmount, slippageBps, maxPriceImpactPct = 10.0 } = params;

    if (inputAmount <= 0 || !Number.isFinite(inputAmount)) {
      throw new ExecutionError(
        'quote_failure',
        `INVALID_SWAP_AMOUNT: Amount must be positive and finite (got: ${inputAmount})`
      );
    }

    if (slippageBps > 1000) {
      throw new ExecutionError(
        'slippage_failure',
        `EXCESSIVE_SLIPPAGE: Slippage BPS ${slippageBps} exceeds maximum allowable limit of 1000 (10%).`
      );
    }

    if (!quote) {
      throw new ExecutionError('quote_failure', 'QUOTE_SAFETY_ERROR: Jupiter returned empty quote.');
    }

    if (!quote.outAmount || BigInt(quote.outAmount) <= 0n) {
      throw new ExecutionError('quote_failure', 'QUOTE_SAFETY_ERROR: Jupiter returned zero or negative output amount.');
    }

    if (!quote.routePlan || quote.routePlan.length === 0) {
      throw new ExecutionError('quote_failure', 'QUOTE_SAFETY_ERROR: Jupiter returned no executable routes.');
    }

    const impact = parseFloat(String(quote.priceImpactPct || '0')) * 100;
    if (impact > maxPriceImpactPct) {
      throw new ExecutionError(
        'slippage_failure',
        `QUOTE_SAFETY_ERROR: Excessive price impact (${impact.toFixed(2)}%) exceeds safety threshold of ${maxPriceImpactPct.toFixed(1)}%.`
      );
    }

    const otherAmountThreshold = quote.otherAmountThreshold ? Number(quote.otherAmountThreshold) : 0;
    const outAmount = Number(quote.outAmount);

    return { otherAmountThreshold, outAmount };
  }

  /**
   * Replays execution-time re-quote check against initial threshold
   */
  static validateExecutionReQuote(params: ReplayExecutionParams): { executableOutAmount: number } {
    const { initialQuote, freshQuote, slippageBps } = params;

    if (!freshQuote || !freshQuote.outAmount) {
      throw new ExecutionError('quote_failure', 'Jupiter execution-time re-quote is missing or empty.');
    }

    const initialThreshold = initialQuote.otherAmountThreshold ? Number(initialQuote.otherAmountThreshold) : 0;
    const freshOutAmount = Number(freshQuote.outAmount);

    if (freshOutAmount <= 0) {
      throw new ExecutionError('quote_failure', 'Execution-time re-quote returned non-positive output amount.');
    }

    if (initialThreshold > 0 && freshOutAmount < initialThreshold) {
      throw new ExecutionError(
        'slippage_failure',
        `SLIPPAGE_TOLERANCE_EXCEEDED: Execution output amount (${freshOutAmount}) fell below minimum required threshold (${initialThreshold}).`
      );
    }

    return { executableOutAmount: freshOutAmount };
  }

  /**
   * Extracts exact on-chain balance deltas and fees from a confirmed transaction receipt.
   * Guarantees that Jupiter quote is never used as fake realized proceeds.
   */
  static verifyConfirmedReceipt(params: ReplayReceiptVerificationParams): ReplayReceiptResult {
    const { txDetails, userPublicKey, inputMint, outputMint, isSolBuy } = params;

    if (!txDetails || !txDetails.meta) {
      throw new ExecutionError('receipt_failure', 'Transaction details or metadata are missing.');
    }

    if (txDetails.meta.err) {
      throw new ExecutionError(
        'transaction_failure',
        `Mainnet transaction on-chain execution failed: ${JSON.stringify(txDetails.meta.err)}`
      );
    }

    const actualFeeSol = (txDetails.meta.fee || 5000) / LAMPORTS_PER_SOL;
    let actualOutputAmount = 0;
    let actualInputAmount = 0;
    let verified = false;

    if (isSolBuy) {
      // SOL -> SPL Token
      // Sum output token deltas across ALL token accounts owned by user
      if (txDetails.meta.preTokenBalances && txDetails.meta.postTokenBalances) {
        const preSum = txDetails.meta.preTokenBalances
          .filter((b: any) => b.mint === outputMint && b.owner === userPublicKey)
          .reduce((sum: bigint, b: any) => sum + (b.uiTokenAmount?.amount ? BigInt(b.uiTokenAmount.amount) : 0n), 0n);
        const postSum = txDetails.meta.postTokenBalances
          .filter((b: any) => b.mint === outputMint && b.owner === userPublicKey)
          .reduce((sum: bigint, b: any) => sum + (b.uiTokenAmount?.amount ? BigInt(b.uiTokenAmount.amount) : 0n), 0n);
        const delta = postSum - preSum;

        if (delta > 0n) {
          actualOutputAmount = Number(delta);
          verified = true;
        }
      }
    } else {
      // SPL Token -> SOL
      const WSOL_MINT = 'So11111111111111111111111111111111111111112';
      // 1. Check WSOL token balance delta across all user accounts
      if (txDetails.meta?.preTokenBalances && txDetails.meta?.postTokenBalances) {
        const preWsol = txDetails.meta.preTokenBalances
          .filter((b: any) => b.mint === WSOL_MINT && b.owner === userPublicKey)
          .reduce((sum: bigint, b: any) => sum + (b.uiTokenAmount?.amount ? BigInt(b.uiTokenAmount.amount) : 0n), 0n);
        const postWsol = txDetails.meta.postTokenBalances
          .filter((b: any) => b.mint === WSOL_MINT && b.owner === userPublicKey)
          .reduce((sum: bigint, b: any) => sum + (b.uiTokenAmount?.amount ? BigInt(b.uiTokenAmount.amount) : 0n), 0n);
        const wsolDelta = postWsol - preWsol;

        if (wsolDelta > 0n) {
          actualOutputAmount = Number(wsolDelta);
          verified = true;
        }
      }

      // 2. If WSOL unwrapped or native SOL transferred, calculate native SOL balance delta
      if (!verified && txDetails.meta?.preBalances && txDetails.meta?.postBalances && txDetails.transaction?.message?.accountKeys) {
        const keys = txDetails.transaction.message.accountKeys;
        const userIdx = keys.findIndex((k: any) => {
          const pk = typeof k === 'string' ? k : (k?.pubkey?.toBase58 ? k.pubkey.toBase58() : String(k?.pubkey || ''));
          return pk === userPublicKey;
        });

        if (userIdx !== -1 && txDetails.meta.preBalances[userIdx] !== undefined && txDetails.meta.postBalances[userIdx] !== undefined) {
          const preBal = txDetails.meta.preBalances[userIdx];
          const postBal = txDetails.meta.postBalances[userIdx];
          const feeLamports = userIdx === 0 && txDetails.meta.fee ? txDetails.meta.fee : 0;
          const grossLamports = postBal - preBal + feeLamports;

          if (grossLamports > 0) {
            actualOutputAmount = grossLamports;
            verified = true;
          }
        }
      }
    }

    if (!verified || actualOutputAmount <= 0) {
      throw new ExecutionError(
        'receipt_failure',
        'CONFIRMED_RECEIPT_UNVERIFIED: Could not verify positive on-chain balance delta from transaction receipt. Refusing to use unverified quote proceeds.'
      );
    }

    return {
      verified: true,
      actualFeeSol,
      actualOutputAmount,
      actualInputAmount,
      slot: txDetails.slot || 0,
    };
  }
}
