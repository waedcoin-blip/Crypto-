// src/utils/amounts.ts
// Authoritative Amount Engine for ARINA X-RAY
// Provides BigInt-safe raw SPL token calculations, decimal scaling, and percentage operations.

export const SOL_DECIMALS = 9;
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const LAMPORTS_PER_SOL_NUM = 1_000_000_000;

/**
 * Converts a UI amount (number or string) to a BigInt raw token amount based on token decimals.
 * Safe against IEEE-754 precision loss.
 */
export function uiToRawAmount(uiAmount: number | string, decimals: number): bigint {
  if (typeof decimals !== 'number' || decimals < 0 || decimals > 18) {
    throw new Error(`INVALID_DECIMALS: Decimals must be between 0 and 18, got ${decimals}`);
  }

  const str = String(uiAmount).trim();
  if (!str || str === '0' || str === 'NaN') {
    return 0n;
  }

  const [integerPart, decimalPart = ''] = str.split('.');
  const cleanInteger = integerPart.replace(/[^0-9]/g, '') || '0';
  const paddedDecimal = decimalPart.padEnd(decimals, '0').slice(0, decimals);
  const combined = cleanInteger + paddedDecimal;

  return BigInt(combined);
}

/**
 * Converts a BigInt raw token amount to a UI number representation.
 */
export function rawToUiAmount(rawAmount: bigint | string | number, decimals: number): number {
  if (typeof decimals !== 'number' || decimals < 0 || decimals > 18) {
    throw new Error(`INVALID_DECIMALS: Decimals must be between 0 and 18, got ${decimals}`);
  }

  const raw = BigInt(rawAmount ?? 0);
  if (raw === 0n) return 0;

  const divisor = 10n ** BigInt(decimals);
  const integerPart = raw / divisor;
  const remainderPart = raw % divisor;

  const remainderStr = remainderPart.toString().padStart(decimals, '0');
  const fullStr = `${integerPart}.${remainderStr}`;
  return parseFloat(fullStr);
}

/**
 * Converts SOL amount in UI (number) to raw lamports as BigInt.
 */
export function solToLamports(solAmount: number | string): bigint {
  return uiToRawAmount(solAmount, SOL_DECIMALS);
}

/**
 * Converts raw lamports (BigInt) to SOL amount in UI (number).
 */
export function lamportsToSol(lamports: bigint | string | number): number {
  return rawToUiAmount(lamports, SOL_DECIMALS);
}

/**
 * Calculates percentage of a BigInt raw amount using basis points (BPS).
 * e.g., 5000 bps = 50.00%, 10000 bps = 100.00%.
 */
export function percentOfRawAmount(rawAmount: bigint | string | number, bps: number): bigint {
  const raw = BigInt(rawAmount ?? 0);
  const safeBps = BigInt(Math.max(0, Math.min(10000, Math.floor(bps))));
  return (raw * safeBps) / 10000n;
}

/**
 * Formats a BigInt raw token or SOL amount to a readable string with fixed precision.
 */
export function formatRawAmount(
  rawAmount: bigint | string | number,
  decimals: number,
  displayDecimals: number = 4
): string {
  const ui = rawToUiAmount(rawAmount, decimals);
  return ui.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: displayDecimals,
  });
}

/**
 * Validates that a raw token amount is greater than zero.
 */
export function isNonZeroAmount(rawAmount: bigint | string | number | null | undefined): boolean {
  if (rawAmount === null || rawAmount === undefined) return false;
  try {
    return BigInt(rawAmount) > 0n;
  } catch {
    return false;
  }
}
