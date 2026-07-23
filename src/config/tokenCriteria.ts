/**
 * Criteria a token must meet before PnLPage simulates a buy.
 * Tweak these numbers to control what gets monitored.
 */
export interface TokenCriteria {
  // Minimum liquidity in USD (filters out dead pools)
  minLiquidityUsd: number;

  // Minimum 24h volume in USD
  minVolume24hUsd: number;

  // Maximum token age in milliseconds (skip old tokens)
  maxTokenAgeMs: number;

  // Minimum number of unique buyers in recent window
  minBuyers: number;

  // Must NOT be in these categories (stablecoins, wrapped assets)
  excludedMints: Set<string>;

  // Minimum price change in last 5 minutes (momentum filter)
  minPriceChange5m: number;

  // Maximum price change in last 5 minutes (avoid already-pumped tokens)
  maxPriceChange5m: number;

  // Simulation buy amount in SOL
  simulationBuyAmountSol: number;

  // Real buy amount in SOL (used by SimRealPage)
  realBuyAmountSol: number;

  // Profit threshold to trigger signal (percent)
  signalProfitThreshold: number;

  // Slippage in basis points
  slippageBps: number;
}

export const DEFAULT_CRITERIA: TokenCriteria = {
  minLiquidityUsd: 0,
  minVolume24hUsd: 0,
  maxTokenAgeMs: 99999999999,
  minBuyers: 0,
  excludedMints: new Set(),
  minPriceChange5m: -9999,
  maxPriceChange5m: 9999,
  simulationBuyAmountSol: 0.1,
  realBuyAmountSol: 0.05,
  signalProfitThreshold: -100,
  slippageBps: 500,
};
