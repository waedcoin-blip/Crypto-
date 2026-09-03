// server/market/StreamingTransport.ts
import { MarketEvent } from './EventNormalizer.js';

export type TransportType = 'wss' | 'grpc';
export type TransportHealthStatus = 'connecting' | 'connected' | 'reconnecting' | 'degraded' | 'disconnected' | 'disabled';

export interface StreamingTransportTelemetry {
  transport: TransportType;
  endpoint: string | null;
  status: TransportHealthStatus;
  connected: boolean;
  connectedAt: number | null;
  lastMessageAt: number | null;
  lastHeartbeatAt: number | null;
  lastSlot: number;
  messagesReceived: number;
  messagesPerSecond: number;
  reconnectCount: number;
  subscriptionCount: number;
  activeSubscriptions: number;
  averageLatencyMs: number;
  maxLatencyMs: number;
  lastError: string | null;
}

export type StreamEventCallback = (event: MarketEvent) => void;

export interface StreamingTransport {
  readonly transportName: TransportType;
  
  /**
   * Starts the transport connection and registers an event handler.
   */
  start(callback: StreamEventCallback): Promise<boolean>;

  /**
   * Stops the transport cleanly, releasing sockets and timers.
   */
  stop(): Promise<void>;

  /**
   * Subscribes to transaction logs touching specific account mentions or programs.
   */
  subscribeLogs(params: { mentions?: string[]; programs?: string[] }, logicalId?: string): Promise<string | null>;

  /**
   * Subscribes to program account changes.
   */
  subscribeProgram(programId: string, logicalId?: string): Promise<string | null>;

  /**
   * Subscribes to single account changes.
   */
  subscribeAccount(accountAddress: string, logicalId?: string): Promise<string | null>;

  /**
   * Subscribes to slot updates.
   */
  subscribeSlot(logicalId?: string): Promise<string | null>;

  /**
   * Subscribes to signature confirmation (for fast sell exit monitoring).
   */
  subscribeSignature(
    signature: string,
    callback?: (err: any, slot?: number) => void,
    timeoutMs?: number
  ): Promise<{ confirmed: boolean; slot?: number; err?: any }>;

  /**
   * Unsubscribes a logical subscription.
   */
  unsubscribe(logicalId: string): Promise<boolean>;

  /**
   * Returns live telemetry and diagnostics.
   */
  getTelemetry(): StreamingTransportTelemetry;

  /**
   * Returns whether the transport is currently connected and healthy.
   */
  isHealthy(): boolean;
}
