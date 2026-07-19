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
  minLiquidityUsd: 5000,
  minVolume24hUsd: 10000,
  maxTokenAgeMs: 24 * 60 * 60 * 1000, // 24 hours
  minBuyers: 10,
  excludedMints: new Set([
    'So11111111111111111111111111111111111111112', // wSOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
    '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj', // stSOL
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  ]),
  minPriceChange5m: 0.5,    // must be moving up
  maxPriceChange5m: 50,      // not already 50x'd
  simulationBuyAmountSol: 0.1,
  realBuyAmountSol: 0.05,
  signalProfitThreshold: 1.0, // +1%
  slippageBps: 500,           // 5%
};
