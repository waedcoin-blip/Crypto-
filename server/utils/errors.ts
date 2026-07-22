/**
 * Custom error classes and error handling utilities
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = 'INTERNAL_ERROR',
    public readonly isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class BadGatewayError extends AppError {
  constructor(message: string = 'Upstream service error') {
    super(message, 502, 'BAD_GATEWAY');
  }
}

// Benign error patterns that should be suppressed in logs
const BENIGN_PATTERNS = [
  'NO_ROUTES_FOUND',
  'No liquidity',
  'User rejected',
  'WalletNotConnected',
  'Transaction not confirmed',
  'SIMULATION_ERROR',
  'AbortError',
  'ECONNRESET',
  'ENOTFOUND',
  'socket hang up',
  'read ECONNRESET',
  'write ECONNRESET',
  'Ping timeout',
  '429',
  'ws error',
  'WebSocket',
  'websocket',
  'failed: WebSocket is closed',
  'connection to',
  'Unexpected server response',
];

export function isBenignError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return BENIGN_PATTERNS.some((pattern) => 
    message.includes(pattern) || message.toLowerCase().includes(pattern.toLowerCase())
  );
}
