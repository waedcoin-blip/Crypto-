// src/utils/pnlCalculator.ts
// Unified PnL, Fee, and Cost Basis Calculation Engine for Paper & Live Solana Trading

export const SOL_DECIMALS = 9;
export const LAMPORTS_PER_SOL = 1_000_000_000;

// Standard Solana on-chain fee constants
export const BASE_GAS_COMPUTE_SOL = 0.00005; // Base Solana transaction fee (5,000 lamports) + compute budget
export const ATA_RENT_EXEMPTION_SOL = 0.00203928; // Standard Associated Token Account rent exemption in SOL

// Jito & Priority Tip Tiers based on trade volume / urgency
export const JITO_TIP_STANDARD_SOL = 0.0003; // Standard priority tip for trades < 0.05 SOL
export const JITO_TIP_HIGH_SOL = 0.0015; // Priority tip for trades >= 0.05 SOL
export const JITO_TIP_RECOVERY_LOW_SOL = 0.0010; // Recovery exit tip for trades < 0.05 SOL
export const JITO_TIP_RECOVERY_HIGH_SOL = 0.0025; // Recovery exit tip for trades >= 0.05 SOL

export const DEFAULT_TRADE_FEE_SOL = BASE_GAS_COMPUTE_SOL + JITO_TIP_STANDARD_SOL; // 0.00035 SOL

let cachedSolPriceUsd = 200; // Dynamic SOL price cache

export interface FeeConfig {
  baseGasSol?: number;
  jitoTipSol?: number;
  priorityFeeSol?: number;
  isRecovery?: boolean;
}

export interface PnlOptions {
  priceUsd?: number;
  solPriceUsd?: number;
  isFirstBuy?: boolean;
  includeAtaRent?: boolean;
  slippageBps?: number;
}

export interface NetPnlResult {
  grossSol: number;
  netSol: number;
  grossPnlSol: number;
  grossPnlPct: number;
  netPnlSol: number;
  netPnlPct: number;
  slippageFeeSol: number;
  operationalFeesSol: number;
  ataRentSol: number;
}

/**
 * Set cached SOL price in USD with strict boundary and sanity validation (10 - 50,000 USD).
 */
export const setSolPriceUsd = (priceUsd: number): void => {
  if (
    typeof priceUsd === 'number' &&
    Number.isFinite(priceUsd) &&
    priceUsd >= 10 &&
    priceUsd <= 50_000
  ) {
    cachedSolPriceUsd = priceUsd;
  }
};

/**
 * Get cached SOL price in USD.
 */
export const getSolPriceUsd = (): number => {
  return cachedSolPriceUsd;
};

/**
 * Calculate dynamic operational fee (base gas + compute + dynamic Jito/priority tip)
 * for an execution based on trade size (tradeAmountSol) and recovery status.
 */
export const getDynamicOperationalFeeSol = (
  isRecoveryOrConfig: boolean | FeeConfig = false,
  tradeAmountSol: number = 0.05
): number => {
  const safeTradeAmount = Math.max(0, Number.isFinite(tradeAmountSol) ? tradeAmountSol : 0);

  if (typeof isRecoveryOrConfig === 'object' && isRecoveryOrConfig !== null) {
    const base = isRecoveryOrConfig.baseGasSol ?? BASE_GAS_COMPUTE_SOL;
    const priority = isRecoveryOrConfig.priorityFeeSol ?? 0;
    const jito =
      isRecoveryOrConfig.jitoTipSol ??
      (isRecoveryOrConfig.isRecovery
        ? safeTradeAmount >= 0.05
          ? JITO_TIP_RECOVERY_HIGH_SOL
          : JITO_TIP_RECOVERY_LOW_SOL
        : safeTradeAmount >= 0.05
        ? JITO_TIP_HIGH_SOL
        : JITO_TIP_STANDARD_SOL);

    return base + priority + jito;
  }

  const isRecovery = Boolean(isRecoveryOrConfig);
  let jitoTip = isRecovery ? JITO_TIP_RECOVERY_HIGH_SOL : JITO_TIP_HIGH_SOL;
  if (safeTradeAmount < 0.05) {
    jitoTip = isRecovery ? JITO_TIP_RECOVERY_LOW_SOL : JITO_TIP_STANDARD_SOL;
  }

  return BASE_GAS_COMPUTE_SOL + jitoTip;
};

