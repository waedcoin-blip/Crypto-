// Unified PnL and Fee Calculation Utilities for Live Trading Engine

let cachedSolPriceUsd = 200; // Default fallback, but will be updated dynamically

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

export function calcNetPnl(
  priceNative: number,
  tokenQty: number,
  solSpent: number,
  slippagePct: number = 1.0,
  isRecovery: boolean = false,
  isLiveTrading: boolean = false
) {
  const currentGrossSol = priceNative * tokenQty;
  if (isLiveTrading) {
    const grossPnlSol = currentGrossSol - solSpent;
    const grossPnlPct = solSpent > 0 ? (grossPnlSol / solSpent) * 100 : 0;
    return {
      grossSol: currentGrossSol,
      netSol: currentGrossSol,
      netPnlSol: grossPnlSol,
      netPnlPct: grossPnlPct
    };
  }
  const slippageFee = currentGrossSol * (slippagePct / 100);
  const opFees = getDynamicOperationalFeeSol(isRecovery, solSpent);
  const netSolIfSold = Math.max(0, currentGrossSol - slippageFee - opFees);
  const netPnlSol = netSolIfSold - solSpent;
  const netPnlPct = solSpent > 0 ? (netPnlSol / solSpent) * 100 : 0;
  return {
    grossSol: currentGrossSol,
    netSol: netSolIfSold,
    netPnlSol,
    netPnlPct
  };
}

