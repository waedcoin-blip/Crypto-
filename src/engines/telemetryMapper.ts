// shared/telemetryMapper.ts (Adjust path as needed)
import { TokenTelemetry } from '../engines/MultiLayerValidationEngine';

interface DexScreenerPair {
  dexId: string;
  quoteToken: { address: string; symbol: string; };
  baseToken: { symbol: string; };
  liquidity?: { usd?: number; };
  fdv?: number;
  priceUsd?: string;
  priceNative?: string;
}

interface ApiResponsePayload {
  pairs?: DexScreenerPair[];
}

const GRADUATED_DEX_SIGNATURES = ['raydium', 'pumpswap', 'orca', 'meteora'];
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

// Pump.fun bonding curve constants
const PUMP_FUN_TOTAL_SUPPLY = 1073000000;
const PUMP_FUN_CURVE_SUPPLY = 793100000;
const PUMP_FUN_VIRTUAL_RESERVES_SQRT = 32190000000;

function isGraduatedDex(dexId: string): boolean {
  const normalized = dexId.toLowerCase().trim();
  return GRADUATED_DEX_SIGNATURES.some(signature => normalized.includes(signature));
}

export function createTokenTelemetry(
  mintAddress: string,
  apiResponse: ApiResponsePayload,
  bondingProgressOverride?: number
): TokenTelemetry | null {
  if (!apiResponse.pairs || apiResponse.pairs.length === 0) return null;

  const graduatedPairs = apiResponse.pairs.filter(p => isGraduatedDex(p.dexId || ''));
  const candidatePairs = graduatedPairs.length > 0 ? graduatedPairs : apiResponse.pairs;

  const rankedPairs = [...candidatePairs].sort((a, b) => {
    const aLiquidity = a.liquidity?.usd ?? 0;
    const bLiquidity = b.liquidity?.usd ?? 0;
    const aSolBonus = (a.quoteToken?.address === WSOL_MINT || a.quoteToken?.symbol === 'SOL') ? 1_000_000 : 0;
    const bSolBonus = (b.quoteToken?.address === WSOL_MINT || b.quoteToken?.symbol === 'SOL') ? 1_000_000 : 0;
    return (bLiquidity + bSolBonus) - (aLiquidity + aSolBonus);
  });

  const bestPair = rankedPairs[0];
  const dexId = (bestPair.dexId || 'unknown').toLowerCase().trim();
  const marketCapUSD = bestPair.fdv ?? 0;
  const ammLiquidityUSD = bestPair.liquidity?.usd ?? 0;
  const graduated = isGraduatedDex(dexId);

  let bondingProgress: number;
  if (bondingProgressOverride !== undefined) {
    bondingProgress = bondingProgressOverride;
  } else if (graduated) {
    bondingProgress = 100.0;
  } else {
    // FIX: Cleaned up WSOL check duplication
    const isSol = bestPair.quoteToken?.address === WSOL_MINT || 
                  bestPair.quoteToken?.symbol === 'SOL' || 
                  bestPair.quoteToken?.symbol === 'WSOL';
                  
    const priceNative = (isSol && bestPair.priceNative) 
      ? parseFloat(bestPair.priceNative) 
      : (bestPair.priceUsd ? parseFloat(bestPair.priceUsd) / 150 : 0);

    if (priceNative > 0) {
      const virtualTokenReserves = Math.sqrt(PUMP_FUN_VIRTUAL_RESERVES_SQRT / priceNative);
      const calculatedProgress = ((PUMP_FUN_TOTAL_SUPPLY - virtualTokenReserves) / PUMP_FUN_CURVE_SUPPLY) * 100;
      bondingProgress = Math.min(99.9, Math.max(0, calculatedProgress));
    } else {
      bondingProgress = Math.min(99.5, (marketCapUSD / 65000) * 100);
    }
  }

  const virtualLiquidityUSD = graduated ? 0 : Math.max(5000, ammLiquidityUSD);

  return {
    symbol: bestPair.baseToken?.symbol || 'UNKNOWN',
    mintAddress,
    dexId,
    bondingProgress,
    marketCapUSD,
    virtualLiquidityUSD,
    ammLiquidityUSD
  };
}