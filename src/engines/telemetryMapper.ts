import { TokenTelemetry } from '../engines/MultiLayerValidationEngine';

interface DexScreenerPair {
  dexId: string;
  quoteToken: {
    address: string;
    symbol: string;
  };
  baseToken: {
    symbol: string;
  };
  liquidity?: {
    usd?: number;
  };
  fdv?: number;
  priceUsd?: string;
  priceNative?: string;
}

interface ApiResponsePayload {
  pairs?: DexScreenerPair[];
}

const GRADUATED_DEX_SIGNATURES = [
  'raydium',
  'pumpswap',
  'orca',
  'meteora'
];

/**
 * Determines whether the token is already trading on a migrated AMM venue.
 */
function isGraduatedDex(dexId: string): boolean {
  const normalized = dexId.toLowerCase().trim();

  return GRADUATED_DEX_SIGNATURES.some(signature =>
    normalized.includes(signature)
  );
}

/**
 * Transforms a raw API response from DEXScreener proxy into the unified
 * TokenTelemetry schema.
 *
 * @param mintAddress The token mint address
 * @param apiResponse Raw DEXScreener response
 * @param bondingProgressOverride Optional externally supplied bonding progress
 * @returns TokenTelemetry ready for validation routing
 */
export function createTokenTelemetry(
  mintAddress: string,
  apiResponse: ApiResponsePayload,
  bondingProgressOverride?: number
): TokenTelemetry | null {
  if (!apiResponse.pairs || apiResponse.pairs.length === 0) {
    return null;
  }

  const WSOL_MINT = 'So11111111111111111111111111111111111111112';

  /**
   * If any pairs belong to a graduated DEX (Raydium, Pumpswap, Orca, Meteora),
   * prioritize them entirely over ungraduated pump-fun curves.
   */
  const graduatedPairs = apiResponse.pairs.filter(p => isGraduatedDex(p.dexId || ''));
  const candidatePairs = graduatedPairs.length > 0 ? graduatedPairs : apiResponse.pairs;

  /**
   * Prefer SOL pools, but still rank by liquidity.
   * This avoids selecting tiny SOL pools when a deeper pool exists.
   */
  const rankedPairs = [...candidatePairs].sort((a, b) => {
    const aLiquidity = a.liquidity?.usd ?? 0;
    const bLiquidity = b.liquidity?.usd ?? 0;

    const aSolBonus =
      a.quoteToken?.address === WSOL_MINT ||
      a.quoteToken?.symbol === 'SOL'
        ? 1_000_000
        : 0;

    const bSolBonus =
      b.quoteToken?.address === WSOL_MINT ||
      b.quoteToken?.symbol === 'SOL'
        ? 1_000_000
        : 0;

    return (bLiquidity + bSolBonus) - (aLiquidity + aSolBonus);
  });

  const bestPair = rankedPairs[0];

  const dexId = (bestPair.dexId || 'unknown')
    .toLowerCase()
    .trim();

  const marketCapUSD = bestPair.fdv ?? 0;
  const ammLiquidityUSD = bestPair.liquidity?.usd ?? 0;

  const graduated = isGraduatedDex(dexId);

  let bondingProgress: number;

  if (bondingProgressOverride !== undefined) {
    bondingProgress = bondingProgressOverride;
  } else if (graduated) {
    bondingProgress = 100.0;
  } else {
    bondingProgress = Math.min(
      99.5,
      (marketCapUSD / 65000) * 100
    );
  }

  /**
   * Virtual liquidity is only meaningful while still on a bonding curve.
   */
  const virtualLiquidityUSD = graduated
    ? 0
    : Math.max(5000, ammLiquidityUSD);

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
