export interface PnlResult {
  pnlSol: number;
  pnlPct: number;
  currentValueSol: number;
}

export class PnlCalculator {
  public static calculatePnl(amountRaw: number, decimals: number, entryPriceSol: number, currentPriceSol: number, solSpent: number): PnlResult {
    if (amountRaw <= 0 || decimals < 0) {
      return { pnlSol: 0, pnlPct: 0, currentValueSol: 0 };
    }
    const tokenQty = amountRaw / (10 ** decimals);
    const currentValueSol = tokenQty * currentPriceSol;
    const pnlSol = currentValueSol - solSpent;
    const pnlPct = entryPriceSol > 0 ? ((currentPriceSol - entryPriceSol) / entryPriceSol) * 100 : 0;
    return { pnlSol, pnlPct, currentValueSol };
  }
}
