// src/services/JupiterPreSellValidator.ts
import { QuoteResponse } from '@jup-ag/api';
import { getJupiterQuote } from './jupiterService';
import { SOL_MINT } from '../constants/solana';
import { useAppStore } from '../store/appStore';
import { normalizePriceImpact, buildSafeQuoteDiagnostic, MAX_PRICE_IMPACT_RATIO } from '../utils/quoteSafety';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

export interface PreSellValidationParams {
  mint: string;
  rawAmount: number; // Integer base units
  totalPositionAmount?: number; // Total integer base units in position (if partial)
  slippageBps?: number;
  costBasisSol?: number;
  currentMarketPriceSol?: number;
  targetTpPct?: number;
  targetSlPct?: number;
  label?: 'exit_tp' | 'exit_sl' | 'MANUAL' | 'EMERGENCY' | 'FORCE_EXIT' | string;
}

export interface PreSellValidationResult {
  isValid: boolean;
  validator: 'JUPITER_EXECUTABLE_ONLY';
  inputMint: string;
  outputMint: string;
  rawAmount: number;
  outAmountSol: number;
  executablePnlPct: number;
  priceImpactPct: number;
  routePlanLength: number;
  reason?: string;
  quote?: QuoteResponse | null;
  validatedAt: number;
}

/**
 * JupiterPreSellValidator: Authoritative pre-sell execution validator.
 * Enforces strictly that ALL pre-sell validations and position exits are audited
 * EXCLUSIVELY via Jupiter Executable Quotes. Non-Jupiter fallbacks are forbidden.
 */
export class JupiterPreSellValidator {
  private static instance: JupiterPreSellValidator;

  public static getInstance(): JupiterPreSellValidator {
    if (!JupiterPreSellValidator.instance) {
      JupiterPreSellValidator.instance = new JupiterPreSellValidator();
    }
    return JupiterPreSellValidator.instance;
  }

