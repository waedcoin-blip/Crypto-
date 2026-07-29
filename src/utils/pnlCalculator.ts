// Unified PnL and Fee Calculation Utilities for SimReal & Live Trading Engine

let cachedSolPriceUsd = 180;

export const setSolPriceUsd = (priceUsd: number) => {
  if (priceUsd && priceUsd > 0) {
    cachedSolPriceUsd = priceUsd;
  }
};

export const getSolPriceUsd = (): number => {
  return cachedSolPriceUsd;
};

export const getDynamicOperationalFeeSol = (isRecovery: boolean = false, tradeAmountSol: number = 0.05): number => {
  const baseGasAndComputeSol = 0.00005;
  let jitoTip = isRecovery ? 0.0025 : 0.0015;
  if (tradeAmountSol < 0.05) {
    jitoTip = Math.min(jitoTip, tradeAmountSol * 0.05); // Cap at 5% of trade size
  }
  return baseGasAndComputeSol + jitoTip;
};

export interface SimRealPnlResult {
  currPriceSol: number;
  tokensQty: number;
  spentSol: number;
  grossValueSol: number;
  grossPnlSol: number;
  grossPnlPct: number;
  netValueSol: number;
  netPnlSol: number;
  netPnlPct: number;
}

export function calculateSimRealPnl(
  spentSol: number,
  tokensQty: number,
  boughtPriceSol: number,
  currentPriceSol: number,
  slippagePct: number = 1.0,
  recoveryMode: boolean = false,
  isRealPrivateKey: boolean = false
): SimRealPnlResult {
  const safeSpentSol = spentSol > 0 ? spentSol : 0.1;
  const safeBoughtPrice = boughtPriceSol > 0 
    ? boughtPriceSol 
    : (tokensQty > 0 ? safeSpentSol / tokensQty : 0.000001);
  const safeCurrPrice = currentPriceSol > 0 ? currentPriceSol : safeBoughtPrice;
  const safeTokensQty = tokensQty > 0 ? tokensQty : (safeSpentSol / safeBoughtPrice);

  const grossValueSol = safeCurrPrice * safeTokensQty;
  const grossPnlSol = grossValueSol - safeSpentSol;
  const grossPnlPct = safeSpentSol > 0 ? (grossPnlSol / safeSpentSol) * 100 : 0;

  let netValueSol = grossValueSol;
  if (!isRealPrivateKey) {
    const slippageFee = grossValueSol * (slippagePct / 100);
    const opFees = getDynamicOperationalFeeSol(recoveryMode, safeSpentSol);
    netValueSol = Math.max(0, grossValueSol - slippageFee - opFees);
  }

  const netPnlSol = netValueSol - safeSpentSol;
  const netPnlPct = safeSpentSol > 0 ? (netPnlSol / safeSpentSol) * 100 : 0;

  return {
    currPriceSol: safeCurrPrice,
    tokensQty: safeTokensQty,
    spentSol: safeSpentSol,
    grossValueSol,
    grossPnlSol,
    grossPnlPct,
    netValueSol,
    netPnlSol,
    netPnlPct
  };
}