/**
 * Normalizes slippage parameter whether passed as bps (50, 100) or percent (0.5, 1.0),
 * safely clamping between 0% and 50%.
 */
export function normalizeSlippagePct(slippage: number | undefined): number {
  if (typeof slippage !== 'number' || !Number.isFinite(slippage) || slippage <= 0) {
    return 1.0; // Default 1% slippage
  }
  // If > 10, caller passed basis points (e.g. 50 bps = 0.5%, 100 bps = 1.0%, 500 bps = 5%)
  const pct = slippage > 10 ? slippage / 100 : slippage;
  return Math.min(50, Math.max(0, pct));
}

/**
 * Authoritative unified PnL calculator for both paper and live trading.
 * 
 * Accounts for:
 * 1. Exact gross asset valuation (priceNative * tokenQty)
 * 2. Exit slippage deduction based on actual exit trade value
 * 3. Dynamic operational gas and priority/Jito fees for the exit execution
 * 4. First-time ATA rent exemption accounting (if applicable)
 * 5. Robust zero-cost basis and edge-case handling
 */
export function calcNetPnl(
  priceNative: number,
  tokenQty: number,
  solSpent: number,
  slippagePctOrBps: number = 1.0,
  isRecovery: boolean = false,
  isLiveTrading: boolean = false,
  options?: PnlOptions
): NetPnlResult {
  // 1. Sanitize Inputs
  const safeTokenQty = Math.max(0, Number.isFinite(tokenQty) ? Number(tokenQty) : 0);
  const safeSolSpent = Math.max(0, Number.isFinite(solSpent) ? Number(solSpent) : 0);

  let safePriceNative = Number.isFinite(priceNative) && priceNative > 0 ? Number(priceNative) : 0;
  if (options?.priceUsd && options.priceUsd > 0) {
    const solUsd = options.solPriceUsd || getSolPriceUsd();
    if (solUsd > 0) {
      safePriceNative = options.priceUsd / solUsd;
    }
  }

  // 2. Gross Value
  const currentGrossSol = safePriceNative * safeTokenQty;
  const grossPnlSol = currentGrossSol - safeSolSpent;
  const grossPnlPct = safeSolSpent > 0 ? (grossPnlSol / safeSolSpent) * 100 : (currentGrossSol > 0 ? 100 : 0);

  // 3. Execution Costs on Exit (Slippage & Dynamic Fees)
  const effectiveSlippagePct = normalizeSlippagePct(options?.slippageBps ?? slippagePctOrBps);
  const slippageFeeSol = currentGrossSol * (effectiveSlippagePct / 100);

  // Operational fees are calculated on the exit trade value (currentGrossSol), NOT on total cumulative solSpent
  const exitOpFeesSol = safeTokenQty > 0 && currentGrossSol > 0
    ? getDynamicOperationalFeeSol(isRecovery, currentGrossSol)
    : 0;

  const ataRentSol = options?.includeAtaRent || options?.isFirstBuy ? ATA_RENT_EXEMPTION_SOL : 0;

  // 4. Net Proceeds if Sold Now
  const netSolIfSold = Math.max(0, currentGrossSol - slippageFeeSol - exitOpFeesSol);
  const totalCostBasis = safeSolSpent + ataRentSol;
  const netPnlSol = netSolIfSold - totalCostBasis;

  let netPnlPct = 0;
  if (totalCostBasis > 0) {
    netPnlPct = (netPnlSol / totalCostBasis) * 100;
  } else if (netSolIfSold > 0) {
    netPnlPct = 100; // Free / Airdropped tokens with positive value
  }

  return {
    grossSol: currentGrossSol,
    netSol: netSolIfSold,
    grossPnlSol,
    grossPnlPct,
    netPnlSol,
    netPnlPct,
    slippageFeeSol,
    operationalFeesSol: exitOpFeesSol,
    ataRentSol,
  };
}