  /**
   * Performs rigorous executable pre-sell validation exclusively using Jupiter API.
   */
  public async validatePreSell(
    params: PreSellValidationParams
  ): Promise<PreSellValidationResult> {
    const startTime = Date.now();
    const { mint, rawAmount, totalPositionAmount, slippageBps = 250, costBasisSol = 0, targetTpPct, targetSlPct, label = 'exit_tp' } = params;

    // Proportional cost basis calculation if selling a partial amount
    let effectiveCostBasisSol = costBasisSol;
    if (totalPositionAmount && totalPositionAmount > 0 && rawAmount > 0 && rawAmount < totalPositionAmount) {
      effectiveCostBasisSol = costBasisSol * (rawAmount / totalPositionAmount);
    }

    const baseFailure = (reason: string): PreSellValidationResult => {
      const result: PreSellValidationResult = {
        isValid: false,
        validator: 'JUPITER_EXECUTABLE_ONLY',
        inputMint: mint,
        outputMint: WSOL_MINT,
        rawAmount,
        outAmountSol: 0,
        executablePnlPct: -100,
        priceImpactPct: 0,
        routePlanLength: 0,
        reason,
        quote: null,
        validatedAt: Date.now(),
      };

      useAppStore.getState().addJupiterLog({
        type: 'ERROR',
        message: `⛔ [PRE-SELL VALIDATION FAILED] ${mint.slice(0, 8)}...: ${reason}`,
        details: { mint, rawAmount, label, validator: 'JUPITER_EXECUTABLE_ONLY' },
      });

      console.warn(`[JupiterPreSellValidator] ⛔ Pre-sell validation rejected for ${mint}: ${reason}`);
      return result;
    };

    if (!mint || typeof mint !== 'string' || mint.length < 32) {
      return baseFailure('Invalid Solana token mint address.');
    }

    if (!rawAmount || rawAmount <= 0 || !Number.isFinite(rawAmount)) {
      return baseFailure(`Invalid raw token amount for sell validation: ${rawAmount}`);
    }

    // 1. QUERY JUPITER EXECUTABLE QUOTE STRICTLY
    let quote: QuoteResponse | null = null;
    try {
      quote = await getJupiterQuote(
        mint,
        WSOL_MINT,
        Math.floor(rawAmount),
        0, // liquidityUsd
        undefined, // initialBuyCostSol
        undefined, // minTargetProfitPct
        undefined, // currentPnLPercent
        false, // restrictIntermediateTokens
        false, // onlyDirectRoutes
        slippageBps // Pass requested slippage explicitly
      );
    } catch (err: any) {
      return baseFailure(`Jupiter API quote exception: ${err?.message || String(err)}`);
    }

    if (!quote) {
      return baseFailure('INVALID_QUOTE: Jupiter executable quote unavailable or returned null. Non-Jupiter fallbacks are forbidden for pre-sell validation.');
    }

    // 2. VALIDATE ROUTE PLAN & OUTPUT
    if (!quote.routePlan || quote.routePlan.length === 0) {
      return baseFailure('NO_ROUTE: Jupiter returned empty route plan (no executable DEX route found).');
    }

    const outAmountLamports = Number(quote.outAmount) || 0;
    if (outAmountLamports <= 0) {
      return baseFailure('INVALID_QUOTE: Jupiter returned zero or negative output lamports.');
    }

    const outAmountSol = outAmountLamports / 1e9;

    // 3. VALIDATE PRICE IMPACT
    const normalizedImpact = normalizePriceImpact(quote.priceImpactPct);
    if (Number.isNaN(normalizedImpact) || !Number.isFinite(normalizedImpact)) {
      const diagnostic = buildSafeQuoteDiagnostic({ quote, inputMint: mint, outputMint: WSOL_MINT });
      console.error('[JupiterPreSellValidator] Invalid price impact from Jupiter:', diagnostic);
      return baseFailure(`INVALID_QUOTE: Jupiter returned invalid priceImpactPct (${quote.priceImpactPct}).`);
    }

    const priceImpactPct = normalizedImpact * 100;
    const maxImpactThreshold = MAX_PRICE_IMPACT_RATIO * 100; // 10.0%
    if (normalizedImpact > MAX_PRICE_IMPACT_RATIO) {
      const diagnostic = buildSafeQuoteDiagnostic({ quote, inputMint: mint, outputMint: WSOL_MINT });
      console.error('[JupiterPreSellValidator] Price impact exceeds safety threshold:', diagnostic);
      return baseFailure(`QUOTE_SAFETY_ERROR: Price impact (${priceImpactPct.toFixed(2)}%) exceeds safety threshold (${maxImpactThreshold.toFixed(1)}%).`);
    }

    // 4. CALCULATE REALIZABLE EXECUTABLE P&L (without hardcoded artificial fees)
    let executablePnlPct = 0;
    if (effectiveCostBasisSol > 0) {
      executablePnlPct = ((outAmountSol - effectiveCostBasisSol) / effectiveCostBasisSol) * 100;
    }

    // 5. PROFITABILITY & SIGNAL CONFLICT CHECKS
    if (effectiveCostBasisSol > 0) {
      // Conflict Case A: Negative exit signal triggered, but Jupiter quote shows net profit or has not reached SL threshold
      if (label === 'exit_sl' || label?.includes('SL')) {
        if (executablePnlPct >= 0) {
          return baseFailure(
            `Conflicting negative exit signal (${label}) conflicts with PROFITABLE Jupiter executable quote (+${executablePnlPct.toFixed(2)}%). Aborting sell for position revalidation.`
          );
        }
        if (targetSlPct !== undefined && targetSlPct > 0) {
          const requiredLossThreshold = -Math.abs(targetSlPct);
          if (executablePnlPct > requiredLossThreshold) {
            return baseFailure(
              `Stop-Loss candidate triggered on market price, but Jupiter executable quote loss (${executablePnlPct.toFixed(2)}%) has not breached configured SL threshold (${requiredLossThreshold.toFixed(2)}%). Aborting sell.`
            );
          }
        }
      }

      // Conflict Case B: Take profit signal triggered, but Jupiter quote yields loss or is below target TP
      if (label === 'exit_tp' || label?.includes('TP')) {
        if (executablePnlPct < 0) {
          return baseFailure(
            `Take-Profit candidate triggered on market price, but Jupiter executable SELL quote yields net loss (${executablePnlPct.toFixed(2)}%). Aborting sell.`
          );
        }
        if (targetTpPct !== undefined && targetTpPct > 0) {
          if (executablePnlPct < targetTpPct) {
            return baseFailure(
              `Take-Profit candidate triggered on market price, but Jupiter executable quote PnL (${executablePnlPct.toFixed(2)}%) is below target TP threshold (+${targetTpPct.toFixed(2)}%). Aborting sell.`
            );
          }
        }
      }

      // Anomaly Check: Extreme loss discrepancy
      if (executablePnlPct < -95) {
        return baseFailure(
          `Anomalous Jupiter quote detected (${executablePnlPct.toFixed(2)}% loss). Refusing to manufacture anomalous loss.`
        );
      }
    }

    const durationMs = Date.now() - startTime;

    useAppStore.getState().addJupiterLog({
      type: 'QUOTE',
      message: `✅ [PRE-SELL VALIDATED BY JUPITER] ${mint.slice(0, 8)}... | Output: ${outAmountSol.toFixed(4)} SOL | Impact: ${priceImpactPct.toFixed(2)}% | Routes: ${quote.routePlan.length}`,
      details: {
        mint,
        rawAmount,
        outAmountSol,
        executablePnlPct,
        priceImpactPct,
        routePlanLength: quote.routePlan.length,
        durationMs,
        validator: 'JUPITER_EXECUTABLE_ONLY',
      },
    });

    console.log(
      `[JupiterPreSellValidator] ✅ Pre-sell validation PASSED by Jupiter for ${mint}: Output = ${outAmountSol.toFixed(4)} SOL, PnL = ${executablePnlPct.toFixed(2)}%, Latency = ${durationMs}ms`
    );

    return {
      isValid: true,
      validator: 'JUPITER_EXECUTABLE_ONLY',
      inputMint: mint,
      outputMint: WSOL_MINT,
      rawAmount,
      outAmountSol,
      executablePnlPct,
      priceImpactPct,
      routePlanLength: quote.routePlan.length,
      quote,
      validatedAt: Date.now(),
    };
  }

