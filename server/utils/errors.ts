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
  'Not allowed by CORS',
  'CORS',
  'VALIDATION_ERROR',
  'RATE_LIMIT_EXCEEDED',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'DISCOVERY_UNAVAILABLE',
  'bigint: Failed to load bindings',
  'Failed to load bindings',
  'pure JS will be used',
  'Telegram',
  'Telegram API',
  'telegram',
  'bot token',
];

export function isBenignError(error: unknown): boolean {
  let message = '';
  let code = '';
  if (error instanceof Error) {
    message = error.message;
    code = (error as any).code || '';
  } else if (error && typeof error === 'object') {
    try {
      message = (error as any).message || (error as any).error || JSON.stringify(error);
      code = (error as any).code || '';
    } catch {
      message = String(error);
    }
  } else {
    message = String(error);
  }

  const combined = `${code} ${message}`;

  return BENIGN_PATTERNS.some((pattern) => 
    combined.includes(pattern) || combined.toLowerCase().includes(pattern.toLowerCase())
  );
}
