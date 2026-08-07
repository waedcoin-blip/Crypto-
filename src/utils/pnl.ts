// src/utils/pnl.ts — Shared between UI and engine
import { ITradeExecutor } from '../services/ITradeExecutor';

export interface PnLResult {
  grossValueSol: number;
  netValueSol: number;
  pnlPct: number;
  absolutePnlSol: number;
  isPositive: boolean;
}

export async function calculatePnL(
  executor: ITradeExecutor,
  position: {
    mint: string;
    amount: number;
    solSpent: number;
    buyPrice: number;
    currentPrice?: number;
  },
  slippagePct: number,
  recoveryMode: boolean,
  getDynamicOperationalFeeSol: (recovery: boolean, solSpent: number) => number
): Promise<PnLResult> {
  // 1. Get current token price
  const quote = await executor.getQuote({
    inputMint: position.mint,
    outputMint: 'So11111111111111111111111111111111111111112',
    amount: position.amount,
    slippageBps: Math.round(slippagePct * 100),
    restrictIntermediateTokens: true,
  });

  const displayPrice = position.currentPrice
    || Number(quote.outAmount) / position.amount / 1e9
    || position.buyPrice
    || 0;

  // 2. Gross position value
  const currentGrossSol = displayPrice * position.amount;

  // 3. Deduct fees (for simulation / non-private key mode)
  let netSolIfSold = currentGrossSol;
  if (executor.mode === 'paper') {
    const slippageFee = currentGrossSol * (slippagePct / 100);
    const opFees = getDynamicOperationalFeeSol(recoveryMode, position.solSpent);
    netSolIfSold = Math.max(0, currentGrossSol - slippageFee - opFees);
  } else {
    // Real mode: use Jupiter's slippage-protected minimum
    netSolIfSold = Number(quote.otherAmountThreshold) / 1e9;
  }

  // 4. PnL Percentage
  const pnlPct = position.solSpent > 0
    ? ((netSolIfSold - position.solSpent) / position.solSpent)
    : 0;

  const isPos = pnlPct >= 0;

  return {
    grossValueSol: currentGrossSol,
    netValueSol: netSolIfSold,
    pnlPct,
    absolutePnlSol: Math.abs(netSolIfSold - position.solSpent),
    isPositive: isPos,
  };
}
