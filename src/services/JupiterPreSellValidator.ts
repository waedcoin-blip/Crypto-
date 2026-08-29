// src/services/JupiterPreSellValidator.ts
import { QuoteResponse } from '@jup-ag/api';
import { getJupiterQuote } from './jupiterService';
import { SOL_MINT } from '../constants/solana';
import { useAppStore } from '../store/appStore';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

export interface PreSellValidationParams {
  mint: string;
  rawAmount: number; // Integer base units
  slippageBps?: number;
  costBasisSol?: number;
  currentMarketPriceSol?: number;
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
    const { mint, rawAmount, slippageBps = 250, costBasisSol = 0, label = 'exit_tp' } = params;

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
      return baseFailure('Jupiter executable quote unavailable or returned null. Non-Jupiter fallbacks are forbidden for pre-sell validation.');
    }

    // 2. VALIDATE ROUTE PLAN & OUTPUT
    if (!quote.routePlan || quote.routePlan.length === 0) {
      return baseFailure('Jupiter returned empty route plan (no executable DEX route found).');
    }

    const outAmountLamports = Number(quote.outAmount) || 0;
    if (outAmountLamports <= 0) {
      return baseFailure('Jupiter returned zero or negative output lamports.');
    }

    const outAmountSol = outAmountLamports / 1e9;

    // 3. VALIDATE PRICE IMPACT
    const priceImpactPct = Math.abs(parseFloat(String(quote.priceImpactPct || '0')) * 100);
    const maxImpactThreshold = 10.0;
    if (priceImpactPct > maxImpactThreshold) {
      return baseFailure(`Price impact (${priceImpactPct.toFixed(2)}%) exceeds safety threshold (${maxImpactThreshold}%).`);
    }

    // 4. CALCULATE REALIZABLE EXECUTABLE P&L (without hardcoded artificial fees)
    let executablePnlPct = 0;
    if (costBasisSol > 0) {
      executablePnlPct = ((outAmountSol - costBasisSol) / costBasisSol) * 100;
    }

    // 5. PROFITABILITY & SIGNAL CONFLICT CHECKS
    if (costBasisSol > 0) {
      // Conflict Case A: Negative exit signal triggered, but Jupiter quote shows net profit
      if ((label === 'exit_sl' || label?.includes('SL')) && executablePnlPct >= 0) {
        return baseFailure(
          `Conflicting negative exit signal (${label}) conflicts with PROFITABLE Jupiter executable quote (+${executablePnlPct.toFixed(2)}%). Aborting sell for position revalidation.`
        );
      }

      // Conflict Case B: Take profit signal triggered, but Jupiter quote yields loss
      if ((label === 'exit_tp' || label?.includes('TP')) && executablePnlPct < 0) {
        return baseFailure(
          `Take-Profit candidate triggered on market price, but Jupiter executable SELL quote yields net loss (${executablePnlPct.toFixed(2)}%). Aborting sell.`
        );
      }

      // Anomaly Check: Extreme loss discrepancy
      if (executablePnlPct < -80) {
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
}

export const jupiterPreSellValidator = JupiterPreSellValidator.getInstance();
