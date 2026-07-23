const fs = require('fs');
let code = fs.readFileSync('src/config/tokenCriteria.ts', 'utf8');

const newCode = `export const DEFAULT_CRITERIA: TokenCriteria = {
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
};`;

code = code.replace(/export const DEFAULT_CRITERIA: TokenCriteria = \{[\s\S]*?\};/, newCode);
fs.writeFileSync('src/config/tokenCriteria.ts', code);
