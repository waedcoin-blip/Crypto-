// src/services/JupiterQuoteService.ts
import { QuoteResponse, createJupiterApiClient } from '@jup-ag/api';
import { WSOL_MINT, validateQuoteSafetyStrict, MAX_PRICE_IMPACT_RATIO } from '../utils/quoteSafety';
import { resolveTokenDecimals } from './PaperTradeExecutor';
import { tokenRegistry } from './TokenRegistry';

export interface ValidatedExitQuote {
  quote: QuoteResponse;
  mint: string;
  inputAmountRaw: number;
  outputMint: string;
  expectedOutputLamports: bigint;
  expectedOutputSol: number;
  slippageBps: number;
  priceImpactPct: number;
  timestamp: number;
  expiresAt: number; // 5000ms hard expiration
  routePlanLength: number;
}

export class JupiterQuoteService {
  private static instance: JupiterQuoteService;
  private jupiterApiClient: ReturnType<typeof createJupiterApiClient>;

  private constructor() {
    const basePath = (typeof process !== 'undefined' ? process.env.JUPITER_API_URL : undefined) || 'https://api.jup.ag/swap/v1';
    this.jupiterApiClient = createJupiterApiClient({ basePath });
  }

  public static getInstance(): JupiterQuoteService {
    if (!JupiterQuoteService.instance) {
      JupiterQuoteService.instance = new JupiterQuoteService();
    }
    return JupiterQuoteService.instance;
  }

  /**
   * Fetches an executable Jupiter quote for selling `amountRaw` of `tokenMint` for WSOL/SOL.
   * Performs strict decimal validation, safety checks, and sets a 5000ms expiration window.
   */
  public async getExecutableExitQuote(params: {
    tokenMint: string;
    amountRaw: number;
    slippageBps?: number;
    maxPriceImpactRatio?: number;
  }): Promise<ValidatedExitQuote> {
    const {
      tokenMint,
      amountRaw,
      slippageBps = 250,
      maxPriceImpactRatio = MAX_PRICE_IMPACT_RATIO,
    } = params;

    const sanitizedAmountRaw = Math.floor(amountRaw);
    if (sanitizedAmountRaw <= 0 || !Number.isFinite(sanitizedAmountRaw)) {
      throw new Error(`JUPITER_QUOTE_ERROR: Invalid raw exit amount (${amountRaw})`);
    }

    // 1. Strict Decimal Resolution (Fail-Closed)
    let decimals: number;
    try {
      decimals = resolveTokenDecimals(tokenMint);
    } catch (err: any) {
      throw new Error(`JUPITER_QUOTE_DECIMAL_FAILURE: Cannot resolve decimals for exit mint ${tokenMint}: ${err.message}`);
    }

    if (decimals < 0 || decimals > 18) {
      throw new Error(`JUPITER_QUOTE_DECIMAL_FAILURE: Invalid decimals (${decimals}) for mint ${tokenMint}`);
    }

    // 2. Fetch Quote from Jupiter API or fallback route
    let quote: QuoteResponse;
    const now = Date.now();

    try {
      // In paper mode or when proxied via API
      const customApiKey = typeof localStorage !== 'undefined'
        ? localStorage.getItem('jupiter_auto_apiKey') || localStorage.getItem('juipter_auto_apiKey') || ''
        : '';

      const headers: Record<string, string> = { Accept: 'application/json' };
      if (customApiKey && !customApiKey.startsWith('http')) {
        headers['x-api-key'] = customApiKey;
      }

      const queryUrl = `/api/jup/quote?inputMint=${tokenMint}&outputMint=${WSOL_MINT}&amount=${sanitizedAmountRaw}&slippageBps=${slippageBps}&restrictIntermediateTokens=true`;
      const response = await fetch(queryUrl, { headers });

      if (response.ok) {
        quote = await response.json();
      } else {
        // Fallback to client SDK
        quote = await this.jupiterApiClient.quoteGet({
          inputMint: tokenMint,
          outputMint: WSOL_MINT,
          amount: sanitizedAmountRaw,
          slippageBps,
          restrictIntermediateTokens: true,
        });
      }
    } catch (err: any) {
      throw new Error(`JUPITER_QUOTE_FETCH_FAILED: Failed to fetch sell quote for ${tokenMint}: ${err?.message || String(err)}`);
    }

    // 3. Strict Safety Validation
    const validation = validateQuoteSafetyStrict({
      quote,
      inputAmount: sanitizedAmountRaw,
      slippageBps,
      maxPriceImpactRatio,
      expectedInputMint: tokenMint,
      expectedOutputMint: WSOL_MINT,
      isBuy: false,
    });

    const expectedOutputLamports = validation.outAmount;
    const expectedOutputSol = Number(expectedOutputLamports) / 1e9;

    return {
      quote,
      mint: tokenMint,
      inputAmountRaw: sanitizedAmountRaw,
      outputMint: WSOL_MINT,
      expectedOutputLamports,
      expectedOutputSol,
      slippageBps,
      priceImpactPct: validation.normalizedPriceImpactRatio * 100,
      timestamp: now,
      expiresAt: now + 5000, // 5 seconds expiration
      routePlanLength: Array.isArray(quote.routePlan) ? quote.routePlan.length : 1,
    };
  }

  public isQuoteValid(quote: ValidatedExitQuote): boolean {
    if (!quote || !quote.expiresAt) return false;
    return Date.now() < quote.expiresAt;
  }
}

export const jupiterQuoteService = JupiterQuoteService.getInstance();
