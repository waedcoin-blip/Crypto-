/**
 * Validation utilities for Solana addresses and common inputs
 */
import { ValidationError } from './errors.js';

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidSolanaAddress(addr: unknown): boolean {
  if (!addr || typeof addr !== 'string') return false;
  if (addr.startsWith('sim')) return true; // Simulated tokens
  return SOLANA_ADDRESS_REGEX.test(addr.trim());
}

export function validateSolanaAddress(addr: unknown, fieldName: string = 'address'): string {
  if (!isValidSolanaAddress(addr)) {
    throw new ValidationError(
      `Query parameter ${fieldName} cannot be parsed: Invalid Solana address format`
    );
  }
  return String(addr).trim();
}

export function validateSolanaAddresses(addrs: string[]): string[] {
  return addrs.map((addr, i) => validateSolanaAddress(addr, `address[${i}]`));
}

export function validateRequiredString(value: unknown, fieldName: string): string {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`Missing or invalid required field: ${fieldName}`);
  }
  return value.trim();
}

export function validatePositiveNumber(value: unknown, fieldName: string): number {
  const num = Number(value);
  if (isNaN(num) || num <= 0) {
    throw new ValidationError(`Invalid positive number for ${fieldName}: ${value}`);
  }
  return num;
}

export function validateUrlArray(value: unknown, maxItems: number = 5): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError('urls array required');
  }
  return value
    .slice(0, maxItems)
    .map((u) => String(u))
    .filter((u) => u.startsWith('http'));
}

export function sanitizeFtpHost(host: string): string {
  // Remove protocol prefixes if present
  return host.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function validateFtpCredentials(body: Record<string, unknown>): {
  host: string;
  user: string;
  pass: string;
  dir: string;
  secure: boolean;
} {
  const host = validateRequiredString(body.host, 'host');
  const user = validateRequiredString(body.user, 'user');
  const pass = validateRequiredString(body.pass, 'pass');
  const dir = typeof body.dir === 'string' ? body.dir : '/htdocs';
  const secure = Boolean(body.secure);

  return { host: sanitizeFtpHost(host), user, pass, dir, secure };
}
