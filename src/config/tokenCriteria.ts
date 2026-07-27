/**
 * Criteria a token must meet before PnLPage simulates a buy.
 * Tweak these numbers to control what gets monitored.
 */
export interface TokenCriteria {
  // Minimum liquidity in USD (filters out dead pools)
  readonly minLiquidityUsd: number;

  // Minimum 24h volume in USD
  readonly minVolume24hUsd: number;

  // Maximum token age in milliseconds (skip old tokens)
  readonly maxTokenAgeMs: number;

  // Minimum number of unique buyers in recent window
  readonly minBuyers: number;

  // Set of specific mint addresses to exclude (e.g., stablecoins, wrapped assets)
  readonly excludedMints: ReadonlySet<string>;

  // Minimum price change in last 5 minutes (momentum filter)
  readonly minPriceChange5m: number;

  // Maximum price change in last 5 minutes (avoid already-pumped tokens)
  readonly maxPriceChange5m: number;

  // Simulation buy amount in SOL
  readonly simulationBuyAmountSol: number;

  // Real buy amount in SOL (used by SimRealPage)
  readonly realBuyAmountSol: number;

  // Profit threshold to trigger signal in percentage points (e.g. 1.0 = +1.0% profit required)
  readonly signalProfitThreshold: number;

  // Slippage in basis points (e.g. 100 bps = 1.0% slippage tolerance)
  readonly slippageBps: number;
}

export const DEFAULT_CRITERIA: Readonly<TokenCriteria> = Object.freeze({
  minLiquidityUsd: 1000,
  minVolume24hUsd: 500,
  maxTokenAgeMs: 24 * 60 * 60 * 1000, // 24 hours in ms
  minBuyers: 5,
  excludedMints: Object.freeze(new Set<string>()),
  minPriceChange5m: -50,
  maxPriceChange5m: 500,
  simulationBuyAmountSol: 0.1,
  realBuyAmountSol: 0.05,
  signalProfitThreshold: 1.0, // 1.0 = 1.0% profit threshold
  slippageBps: 100, // 100 bps = 1.0%
});