  /**
   * Asserts that a pre-sell validation quote is still fresh (<= 1000ms old) and matches
   * the exact target mint, output mint, and token amount.
   */
  public assertQuoteFreshness(
    validatedResult: PreSellValidationResult,
    expectedInputMint: string,
    expectedOutputMint: string,
    expectedRawAmount: number | bigint,
    maxAgeMs = 1000
  ): { fresh: boolean; reason?: string } {
    if (!validatedResult || !validatedResult.isValid) {
      return { fresh: false, reason: 'PRE_SELL_QUOTE_INVALID' };
    }

    const ageMs = Date.now() - (validatedResult.validatedAt || 0);
    if (ageMs > maxAgeMs) {
      return { fresh: false, reason: `PRE_SELL_QUOTE_STALE (${ageMs}ms > ${maxAgeMs}ms limit)` };
    }

    if (validatedResult.inputMint !== expectedInputMint) {
      return { fresh: false, reason: `INPUT_MINT_MISMATCH: ${validatedResult.inputMint} !== ${expectedInputMint}` };
    }

    if (validatedResult.outputMint !== expectedOutputMint) {
      return { fresh: false, reason: `OUTPUT_MINT_MISMATCH: ${validatedResult.outputMint} !== ${expectedOutputMint}` };
    }

    const numExpectedAmount = typeof expectedRawAmount === 'bigint' ? Number(expectedRawAmount) : expectedRawAmount;
    if (Math.abs(validatedResult.rawAmount - numExpectedAmount) > 1) {
      return { fresh: false, reason: `RAW_AMOUNT_MISMATCH: quote=${validatedResult.rawAmount} expected=${numExpectedAmount}` };
    }

    return { fresh: true };
  }
}

export const jupiterPreSellValidator = JupiterPreSellValidator.getInstance();
