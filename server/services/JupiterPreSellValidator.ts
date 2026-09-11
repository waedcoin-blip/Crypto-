// server/services/JupiterPreSellValidator.ts
import { config, getJupiterApiKey } from '../config/index.js';
import { fetchWithRetry } from '../utils/fetch.js';
import { logger } from '../utils/logger.js';

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const MAX_PRICE_IMPACT_RATIO = 10; // Max 10% price impact

export interface PreSellValidationParams {
  inputMint: string;
  outputMint: string;
  rawAmount: number | string | bigint;
  slippageBps: number;
  costBasisSol?: number;
  minTargetProfitPct?: number;
  currentPnLPercent?: number;
}

export interface PreSellValidationResult {
  isValid: boolean;
  validator: 'JUPITER_EXECUTABLE_ONLY';
  inputMint: string;
  outputMint: string;
  rawAmount: string;
  outAmountSol: number;
  executablePnlPct: number;
  priceImpactPct: number;
  routePlanLength: number;
  reason?: string;
  quote?: any;
  validatedAt: number;
}

function normalizePriceImpact(raw: any): number {
  if (raw === null || raw === undefined) return 0;
  const num = Number(raw);
  if (Number.isNaN(num) || !Number.isFinite(num)) return 0;
  return Math.abs(num);
}

export class JupiterPreSellValidator {
  private static instance: JupiterPreSellValidator;

  private constructor() {}

  public static getInstance(): JupiterPreSellValidator {
    if (!JupiterPreSellValidator.instance) {
      JupiterPreSellValidator.instance = new JupiterPreSellValidator();
    }
    return JupiterPreSellValidator.instance;
  }

  /**
   * Authoritative pre-sell validation.
   * Enforces that ALL exits are validated against Jupiter Executable Quotes.
   * Non-Jupiter fallbacks are strictly FORBIDDEN.
   */
  public async validatePreSell(params: PreSellValidationParams): Promise<PreSellValidationResult> {
    const now = Date.now();
    const rawAmountStr = String(params.rawAmount);

    const baseFailure = (reason: string): PreSellValidationResult => ({
      isValid: false,
      validator: 'JUPITER_EXECUTABLE_ONLY',
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      rawAmount: rawAmountStr,
      outAmountSol: 0,
      executablePnlPct: 0,
      priceImpactPct: 0,
      routePlanLength: 0,
      reason,
      quote: null,
      validatedAt: now,
    });

    // 1. GET JUPITER EXECUTABLE QUOTE
    let quote: any;
    try {
      const jupBaseUrl = 'https://api.jup.ag/swap/v1';
      const apiKey = getJupiterApiKey();
      const queryParams = new URLSearchParams({
        inputMint: params.inputMint,
        outputMint: params.outputMint || WSOL_MINT,
        amount: rawAmountStr,
        slippageBps: String(params.slippageBps || 250),
        swapMode: 'ExactIn',
        restrictIntermediateTokens: 'false',
        onlyDirectRoutes: 'false',
      });

      const url = `${jupBaseUrl}/quote?${queryParams.toString()}`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['x-api-key'] = apiKey;

      const { response, text } = await fetchWithRetry(
        url,
        { method: 'GET', headers, timeoutMs: 8000 },
        2,
        500
      );

      if (!response.ok) {
        return baseFailure(`JUPITER_QUOTE_HTTP_ERROR: ${response.status} ${text?.slice(0, 200)}`);
      }

      quote = JSON.parse(text);
    } catch (err: any) {
      return baseFailure(`JUPITER_QUOTE_EXCEPTION: ${err?.message || String(err)}`);
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
      return baseFailure('INVALID_PRICE_IMPACT: Jupiter returned non-finite price impact.');
    }
    if (normalizedImpact > MAX_PRICE_IMPACT_RATIO) {
      return baseFailure(`PRICE_IMPACT_TOO_HIGH: ${normalizedImpact.toFixed(2)}% > ${MAX_PRICE_IMPACT_RATIO}% limit.`);
    }

    // 4. CALCULATE EXECUTABLE PNL
    let executablePnlPct = 0;
    if (params.costBasisSol && params.costBasisSol > 0) {
      const netReturnSol = outAmountSol;
      executablePnlPct = ((netReturnSol - params.costBasisSol) / params.costBasisSol) * 100;

      // Fail-closed: If executable return is below cost basis, reject
      if (netReturnSol < params.costBasisSol * 0.5) {
        return baseFailure(`EXECUTABLE_RETURN_CRITICAL_LOSS: Expected return ${netReturnSol.toFixed(6)} SOL is less than 50% of cost basis ${params.costBasisSol.toFixed(6)} SOL.`);
      }
    }

    // 5. VALIDATE MIN TARGET PROFIT (if specified)
    if (params.minTargetProfitPct !== undefined && params.minTargetProfitPct > 0) {
      if (executablePnlPct < params.minTargetProfitPct) {
        return baseFailure(`EXECUTABLE_PNL_BELOW_TARGET: ${executablePnlPct.toFixed(2)}% < ${params.minTargetProfitPct}% target.`);
      }
    }

    // ALL CHECKS PASSED
    return {
      isValid: true,
      validator: 'JUPITER_EXECUTABLE_ONLY',
      inputMint: params.inputMint,
      outputMint: params.outputMint || WSOL_MINT,
      rawAmount: rawAmountStr,
      outAmountSol,
      executablePnlPct: Math.round(executablePnlPct * 100) / 100,
      priceImpactPct: normalizedImpact,
      routePlanLength: quote.routePlan.length,
      reason: 'JUPITER_EXECUTABLE_QUOTE_VALIDATED',
      quote,
      validatedAt: now,
    };
  }
}

export const jupiterPreSellValidator = JupiterPreSellValidator.getInstance();
