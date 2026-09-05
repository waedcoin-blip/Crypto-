import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

export interface SolanaMintValidationResult {
  valid: boolean;
  mint?: string;
  reason?: 'INVALID_BASE58' | 'INVALID_BYTE_LENGTH' | 'INVALID_PUBLIC_KEY';
}

export function validateSolanaMint(mint: unknown): SolanaMintValidationResult {
  if (typeof mint !== 'string' || !mint.trim()) {
    return { valid: false, reason: 'INVALID_BASE58' };
  }

  const trimmed = mint.trim();

  // Try decoding base58
  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(trimmed);
  } catch (err) {
    return { valid: false, reason: 'INVALID_BASE58' };
  }

  // Enforce 32 bytes
  if (decoded.length !== 32) {
    return { valid: false, reason: 'INVALID_BYTE_LENGTH' };
  }

  // Ensure it's a valid PublicKey construction
  try {
    const pubkey = new PublicKey(trimmed);
    return { valid: true, mint: pubkey.toBase58() };
  } catch (err) {
    return { valid: false, reason: 'INVALID_PUBLIC_KEY' };
  }
}

export function canonicalizeSolanaMint(mint: unknown): string {
  const result = validateSolanaMint(mint);
  if (!result.valid || !result.mint) {
    throw new Error(`INVALID_MINT: ${result.reason}`);
  }
  return result.mint;
}
