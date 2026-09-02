// server/utils/quoteSafety.ts
/**
 * Server-side Authoritative Quote Safety & Normalization Engine
 */

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const MAX_PRICE_IMPACT_RATIO = 0.10; // 0.10 = 10.0%
export const MAX_PRICE_IMPACT_PCT = 10.0;   // 10.0%
export const LAMPORTS_PER_SOL_BIGINT = 1_000_000_000n;

export interface SafeQuoteDiagnostic {
  requestedUsdAmount?: number;
  solPriceUsed?: number;
  calculatedSolAmount?: number;
  calculatedLamports?: string | number;
  inputMint: string;
  outputMint: string;
  expectedOutputMint?: string;
  rawPriceImpactPct: unknown;
  typeofPriceImpactPct: string;
  normalizedPriceImpactRatio: number;
  normalizedPriceImpactPct: string;
  routePlanLength: number;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold?: string;
  swapMode?: string;
  slippageBps?: number;
}

export function normalizePriceImpact(rawPriceImpact: unknown): number {
  if (rawPriceImpact === null || rawPriceImpact === undefined) {
    return NaN;
  }
  if (typeof rawPriceImpact === 'number') {
    if (!Number.isFinite(rawPriceImpact) || Number.isNaN(rawPriceImpact)) {
      return NaN;
    }
    return Math.abs(rawPriceImpact) / 100;
  }
  const str = String(rawPriceImpact).trim();
  if (str === '' || str === 'null' || str === 'undefined' || str === 'NaN') {
    return NaN;
  }
  const parsed = parseFloat(str);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return NaN;
  }
  return Math.abs(parsed) / 100;
}

export function convertUsdToLamports(usdAmount: number, solPriceUsd: number): bigint {
  if (!Number.isFinite(usdAmount) || usdAmount <= 0) {
    throw new Error(`INVALID_USD_AMOUNT: USD amount must be positive and finite (got: ${usdAmount})`);
  }
  if (!Number.isFinite(solPriceUsd) || solPriceUsd <= 0) {
    throw new Error(`INVALID_SOL_PRICE: SOL price must be positive and finite (got: ${solPriceUsd})`);
  }

  const usdMicro = BigInt(Math.round(usdAmount * 1_000_000));
  const solPriceMicro = BigInt(Math.round(solPriceUsd * 1_000_000));

  if (solPriceMicro <= 0n) {
    throw new Error(`INVALID_SOL_PRICE: SOL price resolution failed.`);
  }

  const lamports = (usdMicro * LAMPORTS_PER_SOL_BIGINT) / solPriceMicro;
  if (lamports <= 0n) {
    throw new Error(`CALCULATED_ZERO_LAMPORTS: $${usdAmount} at $${solPriceUsd}/SOL produced 0 lamports.`);
  }
  return lamports;
}

export function buildSafeQuoteDiagnostic(params: {
  quote: any;
  inputMint?: string;
  outputMint?: string;
  expectedOutputMint?: string;
  requestedUsdAmount?: number;
  solPriceUsed?: number;
  calculatedLamports?: bigint | number | string;
}): SafeQuoteDiagnostic {
  const { quote, inputMint, outputMint, expectedOutputMint, requestedUsdAmount, solPriceUsed, calculatedLamports } = params;
  const rawImpact = quote?.priceImpactPct;
  const normalizedRatio = normalizePriceImpact(rawImpact);

  let calculatedSolAmount: number | undefined;
  if (calculatedLamports !== undefined) {
    calculatedSolAmount = Number(calculatedLamports) / 1_000_000_000;
  } else if (requestedUsdAmount !== undefined && solPriceUsed !== undefined && solPriceUsed > 0) {
    calculatedSolAmount = requestedUsdAmount / solPriceUsed;
  }

  return {
    requestedUsdAmount,
    solPriceUsed,
    calculatedSolAmount,
    calculatedLamports: calculatedLamports !== undefined ? calculatedLamports.toString() : undefined,
    inputMint: quote?.inputMint || inputMint || 'UNKNOWN',
    outputMint: quote?.outputMint || outputMint || 'UNKNOWN',
    expectedOutputMint,
    rawPriceImpactPct: rawImpact,
    typeofPriceImpactPct: typeof rawImpact,
    normalizedPriceImpactRatio: normalizedRatio,
    normalizedPriceImpactPct: Number.isNaN(normalizedRatio) ? 'NaN' : `${(normalizedRatio * 100).toFixed(2)}%`,
    routePlanLength: Array.isArray(quote?.routePlan) ? quote.routePlan.length : 0,
    inAmount: String(quote?.inAmount ?? '0'),
    outAmount: String(quote?.outAmount ?? '0'),
    otherAmountThreshold: quote?.otherAmountThreshold ? String(quote.otherAmountThreshold) : undefined,
    swapMode: quote?.swapMode,
    slippageBps: quote?.slippageBps,
  };
}

export interface QuoteSafetyValidationParams {
  quote: any;
  inputAmount: number | bigint | string;
  slippageBps?: number;
  maxPriceImpactRatio?: number; // default 0.10 (10.0%)
  expectedInputMint?: string;
  expectedOutputMint?: string;
  isBuy?: boolean;
  usdContext?: {
    requestedUsdAmount?: number;
    solPriceUsed?: number;
  };
}

