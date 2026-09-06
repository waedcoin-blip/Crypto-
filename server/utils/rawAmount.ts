/** Exact integer helpers for SPL raw amounts and SOL lamports.
 * Raw balances never pass through IEEE-754 Number arithmetic.
 */
export function parsePositiveRawAmount(value: bigint | string | number, label = 'amount'): bigint {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error(`INVALID_RAW_AMOUNT: ${label} number must be a safe integer`);
  }
  const str = String(value).trim();
  if (!/^\d+$/.test(str)) throw new Error(`INVALID_RAW_AMOUNT: ${label} must be a non-negative integer`);
  const raw = BigInt(str);
  if (raw <= 0n) throw new Error(`INVALID_RAW_AMOUNT: ${label} must be greater than zero`);
  return raw;
}

export function safeRawNumber(raw: bigint): number {
  if (raw < 0n || raw > BigInt(Number.MAX_SAFE_INTEGER)) return 0;
  return Number(raw.toString());
}

export function applySlippageBps(raw: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new Error(`INVALID_SLIPPAGE_BPS: ${slippageBps}`);
  }
  return (raw * BigInt(10_000 - slippageBps)) / 10_000n;
}

/** Display-only conversion. Exact raw arithmetic must be completed before this function. */
export function rawToUiNumber(raw: bigint | string | number, decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error(`INVALID_DECIMALS: ${decimals}`);
  }
  const value = BigInt(String(raw));
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  return Number(whole.toString()) + Number(fraction.toString()) / Number(scale.toString());
}

/** Display-only SOL conversion from exact lamports. */
export function lamportsToSolNumber(lamports: bigint | string | number): number {
  return rawToUiNumber(lamports, 9);
}
