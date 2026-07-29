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
): SimRealPnlResult | null {
  if (!Number.isFinite(spentSol) || spentSol <= 0) {
    return null;
  }
  
  if (!Number.isFinite(tokensQty) || tokensQty <= 0) {
    return null;
  }
  
  if (!Number.isFinite(currentPriceSol) || currentPriceSol <= 0) {
    return null;
  }

  const grossValueSol = currentPriceSol * tokensQty;
  const grossPnlSol = grossValueSol - spentSol;
  const grossPnlPct = (grossPnlSol / spentSol) * 100;

  let netValueSol = grossValueSol;
  if (!isRealPrivateKey) {
    const slippageFee = grossValueSol * (slippagePct / 100);
    const opFees = getDynamicOperationalFeeSol(recoveryMode, spentSol);
    netValueSol = Math.max(0, grossValueSol - slippageFee - opFees);
  }

  const netPnlSol = netValueSol - spentSol;
  const netPnlPct = (netPnlSol / spentSol) * 100;

  return {
    currPriceSol: currentPriceSol,
    tokensQty: tokensQty,
    spentSol: spentSol,
    grossValueSol,
    grossPnlSol,
    grossPnlPct,
    netValueSol,
    netPnlSol,
    netPnlPct
  };
}