export interface QuoteSafetyValidationResult {
  valid: boolean;
  otherAmountThreshold: bigint;
  outAmount: bigint;
  normalizedPriceImpactRatio: number;
  priceImpactPctString: string;
}

export function validateQuoteSafetyStrict(params: QuoteSafetyValidationParams): QuoteSafetyValidationResult {
  const {
    quote,
    inputAmount,
    slippageBps = 100,
    maxPriceImpactRatio = MAX_PRICE_IMPACT_RATIO,
    expectedInputMint,
    expectedOutputMint,
    isBuy,
    usdContext,
  } = params;

  let inAmtBig: bigint;
  try {
    inAmtBig = BigInt(inputAmount);
  } catch {
    throw new Error(`INVALID_SWAP_AMOUNT: Amount must be a valid integer in base units (got: ${inputAmount})`);
  }
  if (inAmtBig <= 0n) {
    throw new Error(`INVALID_SWAP_AMOUNT: Amount must be positive and non-zero (got: ${inputAmount})`);
  }

  if (slippageBps > 1000) {
    throw new Error(`EXCESSIVE_SLIPPAGE: Slippage BPS ${slippageBps} exceeds maximum allowable limit of 1000 (10%).`);
  }

  if (!quote || typeof quote !== 'object') {
    throw new Error('INVALID_QUOTE: Jupiter returned null or empty quote object.');
  }

  if (!quote.routePlan || !Array.isArray(quote.routePlan) || quote.routePlan.length === 0) {
    throw new Error('NO_ROUTE: Jupiter returned no executable route plan for the requested pair and amount.');
  }

  let outAmtBig: bigint;
  try {
    outAmtBig = BigInt(quote.outAmount);
  } catch {
    throw new Error('INVALID_QUOTE: Jupiter returned invalid non-integer outAmount.');
  }
  if (outAmtBig <= 0n) {
    throw new Error('INVALID_QUOTE: Jupiter returned zero or negative output amount.');
  }

  if (isBuy) {
    const quoteIn = quote.inputMint;
    const quoteOut = quote.outputMint;

    if (quoteIn && quoteIn !== SOL_MINT && quoteIn !== WSOL_MINT) {
      const diagnostic = buildSafeQuoteDiagnostic({ quote, ...usdContext, calculatedLamports: inAmtBig });
      console.error('[QUOTE_SAFETY_DIAGNOSTIC] BUY direction error (input is not SOL):', diagnostic);
      throw new Error(`INVALID_QUOTE: BUY trade inputMint must be SOL/WSOL (${SOL_MINT}), got: ${quoteIn}`);
    }

    if (expectedOutputMint && quoteOut && quoteOut !== expectedOutputMint) {
      const diagnostic = buildSafeQuoteDiagnostic({ quote, expectedOutputMint, ...usdContext, calculatedLamports: inAmtBig });
      console.error('[QUOTE_SAFETY_DIAGNOSTIC] BUY output mint mismatch:', diagnostic);
      throw new Error(`INVALID_QUOTE: BUY quote outputMint (${quoteOut}) does not match selected target token (${expectedOutputMint}).`);
    }
  }

  if (expectedInputMint && quote.inputMint && quote.inputMint !== expectedInputMint) {
    throw new Error(`INVALID_QUOTE: Quote inputMint (${quote.inputMint}) does not match expected input (${expectedInputMint}).`);
  }
  if (expectedOutputMint && quote.outputMint && quote.outputMint !== expectedOutputMint) {
    throw new Error(`INVALID_QUOTE: Quote outputMint (${quote.outputMint}) does not match expected output (${expectedOutputMint}).`);
  }

  const rawPriceImpact = quote.priceImpactPct;
  const normalizedImpact = normalizePriceImpact(rawPriceImpact);

  if (Number.isNaN(normalizedImpact) || !Number.isFinite(normalizedImpact)) {
    const diagnostic = buildSafeQuoteDiagnostic({ quote, ...usdContext, calculatedLamports: inAmtBig });
    console.error('[QUOTE_SAFETY_DIAGNOSTIC] Invalid price impact received from Jupiter:', diagnostic);
    throw new Error(`INVALID_QUOTE: Jupiter returned invalid or missing priceImpactPct (${rawPriceImpact}).`);
  }

  const impactPctString = `${(normalizedImpact * 100).toFixed(2)}%`;

  if (normalizedImpact > maxPriceImpactRatio) {
    const diagnostic = buildSafeQuoteDiagnostic({ quote, ...usdContext, calculatedLamports: inAmtBig });
    console.error('[QUOTE_SAFETY_DIAGNOSTIC] Price impact exceeds safety limit:', diagnostic);
    throw new Error(
      `QUOTE_SAFETY_ERROR: Excessive price impact (${impactPctString}) exceeds safety threshold of ${(maxPriceImpactRatio * 100).toFixed(1)}%.`
    );
  }

  let otherThresholdBig = outAmtBig;
  if (quote.otherAmountThreshold) {
    try {
      otherThresholdBig = BigInt(quote.otherAmountThreshold);
    } catch {
      otherThresholdBig = outAmtBig;
    }
  }

  return {
    valid: true,
    otherAmountThreshold: otherThresholdBig,
    outAmount: outAmtBig,
    normalizedPriceImpactRatio: normalizedImpact,
    priceImpactPctString: impactPctString,
  };
}
