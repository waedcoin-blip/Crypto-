// server/market/HeliusErrors.ts
import { AppError } from '../utils/errors.js';

export function sanitizeApiKey(rawKey?: string): string {
  if (!rawKey || typeof rawKey !== 'string') return '';
  const trimmed = rawKey.trim();
  if (!trimmed) return '';
  
  // Strip url query param if present
  if (trimmed.includes('api-key=')) {
    const match = trimmed.match(/api-key=([a-zA-Z0-9-]+)/);
    if (match && match[1]) {
      return match[1];
    }
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('wss://') || trimmed.startsWith('ws://')) {
    try {
      const u = new URL(trimmed);
      const param = u.searchParams.get('api-key');
      if (param) return param;
    } catch {}
  }
  return trimmed;
}

export function maskApiKey(apiKey?: string): string {
  const sanitized = sanitizeApiKey(apiKey);
  if (!sanitized) return '[NOT CONFIGURED]';
  if (sanitized.length <= 8) return '***' + sanitized.slice(-3);
  return sanitized.slice(0, 4) + '...' + sanitized.slice(-4);
}

export class HeliusError extends AppError {
  constructor(
    message: string,
    public readonly code: string = 'HELIUS_ERROR',
    statusCode: number = 500
  ) {
    super(message, statusCode, code);
  }
}

export class HeliusApiKeyMissingError extends HeliusError {
  constructor(message: string = 'Helius API key is not configured. Set HELIUS_API_KEY environment variable.') {
    super(message, 'HELIUS_API_KEY_MISSING', 401);
  }
}

export class HeliusWssConnectionError extends HeliusError {
  constructor(message: string) {
    super(message, 'HELIUS_WSS_CONNECTION_FAILED', 502);
  }
}

export class HeliusWssAuthError extends HeliusError {
  constructor(message: string = 'Authentication failed for Helius WebSocket. Verify your API key.') {
    super(message, 'HELIUS_WSS_AUTH_FAILED', 401);
  }
}

export class HeliusWssSubscriptionError extends HeliusError {
  constructor(message: string) {
    super(message, 'HELIUS_WSS_SUBSCRIPTION_FAILED', 502);
  }
}

export class HeliusWssStaleError extends HeliusError {
  constructor(message: string = 'Helius WebSocket stream has become stale (no messages received).') {
    super(message, 'HELIUS_WSS_STALE', 504);
  }
}

export class HeliusWssReconnectError extends HeliusError {
  constructor(message: string) {
    super(message, 'HELIUS_WSS_RECONNECT_FAILED', 502);
  }
}

export class HeliusWssInvalidMessageError extends HeliusError {
  constructor(message: string) {
    super(message, 'HELIUS_WSS_INVALID_MESSAGE', 400);
  }
}

export class HeliusGrpcUnavailableError extends HeliusError {
  constructor(message: string = 'Helius LaserStream gRPC is unavailable on Free tier. Standard Helius WebSocket is active.') {
    super(message, 'HELIUS_GRPC_UNAVAILABLE', 503);
  }
}

export class HeliusGrpcNotConfiguredError extends HeliusError {
  constructor(message: string = 'Helius LaserStream gRPC endpoint or credentials are not configured.') {
    super(message, 'HELIUS_GRPC_NOT_CONFIGURED', 400);
  }
}

export class HeliusGrpcEntitlementError extends HeliusError {
  constructor(message: string = 'Helius account does not have Yellowstone gRPC Geyser entitlement. Use Standard Helius WSS.') {
    super(message, 'HELIUS_GRPC_ENTITLEMENT_ERROR', 403);
  }
}
