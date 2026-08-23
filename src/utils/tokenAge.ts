// src/utils/tokenAge.ts

export interface TokenAgeInput {
  pairCreatedAt?: number | null;
  discoveredAt?: number | null;
  createdAt?: number | null;
  creationTimestamp?: number | null;
}

export interface AgeValidationOptions {
  minAgeMinutes?: number | null;
  maxAgeMinutes?: number | null;
  allowUnknownAge?: boolean;
}

export interface TokenAgeResult {
  isValid: boolean;
  ageMinutes: number | null;
  ageSeconds: number | null;
  timestampMs: number | null;
  reason?: string;
}

/**
 * Normalizes any timestamp (seconds or milliseconds) to a valid epoch millisecond timestamp.
 * Rejects future timestamps (allowing 5s clock skew) and invalid numbers.
 */
export function normalizeTimestampMs(ts?: number | null): number | null {
  if (ts == null || typeof ts !== 'number' || isNaN(ts) || ts <= 0) {
    return null;
  }

  // If timestamp is in seconds (e.g., < 10,000,000,000 / 10 billion), convert to ms
  let ms = ts < 10000000000 ? ts * 1000 : ts;

  const now = Date.now();
  // Reject future timestamps beyond 5 seconds allowance for clock skew
  if (ms > now + 5000) {
    return null;
  }

  return ms;
}

/**
 * Resolves the primary creation timestamp in milliseconds from a token input object.
 * Priority: pairCreatedAt -> discoveredAt -> createdAt -> creationTimestamp
 * Returns null if no valid timestamp is found (does NOT fallback to Date.now()).
 */
export function getTokenTimestampMs(input?: TokenAgeInput | number | null): number | null {
  if (input == null) return null;

  if (typeof input === 'number') {
    return normalizeTimestampMs(input);
  }

  const rawTs =
    input.pairCreatedAt ??
    input.discoveredAt ??
    input.createdAt ??
    input.creationTimestamp;

  return normalizeTimestampMs(rawTs);
}

/**
 * Calculates the age of a token in minutes.
 * Returns null if the token has no valid creation timestamp.
 */
export function getTokenAgeMinutes(input?: TokenAgeInput | number | null): number | null {
  const tsMs = getTokenTimestampMs(input);
  if (tsMs === null) return null;

  const ageMs = Math.max(0, Date.now() - tsMs);
  return ageMs / 60000;
}

/**
 * Calculates the age of a token in seconds.
 * Returns null if the token has no valid creation timestamp.
 */
export function getTokenAgeSeconds(input?: TokenAgeInput | number | null): number | null {
  const tsMs = getTokenTimestampMs(input);
  if (tsMs === null) return null;

  const ageMs = Math.max(0, Date.now() - tsMs);
  return ageMs / 1000;
}

/**
 * Validates a token's age against minAgeMinutes and maxAgeMinutes.
 * Rejects unknown age if filtering is active and allowUnknownAge is false.
 * Rejects invalid criteria where minAgeMinutes > maxAgeMinutes.
 */
export function validateTokenAge(
  input?: TokenAgeInput | number | null,
  options: AgeValidationOptions = {}
): TokenAgeResult {
  const { minAgeMinutes, maxAgeMinutes, allowUnknownAge = false } = options;

  const minAge = minAgeMinutes != null && !isNaN(minAgeMinutes) ? Math.max(0, minAgeMinutes) : null;
  const maxAge = maxAgeMinutes != null && !isNaN(maxAgeMinutes) ? Math.max(0, maxAgeMinutes) : null;

  // Validate configuration sanity: minAge cannot exceed maxAge
  if (minAge !== null && maxAge !== null && minAge > maxAge) {
    return {
      isValid: false,
      ageMinutes: null,
      ageSeconds: null,
      timestampMs: null,
      reason: `Invalid criteria configuration: minAgeMinutes (${minAge}) cannot be greater than maxAgeMinutes (${maxAge}).`
    };
  }

  const tsMs = getTokenTimestampMs(input);
  if (tsMs === null) {
    const isFilterActive = minAge !== null || maxAge !== null;
    if (isFilterActive && !allowUnknownAge) {
      return {
        isValid: false,
        ageMinutes: null,
        ageSeconds: null,
        timestampMs: null,
        reason: `Token age is unknown and allowUnknownAge is false while age filtering is active.`
      };
    }
    return {
      isValid: true,
      ageMinutes: null,
      ageSeconds: null,
      timestampMs: null,
      reason: `Unknown age allowed.`
    };
  }

  const ageMinutes = (Date.now() - tsMs) / 60000;
  const ageSeconds = ageMinutes * 60;

  if (minAge !== null && ageMinutes < minAge) {
    return {
      isValid: false,
      ageMinutes,
      ageSeconds,
      timestampMs: tsMs,
      reason: `Token age (${ageMinutes.toFixed(1)} mins) is less than minimum required age (${minAge} mins).`
    };
  }

  if (maxAge !== null && ageMinutes > maxAge) {
    return {
      isValid: false,
      ageMinutes,
      ageSeconds,
      timestampMs: tsMs,
      reason: `Token age (${ageMinutes.toFixed(1)} mins) exceeds maximum allowed age (${maxAge} mins).`
    };
  }

  return {
    isValid: true,
    ageMinutes,
    ageSeconds,
    timestampMs: tsMs
  };
}

/**
 * Formats token age into a human-readable string (e.g., "5M", "2H 15M", "1D 4H").
 */
export function formatTokenAge(input?: TokenAgeInput | number | null): string {
  const ageMinutes = getTokenAgeMinutes(input);
  if (ageMinutes === null) return 'N/A';

  const totalMinutes = Math.floor(ageMinutes);
  if (totalMinutes < 1) {
    const secs = Math.floor(getTokenAgeSeconds(input) || 0);
    return `${secs}s`;
  }
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours < 24) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}
