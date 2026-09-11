// src/utils/pnlUtils.ts
// Client-side PnL, Fee, and Display Utilities

export const SOL_DECIMALS = 9;
export const LAMPORTS_PER_SOL = 1_000_000_000;

let cachedSolPriceUsd = 200;

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

export const getSolPriceUsd = (): number => {
  return cachedSolPriceUsd;
};

export const getDynamicOperationalFeeSol = (
  isRecovery: boolean = false,
  tradeAmountSol: number = 0.05
): number => {
  const safeAmount = Math.max(0, Number.isFinite(tradeAmountSol) ? tradeAmountSol : 0);
  const jitoTip = safeAmount < 0.05 ? (isRecovery ? 0.0010 : 0.0003) : (isRecovery ? 0.0025 : 0.0015);
  return 0.00005 + jitoTip;
};

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

export function calcNetPnl(
  priceNative: number,
  tokenQty: number,
  solSpent: number,
  slippagePctOrBps: number = 1.0,
  isRecovery: boolean = false,
  isLiveTrading: boolean = false,
  options?: {
    priceUsd?: number;
    solPriceUsd?: number;
    isFirstBuy?: boolean;
    includeAtaRent?: boolean;
    slippageBps?: number;
  }
): NetPnlResult {
  const safeTokenQty = Math.max(0, Number.isFinite(tokenQty) ? Number(tokenQty) : 0);
  const safeSolSpent = Math.max(0, Number.isFinite(solSpent) ? Number(solSpent) : 0);

  let safePriceNative = Number.isFinite(priceNative) && priceNative > 0 ? Number(priceNative) : 0;
  if (options?.priceUsd && options.priceUsd > 0) {
    const solUsd = options.solPriceUsd || getSolPriceUsd();
    if (solUsd > 0) {
      safePriceNative = options.priceUsd / solUsd;
    }
  }

  const currentGrossSol = safePriceNative * safeTokenQty;
  const grossPnlSol = currentGrossSol - safeSolSpent;
  const grossPnlPct = safeSolSpent > 0 ? (grossPnlSol / safeSolSpent) * 100 : (currentGrossSol > 0 ? 100 : 0);

  const slippageBps = options?.slippageBps ?? (slippagePctOrBps > 10 ? slippagePctOrBps : slippagePctOrBps * 100);
  const slippageFeeSol = currentGrossSol * (slippageBps / 10000);
  const exitOpFeesSol = safeTokenQty > 0 && currentGrossSol > 0 ? getDynamicOperationalFeeSol(isRecovery, currentGrossSol) : 0;
  const ataRentSol = options?.includeAtaRent || options?.isFirstBuy ? 0.00203928 : 0;

  const netSolIfSold = Math.max(0, currentGrossSol - slippageFeeSol - exitOpFeesSol);
  const totalCostBasis = safeSolSpent + ataRentSol;
  const netPnlSol = netSolIfSold - totalCostBasis;
  const netPnlPct = totalCostBasis > 0 ? (netPnlSol / totalCostBasis) * 100 : (netSolIfSold > 0 ? 100 : 0);

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
