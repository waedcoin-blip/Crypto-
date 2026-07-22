/**
 * Enhanced fetch utilities with timeout, retry, and error handling
 */
import { logger } from './logger.js';
import { BadGatewayError, isBenignError } from './errors.js';

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  baseBackoffMs?: number;
}

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF = 1000;

export async function fetchWithTimeout(
  url: string,
  options: FetchOptions = {},
  timeoutMsOverride?: number
): Promise<Response> {
  const timeoutMs = timeoutMsOverride ?? options.timeoutMs ?? DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export interface FetchWithRetryResult {
  response: Response;
  text: string;
}

export async function fetchWithRetry(
  url: string,
  options: FetchOptions = {},
  retriesOverride?: number,
  baseBackoffMsOverride?: number
): Promise<FetchWithRetryResult> {
  const retries = retriesOverride ?? options.retries ?? DEFAULT_RETRIES;
  const baseBackoffMs = baseBackoffMsOverride ?? options.baseBackoffMs ?? DEFAULT_BACKOFF;

  let lastError: Error | undefined;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetchWithTimeout(url, options);

      // Handle rate limiting with backoff
      if (response.status === 429) {
        const jitter = Math.random() * 500;
        const backoff = baseBackoffMs * Math.pow(2, i) + jitter;
        logger.warn({ url, attempt: i + 1, backoff }, 'Rate limited [429], backing off');
        if (i < retries - 1) {
          await sleep(backoff);
          continue;
        }
      }

      const text = await response.text();
      return { response, text };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isBenignError(lastError)) {
        logger.error({ url, attempt: i + 1, error: lastError.message }, 'Fetch attempt failed');
      }

      if (i < retries - 1) {
        const jitter = Math.random() * 500;
        const backoff = Math.max(500, baseBackoffMs * Math.pow(2, i) + jitter);
        await sleep(backoff);
      }
    }
  }

  throw new BadGatewayError(
    `Failed to fetch ${url} after ${retries} attempts: ${lastError?.message}`
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isNoRouteError(responseBody: unknown): boolean {
  if (!responseBody || typeof responseBody !== 'object') return false;
  const body = responseBody as Record<string, unknown>;
  const errorCode = String(body.errorCode || '');
  const errorMsg = String(body.error || '');

  return (
    errorCode === 'NO_ROUTES_FOUND' ||
    errorCode === 'COULD_NOT_FIND_ANY_ROUTE' ||
    errorMsg.includes('No routes found') ||
    errorMsg.includes('COULD_NOT_FIND_ANY_ROUTE')
  );
}

export function isUntradableError(responseBody: unknown): boolean {
  if (!responseBody || typeof responseBody !== 'object') return false;
  const body = responseBody as Record<string, unknown>;
  const errorCode = String(body.errorCode || '');
  const errorMsg = String(body.error || '');

  return (
    errorCode === 'TOKEN_NOT_TRADABLE' ||
    errorMsg.includes('Missing token program') ||
    errorMsg.includes('is not tradable')
  );
}
